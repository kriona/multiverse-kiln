import { ErrorCode, Room, ServerError, type AuthContext, type Client, type CloseCode } from 'colyseus';
import { editorAccessOf, EditorMessageType, EditorPresence, EditorServerMessageType, EditorState, EditorWindow, NoticeReason, ServerCloseCode, stageChangesEditorAccess, type ChatAuthorDeletedPayload, type ChatReadPayload, type EditorRole, type EditorSavedPayload, type NoticePayload, type UniverseAccess, type UniverseRole } from '@multiverse-kiln/shared';

import { resolveSession, type SessionIdentity } from '../auth/sessions.js';
import { isActiveServerAdmin } from '../db/serverAdminRepo.js';
import { hasTwoFactor } from '../db/twoFactorRepo.js';
import { findUniverseAccess } from '../db/universeEditorRepo.js';
import { findUniverse } from '../db/universeRepo.js';
import { noticeDetails } from '../logic/saveNotices.js';
import { accountDeletions } from '../players/accountDeletions.js';
import { connectedSessions } from '../players/connectedSessions.js';
import { serverAdminChanges } from '../players/serverAdminChanges.js';
import { twoFactorChanges } from '../players/twoFactorChanges.js';
import { universeAccessChanges, type StageChange } from '../players/universeAccess.js';
import { areaChanges } from '../world/areaChanges.js';
import { editorUpdates, type EditorUpdate, type SavedUpdate } from '../world/editorUpdates.js';
import { ChangesWhileCreating } from './changesWhileCreating.js';
import { InvalidMessages } from './invalidMessages.js';
import { JoinChanges } from './joinChanges.js';
import { CHAT_SAVE_INTERVAL_MS, KeptChatLog } from './keptChat.js';
import { isLoggedInToMatchmake } from './matchmakingAuth.js';
import { OneRoomPerKey } from './oneRoomPerKey.js';
import { unexplainedRoomError, withoutErrorDetails } from './roomErrors.js';
import { chatPayload, chatReadPayload, describeInvalidPayload, editorPlacePayload, roomOptions } from './payloads.js';
import { tryTakeChatMessage } from './rateLimiter.js';

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
	 * Whether the player has 2FA on, without which they may not stay once the universe requires it:
	 * found as the window joins, and changed when the room hears they turned it on or off
	 */
	twoFactor: boolean;

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

	/**
	 * Whether they have 2FA on
	 */
	twoFactor: boolean;

	/**
	 * Whether the universe requires its editors to have 2FA on and they don't, which keeps them out
	 */
	twoFactorRequired: boolean;

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
 * the site admin role, players turning 2FA on or off, and the universe's stage changing, it being
 * disabled or enabled, or whether it requires 2FA changing
 */
type EditorJoinChange = 'session' | 'universeDeleted' | 'roles' | 'serverAdmin' | 'twoFactor' | 'stage' | 'access';

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
 * The open editor room of each universe, by universe ID
 */
const editorRooms = new OneRoomPerKey<EditorRoom>('universe');

/**
 * A universe's editor room: who has its editor open, the editors' chat, and what each saves
 *
 * Every window with the universe's editor open joins it with the universe's ID (EditorJoinOptions), and
 * every window of the same universe joins the same room (filterBy in app.config.ts). A second room for a
 * universe that has one is refused (editorRooms), since it would split the editors and their chat between
 * them. Only players who may
 * open the universe's editor are admitted: those with a role in it, with 2FA on while the universe
 * requires it, and server admins with 2FA on, who edit with the site admin role when they have no
 * stronger one. Its state lists each player once,
 * however many windows they have, with what each window has open (EditorMessageType.Place)
 *
 * The chat is kept (server/src/db/chatRepo.ts): the room loads its messages as it starts, and writes new
 * ones every CHAT_SAVE_INTERVAL_MS and as it closes, never while a message is being handled. It
 * remembers how far each player has read it the same way, loading their record as they join, so
 * messages written while they were away count as new (EditorMessageType.ChatRead)
 *
 * A window whose session ends is turned away (ServerCloseCode.LoggedOut), as are a player's windows when
 * they lose the right to open the editor (ServerCloseCode.AccessLost), by losing their role or by no longer
 * being a server admin with 2FA on, and every window when the universe is deleted. The windows of players
 * without 2FA on are turned away (ServerCloseCode.TwoFactorRequired) when the universe starts requiring
 * it, and a player's windows when they turn it off while it does. A change to a player's role, to the
 * universe's stage or to whether it is disabled tells the windows it concerns
 * (EditorServerMessageType.AccessChanged), which load the universe again. A window that joins while one of these changes is published looks itself up again once it is listed
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

	private readonly invalidMessages = new InvalidMessages();

	private readonly joinChanges = new JoinChanges<EditorJoinChange, EditorLookup>();

	private readonly whileCreating = new ChangesWhileCreating();

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

	private stopFollowingTwoFactor?: () => void;

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

			if (!tryTakeChatMessage(`editors ${this.universeId}`, playerId))
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
	 * Makes the universe's editor room (create()), telling the client nothing of why it couldn't be made
	 * (withoutErrorDetails())
	 *
	 * @param options The universe, from the first client's EditorJoinOptions
	 */
	async onCreate(options: unknown): Promise<void>
	{
		await withoutErrorDetails('Creating an editor room', ErrorCode.MATCHMAKE_UNHANDLED, () => this.create(options));
	}

	/**
	 * Loads the editors' chat and starts writing its new messages, and starts following changes to
	 * sessions, roles and the universe, and deleted accounts, whose names the chat drops. Fails for
	 * options that aren't EditorJoinOptions or a universe that doesn't exist, which turns away the client
	 * asking for it, with the same error (unexplainedRoomError()) for each, which isn't logged
	 *
	 * @param options The universe, from the first client's EditorJoinOptions
	 */
	private async create(options: unknown): Promise<void>
	{
		const parsed = roomOptions.safeParse(options);

		if (!parsed.success)
		{
			throw unexplainedRoomError();
		}

		const { universeId } = parsed.data;

		editorRooms.claim(universeId, this);
		this.followChanges();

		if (!await findUniverse(universeId))
		{
			throw unexplainedRoomError();
		}

		this.universeId = universeId;
		await this.chat.load({ kind: 'editors', universeId });

		this.clock.setInterval(() =>
		{
			void this.saveChat();
		}, CHAT_SAVE_INTERVAL_MS);

		this.whileCreating.created();
	}

	/**
	 * Starts following changes to sessions, roles and the universe, and deleted accounts, whose names
	 * the chat drops. Called before onCreate's first read, so none published while it loads are missed:
	 * until it has loaded, they are held (whileCreating)
	 */
	private followChanges(): void
	{
		this.stopFollowingSessions = connectedSessions.onEnd((sessionIds) =>
		{
			this.whileCreating.apply(() =>
			{
				this.joinChanges.note('session');
				this.turnAway((identity) => sessionIds.has(identity.sessionId), ServerCloseCode.LoggedOut);
			});
		});

		this.stopFollowingWorld = areaChanges.onChange((change) =>
		{
			this.whileCreating.apply(() =>
			{
				if ((change.kind === 'universeDeleted') && (change.universeId === this.universeId))
				{
					this.joinChanges.note('universeDeleted');
					this.turnAway(() => true, ServerCloseCode.UniverseDeleted);
				}
			});
		});

		this.stopFollowingUpdates = editorUpdates.onUpdate((update) =>
		{
			this.whileCreating.apply(() =>
			{
				if (update.universeId === this.universeId)
				{
					this.applyUpdate(update);
				}
			});
		});

		this.stopFollowingStage = universeAccessChanges.onStageChanged((change) =>
		{
			this.whileCreating.apply(() =>
			{
				if (change.universeId === this.universeId)
				{
					this.joinChanges.note('stage');
					this.applyStageChange(change);
				}
			});
		});

		this.stopFollowingAdmins = serverAdminChanges.onLost((playerId) =>
		{
			this.whileCreating.apply(() =>
			{
				this.joinChanges.note('serverAdmin');
				void this.applyServerAdminLost(playerId);
			});
		});

		this.stopFollowingTwoFactor = twoFactorChanges.onChange((playerId, on) =>
		{
			this.whileCreating.apply(() =>
			{
				this.joinChanges.note('twoFactor');
				void this.applyTwoFactorChange(playerId, on);
			});
		});

		this.stopFollowingDeletions = accountDeletions.onDeleted((playerId) =>
		{
			this.whileCreating.apply(() =>
			{
				if (this.chat.forgetAuthor(playerId))
				{
					const deleted: ChatAuthorDeletedPayload = { playerId };

					this.broadcast(EditorServerMessageType.ChatAuthorDeleted, deleted);
				}
			});
		});
	}

	/**
	 * Stops following changes, and writes the chat's last new messages
	 */
	async onDispose(): Promise<void>
	{
		editorRooms.release(this);
		this.stopFollowingSessions?.();
		this.stopFollowingWorld?.();
		this.stopFollowingUpdates?.();
		this.stopFollowingStage?.();
		this.stopFollowingAdmins?.();
		this.stopFollowingTwoFactor?.();
		this.stopFollowingDeletions?.();
		await this.saveChat();
	}

	/**
	 * Refuses a browser that isn't logged in before matchmaking makes an editor room for it
	 * (isLoggedInToMatchmake())
	 *
	 * @param _token The client's auth token, unused: the session is in a cookie
	 * @param _options Join options from the client
	 * @param context The matchmaking request's headers, which carry the session cookie
	 * @return Whether the browser is logged in
	 */
	static async onAuth(_token: string, _options: unknown, context: AuthContext): Promise<boolean>
	{
		return(isLoggedInToMatchmake(context));
	}

	/**
	 * Admits a client (admit()), telling it nothing of why that failed (withoutErrorDetails())
	 *
	 * @param client The joining client
	 * @param _options Join options from the client (already used to pick this room)
	 * @param context The connection's request headers, which carry the session cookie
	 * @return The client's identity, stored as client.auth; false to turn the client away
	 */
	async onAuth(client: Client, _options: unknown, context: AuthContext): Promise<EditorIdentity | false>
	{
		return(withoutErrorDetails('Admitting a window to an editor room', ErrorCode.APPLICATION_ERROR, () => this.admit(client, context)));
	}

	/**
	 * Admits only clients whose browser is logged in as a player who may open the universe's editor, and
	 * loads how far that player has read the chat
	 *
	 * @param client The joining client
	 * @param context The connection's request headers, which carry the session cookie
	 * @return The client's identity, stored as client.auth; false to turn the client away
	 */
	private async admit(client: Client, context: AuthContext): Promise<EditorIdentity | false>
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

		if (!admission || admission.twoFactorRequired)
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
			twoFactor: admission.twoFactor,
			role: admission.role
		});
	}

	/**
	 * Lets a client in (join()), telling it nothing of why that failed (withoutErrorDetails())
	 *
	 * @param client The joining client
	 */
	async onJoin(client: EditorClient): Promise<void>
	{
		await withoutErrorDetails('Joining an editor room', ErrorCode.APPLICATION_ERROR, () => this.join(client));
	}

	/**
	 * Lists the window, and its player with the role just found when they have no other window here,
	 * then sends it the chat, with how far its player has read it. A window that may have missed a
	 * change while it joined looks itself up again first (recheckJoining())
	 *
	 * @param client The joining client
	 */
	private async join(client: EditorClient): Promise<void>
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
			}
		}

		connectedSessions.disconnect(client);
		this.invalidMessages.forget(client.sessionId);
		console.log(client.sessionId, 'left the editor of universe', this.universeId, code);
	}

	/**
	 * Finds whether a player is a server admin with 2FA on, whether they have 2FA on and the universe
	 * requires it, and the role they may open the editor with
	 *
	 * @param playerId The player's ID
	 * @return What it found; undefined when they have no role that opens the editor
	 */
	private async findAdmission(playerId: string): Promise<EditorAdmission | undefined>
	{
		const [serverAdmin, twoFactor, universeAccess, universe] = await Promise.all([
			isActiveServerAdmin(playerId),
			hasTwoFactor(playerId),
			findUniverseAccess(this.universeId, playerId),
			findUniverse(this.universeId)
		]);
		const access = editorAccessOf(universeAccess, serverAdmin);

		return((access
			? {
				serverAdmin,
				twoFactor,
				twoFactorRequired: ((universe?.requireTwoFactor ?? false) && !twoFactor),
				role: access.role
			}
			: undefined));
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
	 * when its session has ended, the universe was deleted, its player may no longer open the editor, or
	 * the universe requires 2FA its player doesn't have on. Otherwise it takes the role its player has
	 * now, and loads the universe again when that role, whether its player has 2FA on, the universe's
	 * stage or whether it is disabled changed, since the window may have loaded it before
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

		if (found.admission.twoFactorRequired)
		{
			throw new ServerError(ServerCloseCode.TwoFactorRequired, 'The universe requires 2FA the window\'s player stopped having on while it joined');
		}

		const changed = ((found.admission.role !== identity.role) || (found.admission.twoFactor !== identity.twoFactor) || missed.has('stage') || missed.has('access'));

		identity.serverAdmin = found.admission.serverAdmin;
		identity.twoFactor = found.admission.twoFactor;
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
	 * open the editor; a server admin disabling or enabling the universe has every window load it again,
	 * the universe starting to require 2FA turns away the windows of players without it on, and a change
	 * to whether builders must make their changes in the draft has builders' windows load it again
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

		if (update.kind === 'twoFactorRequirement')
		{
			this.joinChanges.note('twoFactor');

			if (update.required)
			{
				this.turnAway((identity) => !identity.twoFactor, ServerCloseCode.TwoFactorRequired);
			}

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
	 * Tells every window but the one that saved of a save, with what it changed that its player's role
	 * shows (noticeDetails()). A window hears of every save, even one changing nothing it shows, since the
	 * Audit tab lists the saves of both versions
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
				details: noticeDetails(update.details, identityOf(client).role)
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
	 * Follows a player turning 2FA on or off. Turning it off while the universe requires it turns their
	 * windows away, as does the universe failing to be looked up then, rather than let them stay without
	 * it. Otherwise their windows load the universe again, since whether a creator may require 2FA follows
	 * whether they have it on
	 *
	 * @param playerId The player's ID
	 * @param on Whether they have 2FA on now
	 * @return Resolves once their windows have been told, or turned away
	 */
	private async applyTwoFactorChange(playerId: string, on: boolean): Promise<void>
	{
		if (this.windowsOf(playerId).length === 0)
		{
			return;
		}

		// Set before the lookup so that the universe starting to require 2FA meanwhile turns them away
		for (const client of this.windowsOf(playerId))
		{
			identityOf(client).twoFactor = on;
		}

		let required = !on;

		if (!on)
		{
			try
			{
				required = ((await findUniverse(this.universeId))?.requireTwoFactor ?? false);
			}
			catch (error)
			{
				console.error('Could not find whether universe', this.universeId, 'requires 2FA once player', playerId, 'turned it off', error);
			}
		}

		if (required)
		{
			this.turnAway((identity) => (identity.playerId === playerId), ServerCloseCode.TwoFactorRequired);
			return;
		}

		for (const client of this.windowsOf(playerId))
		{
			client.send(EditorServerMessageType.AccessChanged);
		}
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
