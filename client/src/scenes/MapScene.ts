import Phaser from 'phaser';
import { Callbacks } from '@colyseus/sdk';
import { areaLight, cellIndexInChunk, chunkCoordinate, chunkKey, createVisionMap, GameServerMessageType, GRID_CELL_SIZE, isInBounds, MessageType, nearestCopy, partOfDay, PATCH_INTERVAL_MS, PLAYER_RADIUS, positiveModulo, secondOfDay, ServerMessageType, tileIdAt, UNSEEN_CELL, VIEW_COLUMNS, VIEW_HEIGHT, VIEW_ROWS, VIEW_WIDTH, visibleCells, visionBudget, visionKey, type CellsSeenPayload, type CellValue, type ChunksPayload, type MovePayload, type Player, type AreaPayload, type VisionMap } from '@multiverse-kiln/shared';

import { MovementKeys } from '../input/MovementKeys';
import { t } from '../localization';
import type { GameRoom, MapConnection, MapRoom } from '../network/serverConnection';
import { PositionBuffer, type Point } from '../rendering/PositionBuffer';
import { AreaRenderer } from '../rendering/AreaRenderer';
import { isTextEntry } from '../ui/dom';
import { MapAnnouncer, type SeenPlayer } from '../ui/MapAnnouncer';
import { addKeyHelp, addShortcut } from '../ui/shortcuts';
import { tileName } from '../ui/tileNames';

/**
 * Key the scene is registered under
 */
export const MAP_SCENE_KEY = 'MapScene';

/**
 * How far in the past players are drawn: two patches, so there is normally a snapshot either side
 */
const INTERPOLATION_DELAY_MS = PATCH_INTERVAL_MS * 2;

const OWN_PLAYER_COLOR = 0x4caf50;

const OTHER_PLAYER_COLOR = 0x42a5f5;

/**
 * Players are outlined so they stand out on any tile, including grass the same green as the player
 */
const PLAYER_OUTLINE_COLOR = 0x111111;

const PLAYER_OUTLINE_WIDTH = 2;

/**
 * The player's own outline is white and thicker, so they can find themselves without telling green
 * from blue
 */
const OWN_PLAYER_OUTLINE_COLOR = 0xffffff;

const OWN_PLAYER_OUTLINE_WIDTH = 3;

/**
 * How opaque the player is drawn while they are a ghost
 */
const GHOST_ALPHA = 0.4;

/**
 * Gap in pixels between the top of a player and the bottom of their name
 */
const NAME_OFFSET = 4;

/**
 * Gap in pixels between the bottom of the player and the top of the prompt to take a manual link
 */
const PROMPT_OFFSET = 6;

/**
 * The color laid over the map at night
 */
const NIGHT_COLOR = 0x0a1030;

/**
 * How opaque the night color is at full dark; the map fades toward it as the light goes
 */
const NIGHT_ALPHA = 0.65;

/**
 * Depth of the night color: over the map and players, under their names and the link prompt
 */
const NIGHT_DEPTH = 0.5;

/**
 * The color laid over cells out of sight
 */
const FOG_COLOR = 0x000000;

/**
 * How opaque the fog is
 */
const FOG_ALPHA = 0.55;

/**
 * How opaque the fog is over cells the group has never seen, in a group's room: they are hidden
 */
const UNSEEN_ALPHA = 1;

/**
 * Depth of the fog: over the map, under the players
 */
const FOG_DEPTH = -0.5;

/**
 * How many cells past the edges of the view the fog is drawn, so it still covers the view while the
 * camera catches up with the player
 */
const FOG_MARGIN = 2;

const TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
	fontFamily: 'sans-serif',
	fontSize: '12px',
	color: '#ffffff'
};

/**
 * Data the scene is started with
 */
export interface MapSceneData
{
	/**
	 * The joined room; whoever starts the scene owns the room and leaves it
	 */
	connection: MapConnection<MapRoom>;
}

/**
 * A player as drawn on screen
 */
interface RenderedPlayer
{
	shape: Phaser.GameObjects.Arc;
	label: Phaser.GameObjects.Text;

	/**
	 * Positions from the server, made continuous across looping edges (see trackPosition)
	 */
	positions: PositionBuffer;

	/**
	 * The latest position pushed, or undefined to take the next one as it comes
	 */
	lastPosition: Point | undefined;

	stopListening: () => void;
}

/**
 * Draws a room with a map (a universe's lobby or a group's game room): the area the player is in, the
 * players the server shows in it, and sends keyboard input. The camera follows the player
 *
 * The server decides where players are. This scene only sends the direction held and draws the
 * positions the server sends back. On an area that loops, players are drawn wherever is nearest the
 * player along each looping axis, and a player crossing the edge carries on smoothly rather than
 * jumping to the far side
 */
export class MapScene extends Phaser.Scene
{
	private room!: GameRoom;
	private ownPlayerId!: string;
	private area!: AreaPayload;
	private areaRenderer?: AreaRenderer;

	/**
	 * The area's chunks received so far that aren't all the default tile, by chunkKey(); the renderer draws from it
	 */
	private chunks = new Map<string, number[]>();

	/**
	 * Cells with a manual link, by "column,row"
	 */
	private manualLinks = new Set<string>();

	private readonly players = new Map<string, RenderedPlayer>();
	private readonly unbinds: Array<() => void> = [];
	private movementKeys?: MovementKeys;
	private takeLinkKey?: Phaser.Input.Keyboard.Key;
	private linkPrompt?: Phaser.GameObjects.Text;
	private lastSentMove?: MovePayload;
	private announcer!: MapAnnouncer;

	/**
	 * Darkens the view as the light goes
	 */
	private night?: Phaser.GameObjects.Rectangle;

	/**
	 * The area's map as vision sees it, from the chunks received so far
	 */
	private visionMap!: VisionMap;

	/**
	 * Darkens the cells out of sight
	 */
	private fog?: Phaser.GameObjects.Graphics;

	/**
	 * What the fog was last drawn from (see updateFog), so it is drawn again only when that changes
	 */
	private fogKey = '';

	/**
	 * Counts the chunks received, so the fog is drawn again when the map under it changes
	 */
	private chunkRevision = 0;

	constructor()
	{
		super(MAP_SCENE_KEY);
	}

	/**
	 * Resets per-run state (runs on every start, unlike the constructor)
	 *
	 * @param data The room to draw
	 */
	init(data: MapSceneData): void
	{
		// A lobby's state holds its players the same way a game room's does; the scene reads nothing else
		this.room = data.connection.room as unknown as GameRoom;
		this.ownPlayerId = data.connection.playerId;
		this.area = data.connection.area;
		this.areaRenderer = undefined;
		this.players.clear();
		this.unbinds.length = 0;
		this.movementKeys = undefined;
		this.takeLinkKey = undefined;
		this.linkPrompt = undefined;
		this.lastSentMove = undefined;
		this.announcer = new MapAnnouncer();
		this.night = undefined;
		this.fog = undefined;
		this.fogKey = '';
	}

	/**
	 * Draws the area, sets up input, and subscribes to the players in the room's state and the area changes
	 */
	create(): void
	{
		const mapElement = this.game.canvas.parentElement;

		this.enterArea(this.area);
		this.announcer.enteredArea(this.area.name);

		this.unbinds.push(this.room.onMessage(ServerMessageType.Area, (area: AreaPayload) =>
		{
			// The area the player is already in comes again when an editor changes it; the player hasn't moved area
			const sameArea = (area.areaId === this.area.areaId);

			this.enterArea(area);

			if (!sameArea)
			{
				this.forgetOwnPosition();
				this.announcer.enteredArea(area.name);
			}
		}));

		this.unbinds.push(this.room.onMessage(ServerMessageType.Chunks, (payload: ChunksPayload) =>
		{
			this.receiveChunks(payload);
		}));

		// Only a group's room sends it
		this.unbinds.push(this.room.onMessage(GameServerMessageType.CellsSeen, (payload: CellsSeenPayload) =>
		{
			this.receiveCellsSeen(payload);
		}));

		if (this.input.keyboard)
		{
			this.movementKeys = new MovementKeys(this.input.keyboard);
			this.takeLinkKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
		}

		const prompt = t({
			id: 'map.takeLink',
			defaultMessage: 'Press E to go through',
			description: 'Shown under the player on a cell linking to another area, such as a door; the E key is the same in every language'
		});

		this.linkPrompt = this.add.text(0, 0, prompt, TEXT_STYLE).setOrigin(0.5, 0).setDepth(2).setVisible(false);
		this.night = this.add.rectangle(0, 0, VIEW_WIDTH, VIEW_HEIGHT, NIGHT_COLOR, NIGHT_ALPHA)
			.setOrigin(0, 0)
			.setScrollFactor(0)
			.setDepth(NIGHT_DEPTH)
			.setAlpha(0);
		this.fog = this.add.graphics().setDepth(FOG_DEPTH);

		// Clicking the map takes the keyboard back from a text field, such as the lobby's chat
		this.input.on(Phaser.Input.Events.POINTER_DOWN, () =>
		{
			mapElement?.focus();
		});

		if (mapElement)
		{
			this.addKeys(mapElement);
		}

		this.game.events.on(Phaser.Core.Events.BLUR, this.stopMoving);
		this.game.events.on(Phaser.Core.Events.HIDDEN, this.stopMoving);
		document.addEventListener('focusin', this.onFocusChange);
		document.addEventListener('focusout', this.onFocusChange);
		this.onFocusChange();

		this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
		{
			this.game.events.off(Phaser.Core.Events.BLUR, this.stopMoving);
			this.game.events.off(Phaser.Core.Events.HIDDEN, this.stopMoving);
			document.removeEventListener('focusin', this.onFocusChange);
			document.removeEventListener('focusout', this.onFocusChange);
			this.input.removeAllListeners(Phaser.Input.Events.POINTER_DOWN);

			// Captured keys have their default action blocked on the whole page, which would stop them
			// being typed into the lobby's chat
			this.input.keyboard?.removeAllKeys(true);
			this.input.keyboard?.clearCaptures();
			this.input.keyboard?.enableGlobalCapture();

			for (const unbind of this.unbinds)
			{
				unbind();
			}

			this.announcer.stop();

			for (const playerId of [...this.players.keys()])
			{
				this.removePlayer(playerId);
			}

			this.areaRenderer?.destroy();
			this.areaRenderer = undefined;
		});

		this.watchPlayers();
	}

	/**
	 * Sends input when it changes, moves every player to its interpolated position, draws the map around
	 * the camera, and offers the manual link the player is standing on
	 */
	update(): void
	{
		this.sendMovement();

		const ownState = this.room.state.players?.get(this.ownPlayerId);

		if (ownState && this.lastSentMove)
		{
			this.announcer.movementChecked(((this.lastSentMove.x !== 0) || (this.lastSentMove.y !== 0)), ownState.x, ownState.y);
		}

		const renderTime = performance.now() - INTERPOLATION_DELAY_MS;
		const own = this.players.get(this.ownPlayerId)?.positions.sample(renderTime);

		for (const [playerId, player] of this.players)
		{
			const position = ((playerId === this.ownPlayerId) ? own : player.positions.sample(renderTime));

			if (position)
			{
				const drawn = (own ? this.nearestTo(position, own) : position);

				player.shape.setPosition(drawn.x, drawn.y);
				player.label.setPosition(drawn.x, drawn.y - PLAYER_RADIUS - NAME_OFFSET);
			}
		}

		this.areaRenderer?.update(this.cameras.main.worldView);
		this.updateLinkPrompt(own);
		this.updateDaylight();
		this.updateFog();
	}

	/**
	 * Draws fog over the cells around the player that nobody they see with can see: the player alone in
	 * a lobby, and in a group's room every member in the area, who are all the players it shows. Looks
	 * from where each is drawn (drawnCellOf), and draws again only when that, how far they see or the map
	 * changes
	 */
	private updateFog(): void
	{
		const own = this.room.state.players?.get(this.ownPlayerId);

		if (!own || !this.fog)
		{
			return;
		}

		const sights: { cell: { column: number; row: number }; budget: number }[] = [];

		this.room.state.players.forEach((player, playerId) =>
		{
			if ((playerId === this.ownPlayerId) || (this.sharesVision && !player.ghost))
			{
				const cell = this.drawnCellOf(playerId, player);

				sights.push({
					cell,
					budget: visionBudget(areaLight(this.area.lightLevel, this.secondOfDayAt(cell)), player.darkvision, this.area.fullVision)
				});
			}
		});

		// The camera follows where the player is drawn: past a looping edge, a whole map away from their
		// position on the map
		const center = this.drawnCellOf(this.ownPlayerId, own);
		const key = [
			this.area.areaId,
			this.chunkRevision,
			center.column,
			center.row,
			// The light changes a little every frame around dawn and dusk; a tenth of a square is too little to see
			...sights.map((sight) => `${sight.cell.column},${sight.cell.row},${Math.floor(sight.budget * 10)}`)
		].join(';');

		if (key === this.fogKey)
		{
			return;
		}

		this.fogKey = key;

		const visible = new Set<string>();

		for (const sight of sights)
		{
			for (const cellKey of visibleCells(sight.cell, sight.budget, this.visionMap))
			{
				visible.add(cellKey);
			}
		}

		this.drawFog(center, visible);
	}

	/**
	 * Draws fog over the cells around the view's center that aren't visible
	 *
	 * @param center The cell the player is drawn in, which the camera follows; past a looping edge, off the map
	 * @param visible The cells in sight, by visionKey()
	 */
	private drawFog(center: { column: number; row: number }, visible: ReadonlySet<string>): void
	{
		const fog = this.fog;

		if (!fog)
		{
			return;
		}

		const { bounds } = this.area;
		const halfColumns = Math.ceil(VIEW_COLUMNS / 2) + FOG_MARGIN;
		const halfRows = Math.ceil(VIEW_ROWS / 2) + FOG_MARGIN;
		const width = (bounds.maxColumn - bounds.minColumn) + 1;
		const height = (bounds.maxRow - bounds.minRow) + 1;

		fog.clear();

		for (let row = center.row - halfRows; row <= center.row + halfRows; row++)
		{
			for (let column = center.column - halfColumns; column <= center.column + halfColumns; column++)
			{
				// Past a looping edge the map carries on from the far side, drawn next to the player
				const mapColumn = (this.area.loopsEastWest ? bounds.minColumn + positiveModulo(column - bounds.minColumn, width) : column);
				const mapRow = (this.area.loopsNorthSouth ? bounds.minRow + positiveModulo(row - bounds.minRow, height) : row);

				if (isInBounds(bounds, mapColumn, mapRow) && !visible.has(visionKey(mapColumn, mapRow)))
				{
					fog.fillStyle(FOG_COLOR, (this.isUnseen(mapColumn, mapRow) ? UNSEEN_ALPHA : FOG_ALPHA));
					fog.fillRect(column * GRID_CELL_SIZE, row * GRID_CELL_SIZE, GRID_CELL_SIZE, GRID_CELL_SIZE);
				}
			}
		}
	}

	/**
	 * Whether everyone the room shows is in one group, which sees whatever any of its members sees: a
	 * group's room, whose state has the group's clock, unlike a lobby's
	 *
	 * @return True in a group's room
	 */
	private get sharesVision(): boolean
	{
		return((this.room.state.clock as number | undefined) !== undefined);
	}

	/**
	 * The cell a player is drawn in, which trails their position from the server by INTERPOLATION_DELAY_MS.
	 * The fog follows it, so it stays with the picture, and the tiles of cells the group sees for the first
	 * time have usually arrived from the server before the fog uncovers them
	 *
	 * @param playerId The player's ID
	 * @param player The player's synced state, for a player not drawn yet
	 * @return The cell; past a looping edge, off the map, next to the player this window controls
	 */
	private drawnCellOf(playerId: string, player: Player): { column: number; row: number }
	{
		const drawn = this.players.get(playerId)?.shape ?? player;

		return({
			column: Math.floor(drawn.x / GRID_CELL_SIZE),
			row: Math.floor(drawn.y / GRID_CELL_SIZE)
		});
	}

	/**
	 * Whether a cell's tile hasn't been sent because the group hasn't seen it, in a group's room
	 *
	 * @param column The cell's column, on the map
	 * @param row The cell's row, on the map
	 * @return True when it holds UNSEEN_CELL
	 */
	private isUnseen(column: number, row: number): boolean
	{
		return(this.chunks.get(chunkKey(chunkCoordinate(column), chunkCoordinate(row)))?.[cellIndexInChunk(column, row)] === UNSEEN_CELL);
	}

	/**
	 * The cell a player is in
	 *
	 * @param player The player's synced state
	 * @return The cell
	 */
	private cellOf(player: Player): { column: number; row: number }
	{
		return({
			column: Math.floor(player.x / GRID_CELL_SIZE),
			row: Math.floor(player.y / GRID_CELL_SIZE)
		});
	}

	/**
	 * Darkens the map for the light where the player is: the time of day outdoors, or an indoor area's
	 * light level. Outdoors, tells screen reader users as the part of the day changes; indoors the light
	 * doesn't change with it
	 */
	private updateDaylight(): void
	{
		const seconds = this.currentSecondOfDay();

		if (seconds === undefined)
		{
			return;
		}

		this.night?.setAlpha(1 - areaLight(this.area.lightLevel, seconds));

		if (this.area.lightLevel === null)
		{
			this.announcer.partOfDayChanged(partOfDay(seconds));
		}
	}

	/**
	 * The time of day where the player is
	 *
	 * @return Seconds since midnight, or undefined before the player is on the map
	 */
	private currentSecondOfDay(): number | undefined
	{
		const own = this.room.state.players?.get(this.ownPlayerId);

		return((own ? this.secondOfDayAt(this.cellOf(own)) : undefined));
	}

	/**
	 * The time of day at a cell of the area
	 *
	 * @param cell The cell
	 * @return Seconds since midnight
	 */
	private secondOfDayAt(cell: { column: number; row: number }): number
	{
		// A lobby has no clock: its time of day never flows with the players' actions
		const clock = (this.room.state.clock as number | undefined) ?? 0;

		return(secondOfDay(this.area.time, clock, Date.now(), cell, this.area.bounds));
	}

	/**
	 * Starts drawing an area in place of the one before
	 *
	 * @param area The area
	 */
	private enterArea(area: AreaPayload): void
	{
		this.area = area;
		this.chunks = new Map(area.chunks.map((chunk) => [chunkKey(chunk.chunkColumn, chunk.chunkRow), chunk.cells]));
		this.manualLinks =new Set(area.links.filter((link) => (link.mode === 'manual')).map((link) => `${link.column},${link.row}`));
		this.visionMap = createVisionMap(
			{
				bounds: area.bounds,
				defaultTileId: area.defaultTileId,
				chunks: this.chunks
			},
			area.loopsEastWest,
			area.loopsNorthSouth,
			new Map(area.tiles.map((tile) => [tile.id, tile.visionCost]))
		);
		this.chunkRevision++;
		this.areaRenderer?.destroy();
		this.areaRenderer = new AreaRenderer(this, area, this.chunks);
	}

	/**
	 * Takes in chunks of the area the player has come near or an editor has changed, and redraws them
	 *
	 * @param payload The chunks
	 */
	private receiveChunks(payload: ChunksPayload): void
	{
		// Chunks of an area the player has since left
		if (payload.areaId !== this.area.areaId)
		{
			return;
		}

		const keys: string[] = [];

		for (const chunk of payload.chunks)
		{
			const key = chunkKey(chunk.chunkColumn, chunk.chunkRow);

			if (chunk.cells)
			{
				this.chunks.set(key, chunk.cells);
			}
			else
			{
				this.chunks.delete(key);
			}

			keys.push(key);
		}

		this.chunkRevision++;
		this.areaRenderer?.refreshChunks(keys);
	}

	/**
	 * Takes in the tiles of cells the group has just seen for the first time, with the links on them, and
	 * draws them. A cell in a chunk this window doesn't hold is left for the chunk, which carries it
	 *
	 * @param payload The cells
	 */
	private receiveCellsSeen(payload: CellsSeenPayload): void
	{
		if (payload.areaId !== this.area.areaId)
		{
			return;
		}

		const changed: CellValue[] = [];

		for (const cell of payload.cells)
		{
			const chunk = this.chunks.get(chunkKey(chunkCoordinate(cell.column), chunkCoordinate(cell.row)));

			if (chunk)
			{
				chunk[cellIndexInChunk(cell.column, cell.row)] = cell.value;
				changed.push(cell);
			}
		}

		for (const link of payload.links)
		{
			if (link.mode === 'manual')
			{
				this.manualLinks.add(`${link.column},${link.row}`);
			}
		}

		this.chunkRevision++;
		this.areaRenderer?.refreshCells(changed);
	}

	/**
	 * Makes the player's next position from the server be drawn straight away, rather than reached
	 * smoothly from where they were in the area they have just left
	 *
	 * Players in the old area are removed and those in the new one added through the state, like any
	 * other player coming and going
	 */
	private forgetOwnPosition(): void
	{
		const own = this.players.get(this.ownPlayerId);

		own?.positions.clear();

		if (own)
		{
			own.lastPosition = undefined;
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
			const isOwn = (playerId === this.ownPlayerId);
			const shape = this.add.circle(player.x, player.y, PLAYER_RADIUS, (isOwn ? OWN_PLAYER_COLOR : OTHER_PLAYER_COLOR))
				.setStrokeStyle((isOwn ? OWN_PLAYER_OUTLINE_WIDTH : PLAYER_OUTLINE_WIDTH), (isOwn ? OWN_PLAYER_OUTLINE_COLOR : PLAYER_OUTLINE_COLOR));
			const rendered: RenderedPlayer = {
				shape,
				label: this.add.text(player.x, player.y - PLAYER_RADIUS - NAME_OFFSET, '', TEXT_STYLE).setOrigin(0.5, 1).setDepth(1),
				positions: new PositionBuffer(PATCH_INTERVAL_MS),
				lastPosition: undefined,
				stopListening: () => undefined
			};

			this.trackPosition(rendered, player);
			this.showAppearance(rendered, player);

			rendered.stopListening = callbacks.onChange(player, () =>
			{
				this.trackPosition(rendered, player);
				this.showAppearance(rendered, player);
			});

			if (isOwn)
			{
				this.cameras.main.startFollow(shape, true);
			}
			else
			{
				this.announcer.playerAppeared(player.name);
			}

			this.players.set(playerId, rendered);
		}));

		this.unbinds.push(callbacks.onRemove('players', (player: Player, playerId: string) =>
		{
			if (playerId !== this.ownPlayerId)
			{
				this.announcer.playerDisappeared(player.name);
			}

			this.removePlayer(playerId);
		}));
	}

	/**
	 * Shows a player's name, or that they are a ghost: faded, and labeled as one. Only the player's own
	 * ghost is ever in the state
	 *
	 * @param rendered The player as drawn
	 * @param player The player's synced state
	 */
	private showAppearance(rendered: RenderedPlayer, player: Player): void
	{
		rendered.shape.setAlpha((player.ghost ? GHOST_ALPHA : 1));
		rendered.label.setText((player.ghost
			? t({
				id: 'map.ghost',
				defaultMessage: 'Ghost',
				description: 'Shown above the player on the lobby\'s map while they play no character: they are a ghost, whom other players can\'t see'
			})
			: player.name));
	}

	/**
	 * Records a player's position from the server
	 *
	 * The server keeps positions on the area, so a player stepping off a looping edge jumps a whole area
	 * to the far side. Taking the copy of each position nearest the last one undoes the jump, so the
	 * player (and the camera following them) carries on smoothly
	 *
	 * @param rendered The player as drawn
	 * @param player The player's synced state
	 */
	private trackPosition(rendered: RenderedPlayer, player: Player): void
	{
		const position = (rendered.lastPosition ? this.nearestTo(player, rendered.lastPosition) : { x: player.x, y: player.y });

		rendered.lastPosition = position;
		rendered.positions.push(performance.now(), position.x, position.y);
	}

	/**
	 * The copy of a position nearest another, along each axis the area loops on
	 *
	 * @param position The position
	 * @param reference The position to be near
	 * @return The nearest copy; the position itself on an area that doesn't loop
	 */
	private nearestTo(position: Point, reference: Point): Point
	{
		if (!this.areaRenderer)
		{
			return(position);
		}

		return({
			x: (this.area.loopsEastWest ? nearestCopy(position.x, reference.x, this.areaRenderer.width) : position.x),
			y: (this.area.loopsNorthSouth ? nearestCopy(position.y, reference.y, this.areaRenderer.height) : position.y)
		});
	}

	/**
	 * Shows the prompt to take a manual link while the player stands on one, and takes it when E is pressed
	 *
	 * @param own Where the player is drawn, or undefined before they have been
	 */
	private updateLinkPrompt(own: Point | undefined): void
	{
		const player = this.room.state.players?.get(this.ownPlayerId);
		const isStanding = (
			(player !== undefined) &&
			(positiveModulo(player.x, GRID_CELL_SIZE) === GRID_CELL_SIZE / 2) &&
			(positiveModulo(player.y, GRID_CELL_SIZE) === GRID_CELL_SIZE / 2)
		);
		const onLink = (isStanding && this.manualLinks.has(`${Math.floor(player.x / GRID_CELL_SIZE)},${Math.floor(player.y / GRID_CELL_SIZE)}`));

		this.linkPrompt?.setVisible(onLink && (own !== undefined));
		this.announcer.linkChanged(onLink, (this.linkPrompt?.text ?? ''));

		if (onLink && own)
		{
			this.linkPrompt?.setPosition(own.x, own.y + PLAYER_RADIUS + PROMPT_OFFSET);

			if (this.takeLinkKey && Phaser.Input.Keyboard.JustDown(this.takeLinkKey))
			{
				this.room.send(MessageType.TakeLink);
			}
		}
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
	 * Hands the keyboard to a text field while one has focus, and takes it back afterward
	 *
	 * While the game has the keyboard it blocks the movement keys' normal effect on the whole page, which
	 * would stop W, A, S, D and E being typed into the chat
	 */
	private readonly onFocusChange = (): void =>
	{
		const keyboard = this.input.keyboard;

		// focusout fires before focus moves on, so wait until it has landed
		queueMicrotask(() =>
		{
			if (!keyboard)
			{
				return;
			}

			const typing = isTextEntry(document.activeElement);

			if (typing && keyboard.enabled)
			{
				this.stopMoving();
				keyboard.enabled = false;
				keyboard.disableGlobalCapture();
			}
			else if (!typing && !keyboard.enabled)
			{
				keyboard.enabled = true;
				keyboard.enableGlobalCapture();
			}
		});
	};

	/**
	 * Adds the shortcut that reads out where the player is, and lists the keys that play, while the map shows
	 *
	 * @param mapElement The element the map is in
	 */
	private addKeys(mapElement: HTMLElement): void
	{
		this.unbinds.push(addShortcut({
			keys: 'Alt+P',
			scope: mapElement,
			description: () => t({
				id: 'map.keys.position',
				defaultMessage: 'Say where you are and who you can see',
				description: 'In the list of keyboard shortcuts, what the shortcut that reads out the player\'s position does'
			}),
			run: () =>
			{
				this.describePosition();
			}
		}));

		this.unbinds.push(addKeyHelp({
			scope: mapElement,
			keys: () => t({
				id: 'map.keys.move',
				defaultMessage: 'Arrow keys, W A S D or number pad',
				description: 'In the list of keyboard shortcuts, the keys that move the player; the keys are the same in every language'
			}),
			description: () => t({
				id: 'map.keys.moveDescription',
				defaultMessage: 'Move',
				description: 'In the list of keyboard shortcuts, what the movement keys do'
			})
		}));

		this.unbinds.push(addKeyHelp({
			scope: mapElement,
			keys: () => 'E',
			description: () => t({
				id: 'map.keys.takeLink',
				defaultMessage: 'Go through a door or path you stand on',
				description: 'In the list of keyboard shortcuts, what the E key does: takes the player to another area through the link they stand on'
			})
		}));
	}

	/**
	 * Reads out where the player is and the tile they stand on, and how far away and in which direction
	 * each other player they can see is
	 */
	private describePosition(): void
	{
		const own = this.room.state.players?.get(this.ownPlayerId);

		if (!own)
		{
			return;
		}

		const column = Math.floor(own.x / GRID_CELL_SIZE);
		const row = Math.floor(own.y / GRID_CELL_SIZE);
		const tileId = tileIdAt({ bounds: this.area.bounds, defaultTileId: this.area.defaultTileId, chunks: this.chunks }, column, row);
		const tile = this.area.tiles.find((candidate) => (candidate.id === tileId));
		const seconds = this.secondOfDayAt({ column, row });
		const others: SeenPlayer[] = [];

		this.room.state.players.forEach((player, playerId) =>
		{
			if (playerId !== this.ownPlayerId)
			{
				const nearest = this.nearestTo(player, own);

				others.push({
					name: player.name,
					columns: Math.floor(nearest.x / GRID_CELL_SIZE) - column,
					rows: Math.floor(nearest.y / GRID_CELL_SIZE) - row
				});
			}
		});

		this.announcer.describePosition({
			areaName: this.area.name,
			column,
			row,
			tileName: (tile ? tileName(tile, this.area.ruleset) : undefined),
			secondOfDay: seconds,
			displayTime: this.area.displayTime,
			sightSquares: Math.floor(visionBudget(areaLight(this.area.lightLevel, seconds), own.darkvision, this.area.fullVision))
		}, others);
	}

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
