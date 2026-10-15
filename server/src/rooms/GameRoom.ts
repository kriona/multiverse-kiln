import { generateId, Room, type AuthContext, type Client, type CloseCode } from 'colyseus';
import { GameState, MessageType, PATCH_INTERVAL_MS, Player, PLAYER_RADIUS, ServerCloseCode, ServerMessageType, WORLD_HEIGHT, WORLD_WIDTH, type MovePayload, type WelcomePayload } from '@multiverse-kiln/shared';

import { readBrowserId } from '../http/browserId.js';
import { spawnPosition, stepPosition, type Bounds } from '../logic/movement.js';
import { InputQueue } from './inputQueue.js';
import { describeInvalidPayload, movePayload } from './payloads.js';
import { PlayerSessions } from './playerSessions.js';

/**
 * What onAuth found out about a client, available afterward as client.auth
 */
interface ClientIdentity
{
	/**
	 * The client's browser ID, or undefined when it sent no valid browser ID cookie
	 */
	browserId: string | undefined;
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
 *
 * Every window of the same browser controls the same player (see PlayerSessions)
 */
export class GameRoom extends Room<{ state: GameState; client: Client<{ auth: ClientIdentity }> }>
{
	// Counts windows, not players: several windows of one browser each take a place
	maxClients = 4;

	// Colyseus allows unlimited messages by default. A client over the limit is disconnected; clients send
	// Move only when their direction changes, so an honest client stays far below it
	maxMessagesPerSecond = 30;

	patchRate = PATCH_INTERVAL_MS;

	state = new GameState();

	/**
	 * Which player each client controls (server-only, not synced)
	 */
	private readonly playerSessions = new PlayerSessions(() => generateId());

	/**
	 * Move inputs received since the last tick, per player (server-only, not synced)
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

			const playerId = this.playerSessions.getPlayerId(client.sessionId);

			if (playerId !== undefined)
			{
				this.moveInputs.push(playerId, result.data);
			}
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
	 * Reads the browser ID cookie the client sent with its WebSocket connection
	 *
	 * There are no logins yet, so every client is allowed in; one without a valid browser ID gets a player of its own
	 *
	 * @param _client The joining client
	 * @param _options Join options from the client (unused)
	 * @param context The connection's request headers
	 * @return The client's identity, stored as client.auth
	 */
	onAuth(_client: Client, _options: unknown, context: AuthContext): ClientIdentity
	{
		return({ browserId: readBrowserId(context.headers.get('cookie')) });
	}

	/**
	 * Gives the joining client its browser's player, adding the player at a spawn position if it is new,
	 * and tells the client which player it controls
	 *
	 * @param client The joining client
	 */
	onJoin(client: Client<{ auth: ClientIdentity }>): void
	{
		const { playerId, isNewPlayer } = this.playerSessions.add(client.sessionId, client.auth?.browserId);

		if (isNewPlayer)
		{
			const position = spawnPosition(playerBounds, Math.random);

			this.state.players.set(playerId, new Player({ x: position.x, y: position.y }));
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

		this.invalidMessageCounts.delete(client.sessionId);

		if (left)
		{
			// A window can close while its keys are held, and its last Move may still be queued; stopping keeps
			// the player from running on without it
			this.moveInputs.remove(left.playerId);
			this.heldDirections.delete(left.playerId);

			if (left.wasLastClient)
			{
				this.state.players.delete(left.playerId);
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

		for (const [playerId, player] of this.state.players)
		{
			for (const move of this.moveInputs.drain(playerId))
			{
				this.heldDirections.set(playerId, move);
			}

			const position = stepPosition(player, this.heldDirections.get(playerId) ?? standingStill, deltaSeconds, playerBounds);

			player.x = position.x;
			player.y = position.y;
		}
	}
}
