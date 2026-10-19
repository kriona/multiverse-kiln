import { Room, type AuthContext, type Client, type CloseCode } from 'colyseus';
import { GameState, MessageType, PATCH_INTERVAL_MS, ServerCloseCode } from '@multiverse-kiln/shared';

import { findUniverse } from '../db/universeRepo.js';
import { loadChunksAt, loadArea } from '../db/areaRepo.js';
import { readBrowserId } from '../http/browserId.js';
import { onlinePlayers, type OnlinePlayerChange } from '../players/onlinePlayers.js';
import { areaChanges } from '../world/areaChanges.js';
import { InvalidMessages } from './invalidMessages.js';
import { describeInvalidPayload, movePayload, roomOptions } from './payloads.js';
import { AreaCache } from './areaCache.js';
import { CHUNK_REFRESH_INTERVAL_MS, SIMULATION_TICK_RATE, AreaPlayers } from './areaPlayers.js';

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
 * group's players. Players start in the universe's starting area, and each can go through area links
 * on their own (see AreaPlayers)
 */
export class GameRoom extends Room<{ state: GameState; client: Client<{ auth: ClientIdentity }> }>
{
	// Colyseus allows unlimited messages by default. A client over the limit is disconnected; clients send
	// Move only when their direction changes, so an honest client stays far below it
	maxMessagesPerSecond = 30;

	patchRate = PATCH_INTERVAL_MS;

	state = new GameState();

	private readonly areas = new AreaCache(loadArea, loadChunksAt);

	/**
	 * Players whose area is deleted go back to the starting area
	 */
	private readonly areaPlayers = new AreaPlayers(this.state.players, this.areas, () => this.startingAreaId);

	/**
	 * Where new players start
	 */
	private startingAreaId!: string;

	/**
	 * How many invalid messages each client has sent this session (server-only, not synced)
	 */
	private readonly invalidMessages = new InvalidMessages();

	private stopListening?: () => void;

	private stopFollowingChanges?: () => void;

	messages = {
		[MessageType.Move]: (client: Client, payload: unknown) =>
		{
			const result = movePayload.safeParse(payload);

			if (!result.success)
			{
				this.invalidMessages.reject(client, MessageType.Move, describeInvalidPayload(result.error));
				return;
			}

			this.areaPlayers.queueMove(client.sessionId, result.data);
		},

		[MessageType.TakeLink]: (client: Client) =>
		{
			this.areaPlayers.takeLink(client.sessionId);
		}
	};

	/**
	 * Loads the universe's starting area, starts the simulation loop and the loading of chunks near
	 * players, and starts watching for players leaving the group and for changes to the world. Fails for
	 * a universe that doesn't exist or has no starting area
	 *
	 * @param options The universe the group plays in
	 */
	async onCreate(options: unknown): Promise<void>
	{
		const { universeId } = roomOptions.parse(options);
		const universe = await findUniverse(universeId);
		const startingArea = ((universe?.startingAreaId !== undefined) ? await this.areas.load(universe.startingAreaId) : undefined);

		if (!startingArea)
		{
			throw new Error(`Universe ${universeId} has no starting area to play in`);
		}

		this.startingAreaId = startingArea.loaded.area.id;
		this.setTimestep((deltaTime) => this.areaPlayers.update(deltaTime / 1000), 1000 / SIMULATION_TICK_RATE);
		this.clock.setInterval(() => this.areaPlayers.refreshChunks(), CHUNK_REFRESH_INTERVAL_MS);

		this.stopListening = onlinePlayers.onChange((change) =>
		{
			this.onPlayerChange(change);
		});

		this.stopFollowingChanges = areaChanges.onChange((change) =>
		{
			this.areaPlayers.applyChange(change).catch((error: unknown) =>
			{
				console.error('Could not apply a world change to room', this.roomId, error);
			});
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
	 * Gives the joining client its browser's player, adding the player to the starting area if it is new
	 *
	 * @param client The joining client
	 */
	async onJoin(client: Client<{ auth: ClientIdentity }>): Promise<void>
	{
		if (!client.auth)
		{
			throw new Error(`Client ${client.sessionId} joined without an identity`);
		}

		const { playerId, name } = client.auth;
		const startingArea = await this.areas.load(this.startingAreaId);

		if (!startingArea)
		{
			throw new Error(`The starting area ${this.startingAreaId} no longer exists`);
		}

		await this.areaPlayers.prepareStart(startingArea);
		this.areaPlayers.join(client, playerId, { name, ghost: false }, this.areas.get(this.startingAreaId) ?? startingArea);

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
		this.areaPlayers.leave(client);
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
		return(this.areaPlayers.getPlayerId(sessionId));
	}

	/**
	 * The area a player is in
	 *
	 * @param playerId The player's ID
	 * @return The area's ID, or undefined when the player isn't in the room
	 */
	getAreaId(playerId: string): string | undefined
	{
		return(this.areaPlayers.getAreaId(playerId));
	}

	/**
	 * Called once the room is empty (or was never joined) and shutting down: the group ends, and
	 * anyone still in it goes back to the lobby
	 */
	onDispose(): void
	{
		this.stopListening?.();
		this.stopFollowingChanges?.();
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

		for (const client of this.areaPlayers.getClients(before.playerId))
		{
			client.leave(ServerCloseCode.LeftGroup);
		}
	}
}
