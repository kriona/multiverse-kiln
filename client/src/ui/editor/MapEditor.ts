import { canEditWorld, DEFAULT_TILE_CELL, isInBounds, MAX_BRUSH_SIZE, MAX_CELL_CHANGES, MAX_MAP_SIDE, VOID_CELL, VIEW_HEIGHT, VIEW_WIDTH, type CellChange, type EditableUniverse, type EditorTile, type EditorZone, type EditorZoneLink, type EditorZoneSummary, type MapBounds } from '@multiverse-kiln/shared';

import { BRUSH_SHAPES, brushCells, type BrushCell, type BrushShape } from '../../editor/brush';
import { ChunkLoader } from '../../editor/ChunkLoader';
import { EditHistory, type EditStep } from '../../editor/EditHistory';
import { EditorMap } from '../../editor/EditorMap';
import { editorZonePayload, MapCanvas } from '../../editor/MapCanvas';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import type { CameraState, MapEditorHost, PointerMode } from '../../scenes/MapEditorScene';
import { getElement, setOptions, showMessage } from '../dom';
import { LinkDialog } from './LinkDialog';
import { ResizeDialog } from './ResizeDialog';

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
		this.brushSize.max = String(MAX_BRUSH_SIZE);
		setOptions(this.brushShape, BRUSH_SHAPES.map((shape) => ({
			value: shape,
			label: shape
		})));

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

		this.fillTiles(zone, tiles);
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
				showMessage(this.error, describeEditorError(error, 'load the links'));
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
			showMessage(this.error, describeEditorError(error, 'load the map'));
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
		const scene = await this.canvas.show(editorZonePayload(zone, open.tiles), open.map.chunks, this.host(), camera);

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
				this.describeCell();
			},
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
			this.describeCell();
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
			this.describeCell();
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
				showMessage(this.error, `${describeEditorError(error, 'save some of your painting')} Open the zone again to see the map as it is saved.`);
			})
			.finally(() =>
			{
				this.pendingSaves--;
				this.updateSaveStatus();
			});
	}

	/**
	 * Shows whether painting is still being saved
	 */
	private updateSaveStatus(): void
	{
		this.saveStatus.textContent = ((this.pendingSaves > 0) ? 'Saving...' : 'All changes saved');
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
	 * Shows the cell under the pointer and what it holds
	 */
	private describeCell(): void
	{
		const open = this.open;
		const cell = this.hovered;

		if (!open || !cell || !isInBounds(open.map.bounds, cell.column, cell.row))
		{
			this.cursor.textContent = '';
			return;
		}

		const value = open.map.valueAt(cell.column, cell.row);
		const tileId = ((value === DEFAULT_TILE_CELL) ? open.zone.defaultTileId : value);
		const link = open.links.find((each) => ((each.column === cell.column) && (each.row === cell.row)));
		let contents = 'loading...';

		if (value === VOID_CELL)
		{
			contents = 'Void';
		}
		else if (tileId !== undefined)
		{
			contents = (open.tiles.find((tile) => (tile.id === tileId))?.name ?? 'unknown tile');
		}

		this.cursor.textContent = `${cell.column}, ${cell.row}: ${contents}${link ? ` (${link.mode} link)` : ''}`;
	}

	/**
	 * Lists the tiles to paint with, the zone's indoor or outdoor tiles first, then Void
	 *
	 * @param zone The zone
	 * @param tiles Every tile the universe can use
	 */
	private fillTiles(zone: EditorZone, tiles: readonly EditorTile[]): void
	{
		const chosen = this.tile.value;
		const ordered = [
			...tiles.filter((tile) => (tile.indoors === zone.indoors)),
			...tiles.filter((tile) => (tile.indoors !== zone.indoors))
		];

		setOptions(this.tile, [
			...ordered.map((tile) => ({
				value: String(tile.id),
				label: ((tile.id === zone.defaultTileId) ? `${tile.name} (the zone's default)` : tile.name)
			})),
			{
				value: VOID_CHOICE,
				label: 'Void'
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
			showMessage(this.error, `A map can be at most ${MAX_MAP_SIDE} cells in each direction.`);
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
			showMessage(this.error, describeEditorError(error, 'grow the map'));
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
			showMessage(this.error, describeEditorError(error, 'load the links'));
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
