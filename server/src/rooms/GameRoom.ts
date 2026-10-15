import { Room, type Client, type CloseCode } from 'colyseus';
import { GameState, MessageType, PATCH_INTERVAL_MS, Player, PLAYER_RADIUS, ServerCloseCode, WORLD_HEIGHT, WORLD_WIDTH, type MovePayload } from '@multiverse-kiln/shared';

import { spawnPosition, stepPosition, type Bounds } from '../logic/movement.js';
import { InputQueue } from './inputQueue.js';
import { describeInvalidPayload, movePayload } from './payloads.js';

/**
 * Simulation ticks per second
 */
export const SIMULATION_TICK_RATE = 30;

/**
 * Most Move inputs kept per player between ticks
 */
const MAX_QUEUED_MOVES = 8;

/**
 * Invalid messages a client may send in one session before it is disconnected
 *
 * An honest client never sends one, so this only tolerates a few from a buggy client before giving up.
 * It also caps how many warnings one session can log
 */
const MAX_INVALID_MESSAGES = 10;

// Where a player's center can be, so the whole player stays inside the world
const playerBounds: Bounds = {
	minX: PLAYER_RADIUS,
	minY: PLAYER_RADIUS,
	maxX: WORLD_WIDTH - PLAYER_RADIUS,
	maxY: WORLD_HEIGHT - PLAYER_RADIUS
};

const standingStill: MovePayload = { x: 0, y: 0 };

/**
 * The main game room: players join, send movement input, and the server simulates and syncs their positions
 */
export class GameRoom extends Room<{ state: GameState }>
{
	maxClients = 4;

	// Colyseus allows unlimited messages by default. A client over the limit is disconnected; clients send
	// Move only when their direction changes, so an honest client stays far below it
	maxMessagesPerSecond = 30;

	patchRate = PATCH_INTERVAL_MS;

	state = new GameState();

	/**
	 * Move inputs received since the last tick (server-only, not synced)
	 */
	private readonly moveInputs = new InputQueue<MovePayload>(MAX_QUEUED_MOVES);

	/**
	 * The direction each player is holding, from their latest Move (server-only, not synced)
	 */
	private readonly heldDirections = new Map<string, MovePayload>();

	/**
	 * How many invalid messages each client has sent this session (server-only, not synced)
	 */
	private readonly invalidMessageCounts = new Map<string, number>();

	messages = {
		[MessageType.Move]: (client: Client, payload: unknown) =>
		{
			const result = movePayload.safeParse(payload);

			if (!result.success)
			{
				this.rejectInvalidMessage(client, MessageType.Move, describeInvalidPayload(result.error));
				return;
			}

			this.moveInputs.push(client.sessionId, result.data);
		}
	};

	/**
	 * Starts the simulation loop
	 */
	onCreate(): void
	{
		this.setTimestep((deltaTime) => this.update(deltaTime), 1000 / SIMULATION_TICK_RATE);
	}

	/**
	 * Adds the joining player at a spawn position
	 *
	 * @param client The joining client
	 */
	onJoin(client: Client): void
	{
		const position = spawnPosition(playerBounds, Math.random);

		this.state.players.set(client.sessionId, new Player({ x: position.x, y: position.y }));

		console.log(client.sessionId, 'joined');
	}

	/**
	 * Removes the player and their server-only data
	 *
	 * @param client The leaving client
	 * @param code WebSocket close code
	 */
	onLeave(client: Client, code: CloseCode): void
	{
		this.state.players.delete(client.sessionId);
		this.moveInputs.remove(client.sessionId);
		this.heldDirections.delete(client.sessionId);
		this.invalidMessageCounts.delete(client.sessionId);

		console.log(client.sessionId, 'left', code);
	}

	/**
	 * Called once the room is empty and shutting down
	 */
	onDispose(): void
	{
		console.log('room', this.roomId, 'disposing');
	}

	/**
	 * Ignores a message that failed validation, and disconnects the client once it has sent too many
	 *
	 * @param client The client that sent the message
	 * @param type Type of the message
	 * @param reason Why it failed validation (must not include the payload)
	 */
	private rejectInvalidMessage(client: Client, type: MessageType, reason: string): void
	{
		const count = (this.invalidMessageCounts.get(client.sessionId) ?? 0) + 1;

		this.invalidMessageCounts.set(client.sessionId, count);

		console.warn(client.sessionId, `sent an invalid ${type} message (${count} of ${MAX_INVALID_MESSAGES}), ignored:`, reason);

		if (count >= MAX_INVALID_MESSAGES)
		{
			console.warn(client.sessionId, 'disconnected for sending too many invalid messages');
			client.leave(ServerCloseCode.TooManyInvalidMessages);
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

		for (const [sessionId, player] of this.state.players)
		{
			for (const move of this.moveInputs.drain(sessionId))
			{
				this.heldDirections.set(sessionId, move);
			}

			const position = stepPosition(player, this.heldDirections.get(sessionId) ?? standingStill, deltaSeconds, playerBounds);

			player.x = position.x;
			player.y = position.y;
		}
	}
}
