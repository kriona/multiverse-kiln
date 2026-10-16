import { Room, type AuthContext, type Client, type CloseCode } from 'colyseus';
import { GameState, MessageType, PATCH_INTERVAL_MS, ServerCloseCode } from '@multiverse-kiln/shared';

import { findUniverse } from '../db/universeRepo.js';
import { loadZone } from '../db/zoneRepo.js';
import { readBrowserId } from '../http/browserId.js';
import { onlinePlayers, type OnlinePlayerChange } from '../players/onlinePlayers.js';
import { InvalidMessages } from './invalidMessages.js';
import { describeInvalidPayload, movePayload, roomOptions } from './payloads.js';
import { ZoneCache, type ActiveZone } from './zoneCache.js';
import { SIMULATION_TICK_RATE, ZonePlayers } from './zonePlayers.js';

/**
 * What onAuth found out about a client, available afterward as client.auth
 */
interface ClientIdentity
{
	/**
	 * The player the client controls, from the browser's login
	 */
	playerId: string;

	name: string;
}

/**
 * A group's game room: its players join, send movement input, and the server simulates and syncs their positions
 *
 * A universe's lobby creates the room, with the universe's ID, and decides who is in the group (see
 * OnlinePlayers), which also caps the group at MAX_GROUP_PLAYERS players; the room admits only the
 * group's players. Players start in the universe's starting zone, and each can go through zone links
 * on their own (see ZonePlayers)
 */
export class GameRoom extends Room<{ state: GameState; client: Client<{ auth: ClientIdentity }> }>
{
	// Colyseus allows unlimited messages by default. A client over the limit is disconnected; clients send
	// Move only when their direction changes, so an honest client stays far below it
	maxMessagesPerSecond = 30;

	patchRate = PATCH_INTERVAL_MS;

	state = new GameState();

	private readonly zones = new ZoneCache(loadZone);

	private readonly zonePlayers = new ZonePlayers(this.state.players, this.zones);

	/**
	 * Where new players start
	 */
	private startingZone!: ActiveZone;

	/**
	 * How many invalid messages each client has sent this session (server-only, not synced)
	 */
	private readonly invalidMessages = new InvalidMessages();

	private stopListening?: () => void;

	messages = {
		[MessageType.Move]: (client: Client, payload: unknown) =>
		{
			const result = movePayload.safeParse(payload);

			if (!result.success)
			{
				this.invalidMessages.reject(client, MessageType.Move, describeInvalidPayload(result.error));
				return;
			}

			this.zonePlayers.queueMove(client.sessionId, result.data);
		},

		[MessageType.TakeLink]: (client: Client) =>
		{
			this.zonePlayers.takeLink(client.sessionId);
		}
	};

	/**
	 * Loads the universe's starting zone, starts the simulation loop, and starts watching for players
	 * leaving the group. Fails for a universe that doesn't exist or has no starting zone
	 *
	 * @param options The universe the group plays in
	 */
	async onCreate(options: unknown): Promise<void>
	{
		const { universeId } = roomOptions.parse(options);
		const universe = await findUniverse(universeId);
		const startingZone = ((universe?.startingZoneId !== undefined) ? await this.zones.load(universe.startingZoneId) : undefined);

		if (!startingZone)
		{
			throw new Error(`Universe ${universeId} has no starting zone to play in`);
		}

		this.startingZone = startingZone;
		this.setTimestep((deltaTime) => this.zonePlayers.update(deltaTime / 1000), 1000 / SIMULATION_TICK_RATE);

		this.stopListening = onlinePlayers.onChange((change) =>
		{
			this.onPlayerChange(change);
		});
	}

	/**
	 * Admits a client only when its browser is logged in and its player is in this room's group
	 *
	 * @param _client The joining client
	 * @param _options Join options from the client (unused)
	 * @param context The connection's request headers, which carry the browser ID cookie
	 * @return The client's identity, stored as client.auth; false to turn the client away
	 */
	onAuth(_client: Client, _options: unknown, context: AuthContext): ClientIdentity | false
	{
		const browserId = readBrowserId(context.headers.get('cookie'));
		const player = ((browserId !== undefined) ? onlinePlayers.get(browserId) : undefined);

		if (!player || (player.groupId !== this.roomId))
		{
			return(false);
		}

		return({ playerId: player.playerId, name: player.name });
	}

	/**
	 * Gives the joining client its browser's player, adding the player to the starting zone if it is new
	 *
	 * @param client The joining client
	 */
	onJoin(client: Client<{ auth: ClientIdentity }>): void
	{
		if (!client.auth)
		{
			throw new Error(`Client ${client.sessionId} joined without an identity`);
		}

		const { playerId, name } = client.auth;

		this.zonePlayers.join(client, playerId, name, this.startingZone);

		console.log(client.sessionId, 'joined as player', playerId);
	}

	/**
	 * Stops the client's player, and removes the player once their last client has left
	 *
	 * @param client The leaving client
	 * @param code WebSocket close code
	 */
	onLeave(client: Client, code: CloseCode): void
	{
		this.zonePlayers.leave(client);
		this.invalidMessages.forget(client.sessionId);

		console.log(client.sessionId, 'left', code);
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
	 * Called once the room is empty (or was never joined) and shutting down: the group ends, and
	 * anyone still in it goes back to the lobby
	 */
	onDispose(): void
	{
		this.stopListening?.();
		onlinePlayers.disbandGroup(this.roomId);

		console.log('room', this.roomId, 'disposing');
	}

	/**
	 * Disconnects a player's clients once the player is no longer in this room's group
	 *
	 * @param change What changed about a browser's player
	 */
	private onPlayerChange({ before, after }: OnlinePlayerChange): void
	{
		if (!before || (before.groupId !== this.roomId) || (after?.groupId === this.roomId))
		{
			return;
		}

		for (const client of this.zonePlayers.getClients(before.playerId))
		{
			client.leave(ServerCloseCode.LeftGroup);
		}
	}
}
