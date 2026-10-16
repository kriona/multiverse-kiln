import { matchMaker, Room, type AuthContext, type Client, type CloseCode, type IRoomCache } from 'colyseus';
import { GAME_ROOM_NAME, MAX_GROUP_PLAYERS, NoticeReason, SessionMessageType, SessionServerMessageType, type AccountPayload, type NoticePayload } from '@multiverse-kiln/shared';

import { loadOrCreatePlayerByName, type PlayerProfile } from '../db/playerRepo.js';
import { readBrowserId } from '../http/browserId.js';
import { onlinePlayers, type OnlinePlayerChange, type OnlinePlayerRecord } from '../players/onlinePlayers.js';
import { InvalidMessages } from './invalidMessages.js';
import { describeInvalidPayload, joinGroupPayload, loginPayload } from './payloads.js';

/**
 * What onAuth found out about a client, available afterward as client.auth
 */
interface SessionIdentity
{
	browserId: string;
}

type SessionClient = Client<{ auth: SessionIdentity }>;

/**
 * The browser a session client belongs to
 *
 * @param client A client that has passed onAuth
 * @return Its browser ID
 */
function browserIdOf(client: SessionClient): string
{
	if (!client.auth)
	{
		throw new Error(`Session client ${client.sessionId} has no identity`);
	}

	return(client.auth.browserId);
}

/**
 * The session: where windows log in, learn who their player is, and join and leave groups
 *
 * There is one session room, which every window joins as soon as it loads and stays in until it
 * closes, wherever its player is: it is how the server tells all of a browser's windows that the
 * player has logged in or changed group. A browser is logged out once its last window has left
 */
export class SessionRoom extends Room<{ client: SessionClient }>
{
	autoDispose = false;

	// Clients send a message only when the player does something, so an honest client stays far below this
	maxMessagesPerSecond = 10;

	/**
	 * The session room that is open, if any; there is only ever one
	 */
	private static current: SessionRoom | undefined;

	/**
	 * The clients of each browser in the room (server-only)
	 */
	private readonly windows = new Map<string, Set<SessionClient>>();

	private readonly invalidMessages = new InvalidMessages();

	private stopListening?: () => void;

	messages = {
		// Logging in is when a player's account is loaded, so this is the room's one database call
		[SessionMessageType.Login]: async (client: SessionClient, payload: unknown) =>
		{
			const result = loginPayload.safeParse(payload);

			if (!result.success)
			{
				this.invalidMessages.reject(client, SessionMessageType.Login, describeInvalidPayload(result.error));
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

		[SessionMessageType.JoinGroup]: async (client: SessionClient, payload: unknown) =>
		{
			const result = joinGroupPayload.safeParse(payload);

			if (!result.success)
			{
				this.invalidMessages.reject(client, SessionMessageType.JoinGroup, describeInvalidPayload(result.error));
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

		[SessionMessageType.LeaveGroup]: (client: SessionClient) =>
		{
			onlinePlayers.setGroup(browserIdOf(client), undefined);
		}
	};

	/**
	 * Makes this the one session room
	 */
	onCreate(): void
	{
		if (SessionRoom.current)
		{
			throw new Error('The session room already exists');
		}

		SessionRoom.current = this;

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
	onAuth(_client: Client, _options: unknown, context: AuthContext): SessionIdentity | false
	{
		const browserId = readBrowserId(context.headers.get('cookie'));

		return(((browserId !== undefined) ? { browserId } : false));
	}

	/**
	 * Records the window, and tells it who its player is
	 *
	 * @param client The joining client
	 */
	onJoin(client: SessionClient): void
	{
		const browserId = browserIdOf(client);
		let clients = this.windows.get(browserId);

		if (!clients)
		{
			clients = new Set();
			this.windows.set(browserId, clients);
		}

		clients.add(client);
		this.sendAccount(client, onlinePlayers.get(browserId));
	}

	/**
	 * Forgets the window, and logs its browser out once it has no windows left
	 *
	 * @param client The leaving client
	 * @param code WebSocket close code
	 */
	onLeave(client: SessionClient, code: CloseCode): void
	{
		const browserId = browserIdOf(client);
		const clients = this.windows.get(browserId);

		this.invalidMessages.forget(client.sessionId);
		clients?.delete(client);

		if (clients?.size === 0)
		{
			this.windows.delete(browserId);
			onlinePlayers.logOut(browserId);
		}

		console.log(client.sessionId, 'left the session', code);
	}

	/**
	 * Stops following the online players
	 */
	onDispose(): void
	{
		this.stopListening?.();

		if (SessionRoom.current === this)
		{
			SessionRoom.current = undefined;
		}
	}

	/**
	 * Tells the browser's windows about their player
	 *
	 * @param change What changed
	 */
	private onPlayerChange({ browserId, after }: OnlinePlayerChange): void
	{
		for (const client of this.windows.get(browserId) ?? [])
		{
			this.sendAccount(client, after);
		}
	}

	/**
	 * Tells a window who its player is
	 *
	 * @param client The window
	 * @param player The browser's player, or undefined when it isn't logged in
	 */
	private sendAccount(client: SessionClient, player: OnlinePlayerRecord | undefined): void
	{
		const account: AccountPayload = {
			player: (player ? {
				playerId: player.playerId,
				name: player.name,
				groupId: player.groupId ?? null
			} : null)
		};

		client.send(SessionServerMessageType.Account, account);
	}

	/**
	 * Tells a window that something its player asked for didn't happen
	 *
	 * @param client The window
	 * @param reason Why
	 */
	private sendNotice(client: SessionClient, reason: NoticeReason): void
	{
		const notice: NoticePayload = { reason };

		client.send(SessionServerMessageType.Notice, notice);
	}

	/**
	 * Sends a notice to a window that may have left while its request was waiting on the database
	 *
	 * @param client The window
	 * @param reason Why
	 */
	private sendNoticeIfConnected(client: SessionClient, reason: NoticeReason): void
	{
		if (this.windows.get(browserIdOf(client))?.has(client))
		{
			this.sendNotice(client, reason);
		}
	}
}
