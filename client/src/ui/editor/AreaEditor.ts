import exitFullPageIcon from 'virtual:icon/ph:arrows-in';
import fullPageIcon from 'virtual:icon/ph:arrows-out';
import fillIcon from 'virtual:icon/ph:paint-bucket';
import { areaFill, canPaintTile, carriedResizes, CHUNK_SIZE, chunkCoordinate, DEFAULT_TILE_CELL, defineMessages, FILL_CONFIRM_CELLS, hasNeighbors, isInBounds, MAX_BRUSH_SIZE, MAX_CELL_CHANGES, MIN_NEIGHBOR_AREA_SIDE, NEIGHBOR_PREVIEW_CELLS, NO_NEIGHBORS, parseChunkKey, seamSides, seamSlots, VOID_CELL, VIEW_HEIGHT, VIEW_WIDTH, type NeighborGrid, type SeamLookup, type CellChange, type ChunkCoordinates, type ChunkRange, type EditableUniverse, type EditorTile, type EditorArea, type EditorAreaLink, type EditorAreaSummary, type AreaBounds, type MessageDescriptor, type NumberRef, type StringRef } from '@multiverse-kiln/shared';

import { AreaCanvas, editorAreaPayload } from '../../editor/AreaCanvas';
import { AreaCells } from '../../editor/AreaCells';
import { BRUSH_SHAPES, brushCells, type BrushCell, type BrushShape } from '../../editor/brush';
import { ChunkLoader } from '../../editor/ChunkLoader';
import { EditHistory, type EditStep, type SavedCell } from '../../editor/EditHistory';
import { currentLocale, t } from '../../localization';
import { describeEditorError, EditorApiError } from '../../network/editorApi';
import type { AreaEditorHost, CameraState, NeighborPreview, PointerMode } from '../../scenes/AreaEditorScene';
import { announce } from '../announcer';
import { askToConfirm } from '../confirmDialog';
import { getElement, namedOptions, setButtonLabel, setOptions, showMessage } from '../dom';
import { formMessages } from '../formMessages';
import { addKeyHelp, formatKeys } from '../shortcuts';
import { tileName } from '../tileNames';
import { areaEditorMessages } from './areaEditorMessages';
import type { AreaSource, LinkChange } from './areaSource';
import { describeCell } from './cellDescription';
import type { EditorSave, SaveRefusal } from './editorSave';
import { LinkDialog } from './LinkDialog';
import type { FollowedDialog } from './otherSaves';
import { ResizeDialog, type ResizeLoss } from './ResizeDialog';

/**
 * Text the cell editor shows in more than one place (see src/localization.ts)
 */
const messages = defineMessages({
	loadLinksFailed: {
		id: 'editor.area.loadLinksFailed',
		defaultMessage: 'Could not load the links.',
		description: 'Shown in the area editor when the area\'s links couldn\'t be loaded'
	}
});

/**
 * Each brush shape's name
 */
const BRUSH_SHAPE_NAMES: Record<BrushShape, MessageDescriptor> = defineMessages({
	square: {
		id: 'editor.area.brush.square',
		defaultMessage: 'square',
		description: 'Shape of the Draw tool\'s brush'
	},
	circle: {
		id: 'editor.area.brush.circle',
		defaultMessage: 'circle',
		description: 'Shape of the Draw tool\'s brush'
	}
});

/**
 * Value of the tile choice for Unexplored, which paints VOID_CELL
 */
const UNEXPLORED_CHOICE = 'unexplored';

/**
 * An edge or corner of the area editor's cells, which a button opens the area past
 */
type EdgeDirection = 'north' | 'northEast' | 'east' | 'southEast' | 'south' | 'southWest' | 'west' | 'northWest';

/**
 * Each edge and corner: its button's ID after area-edge-, and which way it is from the area, -1, 0 or 1
 * along each axis
 */
const EDGE_DIRECTIONS: readonly { direction: EdgeDirection; id: string; columns: number; rows: number }[] = [
	{ direction: 'north', id: 'north', columns: 0, rows: -1 },
	{ direction: 'northEast', id: 'north-east', columns: 1, rows: -1 },
	{ direction: 'east', id: 'east', columns: 1, rows: 0 },
	{ direction: 'southEast', id: 'south-east', columns: 1, rows: 1 },
	{ direction: 'south', id: 'south', columns: 0, rows: 1 },
	{ direction: 'southWest', id: 'south-west', columns: -1, rows: 1 },
	{ direction: 'west', id: 'west', columns: -1, rows: 0 },
	{ direction: 'northWest', id: 'north-west', columns: -1, rows: -1 }
];

/**
 * Finds the areas of a grid as the seams see them, walking off the end of a row or column that loops
 * onto its other end
 *
 * @param grid The areas
 * @return The lookup
 */
function seamLookupOf(grid: NeighborGrid): SeamLookup
{
	return((areaId) =>
	{
		const area = grid.get(areaId);

		return(area && { id: areaId, bounds: area.bounds, sides: seamSides(grid, areaId) });
	});
}

/**
 * The outline of the cells other editors painted while the area was open
 */
const PAINTED_BY_OTHERS_COLOR = 0xe040fb;

/**
 * The outline of the cells other editors painted over painting here, a warning color apart from the
 * automatic links' orange
 */
const PAINTED_OVER_COLOR = 0xff3d00;

/**
 * The area being edited and everything that goes with it
 */
interface OpenArea
{
	universe: EditableUniverse;
	area: EditorArea;
	tiles: readonly EditorTile[];
	areas: readonly EditorAreaSummary[];
	cells: AreaCells;
	loader: ChunkLoader;

	/**
	 * The area's links as saved; the canvas shows them with the link changes not yet saved (currentLinks)
	 */
	links: EditorAreaLink[];

	/**
	 * Whether the area's cells can be changed
	 */
	editable: boolean;
}

/**
 * What taking in another editor's painting did to the open area
 */
export interface FollowedPainting
{
	/**
	 * How many of the cells it changed had been painted here while the area was open
	 */
	paintedOver: number;

	/**
	 * Takes the save's marks off the area
	 */
	unmark: () => void;
}

/**
 * What the cell editor knows of the open area's neighbors (see Neighboring areas in
 * STRUCTURE-OVERVIEW.md), from the Areas tab, with this window's changes not yet saved
 */
export interface NeighborSource
{
	/**
	 * The universe's areas as the grid of neighbors sees them, the open area at its size as shown
	 */
	grid: () => NeighborGrid;

	/**
	 * An area as the Areas tab has it, with its settings worked out
	 *
	 * @param areaId The area's ID
	 * @return The area, or undefined for one it doesn't have
	 */
	area: (areaId: string) => EditorArea | undefined;

	/**
	 * Gives another area in the open area's row or column new bounds, as a resize carries it along
	 *
	 * @param areaId The area's ID
	 * @param bounds Its bounds
	 */
	setBounds: (areaId: string, bounds: AreaBounds) => void;

	/**
	 * Opens an area's editor
	 *
	 * @param areaId The area's ID
	 */
	open: (areaId: string) => void;
}

/**
 * A neighbor shown past the open area's edges
 */
interface ShownNeighbor
{
	area: EditorArea;

	/**
	 * Its cells as loaded, which every place showing it shares
	 */
	cells: AreaCells;

	/**
	 * The cells of it shown, in the open area's columns and rows
	 */
	shownBounds: AreaBounds;

	columnOffset: number;
	rowOffset: number;
}

/**
 * The cells a stroke of the draw tool has painted so far
 */
interface Stroke
{
	/**
	 * Each painted cell's value before the stroke, by "column,row"
	 */
	before: Map<string, CellChange>;

	/**
	 * Each painted cell's value now, by "column,row"
	 */
	after: Map<string, number>;
}

/**
 * The cell editor in the area editor: the area's cells on the same grid as gameplay, a draw tool (a tile
 * or Unexplored, 1 to MAX_BRUSH_SIZE cells across, square or circle) and a fill tool with undo and redo, Edit
 * Size, and a tool for the area's links
 *
 * Painting, changes to the area's size and links show immediately and are kept until the editor's Save
 * button calls save(); a click, a drag, a fill or a change of size is one step to undo
 */
export class AreaEditor
{
	private readonly tools = getElement('area-tools', HTMLElement);
	private readonly drawTool = getElement('area-tool-draw', HTMLInputElement);
	private readonly fillTool = getElement('area-tool-fill', HTMLInputElement);
	private readonly tile = getElement('area-tile', HTMLSelectElement);
	private readonly brushSize = getElement('area-brush-size', HTMLInputElement);
	private readonly brushShape = getElement('area-brush-shape', HTMLSelectElement);
	private readonly undoButton = getElement('area-undo', HTMLButtonElement);
	private readonly redoButton = getElement('area-redo', HTMLButtonElement);
	private readonly resizeButton = getElement('area-resize', HTMLButtonElement);
	private readonly section = getElement('area-cells-editor', HTMLElement);
	private readonly fullPageButton = getElement('area-full-page', HTMLButtonElement);
	private readonly cursor = getElement('area-cursor', HTMLElement);
	private readonly saveStatus = getElement('area-save-status', HTMLElement);
	private readonly pickStatus = getElement('area-pick-status', HTMLElement);
	private readonly error = getElement('area-cells-error', HTMLElement);
	private readonly canvasElement = getElement('area-canvas', HTMLElement);
	private readonly canvas = new AreaCanvas(this.canvasElement, VIEW_WIDTH, VIEW_HEIGHT);
	private readonly history = new EditHistory();
	private readonly resizeDialog: ResizeDialog;
	private readonly linkDialog: LinkDialog;
	private readonly canvasObserver = new ResizeObserver(() =>
	{
		this.fitCanvas();
	});

	private open: OpenArea | undefined;
	private stroke: Stroke | undefined;

	/**
	 * Whether a fill is under way, loading the area's chunks or asking whether to go ahead
	 */
	private filling = false;

	/**
	 * Whether the cell editor covers the window (see setFullPage)
	 */
	private fullPage = false;

	/**
	 * The cell under the pointer, while it is over the canvas
	 */
	private hovered: BrushCell | undefined;

	/**
	 * Each painted cell that differs from the server's copy, with its value now, by "column,row"
	 */
	private readonly unsaved = new Map<string, CellChange>();

	/**
	 * The server's value of each cell in unsaved, by "column,row"
	 */
	private readonly savedValues = new Map<string, number>();

	/**
	 * The cells other editors painted while the area was open, with the display name of the last to
	 * paint each, whether they painted over painting here and the save that marked it (counted by
	 * followedSaves), by "column,row"
	 */
	private readonly paintedByOthers = new Map<string, { name: string; overPainting: boolean; save: number }>();

	/**
	 * How many saves made in other windows followPainting() has taken in, which numbers their marks
	 */
	private followedSaves = 0;

	/**
	 * The cells this window saved painting to while the area was open, by "column,row"
	 */
	private readonly paintedHere = new Set<string>();

	/**
	 * Links added, changed or deleted that haven't been saved, in this area and return links in others,
	 * by linkKey()
	 */
	private stagedLinks = new Map<string, LinkChange>();

	/**
	 * Saves being sent; the area's cells are read-only while there are any
	 */
	private pendingSaves = 0;

	/**
	 * What the save being sent holds: the area, its new bounds, the cells painted and the link changes
	 */
	private collected: { areaId: string; bounds: AreaBounds; cells: CellChange[]; links: [string, LinkChange][] } | undefined;

	/**
	 * Whether the player agreed to delete the links a smaller area cuts off, for the next save
	 */
	private discardOnSave = false;

	/**
	 * Whether showing the open area again loads its cells afresh, after a save made the tiles it is painted with
	 */
	private reloadOnShow = false;

	/**
	 * The tiles the Tilesets tab will delete, which can't be painted with
	 */
	private deletedTiles: ReadonlyMap<number, number | undefined> = new Map();

	/**
	 * Whether the Tile list offers the tiles for indoor areas, following the area editor's choice before it is saved
	 */
	private listedIndoors = false;

	/**
	 * Changes every time an area is opened, so data that arrives for an earlier one is ignored
	 */
	private openVersion = 0;

	/**
	 * The chunks the view last reached, which the open area's chunk loader was asked for
	 */
	private view: ChunkRange | undefined;

	/**
	 * The buttons on the edges and corners of the cells that open the area past them
	 */
	private readonly edgeButtons = new Map<EdgeDirection, HTMLButtonElement>(EDGE_DIRECTIONS.map(({ direction, id }) => [direction, getElement(`area-edge-${id}`, HTMLButtonElement)]));

	/**
	 * The area each edge button opens, by its direction
	 */
	private edgeTargets = new Map<EdgeDirection, string>();

	/**
	 * The neighbors shown past the open area's edges
	 */
	private shownNeighbors: ShownNeighbor[] = [];

	/**
	 * Each neighbor's cells as loaded for showing, by area ID, kept while the open area stays open
	 */
	private neighborCells = new Map<string, AreaCells>();

	/**
	 * @param source Where the areas, their links and their chunks come from
	 * @param onBoundsChanged Called with an area's new bounds after the cell editor resizes it
	 * @param onUnsavedChanged Called with whether the area has painting, a change of size or links that haven't been saved, whenever that may have changed
	 * @param neighbors What the Areas tab knows of the open area's neighbors
	 */
	constructor(private readonly source: AreaSource, private readonly onBoundsChanged: (bounds: AreaBounds) => void, private readonly onUnsavedChanged: (unsaved: boolean) => void, private readonly neighbors: NeighborSource)
	{
		for (const [direction, button] of this.edgeButtons)
		{
			button.addEventListener('click', () =>
			{
				const areaId = this.edgeTargets.get(direction);

				if (areaId !== undefined)
				{
					this.neighbors.open(areaId);
				}
			});
		}

		this.resizeDialog = new ResizeDialog();
		this.linkDialog = new LinkDialog();
		this.brushSize.max = String(MAX_BRUSH_SIZE);
		setOptions(this.brushShape, namedOptions(BRUSH_SHAPES, BRUSH_SHAPE_NAMES));
		this.canvasObserver.observe(this.canvasElement);

		this.undoButton.addEventListener('click', () =>
		{
			this.undo();
		});

		this.redoButton.addEventListener('click', () =>
		{
			this.redo();
		});

		this.resizeButton.addEventListener('click', () =>
		{
			this.openResizeDialog();
		});

		this.fullPageButton.addEventListener('click', () =>
		{
			this.setFullPage(!this.fullPage);
		});

		// What the last pick said no longer goes with the tile chosen
		this.tile.addEventListener('change', () =>
		{
			this.pickStatus.textContent = '';
		});

		this.setFullPage(false);

		document.addEventListener('keydown', this.onKeyDown);
		this.addKeyHelp();
	}

	/**
	 * Lists the keys the cell editor handles itself in the list of shortcuts: undo and redo while the tools
	 * show, and the keyboard's cursor (see AreaCanvas) while the canvas does
	 */
	private addKeyHelp(): void
	{
		addKeyHelp({
			scope: this.tools,
			keys: () => formatKeys('Control+Z'),
			description: () => t({
				id: 'editor.area.keys.undo',
				defaultMessage: 'Undo the last painting or change to the area\'s size',
				description: 'In the list of keyboard shortcuts, what Ctrl+Z does in the area editor'
			})
		});

		addKeyHelp({
			scope: this.tools,
			keys: () => formatKeys('Control+Y Control+Shift+Z'),
			description: () => t({
				id: 'editor.area.keys.redo',
				defaultMessage: 'Redo the painting or change of size undone',
				description: 'In the list of keyboard shortcuts, what Ctrl+Y does in the area editor'
			})
		});

		addKeyHelp({
			scope: this.canvasElement,
			keys: () => t(areaEditorMessages.arrowKeys),
			description: () => t(areaEditorMessages.cursorDescription)
		});

		addKeyHelp({
			scope: this.tools,
			keys: () => t(areaEditorMessages.spaceOrEnter),
			description: () => t({
				id: 'editor.area.keys.paintDescription',
				defaultMessage: 'Paint the cursor\'s cell, fill from it with the Fill tool, or open its link with the Links tool; hold Space while moving to keep painting. On a neighboring area, open it',
				description: 'In the list of keyboard shortcuts, what Space and Enter do on the area editor\'s cells; the cells of neighboring areas (walked across without links) are shown dimmed past the area\'s edges'
			})
		});

		addKeyHelp({
			scope: this.tools,
			keys: () => 'P',
			description: () => t({
				id: 'editor.area.keys.pickTileDescription',
				defaultMessage: 'Choose the cursor\'s cell\'s tile in the Tile list',
				description: 'In the list of keyboard shortcuts, what the P key does on the area editor\'s cells'
			})
		});

		addKeyHelp({
			scope: this.canvasElement,
			keys: () => '+ / -',
			description: () => t({
				id: 'editor.area.keys.zoom',
				defaultMessage: 'Zoom in or out',
				description: 'In the list of keyboard shortcuts, what the + and - keys do on the area editor\'s cells'
			})
		});

		addKeyHelp({
			scope: this.canvasElement,
			keys: () => t({
				id: 'editor.area.keys.home',
				defaultMessage: 'Home',
				description: 'In the list of keyboard shortcuts, the name of the Home key'
			}),
			description: () => t({
				id: 'editor.area.keys.homeDescription',
				defaultMessage: 'Go back to the center cell',
				description: 'In the list of keyboard shortcuts, what the Home key does on the area editor\'s cells'
			})
		});
	}

	/**
	 * Shows an area's cells
	 *
	 * Opening the area already shown keeps what has loaded, the undo history and the links not yet saved,
	 * so changing the area's other settings doesn't lose them
	 *
	 * @param universe The area's universe
	 * @param area The area
	 * @param tiles Every tile the universe can use, with the Tilesets tab's changes
	 * @param deletedTiles The tiles the Tilesets tab will delete, which can't be painted with
	 * @param areas The areas the area's links can lead to: those on its side of the lobby region's edge
	 * @param editable Whether the area's cells can be changed: false for a player whose role can't change the world, or an area that will be deleted
	 */
	async show(universe: EditableUniverse, area: EditorArea, tiles: readonly EditorTile[], deletedTiles: ReadonlyMap<number, number | undefined>, areas: readonly EditorAreaSummary[], editable: boolean): Promise<void>
	{
		const version = ++this.openVersion;
		const sameArea = (this.open?.area.id === area.id);
		const same = (sameArea && !this.reloadOnShow && (this.open !== undefined) && sameBounds(this.open.cells.bounds, area.bounds));

		this.deletedTiles = deletedTiles;
		this.fillTiles(universe, area, tiles, sameArea);
		this.tools.hidden = !editable;

		if (!sameArea)
		{
			this.pickStatus.textContent = '';
		}

		showMessage(this.error, undefined);

		let links: EditorAreaLink[];

		try
		{
			links = await this.source.listLinks(area.id);
		}
		catch (error)
		{
			if (version === this.openVersion)
			{
				showMessage(this.error, describeEditorError(error, messages.loadLinksFailed));
			}

			return;
		}

		if (version !== this.openVersion)
		{
			return;
		}

		const camera = (sameArea ? this.canvas.scene?.cameraState() : undefined);

		if (same && this.open)
		{
			this.open = { ...this.open, universe, area, tiles, areas, links, editable };
		}
		else
		{
			this.reloadOnShow = false;
			this.open?.loader.stop();
			this.history.clear();
			this.stagedLinks.clear();
			this.paintedByOthers.clear();
			this.paintedHere.clear();
			this.neighborCells.clear();
			this.open = this.openArea(universe, area, tiles, areas, links, editable);
			this.unsavedChanged();
		}

		await this.startScene(camera);
		this.updateButtons();
	}

	/**
	 * Stops showing the area's cells, for when the area editor closes
	 */
	hide(): void
	{
		this.setFullPage(false);
		this.openVersion++;
		this.open?.loader.stop();
		this.open = undefined;
		this.view = undefined;
		this.stroke = undefined;
		this.history.clear();
		this.unsaved.clear();
		this.savedValues.clear();
		this.stagedLinks.clear();
		this.paintedByOthers.clear();
		this.paintedHere.clear();
		this.neighborCells.clear();
		this.shownNeighbors = [];
		this.pickStatus.textContent = '';
		this.canvas.stop();
		this.showEdgeButtons();
		this.unsavedChanged();
	}

	/**
	 * Whether the area has painting, a change of size or links that haven't been saved
	 *
	 * @return True while it has
	 */
	hasUnsavedChanges(): boolean
	{
		return((this.unsaved.size > 0) || this.hasUnsavedBounds() || (this.stagedLinks.size > 0));
	}

	/**
	 * The links added, changed or deleted that haven't been saved, in the area open and return links in
	 * others
	 *
	 * @return The changes, each with a null target for a link deleted
	 */
	stagedLinkChanges(): LinkChange[]
	{
		return([...this.stagedLinks.values()]);
	}

	/**
	 * The link dialog, as the area editor follows saves made in other windows: one open with changes not
	 * yet applied keeps the area from loading again under it
	 *
	 * @return The dialog's following
	 */
	linkDialogFollowing(): FollowedDialog
	{
		return(this.linkDialog.following);
	}

	/**
	 * Gives areas added since the Areas tab was last saved the IDs the server saved them with, wherever
	 * the open area or its links not yet saved name them
	 *
	 * @param ids Each new area's saved ID, by the ID it had on the page
	 */
	resolveIds(ids: ReadonlyMap<string, string>): void
	{
		const open = this.open;
		const resolve = (areaId: string): string => (ids.get(areaId) ?? areaId);

		if (open)
		{
			open.area = { ...open.area, id: resolve(open.area.id) };
			open.areas = open.areas.map((area) => ({
				...area,
				id: resolve(area.id),
				parents: area.parents.map((parent) => ({ ...parent, id: resolve(parent.id) }))
			}));
		}

		this.stagedLinks = new Map([...this.stagedLinks.values()]
			.map((change): LinkChange => ({
				...change,
				areaId: resolve(change.areaId),
				target: ((change.target === null) ? null : { ...change.target, targetAreaId: resolve(change.target.targetAreaId) })
			}))
			.map((change) => [linkKey(change.areaId, change.column, change.row), change]));
	}

	/**
	 * Keeps the open area as a new area once a save in another window deleted it, so saving adds it again
	 * with the cells as they show here: every loaded cell that isn't the default tile is painting not yet
	 * saved, the area grows or shrinks from the size every new area starts with, and its links are links
	 * not yet saved, except those deleted here. The parts of the area that hadn't loaded went with the
	 * area, so they load as the default tile, and the links other areas had into it are gone
	 *
	 * @param areaId The area's ID as a new area
	 * @param bounds The bounds every new area starts with
	 */
	recreate(areaId: string, bounds: AreaBounds): void
	{
		const open = this.open;

		if (!open)
		{
			return;
		}

		this.resolveIds(new Map([[open.area.id, areaId]]));
		open.loader.stop();
		open.loader = this.createLoader(areaId, open.cells);
		open.area = { ...open.area, bounds };

		for (const { column, row, ...target } of open.links)
		{
			const key = linkKey(areaId, column, row);

			if (!this.stagedLinks.has(key))
			{
				this.stagedLinks.set(key, { areaId, column, row, target });
			}
		}

		for (const [key, change] of [...this.stagedLinks])
		{
			if ((change.areaId === areaId) && (change.target === null))
			{
				this.stagedLinks.delete(key);
			}
		}

		open.links = [];
		this.unsaved.clear();
		this.savedValues.clear();

		for (const cell of open.cells.paintedCells())
		{
			const key = `${cell[0]},${cell[1]}`;

			this.unsaved.set(key, cell);
			this.savedValues.set(key, DEFAULT_TILE_CELL);
		}

		if (this.view)
		{
			open.loader.request(this.view);
		}

		this.canvas.scene?.setLinks(linksInArea(open, this.currentLinks(areaId, open.links)));
		this.showHoveredCell();
		this.unsavedChanged();
		this.updateButtons();
	}

	/**
	 * Whether the area has grown since its bounds were last saved
	 *
	 * @return True when it has
	 */
	private hasUnsavedBounds(): boolean
	{
		return((this.open !== undefined) && !sameBounds(this.open.cells.bounds, this.open.area.bounds));
	}

	/**
	 * Adds the area's new bounds, the painting not yet saved (in changes of up to MAX_CELL_CHANGES cells)
	 * and the links not yet saved to a save. The area's cells are read-only until the save is over
	 *
	 * The server refuses painting and links outside its bounds, so the area first grows to cover both its
	 * saved and new bounds, then the painting is saved, then it shrinks to its new bounds, and last the
	 * links are saved; a link on a cell the smaller area cuts off is dropped. Cells a smaller area cuts off
	 * are set to the default tile with the painting, so shrinking discards nothing unless saved links are
	 * on them, which the player is asked about when the server refuses the save for it
	 *
	 * @param save The save
	 * @param areaRef How the save names an area, from its ID on the page
	 * @param tileRef How the save names the tile a cell is painted with, from its ID on the page
	 * @param onRefused Shows why the server refused one of the area's changes
	 */
	collect(save: EditorSave, areaRef: (areaId: string) => StringRef, tileRef: (tileId: number) => NumberRef, onRefused: (refusal: SaveRefusal) => void): void
	{
		const open = this.open;

		if (!open || !this.hasUnsavedChanges())
		{
			return;
		}

		const areaId = areaRef(open.area.id);
		const bounds = open.cells.bounds;
		const covering = unionBounds(open.area.bounds, bounds);
		const cells = [...this.unsaved.values()];
		const links = [...this.stagedLinks];

		showMessage(this.error, undefined);

		if (!sameBounds(covering, open.area.bounds))
		{
			save.add({ kind: 'resizeArea', areaId, bounds: covering, discard: false }, onRefused);
		}

		for (let start = 0; start < cells.length; start += MAX_CELL_CHANGES)
		{
			save.add({
				kind: 'editCells',
				areaId,
				changes: cells
					.slice(start, start + MAX_CELL_CHANGES)
					.map(([column, row, value]) => [column, row, (((value === DEFAULT_TILE_CELL) || (value === VOID_CELL)) ? value : tileRef(value))])
			}, onRefused);
		}

		if (!sameBounds(bounds, covering))
		{
			save.add({ kind: 'resizeArea', areaId, bounds, discard: this.discardOnSave }, (refusal) =>
			{
				this.resizeRefused(refusal, onRefused);
			});
		}

		for (const [, change] of links)
		{
			const cutOff = ((change.areaId === open.area.id) && !isInBounds(bounds, change.column, change.row));

			if (cutOff)
			{
				continue;
			}

			if (change.target === null)
			{
				save.add({ kind: 'deleteLink', areaId: areaRef(change.areaId), column: change.column, row: change.row }, onRefused);
			}
			else
			{
				save.add({ kind: 'saveLink', areaId: areaRef(change.areaId), column: change.column, row: change.row, target: { ...change.target, targetAreaId: areaRef(change.target.targetAreaId) } }, onRefused);
			}
		}

		this.collected = { areaId: open.area.id, bounds, cells, links };
		this.pendingSaves++;
		this.updateSaveStatus();
		this.updateButtons();
		save.onFinished(() =>
		{
			this.pendingSaves--;
			this.unsavedChanged();
			this.updateButtons();
		});
	}

	/**
	 * Asks whether to delete the links a smaller area cuts off, when the server refused the save for them,
	 * and saves again without them when the player agrees
	 *
	 * @param refusal Why the save was refused
	 * @param onRefused Shows why the area's cells weren't saved
	 */
	private resizeRefused(refusal: SaveRefusal, onRefused: (refusal: SaveRefusal) => void): void
	{
		const conflict = refusal.resizeConflict;

		if (!conflict)
		{
			onRefused(refusal);
			return;
		}

		const question = t({
			id: 'editor.area.confirmDeleteLinks',
			defaultMessage: 'Saving the smaller area deletes {links, plural, one {# link} other {# links}} on or into the cells it cuts off. This can\'t be undone. Save anyway?',
			description: 'Asked while saving an area made smaller, when links are on the cells it cuts off or lead into them; {links} is how many'
		}, {
			links: conflict.discardedLinks
		});

		if (window.confirm(question))
		{
			this.discardOnSave = true;
			refusal.retry();
			return;
		}

		onRefused({
			...refusal,
			error: new EditorApiError(t({
				id: 'editor.area.linksKept',
				defaultMessage: 'The links were kept, so the area wasn\'t made smaller.',
				description: 'Why saving stopped: the player chose not to delete the links a smaller area would cut off; nothing was saved'
			}), 409, conflict)
		});
	}

	/**
	 * Takes the area's changes as saved, once the save collect() added them to is saved. An area painted
	 * with tiles the save made, whose IDs on the page are negative, loads afresh when the area editor
	 * shows it again, so its cells hold the tiles' saved IDs
	 */
	saved(): void
	{
		const collected = this.collected;
		const open = this.open;

		this.collected = undefined;
		this.discardOnSave = false;

		if (!collected || !open || (open.area.id !== collected.areaId))
		{
			return;
		}

		this.markCellsSaved(collected.cells);

		for (const [column, row] of collected.cells)
		{
			this.paintedHere.add(`${column},${row}`);
		}

		open.area = { ...open.area, bounds: collected.bounds };

		for (const [key, change] of collected.links)
		{
			if (this.stagedLinks.get(key) === change)
			{
				this.stagedLinks.delete(key);
			}
		}

		if (collected.cells.some(([, , value]) => ((value < 0) && (value !== VOID_CELL))))
		{
			this.reloadOnShow = true;
		}

		this.unsavedChanged();
	}

	/**
	 * Keeps changes the link dialog made until the area is saved, and shows them on the canvas. Deleting a
	 * link that was never saved just forgets it
	 *
	 * @param open The area open when the link dialog opened
	 * @param changes The changes
	 */
	private stageLinks(open: OpenArea, changes: readonly LinkChange[]): void
	{
		if (this.open !== open)
		{
			return;
		}

		for (const change of changes)
		{
			const key = linkKey(change.areaId, change.column, change.row);
			const saved = ((change.areaId === open.area.id) && open.links.some((link) => ((link.column === change.column) && (link.row === change.row))));

			if ((change.target === null) && !saved)
			{
				this.stagedLinks.delete(key);
			}
			else
			{
				this.stagedLinks.set(key, change);
			}
		}

		this.canvas.scene?.setLinks(linksInArea(open, this.currentLinks(open.area.id, open.links)));
		this.showHoveredCell();
		this.unsavedChanged();
	}

	/**
	 * An area's links with the changes not yet saved
	 *
	 * @param areaId The area's ID
	 * @param saved The area's links as saved
	 * @return The links
	 */
	private currentLinks(areaId: string, saved: readonly EditorAreaLink[]): EditorAreaLink[]
	{
		const changes = [...this.stagedLinks.values()].filter((change) => (change.areaId === areaId));
		const changed = new Set(changes.map((change) => linkKey(areaId, change.column, change.row)));
		const added = changes.flatMap((change) => ((change.target === null) ? [] : [{ ...change.target, column: change.column, row: change.row }]));

		return([
			...saved.filter((link) => !changed.has(linkKey(areaId, link.column, link.row))),
			...added
		]);
	}

	/**
	 * Where the link dialog gets the areas it previews: the editor's source, with the links not yet saved
	 *
	 * @return The source
	 */
	private linkSource(): AreaSource
	{
		return({
			getArea: (areaId) => this.source.getArea(areaId),
			listLinks: async (areaId) => this.currentLinks(areaId, await this.source.listLinks(areaId)),
			loadChunks: (areaId, range) => this.source.loadChunks(areaId, range)
		});
	}

	/**
	 * Takes cells as stored on the server
	 *
	 * @param changes The cells and the values stored
	 */
	private markCellsSaved(changes: readonly CellChange[]): void
	{
		for (const [column, row, value] of changes)
		{
			const key = `${column},${row}`;

			this.savedValues.set(key, value);

			if (this.unsaved.get(key)?.[2] === value)
			{
				this.unsaved.delete(key);
				this.savedValues.delete(key);
			}
		}
	}

	/**
	 * Remembers cell changes as unsaved painting. A cell changed back to its saved value is no longer unsaved
	 *
	 * @param changes The cells and their new values
	 * @param previous The same cells' values before, in the same order
	 */
	private trackChanges(changes: readonly CellChange[], previous: readonly CellChange[]): void
	{
		changes.forEach(([column, row, value], index) =>
		{
			const key = `${column},${row}`;

			if (!this.savedValues.has(key))
			{
				this.savedValues.set(key, previous[index][2]);
			}

			if (this.savedValues.get(key) === value)
			{
				this.unsaved.delete(key);
				this.savedValues.delete(key);
			}
			else
			{
				this.unsaved.set(key, [column, row, value]);
			}
		});

		this.unsavedChanged();
	}

	/**
	 * Shows whether the area has unsaved painting or growth, and tells the area editor
	 */
	private unsavedChanged(): void
	{
		this.updateSaveStatus();
		this.onUnsavedChanged(this.hasUnsavedChanges());
	}

	/**
	 * Sets up the cells of an area that wasn't open
	 *
	 * @param universe The area's universe
	 * @param area The area
	 * @param tiles Every tile the universe can use
	 * @param areas Every area of the universe
	 * @param links The area's links
	 * @param editable Whether the area's cells can be changed
	 * @return The open area
	 */
	private openArea(universe: EditableUniverse, area: EditorArea, tiles: readonly EditorTile[], areas: readonly EditorAreaSummary[], links: EditorAreaLink[], editable: boolean): OpenArea
	{
		const cells = new AreaCells(area.bounds);

		return({ universe, area, tiles, areas, cells, loader: this.createLoader(area.id, cells), links, editable });
	}

	/**
	 * Creates what loads an area's chunks into its cells as the view reaches them
	 *
	 * @param areaId The area's ID
	 * @param cells The area's cells
	 * @return The loader
	 */
	private createLoader(areaId: string, cells: AreaCells): ChunkLoader
	{
		return(new ChunkLoader((range) => this.source.loadChunks(areaId, range), cells, (chunkKeys) =>
		{
			this.canvas.scene?.refreshChunks(chunkKeys);
		}, (error) =>
		{
			showMessage(this.error, describeEditorError(error, areaEditorMessages.loadFailed));
		}));
	}

	/**
	 * Starts the scene for the open area
	 *
	 * @param camera Where the camera starts, or undefined for the area's center
	 */
	private async startScene(camera?: CameraState): Promise<void>
	{
		const open = this.open;

		if (!open)
		{
			return;
		}

		const area = { ...open.area, bounds: open.cells.bounds };
		const scene = await this.canvas.show(editorAreaPayload(area, open.tiles, open.universe.ruleset), open.cells.chunks, this.host(), camera);

		if (this.open === open)
		{
			scene.setLinks(linksInArea(open, this.currentLinks(open.area.id, open.links)));
			this.showPaintedByOthers();
			this.showNeighbors();
		}
	}

	/**
	 * Shows the open area's neighbors past its edges, dimmed, as the Areas tab now has them: NEIGHBOR_PREVIEW_CELLS
	 * rows or columns of each neighbor and of the areas at the corners, and past the end of a row or column
	 * that loops, its other end. Their cells load as needed, and the buttons on the edges name the neighbors
	 */
	showNeighbors(): void
	{
		const open = this.open;
		const scene = this.canvas.scene;

		if (!open || !scene)
		{
			this.showEdgeButtons();
			return;
		}

		const grid = this.neighbors.grid();
		const lookup = seamLookupOf(grid);
		const bounds = open.cells.bounds;
		const reach: AreaBounds = {
			minColumn: bounds.minColumn - NEIGHBOR_PREVIEW_CELLS,
			minRow: bounds.minRow - NEIGHBOR_PREVIEW_CELLS,
			maxColumn: bounds.maxColumn + NEIGHBOR_PREVIEW_CELLS,
			maxRow: bounds.maxRow + NEIGHBOR_PREVIEW_CELLS
		};
		const shown: ShownNeighbor[] = [];

		for (const slot of (hasNeighbors(grid.get(open.area.id)?.neighbors ?? NO_NEIGHBORS) ? seamSlots(lookup, open.area.id) : []))
		{
			const area = ((slot.areaId === open.area.id) ? { ...open.area, bounds } : this.neighbors.area(slot.areaId));

			if (!area)
			{
				continue;
			}

			const shownBounds: AreaBounds = {
				minColumn: Math.max(reach.minColumn, area.bounds.minColumn + slot.columnOffset),
				minRow: Math.max(reach.minRow, area.bounds.minRow + slot.rowOffset),
				maxColumn: Math.min(reach.maxColumn, area.bounds.maxColumn + slot.columnOffset),
				maxRow: Math.min(reach.maxRow, area.bounds.maxRow + slot.rowOffset)
			};

			if ((shownBounds.minColumn > shownBounds.maxColumn) || (shownBounds.minRow > shownBounds.maxRow))
			{
				continue;
			}

			// The open area shown past its own looping edge is its cells as they are here, with the painting not yet saved
			let cells = ((slot.areaId === open.area.id) ? open.cells : this.neighborCells.get(slot.areaId));

			if (!cells || !sameBounds(cells.bounds, area.bounds))
			{
				cells = new AreaCells(area.bounds);
				this.neighborCells.set(slot.areaId, cells);
			}

			shown.push({
				area,
				cells,
				shownBounds,
				columnOffset: slot.columnOffset,
				rowOffset: slot.rowOffset
			});
		}

		this.shownNeighbors = shown;
		this.canvas.setPreviews(shown.map((neighbor) => neighbor.shownBounds));
		scene.setPreviews(shown.map((neighbor) => this.previewOf(open, neighbor)));
		this.showEdgeButtons();

		for (const neighbor of shown)
		{
			void this.loadNeighbor(open, neighbor);
		}
	}

	/**
	 * An area's cells with every chunk loaded, for drawing it whole: the open area's as they show here, with
	 * the painting not yet saved, and another's as saved
	 *
	 * @param area The area, at its size as the Areas tab has it
	 * @return The cells
	 */
	async cellsOf(area: EditorArea): Promise<AreaCells>
	{
		const open = this.open;

		if (open && (area.id === open.area.id))
		{
			await open.loader.loadAll();
			return(open.cells);
		}

		const cells = new AreaCells(area.bounds);
		const range = cells.chunkRange;

		cells.load(range, (await this.source.loadChunks(area.id, range)).chunks);

		return(cells);
	}

	/**
	 * A neighbor as the scene shows it
	 *
	 * @param open The open area
	 * @param neighbor The neighbor
	 * @return The preview
	 */
	private previewOf(open: OpenArea, neighbor: ShownNeighbor): NeighborPreview
	{
		const { shownBounds, columnOffset, rowOffset } = neighbor;
		const area = {
			...neighbor.area,
			bounds: {
				minColumn: shownBounds.minColumn - columnOffset,
				minRow: shownBounds.minRow - rowOffset,
				maxColumn: shownBounds.maxColumn - columnOffset,
				maxRow: shownBounds.maxRow - rowOffset
			},
			loopsEastWest: false,
			loopsNorthSouth: false
		};

		return({
			area: editorAreaPayload(area, open.tiles, open.universe.ruleset),
			chunks: neighbor.cells.chunks,
			columnOffset,
			rowOffset
		});
	}

	/**
	 * Loads the chunks of a neighbor that it shows past the open area's edges, and draws them as they come.
	 * An area added since the Areas tab was saved is all its default tile
	 *
	 * @param open The open area
	 * @param neighbor The neighbor
	 */
	private async loadNeighbor(open: OpenArea, neighbor: ShownNeighbor): Promise<void>
	{
		const { cells, shownBounds, columnOffset, rowOffset } = neighbor;

		if (cells === open.cells)
		{
			return;
		}

		const range: ChunkRange = {
			minChunkColumn: chunkCoordinate(shownBounds.minColumn - columnOffset),
			minChunkRow: chunkCoordinate(shownBounds.minRow - rowOffset),
			maxChunkColumn: chunkCoordinate(shownBounds.maxColumn - columnOffset),
			maxChunkRow: chunkCoordinate(shownBounds.maxRow - rowOffset)
		};

		if (cells.isLoaded(range.minChunkColumn, range.minChunkRow) && cells.isLoaded(range.maxChunkColumn, range.maxChunkRow))
		{
			return;
		}

		try
		{
			const { chunks } = await this.source.loadChunks(neighbor.area.id, range);
			const loaded = cells.load(range, chunks);

			if (this.open === open)
			{
				this.canvas.scene?.refreshPreview(neighbor.area.id, loaded);
			}
		}
		catch (error)
		{
			if (this.open === open)
			{
				showMessage(this.error, describeEditorError(error, areaEditorMessages.loadFailed));
			}
		}
	}

	/**
	 * Shows the buttons on the edges of the cells that have a neighbor past them, each naming it
	 */
	private showEdgeButtons(): void
	{
		const open = this.open;
		const grid = this.neighbors.grid();
		const slots = ((open && hasNeighbors(grid.get(open.area.id)?.neighbors ?? NO_NEIGHBORS)) ? seamSlots(seamLookupOf(grid), open.area.id) : []);

		this.edgeTargets = new Map();

		// The area past each edge and corner: a neighbor, or the far end of a row or column that loops
		for (const slot of slots)
		{
			const direction = EDGE_DIRECTIONS.find((each) => ((each.columns === slot.columns) && (each.rows === slot.rows)))?.direction;

			if ((direction !== undefined) && (slot.areaId !== open?.area.id))
			{
				this.edgeTargets.set(direction, slot.areaId);
			}
		}

		for (const [direction, button] of this.edgeButtons)
		{
			const areaId = this.edgeTargets.get(direction);
			const name = ((areaId === undefined) ? undefined : this.neighbors.area(areaId)?.name);

			button.hidden = (name === undefined);

			if (name === undefined)
			{
				button.replaceChildren();
				button.removeAttribute('aria-label');
				continue;
			}

			const directionText = document.createElement('span');
			const nameText = document.createElement('span');

			directionText.className = 'area-edge-direction';
			directionText.textContent = t({
				id: 'editor.area.edgeDirection',
				defaultMessage: '{direction, select, north {North} northEast {Northeast} east {East} southEast {Southeast} south {South} southWest {Southwest} west {West} other {Northwest}}',
				description: 'On a button on an edge or corner of the area editor\'s cells that opens the area past it (a neighboring area, walked across without a link, or the far end of a row of them that loops), in gray before that area\'s name: which edge or corner it is on'
			}, {
				direction
			});
			nameText.textContent = name;
			button.replaceChildren(directionText, ' ', nameText);
			button.setAttribute('aria-label', t({
				id: 'editor.area.edgeButton',
				defaultMessage: '{direction, select, north {North: {area}} northEast {Northeast: {area}} east {East: {area}} southEast {Southeast: {area}} south {South: {area}} southWest {Southwest: {area}} west {West: {area}} other {Northwest: {area}}}',
				description: 'What screen readers hear for a button on an edge or corner of the area editor\'s cells, which opens the area past it (a neighboring area, walked across without a link, or the far end of a row of them that loops); {direction} is which edge or corner and {area} that area\'s name'
			}, {
				direction,
				area: name
			}));
		}
	}

	/**
	 * The neighbor shown at a cell past the open area's edges, and the cell in it
	 *
	 * @param cell The cell, in the open area's columns and rows
	 * @return The neighbor and its cell, in its own columns and rows, or undefined for none
	 */
	private neighborAt(cell: BrushCell): { neighbor: ShownNeighbor; column: number; row: number } | undefined
	{
		const neighbor = this.shownNeighbors.find((each) => isInBounds(each.shownBounds, cell.column, cell.row));

		return(neighbor && {
			neighbor,
			column: cell.column - neighbor.columnOffset,
			row: cell.row - neighbor.rowOffset
		});
	}

	/**
	 * Marks on the canvas the cells other editors painted while the area was open
	 */
	private showPaintedByOthers(): void
	{
		this.canvas.scene?.setHighlights([...this.paintedByOthers].map(([key, painted]) =>
		{
			const [column, row] = key.split(',').map(Number);

			return({ column, row, color: (painted.overPainting ? PAINTED_OVER_COLOR : PAINTED_BY_OTHERS_COLOR) });
		}));
	}

	/**
	 * Takes in the painting another editor saved to the open area: loads the chunks it painted again, if
	 * they have loaded here, and marks each cell it changed, in the warning color where it painted over
	 * painting here: painting not yet saved, or saved from here while the area was open. A cell painted
	 * here and not yet saved keeps the painting here, which is saved over theirs, and undoing back to the
	 * saved cells gives theirs
	 *
	 * @param areaId The area painted
	 * @param chunks The chunks of the area the save painted
	 * @param name The display name of the editor who saved
	 * @return How many of the cells it changed had been painted here, and what takes its marks off the
	 * area, leaving those a later save made
	 */
	async followPainting(areaId: string, chunks: readonly ChunkCoordinates[], name: string): Promise<FollowedPainting>
	{
		const opened = this.open;
		const nothing: FollowedPainting = {
			paintedOver: 0,
			unmark: () =>
			{
				// The save marked nothing
			}
		};

		if (!opened || (opened.area.id !== areaId))
		{
			return(nothing);
		}

		let reloaded: Map<string, number[] | undefined>;

		try
		{
			reloaded = await opened.loader.reload(chunks);
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, areaEditorMessages.loadFailed));
			return(nothing);
		}

		// Showing the area's settings again keeps its cells, which a new size replaces
		const open = this.open;

		if (!open || (open.cells !== opened.cells))
		{
			return(nothing);
		}

		const applied: CellChange[] = [];
		const rebased: SavedCell[] = [];
		const save = ++this.followedSaves;
		let paintedOver = 0;

		for (const [chunk, cells] of reloaded)
		{
			const { chunkColumn, chunkRow } = parseChunkKey(chunk);

			for (let index = 0; index < (CHUNK_SIZE * CHUNK_SIZE); index++)
			{
				const column = (chunkColumn * CHUNK_SIZE) + (index % CHUNK_SIZE);
				const row = (chunkRow * CHUNK_SIZE) + Math.floor(index / CHUNK_SIZE);
				const key = `${column},${row}`;
				const theirs = (cells?.[index] ?? DEFAULT_TILE_CELL);
				const shown = open.cells.valueAt(column, row);
				const before = (this.savedValues.get(key) ?? this.stroke?.before.get(key)?.[2] ?? shown);

				if ((before === undefined) || (before === theirs))
				{
					continue;
				}

				// A cell painted here, in an earlier stroke or the one under way, keeps the painting here
				const mine = this.unsaved.get(key);
				const strokeBefore = this.stroke?.before.get(key);
				const strokeValue = this.stroke?.after.get(key);
				const overPainting = (this.paintedHere.has(key) || ((mine !== undefined) && (mine[2] !== theirs)) || ((strokeValue !== undefined) && (strokeValue !== theirs)));

				rebased.push({
					column,
					row,
					before,
					after: theirs
				});
				this.paintedByOthers.set(key, { name, overPainting, save });

				if (overPainting)
				{
					paintedOver++;
				}

				if (mine)
				{
					this.savedValues.set(key, theirs);

					if (mine[2] === theirs)
					{
						this.unsaved.delete(key);
						this.savedValues.delete(key);
					}
				}
				else if (strokeBefore)
				{
					strokeBefore[2] = theirs;
				}
				else
				{
					applied.push([column, row, theirs]);
				}
			}
		}

		this.history.rebase(rebased);

		if (applied.length > 0)
		{
			this.canvas.scene?.refreshChunks(open.cells.apply(applied));
		}

		this.showPaintedByOthers();
		this.showHoveredCell();
		this.unsavedChanged();

		return({
			paintedOver,
			unmark: () =>
			{
				this.unmarkPainting(open.cells, save);
			}
		});
	}

	/**
	 * Takes the marks one save made off the area, while the cells they are on are still open
	 *
	 * @param cells The cells the save painted
	 * @param save The save, as followPainting() numbered it
	 */
	private unmarkPainting(cells: AreaCells, save: number): void
	{
		if (this.open?.cells !== cells)
		{
			return;
		}

		for (const [key, painted] of this.paintedByOthers)
		{
			if (painted.save === save)
			{
				this.paintedByOthers.delete(key);
			}
		}

		this.showPaintedByOthers();
		this.showHoveredCell();
	}

	/**
	 * What clicks on the area do, and what the cell editor hears from the scene
	 *
	 * @return The host
	 */
	private host(): AreaEditorHost
	{
		return({
			pointerMode: () => this.pointerMode(),
			brush: () => this.brush(),
			paintStart: () =>
			{
				this.stroke = { before: new Map(), after: new Map() };
			},
			paint: (column, row) =>
			{
				this.paint(column, row);
			},
			paintEnd: () =>
			{
				this.finishStroke();
			},
			fill: (column, row) =>
			{
				void this.fill(column, row);
			},
			pickTile: (column, row) =>
			{
				this.pickTile(column, row);
			},
			pick: (column, row) =>
			{
				this.openLinkDialog(column, row);
			},
			hover: (cell) =>
			{
				this.hovered = cell;
				this.showHoveredCell();
			},
			describe: (cell) => this.cellText(cell),
			openNeighbor: (cell) =>
			{
				const found = this.neighborAt(cell);

				// The open area shown past its own looping edge is already open
				if (found && (found.neighbor.area.id !== this.open?.area.id))
				{
					this.neighbors.open(found.neighbor.area.id);
				}
			},
			viewChanged: (range) =>
			{
				this.view = range;
				this.open?.loader.request(range);
			}
		});
	}

	/**
	 * What a left click on the area does now: nothing while its cells are read-only or being saved
	 *
	 * @return The pointer mode
	 */
	private pointerMode(): PointerMode
	{
		if (!this.open?.editable || (this.pendingSaves > 0))
		{
			return('none');
		}

		if (this.drawTool.checked)
		{
			return('paint');
		}
		else if (this.fillTool.checked)
		{
			return('fill');
		}

		return('pick');
	}

	/**
	 * The brush the draw tool is set to
	 *
	 * @return Its size, within 1 and MAX_BRUSH_SIZE, and shape
	 */
	private brush(): { size: number; shape: BrushShape }
	{
		const size = Math.min(MAX_BRUSH_SIZE, Math.max(1, Math.floor(this.brushSize.valueAsNumber) || 1));

		return({ size, shape: this.brushShape.value as BrushShape });
	}

	/**
	 * The value the draw tool paints. The area's own default tile is painted as DEFAULT_TILE_CELL, so it
	 * follows the area's default tile and keeps chunks small
	 *
	 * @return A tile ID, DEFAULT_TILE_CELL or VOID_CELL
	 */
	private paintValue(): number
	{
		if (this.tile.value === UNEXPLORED_CHOICE)
		{
			return(VOID_CELL);
		}

		const tileId = Number(this.tile.value);

		return(((tileId === this.open?.area.resolved.defaultTileId) ? DEFAULT_TILE_CELL : tileId));
	}

	/**
	 * Dabs the brush on a cell: changes every loaded cell it covers in the area, and remembers what they
	 * were. A stroke started before a save does nothing more while it is being sent
	 *
	 * @param column The cell's column
	 * @param row The cell's row
	 */
	private paint(column: number, row: number): void
	{
		const open = this.open;
		const stroke = this.stroke;

		if (!open || !stroke || (this.pendingSaves > 0))
		{
			return;
		}

		const { size, shape } = this.brush();
		const value = this.paintValue();
		const changes: CellChange[] = [];

		for (const cell of brushCells(column, row, size, shape))
		{
			const before = open.cells.valueAt(cell.column, cell.row);
			const key = `${cell.column},${cell.row}`;

			if ((before === undefined) || (before === value))
			{
				continue;
			}

			if (!stroke.before.has(key))
			{
				stroke.before.set(key, [cell.column, cell.row, before]);
			}

			stroke.after.set(key, value);
			changes.push([cell.column, cell.row, value]);
		}

		if (changes.length > 0)
		{
			this.canvas.scene?.refreshChunks(open.cells.apply(changes));
			this.showHoveredCell();
		}
	}

	/**
	 * Ends a stroke: records it as one step to undo, and as unsaved painting
	 */
	private finishStroke(): void
	{
		const stroke = this.stroke;
		const changes: CellChange[] = [];
		const inverse: CellChange[] = [];

		this.stroke = undefined;

		for (const [key, value] of (stroke?.after ?? []))
		{
			const before = stroke?.before.get(key);

			if (before && (before[2] !== value))
			{
				changes.push([before[0], before[1], value]);
				inverse.push(before);
			}
		}

		if (changes.length === 0)
		{
			return;
		}

		this.history.push({ changes, inverse });
		this.trackChanges(changes, inverse);
		this.updateButtons();
	}

	/**
	 * Fills from a cell with the Tile list's tile, as one step to undo: the cell and every cell joined to it
	 * to the north, east, south or west holding the same tile. A fill of more than FILL_CONFIRM_CELLS cells
	 * asks first. Says how many cells it painted, for screen readers
	 *
	 * @param column The cell's column
	 * @param row The cell's row
	 */
	private async fill(column: number, row: number): Promise<void>
	{
		const open = this.open;

		if (!open || this.filling || this.stroke || (this.pendingSaves > 0))
		{
			return;
		}

		const value = this.paintValue();

		this.filling = true;

		try
		{
			let cells = await this.cellsToFill(open.cells, column, row, value);

			if ((cells !== undefined) && (cells.length > FILL_CONFIRM_CELLS))
			{
				const confirmed = await askToConfirm({
					title: t({
						id: 'editor.area.fillConfirmTitle',
						defaultMessage: 'Fill Cells',
						description: 'Title of the dialog asking before the area editor\'s Fill tool paints a large number of cells'
					}),
					question: t({
						id: 'editor.area.fillConfirm',
						defaultMessage: 'This fill paints {count, plural, one {# cell} other {# cells}}. Fill them?',
						description: 'Asked before the area editor\'s Fill tool paints more than 1,000 cells at once; {count} is how many. Undo takes the fill back'
					}, {
						count: cells.length
					}),
					confirmLabel: t({
						id: 'editor.area.fillConfirmButton',
						defaultMessage: 'Fill',
						description: 'Button in the dialog asking before the area editor\'s Fill tool paints a large number of cells, which paints them'
					}),
					confirmIcon: fillIcon,
					harmless: true
				});

				// Other editors' painting may have reached the area while the dialog was open
				cells = (confirmed ? await this.cellsToFill(open.cells, column, row, value) : undefined);
			}

			const current = this.open;

			if ((cells === undefined) || (current?.cells !== open.cells) || this.stroke || (this.pendingSaves > 0))
			{
				return;
			}

			if (cells.length === 0)
			{
				if (isInBounds(open.cells.bounds, column, row))
				{
					announce(t({
						id: 'editor.area.fillSameTile',
						defaultMessage: 'The cell already holds that tile.',
						description: 'Read out by screen readers when the area editor\'s Fill tool is used on a cell already holding the tile chosen to paint, so nothing changes'
					}));
				}

				return;
			}

			const step: EditStep = {
				changes: cells.map(([cellColumn, cellRow]) => [cellColumn, cellRow, value]),
				inverse: cells
			};

			showMessage(this.error, undefined);
			this.history.push(step);
			this.applyStep(step.changes, step.inverse);
			announce(t({
				id: 'editor.area.filled',
				defaultMessage: '{count, plural, one {Filled # cell.} other {Filled # cells.}}',
				description: 'Read out by screen readers after the area editor\'s Fill tool painted cells; {count} is how many'
			}, {
				count: cells.length
			}));
		}
		catch (error)
		{
			if (this.open?.cells === open.cells)
			{
				showMessage(this.error, describeEditorError(error, areaEditorMessages.loadFailed));
			}
		}
		finally
		{
			this.filling = false;
		}
	}

	/**
	 * Chooses a cell's tile in the Tile list, whatever the tool, without changing the cell; a cell holding
	 * the area's default tile chooses it. When the list doesn't offer the tile, the status line under the
	 * cells says why and the list is left as it was
	 *
	 * @param column The cell's column
	 * @param row The cell's row
	 */
	private pickTile(column: number, row: number): void
	{
		const open = this.open;
		const across = ((open && !isInBounds(open.cells.bounds, column, row)) ? this.neighborAt({ column, row }) : undefined);

		if (!open?.editable || (!isInBounds(open.cells.bounds, column, row) && !across))
		{
			return;
		}

		// A neighbor shown past the edge gives its tile too, its default tile being its own
		const value = (across ? across.neighbor.cells.valueAt(across.column, across.row) : open.cells.valueAt(column, row));
		const defaultTileId = (across?.neighbor.area.resolved.defaultTileId ?? open.area.resolved.defaultTileId);

		if (value === undefined)
		{
			this.pickStatus.textContent = t({
				id: 'editor.area.pickLoading',
				defaultMessage: 'That part of the area is still loading, so its tile can\'t be chosen yet.',
				description: 'Under the area editor\'s cells, after a middle click or P on a cell whose part of the area hasn\'t loaded yet, so its tile wasn\'t chosen in the Tile list'
			});
			return;
		}

		const tileId = ((value === DEFAULT_TILE_CELL) ? defaultTileId : value);
		const choice = ((value === VOID_CELL) ? UNEXPLORED_CHOICE : String(tileId));
		const option = [...this.tile.options].find((candidate) => (candidate.value === choice));

		if (option)
		{
			this.tile.value = choice;
			this.pickStatus.textContent = t({
				id: 'editor.area.picked',
				defaultMessage: 'Chose {tile} in the Tile list.',
				description: 'Under the area editor\'s cells, after a middle click or P on a cell chose its tile as the tile to paint with; {tile} is the tile as the Tile list names it'
			}, {
				tile: option.text
			});
			return;
		}

		const tile = open.tiles.find((candidate) => (candidate.id === tileId));
		let reason = 'unknown';

		if (tile && this.deletedTiles.has(tile.id))
		{
			reason = 'deleted';
		}
		else if (tile && !tile.enabled)
		{
			reason = 'disabled';
		}
		else if (tile)
		{
			reason = (this.listedIndoors ? 'indoors' : 'outdoors');
		}

		this.pickStatus.textContent = t({
			id: 'editor.area.pickUnavailable',
			defaultMessage: '{reason, select, deleted {{tile} will be deleted when the Tilesets tab is saved, so it can\'t be chosen to paint with.} disabled {{tile} is disabled, so it can\'t be chosen to paint with.} indoors {{tile} isn\'t used in indoor areas, so it can\'t be chosen to paint with here.} outdoors {{tile} isn\'t used in outdoor areas, so it can\'t be chosen to paint with here.} other {This cell\'s tile can\'t be chosen to paint with.}}',
			description: 'Under the area editor\'s cells, after a middle click or P on a cell whose tile the Tile list doesn\'t offer, so it wasn\'t chosen; {tile} is the tile\'s name and {reason} why: deleted (the Tilesets tab will delete it), disabled (turned off on the Tilesets tab), indoors or outdoors (the tile isn\'t used in that kind of area, which the area is), or other (a tile the editor doesn\'t know)'
		}, {
			reason,
			tile: (tile ? tileName(tile, open.universe.ruleset) : '')
		});
	}

	/**
	 * The cells a fill from a cell paints, loading the rest of the area first when the fill reaches cells
	 * that haven't loaded. The area's default tile counts as the same tile whether a cell holds it as
	 * DEFAULT_TILE_CELL or by its ID
	 *
	 * @param cells The open area's cells
	 * @param column The cell's column
	 * @param row The cell's row
	 * @param value The value the fill paints
	 * @return Each cell to paint with its value now, none when the cell filled from is outside the area or
	 * already holds the tile, or undefined once the area has closed
	 */
	private async cellsToFill(cells: AreaCells, column: number, row: number, value: number): Promise<CellChange[] | undefined>
	{
		const open = this.open;

		if (open?.cells !== cells)
		{
			return(undefined);
		}

		const defaultTileId = open.area.resolved.defaultTileId;
		const tileOf = (cell: number): number => ((cell === defaultTileId) ? DEFAULT_TILE_CELL : cell);
		const sameTile = (first: number, second: number): boolean => (tileOf(first) === tileOf(second));
		const valueAt = (cellColumn: number, cellRow: number): number | undefined => cells.valueAt(cellColumn, cellRow);
		let filled = areaFill(cells.bounds, column, row, valueAt, sameTile);

		if (!filled.complete)
		{
			await open.loader.loadAll();
			filled = areaFill(cells.bounds, column, row, valueAt, sameTile);
		}

		const target = valueAt(column, row);

		if ((this.open?.cells !== cells) || !filled.complete)
		{
			return(undefined);
		}

		if ((target === undefined) || sameTile(target, value))
		{
			return([]);
		}

		return(filled.cells.map(([cellColumn, cellRow]) => [cellColumn, cellRow, (valueAt(cellColumn, cellRow) ?? DEFAULT_TILE_CELL)]));
	}

	/**
	 * Undoes the latest step
	 */
	private undo(): void
	{
		if (this.pendingSaves > 0)
		{
			return;
		}

		const step = this.history.undo();

		if (step)
		{
			this.applyStep(step.inverse, step.changes, step.bounds?.before, step.carried?.map(({ areaId, before }) => ({ areaId, bounds: before })));
		}
	}

	/**
	 * Makes the latest undone step again
	 */
	private redo(): void
	{
		if (this.pendingSaves > 0)
		{
			return;
		}

		const step = this.history.redo();

		if (step)
		{
			this.applyStep(step.changes, step.inverse, step.bounds?.after, step.carried?.map(({ areaId, after }) => ({ areaId, bounds: after })));
		}
	}

	/**
	 * Changes cells in the area and records them as unsaved painting, and changes the area's bounds, for undo and redo
	 *
	 * @param changes The cells and their values
	 * @param previous The same cells' values before, in the same order
	 * @param bounds The area's bounds after the step, for a change of the area's size
	 * @param carried The bounds of the other areas in its row or column after the step, for a change of size
	 * that carries them along
	 */
	private applyStep(changes: EditStep['changes'], previous: EditStep['changes'], bounds?: AreaBounds, carried?: { areaId: string; bounds: AreaBounds }[]): void
	{
		if (this.open && (changes.length > 0))
		{
			this.canvas.scene?.refreshChunks(this.open.cells.apply(changes));
			this.showHoveredCell();
			this.trackChanges(changes, previous);
		}

		for (const { areaId, bounds: areaBounds } of (carried ?? []))
		{
			this.neighbors.setBounds(areaId, areaBounds);
		}

		if (bounds)
		{
			void this.setBounds(bounds);
		}

		this.updateButtons();
	}

	/**
	 * Changes the area's size as one step to undo, carrying the other areas in its row or column along so
	 * touching sides stay the same length. Cells a smaller area cuts off are set to the default tile, so
	 * undoing the step brings them back, and undoing it puts back every area's size
	 *
	 * @param bounds The new bounds
	 */
	private resize(bounds: AreaBounds): void
	{
		const open = this.open;

		if (!open || sameBounds(bounds, open.cells.bounds))
		{
			return;
		}

		const inverse = open.cells.paintedCellsOutside(bounds);
		const changes: CellChange[] = inverse.map(([column, row]) => [column, row, DEFAULT_TILE_CELL]);
		const grid = this.neighbors.grid();
		const carried = [...carriedResizes(grid, open.area.id, open.cells.bounds, bounds)].map(([areaId, after]) => ({
			areaId,
			before: (grid.get(areaId)?.bounds ?? after),
			after
		}));
		const step: EditStep = {
			changes,
			inverse,
			bounds: {
				before: open.cells.bounds,
				after: bounds
			},
			...((carried.length === 0) ? {} : { carried })
		};

		showMessage(this.error, undefined);
		this.history.push(step);
		this.applyStep(step.changes, step.inverse, bounds, carried.map(({ areaId, after }) => ({ areaId, bounds: after })));
	}

	/**
	 * Gives the area new bounds and shows it afresh, keeping the view where it is
	 *
	 * @param bounds The bounds
	 */
	private async setBounds(bounds: AreaBounds): Promise<void>
	{
		if (!this.open)
		{
			return;
		}

		this.open.cells.setBounds(bounds);
		this.onBoundsChanged(bounds);
		this.unsavedChanged();
		await this.startScene(this.canvas.scene?.cameraState());
	}

	/**
	 * Shows whether painting is being saved or hasn't been saved yet
	 */
	private updateSaveStatus(): void
	{
		if (this.pendingSaves > 0)
		{
			this.saveStatus.textContent = t(formMessages.saving);
		}
		else if (this.hasUnsavedChanges())
		{
			this.saveStatus.textContent = t({
				id: 'editor.area.unsaved',
				defaultMessage: 'Area changes not saved yet',
				description: 'Shown under the area editor\'s cells while they have painting, a change of size or links that the editor\'s Save button hasn\'t stored yet'
			});
		}
		else
		{
			this.saveStatus.textContent = '';
		}
	}

	/**
	 * Enables undo and redo when there is something to undo or redo, and disables changing the area's cells while they are being saved
	 */
	private updateButtons(): void
	{
		const saving = (this.pendingSaves > 0);

		this.undoButton.disabled = (saving || !this.history.canUndo);
		this.redoButton.disabled = (saving || !this.history.canRedo);
		this.resizeButton.disabled = saving;
	}

	/**
	 * Shows the cell under the pointer or the keyboard's cursor and what it holds
	 */
	private showHoveredCell(): void
	{
		this.cursor.textContent = (this.hovered ? this.cellText(this.hovered) : '');
	}

	/**
	 * A cell of the open area and what it holds
	 *
	 * @param cell The cell
	 * @return Its description, or an empty string when no area is open or the cell is outside it
	 */
	private cellText(cell: BrushCell): string
	{
		const open = this.open;

		if (!open)
		{
			return('');
		}

		const across = (isInBounds(open.cells.bounds, cell.column, cell.row) ? undefined : this.neighborAt(cell));

		if (across)
		{
			const { neighbor } = across;

			return(t({
				id: 'editor.area.neighborCell',
				defaultMessage: '{area}: {cell}',
				description: 'Under the area editor\'s cells, a cell of a neighboring area shown dimmed past the area\'s edge (walked across without a link), under the pointer or the keyboard\'s cursor: {area} is the neighbor\'s name and {cell} the cell in it and what it holds, e.g. "3, -2: Grass"'
			}, {
				area: neighbor.area.name,
				cell: describeCell({
					cells: neighbor.cells,
					defaultTileId: neighbor.area.resolved.defaultTileId,
					tiles: open.tiles,
					links: [],
					ruleset: open.universe.ruleset
				}, across)
			}));
		}

		const described = describeCell({
			cells: open.cells,
			defaultTileId: open.area.resolved.defaultTileId,
			tiles: open.tiles,
			links: this.currentLinks(open.area.id, open.links),
			ruleset: open.universe.ruleset
		}, cell);
		const paintedBy = this.paintedByOthers.get(`${cell.column},${cell.row}`);

		return((((paintedBy === undefined) || (described === ''))
			? described
			: t({
				id: 'editor.area.cellPaintedBy',
				defaultMessage: '{over, select, yes {{cell} (painted by {name} over your painting while you had this area open)} other {{cell} (painted by {name} while you had this area open)}}',
				description: 'Under the area editor\'s cells, the cell under the pointer or the keyboard\'s cursor when another editor painted it and saved while the player had the area open; the area editor marks such cells. {cell} is the cell and what it holds, e.g. "3, -2: Grass", {name} the other editor\'s display name, and {over} yes when the player had painted the cell too (saved or not), which the area editor marks in a warning color'
			}, {
				over: (paintedBy.overPainting ? 'yes' : 'no'),
				cell: described,
				name: paintedBy.name
			})));
	}

	/**
	 * Lists the tiles to paint with for an indoor or outdoor area, as the area editor's choice changes
	 * before it is saved. Cells already painted keep their tiles
	 *
	 * @param indoors Whether the area is indoors
	 */
	showTilesFor(indoors: boolean): void
	{
		const open = this.open;

		if (open)
		{
			this.fillTiles(open.universe, { ...open.area, resolved: { ...open.area.resolved, indoors } }, open.tiles, true);
		}
	}

	/**
	 * Lists and draws the tiles as the Tilesets tab's changes make them, keeping the area's unsaved
	 * painting, undo history, links and camera
	 *
	 * @param tiles Every tile the universe can use, with the Tilesets tab's changes
	 * @param deletedTiles The tiles the Tilesets tab will delete, which can't be painted with
	 * @param indoors Whether the area is indoors, as the area editor's choice now is
	 */
	async setTiles(tiles: readonly EditorTile[], deletedTiles: ReadonlyMap<number, number | undefined>, indoors: boolean): Promise<void>
	{
		const open = this.open;

		if (!open)
		{
			return;
		}

		const camera = this.canvas.scene?.cameraState();

		this.deletedTiles = deletedTiles;
		this.open = { ...open, tiles };
		this.fillTiles(open.universe, { ...open.area, resolved: { ...open.area.resolved, indoors } }, tiles, true);
		await this.startScene(camera);
	}

	/**
	 * Lists the tiles to paint with: the area's enabled indoor or outdoor tiles but those the Tilesets tab
	 * will delete, and its default tile, by name, then Unexplored, and chooses the default tile
	 *
	 * @param universe The area's universe
	 * @param area The area
	 * @param tiles Every tile the universe can use
	 * @param keepChoice Whether to keep the tile chosen before, when it is still listed
	 */
	private fillTiles(universe: EditableUniverse, area: EditorArea, tiles: readonly EditorTile[], keepChoice: boolean): void
	{
		const chosen = (keepChoice ? this.tile.value : String(area.resolved.defaultTileId));

		this.listedIndoors = area.resolved.indoors;
		const paintable = tiles
			.filter((tile) => ((canPaintTile(tile, area.resolved.indoors) && !this.deletedTiles.has(tile.id)) || (tile.id === area.resolved.defaultTileId)))
			.map((tile) => ({
				tile,
				name: tileName(tile, universe.ruleset)
			}))
			.sort((a, b) => a.name.localeCompare(b.name, currentLocale()));

		setOptions(this.tile, [
			...paintable.map(({ tile, name }) => ({
				value: String(tile.id),
				label: ((tile.id === area.resolved.defaultTileId)
					? t({
						id: 'editor.area.areaDefault',
						defaultMessage: '{tile} (default)',
						description: 'A choice of tile to paint that is the area\'s default tile; {tile} is its name'
					}, {
						tile: name
					})
					: name)
			})),
			{
				value: UNEXPLORED_CHOICE,
				label: t(areaEditorMessages.unexplored)
			}
		]);

		this.tile.value = ([...this.tile.options].some((option) => (option.value === chosen)) ? chosen : String(area.resolved.defaultTileId));
	}

	/**
	 * Opens Edit Size, starting from the area's size as shown. The new size is one step to undo, saved with save()
	 */
	private openResizeDialog(): void
	{
		const open = this.open;

		if (!open)
		{
			return;
		}

		const grid = this.neighbors.grid();
		const withNeighbors = hasNeighbors(grid.get(open.area.id)?.neighbors ?? NO_NEIGHBORS);

		this.resizeDialog.open({
			bounds: open.cells.bounds,
			check: (bounds) => this.checkResize(open, bounds),
			carried: (bounds) => [...carriedResizes(this.neighbors.grid(), open.area.id, open.cells.bounds, bounds).keys()].map((areaId) => (this.neighbors.area(areaId)?.name ?? areaId)),
			minimumSide: (withNeighbors ? MIN_NEIGHBOR_AREA_SIDE : undefined),
			onResize: (bounds) =>
			{
				if ((this.open === open) && (this.pendingSaves === 0))
				{
					this.resize(bounds);
				}
			}
		});
	}

	/**
	 * Finds out what new bounds would cut off the area, and the areas its row or column carries along,
	 * first loading every chunk they would cut off
	 *
	 * @param open The area open when Edit Size opened
	 * @param bounds The new bounds
	 * @return The painted cells and the areas' own links outside their new bounds
	 */
	private async checkResize(open: OpenArea, bounds: AreaBounds): Promise<ResizeLoss>
	{
		await open.loader.loadOutside(bounds);

		const loss: ResizeLoss = {
			cells: open.cells.paintedCellsOutside(bounds).length,
			links: this.currentLinks(open.area.id, open.links).filter((link) => (isInBounds(open.cells.bounds, link.column, link.row) && !isInBounds(bounds, link.column, link.row))).length
		};

		for (const [areaId, after] of carriedResizes(this.neighbors.grid(), open.area.id, open.cells.bounds, bounds))
		{
			const area = this.neighbors.area(areaId);

			if (!area)
			{
				continue;
			}

			// One request holds every chunk of the largest area
			const cells = new AreaCells(area.bounds);
			const range = cells.chunkRange;

			cells.load(range, (await this.source.loadChunks(areaId, range)).chunks);
			loss.cells += cells.paintedCellsOutside(after).length;
			loss.links += (await this.source.listLinks(areaId)).filter((link) => (isInBounds(area.bounds, link.column, link.row) && !isInBounds(after, link.column, link.row))).length;
		}

		return(loss);
	}

	/**
	 * Opens the link dialog for a cell of the area
	 *
	 * @param column The cell's column
	 * @param row The cell's row
	 */
	private openLinkDialog(column: number, row: number): void
	{
		const open = this.open;

		if (!open || !isInBounds(open.cells.bounds, column, row))
		{
			return;
		}

		this.linkDialog.open({
			source: this.linkSource(),
			area: open.area,
			column,
			row,
			link: this.currentLinks(open.area.id, open.links).find((link) => ((link.column === column) && (link.row === row))),
			areas: open.areas,
			tiles: open.tiles,
			ruleset: open.universe.ruleset,
			onChanged: (changes) =>
			{
				this.stageLinks(open, changes);
			}
		});
	}

	/**
	 * Loads the area's saved links again after saving
	 *
	 * @param open The area open when saving started
	 */
	private async reloadLinks(open: OpenArea): Promise<void>
	{
		try
		{
			const links = await this.source.listLinks(open.area.id);

			if (this.open === open)
			{
				open.links = links;
				this.canvas.scene?.setLinks(linksInArea(open, this.currentLinks(open.area.id, links)));
			}
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, messages.loadLinksFailed));
		}
	}

	/**
	 * Shows the cell editor over the whole window, with the canvas filling the space left, or puts it back in the page
	 *
	 * @param fullPage True to cover the window
	 */
	private setFullPage(fullPage: boolean): void
	{
		this.fullPage = fullPage;
		this.section.classList.toggle('full-page', fullPage);

		// The page can't scroll under an area that fills the window, so the wheel scrolls the area
		this.canvas.setWheelPans(fullPage);

		if (fullPage)
		{
			setButtonLabel(this.fullPageButton, exitFullPageIcon, t({
				id: 'editor.area.exitFullPage',
				defaultMessage: 'Exit Full Page',
				description: 'Button that puts the area editor\'s cells and their tools back in the page after they were made to fill the window'
			}));
		}
		else
		{
			setButtonLabel(this.fullPageButton, fullPageIcon, t({
				id: 'editor.area.fullPage',
				defaultMessage: 'Full Page',
				description: 'Button that makes the area editor\'s cells and their tools fill the window'
			}));
		}

		this.fitCanvas();
	}

	/**
	 * Sizes the canvas to fill its element's width, and its height too while the cell editor is full
	 * page; in the page the view keeps its usual height
	 */
	private fitCanvas(): void
	{
		const width = this.canvasElement.clientWidth;

		// A hidden canvas has no size to fit
		if (width === 0)
		{
			return;
		}

		this.canvas.setSize(width, (this.fullPage ? this.canvasElement.clientHeight : VIEW_HEIGHT));
	}

	/**
	 * Leaves full page on Escape when no dialog is open, and while the area is showing and nothing is
	 * being typed, undoes on Ctrl+Z and redoes on Ctrl+Y or Ctrl+Shift+Z
	 *
	 * @param event The key press
	 */
	private readonly onKeyDown = (event: KeyboardEvent): void =>
	{
		if (this.fullPage && (event.key === 'Escape') && !document.querySelector('dialog[open]'))
		{
			event.preventDefault();
			this.setFullPage(false);
			return;
		}

		const target = event.target;
		const typing = ((target instanceof HTMLInputElement) || (target instanceof HTMLTextAreaElement) || (target instanceof HTMLSelectElement));

		// Autofill and some extensions send keydown events without a key
		if (typeof event.key !== 'string')
		{
			return;
		}

		const key = event.key.toLowerCase();

		// offsetParent is null while the canvas, or anything it is inside, is hidden
		const showing = (this.canvasElement.offsetParent !== null);

		if (!this.open?.editable || typing || !showing || !(event.ctrlKey || event.metaKey) || (this.canvas.scene === undefined))
		{
			return;
		}

		if ((key === 'z') && !event.shiftKey)
		{
			event.preventDefault();
			this.undo();
		}
		else if ((key === 'y') || ((key === 'z') && event.shiftKey))
		{
			event.preventDefault();
			this.redo();
		}
	};
}

/**
 * Whether two sets of bounds are the same
 *
 * @param first One area's bounds
 * @param second The other's
 * @return True when every edge matches
 */
function sameBounds(first: AreaBounds, second: AreaBounds): boolean
{
	return(
		(first.minColumn === second.minColumn) &&
		(first.minRow === second.minRow) &&
		(first.maxColumn === second.maxColumn) &&
		(first.maxRow === second.maxRow)
	);
}

/**
 * The area's links on cells inside its bounds as shown: links a smaller area cuts off stay until
 * the size is saved, but aren't shown
 *
 * @param open The open area
 * @param links The area's links
 * @return The links
 */
function linksInArea(open: OpenArea, links: readonly EditorAreaLink[]): EditorAreaLink[]
{
	return(links.filter((link) => isInBounds(open.cells.bounds, link.column, link.row)));
}

/**
 * Identifies a cell's link among the links not yet saved
 *
 * @param areaId The area the cell is in
 * @param column The cell's column
 * @param row The cell's row
 * @return The key
 */
function linkKey(areaId: string, column: number, row: number): string
{
	return(`${areaId}:${column},${row}`);
}

/**
 * The smallest bounds holding two sets of bounds
 *
 * @param first One area's bounds
 * @param second The other's
 * @return The bounds
 */
function unionBounds(first: AreaBounds, second: AreaBounds): AreaBounds
{
	return({
		minColumn: Math.min(first.minColumn, second.minColumn),
		minRow: Math.min(first.minRow, second.minRow),
		maxColumn: Math.max(first.maxColumn, second.maxColumn),
		maxRow: Math.max(first.maxRow, second.maxRow)
	});
}
