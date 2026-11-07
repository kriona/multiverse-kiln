import { Room, ServerError, type AuthContext, type Client, type CloseCode } from 'colyseus';
import { editorAccessOf, EditorMessageType, EditorPresence, EditorServerMessageType, EditorState, EditorWindow, NoticeReason, ServerCloseCode, stageChangesEditorAccess, type ChatAuthorDeletedPayload, type ChatReadPayload, type EditorRole, type EditorSavedPayload, type NoticePayload, type UniverseAccess, type UniverseRole } from '@multiverse-kiln/shared';

import { resolveSession, type SessionIdentity } from '../auth/sessions.js';
import { isActiveServerAdmin } from '../db/serverAdminRepo.js';
import { findUniverseAccess } from '../db/universeEditorRepo.js';
import { findUniverse } from '../db/universeRepo.js';
import { noticeDetails } from '../logic/saveNotices.js';
import { accountDeletions } from '../players/accountDeletions.js';
import { connectedSessions } from '../players/connectedSessions.js';
import { serverAdminChanges } from '../players/serverAdminChanges.js';
import { universeAccessChanges, type StageChange } from '../players/universeAccess.js';
import { areaChanges } from '../world/areaChanges.js';
import { editorUpdates, type EditorUpdate, type SavedUpdate } from '../world/editorUpdates.js';
import { InvalidMessages } from './invalidMessages.js';
import { JoinChanges } from './joinChanges.js';
import { CHAT_SAVE_INTERVAL_MS, KeptChatLog } from './keptChat.js';
import { chatPayload, chatReadPayload, describeInvalidPayload, editorPlacePayload, roomOptions } from './payloads.js';
import { createChatLimiter } from './rateLimiter.js';

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
	 * no stronger one: found as the window joins, and turned off when the room hears they no longer are
	 */
	serverAdmin: boolean;

	/**
	 * The player's role in the editor: found as the window joins, and changed when the room hears of a
	 * new one. The state lists it too, once for each player
	 */
	role: EditorRole;
}

type EditorClient = Client<{ auth: EditorIdentity }>;

/**
 * The role a player may open the editor with
 */
interface EditorAdmission
{
	/**
	 * Whether they are a server admin with 2FA on
	 */
	serverAdmin: boolean;

	role: EditorRole;
}

/**
 * What a joining window found out about itself: its session, and the role its player may open the
 * editor with
 */
interface EditorLookup
{
	/**
	 * Undefined when the window's browser isn't logged in
	 */
	session: SessionIdentity | undefined;

	/**
	 * Undefined when the player may not open the editor, or there is no session
	 */
	admission: EditorAdmission | undefined;
}

/**
 * The changes to who may open the editor, and with what role, that a joining window may miss
 * (JoinChanges): sessions ending, the universe being deleted, roles changing, server admins losing
 * the site admin role, and the universe's stage changing or it being disabled or enabled
 */
type EditorJoinChange = 'session' | 'universeDeleted' | 'roles' | 'serverAdmin' | 'stage' | 'access';

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
 * A universe's editor room: who has its editor open, the editors' chat, and what each saves
 *
 * Every window with the universe's editor open joins it with the universe's ID (EditorJoinOptions), and
 * every window of the same universe joins the same room (filterBy in app.config.ts). Only players who may
 * open the universe's editor are admitted: those with a role in it, and server admins with 2FA on, who
 * edit with the site admin role when they have no stronger one. Its state lists each player once,
 * however many windows they have, with what each window has open (EditorMessageType.Place)
 *
 * The chat is kept (server/src/db/chatRepo.ts): the room loads its messages as it starts, and writes new
 * ones every CHAT_SAVE_INTERVAL_MS and as it closes, never while a message is being handled. It
 * remembers how far each player has read it the same way, loading their record as they join, so
 * messages written while they were away count as new (EditorMessageType.ChatRead)
 *
 * A window whose session ends is turned away (ServerCloseCode.LoggedOut), as are a player's windows when
 * they lose the right to open the editor (ServerCloseCode.AccessLost), by losing their role or by no longer
 * being a server admin with 2FA on, and every window when the universe is deleted. A change to a player's
 * role, to the universe's stage or to whether it is disabled tells
 * the windows it concerns (EditorServerMessageType.AccessChanged), which load the universe again. A
 * window that joins while one of these changes is published looks itself up again once it is listed
 * (JoinChanges), so the change reaches it too. Once a save commits, every other window hears of it, with
 * what it changed that the window shows (EditorServerMessageType.Saved)
 */
export class EditorRoom extends Room<{ state: EditorState; client: EditorClient }>
{
	// Colyseus allows unlimited messages by default. Windows send Place as the player moves between tabs
	// and areas, and chat, so an honest client stays far below this
	maxMessagesPerSecond = 20;

	state = new EditorState();

	private universeId!: string;

	/**
	 * The editors' chat, loaded in onCreate
	 */
	private readonly chat = new KeptChatLog();

	private readonly chatLimiter = createChatLimiter();

	private readonly invalidMessages = new InvalidMessages();

	private readonly joinChanges = new JoinChanges<EditorJoinChange, EditorLookup>();

	/**
	 * Each window's key in its player's EditorPresence.windows, by the client's session ID
	 */
	private readonly windowKeys = new Map<string, string>();

	private nextWindowKey = 1;

	private stopFollowingSessions?: () => void;

	private stopFollowingWorld?: () => void;

	private stopFollowingUpdates?: () => void;

	private stopFollowingStage?: () => void;

	private stopFollowingAdmins?: () => void;

	private stopFollowingDeletions?: () => void;

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
				window.unsaved = result.data.unsaved;
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

			const message = this.chat.add({
				playerId,
				name,
				username
			}, result.data.text);

			this.broadcast(EditorServerMessageType.Chat, message);
		},

		[EditorMessageType.ChatRead]: (client: EditorClient, payload: unknown) =>
		{
			const result = chatReadPayload.safeParse(payload);

			if (!result.success)
			{
				this.invalidMessages.reject(client, EditorMessageType.ChatRead, describeInvalidPayload(result.error));
				return;
			}

			const { playerId } = identityOf(client);

			if (!this.chat.markRead(playerId, result.data.readAt))
			{
				return;
			}

			const read: ChatReadPayload = { readAt: (this.chat.readOf(playerId) ?? result.data.readAt) };

			for (const other of this.clients)
			{
				if ((other !== client) && (identityOf(other).playerId === playerId))
				{
					other.send(EditorServerMessageType.ChatRead, read);
				}
			}
		}
	};

	/**
	 * Loads the editors' chat and starts writing its new messages, and starts following changes to
	 * sessions, roles and the universe, and deleted accounts, whose names the chat drops. Fails for a universe that doesn't exist, which turns away the
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
		await this.chat.load({ kind: 'editors', universeId });

		this.clock.setInterval(() =>
		{
			void this.saveChat();
		}, CHAT_SAVE_INTERVAL_MS);

		this.stopFollowingSessions = connectedSessions.onEnd((sessionIds) =>
		{
			this.joinChanges.note('session');
			this.turnAway((identity) => sessionIds.has(identity.sessionId), ServerCloseCode.LoggedOut);
		});

		this.stopFollowingWorld = areaChanges.onChange((change) =>
		{
			if ((change.kind === 'universeDeleted') && (change.universeId === this.universeId))
			{
				this.joinChanges.note('universeDeleted');
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
				this.joinChanges.note('stage');
				this.applyStageChange(change);
			}
		});

		this.stopFollowingAdmins = serverAdminChanges.onLost((playerId) =>
		{
			this.joinChanges.note('serverAdmin');
			void this.applyServerAdminLost(playerId);
		});

		this.stopFollowingDeletions = accountDeletions.onDeleted((playerId) =>
		{
			if (this.chat.forgetAuthor(playerId))
			{
				const deleted: ChatAuthorDeletedPayload = { playerId };

				this.broadcast(EditorServerMessageType.ChatAuthorDeleted, deleted);
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
		this.stopFollowingAdmins?.();
		this.stopFollowingDeletions?.();
		await this.saveChat();
	}

	/**
	 * Admits only clients whose browser is logged in as a player who may open the universe's editor, and
	 * loads how far that player has read the chat
	 *
	 * @param client The joining client
	 * @param _options Join options from the client (already used to pick this room)
	 * @param context The connection's request headers, which carry the session cookie
	 * @return The client's identity, stored as client.auth; false to turn the client away
	 */
	async onAuth(client: Client, _options: unknown, context: AuthContext): Promise<EditorIdentity | false>
	{
		const cookieHeader = context.headers.get('cookie');

		this.joinChanges.startLookup(client, () => this.lookUp(cookieHeader));

		const session = await resolveSession(cookieHeader);

		if (!session)
		{
			return(false);
		}

		// How far the player has read the chat is looked up alongside their access, and held only once
		// they are admitted
		const chatRead = this.chat.findRead(session.playerId)
			.then(
				(readAt) => ({ found: true as const, readAt }),
				(error: unknown) => ({ found: false as const, error })
			);
		const [admission, read] = await Promise.all([
			this.findAdmission(session.playerId),
			chatRead
		]);

		if (!admission)
		{
			return(false);
		}

		if (read.found)
		{
			this.chat.keepRead(session.playerId, read.readAt);
		}
		else
		{
			// The editor works without it: the chat's history then counts as read
			console.error('Could not find how far player', session.playerId, 'has read the editors\' chat of universe', this.universeId, read.error);
		}

		return({
			sessionId: session.sessionId,
			playerId: session.playerId,
			name: session.name,
			username: session.username,
			serverAdmin: admission.serverAdmin,
			role: admission.role
		});
	}

	/**
	 * Lists the window, and its player with the role just found when they have no other window here,
	 * then sends it the chat, with how far its player has read it. A window that may have missed a
	 * change while it joined looks itself up again first (recheckJoining())
	 *
	 * @param client The joining client
	 */
	async onJoin(client: EditorClient): Promise<void>
	{
		await this.recheckJoining(client);

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

		this.windowKeys.set(client.sessionId, key);
		presence.windows.set(key, new EditorWindow({
			version: 'live',
			tab: 'universe',
			areaId: '',
			unsaved: false
		}));
		client.send(EditorServerMessageType.ChatHistory, this.chat.history(playerId));
		connectedSessions.connect(client, sessionId);
	}

	/**
	 * Takes the window off the list, and its player once their last window has gone
	 *
	 * @param client The leaving client
	 * @param code WebSocket close code
	 */
	onLeave(client: EditorClient, code: CloseCode): void
	{
		const { playerId } = identityOf(client);
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

		connectedSessions.disconnect(client);
		this.invalidMessages.forget(client.sessionId);
		console.log(client.sessionId, 'left the editor of universe', this.universeId, code);
	}

	/**
	 * Finds whether a player is a server admin with 2FA on, and the role they may open the editor with
	 *
	 * @param playerId The player's ID
	 * @return Both; undefined when they may not open the editor
	 */
	private async findAdmission(playerId: string): Promise<EditorAdmission | undefined>
	{
		const [serverAdmin, universeAccess] = await Promise.all([
			isActiveServerAdmin(playerId),
			findUniverseAccess(this.universeId, playerId)
		]);
		const access = editorAccessOf(universeAccess, serverAdmin);

		return((access ? { serverAdmin, role: access.role } : undefined));
	}

	/**
	 * Looks a joining window up again, as onAuth did
	 *
	 * @param cookieHeader The connection's Cookie header
	 * @return Its session, and the role its player may open the editor with
	 */
	private async lookUp(cookieHeader: string | null): Promise<EditorLookup>
	{
		const session = await resolveSession(cookieHeader);

		return({
			session,
			admission: (session ? await this.findAdmission(session.playerId) : undefined)
		});
	}

	/**
	 * Looks a joining window up again when a change it may have missed was published while onAuth looked
	 * it up (JoinChanges). The window is turned away, as the room's listeners would have turned it away,
	 * when its session has ended, the universe was deleted or its player may no longer open the editor.
	 * Otherwise it takes the role its player has now, and loads the universe again when that role, the
	 * universe's stage or whether it is disabled changed, since the window may have loaded it before
	 *
	 * @param client The joining client, already among the room's clients
	 * @return Resolves once the window has the role it has now
	 */
	private async recheckJoining(client: EditorClient): Promise<void>
	{
		const rechecked = await this.joinChanges.recheck(client);

		if (!rechecked)
		{
			return;
		}

		const { found, missed } = rechecked;
		const identity = identityOf(client);

		if (missed.has('universeDeleted'))
		{
			throw new ServerError(ServerCloseCode.UniverseDeleted, 'The universe was deleted while the window joined');
		}

		if (!found.session)
		{
			throw new ServerError(ServerCloseCode.LoggedOut, 'The window\'s session ended while it joined');
		}

		if (!found.admission)
		{
			throw new ServerError(ServerCloseCode.AccessLost, 'The window\'s player lost access to the editor while it joined');
		}

		const changed = ((found.admission.role !== identity.role) || missed.has('stage') || missed.has('access'));

		identity.serverAdmin = found.admission.serverAdmin;
		identity.role = found.admission.role;

		if (changed)
		{
			client.send(EditorServerMessageType.AccessChanged);
		}
	}

	/**
	 * Writes the chat's new messages to the database, after any write going on
	 *
	 * @return Resolves once they are written, or have failed to be
	 */
	saveChat(): Promise<void>
	{
		return(this.chat.save());
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
			this.joinChanges.note('access');
			this.broadcast(EditorServerMessageType.AccessChanged);
			return;
		}

		if (update.kind === 'saved')
		{
			this.tellSaved(update);
			return;
		}

		this.joinChanges.note('roles');

		for (const [playerId, role] of update.roles)
		{
			this.applyRole(playerId, role);
		}
	}

	/**
	 * Tells every window but the one that saved of a save, with what it changed that the window shows
	 * (noticeDetails()), by the version it has open and its player's role. A window hears of every save,
	 * even one changing nothing it shows, since the Audit tab lists the saves of both versions
	 *
	 * @param update The save
	 */
	private tellSaved(update: SavedUpdate): void
	{
		for (const client of this.clients)
		{
			if (client.sessionId === update.windowId)
			{
				continue;
			}

			const payload: EditorSavedPayload = {
				playerId: update.playerId,
				name: update.name,
				username: update.username,
				version: update.version,
				details: noticeDetails(update.details, update.version, ((this.windowOf(client)?.version === 'draft') ? 'draft' : 'live'), identityOf(client).role)
			};

			client.send(EditorServerMessageType.Saved, payload);
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
		const clients = this.windowsOf(playerId);
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
			identityOf(client).role = access.role;
			client.send(EditorServerMessageType.AccessChanged);
		}
	}

	/**
	 * Follows a change to the universe's stage: tells the windows of the players it changes what they may
	 * do for (stageChangesEditorAccess), by the role each has once the save committed. A player left with
	 * no role is turned away when the room hears of the roles the save changed
	 *
	 * @param change The universe's new stage, the one before it and its editors' roles
	 */
	private applyStageChange(change: StageChange): void
	{
		for (const client of this.clients)
		{
			const { playerId, serverAdmin } = identityOf(client);
			const role = change.roles.get(playerId);
			const access = editorAccessOf(((role === undefined) ? undefined : { role, languages: [] }), serverAdmin);

			if (access && stageChangesEditorAccess(access.role, change.previousStage, change.stage))
			{
				client.send(EditorServerMessageType.AccessChanged);
			}
		}
	}

	/**
	 * Follows a player no longer being a server admin with 2FA on: their windows stop editing with the
	 * site admin role and take their role in the universe, looked up again, or are turned away when they
	 * have none. Their windows are also turned away when the lookup fails, rather than keep a role they
	 * may not have
	 *
	 * @param playerId The player's ID
	 * @return Resolves once their windows have been told, or turned away
	 */
	private async applyServerAdminLost(playerId: string): Promise<void>
	{
		if (!this.windowsOf(playerId).some((client) => identityOf(client).serverAdmin))
		{
			return;
		}

		// Turned off before the lookup so that a role changed meanwhile is applied without the site admin
		// role, and again after it for windows that joined meanwhile
		this.stopServerAdmin(playerId);

		let universeAccess: UniverseAccess | undefined;

		try
		{
			universeAccess = await findUniverseAccess(this.universeId, playerId);
		}
		catch (error)
		{
			console.error('Could not find the role of player', playerId, 'in universe', this.universeId, 'once they were no longer a server admin', error);
			this.turnAway((identity) => (identity.playerId === playerId), ServerCloseCode.AccessLost);
			return;
		}

		this.stopServerAdmin(playerId);

		const access = editorAccessOf(universeAccess, false);

		if (access && (this.state.editors.get(playerId)?.role === access.role))
		{
			return;
		}

		this.applyRole(playerId, universeAccess?.role);
	}

	/**
	 * Stops a player's windows editing with the site admin role
	 *
	 * @param playerId The player's ID
	 */
	private stopServerAdmin(playerId: string): void
	{
		for (const client of this.windowsOf(playerId))
		{
			identityOf(client).serverAdmin = false;
		}
	}

	/**
	 * A player's windows in the room
	 *
	 * @param playerId The player's ID
	 * @return Their clients
	 */
	private windowsOf(playerId: string): EditorClient[]
	{
		return(this.clients.filter((client) => (identityOf(client).playerId === playerId)));
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
