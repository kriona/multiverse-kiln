import { Room, type AuthContext, type Client, type CloseCode } from 'colyseus';
import { editorAccessOf, EditorMessageType, EditorPresence, EditorServerMessageType, EditorState, EditorWindow, MAX_KEPT_CHAT_MESSAGES, NoticeReason, ServerCloseCode, type EditorRole, type KeptChatHistoryPayload, type KeptChatMessage, type NoticePayload, type UniverseRole } from '@multiverse-kiln/shared';

import { resolveSession } from '../auth/sessions.js';
import { addChatMessages, listChatMessages, type KeptChat, type NewChatMessage } from '../db/chatRepo.js';
import { isActiveServerAdmin } from '../db/serverAdminRepo.js';
import { findUniverseAccess } from '../db/universeEditorRepo.js';
import { findUniverse } from '../db/universeRepo.js';
import { connectedSessions } from '../players/connectedSessions.js';
import { universeAccessChanges } from '../players/universeAccess.js';
import { areaChanges } from '../world/areaChanges.js';
import { editorUpdates, type EditorUpdate } from '../world/editorUpdates.js';
import { InvalidMessages } from './invalidMessages.js';
import { chatPayload, describeInvalidPayload, editorPlacePayload, roomOptions } from './payloads.js';
import { RateLimiter } from './rateLimiter.js';

/**
 * What onAuth found out about a client, available afterward as client.auth
 */
interface EditorIdentity
{
	/**
	 * The login session the client connected with
	 */
	sessionId: string;

	playerId: string;

	/**
	 * The player's display name and username
	 */
	name: string;
	username: string;

	/**
	 * Whether the player is a server admin with 2FA on, who edits with the site admin role when they have
	 * no stronger one
	 */
	serverAdmin: boolean;

	/**
	 * The player's role in the editor as of when the window joined; later changes go to the state
	 */
	role: EditorRole;
}

type EditorClient = Client<{ auth: EditorIdentity }>;

/**
 * Who an editor client is
 *
 * @param client A client that has passed onAuth
 * @return Its identity
 */
function identityOf(client: EditorClient): EditorIdentity
{
	if (!client.auth)
	{
		throw new Error(`Editor client ${client.sessionId} has no identity`);
	}

	return(client.auth);
}

/**
 * How often the room writes the chat's new messages to the database, in milliseconds
 */
export const CHAT_SAVE_INTERVAL_MS = 5000;

/**
 * Most chat messages a player may send in CHAT_RATE_WINDOW_MS; more are dropped
 */
const CHAT_RATE_LIMIT = 5;

const CHAT_RATE_WINDOW_MS = 5000;

/**
 * A universe's editor room: who has its editor open, and the editors' chat
 *
 * Every window with the universe's editor open joins it with the universe's ID (EditorJoinOptions), and
 * every window of the same universe joins the same room (filterBy in app.config.ts). Only players who may
 * open the universe's editor are admitted: those with a role in it, and server admins with 2FA on, who
 * edit with the site admin role when they have no stronger one. Its state lists each player once,
 * however many windows they have, with what each window has open (EditorMessageType.Place)
 *
 * The chat is kept (server/src/db/chatRepo.ts): the room loads its messages as it starts, and writes new
 * ones every CHAT_SAVE_INTERVAL_MS and as it closes, never while a message is being handled
 *
 * A window whose session ends is turned away (ServerCloseCode.LoggedOut), as are a player's windows when
 * they lose the right to open the editor (ServerCloseCode.AccessLost) and every window when the universe
 * is deleted. A change to a player's role, to the universe's stage or to whether it is disabled tells
 * the windows it concerns (EditorServerMessageType.AccessChanged), which load the universe again
 */
export class EditorRoom extends Room<{ state: EditorState; client: EditorClient }>
{
	// Colyseus allows unlimited messages by default. Windows send Place as the player moves between tabs
	// and areas, and chat, so an honest client stays far below this
	maxMessagesPerSecond = 20;

	state = new EditorState();

	private universeId!: string;

	private chat!: KeptChat;

	/**
	 * The chat's kept messages, oldest first, as the room holds them (server-only, not synced)
	 */
	private chatHistory: KeptChatMessage[] = [];

	/**
	 * Messages sent since the chat was last written to the database, oldest first
	 */
	private unsavedChat: NewChatMessage[] = [];

	/**
	 * The write of the chat going on, if any; each waits for the one before
	 */
	private savingChat: Promise<void> = Promise.resolve();

	private readonly chatLimiter = new RateLimiter(CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_MS);

	private readonly invalidMessages = new InvalidMessages();

	/**
	 * Each window's key in its player's EditorPresence.windows, by the client's session ID
	 */
	private readonly windowKeys = new Map<string, string>();

	private nextWindowKey = 1;

	private stopFollowingSessions?: () => void;

	private stopFollowingWorld?: () => void;

	private stopFollowingUpdates?: () => void;

	private stopFollowingStage?: () => void;

	messages = {
		[EditorMessageType.Place]: (client: EditorClient, payload: unknown) =>
		{
			const result = editorPlacePayload.safeParse(payload);

			if (!result.success)
			{
				this.invalidMessages.reject(client, EditorMessageType.Place, describeInvalidPayload(result.error));
				return;
			}

			const window = this.windowOf(client);

			if (window)
			{
				window.version = result.data.version;
				window.tab = result.data.tab;
				window.areaId = (result.data.areaId ?? '');
			}
		},

		[EditorMessageType.Chat]: (client: EditorClient, payload: unknown) =>
		{
			const result = chatPayload.safeParse(payload);

			if (!result.success)
			{
				this.invalidMessages.reject(client, EditorMessageType.Chat, describeInvalidPayload(result.error));
				return;
			}

			const { playerId, name, username } = identityOf(client);

			if (!this.chatLimiter.tryTake(playerId))
			{
				const notice: NoticePayload = { reason: NoticeReason.ChatTooFast };

				client.send(EditorServerMessageType.Notice, notice);
				return;
			}

			const message: KeptChatMessage = {
				playerId,
				name,
				username,
				text: result.data.text,
				sentAt: Date.now()
			};

			this.chatHistory = [...this.chatHistory, message].slice(-MAX_KEPT_CHAT_MESSAGES);
			this.unsavedChat.push({
				playerId,
				authorName: null,
				text: message.text,
				sentAt: new Date(message.sentAt)
			});
			this.broadcast(EditorServerMessageType.Chat, message);
		}
	};

	/**
	 * Loads the editors' chat and starts writing its new messages, and starts following changes to
	 * sessions, roles and the universe. Fails for a universe that doesn't exist, which turns away the
	 * client asking for it
	 *
	 * @param options The universe, from the first client's EditorJoinOptions
	 */
	async onCreate(options: unknown): Promise<void>
	{
		const { universeId } = roomOptions.parse(options);

		if (!await findUniverse(universeId))
		{
			throw new Error(`Universe ${universeId} has no editor to join`);
		}

		this.universeId = universeId;
		this.chat = { kind: 'editors', universeId };
		this.chatHistory = await listChatMessages(this.chat);

		this.clock.setInterval(() =>
		{
			void this.saveChat();
		}, CHAT_SAVE_INTERVAL_MS);

		this.stopFollowingSessions = connectedSessions.onEnd((sessionIds) =>
		{
			this.turnAway((identity) => sessionIds.has(identity.sessionId), ServerCloseCode.LoggedOut);
		});

		this.stopFollowingWorld = areaChanges.onChange((change) =>
		{
			if ((change.kind === 'universeDeleted') && (change.universeId === this.universeId))
			{
				this.turnAway(() => true, ServerCloseCode.UniverseDeleted);
			}
		});

		this.stopFollowingUpdates = editorUpdates.onUpdate((update) =>
		{
			if (update.universeId === this.universeId)
			{
				this.applyUpdate(update);
			}
		});

		this.stopFollowingStage = universeAccessChanges.onStageChanged((change) =>
		{
			if (change.universeId === this.universeId)
			{
				this.broadcast(EditorServerMessageType.AccessChanged);
			}
		});
	}

	/**
	 * Stops following changes, and writes the chat's last new messages
	 */
	async onDispose(): Promise<void>
	{
		this.stopFollowingSessions?.();
		this.stopFollowingWorld?.();
		this.stopFollowingUpdates?.();
		this.stopFollowingStage?.();
		await this.saveChat();
	}

	/**
	 * Admits only clients whose browser is logged in as a player who may open the universe's editor
	 *
	 * @param _client The joining client
	 * @param _options Join options from the client (already used to pick this room)
	 * @param context The connection's request headers, which carry the session cookie
	 * @return The client's identity, stored as client.auth; false to turn the client away
	 */
	async onAuth(_client: Client, _options: unknown, context: AuthContext): Promise<EditorIdentity | false>
	{
		const session = await resolveSession(context.headers.get('cookie'));

		if (!session)
		{
			return(false);
		}

		const serverAdmin = await isActiveServerAdmin(session.playerId);
		const access = editorAccessOf(await findUniverseAccess(this.universeId, session.playerId), serverAdmin);

		if (!access)
		{
			return(false);
		}

		return({
			sessionId: session.sessionId,
			playerId: session.playerId,
			name: session.name,
			username: session.username,
			serverAdmin,
			role: access.role
		});
	}

	/**
	 * Lists the window, and its player with the role just found when they have no other window here,
	 * then sends it the chat
	 *
	 * @param client The joining client
	 */
	onJoin(client: EditorClient): void
	{
		const { sessionId, playerId, name, username, role } = identityOf(client);
		let presence = this.state.editors.get(playerId);

		if (!presence)
		{
			presence = new EditorPresence({
				name,
				username,
				role
			});
			this.state.editors.set(playerId, presence);
		}
		else
		{
			presence.role = role;
		}

		const key = String(this.nextWindowKey++);
		const history: KeptChatHistoryPayload = { messages: this.chatHistory };

		this.windowKeys.set(client.sessionId, key);
		presence.windows.set(key, new EditorWindow({
			version: 'live',
			tab: 'universe',
			areaId: ''
		}));
		client.send(EditorServerMessageType.ChatHistory, history);
		connectedSessions.connect(sessionId);
	}

	/**
	 * Takes the window off the list, and its player once their last window has gone
	 *
	 * @param client The leaving client
	 * @param code WebSocket close code
	 */
	onLeave(client: EditorClient, code: CloseCode): void
	{
		const { sessionId, playerId } = identityOf(client);
		const presence = this.state.editors.get(playerId);
		const key = this.windowKeys.get(client.sessionId);

		this.windowKeys.delete(client.sessionId);

		if (presence && (key !== undefined))
		{
			presence.windows.delete(key);

			if (presence.windows.size === 0)
			{
				this.state.editors.delete(playerId);
				this.chatLimiter.forget(playerId);
			}
		}

		connectedSessions.disconnect(sessionId);
		this.invalidMessages.forget(client.sessionId);
		console.log(client.sessionId, 'left the editor of universe', this.universeId, code);
	}

	/**
	 * Writes the chat's new messages to the database, after any write going on. Messages that can't be
	 * written are kept for the next try, unless the universe or a writer's account is gone
	 *
	 * @return Resolves once they are written, or have failed to be
	 */
	saveChat(): Promise<void>
	{
		this.savingChat = this.savingChat.then(async () =>
		{
			const messages = this.unsavedChat;

			if (messages.length === 0)
			{
				return;
			}

			this.unsavedChat = [];

			try
			{
				if (!await addChatMessages(this.chat, messages))
				{
					console.log('Dropped', messages.length, 'chat messages of universe', this.universeId, 'whose universe or writer no longer exists');
				}
			}
			catch (error)
			{
				this.unsavedChat = [...messages, ...this.unsavedChat].slice(-MAX_KEPT_CHAT_MESSAGES);
				console.error('Could not keep the editors\' chat of universe', this.universeId, error);
			}
		});

		return(this.savingChat);
	}

	/**
	 * What a window has open, in the state
	 *
	 * @param client The window
	 * @return Its entry, or undefined when it has left
	 */
	private windowOf(client: EditorClient): EditorWindow | undefined
	{
		const key = this.windowKeys.get(client.sessionId);

		return(((key === undefined) ? undefined : this.state.editors.get(identityOf(client).playerId)?.windows.get(key)));
	}

	/**
	 * Follows an update for the universe's editors: players whose role a save changed are listed with
	 * the new one, and their windows load the universe again, or are turned away when they may no longer
	 * open the editor; a server admin disabling or enabling the universe has every window load it again
	 *
	 * @param update The update
	 */
	private applyUpdate(update: EditorUpdate): void
	{
		if (update.kind === 'access')
		{
			this.broadcast(EditorServerMessageType.AccessChanged);
			return;
		}

		for (const [playerId, role] of update.roles)
		{
			this.applyRole(playerId, role);
		}
	}

	/**
	 * Follows a change to one player's role
	 *
	 * @param playerId The player's ID
	 * @param role Their role in the universe, or undefined when they have none
	 */
	private applyRole(playerId: string, role: UniverseRole | undefined): void
	{
		const clients = this.clients.filter((client) => (identityOf(client).playerId === playerId));
		const presence = this.state.editors.get(playerId);

		if (clients.length === 0)
		{
			return;
		}

		const access = editorAccessOf(((role === undefined) ? undefined : { role, languages: [] }), identityOf(clients[0]).serverAdmin);

		if (!access)
		{
			for (const client of clients)
			{
				client.leave(ServerCloseCode.AccessLost);
			}

			return;
		}

		if (presence)
		{
			presence.role = access.role;
		}

		for (const client of clients)
		{
			client.send(EditorServerMessageType.AccessChanged);
		}
	}

	/**
	 * Turns away the windows that match
	 *
	 * @param matches Whether to turn away a window, by its identity
	 * @param code Why, as the close code the window gets
	 */
	private turnAway(matches: (identity: EditorIdentity) => boolean, code: ServerCloseCode): void
	{
		for (const client of this.clients)
		{
			if (matches(identityOf(client)))
			{
				client.leave(code);
			}
		}
	}
}
