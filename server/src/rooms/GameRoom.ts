import { Room, type AuthContext, type Client, type CloseCode } from 'colyseus';
import { GameState, GRID_CELL_SIZE, MessageType, PATCH_INTERVAL_MS, Player, ServerCloseCode, ServerMessageType, WORLD_HEIGHT, WORLD_WIDTH, type MovePayload, type WelcomePayload } from '@multiverse-kiln/shared';

import { readBrowserId } from '../http/browserId.js';
import { NO_PRESS, occupiedCells, spawnPosition, stepOnGrid, type DirectionPress, type Grid, type GridStep } from '../logic/movement.js';
import { CellOccupancy } from '../logic/occupancy.js';
import { onlinePlayers, type OnlinePlayerChange } from '../players/onlinePlayers.js';
import { InputQueue } from './inputQueue.js';
import { InvalidMessages } from './invalidMessages.js';
import { describeInvalidPayload, movePayload } from './payloads.js';
import { PlayerSessions } from './playerSessions.js';

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
 * Simulation ticks per second
 */
export const SIMULATION_TICK_RATE = 30;

/**
 * Most Move inputs kept per player between ticks
 */
const MAX_QUEUED_MOVES = 8;

/**
 * The grid players move on, covering the whole world
 *
 * A cell is wider than a player, so a player on any cell center is entirely inside the world
 */
export const worldGrid: Grid = {
	cellSize: GRID_CELL_SIZE,
	columns: WORLD_WIDTH / GRID_CELL_SIZE,
	rows: WORLD_HEIGHT / GRID_CELL_SIZE
};

const standingStill: MovePayload = { x: 0, y: 0 };

/**
 * A group's game room: its players join, send movement input, and the server simulates and syncs their positions
 *
 * The lobby creates the room and decides who is in the group (see OnlinePlayers), which also caps the
 * group at MAX_GROUP_PLAYERS players; the room admits only the group's players. Every window of the
 * same browser controls the same player (see PlayerSessions)
 */
export class GameRoom extends Room<{ state: GameState; client: Client<{ auth: ClientIdentity }> }>
{
	// Colyseus allows unlimited messages by default. A client over the limit is disconnected; clients send
	// Move only when their direction changes, so an honest client stays far below it
	maxMessagesPerSecond = 30;

	patchRate = PATCH_INTERVAL_MS;

	state = new GameState();

	/**
	 * Which player each client controls (server-only, not synced)
	 */
	private readonly playerSessions = new PlayerSessions();

	/**
	 * Move inputs received since the last tick, per player (server-only, not synced)
	 */
	private readonly moveInputs = new InputQueue<MovePayload>(MAX_QUEUED_MOVES);

	/**
	 * The direction each player is holding, from their latest Move (server-only, not synced)
	 */
	private readonly heldDirections = new Map<string, MovePayload>();

	/**
	 * The step each moving player is taking (server-only, not synced)
	 */
	private readonly steps = new Map<string, GridStep>();

	/**
	 * How long each player has held its direction, for the step repeat delay (server-only, not synced)
	 */
	private readonly presses = new Map<string, DirectionPress>();

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

			const playerId = this.playerSessions.getPlayerId(client.sessionId);

			if (playerId !== undefined)
			{
				this.moveInputs.push(playerId, result.data);
			}
		}
	};

	/**
	 * Starts the simulation loop, and starts watching for players leaving the group
	 */
	onCreate(): void
	{
		this.setTimestep((deltaTime) => this.update(deltaTime), 1000 / SIMULATION_TICK_RATE);

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
	 * Gives the joining client its browser's player, adding the player on a free cell if it is new,
	 * and tells the client which player it controls
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
		const isNewPlayer = this.playerSessions.add(client.sessionId, playerId);

		if (isNewPlayer)
		{
			const position = spawnPosition(worldGrid, Math.random, this.currentOccupancy().isFreeFor(playerId));

			// The room holds far fewer players than the grid has cells, so this only guards against a misconfiguration
			if (!position)
			{
				this.playerSessions.remove(client.sessionId);
				throw new Error('No free cell to spawn a player in');
			}

			this.state.players.set(playerId, new Player({ x: position.x, y: position.y, name }));
		}

		const welcome: WelcomePayload = { playerId };

		client.send(ServerMessageType.Welcome, welcome);

		console.log(client.sessionId, 'joined as player', playerId);
	}

	/**
	 * Stops the client's player, and removes the player and their server-only data once their last client has left
	 *
	 * @param client The leaving client
	 * @param code WebSocket close code
	 */
	onLeave(client: Client, code: CloseCode): void
	{
		const left = this.playerSessions.remove(client.sessionId);

		this.invalidMessages.forget(client.sessionId);

		if (left)
		{
			// A window can close while its keys are held, and its last Move may still be queued; the player
			// stops at the end of its current step instead of running on without it
			this.moveInputs.remove(left.playerId);
			this.heldDirections.delete(left.playerId);

			if (left.wasLastClient)
			{
				this.state.players.delete(left.playerId);
				this.steps.delete(left.playerId);
				this.presses.delete(left.playerId);
			}
		}

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
		return(this.playerSessions.getPlayerId(sessionId));
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

		const sessionIds = new Set(this.playerSessions.getSessionIds(before.playerId));

		for (const client of this.clients)
		{
			if (sessionIds.has(client.sessionId))
			{
				client.leave(ServerCloseCode.LeftGroup);
			}
		}
	}

	/**
	 * One simulation tick: applies queued inputs, then moves every player
	 *
	 * @param deltaTime Milliseconds since the previous tick
	 */
	private update(deltaTime: number): void
	{
		const deltaSeconds = deltaTime / 1000;
		const occupancy = this.currentOccupancy();

		// Players move one at a time, each seeing the cells the players before it have just taken or freed.
		// When two want the same cell, the one earlier in the map gets it
		for (const [playerId, player] of this.state.players)
		{
			for (const move of this.moveInputs.drain(playerId))
			{
				this.heldDirections.set(playerId, move);
			}

			const mover = stepOnGrid({ x: player.x, y: player.y, step: this.steps.get(playerId), press: this.presses.get(playerId) ?? NO_PRESS }, this.heldDirections.get(playerId) ?? standingStill, deltaSeconds, worldGrid, occupancy.isFreeFor(playerId));

			player.x = mover.x;
			player.y = mover.y;
			this.presses.set(playerId, mover.press);

			if (mover.step)
			{
				this.steps.set(playerId, mover.step);
			}
			else
			{
				this.steps.delete(playerId);
			}

			occupancy.hold(playerId, occupiedCells(mover, worldGrid));
		}
	}

	/**
	 * Works out which cells every player holds right now
	 *
	 * @return The occupancy of the grid
	 */
	private currentOccupancy(): CellOccupancy
	{
		const occupancy = new CellOccupancy();

		for (const [playerId, player] of this.state.players)
		{
			occupancy.hold(playerId, occupiedCells({ x: player.x, y: player.y, step: this.steps.get(playerId) }, worldGrid));
		}

		return(occupancy);
	}
}
