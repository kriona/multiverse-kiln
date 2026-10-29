import exitFullPageIcon from 'virtual:icon/ph:arrows-in';
import fullPageIcon from 'virtual:icon/ph:arrows-out';
import { canPaintTile, DEFAULT_TILE_CELL, defineMessages, isInBounds, MAX_BRUSH_SIZE, MAX_CELL_CHANGES, MAX_MAP_SIDE, VOID_CELL, VIEW_HEIGHT, VIEW_WIDTH, type CellChange, type EditableUniverse, type EditorTile, type EditorArea, type EditorAreaLink, type EditorAreaSummary, type MapBounds, type MessageDescriptor, type NumberRef, type StringRef } from '@multiverse-kiln/shared';

import { BRUSH_SHAPES, brushCells, type BrushCell, type BrushShape } from '../../editor/brush';
import { ChunkLoader } from '../../editor/ChunkLoader';
import { EditHistory, type EditStep } from '../../editor/EditHistory';
import { EditorMap } from '../../editor/EditorMap';
import { editorAreaPayload, MapCanvas } from '../../editor/MapCanvas';
import { currentLocale, t } from '../../localization';
import { describeEditorError, EditorApiError } from '../../network/editorApi';
import type { CameraState, MapEditorHost, PointerMode } from '../../scenes/MapEditorScene';
import { getElement, namedOptions, setButtonLabel, setOptions, showMessage } from '../dom';
import { formMessages } from '../formMessages';
import { addKeyHelp, formatKeys } from '../shortcuts';
import { tileName } from '../tileNames';
import type { AreaSource, LinkChange } from './areaSource';
import { describeCell } from './cellDescription';
import type { EditorSave, SaveRefusal } from './editorSave';
import { LinkDialog } from './LinkDialog';
import { mapMessages } from './mapMessages';
import { ResizeDialog, type ResizeLoss } from './ResizeDialog';

/**
 * Text the map editor shows in more than one place (see src/localization.ts)
 */
const messages = defineMessages({
	loadLinksFailed: {
		id: 'editor.map.loadLinksFailed',
		defaultMessage: 'Could not load the links.',
		description: 'Shown in the map editor when the area\'s links couldn\'t be loaded'
	}
});

/**
 * Each brush shape's name
 */
const BRUSH_SHAPE_NAMES: Record<BrushShape, MessageDescriptor> = defineMessages({
	square: {
		id: 'editor.map.brush.square',
		defaultMessage: 'square',
		description: 'Shape of the Draw tool\'s brush'
	},
	circle: {
		id: 'editor.map.brush.circle',
		defaultMessage: 'circle',
		description: 'Shape of the Draw tool\'s brush'
	}
});

/**
 * Value of the tile choice for Void
 */
const VOID_CHOICE = 'void';

/**
 * The sides of a map, as the expand buttons name them
 */
type Side = 'north' | 'east' | 'south' | 'west';

const sides: Side[] = [
	'north',
	'east',
	'south',
	'west'
];

/**
 * The area being edited and everything that goes with it
 */
interface OpenArea
{
	universe: EditableUniverse;
	area: EditorArea;
	tiles: readonly EditorTile[];
	areas: readonly EditorAreaSummary[];
	map: EditorMap;
	loader: ChunkLoader;

	/**
	 * The area's links as saved; the map shows them with the link changes not yet saved (currentLinks)
	 */
	links: EditorAreaLink[];

	/**
	 * Whether the map can be changed
	 */
	editable: boolean;
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
 * The map editor in the area editor: the area's map on the same grid as gameplay, a draw tool (a tile
 * or Void, 1 to MAX_BRUSH_SIZE cells across, square or circle) with undo and redo, buttons to grow the
 * map on each side, Edit Size, and a tool for the map's area links
 *
 * Painting, changes to the map's size and links show immediately and are kept until the editor's Save
 * button calls save(); a click, a drag or a change of size is one step to undo
 */
export class MapEditor
{
	private readonly tools = getElement('map-tools', HTMLElement);
	private readonly drawTool = getElement('map-tool-draw', HTMLInputElement);
	private readonly tile = getElement('map-tile', HTMLSelectElement);
	private readonly brushSize = getElement('map-brush-size', HTMLInputElement);
	private readonly brushShape = getElement('map-brush-shape', HTMLSelectElement);
	private readonly undoButton = getElement('map-undo', HTMLButtonElement);
	private readonly redoButton = getElement('map-redo', HTMLButtonElement);
	private readonly resizeButton = getElement('map-resize', HTMLButtonElement);
	private readonly section = getElement('map-editor', HTMLElement);
	private readonly fullPageButton = getElement('map-full-page', HTMLButtonElement);
	private readonly expandButtons = sides.map((side) => getElement(`map-expand-${side}`, HTMLButtonElement));
	private readonly expandField = getElement('map-expand-field', HTMLElement);
	private readonly expandBy = getElement('map-expand-by', HTMLInputElement);
	private readonly cursor = getElement('map-cursor', HTMLElement);
	private readonly saveStatus = getElement('map-save-status', HTMLElement);
	private readonly error = getElement('map-error', HTMLElement);
	private readonly canvasElement = getElement('map-canvas', HTMLElement);
	private readonly canvas = new MapCanvas(this.canvasElement, VIEW_WIDTH, VIEW_HEIGHT);
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
	 * Whether the map editor covers the window (see setFullPage)
	 */
	private fullPage = false;

	/**
	 * The cell under the pointer, while it is over the map
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
	 * Links added, changed or deleted that haven't been saved, in this area and return links in others,
	 * by linkKey()
	 */
	private stagedLinks = new Map<string, LinkChange>();

	/**
	 * Saves being sent; the map is read-only while there are any
	 */
	private pendingSaves = 0;

	/**
	 * What the save being sent holds: the area, its new bounds, the cells painted and the link changes
	 */
	private collected: { areaId: string; bounds: MapBounds; cells: CellChange[]; links: [string, LinkChange][] } | undefined;

	/**
	 * Whether the player agreed to delete the links a smaller map cuts off, for the next save
	 */
	private discardOnSave = false;

	/**
	 * Whether showing the open area again loads its map afresh, after a save made the tiles it is painted with
	 */
	private reloadOnShow = false;

	/**
	 * The tiles the Tilesets tab will delete, which can't be painted with
	 */
	private deletedTiles: ReadonlyMap<number, number | undefined> = new Map();

	/**
	 * Changes every time an area is opened, so data that arrives for an earlier one is ignored
	 */
	private openVersion = 0;

	/**
	 * @param source Where the areas, their links and their maps' chunks come from
	 * @param onBoundsChanged Called with an area's new bounds after the map editor resizes it
	 * @param onUnsavedChanged Called with whether the map has painting, a change of size or links that haven't been saved, whenever that may have changed
	 */
	constructor(private readonly source: AreaSource, private readonly onBoundsChanged: (bounds: MapBounds) => void, private readonly onUnsavedChanged: (unsaved: boolean) => void)
	{
		this.resizeDialog = new ResizeDialog();
		this.linkDialog = new LinkDialog();
		this.brushSize.max = String(MAX_BRUSH_SIZE);
		setOptions(this.brushShape, namedOptions(BRUSH_SHAPES, BRUSH_SHAPE_NAMES));
		this.canvasElement.style.setProperty('--map-view-width', `${VIEW_WIDTH}px`);
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

		this.setFullPage(false);

		sides.forEach((side, index) =>
		{
			this.expandButtons[index].addEventListener('click', () =>
			{
				this.expand(side);
			});
		});

		document.addEventListener('keydown', this.onKeyDown);
		this.addKeyHelp();
	}

	/**
	 * Lists the keys the map handles itself in the list of shortcuts: undo and redo while the tools
	 * show, and the keyboard's cursor (see MapCanvas) while the map does
	 */
	private addKeyHelp(): void
	{
		addKeyHelp({
			scope: this.tools,
			keys: () => formatKeys('Control+Z'),
			description: () => t({
				id: 'editor.map.keys.undo',
				defaultMessage: 'Undo the last painting or change to the map\'s size',
				description: 'In the list of keyboard shortcuts, what Ctrl+Z does in the map editor'
			})
		});

		addKeyHelp({
			scope: this.tools,
			keys: () => formatKeys('Control+Y Control+Shift+Z'),
			description: () => t({
				id: 'editor.map.keys.redo',
				defaultMessage: 'Redo the painting or change of size undone',
				description: 'In the list of keyboard shortcuts, what Ctrl+Y does in the map editor'
			})
		});

		addKeyHelp({
			scope: this.canvasElement,
			keys: () => t(mapMessages.arrowKeys),
			description: () => t(mapMessages.cursorDescription)
		});

		addKeyHelp({
			scope: this.tools,
			keys: () => t(mapMessages.spaceOrEnter),
			description: () => t({
				id: 'editor.map.keys.paintDescription',
				defaultMessage: 'Paint the cursor\'s cell, or open its link with the Links tool; hold Space while moving to keep painting',
				description: 'In the list of keyboard shortcuts, what Space and Enter do on the map editor\'s map'
			})
		});

		addKeyHelp({
			scope: this.canvasElement,
			keys: () => '+ / -',
			description: () => t({
				id: 'editor.map.keys.zoom',
				defaultMessage: 'Zoom in or out',
				description: 'In the list of keyboard shortcuts, what the + and - keys do on the map editor\'s map'
			})
		});

		addKeyHelp({
			scope: this.canvasElement,
			keys: () => t({
				id: 'editor.map.keys.home',
				defaultMessage: 'Home',
				description: 'In the list of keyboard shortcuts, the name of the Home key'
			}),
			description: () => t({
				id: 'editor.map.keys.homeDescription',
				defaultMessage: 'Go back to the center cell',
				description: 'In the list of keyboard shortcuts, what the Home key does on the map editor\'s map'
			})
		});
	}

	/**
	 * Shows an area's map
	 *
	 * Opening the area already shown keeps what has loaded, the undo history and the links not yet saved,
	 * so changing the area's other settings doesn't lose them
	 *
	 * @param universe The area's universe
	 * @param area The area
	 * @param tiles Every tile the universe can use, with the Tilesets tab's changes
	 * @param deletedTiles The tiles the Tilesets tab will delete, which can't be painted with
	 * @param areas Every area of the universe, for the links' targets
	 * @param editable Whether the map can be changed: false for a player whose role can't change the world, or an area that will be deleted
	 */
	async show(universe: EditableUniverse, area: EditorArea, tiles: readonly EditorTile[], deletedTiles: ReadonlyMap<number, number | undefined>, areas: readonly EditorAreaSummary[], editable: boolean): Promise<void>
	{
		const version = ++this.openVersion;
		const sameArea = (this.open?.area.id === area.id);
		const same = (sameArea && !this.reloadOnShow && (this.open !== undefined) && sameBounds(this.open.map.bounds, area.bounds));

		this.deletedTiles = deletedTiles;
		this.fillTiles(universe, area, tiles, sameArea);
		this.tools.hidden = !editable;
		this.expandField.hidden = !editable;

		for (const button of this.expandButtons)
		{
			button.hidden = !editable;
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
			this.open = this.openMap(universe, area, tiles, areas, links, editable);
			this.unsavedChanged();
		}

		await this.startScene(camera);
		this.updateButtons();
	}

	/**
	 * Stops showing the map, for when the area editor closes
	 */
	hide(): void
	{
		this.setFullPage(false);
		this.openVersion++;
		this.open?.loader.stop();
		this.open = undefined;
		this.stroke = undefined;
		this.history.clear();
		this.unsaved.clear();
		this.savedValues.clear();
		this.stagedLinks.clear();
		this.canvas.stop();
		this.unsavedChanged();
	}

	/**
	 * Whether the map has painting, a change of size or links that haven't been saved
	 *
	 * @return True while it has
	 */
	hasUnsavedChanges(): boolean
	{
		return((this.unsaved.size > 0) || this.hasUnsavedBounds() || (this.stagedLinks.size > 0));
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
				parentAreaId: ((area.parentAreaId === null) ? null : resolve(area.parentAreaId))
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
	 * Whether the map has grown since its bounds were last saved
	 *
	 * @return True when it has
	 */
	private hasUnsavedBounds(): boolean
	{
		return((this.open !== undefined) && !sameBounds(this.open.map.bounds, this.open.area.bounds));
	}

	/**
	 * Adds the map's new bounds, the painting not yet saved (in changes of up to MAX_CELL_CHANGES cells)
	 * and the links not yet saved to a save. The map is read-only until the save is over
	 *
	 * The server refuses painting and links outside its bounds, so the map first grows to cover both its
	 * saved and new bounds, then the painting is saved, then it shrinks to its new bounds, and last the
	 * links are saved; a link on a cell the smaller map cuts off is dropped. Cells a smaller map cuts off
	 * are set to the default tile with the painting, so shrinking discards nothing unless saved links are
	 * on them, which the player is asked about when the server refuses the save for it
	 *
	 * @param save The save
	 * @param areaRef How the save names an area, from its ID on the page
	 * @param tileRef How the save names the tile a cell is painted with, from its ID on the page
	 * @param onRefused Shows why the server refused one of the map's changes
	 */
	collect(save: EditorSave, areaRef: (areaId: string) => StringRef, tileRef: (tileId: number) => NumberRef, onRefused: (refusal: SaveRefusal) => void): void
	{
		const open = this.open;

		if (!open || !this.hasUnsavedChanges())
		{
			return;
		}

		const areaId = areaRef(open.area.id);
		const bounds = open.map.bounds;
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
	 * Asks whether to delete the links a smaller map cuts off, when the server refused the save for them,
	 * and saves again without them when the player agrees
	 *
	 * @param refusal Why the save was refused
	 * @param onRefused Shows why the map wasn't saved
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
			id: 'editor.map.confirmDeleteLinks',
			defaultMessage: 'Saving the smaller map deletes {links, plural, one {# link} other {# links}} on or into the cells it cuts off. This can\'t be undone. Save anyway?',
			description: 'Asked while saving a map made smaller, when links are on the cells it cuts off or lead into them; {links} is how many'
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
				id: 'editor.map.linksKept',
				defaultMessage: 'The links were kept, so the map wasn\'t made smaller.',
				description: 'Why saving stopped: the player chose not to delete the links a smaller map would cut off; nothing was saved'
			}), 409, conflict)
		});
	}

	/**
	 * Takes the map's changes as saved, once the save collect() added them to is saved. A map painted
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
	 * Keeps changes the link dialog made until the map is saved, and shows them on the map. Deleting a
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

		this.canvas.scene?.setLinks(linksOnMap(open, this.currentLinks(open.area.id, open.links)));
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
	 * Shows whether the map has unsaved painting or growth, and tells the area editor
	 */
	private unsavedChanged(): void
	{
		this.updateSaveStatus();
		this.onUnsavedChanged(this.hasUnsavedChanges());
	}

	/**
	 * Sets up the map of an area that wasn't open
	 *
	 * @param universe The area's universe
	 * @param area The area
	 * @param tiles Every tile the universe can use
	 * @param areas Every area of the universe
	 * @param links The area's links
	 * @param editable Whether the map can be changed
	 * @return The open area
	 */
	private openMap(universe: EditableUniverse, area: EditorArea, tiles: readonly EditorTile[], areas: readonly EditorAreaSummary[], links: EditorAreaLink[], editable: boolean): OpenArea
	{
		const map = new EditorMap(area.bounds);
		const loader = new ChunkLoader((range) => this.source.loadChunks(area.id, range), map, (chunkKeys) =>
		{
			this.canvas.scene?.refreshChunks(chunkKeys);
		}, (error) =>
		{
			showMessage(this.error, describeEditorError(error, mapMessages.loadFailed));
		});

		return({ universe, area, tiles, areas, map, loader, links, editable });
	}

	/**
	 * Starts the scene for the open area
	 *
	 * @param camera Where the camera starts, or undefined for the map's center
	 */
	private async startScene(camera?: CameraState): Promise<void>
	{
		const open = this.open;

		if (!open)
		{
			return;
		}

		const area = { ...open.area, bounds: open.map.bounds };
		const scene = await this.canvas.show(editorAreaPayload(area, open.tiles, open.universe.ruleset), open.map.chunks, this.host(), camera);

		if (this.open === open)
		{
			scene.setLinks(linksOnMap(open, this.currentLinks(open.area.id, open.links)));
		}
	}

	/**
	 * What clicks on the map do, and what the map editor hears from the scene
	 *
	 * @return The host
	 */
	private host(): MapEditorHost
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
			viewChanged: (range) =>
			{
				this.open?.loader.request(range);
			}
		});
	}

	/**
	 * What a left click on the map does now: nothing while the map is read-only or being saved
	 *
	 * @return The pointer mode
	 */
	private pointerMode(): PointerMode
	{
		if (!this.open?.editable || (this.pendingSaves > 0))
		{
			return('none');
		}

		return((this.drawTool.checked ? 'paint' : 'pick'));
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
		if (this.tile.value === VOID_CHOICE)
		{
			return(VOID_CELL);
		}

		const tileId = Number(this.tile.value);

		return(((tileId === this.open?.area.defaultTileId) ? DEFAULT_TILE_CELL : tileId));
	}

	/**
	 * Dabs the brush on a cell: changes every loaded cell it covers on the map, and remembers what they
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
			const before = open.map.valueAt(cell.column, cell.row);
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
			this.canvas.scene?.refreshChunks(open.map.apply(changes));
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
			this.applyStep(step.inverse, step.changes, step.bounds?.before);
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
			this.applyStep(step.changes, step.inverse, step.bounds?.after);
		}
	}

	/**
	 * Changes cells on the map and records them as unsaved painting, and changes the map's bounds, for undo and redo
	 *
	 * @param changes The cells and their values
	 * @param previous The same cells' values before, in the same order
	 * @param bounds The map's bounds after the step, for a change of the map's size
	 */
	private applyStep(changes: EditStep['changes'], previous: EditStep['changes'], bounds?: MapBounds): void
	{
		if (this.open && (changes.length > 0))
		{
			this.canvas.scene?.refreshChunks(this.open.map.apply(changes));
			this.showHoveredCell();
			this.trackChanges(changes, previous);
		}

		if (bounds)
		{
			void this.setBounds(bounds);
		}

		this.updateButtons();
	}

	/**
	 * Changes the map's size as one step to undo. Cells a smaller map cuts off are set to the default
	 * tile, so undoing the step brings them back
	 *
	 * @param bounds The new bounds
	 */
	private resize(bounds: MapBounds): void
	{
		const open = this.open;

		if (!open || sameBounds(bounds, open.map.bounds))
		{
			return;
		}

		const inverse = open.map.paintedCellsOutside(bounds);
		const changes: CellChange[] = inverse.map(([column, row]) => [column, row, DEFAULT_TILE_CELL]);
		const step: EditStep = {
			changes,
			inverse,
			bounds: {
				before: open.map.bounds,
				after: bounds
			}
		};

		showMessage(this.error, undefined);
		this.history.push(step);
		this.applyStep(step.changes, step.inverse, bounds);
	}

	/**
	 * Gives the map new bounds and shows it afresh, keeping the view where it is
	 *
	 * @param bounds The bounds
	 */
	private async setBounds(bounds: MapBounds): Promise<void>
	{
		if (!this.open)
		{
			return;
		}

		this.open.map.setBounds(bounds);
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
				id: 'editor.map.unsaved',
				defaultMessage: 'Map changes not saved yet',
				description: 'Shown under the map while it has painting, a change of size or links that the editor\'s Save button hasn\'t stored yet'
			});
		}
		else
		{
			this.saveStatus.textContent = '';
		}
	}

	/**
	 * Enables undo and redo when there is something to undo or redo, and disables changing the map while it is being saved
	 */
	private updateButtons(): void
	{
		const saving = (this.pendingSaves > 0);

		this.undoButton.disabled = (saving || !this.history.canUndo);
		this.redoButton.disabled = (saving || !this.history.canRedo);
		this.resizeButton.disabled = saving;

		for (const button of this.expandButtons)
		{
			button.disabled = saving;
		}
	}

	/**
	 * Shows the cell under the pointer or the keyboard's cursor and what it holds
	 */
	private showHoveredCell(): void
	{
		this.cursor.textContent = (this.hovered ? this.cellText(this.hovered) : '');
	}

	/**
	 * A cell of the open area's map and what it holds
	 *
	 * @param cell The cell
	 * @return Its description, or an empty string when no area is open or the cell is outside its map
	 */
	private cellText(cell: BrushCell): string
	{
		const open = this.open;

		if (!open)
		{
			return('');
		}

		return(describeCell({
			map: open.map,
			defaultTileId: open.area.defaultTileId,
			tiles: open.tiles,
			links: this.currentLinks(open.area.id, open.links),
			ruleset: open.universe.ruleset
		}, cell));
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
			this.fillTiles(open.universe, { ...open.area, indoors }, open.tiles, true);
		}
	}

	/**
	 * Lists and draws the tiles as the Tilesets tab's changes make them, keeping the map's unsaved
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
		this.fillTiles(open.universe, { ...open.area, indoors }, tiles, true);
		await this.startScene(camera);
	}

	/**
	 * Lists the tiles to paint with: the area's enabled indoor or outdoor tiles but those the Tilesets tab
	 * will delete, and its default tile, by name, then Void, and chooses the default tile
	 *
	 * @param universe The area's universe
	 * @param area The area
	 * @param tiles Every tile the universe can use
	 * @param keepChoice Whether to keep the tile chosen before, when it is still listed
	 */
	private fillTiles(universe: EditableUniverse, area: EditorArea, tiles: readonly EditorTile[], keepChoice: boolean): void
	{
		const chosen = (keepChoice ? this.tile.value : String(area.defaultTileId));
		const paintable = tiles
			.filter((tile) => ((canPaintTile(tile, area.indoors) && !this.deletedTiles.has(tile.id)) || (tile.id === area.defaultTileId)))
			.map((tile) => ({
				tile,
				name: tileName(tile, universe.ruleset)
			}))
			.sort((a, b) => a.name.localeCompare(b.name, currentLocale()));

		setOptions(this.tile, [
			...paintable.map(({ tile, name }) => ({
				value: String(tile.id),
				label: ((tile.id === area.defaultTileId)
					? t({
						id: 'editor.map.areaDefault',
						defaultMessage: '{tile} (default)',
						description: 'A choice of tile to paint that is the area\'s default tile; {tile} is its name'
					}, {
						tile: name
					})
					: name)
			})),
			{
				value: VOID_CHOICE,
				label: t(mapMessages.void)
			}
		]);

		this.tile.value = ([...this.tile.options].some((option) => (option.value === chosen)) ? chosen : String(area.defaultTileId));
	}

	/**
	 * Grows the map on one side by the number of cells chosen, as one step to undo. The new bounds are saved with save()
	 *
	 * @param side The side
	 */
	private expand(side: Side): void
	{
		const open = this.open;
		const cells = Math.floor(this.expandBy.valueAsNumber);

		if (!open || !(cells > 0))
		{
			return;
		}

		const bounds = { ...open.map.bounds };

		if (side === 'north')
		{
			bounds.minRow -= cells;
		}
		else if (side === 'south')
		{
			bounds.maxRow += cells;
		}
		else if (side === 'west')
		{
			bounds.minColumn -= cells;
		}
		else
		{
			bounds.maxColumn += cells;
		}

		if ((((bounds.maxColumn - bounds.minColumn) + 1) > MAX_MAP_SIDE) || (((bounds.maxRow - bounds.minRow) + 1) > MAX_MAP_SIDE))
		{
			showMessage(this.error, t(mapMessages.tooLarge, { max: MAX_MAP_SIDE }));
			return;
		}

		this.resize(bounds);
	}

	/**
	 * Opens Edit Size, starting from the map's size as shown. The new size is one step to undo, saved with save()
	 */
	private openResizeDialog(): void
	{
		const open = this.open;

		if (!open)
		{
			return;
		}

		this.resizeDialog.open({
			bounds: open.map.bounds,
			check: (bounds) => this.checkResize(open, bounds),
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
	 * Finds out what new bounds would cut off the map, first loading every chunk they would cut off
	 *
	 * @param open The area open when Edit Size opened
	 * @param bounds The new bounds
	 * @return The painted cells and the area's own links outside the new bounds
	 */
	private async checkResize(open: OpenArea, bounds: MapBounds): Promise<ResizeLoss>
	{
		await open.loader.loadOutside(bounds);

		return({
			cells: open.map.paintedCellsOutside(bounds).length,
			links: this.currentLinks(open.area.id, open.links).filter((link) => (isInBounds(open.map.bounds, link.column, link.row) && !isInBounds(bounds, link.column, link.row))).length
		});
	}

	/**
	 * Opens the link dialog for a cell of the map
	 *
	 * @param column The cell's column
	 * @param row The cell's row
	 */
	private openLinkDialog(column: number, row: number): void
	{
		const open = this.open;

		if (!open || !isInBounds(open.map.bounds, column, row))
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
				this.canvas.scene?.setLinks(linksOnMap(open, this.currentLinks(open.area.id, links)));
			}
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, messages.loadLinksFailed));
		}
	}

	/**
	 * Shows the map editor over the whole window, with the map filling the space left, or puts it back in the page
	 *
	 * @param fullPage True to cover the window
	 */
	private setFullPage(fullPage: boolean): void
	{
		this.fullPage = fullPage;
		this.section.classList.toggle('full-page', fullPage);

		if (fullPage)
		{
			setButtonLabel(this.fullPageButton, exitFullPageIcon, t({
				id: 'editor.map.exitFullPage',
				defaultMessage: 'Exit Full Page',
				description: 'Button that puts the map editor back in the page after it was made to fill the window'
			}));
		}
		else
		{
			setButtonLabel(this.fullPageButton, fullPageIcon, t({
				id: 'editor.map.fullPage',
				defaultMessage: 'Full Page',
				description: 'Button that makes the map editor fill the window'
			}));
		}

		this.fitCanvas();
	}

	/**
	 * Sizes the canvas to fill its element: the space left while the map editor is full page, and in the
	 * page the view's usual size, or less on a screen too narrow for it
	 */
	private fitCanvas(): void
	{
		const width = this.canvasElement.clientWidth;

		// A hidden map has no size to fit
		if (width === 0)
		{
			return;
		}

		if (this.fullPage)
		{
			this.canvas.setSize(width, this.canvasElement.clientHeight);
		}
		else
		{
			this.canvas.setSize(Math.min(width, VIEW_WIDTH), VIEW_HEIGHT);
		}
	}

	/**
	 * Leaves full page on Escape when no dialog is open, and while the map is showing and nothing is
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

		// offsetParent is null while the map, or anything it is inside, is hidden
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
 * Whether two maps have the same bounds
 *
 * @param first One map's bounds
 * @param second The other's
 * @return True when every edge matches
 */
function sameBounds(first: MapBounds, second: MapBounds): boolean
{
	return(
		(first.minColumn === second.minColumn) &&
		(first.minRow === second.minRow) &&
		(first.maxColumn === second.maxColumn) &&
		(first.maxRow === second.maxRow)
	);
}

/**
 * The area's links on cells inside its map's bounds as shown: links a smaller map cuts off stay until
 * the size is saved, but aren't shown
 *
 * @param open The open area
 * @param links The area's links
 * @return The links
 */
function linksOnMap(open: OpenArea, links: readonly EditorAreaLink[]): EditorAreaLink[]
{
	return(links.filter((link) => isInBounds(open.map.bounds, link.column, link.row)));
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
 * The smallest bounds holding two maps' bounds
 *
 * @param first One map's bounds
 * @param second The other's
 * @return The bounds
 */
function unionBounds(first: MapBounds, second: MapBounds): MapBounds
{
	return({
		minColumn: Math.min(first.minColumn, second.minColumn),
		minRow: Math.min(first.minRow, second.minRow),
		maxColumn: Math.max(first.maxColumn, second.maxColumn),
		maxRow: Math.max(first.maxRow, second.maxRow)
	});
}
