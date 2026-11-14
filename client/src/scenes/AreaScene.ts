import Phaser from 'phaser';
import { Callbacks } from '@colyseus/sdk';
import { areaLight, cellIndexInChunk, chunkCoordinate, chunkKey, createVisionArea, GameServerMessageType, GRID_CELL_SIZE, hasNeighbors, isInBounds, locateCell, MessageType, nearestCopy, partOfDay, PATCH_INTERVAL_MS, PLAYER_RADIUS, positiveModulo, seamSlots, secondOfDay, ServerMessageType, tileIdAt, UNSEEN_CELL, VIEW_COLUMNS, VIEW_HEIGHT, VIEW_ROWS, VIEW_WIDTH, visibleCells, visionBudget, visionKey, VOID_CELL, type AreaBounds, type CellsSeenPayload, type CellValue, type ChunksPayload, type MovePayload, type NeighborAreasPayload, type Player, type AreaPayload, type SeamLookup, type SeamSlot, type VisionArea } from '@multiverse-kiln/shared';

import { MovementKeys } from '../input/MovementKeys';
import { t } from '../localization';
import { heldAreaMessages } from '../network/heldAreaMessages';
import type { AreaConnection, AreaRoom, GameRoom } from '../network/serverConnection';
import { PositionBuffer, type Point } from '../rendering/PositionBuffer';
import { AreaRenderer } from '../rendering/AreaRenderer';
import { loadUploadedTileGraphics, preloadTileGraphics } from '../rendering/tileGraphics';
import type { CellMaskShader } from '../rendering/CellMaskShader';
import { createRoundedFog } from '../rendering/RoundedFog';
import { createUnexploredPaper, preloadUnexploredPaper } from '../rendering/UnexploredPaper';
import { isTextEntry } from '../ui/dom';
import { AreaAnnouncer, type SeenPlayer } from '../ui/AreaAnnouncer';
import { addKeyHelp, addShortcut } from '../ui/shortcuts';
import { tileName } from '../ui/tileNames';
import type { UniverseText } from '../ui/universeText';

/**
 * Key the scene is registered under
 */
export const AREA_SCENE_KEY = 'AreaScene';

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
 * The color laid over the area at night
 */
const NIGHT_COLOR = 0x0a1030;

/**
 * How opaque the night color is at full dark; the area fades toward it as the light goes
 */
const NIGHT_ALPHA = 0.65;

/**
 * How opaque the night color is at full dark for a character with darkvision and light sensitivity,
 * whose eyes are made for the dark
 */
const DARK_ADAPTED_NIGHT_ALPHA = 0.1;

/**
 * The color laid over the area in daylight outdoors for a character with darkvision and light
 * sensitivity, whom bright light dazzles: the night color's opposite
 */
const GLARE_COLOR = 0xf5efcf;

/**
 * How opaque the glare is in full daylight; the area fades toward it as the light comes up
 */
const GLARE_ALPHA = NIGHT_ALPHA;

/**
 * Depth of the night color: over the area and players, under their names and the link prompt
 */
const NIGHT_DEPTH = 0.5;

/**
 * The player's area's place among the places around it (placeKeyOf())
 */
const PLAYER_PLACE = '0,0';

/**
 * Names one of the places around the player's area, as seamSlots() gives them, or the area's own
 *
 * @param columns Which way the place is from the area, -1, 0 or 1 east-west
 * @param rows Which way it is north-south
 * @return The key
 */
function placeKeyOf(columns: number, rows: number): string
{
	return(`${columns},${rows}`);
}

/**
 * Depth of the glare, drawn over the cells in sight: over the area, the players and what overhangs them,
 * under the paper, which is drawn rather than seen and so isn't dazzling
 */
const GLARE_DEPTH = 0.35;

/**
 * The color laid over cells out of sight
 */
const FOG_COLOR = 0x000000;

/**
 * How opaque the fog is
 */
const FOG_ALPHA = 0.55;

/**
 * Depth of the fog: over the area, the players and what overhangs them, such as mountains' peaks, which
 * would otherwise show undimmed over cells out of sight; under the night. The players the room shows are
 * in sight, so the fog doesn't cover them
 */
const FOG_DEPTH = 0.3;

/**
 * How many cells past the edges of the view the fog is drawn, so it still covers the view while the
 * camera catches up with the player
 */
const FOG_MARGIN = 2;

/**
 * How many cells wide and tall the fog is drawn, centered on the cell the player is drawn in
 */
const FOG_COLUMNS = ((Math.ceil(VIEW_COLUMNS / 2) + FOG_MARGIN) * 2) + 1;

const FOG_ROWS = ((Math.ceil(VIEW_ROWS / 2) + FOG_MARGIN) * 2) + 1;

/**
 * Depth of the paper drawn over cells the group has never seen and past the area's edges: over the fog
 * and the glare, under the night
 */
const PAPER_DEPTH = 0.4;

const TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
	fontFamily: 'sans-serif',
	fontSize: '12px',
	color: '#ffffff'
};

/**
 * Whether the element with focus needs the keys that move the player: a text field takes letters, and a
 * select and anything in a modal dialog (radio buttons, a menu) take the arrow keys
 *
 * @param element The element with focus
 * @return True when the game should leave the keyboard to the page
 */
function needsMovementKeys(element: Element | null): boolean
{
	if (!element)
	{
		return(false);
	}

	return(isTextEntry(element) || (element instanceof HTMLSelectElement) || (element.closest('dialog:modal') !== null));
}

/**
 * Data the scene is started with
 */
export interface AreaSceneData
{
	/**
	 * The joined room; whoever starts the scene owns the room and leaves it
	 */
	connection: AreaConnection<AreaRoom>;

	/**
	 * The universe's names in the player's language, which the scene loads again when the room says they
	 * changed, or undefined to show the names the room sends
	 */
	text: UniverseText | undefined;
}

/**
 * An area's cells as vision sees them, from the chunks received so far
 *
 * @param area The area as the room sent it
 * @param chunks Its chunks, by chunkKey(), which vision reads as they change
 * @return The area as vision sees it
 */
function visionOf(area: AreaPayload, chunks: ReadonlyMap<string, readonly number[]>): VisionArea
{
	return(createVisionArea(
		{
			bounds: area.bounds,
			defaultTileId: area.defaultTileId,
			chunks
		},
		area.loopsEastWest,
		area.loopsNorthSouth,
		new Map(area.tiles.map((tile) => [tile.id, tile.visionCost]))
	));
}

/**
 * An area across a seam from the player's area, as the room sent it (see Neighboring areas in
 * STRUCTURE-OVERVIEW.md)
 */
interface NeighborArea
{
	payload: AreaPayload;

	/**
	 * Its chunks received so far that aren't all the default tile, by chunkKey(); its renderers draw from it
	 */
	chunks: Map<string, number[]>;

	/**
	 * Its cells as vision sees them, from the chunks received so far
	 */
	vision: VisionArea;
}

/**
 * An area drawn beside the player's, across a seam: the area, where it is drawn, and how dark it is
 */
interface DrawnNeighbor
{
	slot: SeamSlot;
	renderer: AreaRenderer;
	night: Phaser.GameObjects.Rectangle;
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
 * Draws a room with an area (a universe's lobby or a group's game room): the area the player is in, the
 * players the server shows in it, and sends keyboard input. The camera follows the player
 *
 * The server decides where players are. This scene only sends the direction held and draws the
 * positions the server sends back. On an area that loops, players are drawn wherever is nearest the
 * player along each looping axis, and a player crossing the edge carries on smoothly rather than
 * jumping to the far side
 */
export class AreaScene extends Phaser.Scene
{
	private room!: GameRoom;
	private ownPlayerId!: string;
	private area!: AreaPayload;
	private areaRenderer?: AreaRenderer;

	/**
	 * The universe's names in the player's language, or undefined to use the names the room sends
	 */
	private text: UniverseText | undefined;

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
	private announcer!: AreaAnnouncer;

	/**
	 * Darkens the view as the light goes
	 */
	private night?: Phaser.GameObjects.Rectangle;

	/**
	 * Brightens the view in daylight outdoors for a character whom bright light dazzles
	 */
	private glare?: CellMaskShader;

	/**
	 * Whether the glare is opaque enough to show (see updateDaylight). While it isn't, it is hidden, since a
	 * shown shader runs over the whole view every frame even when fully transparent
	 */
	private glaring = false;

	/**
	 * The area's cells as vision sees them, from the chunks received so far
	 */
	private visionArea!: VisionArea;

	/**
	 * Darkens the cells out of sight
	 */
	private fog?: CellMaskShader;

	/**
	 * Hides the cells the group has never seen, and past the area's edges, under paper
	 */
	private paper?: CellMaskShader;

	/**
	 * What the fog was last drawn from (see updateFog), so it is drawn again only when that changes
	 */
	private fogKey = '';

	/**
	 * The cells each sight the fog was last drawn from sees, by the sight's key (see updateFog), so a sight
	 * that hasn't changed isn't worked out again when another has
	 */
	private sightCells = new Map<string, Set<string>>();

	/**
	 * Counts the chunks received, so the fog is drawn again when the cells under it change
	 */
	private chunkRevision = 0;

	/**
	 * The areas across the seams of the player's area that the room has sent, by area ID
	 */
	private neighbors = new Map<string, NeighborArea>();

	/**
	 * The neighboring areas drawn around the player's area, each where its cells line up with the area's
	 */
	private drawnNeighbors: DrawnNeighbor[] = [];

	/**
	 * Where the cells of the player's area are drawn in the world, in cells. It moves on as the player
	 * crosses a seam into a neighbor, so the world they walk stays where it was and the camera carries on
	 */
	private origin = { column: 0, row: 0 };

	/**
	 * Darkens the player's area by its own light, when it has neighbors, which each darken by theirs
	 */
	private areaNight?: Phaser.GameObjects.Rectangle;

	/**
	 * Darkens the cells around the view where no area lies, when the player's area has neighbors, each by
	 * the light of an area drawn beside them (see emptyLightPlace()), by the place around the player's area
	 * that area is drawn in (placeKeyOf()); drawn again with the fog
	 */
	private emptyNights = new Map<string, Phaser.GameObjects.Graphics>();

	/**
	 * How dark each area drawn is, by the place around the player's area it is drawn in (placeKeyOf()), as
	 * the light was last worked out, for darkening where no area lies
	 */
	private placeNightAlphas = new Map<string, number>();

	constructor()
	{
		super(AREA_SCENE_KEY);
	}

	/**
	 * Resets per-run state (runs on every start, unlike the constructor)
	 *
	 * @param data The room to draw
	 */
	init(data: AreaSceneData): void
	{
		// A lobby's state holds its players the same way a game room's does; the scene reads nothing else
		this.room = data.connection.room as unknown as GameRoom;
		this.ownPlayerId = data.connection.playerId;
		this.area = data.connection.area;
		this.text = data.text;
		this.areaRenderer = undefined;
		this.players.clear();
		this.unbinds.length = 0;
		this.movementKeys = undefined;
		this.takeLinkKey = undefined;
		this.linkPrompt = undefined;
		this.lastSentMove = undefined;
		this.announcer = new AreaAnnouncer();
		this.night = undefined;
		this.glare = undefined;
		this.glaring = false;
		this.fog = undefined;
		this.paper = undefined;
		this.fogKey = '';
		this.sightCells = new Map();
		this.neighbors = new Map();
		this.drawnNeighbors = [];
		this.origin = { column: 0, row: 0 };
		this.areaNight = undefined;
		this.emptyNights = new Map();
		this.placeNightAlphas = new Map();
	}

	/**
	 * Loads the tile graphics the area is drawn with, and the paper over cells never seen
	 */
	preload(): void
	{
		preloadTileGraphics(this);
		preloadUnexploredPaper(this);
	}

	/**
	 * Draws the area, sets up input, and subscribes to the players in the room's state and the area changes
	 */
	create(): void
	{
		const areaElement = this.game.canvas.parentElement;

		this.enterArea(this.area);
		this.announcer.enteredArea(this.areaName(this.area));

		this.unbinds.push(this.room.onMessage(ServerMessageType.Area, (area: AreaPayload) =>
		{
			// The area the player is already in comes again when an editor changes it; the player hasn't moved area
			const sameArea = (area.areaId === this.area.areaId);

			// Walking across a seam carries on where the neighbor was drawn, rather than starting afresh
			const crossed = (sameArea ? undefined : this.crossingInto(area.areaId));

			if (crossed)
			{
				this.crossInto(area, crossed);
			}
			else
			{
				this.enterArea(area);
			}

			if (!sameArea)
			{
				if (!crossed)
				{
					this.placeOwnPlayer();
				}

				this.announcer.enteredArea(this.areaName(area));
			}
		}));

		this.unbinds.push(this.room.onMessage(ServerMessageType.NeighborAreas, (payload: NeighborAreasPayload) =>
		{
			this.receiveNeighbors(payload);
		}));

		// Names are looked up when they are read out, so the next one read is in the new text
		this.unbinds.push(this.room.onMessage(ServerMessageType.UniverseText, () =>
		{
			this.text?.reloadSoon();
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

		// The areas around the area, and chunks, that arrived before the scene listened for them
		const held = heldAreaMessages(this.room);

		for (const message of held.take())
		{
			if (message.type === ServerMessageType.NeighborAreas)
			{
				this.receiveNeighbors(message.payload);
			}
			else
			{
				this.receiveChunks(message.payload);
			}
		}

		if (this.input.keyboard)
		{
			this.movementKeys = new MovementKeys(this.input.keyboard);
			this.takeLinkKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
		}

		const prompt = t({
			id: 'area.takeLink',
			defaultMessage: 'Press E to go through',
			description: 'Shown under the player on a cell linking to another area, such as a door; the E key is the same in every language'
		});

		this.linkPrompt = this.add.text(0, 0, prompt, TEXT_STYLE).setOrigin(0.5, 0).setDepth(2).setVisible(false);
		this.night = this.add.rectangle(0, 0, VIEW_WIDTH, VIEW_HEIGHT, NIGHT_COLOR)
			.setOrigin(0, 0)
			.setScrollFactor(0)
			.setDepth(NIGHT_DEPTH)
			.setAlpha(0);
		this.glare = createRoundedFog(this, 'rounded-glare', FOG_COLUMNS, FOG_ROWS, GLARE_DEPTH, GLARE_COLOR, 0);
		this.fog = createRoundedFog(this, 'rounded-fog', FOG_COLUMNS, FOG_ROWS, FOG_DEPTH, FOG_COLOR, FOG_ALPHA);
		this.paper = createUnexploredPaper(this, FOG_COLUMNS, FOG_ROWS, PAPER_DEPTH);

		// Clicking the area takes the keyboard back from a text field, such as the lobby's chat
		this.input.on(Phaser.Input.Events.POINTER_DOWN, () =>
		{
			areaElement?.focus();
		});

		if (areaElement)
		{
			this.addKeys(areaElement);
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

			held.stopListening();
			this.announcer.stop();

			for (const playerId of [...this.players.keys()])
			{
				this.removePlayer(playerId);
			}

			this.areaRenderer?.destroy();
			this.areaRenderer = undefined;
			this.clearNeighbors();
			this.areaNight?.destroy();
			this.areaNight = undefined;

			for (const graphics of this.emptyNights.values())
			{
				graphics.destroy();
			}

			this.emptyNights.clear();
			this.fog?.destroy();
			this.fog = undefined;
			this.glare?.destroy();
			this.glare = undefined;
			this.paper?.destroy();
			this.paper = undefined;
		});

		this.watchPlayers();
	}

	/**
	 * Sends input when it changes, moves every player to its interpolated position, draws the area around
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

		for (const drawn of this.drawnNeighbors)
		{
			drawn.renderer.update(this.cameras.main.worldView);
		}
		this.updateLinkPrompt(own);
		this.updateDaylight();
		this.updateFog();
	}

	/**
	 * Draws fog over the cells around the player that nobody they see with can see: the player alone in
	 * a lobby, and in a group's room every member in the area, who are all the players it shows. Looks
	 * from where each is drawn (drawnCellOf), and draws again only when that, how far they see or the
	 * area's cells change. An area without fog of war is in sight wherever it is drawn
	 */
	private updateFog(): void
	{
		const own = this.room.state.players?.get(this.ownPlayerId);

		if (!own || !this.fog)
		{
			return;
		}

		// An area with neighbors looks across its seams, whatever its own fog of war
		if (!this.area.fogOfWar && !this.hasSeams())
		{
			const center = this.drawnCellOf(this.ownPlayerId, own);
			const key = [this.area.areaId, this.chunkRevision, center.column, center.row].join(';');

			if (key !== this.fogKey)
			{
				this.fogKey = key;
				this.sightCells = new Map();
				this.drawFog(center, undefined);
			}

			return;
		}

		const sights: { cell: { column: number; row: number }; budget: number }[] = [];

		this.room.state.players.forEach((player, playerId) =>
		{
			if ((playerId === this.ownPlayerId) || (this.sharesVision && !player.ghost))
			{
				// Looked at from the player's area, and lit by the player's own
				const drawn = this.drawnCellOf(playerId, player);
				const cell = {
					column: drawn.column - this.origin.column,
					row: drawn.row - this.origin.row
				};
				const area = this.payloadOf(player.areaId);

				sights.push({
					cell,
					budget: visionBudget(areaLight(area.lightLevel, this.secondOfDayIn(area, this.cellOf(player))), player)
				});
			}
		});

		// The camera follows where the player is drawn: past a looping edge, a whole area away from their
		// position in the area
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
		const sightCells = new Map<string, Set<string>>();

		for (const sight of sights)
		{
			// What the fog key holds of the sight, and of the area it looks over
			const sightKey = `${this.area.areaId};${this.chunkRevision};${sight.cell.column},${sight.cell.row},${Math.floor(sight.budget * 10)}`;
			const cells = (sightCells.get(sightKey) ?? this.sightCells.get(sightKey) ?? visibleCells(sight.cell, sight.budget, this.visionArea));

			sightCells.set(sightKey, cells);

			for (const cellKey of cells)
			{
				visible.add(cellKey);
			}
		}

		this.sightCells = sightCells;
		this.drawFog(center, visible);
	}

	/**
	 * Draws fog over the cells around the view's center that aren't visible, the glare over those that
	 * are, and paper over those the group has never seen and those holding nothing at all (VOID_CELL),
	 * which editors call Unexplored. A cell that has just come into sight keeps its
	 * paper until its tile arrives. Past an edge of the area that doesn't loop is drawn as never seen, in a
	 * lobby too
	 *
	 * @param center The cell the player is drawn in, which the camera follows; past a looping edge, outside the area
	 * @param visible The cells in sight, by visionKey(), or undefined when every cell of the area is
	 */
	private drawFog(center: { column: number; row: number }, visible: ReadonlySet<string> | undefined): void
	{
		const left = center.column - Math.floor(FOG_COLUMNS / 2);
		const top = center.row - Math.floor(FOG_ROWS / 2);
		const isFogged = (column: number, row: number): boolean =>
		{
			const cell = this.areaCellAt(left + column, top + row);

			// A cell is in sight wherever it is drawn when neither its area nor the player's has fog of war
			if ((cell === undefined) || (!this.area.fogOfWar && !this.payloadOf(cell.areaId).fogOfWar))
			{
				return(cell === undefined);
			}

			return((visible !== undefined) && !visible.has(cell.key));
		};

		this.fog?.draw(left, top, isFogged);

		if (this.glaring)
		{
			this.glare?.draw(left, top, (column, row) => !isFogged(column, row));
		}
		else
		{
			this.glare?.hide();
		}

		this.paper?.draw(left, top, (column, row) =>
		{
			const cell = this.areaCellAt(left + column, top + row);

			return((cell === undefined) || this.isUnexplored(cell.areaId, cell.column, cell.row));
		});

		this.drawEmptyNight(left, top);
	}

	/**
	 * Draws the darkening over the cells of the fog's block where no area lies, row by row in runs of
	 * cells that take the same area's light, when the player's area has neighbors. Without neighbors the
	 * night over the whole view darkens them
	 *
	 * @param left The block's first column, in world cells
	 * @param top The block's first row, in world cells
	 */
	private drawEmptyNight(left: number, top: number): void
	{
		for (const graphics of this.emptyNights.values())
		{
			graphics.clear();
		}

		if (!this.hasSeams())
		{
			return;
		}

		const places = new Set([PLAYER_PLACE, ...this.drawnNeighbors.map(({ slot }) => placeKeyOf(slot.columns, slot.rows))]);

		for (let row = 0; row < FOG_ROWS; row++)
		{
			let runStart = 0;
			let runPlace: string | undefined;

			for (let column = 0; column <= FOG_COLUMNS; column++)
			{
				const empty = ((column < FOG_COLUMNS) && (this.areaCellAt(left + column, top + row) === undefined));
				const place = (empty ? this.emptyLightPlace(left + column, top + row, places) : undefined);

				if (place === runPlace)
				{
					continue;
				}

				if (runPlace !== undefined)
				{
					this.emptyNightFor(runPlace)
						.fillStyle(NIGHT_COLOR, 1)
						.fillRect((left + runStart) * GRID_CELL_SIZE, (top + row) * GRID_CELL_SIZE, (column - runStart) * GRID_CELL_SIZE, GRID_CELL_SIZE);
				}

				runStart = column;
				runPlace = place;
			}
		}
	}

	/**
	 * The place around the player's area whose area lights a cell where no area lies: of the places beside
	 * the cell's, the first holding an area, looking north, south, west then east, so an empty corner
	 * between a dark area and a lit one takes a neighbor's light rather than the player's. The order stays
	 * the same wherever the player stands, so the corner keeps the same light as they cross into the areas
	 * around it. A place with none beside it takes the player's area's light
	 *
	 * @param column The cell's column in the world
	 * @param row The cell's row in the world
	 * @param places The places that hold an area drawn (placeKeyOf())
	 * @return The place
	 */
	private emptyLightPlace(column: number, row: number, places: ReadonlySet<string>): string
	{
		const { bounds } = this.area;
		const localColumn = column - this.origin.column;
		const localRow = row - this.origin.row;
		const columns = ((localColumn < bounds.minColumn) ? -1 : ((localColumn > bounds.maxColumn) ? 1 : 0));
		const rows = ((localRow < bounds.minRow) ? -1 : ((localRow > bounds.maxRow) ? 1 : 0));
		const beside = [
			placeKeyOf(columns, rows - 1),
			placeKeyOf(columns, rows + 1),
			placeKeyOf(columns - 1, rows),
			placeKeyOf(columns + 1, rows)
		];

		return(beside.find((place) => places.has(place)) ?? PLAYER_PLACE);
	}

	/**
	 * The darkening over the cells where no area lies that take their light from a place's area, made the
	 * first time it is needed
	 *
	 * @param place The place (placeKeyOf())
	 * @return The darkening
	 */
	private emptyNightFor(place: string): Phaser.GameObjects.Graphics
	{
		let graphics = this.emptyNights.get(place);

		if (!graphics)
		{
			graphics = this.add.graphics()
				.setDepth(NIGHT_DEPTH)
				.setAlpha(this.placeNightAlphas.get(place) ?? 0);
			this.emptyNights.set(place, graphics);
		}

		return(graphics);
	}

	/**
	 * The cell drawn at a place in the world: of the player's area, carrying on from the far side past a
	 * looping edge, drawn next to the player, or of a neighboring area across a seam
	 *
	 * @param column The column in the world
	 * @param row The row in the world
	 * @return The cell in the area it is in, with the key vision gives it from the player's area
	 * (visionKey()), or undefined past an edge
	 */
	private areaCellAt(column: number, row: number): { areaId: string; column: number; row: number; key: string } | undefined
	{
		const { bounds } = this.area;
		const localColumn = column - this.origin.column;
		const localRow = row - this.origin.row;
		const width = (bounds.maxColumn - bounds.minColumn) + 1;
		const height = (bounds.maxRow - bounds.minRow) + 1;
		const areaColumn = (this.area.loopsEastWest ? bounds.minColumn + positiveModulo(localColumn - bounds.minColumn, width) : localColumn);
		const areaRow = (this.area.loopsNorthSouth ? bounds.minRow + positiveModulo(localRow - bounds.minRow, height) : localRow);

		if (isInBounds(bounds, areaColumn, areaRow))
		{
			return({ areaId: this.area.areaId, column: areaColumn, row: areaRow, key: visionKey(areaColumn, areaRow) });
		}

		const found = (this.hasSeams() ? locateCell(this.seamLookup, this.area.areaId, localColumn, localRow) : undefined);

		return(found && { ...found, key: visionKey(localColumn, localRow) });
	}

	/**
	 * Whether the player's area has neighbors, whose cells are drawn past its edges
	 *
	 * @return True when walking off any of its sides leads somewhere
	 */
	private hasSeams(): boolean
	{
		return(hasNeighbors(this.area.sides));
	}

	/**
	 * Finds the player's area and the neighboring areas the room has sent, for following cells across seams
	 *
	 * @param areaId The area's ID
	 * @return The area, or undefined for one not sent, which is an edge
	 */
	private readonly seamLookup: SeamLookup = (areaId) =>
	{
		const payload = ((areaId === this.area.areaId) ? this.area : this.neighbors.get(areaId)?.payload);

		return(payload && { id: areaId, bounds: payload.bounds, sides: payload.sides });
	};

	/**
	 * An area the scene draws: the player's, or a neighboring one
	 *
	 * @param areaId The area's ID
	 * @return The area as the room sent it; the player's for one the scene doesn't know
	 */
	private payloadOf(areaId: string): AreaPayload
	{
		return(this.neighbors.get(areaId)?.payload ?? this.area);
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
	 * @return The cell; past a looping edge, outside the area, next to the player this window controls
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
	 * Whether a cell is drawn as unexplored paper: its tile hasn't been sent because the group hasn't seen
	 * it, in a group's room, or it holds nothing at all
	 *
	 * @param areaId The area the cell is in: the player's, or a neighboring one
	 * @param column The cell's column, in the area
	 * @param row The cell's row, in the area
	 * @return True when it holds UNSEEN_CELL or VOID_CELL
	 */
	private isUnexplored(areaId: string, column: number, row: number): boolean
	{
		const chunks = ((areaId === this.area.areaId) ? this.chunks : this.neighbors.get(areaId)?.chunks);
		const value = chunks?.get(chunkKey(chunkCoordinate(column), chunkCoordinate(row)))?.[cellIndexInChunk(column, row)];

		return((value === UNSEEN_CELL) || (value === VOID_CELL));
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
	 * Darkens the area for the light where the player is: the time of day outdoors, or an indoor area's
	 * light level. A character with darkvision and light sensitivity sees the dark only faintly, and
	 * outdoors the daylight glares for them. Outdoors, tells screen reader users as the part of the day
	 * changes; indoors the light doesn't change with it. Runs before updateFog, so the fog is drawn again in
	 * the same frame when the glare starts or stops showing
	 */
	private updateDaylight(): void
	{
		const own = this.room.state.players?.get(this.ownPlayerId);

		if (!own)
		{
			return;
		}

		const seconds = this.secondOfDayAt(this.cellOf(own));
		const light = areaLight(this.area.lightLevel, seconds);
		const outdoors = (this.area.lightLevel === null);
		const darkAdapted = ((own.darkvision > 0) && own.lightSensitivity);
		const nightAlpha = (darkAdapted ? DARK_ADAPTED_NIGHT_ALPHA : NIGHT_ALPHA);

		// With neighbors, each area is darkened by its own light, so a dark cave beside a sunlit field shows as
		// one, and where no area lies is darkened by the light of an area beside it
		if (this.areaNight)
		{
			const alphas = new Map([[PLAYER_PLACE, (1 - light) * nightAlpha]]);

			this.night?.setAlpha(0);
			this.areaNight.setAlpha((1 - light) * nightAlpha);

			for (const { slot, night } of this.drawnNeighbors)
			{
				// The neighbor's cell nearest the player, for a faerie area whose time changes across it
				const neighbor = this.payloadOf(slot.areaId);
				const ownCell = this.cellOf(own);
				const nearest = {
					column: Math.min(Math.max(ownCell.column - slot.columnOffset, neighbor.bounds.minColumn), neighbor.bounds.maxColumn),
					row: Math.min(Math.max(ownCell.row - slot.rowOffset, neighbor.bounds.minRow), neighbor.bounds.maxRow)
				};
				const alpha = (1 - areaLight(neighbor.lightLevel, this.secondOfDayIn(neighbor, nearest))) * nightAlpha;

				night.setAlpha(alpha);
				alphas.set(placeKeyOf(slot.columns, slot.rows), alpha);
			}

			this.placeNightAlphas = alphas;

			for (const [place, graphics] of this.emptyNights)
			{
				graphics.setAlpha(alphas.get(place) ?? 0);
			}
		}
		else
		{
			this.night?.setAlpha((1 - light) * nightAlpha);
		}

		const glareAlpha = ((darkAdapted && outdoors) ? light * GLARE_ALPHA : 0);
		const glaring = (glareAlpha > 0);

		this.glare?.setUniform('uAlpha', glareAlpha);

		if (glaring !== this.glaring)
		{
			this.glaring = glaring;
			this.fogKey = '';
		}

		if (outdoors)
		{
			this.announcer.partOfDayChanged(partOfDay(seconds));
		}
	}

	/**
	 * The time of day at a cell of the area
	 *
	 * @param cell The cell
	 * @return Seconds since midnight
	 */
	private secondOfDayAt(cell: { column: number; row: number }): number
	{
		return(this.secondOfDayIn(this.area, cell));
	}

	/**
	 * The time of day at a cell of an area the scene draws, by that area's passage of time
	 *
	 * @param area The area: the player's, or a neighboring one
	 * @param cell The cell, in the area
	 * @return Seconds since midnight
	 */
	private secondOfDayIn(area: AreaPayload, cell: { column: number; row: number }): number
	{
		// A lobby has no clock: its time of day never flows with the players' actions
		const clock = (this.room.state.clock as number | undefined) ?? 0;

		return(secondOfDay(area.time, clock, Date.now(), cell, area.bounds));
	}

	/**
	 * Starts drawing an area in place of the one before
	 *
	 * @param area The area
	 */
	private enterArea(area: AreaPayload): void
	{
		// The room sends the areas around it again after it
		this.neighbors.clear();
		this.showArea(area, new Map(area.chunks.map((chunk) => [chunkKey(chunk.chunkColumn, chunk.chunkRow), chunk.cells])));
	}

	/**
	 * Draws an area as the player's, with the neighboring areas the scene knows around it
	 *
	 * @param area The area
	 * @param chunks Its chunks, by chunkKey()
	 */
	private showArea(area: AreaPayload, chunks: Map<string, number[]>): void
	{
		this.area = area;
		this.chunks = chunks;
		this.manualLinks = new Set(area.links.filter((link) => (link.mode === 'manual')).map((link) => `${link.column},${link.row}`));

		const vision = visionOf(area, this.chunks);

		// An area with neighbors sees across its seams into theirs
		this.visionArea = (hasNeighbors(area.sides)
			? {
				...vision,
				clear: false,
				beyond: (column, row) =>
				{
					const found = locateCell(this.seamLookup, area.areaId, column, row);
					const across = ((found?.areaId === area.areaId) ? vision : ((found === undefined) ? undefined : this.neighbors.get(found.areaId)?.vision));

					return(((found && across) ? across.visionCost(found.column, found.row) : undefined));
				}
			}
			: vision);
		this.chunkRevision++;
		this.drawArea();

		// Tiles with uploaded graphics are drawn in their colors until the graphics arrive
		void loadUploadedTileGraphics(this, area.tiles).then((loaded) =>
		{
			if (loaded && (this.area === area) && this.areaRenderer && this.scene.isActive())
			{
				this.drawArea();
			}
		});
	}

	/**
	 * Draws the player's area and the neighboring areas around it afresh, where the origin puts them, each
	 * with a darkening of its own when the area has neighbors
	 */
	private drawArea(): void
	{
		const { bounds } = this.area;

		this.areaRenderer?.destroy();
		this.areaRenderer = new AreaRenderer(this, this.area, this.chunks, this.worldOffset(0, 0));
		this.areaNight?.destroy();
		this.areaNight = (this.hasSeams() ? this.nightOver(bounds, 0, 0) : undefined);
		this.drawNeighbors();
	}

	/**
	 * Draws the neighboring areas the scene knows around the player's area, in place of those drawn before
	 */
	private drawNeighbors(): void
	{
		this.clearNeighbors();

		if (!this.hasSeams())
		{
			return;
		}

		for (const slot of seamSlots(this.seamLookup, this.area.areaId))
		{
			const neighbor = ((slot.areaId === this.area.areaId) ? { payload: this.area, chunks: this.chunks } : this.neighbors.get(slot.areaId));

			if (!neighbor)
			{
				continue;
			}

			// Each place draws the area once, its own loops left to the places around it
			const payload: AreaPayload = { ...neighbor.payload, loopsEastWest: false, loopsNorthSouth: false };

			this.drawnNeighbors.push({
				slot,
				renderer: new AreaRenderer(this, payload, neighbor.chunks, this.worldOffset(slot.columnOffset, slot.rowOffset)),
				night: this.nightOver(payload.bounds, slot.columnOffset, slot.rowOffset)
			});
		}
	}

	/**
	 * Removes the neighboring areas drawn
	 */
	private clearNeighbors(): void
	{
		for (const { renderer, night } of this.drawnNeighbors)
		{
			renderer.destroy();
			night.destroy();
		}

		this.drawnNeighbors = [];
	}

	/**
	 * Where an area's cells are drawn in the world, in world units: those of the player's area at the
	 * origin, and those of a neighboring area moved to line up with it
	 *
	 * @param columnOffset How many columns the area is moved from the player's area
	 * @param rowOffset How many rows
	 * @return The offset
	 */
	private worldOffset(columnOffset: number, rowOffset: number): { x: number; y: number }
	{
		return({
			x: (this.origin.column + columnOffset) * GRID_CELL_SIZE,
			y: (this.origin.row + rowOffset) * GRID_CELL_SIZE
		});
	}

	/**
	 * A darkening over an area drawn in the world, faded by updateDaylight()
	 *
	 * @param bounds The area's bounds
	 * @param columnOffset How many columns it is moved from the player's area
	 * @param rowOffset How many rows
	 * @return The darkening
	 */
	private nightOver(bounds: AreaBounds, columnOffset: number, rowOffset: number): Phaser.GameObjects.Rectangle
	{
		const offset = this.worldOffset(columnOffset, rowOffset);

		return(this.add.rectangle((bounds.minColumn * GRID_CELL_SIZE) + offset.x, (bounds.minRow * GRID_CELL_SIZE) + offset.y, ((bounds.maxColumn - bounds.minColumn) + 1) * GRID_CELL_SIZE, ((bounds.maxRow - bounds.minRow) + 1) * GRID_CELL_SIZE, NIGHT_COLOR)
			.setOrigin(0, 0)
			.setDepth(NIGHT_DEPTH)
			.setAlpha(0));
	}

	/**
	 * Whether the area the room says the player is now in is one drawn across a seam, which they have
	 * walked into
	 *
	 * @param areaId The area's ID
	 * @return Where it is drawn nearest the player, or undefined when it isn't drawn beside the area
	 */
	private crossingInto(areaId: string): SeamSlot | undefined
	{
		const own = this.players.get(this.ownPlayerId)?.lastPosition;
		const slots = this.drawnNeighbors
			.map((drawn) => drawn.slot)
			.filter((slot) => (slot.areaId === areaId));

		if (!own || (slots.length === 0))
		{
			return(slots[0]);
		}

		const distance = (slot: SeamSlot): number =>
		{
			const bounds = this.payloadOf(slot.areaId).bounds;
			const offset = this.worldOffset(slot.columnOffset, slot.rowOffset);
			const centerX = ((((bounds.minColumn + bounds.maxColumn) + 1) / 2) * GRID_CELL_SIZE) + offset.x;
			const centerY = ((((bounds.minRow + bounds.maxRow) + 1) / 2) * GRID_CELL_SIZE) + offset.y;

			return(Math.hypot(centerX - own.x, centerY - own.y));
		};

		return(slots.reduce((nearest, slot) => ((distance(slot) < distance(nearest)) ? slot : nearest)));
	}

	/**
	 * Makes the area the player has walked into across a seam their area, drawn where it was: the area they
	 * left becomes one of its neighbors, and the room sends the rest after
	 *
	 * @param area The area they walked into
	 * @param slot Where it was drawn
	 */
	private crossInto(area: AreaPayload, slot: SeamSlot): void
	{
		const left = this.area;

		this.neighbors.set(left.areaId, {
			payload: left,
			chunks: this.chunks,
			vision: visionOf(left, this.chunks)
		});

		const known = this.neighbors.get(area.areaId)?.chunks;
		const chunks = (known ?? new Map<string, number[]>());

		for (const chunk of area.chunks)
		{
			chunks.set(chunkKey(chunk.chunkColumn, chunk.chunkRow), chunk.cells);
		}

		this.neighbors.delete(area.areaId);
		this.origin = {
			column: this.origin.column + slot.columnOffset,
			row: this.origin.row + slot.rowOffset
		};
		this.showArea(area, chunks);
	}

	/**
	 * Takes in the areas across the seams of the player's area, with their chunks near the player, and
	 * draws them beside it
	 *
	 * @param payload The areas
	 */
	private receiveNeighbors(payload: NeighborAreasPayload): void
	{
		if (payload.areaId !== this.area.areaId)
		{
			return;
		}

		for (const area of payload.areas)
		{
			const chunks = new Map(area.chunks.map((chunk) => [chunkKey(chunk.chunkColumn, chunk.chunkRow), chunk.cells]));

			this.neighbors.set(area.areaId, {
				payload: area,
				chunks,
				vision: visionOf(area, chunks)
			});

			void loadUploadedTileGraphics(this, area.tiles).then((loaded) =>
			{
				if (loaded && (this.neighbors.get(area.areaId)?.payload === area) && this.scene.isActive())
				{
					this.drawNeighbors();
				}
			});
		}

		this.chunkRevision++;
		this.drawNeighbors();
	}

	/**
	 * Takes in chunks of the area the player has come near or an editor has changed, and redraws them
	 *
	 * @param payload The chunks
	 */
	private receiveChunks(payload: ChunksPayload): void
	{
		const own = (payload.areaId === this.area.areaId);
		const chunks = (own ? this.chunks : this.neighbors.get(payload.areaId)?.chunks);

		// Chunks of an area the player has since left, or no longer sees across a seam
		if (!chunks)
		{
			return;
		}

		const keys: string[] = [];

		for (const chunk of payload.chunks)
		{
			const key = chunkKey(chunk.chunkColumn, chunk.chunkRow);

			if (chunk.cells)
			{
				chunks.set(key, chunk.cells);
			}
			else
			{
				chunks.delete(key);
			}

			keys.push(key);
		}

		this.chunkRevision++;
		this.renderersOf(payload.areaId).forEach((renderer) =>
		{
			renderer.refreshChunks(keys);
		});
	}

	/**
	 * The renderers drawing an area: the player's area's, and each place it is drawn across a seam
	 *
	 * @param areaId The area's ID
	 * @return The renderers
	 */
	private renderersOf(areaId: string): AreaRenderer[]
	{
		return([
			...(((areaId === this.area.areaId) && this.areaRenderer) ? [this.areaRenderer] : []),
			...this.drawnNeighbors
				.filter((drawn) => (drawn.slot.areaId === areaId))
				.map((drawn) => drawn.renderer)
		]);
	}

	/**
	 * Takes in the tiles of cells the group has just seen for the first time, with the links on them, and
	 * draws them. A cell in a chunk this window doesn't hold is left for the chunk, which carries it
	 *
	 * @param payload The cells
	 */
	private receiveCellsSeen(payload: CellsSeenPayload): void
	{
		const own = (payload.areaId === this.area.areaId);
		const chunks = (own ? this.chunks : this.neighbors.get(payload.areaId)?.chunks);

		if (!chunks)
		{
			return;
		}

		const changed: CellValue[] = [];

		for (const cell of payload.cells)
		{
			const chunk = chunks.get(chunkKey(chunkCoordinate(cell.column), chunkCoordinate(cell.row)));

			if (chunk)
			{
				chunk[cellIndexInChunk(cell.column, cell.row)] = cell.value;
				changed.push(cell);
			}
		}

		// Links matter only where the player stands
		for (const link of (own ? payload.links : []))
		{
			if (link.mode === 'manual')
			{
				this.manualLinks.add(`${link.column},${link.row}`);
			}
		}

		this.chunkRevision++;
		this.renderersOf(payload.areaId).forEach((renderer) =>
		{
			renderer.refreshCells(changed);
		});
	}

	/**
	 * An area's name in the player's language
	 *
	 * @param area The area as the room sent it
	 * @return The name
	 */
	private areaName(area: AreaPayload): string
	{
		return((this.text?.areaName(area) ?? area.name));
	}

	/**
	 * Draws the player, and so the camera following them, where they are in the area they have just
	 * entered, rather than reaching it smoothly from where they were in the area they left
	 *
	 * The server sends the area after the patch with the player's position in it, so the state holds
	 * where they arrived. Players in the old area are removed and those in the new one added through the
	 * state, like any other player coming and going
	 */
	private placeOwnPlayer(): void
	{
		const own = this.players.get(this.ownPlayerId);
		const state = this.room.state.players?.get(this.ownPlayerId);

		if (!own)
		{
			return;
		}

		own.positions.clear();
		own.lastPosition = undefined;

		if (state)
		{
			const position = this.worldPosition(state);

			this.trackPosition(own, state);
			own.shape.setPosition(position.x, position.y);
			own.label.setPosition(position.x, position.y - PLAYER_RADIUS - NAME_OFFSET);

			// The camera moves to the player as the frame renders, after update() has drawn the area around
			// its view; moving it now draws the area where they arrived, not where they were
			this.cameras.main.preRender();
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
			const start = this.worldPosition(player);

			shape.setPosition(start.x, start.y);

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
				id: 'area.ghost',
				defaultMessage: 'Ghost',
				description: 'Shown above the player in the lobby\'s area while they play no character: they are a ghost, whom other players can\'t see'
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
		const world = this.worldPosition(player, rendered.lastPosition);
		const position = (rendered.lastPosition ? this.nearestTo(world, rendered.lastPosition) : world);

		rendered.lastPosition = position;
		rendered.positions.push(performance.now(), position.x, position.y);
	}

	/**
	 * Where a player is in the world: in the player's area, past its origin, or in a neighboring area,
	 * where that area is drawn across the seam (nearest a position, when it is drawn in more than one place)
	 *
	 * @param player The player's synced state
	 * @param near The position to be near, such as where the player was last drawn
	 * @return The position in world units
	 */
	private worldPosition(player: Player, near?: Point): Point
	{
		const own = this.worldOffset(0, 0);
		const inOwn = {
			x: player.x + own.x,
			y: player.y + own.y
		};

		if ((player.areaId === this.area.areaId) || (player.areaId === ''))
		{
			return(inOwn);
		}

		const reference = (near ?? this.players.get(this.ownPlayerId)?.lastPosition ?? inOwn);
		let nearest: Point | undefined;

		for (const { slot } of this.drawnNeighbors)
		{
			if (slot.areaId !== player.areaId)
			{
				continue;
			}

			const offset = this.worldOffset(slot.columnOffset, slot.rowOffset);
			const candidate = {
				x: player.x + offset.x,
				y: player.y + offset.y
			};

			if (!nearest || (Math.hypot(candidate.x - reference.x, candidate.y - reference.y) < Math.hypot(nearest.x - reference.x, nearest.y - reference.y)))
			{
				nearest = candidate;
			}
		}

		return(nearest ?? inOwn);
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
		// An area with neighbors loops only through its seams, where its far side is drawn as a neighbor
		if (!this.areaRenderer || this.hasSeams())
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
	 * Hands the keyboard to the page while focus is somewhere that needs the movement keys, and takes it
	 * back afterward
	 *
	 * While the game has the keyboard it blocks the movement keys' normal effect on the whole page, which
	 * would stop W, A, S, D and E being typed into the chat and the arrow keys working a select or a dialog
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

			const pageNeedsKeys = needsMovementKeys(document.activeElement);

			if (pageNeedsKeys && keyboard.enabled)
			{
				this.stopMoving();
				keyboard.enabled = false;
				keyboard.disableGlobalCapture();
			}
			else if (!pageNeedsKeys && !keyboard.enabled)
			{
				keyboard.enabled = true;
				keyboard.enableGlobalCapture();
			}
		});
	};

	/**
	 * Adds the shortcut that reads out where the player is, and lists the keys that play, while the area shows
	 *
	 * @param areaElement The element the area is in
	 */
	private addKeys(areaElement: HTMLElement): void
	{
		this.unbinds.push(addShortcut({
			keys: 'Alt+P',
			scope: areaElement,
			description: () => t({
				id: 'area.keys.position',
				defaultMessage: 'Say where you are and who you can see',
				description: 'In the list of keyboard shortcuts, what the shortcut that reads out the player\'s position does'
			}),
			run: () =>
			{
				this.describePosition();
			}
		}));

		this.unbinds.push(addKeyHelp({
			scope: areaElement,
			keys: () => t({
				id: 'area.keys.move',
				defaultMessage: 'Arrow keys, W A S D or number pad',
				description: 'In the list of keyboard shortcuts, the keys that move the player; the keys are the same in every language'
			}),
			description: () => t({
				id: 'area.keys.moveDescription',
				defaultMessage: 'Move',
				description: 'In the list of keyboard shortcuts, what the movement keys do'
			})
		}));

		this.unbinds.push(addKeyHelp({
			scope: areaElement,
			keys: () => 'E',
			description: () => t({
				id: 'area.keys.takeLink',
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
		const ownWorld = this.worldPosition(own);

		// Players across a seam are counted from where they are drawn beside the area
		this.room.state.players.forEach((player, playerId) =>
		{
			if (playerId !== this.ownPlayerId)
			{
				const nearest = this.nearestTo(this.worldPosition(player, ownWorld), ownWorld);

				others.push({
					name: player.name,
					columns: Math.floor(nearest.x / GRID_CELL_SIZE) - Math.floor(ownWorld.x / GRID_CELL_SIZE),
					rows: Math.floor(nearest.y / GRID_CELL_SIZE) - Math.floor(ownWorld.y / GRID_CELL_SIZE)
				});
			}
		});

		this.announcer.describePosition({
			areaName: this.areaName(this.area),
			column,
			row,
			tileName: (tile ? (this.text?.tileName(tile, this.area.ruleset) ?? tileName(tile, this.area.ruleset)) : undefined),
			secondOfDay: seconds,
			displayTime: this.area.displayTime,
			sightSquares: (this.area.fogOfWar ? Math.floor(visionBudget(areaLight(this.area.lightLevel, seconds), own)) : undefined)
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
