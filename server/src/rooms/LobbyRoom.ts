import { matchMaker, Room, type AuthContext, type Client, type CloseCode, type IRoomCache } from 'colyseus';
import { StateView } from '@colyseus/schema';
import { GAME_ROOM_NAME, LobbyMessageType, LobbyServerMessageType, LobbyState, MAX_GROUP_PLAYERS, NoticeReason, OnlinePlayer, type AccountPayload, type ChatHistoryPayload, type ChatMessage, type NoticePayload } from '@multiverse-kiln/shared';

import { loadOrCreatePlayerByName, type PlayerProfile } from '../db/playerRepo.js';
import { readBrowserId } from '../http/browserId.js';
import { onlinePlayers, type OnlinePlayerChange, type OnlinePlayerRecord } from '../players/onlinePlayers.js';
import { InvalidMessages } from './invalidMessages.js';
import { chatPayload, describeInvalidPayload, joinGroupPayload, loginPayload } from './payloads.js';
import { RateLimiter } from './rateLimiter.js';

/**
 * What onAuth found out about a client, available afterward as client.auth
 */
interface LobbyIdentity
{
	browserId: string;
}

type LobbyClient = Client<{ auth: LobbyIdentity }>;

/**
 * The browser a lobby client belongs to
 *
 * @param client A client that has passed onAuth
 * @return Its browser ID
 */
function browserIdOf(client: LobbyClient): string
{
	if (!client.auth)
	{
		throw new Error(`Lobby client ${client.sessionId} has no identity`);
	}

	return(client.auth.browserId);
}

/**
 * Chat messages kept for players who log in later
 */
export const CHAT_HISTORY_LENGTH = 50;

/**
 * Most chat messages a player may send in CHAT_RATE_WINDOW_MS; more are dropped
 */
const CHAT_RATE_LIMIT = 5;

const CHAT_RATE_WINDOW_MS = 5000;

/**
 * The lobby: where windows log in, chat, see who's online, and create and join groups
 *
 * There is one lobby, which every window joins as soon as it loads and stays in until it closes, even
 * while its player is in a group: it is how the server tells all of a browser's windows that the
 * player has logged in or changed group. A browser is logged out once its last window has left
 */
export class LobbyRoom extends Room<{ state: LobbyState; client: LobbyClient }>
{
	autoDispose = false;

	// Clients send a message only when the player does something, so an honest client stays far below this
	maxMessagesPerSecond = 10;

	state = new LobbyState();

	/**
	 * The lobby that is open, if any; there is only ever one
	 */
	private static current: LobbyRoom | undefined;

	/**
	 * The clients of each browser in the lobby (server-only, not synced)
	 */
	private readonly windows = new Map<string, Set<LobbyClient>>();

	/**
	 * The most recent chat messages, oldest first (server-only, not synced)
	 */
	private chatHistory: ChatMessage[] = [];

	private readonly chatLimiter = new RateLimiter(CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_MS);

	private readonly invalidMessages = new InvalidMessages();

	private stopListening?: () => void;

	messages = {
		// Logging in is when a player's account is loaded, so this is the lobby's one database call
		[LobbyMessageType.Login]: async (client: LobbyClient, payload: unknown) =>
		{
			const result = loginPayload.safeParse(payload);

			if (!result.success)
			{
				this.invalidMessages.reject(client, LobbyMessageType.Login, describeInvalidPayload(result.error));
				return;
			}

			const browserId = browserIdOf(client);

			if (onlinePlayers.get(browserId))
			{
				return;
			}

			let profile: PlayerProfile;

			try
			{
				profile = await loadOrCreatePlayerByName(result.data.name);
			}
			catch (error)
			{
				console.error(client.sessionId, 'could not log in:', error);
				this.sendNoticeIfConnected(client, NoticeReason.LoginFailed);
				return;
			}

			// Every window of the browser may have closed while the player was loading, and nothing
			// would log the browser out again
			if (!this.windows.has(browserId))
			{
				return;
			}

			if (!onlinePlayers.logIn(browserId, profile.id, profile.displayName))
			{
				this.sendNoticeIfConnected(client, NoticeReason.NameInUse);
			}
		},

		[LobbyMessageType.Chat]: (client: LobbyClient, payload: unknown) =>
		{
			const result = chatPayload.safeParse(payload);

			if (!result.success)
			{
				this.invalidMessages.reject(client, LobbyMessageType.Chat, describeInvalidPayload(result.error));
				return;
			}

			const player = onlinePlayers.get(browserIdOf(client));

			if (!player)
			{
				return;
			}

			if (!this.chatLimiter.tryTake(player.playerId))
			{
				this.sendNotice(client, NoticeReason.ChatTooFast);
				return;
			}

			const message: ChatMessage = {
				playerId: player.playerId,
				name: player.name,
				text: result.data.text,
				sentAt: Date.now()
			};

			this.chatHistory = [...this.chatHistory, message].slice(-CHAT_HISTORY_LENGTH);

			for (const loggedInClient of this.loggedInClients())
			{
				loggedInClient.send(LobbyServerMessageType.Chat, message);
			}
		},

		[LobbyMessageType.CreateGroup]: async (client: LobbyClient) =>
		{
			const browserId = browserIdOf(client);

			if (!onlinePlayers.get(browserId))
			{
				return;
			}

			let room: IRoomCache;

			// The new room disposes itself if nobody joins it within its seat reservation time
			try
			{
				room = await matchMaker.createRoom(GAME_ROOM_NAME, {});
			}
			catch (error)
			{
				console.error(client.sessionId, 'could not create a group:', error);
				return;
			}

			onlinePlayers.setGroup(browserId, room.roomId);
		},

		[LobbyMessageType.JoinGroup]: async (client: LobbyClient, payload: unknown) =>
		{
			const result = joinGroupPayload.safeParse(payload);

			if (!result.success)
			{
				this.invalidMessages.reject(client, LobbyMessageType.JoinGroup, describeInvalidPayload(result.error));
				return;
			}

			const { groupId } = result.data;
			const browserId = browserIdOf(client);
			const player = onlinePlayers.get(browserId);

			if (!player || (player.groupId === groupId))
			{
				return;
			}

			const room = await matchMaker.getRoomById(groupId) as IRoomCache | undefined;

			if (room?.name !== GAME_ROOM_NAME)
			{
				this.sendNotice(client, NoticeReason.GroupNotFound);
				return;
			}

			if (onlinePlayers.countInGroup(groupId) >= MAX_GROUP_PLAYERS)
			{
				this.sendNotice(client, NoticeReason.GroupFull);
				return;
			}

			onlinePlayers.setGroup(browserId, groupId);
		},

		[LobbyMessageType.LeaveGroup]: (client: LobbyClient) =>
		{
			onlinePlayers.setGroup(browserIdOf(client), undefined);
		}
	};

	/**
	 * Makes this the one lobby, and fills the online list from the players already logged in
	 */
	onCreate(): void
	{
		if (LobbyRoom.current)
		{
			throw new Error('The lobby already exists');
		}

		LobbyRoom.current = this;

		for (const player of onlinePlayers.all().values())
		{
			this.state.players.set(player.playerId, new OnlinePlayer({ name: player.name }));
		}

		this.stopListening = onlinePlayers.onChange((change) =>
		{
			this.onPlayerChange(change);
		});
	}

	/**
	 * Admits only clients with a valid browser ID cookie, since a browser is what logs in
	 *
	 * @param _client The joining client
	 * @param _options Join options from the client (unused)
	 * @param context The connection's request headers
	 * @return The client's identity, stored as client.auth; false to turn the client away
	 */
	onAuth(_client: Client, _options: unknown, context: AuthContext): LobbyIdentity | false
	{
		const browserId = readBrowserId(context.headers.get('cookie'));

		return(((browserId !== undefined) ? { browserId } : false));
	}

	/**
	 * Records the window, and tells it who its player is
	 *
	 * @param client The joining client
	 */
	onJoin(client: LobbyClient): void
	{
		const browserId = browserIdOf(client);
		let clients = this.windows.get(browserId);

		if (!clients)
		{
			clients = new Set();
			this.windows.set(browserId, clients);
		}

		clients.add(client);
		client.view = new StateView();

		const player = onlinePlayers.get(browserId);

		this.sendAccount(client, player);

		if (player)
		{
			this.showLobbyTo(client);
		}
	}

	/**
	 * Forgets the window, and logs its browser out once it has no windows left
	 *
	 * @param client The leaving client
	 * @param code WebSocket close code
	 */
	onLeave(client: LobbyClient, code: CloseCode): void
	{
		const browserId = browserIdOf(client);
		const clients = this.windows.get(browserId);

		this.invalidMessages.forget(client.sessionId);
		clients?.delete(client);

		if (clients?.size === 0)
		{
			this.windows.delete(browserId);

			const player = onlinePlayers.get(browserId);

			if (player)
			{
				this.chatLimiter.forget(player.playerId);
			}

			onlinePlayers.logOut(browserId);
		}

		console.log(client.sessionId, 'left the lobby', code);
	}

	/**
	 * Stops following the online players
	 */
	onDispose(): void
	{
		this.stopListening?.();

		if (LobbyRoom.current === this)
		{
			LobbyRoom.current = undefined;
		}
	}

	/**
	 * Updates the online list, and tells the browser's windows about their player
	 *
	 * @param change What changed
	 */
	private onPlayerChange({ browserId, before, after }: OnlinePlayerChange): void
	{
		if (!before && after)
		{
			this.state.players.set(after.playerId, new OnlinePlayer({ name: after.name }));
		}
		else if (before && !after)
		{
			this.state.players.delete(before.playerId);
		}

		for (const client of this.windows.get(browserId) ?? [])
		{
			this.sendAccount(client, after);

			if (!before && after)
			{
				this.showLobbyTo(client);
			}
		}
	}

	/**
	 * Lets a logged-in window see the online list, and sends it the recent chat
	 *
	 * @param client The window
	 */
	private showLobbyTo(client: LobbyClient): void
	{
		const history: ChatHistoryPayload = { messages: this.chatHistory };

		client.view?.subscribe(this.state.players);
		client.send(LobbyServerMessageType.ChatHistory, history);
	}

	/**
	 * Tells a window who its player is
	 *
	 * @param client The window
	 * @param player The browser's player, or undefined when it isn't logged in
	 */
	private sendAccount(client: LobbyClient, player: OnlinePlayerRecord | undefined): void
	{
		const account: AccountPayload = {
			player: (player ? { playerId: player.playerId, name: player.name, groupId: player.groupId ?? null } : null)
		};

		client.send(LobbyServerMessageType.Account, account);
	}

	/**
	 * Tells a window that something its player asked for didn't happen
	 *
	 * @param client The window
	 * @param reason Why
	 */
	private sendNotice(client: LobbyClient, reason: NoticeReason): void
	{
		const notice: NoticePayload = { reason };

		client.send(LobbyServerMessageType.Notice, notice);
	}

	/**
	 * Sends a notice to a window that may have left while its request was waiting on the database
	 *
	 * @param client The window
	 * @param reason Why
	 */
	private sendNoticeIfConnected(client: LobbyClient, reason: NoticeReason): void
	{
		if (this.windows.get(browserIdOf(client))?.has(client))
		{
			this.sendNotice(client, reason);
		}
	}

	/**
	 * The windows whose browser is logged in
	 *
	 * @return The clients
	 */
	private *loggedInClients(): Generator<LobbyClient>
	{
		for (const [browserId, clients] of this.windows)
		{
			if (onlinePlayers.get(browserId))
			{
				yield* clients;
			}
		}
	}
}
