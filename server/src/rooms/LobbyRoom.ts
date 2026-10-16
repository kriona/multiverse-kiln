import { matchMaker, Room, type AuthContext, type Client, type CloseCode, type IRoomCache } from 'colyseus';
import { GAME_ROOM_NAME, LobbyMember, LobbyMessageType, LobbyServerMessageType, LobbyState, MessageType, NoticeReason, PATCH_INTERVAL_MS, type ChatHistoryPayload, type ChatMessage, type LobbyJoinOptions, type NoticePayload } from '@multiverse-kiln/shared';

import { findUniverse } from '../db/universeRepo.js';
import { loadZone } from '../db/zoneRepo.js';
import { readBrowserId } from '../http/browserId.js';
import { onlinePlayers } from '../players/onlinePlayers.js';
import { InvalidMessages } from './invalidMessages.js';
import { chatPayload, describeInvalidPayload, movePayload, roomOptions } from './payloads.js';
import { RateLimiter } from './rateLimiter.js';
import { ZoneCache, type ActiveZone } from './zoneCache.js';
import { SIMULATION_TICK_RATE, ZonePlayers } from './zonePlayers.js';

/**
 * What onAuth found out about a client, available afterward as client.auth
 */
interface LobbyIdentity
{
	browserId: string;
	playerId: string;
	name: string;
}

type LobbyClient = Client<{ auth: LobbyIdentity }>;

/**
 * Who a lobby client is
 *
 * @param client A client that has passed onAuth
 * @return Its identity
 */
function identityOf(client: LobbyClient): LobbyIdentity
{
	if (!client.auth)
	{
		throw new Error(`Lobby client ${client.sessionId} has no identity`);
	}

	return(client.auth);
}

/**
 * Chat messages kept for players who join later
 */
export const CHAT_HISTORY_LENGTH = 50;

/**
 * Most chat messages a player may send in CHAT_RATE_WINDOW_MS; more are dropped
 */
const CHAT_RATE_LIMIT = 5;

const CHAT_RATE_WINDOW_MS = 5000;

/**
 * A universe's lobby: its map, its chat, who's here, and creating groups
 *
 * Clients join with the universe's ID (LobbyJoinOptions), and every client asking for the same universe
 * joins the same room (filterBy in app.config.ts). Only logged-in browsers are admitted. Players start
 * in the universe's lobby zone and can walk through its links into other zones (see ZonePlayers)
 */
export class LobbyRoom extends Room<{ state: LobbyState; client: LobbyClient }>
{
	// Colyseus allows unlimited messages by default. A client over the limit is disconnected; clients send
	// Move only when their direction changes, so an honest client stays far below it
	maxMessagesPerSecond = 30;

	patchRate = PATCH_INTERVAL_MS;

	state = new LobbyState();

	private readonly zones = new ZoneCache(loadZone);

	private readonly zonePlayers = new ZonePlayers(this.state.players, this.zones);

	private universeId!: string;

	/**
	 * Where players start
	 */
	private lobbyZone!: ActiveZone;

	/**
	 * The most recent chat messages, oldest first (server-only, not synced)
	 */
	private chatHistory: ChatMessage[] = [];

	private readonly chatLimiter = new RateLimiter(CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_MS);

	private readonly invalidMessages = new InvalidMessages();

	messages = {
		[MessageType.Move]: (client: LobbyClient, payload: unknown) =>
		{
			const result = movePayload.safeParse(payload);

			if (!result.success)
			{
				this.invalidMessages.reject(client, MessageType.Move, describeInvalidPayload(result.error));
				return;
			}

			this.zonePlayers.queueMove(client.sessionId, result.data);
		},

		[MessageType.TakeLink]: (client: LobbyClient) =>
		{
			this.zonePlayers.takeLink(client.sessionId);
		},

		[LobbyMessageType.Chat]: (client: LobbyClient, payload: unknown) =>
		{
			const result = chatPayload.safeParse(payload);

			if (!result.success)
			{
				this.invalidMessages.reject(client, LobbyMessageType.Chat, describeInvalidPayload(result.error));
				return;
			}

			const { playerId, name } = identityOf(client);

			if (!this.chatLimiter.tryTake(playerId))
			{
				this.sendNotice(client, NoticeReason.ChatTooFast);
				return;
			}

			const message: ChatMessage = {
				playerId,
				name,
				text: result.data.text,
				sentAt: Date.now()
			};

			this.chatHistory = [...this.chatHistory, message].slice(-CHAT_HISTORY_LENGTH);
			this.broadcast(LobbyServerMessageType.Chat, message);
		},

		[LobbyMessageType.CreateGroup]: async (client: LobbyClient) =>
		{
			const { browserId } = identityOf(client);

			if (!onlinePlayers.get(browserId))
			{
				return;
			}

			let room: IRoomCache;

			// The new room disposes itself if nobody joins it within its seat reservation time
			try
			{
				room = await matchMaker.createRoom(GAME_ROOM_NAME, { universeId: this.universeId } satisfies LobbyJoinOptions);
			}
			catch (error)
			{
				console.error(client.sessionId, 'could not create a group:', error);
				this.sendNotice(client, NoticeReason.GroupNotCreated);
				return;
			}

			onlinePlayers.setGroup(browserId, room.roomId);
		}
	};

	/**
	 * Loads the universe's lobby zone and starts the simulation loop. Fails for a universe that doesn't
	 * exist or has no lobby zone, which turns away the client asking for it
	 *
	 * @param options The universe, from the first client's LobbyJoinOptions
	 */
	async onCreate(options: unknown): Promise<void>
	{
		const { universeId } = roomOptions.parse(options);
		const universe = await findUniverse(universeId);
		const lobbyZone = ((universe?.lobbyZoneId !== undefined) ? await this.zones.load(universe.lobbyZoneId) : undefined);

		if (!lobbyZone)
		{
			throw new Error(`Universe ${universeId} has no lobby to join`);
		}

		this.universeId = universeId;
		this.lobbyZone = lobbyZone;
		this.setTimestep((deltaTime) => this.zonePlayers.update(deltaTime / 1000), 1000 / SIMULATION_TICK_RATE);
	}

	/**
	 * Admits only clients whose browser is logged in
	 *
	 * @param _client The joining client
	 * @param _options Join options from the client (already used to pick this room)
	 * @param context The connection's request headers, which carry the browser ID cookie
	 * @return The client's identity, stored as client.auth; false to turn the client away
	 */
	onAuth(_client: Client, _options: unknown, context: AuthContext): LobbyIdentity | false
	{
		const browserId = readBrowserId(context.headers.get('cookie'));
		const player = ((browserId !== undefined) ? onlinePlayers.get(browserId) : undefined);

		if ((browserId === undefined) || !player)
		{
			return(false);
		}

		return({
			browserId,
			playerId: player.playerId,
			name: player.name
		});
	}

	/**
	 * Puts the joining client's player in the lobby zone if they are new, lists them as here, and
	 * sends the recent chat
	 *
	 * @param client The joining client
	 */
	onJoin(client: LobbyClient): void
	{
		const { playerId, name } = identityOf(client);

		if (this.zonePlayers.join(client, playerId, name, this.lobbyZone))
		{
			this.state.members.set(playerId, new LobbyMember({ name }));
		}

		const history: ChatHistoryPayload = { messages: this.chatHistory };

		client.send(LobbyServerMessageType.ChatHistory, history);
	}

	/**
	 * Stops the client's player, and removes the player once their last client has left
	 *
	 * @param client The leaving client
	 * @param code WebSocket close code
	 */
	onLeave(client: LobbyClient, code: CloseCode): void
	{
		const left = this.zonePlayers.leave(client);

		this.invalidMessages.forget(client.sessionId);

		if (left?.wasLastClient)
		{
			this.state.members.delete(left.playerId);
			this.chatLimiter.forget(left.playerId);
		}

		console.log(client.sessionId, 'left the lobby of universe', this.universeId, code);
	}

	/**
	 * The player a client controls
	 *
	 * @param sessionId The client's session ID
	 * @return The player's ID in state.players, or undefined when the client isn't in the room
	 */
	getPlayerId(sessionId: string): string | undefined
	{
		return(this.zonePlayers.getPlayerId(sessionId));
	}

	/**
	 * The zone a player is in
	 *
	 * @param playerId The player's ID
	 * @return The zone's ID, or undefined when the player isn't in the room
	 */
	getZoneId(playerId: string): string | undefined
	{
		return(this.zonePlayers.getZoneId(playerId));
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
}
