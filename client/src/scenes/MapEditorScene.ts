import Phaser from 'phaser';
import { CHUNK_SIZE, chunkCoordinate, GRID_CELL_SIZE, type ChunkRange, type AreaLinkMode, type AreaPayload } from '@multiverse-kiln/shared';

import { brushOrigin, cellsBetween, type BrushCell, type BrushShape } from '../editor/brush';
import { AreaRenderer } from '../rendering/AreaRenderer';
import { loadUploadedTileGraphics, preloadTileGraphics } from '../rendering/tileGraphics';

/**
 * Key the scene is registered under in each editor's game
 */
export const MAP_EDITOR_SCENE_KEY = 'MapEditorScene';

const MIN_ZOOM = 0.1;

const MAX_ZOOM = 2;

/**
 * How much one turn of the mouse wheel zooms
 */
const ZOOM_STEP = 1.25;

/**
 * How far beyond the view, in cells, chunks are asked for, so they are there before they scroll in
 */
const LOAD_MARGIN = CHUNK_SIZE;

const BOUNDS_COLOR = 0xffffff;

const CENTER_COLOR = 0xffffff;

const BRUSH_COLOR = 0xffeb3b;

const LINK_COLORS: Record<AreaLinkMode, number> = {
	automatic: 0xff9800,
	manual: 0x00e5ff
};

/**
 * A cell with a link, as the editor marks it
 */
export interface LinkMarker
{
	column: number;
	row: number;
	mode: AreaLinkMode;
}

/**
 * A cell the editor highlights, such as a link's chosen destination
 */
export interface CellHighlight
{
	column: number;
	row: number;
	color: number;
}

/**
 * What a click on the map does
 *
 * - paint: the draw tool paints, and dragging keeps painting
 * - pick: the cell clicked is chosen, e.g. for a link
 * - none: the map can only be looked around
 */
export type PointerMode = 'paint' | 'pick' | 'none';

/**
 * Whoever shows the scene: what clicks do, and what the scene tells it
 */
export interface MapEditorHost
{
	/**
	 * What a left click does now
	 */
	pointerMode: () => PointerMode;

	/**
	 * The draw tool's brush, for outlining it under the pointer
	 */
	brush: () => { size: number; shape: BrushShape };

	/**
	 * A stroke of the draw tool starts
	 */
	paintStart: () => void;

	/**
	 * The brush is dabbed with the pointer over a cell
	 */
	paint: (column: number, row: number) => void;

	/**
	 * The stroke ends: the button is released, or the pointer leaves the game
	 */
	paintEnd: () => void;

	/**
	 * A cell is clicked in pick mode
	 */
	pick: (column: number, row: number) => void;

	/**
	 * The pointer moves over a cell, or off the map's canvas, or the keyboard's cursor moves to a cell
	 */
	hover: (cell: BrushCell | undefined) => void;

	/**
	 * A cell and what it holds in words, read out when the keyboard's cursor moves onto it
	 */
	describe: (cell: BrushCell) => string;

	/**
	 * The chunks in or near the view have changed, so any not yet loaded should be
	 */
	viewChanged: (range: ChunkRange) => void;
}

/**
 * Where the camera is looking and how far it is zoomed
 */
export interface CameraState
{
	scrollX: number;
	scrollY: number;
	zoom: number;
}

/**
 * Data the scene is started with
 */
export interface MapEditorSceneData
{
	/**
	 * Where the camera starts, or undefined to center on the area's center cell
	 */
	camera: CameraState | undefined;

	/**
	 * The area's bounds, default tile and tiles. Its chunks are ignored in favor of chunks
	 */
	area: AreaPayload;

	/**
	 * The area's loaded chunks, by chunkKey(); the host changes them and calls refreshChunks
	 */
	chunks: ReadonlyMap<string, readonly number[]>;

	host: MapEditorHost;

	/**
	 * Called once the scene is ready to take calls
	 */
	onReady: (scene: MapEditorScene) => void;
}

/**
 * Shows an area's map for editing: the same grid as gameplay, with the map's edges, its center cell,
 * its links and the brush outlined on top
 *
 * Left clicks paint or pick cells (see PointerMode); dragging with the right or middle button pans,
 * and Ctrl+wheel zooms around the pointer. MapCanvas does the same from the keyboard with a
 * cursor, which the scene outlines like the pointer. A looping area is shown once, without its far side
 * repeated, so every cell on screen is a cell that can be edited
 */
export class MapEditorScene extends Phaser.Scene
{
	private area!: AreaPayload;
	private startCamera: CameraState | undefined;
	private chunks!: ReadonlyMap<string, readonly number[]>;
	private host!: MapEditorHost;
	private onReady!: (scene: MapEditorScene) => void;
	private areaRenderer?: AreaRenderer;
	private overlay?: Phaser.GameObjects.Graphics;
	private links: LinkMarker[] = [];
	private highlights: CellHighlight[] = [];

	/**
	 * The cell under the pointer, while it is over the canvas
	 */
	private hovered: BrushCell | undefined;

	/**
	 * The last cell dabbed in the stroke being painted, or undefined when no stroke is under way
	 */
	private lastDab: BrushCell | undefined;

	/**
	 * Where a pan started: the pointer's screen position and the camera's scroll then
	 */
	private panStart: {
		x: number;
		y: number;
		scrollX: number;
		scrollY: number
	} | undefined;

	/**
	 * The chunk range last reported to the host, as a string, so it is only reported when it changes
	 */
	private lastViewKey = '';

	constructor()
	{
		super(MAP_EDITOR_SCENE_KEY);
	}

	/**
	 * Resets per-run state (runs on every start, unlike the constructor)
	 *
	 * @param data The area to show and whoever shows it
	 */
	init(data: MapEditorSceneData): void
	{
		this.area = {
			...data.area,
			loopsEastWest: false,
			loopsNorthSouth: false
		};
		this.startCamera = data.camera;
		this.chunks = data.chunks;
		this.host = data.host;
		this.onReady = data.onReady;
		this.areaRenderer = undefined;
		this.overlay = undefined;
		this.links = [];
		this.highlights = [];
		this.hovered = undefined;
		this.lastDab = undefined;
		this.panStart = undefined;
		this.lastViewKey = '';
	}

	/**
	 * Loads the tile graphics the map is drawn with
	 */
	preload(): void
	{
		preloadTileGraphics(this);
	}

	/**
	 * Draws the map centered on its center cell, and listens to the pointer
	 */
	create(): void
	{
		this.areaRenderer = new AreaRenderer(this, this.area, this.chunks);
		this.overlay = this.add.graphics().setDepth(1);

		// Tiles with uploaded graphics are drawn in their colors until the graphics arrive
		const area = this.area;

		void loadUploadedTileGraphics(this, area.tiles).then((loaded) =>
		{
			if (loaded && (this.area === area) && this.areaRenderer && this.scene.isActive())
			{
				this.areaRenderer.destroy();
				this.areaRenderer = new AreaRenderer(this, area, this.chunks);
			}
		});

		if (this.startCamera)
		{
			this.cameras.main.setZoom(this.startCamera.zoom).setScroll(this.startCamera.scrollX, this.startCamera.scrollY);
		}
		else
		{
			this.centerOnCell(0, 0);
		}

		this.input.mouse?.disableContextMenu();

		this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown);
		this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove);
		this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp);
		this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp);
		this.input.on(Phaser.Input.Events.GAME_OUT, this.onPointerOut);
		this.input.on(Phaser.Input.Events.POINTER_WHEEL, this.onWheel);

		this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
		{
			this.finishStroke();
			this.input.removeAllListeners();
			this.areaRenderer?.destroy();
			this.areaRenderer = undefined;
		});

		this.onReady(this);
	}

	/**
	 * Draws the map around the camera and the outlines on top, and tells the host when the view moves on to other chunks
	 */
	update(): void
	{
		const view = this.cameras.main.worldView;

		this.areaRenderer?.update(view);
		this.reportView(view);
		this.drawOverlay();
	}

	/**
	 * Redraws the chunks the host has changed or loaded
	 *
	 * @param chunkKeys The chunks, by chunkKey()
	 */
	refreshChunks(chunkKeys: Iterable<string>): void
	{
		this.areaRenderer?.refreshChunks(chunkKeys);
	}

	/**
	 * Sets the links to mark
	 *
	 * @param links The cells with links
	 */
	setLinks(links: LinkMarker[]): void
	{
		this.links = links;
	}

	/**
	 * Sets the cells to highlight
	 *
	 * @param highlights The cells and their colors
	 */
	setHighlights(highlights: CellHighlight[]): void
	{
		this.highlights = highlights;
	}

	/**
	 * Where the camera is, for starting the scene again in the same place
	 *
	 * @return The camera's scroll and zoom
	 */
	cameraState(): CameraState
	{
		const camera = this.cameras.main;

		return({
			scrollX: camera.scrollX,
			scrollY: camera.scrollY,
			zoom: camera.zoom
		});
	}

	/**
	 * Moves the camera to a cell
	 *
	 * @param column The cell's column
	 * @param row The cell's row
	 */
	centerOnCell(column: number, row: number): void
	{
		this.cameras.main.centerOn((column + 0.5) * GRID_CELL_SIZE, (row + 0.5) * GRID_CELL_SIZE);
	}

	/**
	 * Outlines the brush on the keyboard's cursor, as it is outlined under the pointer, and moves the
	 * camera to the cursor when it reaches the edge of the view
	 *
	 * @param cell The cursor's cell
	 */
	showCursor(cell: BrushCell): void
	{
		const view = this.cameras.main.worldView;
		const x = (cell.column + 0.5) * GRID_CELL_SIZE;
		const y = (cell.row + 0.5) * GRID_CELL_SIZE;

		this.hovered = cell;

		if ((x < (view.x + GRID_CELL_SIZE)) || (x > (view.right - GRID_CELL_SIZE)) || (y < (view.y + GRID_CELL_SIZE)) || (y > (view.bottom - GRID_CELL_SIZE)))
		{
			this.centerOnCell(cell.column, cell.row);
		}
	}

	/**
	 * Zooms in or out one step around the middle of the view, as one turn of the mouse wheel with Ctrl does
	 *
	 * @param zoomIn True to zoom in, false to zoom out
	 */
	zoomStep(zoomIn: boolean): void
	{
		const camera = this.cameras.main;

		camera.setZoom(Phaser.Math.Clamp((zoomIn ? camera.zoom * ZOOM_STEP : camera.zoom / ZOOM_STEP), MIN_ZOOM, MAX_ZOOM));
	}

	/**
	 * Starts painting, picking or panning
	 *
	 * @param pointer The pointer
	 */
	private readonly onPointerDown = (pointer: Phaser.Input.Pointer): void =>
	{
		if (pointer.rightButtonDown() || pointer.middleButtonDown())
		{
			const camera = this.cameras.main;

			this.panStart = {
				x: pointer.x,
				y: pointer.y,
				scrollX: camera.scrollX,
				scrollY: camera.scrollY
			};
			return;
		}

		const cell = this.cellUnder(pointer);
		const mode = this.host.pointerMode();

		if (mode === 'pick')
		{
			this.host.pick(cell.column, cell.row);
		}
		else if (mode === 'paint')
		{
			this.host.paintStart();
			this.lastDab = cell;
			this.host.paint(cell.column, cell.row);
		}
	};

	/**
	 * Pans, or paints along the way the pointer moved since the last dab
	 *
	 * @param pointer The pointer
	 */
	private readonly onPointerMove = (pointer: Phaser.Input.Pointer): void =>
	{
		const cell = this.cellUnder(pointer);

		if (this.panStart)
		{
			const camera = this.cameras.main;

			camera.setScroll(
				this.panStart.scrollX - ((pointer.x - this.panStart.x) / camera.zoom),
				this.panStart.scrollY - ((pointer.y - this.panStart.y) / camera.zoom)
			);
		}

		if (!this.hovered || (this.hovered.column !== cell.column) || (this.hovered.row !== cell.row))
		{
			this.hovered = cell;
			this.host.hover(cell);
		}

		if (this.lastDab && ((this.lastDab.column !== cell.column) || (this.lastDab.row !== cell.row)))
		{
			// A large brush needn't dab every cell along the way to cover it
			const spacing = Math.max(1, Math.floor(this.host.brush().size / 4));

			for (const step of cellsBetween(this.lastDab, cell, spacing).slice(1))
			{
				this.host.paint(step.column, step.row);
			}

			this.lastDab = cell;
		}
	};

	/**
	 * Ends a stroke or a pan
	 */
	private readonly onPointerUp = (): void =>
	{
		this.panStart = undefined;
		this.finishStroke();
	};

	/**
	 * Forgets the hovered cell when the pointer leaves the canvas
	 */
	private readonly onPointerOut = (): void =>
	{
		this.hovered = undefined;
		this.host.hover(undefined);
	};

	/**
	 * Zooms in or out while Ctrl is held, keeping the point under the pointer where it is. Without Ctrl
	 * the wheel scrolls the page
	 *
	 * @param pointer The pointer
	 * @param _over Game objects under the pointer
	 * @param _deltaX Horizontal wheel movement
	 * @param deltaY Vertical wheel movement: negative zooms in
	 */
	private readonly onWheel = (pointer: Phaser.Input.Pointer, _over: unknown, _deltaX: number, deltaY: number): void =>
	{
		if (!pointer.event.ctrlKey)
		{
			return;
		}

		const camera = this.cameras.main;
		const zoom = Phaser.Math.Clamp(((deltaY < 0) ? camera.zoom * ZOOM_STEP : camera.zoom / ZOOM_STEP), MIN_ZOOM, MAX_ZOOM);
		const halfWidth = camera.width / 2;
		const halfHeight = camera.height / 2;

		// The camera zooms around its center: a screen point is (screen - half) / zoom from the center of the view
		const worldX = camera.scrollX + halfWidth + ((pointer.x - halfWidth) / camera.zoom);
		const worldY = camera.scrollY + halfHeight + ((pointer.y - halfHeight) / camera.zoom);

		camera.setZoom(zoom);
		camera.setScroll(
			worldX - halfWidth - ((pointer.x - halfWidth) / zoom),
			worldY - halfHeight - ((pointer.y - halfHeight) / zoom)
		);
	};

	/**
	 * Ends the stroke being painted, if there is one
	 */
	private finishStroke(): void
	{
		if (this.lastDab)
		{
			this.lastDab = undefined;
			this.host.paintEnd();
		}
	}

	/**
	 * The cell under the pointer
	 *
	 * @param pointer The pointer
	 * @return The cell
	 */
	private cellUnder(pointer: Phaser.Input.Pointer): BrushCell
	{
		const point = this.cameras.main.getWorldPoint(pointer.x, pointer.y);

		return({
			column: Math.floor(point.x / GRID_CELL_SIZE),
			row: Math.floor(point.y / GRID_CELL_SIZE)
		});
	}

	/**
	 * Tells the host which chunks are in or near the view, when that changes
	 *
	 * @param view The camera's view of the world
	 */
	private reportView(view: Phaser.Geom.Rectangle): void
	{
		const margin = LOAD_MARGIN * GRID_CELL_SIZE;
		const range: ChunkRange = {
			minChunkColumn: chunkCoordinate(Math.floor((view.x - margin) / GRID_CELL_SIZE)),
			minChunkRow: chunkCoordinate(Math.floor((view.y - margin) / GRID_CELL_SIZE)),
			maxChunkColumn: chunkCoordinate(Math.floor((view.right + margin) / GRID_CELL_SIZE)),
			maxChunkRow: chunkCoordinate(Math.floor((view.bottom + margin) / GRID_CELL_SIZE))
		};
		const key = `${range.minChunkColumn},${range.minChunkRow},${range.maxChunkColumn},${range.maxChunkRow}`;

		if (key !== this.lastViewKey)
		{
			this.lastViewKey = key;
			this.host.viewChanged(range);
		}
	}

	/**
	 * Outlines the map's edges, its center cell, its links, the highlighted cells and the brush
	 */
	private drawOverlay(): void
	{
		const overlay = this.overlay;

		if (!overlay)
		{
			return;
		}

		// Lines stay the same width on screen however far the camera zooms
		const line = 2 / this.cameras.main.zoom;
		const { bounds } = this.area;

		overlay.clear();
		overlay.lineStyle(line, BOUNDS_COLOR, 0.8);
		overlay.strokeRect(bounds.minColumn * GRID_CELL_SIZE, bounds.minRow * GRID_CELL_SIZE, ((bounds.maxColumn - bounds.minColumn) + 1) * GRID_CELL_SIZE, ((bounds.maxRow - bounds.minRow) + 1) * GRID_CELL_SIZE);
		overlay.lineStyle(line, CENTER_COLOR, 0.5);
		overlay.strokeRect(0, 0, GRID_CELL_SIZE, GRID_CELL_SIZE);

		for (const link of this.links)
		{
			overlay.fillStyle(LINK_COLORS[link.mode], 0.35);
			overlay.fillRect(link.column * GRID_CELL_SIZE, link.row * GRID_CELL_SIZE, GRID_CELL_SIZE, GRID_CELL_SIZE);
			overlay.lineStyle(line, LINK_COLORS[link.mode], 1);
			overlay.strokeRect(link.column * GRID_CELL_SIZE, link.row * GRID_CELL_SIZE, GRID_CELL_SIZE, GRID_CELL_SIZE);
		}

		for (const highlight of this.highlights)
		{
			overlay.lineStyle(line * 1.5, highlight.color, 1);
			overlay.strokeRect(highlight.column * GRID_CELL_SIZE, highlight.row * GRID_CELL_SIZE, GRID_CELL_SIZE, GRID_CELL_SIZE);
		}

		const mode = this.host.pointerMode();

		if (this.hovered && (mode !== 'none'))
		{
			const { size, shape } = ((mode === 'paint') ? this.host.brush() : { size: 1, shape: 'square' as const });
			const origin = brushOrigin(this.hovered.column, this.hovered.row, size);
			const extent = size * GRID_CELL_SIZE;

			overlay.lineStyle(line, BRUSH_COLOR, 1);

			if (shape === 'circle')
			{
				overlay.strokeCircle((origin.column * GRID_CELL_SIZE) + (extent / 2), (origin.row * GRID_CELL_SIZE) + (extent / 2), extent / 2);
			}
			else
			{
				overlay.strokeRect(origin.column * GRID_CELL_SIZE, origin.row * GRID_CELL_SIZE, extent, extent);
			}
		}
	}
}
