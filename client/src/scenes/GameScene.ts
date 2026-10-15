import Phaser from 'phaser';
import { Callbacks, CloseCode } from '@colyseus/sdk';
import { MessageType, PATCH_INTERVAL_MS, PLAYER_RADIUS, ServerCloseCode, type MovePayload, type Player } from '@multiverse-kiln/shared';

import { MovementKeys } from '../input/MovementKeys';
import { joinGameRoom, type GameRoom } from '../network/serverConnection';
import { PositionBuffer } from '../rendering/PositionBuffer';

/**
 * How far in the past players are drawn: two patches, so there is normally a snapshot either side
 */
const INTERPOLATION_DELAY_MS = PATCH_INTERVAL_MS * 2;

const OWN_PLAYER_COLOR = 0x4caf50;

const OTHER_PLAYER_COLOR = 0x42a5f5;

/**
 * A player as drawn on screen
 */
interface RenderedPlayer
{
	shape: Phaser.GameObjects.Arc;
	positions: PositionBuffer;
	stopListening: () => void;
}

/**
 * The main scene: joins the game room, draws every player from the synced state and sends keyboard input
 *
 * The server decides where players are. This scene only sends the direction held and draws the
 * positions the server sends back
 */
export class GameScene extends Phaser.Scene
{
	private room?: GameRoom;
	private readonly players = new Map<string, RenderedPlayer>();
	private movementKeys?: MovementKeys;
	private lastSentMove?: MovePayload;
	private statusText!: Phaser.GameObjects.Text;

	constructor()
	{
		super('GameScene');
	}

	/**
	 * Resets per-run state (runs on every start, unlike the constructor)
	 */
	init(): void
	{
		this.room = undefined;
		this.players.clear();
		this.movementKeys = undefined;
		this.lastSentMove = undefined;
	}

	/**
	 * Sets up input and the status line, then connects
	 */
	create(): void
	{
		const { width } = this.scale;

		this.statusText = this.add.text(width / 2, 24, '', {
			fontFamily: 'sans-serif',
			fontSize: '18px',
			color: '#ffffff'
		}).setOrigin(0.5, 0).setDepth(1);

		if (this.input.keyboard)
		{
			this.movementKeys = new MovementKeys(this.input.keyboard);
		}

		this.game.events.on(Phaser.Core.Events.BLUR, this.stopMoving);
		this.game.events.on(Phaser.Core.Events.HIDDEN, this.stopMoving);

		this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
		{
			this.game.events.off(Phaser.Core.Events.BLUR, this.stopMoving);
			this.game.events.off(Phaser.Core.Events.HIDDEN, this.stopMoving);
			void this.room?.leave();
		});

		void this.connect();
	}

	/**
	 * Sends input when it changes, then moves every player to its interpolated position
	 */
	update(): void
	{
		this.sendMovement();

		const renderTime = performance.now() - INTERPOLATION_DELAY_MS;

		for (const player of this.players.values())
		{
			const position = player.positions.sample(renderTime);

			if (position)
			{
				player.shape.setPosition(position.x, position.y);
			}
		}
	}

	/**
	 * Joins the game room and subscribes to the players in its state
	 */
	private async connect(): Promise<void>
	{
		this.setStatus('Connecting...');

		let room: GameRoom;

		try
		{
			room = await joinGameRoom();
		}
		catch (error)
		{
			console.error('Could not join the game room:', error);
			this.setStatus('Could not connect to the server. Reload to try again.');
			return;
		}

		this.room = room;
		this.setStatus('');

		const callbacks = Callbacks.get(room);

		// Fires for players already in the room too
		callbacks.onAdd('players', (player, sessionId) =>
		{
			const positions = new PositionBuffer(PATCH_INTERVAL_MS);
			const color = ((sessionId === room.sessionId) ? OWN_PLAYER_COLOR : OTHER_PLAYER_COLOR);

			positions.push(performance.now(), player.x, player.y);

			this.players.set(sessionId, {
				shape: this.add.circle(player.x, player.y, PLAYER_RADIUS, color),
				positions,
				stopListening: callbacks.onChange(player, () =>
				{
					positions.push(performance.now(), player.x, player.y);
				})
			});
		});

		callbacks.onRemove('players', (_player: Player, sessionId: string) =>
		{
			this.removePlayer(sessionId);
		});

		room.onLeave((code: number) =>
		{
			for (const sessionId of [...this.players.keys()])
			{
				this.removePlayer(sessionId);
			}

			this.room = undefined;
			this.setStatus(describeLeave(code));
		});
	}

	/**
	 * Sends the held direction when it differs from the last one sent
	 *
	 * Only the direction goes to the server, never a position: the server moves the player
	 */
	private sendMovement(): void
	{
		if (!this.room || !this.movementKeys)
		{
			return;
		}

		const move = this.movementKeys.read();

		if (this.lastSentMove && (move.x === this.lastSentMove.x) && (move.y === this.lastSentMove.y))
		{
			return;
		}

		this.room.send(MessageType.Move, move);
		this.lastSentMove = move;
	}

	/**
	 * Releases held keys and tells the server the player has stopped
	 *
	 * Runs when the window loses focus or the page is hidden. The browser stops sending key events then,
	 * and a hidden page stops running frames, so update() wouldn't send the stop itself; without this the
	 * server would keep moving the player in the last direction sent
	 */
	private readonly stopMoving = (): void =>
	{
		this.movementKeys?.release();
		this.sendMovement();
	};

	/**
	 * Removes a player's shape and stops listening to their state
	 *
	 * @param sessionId The player's session ID
	 */
	private removePlayer(sessionId: string): void
	{
		const player = this.players.get(sessionId);

		if (!player)
		{
			return;
		}

		player.stopListening();
		player.shape.destroy();
		this.players.delete(sessionId);
	}

	/**
	 * Shows a message at the top of the screen
	 *
	 * @param message Text to show; empty to hide it
	 */
	private setStatus(message: string): void
	{
		this.statusText.setText(message);
	}
}

/**
 * Explains why the client left the room
 *
 * @param code WebSocket close code
 * @return Message for the status line; empty when the client left on purpose
 */
function describeLeave(code: number): string
{
	if (code === CloseCode.CONSENTED)
	{
		return('');
	}

	if ((code as ServerCloseCode) === ServerCloseCode.TooManyInvalidMessages)
	{
		return('Disconnected: the server rejected too many invalid messages. Reload to rejoin.');
	}

	return(`Disconnected from the server (code ${code}). Reload to rejoin.`);
}
