import { isInBounds, parentAreas, type EditableUniverse, type EditorTile, type EditorArea, type EditorAreaSummary, type StartingCell } from '@multiverse-kiln/shared';

import { AreaCanvas, editorAreaPayload } from '../../editor/AreaCanvas';
import { AreaCells } from '../../editor/AreaCells';
import { ChunkLoader } from '../../editor/ChunkLoader';
import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import type { AreaEditorHost } from '../../scenes/AreaEditorScene';
import { getElement, showMessage } from '../dom';
import { addKeyHelp } from '../shortcuts';
import { areaEditorMessages } from './areaEditorMessages';
import { describeCell } from './cellDescription';
import { editorMessages } from './editorMessages';
import type { StagedTiles } from './stagedChanges';

/**
 * Width of the chosen area's preview, in pixels
 */
const PREVIEW_WIDTH = 420;

/**
 * Height of the chosen area's preview, in pixels
 */
const PREVIEW_HEIGHT = 240;

/**
 * Most areas the dialog lists at once; typing narrows them down
 */
const MAX_RESULTS = 20;

/**
 * Color of the starting square on the preview
 */
const STARTING_CELL_COLOR = 0x4caf50;

/**
 * The square a newly chosen area starts out with: the middle of a new area
 */
const MIDDLE_CELL: StartingCell = { column: 0, row: 0 };

/**
 * A starting area and the square of it characters start on
 */
export interface AreaSelection
{
	area: EditorAreaSummary;
	cell: StartingCell;
}

/**
 * What an area is chosen for: where characters start (the universe's, a race's or a class's), or where
 * players start in the lobby. A starting area can't be the lobby's, so neither offers the other's areas
 */
export type AreaSelectPurpose = 'starting' | 'lobby';

/**
 * Selection: Area (see STRUCTURE-OVERVIEW.md): a dialog for choosing where characters start: one of the
 * universe's areas, found by typing part of its name, and the square of it they start on, chosen on a
 * preview of the area
 *
 * Choosing a starting area leaves out the lobby's area, and choosing the lobby's area leaves out the
 * starting areas
 */
export class AreaSelectDialog
{
	private readonly dialog = getElement('area-select-dialog', HTMLDialogElement);
	private readonly form = getElement('area-select-form', HTMLFormElement);
	private readonly search = getElement('area-select-search', HTMLInputElement);
	private readonly results = getElement('area-select-results', HTMLFieldSetElement);
	private readonly none = getElement('area-select-none', HTMLElement);
	private readonly lobbyHint = getElement('area-select-lobby-hint', HTMLElement);
	private readonly summary = getElement('area-select-summary', HTMLElement);
	private readonly cellText = getElement('area-select-cell', HTMLElement);
	private readonly error = getElement('area-select-error', HTMLElement);
	private readonly submit = getElement('area-select-submit', HTMLButtonElement);
	private readonly previewElement = getElement('area-select-preview', HTMLElement);
	private readonly canvas = new AreaCanvas(this.previewElement, PREVIEW_WIDTH, PREVIEW_HEIGHT);

	private universe: EditableUniverse | undefined;

	/**
	 * The areas that can be chosen, by name
	 */
	private areas: EditorAreaSummary[] = [];

	/**
	 * Every tile the universe can use, with the Tilesets tab's changes, for drawing the preview
	 */
	private tiles: EditorTile[] = [];

	private chosenAreaId: string | undefined;

	/**
	 * The square of the chosen area characters start on
	 */
	private chosenCell: StartingCell = MIDDLE_CELL;

	/**
	 * The area the preview shows, and its cells, once they have loaded
	 */
	private preview: { area: EditorArea; cells: AreaCells } | undefined;

	/**
	 * Loads the chunks of the area the preview shows
	 */
	private previewLoader: ChunkLoader | undefined;

	/**
	 * Settles the promise open() returned: with the area and square chosen, or undefined when the dialog closed without one
	 */
	private settle: ((selection: AreaSelection | undefined) => void) | undefined;

	/**
	 * Changes every time the dialog opens or the preview switches area, so data that arrives for an earlier one is ignored
	 */
	private version = 0;

	/**
	 * @param api The editor's API
	 * @param stagedTiles The Tilesets tab's changes, which the preview is drawn with
	 */
	constructor(private readonly api: EditorApi, private readonly stagedTiles: StagedTiles)
	{
		addKeyHelp({
			scope: this.previewElement,
			keys: () => t(areaEditorMessages.arrowKeys),
			description: () => t(areaEditorMessages.cursorDescription)
		});

		addKeyHelp({
			scope: this.previewElement,
			keys: () => t(areaEditorMessages.spaceOrEnter),
			description: () => t({
				id: 'editor.areaSelect.keys.pickDescription',
				defaultMessage: 'Choose the cursor\'s square for characters to start on',
				description: 'In the list of keyboard shortcuts, what Space and Enter do on the area preview in the dialog for choosing a starting area'
			})
		});

		this.search.addEventListener('input', () =>
		{
			this.showResults();
		});

		getElement('area-select-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			this.dialog.close();
		});

		this.dialog.addEventListener('close', () =>
		{
			this.closePreview();
			this.finish(undefined);
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();

			const area = this.areas.find((candidate) => (candidate.id === this.chosenAreaId));

			if (area)
			{
				this.finish({ area, cell: this.chosenCell });
				this.dialog.close();
			}
		});
	}

	/**
	 * Opens the dialog
	 *
	 * @param universe The universe whose areas to choose from
	 * @param areaId The area chosen now, which starts out chosen, if any
	 * @param cell The square of that area chosen now
	 * @param purpose What the area is chosen for, a starting area unless said otherwise
	 * @return The area and square chosen, or undefined when the dialog was closed without choosing
	 */
	async open(universe: EditableUniverse, areaId: string | null, cell: StartingCell, purpose: AreaSelectPurpose = 'starting'): Promise<AreaSelection | undefined>
	{
		const version = ++this.version;

		this.finish(undefined);
		this.universe = universe;
		this.areas = [];
		this.chosenAreaId = (areaId ?? undefined);
		this.chosenCell = ((areaId === null) ? MIDDLE_CELL : cell);
		this.search.value = '';
		this.results.replaceChildren();
		this.none.hidden = true;
		this.lobbyHint.hidden = (purpose !== 'lobby');
		this.summary.textContent = '';
		this.cellText.textContent = '';
		this.submit.disabled = true;
		showMessage(this.error, undefined);
		this.dialog.showModal();
		this.search.focus();

		const chosen = new Promise<AreaSelection | undefined>((resolve) =>
		{
			this.settle = resolve;
		});

		try
		{
			const [list, tiles] = await Promise.all([
				this.api.listAreas(universe.id),
				this.api.listAllTiles(universe.id)
			]);

			if (version === this.version)
			{
				const excluded = new Set((purpose === 'lobby') ? list.startingAreaIds : [list.lobbyAreaId]);

				this.areas = list.areas.filter((area) => !excluded.has(area.id));
				this.tiles = this.stagedTiles.withChanges(tiles).tiles;
				this.showResults();
				void this.showPreview();
			}
		}
		catch (error)
		{
			if (version === this.version)
			{
				showMessage(this.error, describeEditorError(error, {
					id: 'editor.areaSelect.loadFailed',
					defaultMessage: 'Could not load the areas.',
					description: 'Shown in the dialog for choosing an area when the universe\'s areas couldn\'t be loaded'
				}));
			}
		}

		return(chosen);
	}

	/**
	 * Settles the promise open() returned, once
	 *
	 * @param selection The area and square chosen, or undefined for none
	 */
	private finish(selection: AreaSelection | undefined): void
	{
		const settle = this.settle;

		this.settle = undefined;
		settle?.(selection);
	}

	/**
	 * Lists the areas whose names hold what is typed in the search field, up to MAX_RESULTS, keeping the
	 * chosen area listed first when it matches
	 */
	private showResults(): void
	{
		const search = this.search.value.trim().toLocaleLowerCase();
		const matches = this.areas.filter((area) => area.name.toLocaleLowerCase().includes(search));
		const chosen = matches.find((area) => (area.id === this.chosenAreaId));
		const listed = (chosen ? [chosen, ...matches.filter((area) => (area !== chosen))] : matches).slice(0, MAX_RESULTS);

		const parents = parentAreas(this.areas);

		this.results.replaceChildren(...listed.map((area) => this.createChoice(area, parents.get(area.id))));
		this.results.hidden = (listed.length === 0);
		this.none.hidden = (listed.length > 0);
		this.submit.disabled = (chosen === undefined);
	}

	/**
	 * One area's choice: a radio button with the area's name, the area it is inside and whether it is disabled
	 *
	 * @param area The area
	 * @param parent The area it is inside, if any
	 * @return The choice's label, holding its radio button
	 */
	private createChoice(area: EditorAreaSummary, parent: EditorAreaSummary | undefined): HTMLLabelElement
	{
		const label = document.createElement('label');
		const input = document.createElement('input');
		const text = document.createElement('span');
		const name = document.createElement('span');
		const description = document.createElement('span');
		const notes: string[] = [];

		if (parent)
		{
			notes.push(t({
				id: 'editor.areaSelect.inside',
				defaultMessage: 'Inside {area}',
				description: 'In the dialog for choosing an area, under an area\'s name: the area it is inside; {area} is that area\'s name'
			}, {
				area: parent.name
			}));
		}

		if (!area.resolved.enabled)
		{
			notes.push(t(editorMessages.disabled));
		}

		label.className = 'checkbox described-choice';
		input.type = 'radio';
		input.name = 'area-select';
		input.value = area.id;
		input.checked = (area.id === this.chosenAreaId);
		text.className = 'choice-text';
		name.textContent = area.name;
		description.className = 'choice-description';
		description.textContent = notes.join(' - ');
		text.append(name, description);
		label.append(input, text);

		input.addEventListener('change', () =>
		{
			this.chosenAreaId = area.id;
			this.chosenCell = MIDDLE_CELL;
			this.submit.disabled = false;
			void this.showPreview();
		});

		return(label);
	}

	/**
	 * Shows the chosen area in the preview, centered on the starting square, with its size and
	 * whether it is indoors in words
	 */
	private async showPreview(): Promise<void>
	{
		const universe = this.universe;
		const areaId = this.chosenAreaId;
		const version = ++this.version;

		this.closePreview();
		this.summary.textContent = '';
		this.cellText.textContent = '';

		if (!universe || (areaId === undefined) || !this.areas.some((area) => (area.id === areaId)))
		{
			return;
		}

		let area: EditorArea;

		try
		{
			area = await this.api.getArea(universe.id, areaId);
		}
		catch (error)
		{
			if (version === this.version)
			{
				showMessage(this.error, describeEditorError(error, areaEditorMessages.loadFailed));
			}

			return;
		}

		if ((version !== this.version) || !this.dialog.open)
		{
			return;
		}

		const { bounds } = area;

		this.summary.textContent = t({
			id: 'editor.areaSelect.summary',
			defaultMessage: '{indoors, select, true {Indoors} other {Outdoors}}, {height, number} tall by {width, number} wide',
			description: 'In the dialog for choosing an area, describes the chosen area under its preview; {height} and {width} are its size in cells'
		}, {
			indoors: String(area.resolved.indoors),
			height: ((bounds.maxRow - bounds.minRow) + 1),
			width: ((bounds.maxColumn - bounds.minColumn) + 1)
		});

		const cells = new AreaCells(bounds);
		const loader = new ChunkLoader((range) => this.api.loadChunks(universe.id, area.id, range), cells, (chunkKeys) =>
		{
			this.canvas.scene?.refreshChunks(chunkKeys);
		}, (error) =>
		{
			showMessage(this.error, describeEditorError(error, areaEditorMessages.loadFailed));
		});

		this.previewLoader = loader;
		this.preview = { area, cells };

		const scene = await this.canvas.show(editorAreaPayload(area, this.tiles, universe.ruleset), cells.chunks, this.previewHost(loader));

		if (this.preview?.area === area)
		{
			this.showCell();
			scene.centerOnCell(this.chosenCell.column, this.chosenCell.row);
		}
	}

	/**
	 * What the preview does: clicking a square, or Space or Enter on the keyboard's cursor, chooses it
	 * for characters to start on, and chunks load as they come into view
	 *
	 * @param loader Loads the preview area's chunks
	 * @return The host
	 */
	private previewHost(loader: ChunkLoader): AreaEditorHost
	{
		return({
			pointerMode: () => 'pick',
			brush: () => ({ size: 1, shape: 'square' }),
			paintStart: () => undefined,
			paint: () => undefined,
			paintEnd: () => undefined,
			fill: () => undefined,
			pick: (column, row) =>
			{
				if (this.preview && isInBounds(this.preview.area.bounds, column, row))
				{
					this.chosenCell = { column, row };
					this.showCell();
				}
			},
			hover: () => undefined,
			describe: (cell) =>
			{
				const preview = this.preview;
				const universe = this.universe;

				if (!preview || !universe)
				{
					return('');
				}

				return(describeCell({
					cells: preview.cells,
					defaultTileId: preview.area.resolved.defaultTileId,
					tiles: this.tiles,
					links: [],
					ruleset: universe.ruleset
				}, cell));
			},
			viewChanged: (range) =>
			{
				loader.request(range);
			}
		});
	}

	/**
	 * Shows the starting square, in words and highlighted on the preview
	 */
	private showCell(): void
	{
		this.cellText.textContent = t({
			id: 'editor.areaSelect.cell',
			defaultMessage: 'Characters start on {column}, {row}, or the free square nearest it.',
			description: 'In the dialog for choosing a starting area, under the area preview: the square characters start on; {column} and {row} are its coordinates'
		}, {
			column: this.chosenCell.column,
			row: this.chosenCell.row
		});
		this.canvas.scene?.setHighlights([{ ...this.chosenCell, color: STARTING_CELL_COLOR }]);
	}

	/**
	 * Stops showing the preview's area
	 */
	private closePreview(): void
	{
		this.previewLoader?.stop();
		this.previewLoader = undefined;
		this.preview = undefined;
		this.canvas.stop();
	}
}
