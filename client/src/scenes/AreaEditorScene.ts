import Phaser from 'phaser';
import { CHUNK_SIZE, chunkCoordinate, GRID_CELL_SIZE, isInBounds, NEIGHBOR_PREVIEW_CELLS, parseChunkKey, VOID_CELL, type AreaBounds, type ChunkRange, type AreaLinkMode, type AreaPayload } from '@multiverse-kiln/shared';

import { brushOrigin, cellsBetween, type BrushCell, type BrushShape } from '../editor/brush';
import { outlineRuns, type OutlineRun } from '../editor/cellOutlines';
import { AreaRenderer } from '../rendering/AreaRenderer';
import type { CellMaskShader } from '../rendering/CellMaskShader';
import { loadUploadedTileGraphics, preloadTileGraphics } from '../rendering/tileGraphics';
import { createUnexploredPaper, preloadUnexploredPaper } from '../rendering/UnexploredPaper';

/**
 * Key the scene is registered under in each editor's game
 */
export const AREA_EDITOR_SCENE_KEY = 'AreaEditorScene';

const MIN_ZOOM = 0.1;

const MAX_ZOOM = 2;

/**
 * How much one turn of the mouse wheel zooms
 */
const ZOOM_STEP = 1.25;

/**
 * How far the wheel pans for each line it turns, in screen pixels, when the browser measures the turn in lines
 */
const WHEEL_LINE_PIXELS = 16;

/**
 * How far the area pans for each pixel the wheel turns: half, since a whole turn moves the area too far to follow
 */
const WHEEL_PAN_SCALE = 0.25;

/**
 * How far the pointer may move, in screen pixels, between pressing and letting go of the middle button
 * for it to count as a click, which picks the cell's tile, rather than a pan
 */
const MIDDLE_CLICK_DISTANCE = 4;

/**
 * How far beyond the view, in cells, chunks are asked for, so they are there before they scroll in
 */
const LOAD_MARGIN = CHUNK_SIZE;

const BOUNDS_COLOR = 0xffffff;

const CENTER_COLOR = 0xffffff;

const BRUSH_COLOR = 0xffeb3b;

/**
 * Depth of the paper over Unexplored cells (VOID_CELL): over the tiles and the grid's lines, under the
 * outlines
 */
const PAPER_DEPTH = 0.5;

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
 * A neighboring area shown past an edge of the area being edited, dimmed and read-only (see Neighboring
 * areas in STRUCTURE-OVERVIEW.md)
 */
export interface NeighborPreview
{
	/**
	 * The neighbor, with bounds holding only the cells shown, in its own columns and rows
	 */
	area: AreaPayload;

	/**
	 * Its loaded chunks, by chunkKey(); the host changes them and calls refreshPreview
	 */
	chunks: ReadonlyMap<string, readonly number[]>;

	/**
	 * How far its cells are moved to line up with the area's: its cell at column c, row r is shown at
	 * column c + columnOffset, row r + rowOffset
	 */
	columnOffset: number;
	rowOffset: number;
}

/**
 * How dark the neighbors shown past the area's edges are made, so they read as not part of it
 */
const PREVIEW_DIM_ALPHA = 0.45;

/**
 * Depth of the darkening over the neighbors shown: over their tiles and grid lines, under the paper
 */
const PREVIEW_DIM_DEPTH = 0.3;

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
 * What a click on the area does
 *
 * - paint: the draw tool paints, and dragging keeps painting
 * - fill: the fill tool fills from the cell clicked
 * - pick: the cell clicked is chosen, e.g. for a link
 * - none: the area can only be looked around
 */
export type PointerMode = 'paint' | 'fill' | 'pick' | 'none';

/**
 * Whoever shows the scene: what clicks do, and what the scene tells it
 */
export interface AreaEditorHost
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
	 * A cell is clicked in fill mode
	 */
	fill: (column: number, row: number) => void;

	/**
	 * A cell is clicked with the middle button, whatever the mode, to choose its tile to paint with
	 */
	pickTile: (column: number, row: number) => void;

	/**
	 * A cell is clicked in pick mode
	 */
	pick: (column: number, row: number) => void;

	/**
	 * The pointer moves over a cell, or off the area's canvas, or the keyboard's cursor moves to a cell
	 */
	hover: (cell: BrushCell | undefined) => void;

	/**
	 * A cell and what it holds in words, read out when the keyboard's cursor moves onto it
	 */
	describe: (cell: BrushCell) => string;

	/**
	 * A click on a neighbor shown past the area's edge, or Space or Enter on the keyboard's cursor there,
	 * to open the neighbor's editor
	 */
	openNeighbor: (cell: BrushCell) => void;

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
export interface AreaEditorSceneData
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

	host: AreaEditorHost;

	/**
	 * Called once the scene is ready to take calls
	 */
	onReady: (scene: AreaEditorScene) => void;
}

/**
 * Shows an area's cells for editing: the same grid as gameplay, with the area's edges, its center cell,
 * its links and the brush outlined on top
 *
 * Left clicks paint, fill or pick cells (see PointerMode), and a middle click picks a cell's tile to paint
 * with; dragging with the right or middle button pans,
 * Ctrl+wheel zooms around the pointer, and the wheel alone pans while wheelPans is set. AreaCanvas
 * does the same from the keyboard with a cursor, which the scene outlines like the pointer. A looping area is shown once, without its far side
 * repeated, so every cell on screen is a cell that can be edited
 */
export class AreaEditorScene extends Phaser.Scene
{
	private area!: AreaPayload;
	private startCamera: CameraState | undefined;
	private chunks!: ReadonlyMap<string, readonly number[]>;
	private host!: AreaEditorHost;
	private onReady!: (scene: AreaEditorScene) => void;
	private areaRenderer?: AreaRenderer;
	private overlay?: Phaser.GameObjects.Graphics;
	private links: LinkMarker[] = [];

	/**
	 * The paper drawn over the Unexplored cells, as the game draws the parts of an area a group hasn't explored
	 */
	private paper?: CellMaskShader;

	/**
	 * Whether each cell is Unexplored, row by row from the top left of the area grown by the cells shown of
	 * its neighbors and a ring of cells around them (paperBounds()). The cells past the area that aren't a
	 * neighbor's are always Unexplored, and the paper carries the ring on past it, so everything outside
	 * the area and its neighbors is drawn as unexplored, as the game draws past an area's edges
	 */
	private unexplored = new Uint8Array(0);

	/**
	 * The neighboring areas shown past the area's edges, each with what draws it
	 */
	private previews: { preview: NeighborPreview; renderer: AreaRenderer; dim: Phaser.GameObjects.Rectangle }[] = [];

	/**
	 * Whether the Unexplored cells have changed since the paper was last drawn
	 */
	private paperChanged = false;

	/**
	 * The part of the world the paper is drawn over, kept from frame to frame
	 */
	private readonly paperArea = new Phaser.Geom.Rectangle();

	/**
	 * The highlighted cells' outlines, drawn apart from the overlay, which is drawn again every frame:
	 * there can be tens of thousands of them, as when another editor paints a large part of the area
	 */
	private highlightOverlay?: Phaser.GameObjects.Graphics;

	/**
	 * The highlighted cells' outlines, joined into runs
	 */
	private highlightRuns: OutlineRun[] = [];

	/**
	 * The zoom the highlights were last drawn at, since their lines stay the same width on screen; 0 when
	 * they must be drawn again
	 */
	private highlightZoom = 0;

	/**
	 * The cell under the pointer, while it is over the canvas
	 */
	private hovered: BrushCell | undefined;

	/**
	 * Whether the mouse is over the canvas
	 */
	private pointerOver = false;

	/**
	 * Whether the hovered cell is the keyboard's cursor rather than the cell under the pointer
	 */
	private keyboardCursor = false;

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
	 * Whether the pan under way started with the middle button, which picks the cell's tile when it is let
	 * go without having moved the area
	 */
	private middlePan = false;

	/**
	 * The chunk range last reported to the host, as a string, so it is only reported when it changes
	 */
	private lastViewKey = '';

	/**
	 * Whether the wheel pans the area, as when the area fills the window and the page can't scroll;
	 * otherwise the wheel scrolls the page
	 */
	wheelPans = false;

	constructor()
	{
		super(AREA_EDITOR_SCENE_KEY);
	}

	/**
	 * Resets per-run state (runs on every start, unlike the constructor)
	 *
	 * @param data The area to show and whoever shows it
	 */
	init(data: AreaEditorSceneData): void
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
		this.paper = undefined;
		this.unexplored = new Uint8Array(0);
		this.previews = [];
		this.paperChanged = false;
		this.highlightOverlay = undefined;
		this.highlightRuns = [];
		this.highlightZoom = 0;
		this.hovered = undefined;
		this.pointerOver = false;
		this.keyboardCursor = false;
		this.lastDab = undefined;
		this.panStart = undefined;
		this.middlePan = false;
		this.lastViewKey = '';
	}

	/**
	 * Loads the tile graphics the area is drawn with, and the paper Unexplored cells are drawn with
	 */
	preload(): void
	{
		preloadTileGraphics(this);
		preloadUnexploredPaper(this);
	}

	/**
	 * Draws the area centered on its center cell, and listens to the pointer
	 */
	create(): void
	{
		const { bounds } = this.area;
		const paper = this.paperBounds();
		const paperColumns = (paper.maxColumn - paper.minColumn) + 1;
		const paperRows = (paper.maxRow - paper.minRow) + 1;

		this.areaRenderer = new AreaRenderer(this, this.area, this.chunks);
		this.paper = createUnexploredPaper(this, paperColumns, paperRows, PAPER_DEPTH);
		this.unexplored = new Uint8Array(paperColumns * paperRows).fill(1);

		for (let row = bounds.minRow; row <= bounds.maxRow; row++)
		{
			const start = ((row - paper.minRow) * paperColumns) + (bounds.minColumn - paper.minColumn);

			this.unexplored.fill(0, start, start + (bounds.maxColumn - bounds.minColumn) + 1);
		}

		this.paperChanged = true;
		this.markUnexplored(this.chunks.keys());

		// Added first, so the brush is outlined over the highlights
		this.highlightOverlay = this.add.graphics().setDepth(1);
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

		// Capturing hears the scrolling of any element the canvas is in, as well as the page's
		window.addEventListener('scroll', this.onPageScroll, {
			capture: true,
			passive: true
		});

		this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
		{
			this.finishStroke();
			window.removeEventListener('scroll', this.onPageScroll, { capture: true });
			this.input.removeAllListeners();
			this.areaRenderer?.destroy();
			this.areaRenderer = undefined;
			this.clearPreviews();
		});

		this.onReady(this);
	}

	/**
	 * Draws the area around the camera and the outlines on top, and tells the host when the view moves on to other chunks
	 */
	update(): void
	{
		const view = this.cameras.main.worldView;

		this.areaRenderer?.update(view);

		for (const { renderer } of this.previews)
		{
			renderer.update(view);
		}

		this.reportView(view);
		this.drawPaper(view);
		this.drawOverlay();

		if (this.highlightZoom !== this.cameras.main.zoom)
		{
			this.drawHighlights();
		}
	}

	/**
	 * Redraws the chunks the host has changed or loaded
	 *
	 * @param chunkKeys The chunks, by chunkKey()
	 */
	refreshChunks(chunkKeys: Iterable<string>): void
	{
		const keys = [...chunkKeys];

		this.areaRenderer?.refreshChunks(keys);
		this.markUnexplored(keys);
	}

	/**
	 * Notes which cells of some chunks are Unexplored, for the paper to be drawn again when any changed
	 *
	 * @param chunkKeys The chunks, by chunkKey()
	 */
	private markUnexplored(chunkKeys: Iterable<string>): void
	{
		this.markCells(this.chunks, this.area.bounds, 0, 0, chunkKeys);
	}

	/**
	 * Notes which cells of some chunks of an area shown are Unexplored
	 *
	 * @param chunks The area's chunks, by chunkKey()
	 * @param bounds The cells of it shown, in its own columns and rows
	 * @param columnOffset How many columns its cells are moved to line up with the area being edited
	 * @param rowOffset How many rows
	 * @param chunkKeys The chunks, by chunkKey()
	 */
	private markCells(chunks: ReadonlyMap<string, readonly number[]>, bounds: AreaBounds, columnOffset: number, rowOffset: number, chunkKeys: Iterable<string>): void
	{
		const paper = this.paperBounds();
		const columns = (paper.maxColumn - paper.minColumn) + 1;

		for (const key of chunkKeys)
		{
			const { chunkColumn, chunkRow } = parseChunkKey(key);
			const cells = chunks.get(key);

			for (let index = 0; index < (CHUNK_SIZE * CHUNK_SIZE); index++)
			{
				const column = (chunkColumn * CHUNK_SIZE) + (index % CHUNK_SIZE);
				const row = (chunkRow * CHUNK_SIZE) + Math.floor(index / CHUNK_SIZE);
				const shownColumn = column + columnOffset;
				const shownRow = row + rowOffset;

				if (!isInBounds(bounds, column, row) || !isInBounds(paper, shownColumn, shownRow))
				{
					continue;
				}

				const cell = ((shownRow - paper.minRow) * columns) + (shownColumn - paper.minColumn);
				const unexplored = ((cells?.[index] === VOID_CELL) ? 1 : 0);

				if (this.unexplored[cell] !== unexplored)
				{
					this.unexplored[cell] = unexplored;
					this.paperChanged = true;
				}
			}
		}
	}

	/**
	 * The cells the paper's Unexplored cells are noted for: the area, the cells of its neighbors shown past
	 * its edges, and a ring of cells around them
	 *
	 * @return The cells, inclusive at both ends
	 */
	private paperBounds(): AreaBounds
	{
		const { bounds } = this.area;
		const margin = NEIGHBOR_PREVIEW_CELLS + 1;

		return({
			minColumn: bounds.minColumn - margin,
			minRow: bounds.minRow - margin,
			maxColumn: bounds.maxColumn + margin,
			maxRow: bounds.maxRow + margin
		});
	}

	/**
	 * Shows neighboring areas past the area's edges, dimmed, in place of those shown before
	 *
	 * @param previews The neighbors and where they line up
	 */
	setPreviews(previews: readonly NeighborPreview[]): void
	{
		const paper = this.paperBounds();
		const columns = (paper.maxColumn - paper.minColumn) + 1;

		// The cells the neighbors shown before covered are past the area's edges again
		for (const { preview } of this.previews)
		{
			const { bounds } = preview.area;

			for (let row = bounds.minRow + preview.rowOffset; row <= (bounds.maxRow + preview.rowOffset); row++)
			{
				for (let column = bounds.minColumn + preview.columnOffset; column <= (bounds.maxColumn + preview.columnOffset); column++)
				{
					if (isInBounds(paper, column, row))
					{
						this.unexplored[((row - paper.minRow) * columns) + (column - paper.minColumn)] = 1;
					}
				}
			}
		}

		this.clearPreviews();
		this.paperChanged = true;

		for (const preview of previews)
		{
			const { bounds } = preview.area;
			const x = (bounds.minColumn + preview.columnOffset) * GRID_CELL_SIZE;
			const y = (bounds.minRow + preview.rowOffset) * GRID_CELL_SIZE;
			const width = ((bounds.maxColumn - bounds.minColumn) + 1) * GRID_CELL_SIZE;
			const height = ((bounds.maxRow - bounds.minRow) + 1) * GRID_CELL_SIZE;

			this.previews.push({
				preview,
				renderer: new AreaRenderer(this, preview.area, preview.chunks, { x: preview.columnOffset * GRID_CELL_SIZE, y: preview.rowOffset * GRID_CELL_SIZE }),
				dim: this.add.rectangle(x, y, width, height, 0x000000)
					.setOrigin(0, 0)
					.setDepth(PREVIEW_DIM_DEPTH)
					.setAlpha(PREVIEW_DIM_ALPHA)
			});

			for (let row = bounds.minRow + preview.rowOffset; row <= (bounds.maxRow + preview.rowOffset); row++)
			{
				for (let column = bounds.minColumn + preview.columnOffset; column <= (bounds.maxColumn + preview.columnOffset); column++)
				{
					if (isInBounds(paper, column, row))
					{
						this.unexplored[((row - paper.minRow) * columns) + (column - paper.minColumn)] = 0;
					}
				}
			}

			this.markCells(preview.chunks, bounds, preview.columnOffset, preview.rowOffset, preview.chunks.keys());
		}
	}

	/**
	 * Redraws the chunks of a neighboring area shown that the host has loaded
	 *
	 * @param areaId The neighbor's ID
	 * @param chunkKeys The chunks, by chunkKey()
	 */
	refreshPreview(areaId: string, chunkKeys: Iterable<string>): void
	{
		const keys = [...chunkKeys];

		for (const { preview, renderer } of this.previews)
		{
			if (preview.area.areaId === areaId)
			{
				renderer.refreshChunks(keys);
				this.markCells(preview.chunks, preview.area.bounds, preview.columnOffset, preview.rowOffset, keys);
			}
		}
	}

	/**
	 * Removes the neighboring areas shown
	 */
	private clearPreviews(): void
	{
		for (const { renderer, dim } of this.previews)
		{
			renderer.destroy();
			dim.destroy();
		}

		this.previews = [];
	}

	/**
	 * Draws the paper over the camera's view, with the Unexplored cells under it again once they have changed
	 *
	 * The camera works out its view as it renders, after update(), so the view is where the camera was last
	 * frame. The paper reaches a whole view past it on every side, so a pan never shows a strip without it;
	 * what is off the screen costs nothing to draw
	 *
	 * @param view The camera's view of the world
	 */
	private drawPaper(view: Phaser.Geom.Rectangle): void
	{
		if (!this.paper)
		{
			return;
		}

		if (this.paperChanged)
		{
			const paper = this.paperBounds();
			const columns = (paper.maxColumn - paper.minColumn) + 1;

			this.paperChanged = false;
			this.paper.draw(paper.minColumn, paper.minRow, (column, row) => (this.unexplored[(row * columns) + column] === 1));
		}

		this.paper.cover(this.paperArea.setTo(view.x - view.width, view.y - view.height, view.width * 3, view.height * 3));
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
		this.highlightRuns = outlineRuns(highlights);
		this.highlightZoom = 0;
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
	 * The cell in the middle of the camera's view
	 *
	 * @return The cell
	 */
	middleCell(): BrushCell
	{
		// The camera zooms around the middle of its view, which is half its size past its scroll
		const camera = this.cameras.main;

		return({
			column: Math.floor((camera.scrollX + (camera.width / 2)) / GRID_CELL_SIZE),
			row: Math.floor((camera.scrollY + (camera.height / 2)) / GRID_CELL_SIZE)
		});
	}

	/**
	 * The cells the camera's view reaches, in whole or in part
	 *
	 * @return Their bounds
	 */
	viewCells(): AreaBounds
	{
		// The camera zooms around the middle of its view, which is half its size past its scroll
		const camera = this.cameras.main;
		const width = camera.width / camera.zoom;
		const height = camera.height / camera.zoom;
		const left = camera.scrollX + ((camera.width - width) / 2);
		const top = camera.scrollY + ((camera.height - height) / 2);

		return({
			minColumn: Math.floor(left / GRID_CELL_SIZE),
			minRow: Math.floor(top / GRID_CELL_SIZE),
			maxColumn: Math.floor((left + width) / GRID_CELL_SIZE),
			maxRow: Math.floor((top + height) / GRID_CELL_SIZE)
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
		this.keyboardCursor = true;

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
	 * Starts painting, fills, picks or starts panning; a click on a neighbor shown past the area's edge
	 * opens the neighbor
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
			this.middlePan = pointer.middleButtonDown();
			return;
		}

		const cell = this.cellUnder(pointer);
		const mode = this.host.pointerMode();

		if (this.isPreviewCell(cell))
		{
			this.host.openNeighbor(cell);
		}
		else if (mode === 'pick')
		{
			this.host.pick(cell.column, cell.row);
		}
		else if (mode === 'fill')
		{
			this.host.fill(cell.column, cell.row);
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

		this.pointerOver = true;
		this.keyboardCursor = false;

		// A neighbor shown past the edge opens when clicked, like a link; empty leaves the stylesheet's crosshair
		this.game.canvas.style.cursor = ((this.isPreviewCell(cell) && !this.lastDab && !this.panStart) ? 'pointer' : '');

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
	 * Ends a stroke or a pan. A middle click, letting go where the button was pressed, picks the cell's tile
	 *
	 * @param pointer The pointer
	 */
	private readonly onPointerUp = (pointer: Phaser.Input.Pointer): void =>
	{
		const pan = this.panStart;

		if (pan && this.middlePan && (Math.hypot(pointer.x - pan.x, pointer.y - pan.y) <= MIDDLE_CLICK_DISTANCE))
		{
			const cell = this.cellUnder(pointer);

			this.host.pickTile(cell.column, cell.row);
		}

		this.panStart = undefined;
		this.middlePan = false;
		this.finishStroke();
	};

	/**
	 * Forgets the hovered cell when the pointer leaves the canvas
	 */
	private readonly onPointerOut = (): void =>
	{
		this.pointerOver = false;
		this.hovered = undefined;
		this.game.canvas.style.cursor = '';
		this.host.hover(undefined);
	};

	/**
	 * Whether a cell is one of a neighbor shown past the area's edges, rather than the area's own
	 *
	 * @param cell The cell
	 * @return True when it is
	 */
	private isPreviewCell(cell: BrushCell): boolean
	{
		return(!isInBounds(this.area.bounds, cell.column, cell.row) && this.previews.some(({ preview }) => isInBounds(preview.area.bounds, cell.column - preview.columnOffset, cell.row - preview.rowOffset)));
	}

	/**
	 * Finds where the mouse is on the canvas when the page scrolls under it, which moves the canvas
	 * without moving the mouse, so the outlined cell stays under the mouse
	 */
	private readonly onPageScroll = (): void =>
	{
		const pointer = this.input.activePointer;
		const event = pointer.event;

		if (!this.pointerOver || !(event instanceof MouseEvent))
		{
			return;
		}

		// The mouse stays at the same place in the window, which is somewhere else on the page now
		this.scale.updateBounds();
		this.game.input.transformPointer(pointer, event.clientX + window.scrollX, event.clientY + window.scrollY, false);

		if ((pointer.x < 0) || (pointer.y < 0) || (pointer.x >= this.scale.width) || (pointer.y >= this.scale.height))
		{
			this.onPointerOut();
			return;
		}

		this.onPointerMove(pointer);
	};

	/**
	 * Zooms in or out while Ctrl is held, and otherwise pans the area when wheelPans is set. Without
	 * either the wheel scrolls the page
	 *
	 * @param pointer The pointer
	 * @param _over Game objects under the pointer
	 * @param deltaX Horizontal wheel movement
	 * @param deltaY Vertical wheel movement: negative zooms in
	 */
	private readonly onWheel = (pointer: Phaser.Input.Pointer, _over: unknown, deltaX: number, deltaY: number): void =>
	{
		const event = pointer.event;

		if (event.ctrlKey)
		{
			this.zoomAround(pointer, deltaY);
		}
		else if (this.wheelPans && (event instanceof WheelEvent))
		{
			this.pan(event, deltaX, deltaY);

			// The area moved under the pointer, so it is over another cell, and a stroke being painted follows it
			this.onPointerMove(pointer);
		}
	};

	/**
	 * Pans the area by a turn of the wheel. Shift turns the wheel's vertical movement sideways, for a
	 * mouse without a sideways wheel
	 *
	 * @param event The wheel event, which says what the movement is measured in
	 * @param deltaX Horizontal wheel movement
	 * @param deltaY Vertical wheel movement
	 */
	private pan(event: WheelEvent, deltaX: number, deltaY: number): void
	{
		const camera = this.cameras.main;
		const sideways = (event.shiftKey && (deltaX === 0));
		let pixels = 1;

		if (event.deltaMode === WheelEvent.DOM_DELTA_LINE)
		{
			pixels = WHEEL_LINE_PIXELS;
		}
		else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE)
		{
			pixels = camera.height;
		}

		const scale = (pixels * WHEEL_PAN_SCALE) / camera.zoom;

		camera.setScroll(
			camera.scrollX + ((sideways ? deltaY : deltaX) * scale),
			camera.scrollY + ((sideways ? 0 : deltaY) * scale)
		);
	}

	/**
	 * Zooms in or out one step, keeping the point under the pointer where it is
	 *
	 * @param pointer The pointer
	 * @param deltaY Vertical wheel movement: negative zooms in
	 */
	private zoomAround(pointer: Phaser.Input.Pointer, deltaY: number): void
	{
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
	}

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
	 * Outlines the highlighted cells, a line along each run of their edges
	 */
	private drawHighlights(): void
	{
		const overlay = this.highlightOverlay;

		if (!overlay)
		{
			return;
		}

		const zoom = this.cameras.main.zoom;

		// As thick as the overlay's lines and a half, and the same width on screen however far the camera
		// zooms. Each run reaches half a line past its ends, so the corners where runs meet are filled
		const line = 3 / zoom;
		const overhang = line / 2;
		let color: number | undefined;

		this.highlightZoom = zoom;
		overlay.clear();

		for (const run of this.highlightRuns)
		{
			if (run.color !== color)
			{
				color = run.color;
				overlay.lineStyle(line, color, 1);
			}

			const at = run.line * GRID_CELL_SIZE;
			const start = (run.start * GRID_CELL_SIZE) - overhang;
			const end = (run.end * GRID_CELL_SIZE) + overhang;

			if (run.vertical)
			{
				overlay.lineBetween(at, start, at, end);
			}
			else
			{
				overlay.lineBetween(start, at, end, at);
			}
		}
	}

	/**
	 * Draws the area's edges, each carried on across the neighbors shown past its corners, so the seams
	 * between a side neighbor and a corner area show as well
	 *
	 * @param overlay What the outlines are drawn on, with its line style set
	 */
	private drawEdges(overlay: Phaser.GameObjects.Graphics): void
	{
		const { bounds } = this.area;

		// The area and the neighbors shown past its edges, each where it is drawn
		const shapes: AreaBounds[] = [
			bounds,
			...this.previews.map(({ preview }) => ({
				minColumn: preview.area.bounds.minColumn + preview.columnOffset,
				minRow: preview.area.bounds.minRow + preview.rowOffset,
				maxColumn: preview.area.bounds.maxColumn + preview.columnOffset,
				maxRow: preview.area.bounds.maxRow + preview.rowOffset
			}))
		];

		for (const row of [bounds.minRow, bounds.maxRow + 1])
		{
			const spans = shapes
				.filter((shape) => ((shape.minRow === row) || ((shape.maxRow + 1) === row)))
				.map((shape): [number, number] => [shape.minColumn, shape.maxColumn + 1]);

			for (const [start, end] of mergeSpans(spans))
			{
				overlay.lineBetween(start * GRID_CELL_SIZE, row * GRID_CELL_SIZE, end * GRID_CELL_SIZE, row * GRID_CELL_SIZE);
			}
		}

		for (const column of [bounds.minColumn, bounds.maxColumn + 1])
		{
			const spans = shapes
				.filter((shape) => ((shape.minColumn === column) || ((shape.maxColumn + 1) === column)))
				.map((shape): [number, number] => [shape.minRow, shape.maxRow + 1]);

			for (const [start, end] of mergeSpans(spans))
			{
				overlay.lineBetween(column * GRID_CELL_SIZE, start * GRID_CELL_SIZE, column * GRID_CELL_SIZE, end * GRID_CELL_SIZE);
			}
		}
	}

	/**
	 * Outlines the area's edges, its center cell, its links and the brush
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

		overlay.clear();
		overlay.lineStyle(line, BOUNDS_COLOR, 0.8);
		this.drawEdges(overlay);
		overlay.lineStyle(line, CENTER_COLOR, 0.5);
		overlay.strokeRect(0, 0, GRID_CELL_SIZE, GRID_CELL_SIZE);

		for (const link of this.links)
		{
			overlay.fillStyle(LINK_COLORS[link.mode], 0.35);
			overlay.fillRect(link.column * GRID_CELL_SIZE, link.row * GRID_CELL_SIZE, GRID_CELL_SIZE, GRID_CELL_SIZE);
			overlay.lineStyle(line, LINK_COLORS[link.mode], 1);
			overlay.strokeRect(link.column * GRID_CELL_SIZE, link.row * GRID_CELL_SIZE, GRID_CELL_SIZE, GRID_CELL_SIZE);
		}

		const mode = this.host.pointerMode();

		// A neighbor shown past the edge isn't painted, so the pointer over it shows no brush, and the
		// keyboard's cursor there is one cell
		if (this.hovered && this.isPreviewCell(this.hovered))
		{
			if (this.keyboardCursor)
			{
				overlay.lineStyle(line, BRUSH_COLOR, 1);
				overlay.strokeRect(this.hovered.column * GRID_CELL_SIZE, this.hovered.row * GRID_CELL_SIZE, GRID_CELL_SIZE, GRID_CELL_SIZE);
			}
		}
		else if (this.hovered && (mode !== 'none'))
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

/**
 * Joins stretches along a line that overlap or touch into one
 *
 * @param spans Each stretch's start and end
 * @return The joined stretches, in order
 */
function mergeSpans(spans: readonly [number, number][]): [number, number][]
{
	const merged: [number, number][] = [];

	for (const [start, end] of [...spans].sort((first, second) => (first[0] - second[0])))
	{
		const last = merged[merged.length - 1];

		if (last && (start <= last[1]))
		{
			last[1] = Math.max(last[1], end);
		}
		else
		{
			merged.push([start, end]);
		}
	}

	return(merged);
}
