import { canEditWorld, DEFAULT_TILE_CELL, defineMessages, isInBounds, MAX_BRUSH_SIZE, MAX_CELL_CHANGES, MAX_MAP_SIDE, VOID_CELL, VIEW_HEIGHT, VIEW_WIDTH, type CellChange, type EditableUniverse, type EditorTile, type EditorZone, type EditorZoneLink, type EditorZoneSummary, type MapBounds, type MessageDescriptor } from '@multiverse-kiln/shared';

import { BRUSH_SHAPES, brushCells, type BrushCell, type BrushShape } from '../../editor/brush';
import { ChunkLoader } from '../../editor/ChunkLoader';
import { EditHistory, type EditStep } from '../../editor/EditHistory';
import { EditorMap } from '../../editor/EditorMap';
import { editorZonePayload, MapCanvas } from '../../editor/MapCanvas';
import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import type { CameraState, MapEditorHost, PointerMode } from '../../scenes/MapEditorScene';
import { refreshUnsavedWork, watchUnsavedWork } from '../changeTracker';
import { getElement, namedOptions, setOptions, showMessage } from '../dom';
import { addKeyHelp, formatKeys } from '../shortcuts';
import { tileName } from '../tileNames';
import { describeCell } from './cellDescription';
import { LinkDialog } from './LinkDialog';
import { mapMessages } from './mapMessages';
import { ResizeDialog } from './ResizeDialog';

/**
 * Text the map editor shows in more than one place (see src/localization.ts)
 */
const messages = defineMessages({
	loadLinksFailed: {
		id: 'editor.map.loadLinksFailed',
		defaultMessage: 'Could not load the links.',
		description: 'Shown in the map editor when the zone\'s links couldn\'t be loaded'
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
 * The zone being edited and everything that goes with it
 */
interface OpenZone
{
	universe: EditableUniverse;
	zone: EditorZone;
	tiles: readonly EditorTile[];
	zones: readonly EditorZoneSummary[];
	map: EditorMap;
	loader: ChunkLoader;
	links: EditorZoneLink[];
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
 * The map editor in the zone editor: the zone's map on the same grid as gameplay, a draw tool (a tile
 * or Void, 1 to MAX_BRUSH_SIZE cells across, square or circle) with undo and redo, buttons to grow the
 * map on each side, Edit Size, and a tool for the map's zone links
 *
 * Painting shows straight away and is saved when the stroke ends; a click or drag is one step to undo.
 * Saves go to the server one after another, in the order they were made
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

	private open: OpenZone | undefined;
	private stroke: Stroke | undefined;

	/**
	 * The cell under the pointer, while it is over the map
	 */
	private hovered: BrushCell | undefined;

	/**
	 * Saves sent or waiting to be sent, one after another
	 */
	private saving: Promise<void> = Promise.resolve();

	private pendingSaves = 0;

	/**
	 * Changes every time a zone is opened, so data that arrives for an earlier one is ignored
	 */
	private openVersion = 0;

	/**
	 * @param api The editor's API
	 * @param onBoundsChanged Called with a zone's new bounds after the map editor resizes it
	 */
	constructor(private readonly api: EditorApi, private readonly onBoundsChanged: (bounds: MapBounds) => void)
	{
		this.resizeDialog = new ResizeDialog(api);
		this.linkDialog = new LinkDialog(api);
		// Painting is saved as it is done, so it is only at risk while it is still being sent
		watchUnsavedWork({ hasUnsavedChanges: () => (this.pendingSaves > 0) });
		this.brushSize.max = String(MAX_BRUSH_SIZE);
		setOptions(this.brushShape, namedOptions(BRUSH_SHAPES, BRUSH_SHAPE_NAMES));

		this.undoButton.addEventListener('click', () =>
		{
			this.undo();
		});

		this.redoButton.addEventListener('click', () =>
		{
			this.redo();
		});

		getElement('map-resize', HTMLButtonElement).addEventListener('click', () =>
		{
			this.openResizeDialog();
		});

		for (const side of sides)
		{
			getElement(`map-expand-${side}`, HTMLButtonElement).addEventListener('click', () =>
			{
				void this.expand(side);
			});
		}

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
				defaultMessage: 'Undo the last painting',
				description: 'In the list of keyboard shortcuts, what Ctrl+Z does in the map editor'
			})
		});

		addKeyHelp({
			scope: this.tools,
			keys: () => formatKeys('Control+Y Control+Shift+Z'),
			description: () => t({
				id: 'editor.map.keys.redo',
				defaultMessage: 'Redo the painting undone',
				description: 'In the list of keyboard shortcuts, what Ctrl+Y does in the map editor'
			})
		});

		addKeyHelp({
			scope: this.canvasElement,
			keys: () => t(mapMessages.arrowKeys),
			description: () => t({
				id: 'editor.map.keys.cursorDescription',
				defaultMessage: 'Move the cursor on the focused map, 10 cells at a time with Shift',
				description: 'In the list of keyboard shortcuts, what the arrow keys do on the map editor\'s map'
			})
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
	 * Shows a zone's map, read-only unless the player's role may change the world
	 *
	 * Opening the zone already shown keeps what has loaded and the undo history, so changing the zone's
	 * other settings doesn't lose them
	 *
	 * @param universe The zone's universe
	 * @param zone The zone
	 * @param tiles Every tile the universe can use
	 * @param zones Every zone of the universe, for the links' targets
	 */
	async show(universe: EditableUniverse, zone: EditorZone, tiles: readonly EditorTile[], zones: readonly EditorZoneSummary[]): Promise<void>
	{
		const version = ++this.openVersion;
		const editable = canEditWorld(universe.role);
		const same = ((this.open?.zone.id === zone.id) && sameBounds(this.open.map.bounds, zone.bounds));

		this.fillTiles(universe, zone, tiles);
		this.tools.hidden = !editable;
		this.expandField.hidden = !editable;

		for (const side of sides)
		{
			getElement(`map-expand-${side}`, HTMLButtonElement).hidden = !editable;
		}

		showMessage(this.error, undefined);

		let links: EditorZoneLink[];

		try
		{
			links = await this.api.listLinks(universe.id, zone.id);
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

		const camera = (same ? this.canvas.scene?.cameraState() : undefined);

		if (same && this.open)
		{
			this.open = { ...this.open, universe, zone, tiles, zones, links };
		}
		else
		{
			this.open?.loader.stop();
			this.history.clear();
			this.open = this.openMap(universe, zone, tiles, zones, links);
		}

		await this.startScene(camera);
		this.updateButtons();
	}

	/**
	 * Stops showing the map, for when the zone editor closes
	 */
	hide(): void
	{
		this.openVersion++;
		this.open?.loader.stop();
		this.open = undefined;
		this.stroke = undefined;
		this.history.clear();
		this.canvas.stop();
	}

	/**
	 * Sets up the map of a zone that wasn't open
	 *
	 * @param universe The zone's universe
	 * @param zone The zone
	 * @param tiles Every tile the universe can use
	 * @param zones Every zone of the universe
	 * @param links The zone's links
	 * @return The open zone
	 */
	private openMap(universe: EditableUniverse, zone: EditorZone, tiles: readonly EditorTile[], zones: readonly EditorZoneSummary[], links: EditorZoneLink[]): OpenZone
	{
		const map = new EditorMap(zone.bounds);
		const loader = new ChunkLoader(this.api, universe.id, zone.id, map, (chunkKeys) =>
		{
			this.canvas.scene?.refreshChunks(chunkKeys);
		}, (error) =>
		{
			showMessage(this.error, describeEditorError(error, mapMessages.loadFailed));
		});

		return({ universe, zone, tiles, zones, map, loader, links });
	}

	/**
	 * Starts the scene for the open zone
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

		const zone = { ...open.zone, bounds: open.map.bounds };
		const scene = await this.canvas.show(editorZonePayload(zone, open.tiles, open.universe.ruleset), open.map.chunks, this.host(), camera);

		if (this.open === open)
		{
			scene.setLinks(open.links);
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
	 * What a left click on the map does now
	 *
	 * @return The pointer mode
	 */
	private pointerMode(): PointerMode
	{
		if (!this.open || !canEditWorld(this.open.universe.role))
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
	 * The value the draw tool paints. The zone's own default tile is painted as DEFAULT_TILE_CELL, so it
	 * follows the zone's default tile and keeps chunks small
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

		return(((tileId === this.open?.zone.defaultTileId) ? DEFAULT_TILE_CELL : tileId));
	}

	/**
	 * Dabs the brush on a cell: changes every loaded cell it covers on the map, and remembers what they were
	 *
	 * @param column The cell's column
	 * @param row The cell's row
	 */
	private paint(column: number, row: number): void
	{
		const open = this.open;
		const stroke = this.stroke;

		if (!open || !stroke)
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
	 * Ends a stroke: records it as one step to undo, and saves it
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
		this.save(changes);
		this.updateButtons();
	}

	/**
	 * Undoes the latest step
	 */
	private undo(): void
	{
		const step = this.history.undo();

		if (step)
		{
			this.applyStep(step.inverse);
		}
	}

	/**
	 * Makes the latest undone step again
	 */
	private redo(): void
	{
		const step = this.history.redo();

		if (step)
		{
			this.applyStep(step.changes);
		}
	}

	/**
	 * Changes cells on the map and saves them, for undo and redo
	 *
	 * @param changes The cells and their values
	 */
	private applyStep(changes: EditStep['changes']): void
	{
		if (this.open)
		{
			this.canvas.scene?.refreshChunks(this.open.map.apply(changes));
			this.showHoveredCell();
			this.save(changes);
		}

		this.updateButtons();
	}

	/**
	 * Saves cell changes after every save before them, in requests of up to MAX_CELL_CHANGES cells
	 *
	 * @param changes The cells and their values
	 */
	private save(changes: CellChange[]): void
	{
		const open = this.open;

		if (!open)
		{
			return;
		}

		const universeId = open.universe.id;
		const zoneId = open.zone.id;

		this.pendingSaves++;
		this.updateSaveStatus();

		this.saving = this.saving
			.then(async () =>
			{
				for (let start = 0; start < changes.length; start += MAX_CELL_CHANGES)
				{
					await this.api.editCells(universeId, zoneId, changes.slice(start, start + MAX_CELL_CHANGES));
				}
			})
			.catch((error: unknown) =>
			{
				showMessage(this.error, describeEditorError(error, {
					id: 'editor.map.paintingNotSaved',
					defaultMessage: 'Could not save some of your painting. Open the zone again to see the map as it is saved.',
					description: 'Shown in the map editor when painting couldn\'t be stored'
				}));
			})
			.finally(() =>
			{
				this.pendingSaves--;
				this.updateSaveStatus();
			});
	}

	/**
	 * Shows whether painting is still being saved, and has the browser ask before leaving the page while it is
	 */
	private updateSaveStatus(): void
	{
		refreshUnsavedWork();
		this.saveStatus.textContent = ((this.pendingSaves > 0)
			? t({
				id: 'editor.map.saving',
				defaultMessage: 'Saving...',
				description: 'Shown under the map while painting is being stored'
			})
			: t({
				id: 'editor.map.allSaved',
				defaultMessage: 'All changes saved',
				description: 'Shown under the map once all painting is stored'
			}));
	}

	/**
	 * Enables undo and redo when there is something to undo or redo
	 */
	private updateButtons(): void
	{
		this.undoButton.disabled = !this.history.canUndo;
		this.redoButton.disabled = !this.history.canRedo;
	}

	/**
	 * Shows the cell under the pointer or the keyboard's cursor and what it holds
	 */
	private showHoveredCell(): void
	{
		this.cursor.textContent = (this.hovered ? this.cellText(this.hovered) : '');
	}

	/**
	 * A cell of the open zone's map and what it holds
	 *
	 * @param cell The cell
	 * @return Its description, or an empty string when no zone is open or the cell is outside its map
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
			defaultTileId: open.zone.defaultTileId,
			tiles: open.tiles,
			links: open.links,
			ruleset: open.universe.ruleset
		}, cell));
	}

	/**
	 * Lists the tiles to paint with, the zone's indoor or outdoor tiles first, then Void
	 *
	 * @param universe The zone's universe
	 * @param zone The zone
	 * @param tiles Every tile the universe can use
	 */
	private fillTiles(universe: EditableUniverse, zone: EditorZone, tiles: readonly EditorTile[]): void
	{
		const chosen = this.tile.value;
		const ordered = [
			...tiles.filter((tile) => (tile.indoors === zone.indoors)),
			...tiles.filter((tile) => (tile.indoors !== zone.indoors))
		];

		setOptions(this.tile, [
			...ordered.map((tile) => ({
				value: String(tile.id),
				label: ((tile.id === zone.defaultTileId)
					? t({
						id: 'editor.map.zoneDefault',
						defaultMessage: '{tile} (the zone\'s default)',
						description: 'A choice of tile to paint that is the zone\'s default tile; {tile} is its name'
					}, {
						tile: tileName(tile, universe.ruleset)
					})
					: tileName(tile, universe.ruleset))
			})),
			{
				value: VOID_CHOICE,
				label: t(mapMessages.void)
			}
		]);

		if ([...this.tile.options].some((option) => (option.value === chosen)))
		{
			this.tile.value = chosen;
		}
	}

	/**
	 * Grows the map on one side by the number of cells chosen
	 *
	 * @param side The side
	 */
	private async expand(side: Side): Promise<void>
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

		showMessage(this.error, undefined);

		try
		{
			// Growing never discards anything
			await this.api.resizeZone(open.universe.id, open.zone.id, bounds, false);
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, {
				id: 'editor.map.growFailed',
				defaultMessage: 'Could not grow the map.',
				description: 'Shown in the map editor when the map couldn\'t be made bigger'
			}));
			return;
		}

		if (this.open === open)
		{
			open.map.grow(bounds);
			open.zone = { ...open.zone, bounds };
			await this.startScene(this.canvas.scene?.cameraState());
			this.onBoundsChanged(bounds);
		}
	}

	/**
	 * Opens Edit Size. A resize can discard cells, so afterward the map is loaded afresh and the undo history is cleared
	 */
	private openResizeDialog(): void
	{
		const open = this.open;

		if (!open)
		{
			return;
		}

		this.resizeDialog.open({
			universeId: open.universe.id,
			zoneId: open.zone.id,
			bounds: open.map.bounds,
			onResized: (bounds) =>
			{
				if (this.open === open)
				{
					const zone = { ...open.zone, bounds };

					this.hide();
					void this.show(open.universe, zone, open.tiles, open.zones);
					this.onBoundsChanged(bounds);
				}
			}
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
			universeId: open.universe.id,
			zone: open.zone,
			column,
			row,
			link: open.links.find((link) => ((link.column === column) && (link.row === row))),
			zones: open.zones,
			tiles: open.tiles,
			ruleset: open.universe.ruleset,
			onChanged: () =>
			{
				void this.reloadLinks(open);
			}
		});
	}

	/**
	 * Loads the zone's links again after one has changed
	 *
	 * @param open The zone open when the link changed
	 */
	private async reloadLinks(open: OpenZone): Promise<void>
	{
		try
		{
			const links = await this.api.listLinks(open.universe.id, open.zone.id);

			if (this.open === open)
			{
				open.links = links;
				this.canvas.scene?.setLinks(links);
			}
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, messages.loadLinksFailed));
		}
	}

	/**
	 * Undoes on Ctrl+Z and redoes on Ctrl+Y or Ctrl+Shift+Z, while the map is showing and nothing is being typed
	 *
	 * @param event The key press
	 */
	private readonly onKeyDown = (event: KeyboardEvent): void =>
	{
		const target = event.target;
		const typing = ((target instanceof HTMLInputElement) || (target instanceof HTMLTextAreaElement) || (target instanceof HTMLSelectElement));
		const key = event.key.toLowerCase();

		// offsetParent is null while the map, or anything it is inside, is hidden
		const showing = (this.canvasElement.offsetParent !== null);

		if (!this.open || typing || !showing || !(event.ctrlKey || event.metaKey) || !canEditWorld(this.open.universe.role) || (this.canvas.scene === undefined))
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
