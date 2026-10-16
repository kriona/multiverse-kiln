import Phaser from 'phaser';
import { Callbacks } from '@colyseus/sdk';
import { MessageType, PATCH_INTERVAL_MS, PLAYER_RADIUS, ServerMessageType, type MovePayload, type Player, type ZonePayload } from '@multiverse-kiln/shared';

import { MovementKeys } from '../input/MovementKeys';
import type { GameConnection, GameRoom } from '../network/serverConnection';
import { drawGrid } from '../rendering/drawGrid';
import { PositionBuffer } from '../rendering/PositionBuffer';

/**
 * Key the scene is registered under
 */
export const GAME_SCENE_KEY = 'GameScene';

/**
 * How far in the past players are drawn: two patches, so there is normally a snapshot either side
 */
const INTERPOLATION_DELAY_MS = PATCH_INTERVAL_MS * 2;

const OWN_PLAYER_COLOR = 0x4caf50;

const OTHER_PLAYER_COLOR = 0x42a5f5;

/**
 * Gap in pixels between the top of a player and the bottom of their name
 */
const NAME_OFFSET = 4;

/**
 * Data the scene is started with
 */
export interface GameSceneData
{
	/**
	 * The group's joined game room; whoever starts the scene owns the room and leaves it
	 */
	connection: GameConnection;
}

/**
 * A player as drawn on screen
 */
interface RenderedPlayer
{
	shape: Phaser.GameObjects.Arc;
	label: Phaser.GameObjects.Text;
	positions: PositionBuffer;
	stopListening: () => void;
}

/**
 * Draws a group's game room: the zone the player is in, the players the server shows in it, and sends
 * keyboard input. The camera follows the player
 *
 * The server decides where players are. This scene only sends the direction held and draws the
 * positions the server sends back
 */
export class GameScene extends Phaser.Scene
{
	private room!: GameRoom;
	private ownPlayerId!: string;
	private zone!: ZonePayload;
	private grid?: Phaser.GameObjects.Graphics;
	private readonly players = new Map<string, RenderedPlayer>();
	private readonly unbinds: Array<() => void> = [];
	private movementKeys?: MovementKeys;
	private lastSentMove?: MovePayload;

	constructor()
	{
		super(GAME_SCENE_KEY);
	}

	/**
	 * Resets per-run state (runs on every start, unlike the constructor)
	 *
	 * @param data The room to draw
	 */
	init(data: GameSceneData): void
	{
		this.room = data.connection.room;
		this.ownPlayerId = data.connection.playerId;
		this.zone = data.connection.zone;
		this.grid = undefined;
		this.players.clear();
		this.unbinds.length = 0;
		this.movementKeys = undefined;
		this.lastSentMove = undefined;
	}

	/**
	 * Draws the zone, sets up input, and subscribes to the players in the room's state and the zone changes
	 */
	create(): void
	{
		this.grid = drawGrid(this, this.zone.bounds);

		this.unbinds.push(this.room.onMessage(ServerMessageType.Zone, (zone: ZonePayload) =>
		{
			this.enterZone(zone);
		}));

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

			// Captured keys have their default action blocked on the whole page, which would stop them
			// being typed into the lobby's chat
			this.input.keyboard?.removeAllKeys(true);
			this.input.keyboard?.clearCaptures();

			for (const unbind of this.unbinds)
			{
				unbind();
			}

			for (const playerId of [...this.players.keys()])
			{
				this.removePlayer(playerId);
			}
		});

		this.watchPlayers();
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
				player.label.setPosition(position.x, position.y - PLAYER_RADIUS - NAME_OFFSET);
			}
		}
	}

	/**
	 * Adds and removes players as the room's state changes
	 */
	private watchPlayers(): void
	{
		const callbacks = Callbacks.get(this.room);

		// Fires for players already in the room too
		this.unbinds.push(callbacks.onAdd('players', (player, playerId) =>
		{
			const positions = new PositionBuffer(PATCH_INTERVAL_MS);
			const isOwn = (playerId === this.ownPlayerId);
			const shape = this.add.circle(player.x, player.y, PLAYER_RADIUS, (isOwn ? OWN_PLAYER_COLOR : OTHER_PLAYER_COLOR));

			positions.push(performance.now(), player.x, player.y);

			if (isOwn)
			{
				this.cameras.main.startFollow(shape, true);
			}

			this.players.set(playerId, {
				shape,
				label: this.add.text(player.x, player.y - PLAYER_RADIUS - NAME_OFFSET, player.name, {
					fontFamily: 'sans-serif',
					fontSize: '12px',
					color: '#ffffff'
				}).setOrigin(0.5, 1).setDepth(1),
				positions,
				stopListening: callbacks.onChange(player, () =>
				{
					positions.push(performance.now(), player.x, player.y);
				})
			});
		}));

		this.unbinds.push(callbacks.onRemove('players', (_player: Player, playerId: string) =>
		{
			this.removePlayer(playerId);
		}));
	}

	/**
	 * Redraws the scene for a zone the player has just moved to
	 *
	 * The server has already moved the player; their next position is drawn straight away rather than
	 * reached smoothly from where they were in the old zone. Players in the old zone are removed and
	 * those in the new one added through the state, like any other player coming and going
	 *
	 * @param zone The new zone
	 */
	private enterZone(zone: ZonePayload): void
	{
		this.zone = zone;
		this.grid?.destroy();
		this.grid = drawGrid(this, zone.bounds);
		this.players.get(this.ownPlayerId)?.positions.clear();
	}

	/**
	 * Sends the held direction when it differs from the last one sent
	 *
	 * Only the direction goes to the server, never a position: the server moves the player
	 */
	private sendMovement(): void
	{
		if (!this.movementKeys || !this.room.connection.isOpen)
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
	 * Removes a player's shape and name and stops listening to their state
	 *
	 * @param playerId The player's ID
	 */
	private removePlayer(playerId: string): void
	{
		const player = this.players.get(playerId);

		if (!player)
		{
			return;
		}

		player.stopListening();
		player.shape.destroy();
		player.label.destroy();
		this.players.delete(playerId);
	}
}
