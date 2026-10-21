import { ancestorAreas, type EditableUniverse, type EditorTile, type EditorArea, type EditorAreaSummary } from '@multiverse-kiln/shared';

import { ChunkLoader } from '../../editor/ChunkLoader';
import { EditorMap } from '../../editor/EditorMap';
import { editorAreaPayload, MapCanvas } from '../../editor/MapCanvas';
import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import type { MapEditorHost } from '../../scenes/MapEditorScene';
import { getElement, showMessage } from '../dom';
import { mapMessages } from './mapMessages';

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
 * Selection: Area (see STRUCTURE-OVERVIEW.md): a dialog for choosing one of the universe's areas by
 * typing part of its name, with a preview of the chosen area's map
 *
 * The lobby isn't offered, since nothing an area is chosen for here may be the lobby
 */
export class AreaSelectDialog
{
	private readonly dialog = getElement('area-select-dialog', HTMLDialogElement);
	private readonly form = getElement('area-select-form', HTMLFormElement);
	private readonly search = getElement('area-select-search', HTMLInputElement);
	private readonly results = getElement('area-select-results', HTMLFieldSetElement);
	private readonly none = getElement('area-select-none', HTMLElement);
	private readonly summary = getElement('area-select-summary', HTMLElement);
	private readonly error = getElement('area-select-error', HTMLElement);
	private readonly submit = getElement('area-select-submit', HTMLButtonElement);
	private readonly canvas = new MapCanvas(getElement('area-select-preview', HTMLElement), PREVIEW_WIDTH, PREVIEW_HEIGHT);

	private universe: EditableUniverse | undefined;

	/**
	 * The areas that can be chosen, by name
	 */
	private areas: EditorAreaSummary[] = [];

	/**
	 * Every tile the universe can use, for drawing the preview
	 */
	private tiles: EditorTile[] = [];

	private chosenAreaId: string | undefined;

	/**
	 * Loads the chunks of the area the preview shows
	 */
	private previewLoader: ChunkLoader | undefined;

	/**
	 * Settles the promise open() returned: with the area chosen, or undefined when the dialog closed without one
	 */
	private settle: ((area: EditorAreaSummary | undefined) => void) | undefined;

	/**
	 * Changes every time the dialog opens or the preview switches area, so data that arrives for an earlier one is ignored
	 */
	private version = 0;

	/**
	 * @param api The editor's API
	 */
	constructor(private readonly api: EditorApi)
	{
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
				this.finish(area);
				this.dialog.close();
			}
		});
	}

	/**
	 * Opens the dialog
	 *
	 * @param universe The universe whose areas to choose from
	 * @param areaId The area chosen now, which starts out chosen, if any
	 * @return The area chosen, or undefined when the dialog was closed without choosing
	 */
	async open(universe: EditableUniverse, areaId: string | null): Promise<EditorAreaSummary | undefined>
	{
		const version = ++this.version;

		this.finish(undefined);
		this.universe = universe;
		this.areas = [];
		this.chosenAreaId = (areaId ?? undefined);
		this.search.value = '';
		this.results.replaceChildren();
		this.none.hidden = true;
		this.summary.textContent = '';
		this.submit.disabled = true;
		showMessage(this.error, undefined);
		this.dialog.showModal();
		this.search.focus();

		const chosen = new Promise<EditorAreaSummary | undefined>((resolve) =>
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
				this.areas = list.areas.filter((area) => (area.id !== list.lobbyAreaId));
				this.tiles = tiles;
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
	 * @param area The area chosen, or undefined for none
	 */
	private finish(area: EditorAreaSummary | undefined): void
	{
		const settle = this.settle;

		this.settle = undefined;
		settle?.(area);
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

		this.results.replaceChildren(...listed.map((area) => this.createChoice(area)));
		this.results.hidden = (listed.length === 0);
		this.none.hidden = (listed.length > 0);
		this.submit.disabled = (chosen === undefined);
	}

	/**
	 * One area's choice: a radio button with the area's name, the area it is inside and whether it is disabled
	 *
	 * @param area The area
	 * @return The choice's label, holding its radio button
	 */
	private createChoice(area: EditorAreaSummary): HTMLLabelElement
	{
		const label = document.createElement('label');
		const input = document.createElement('input');
		const text = document.createElement('span');
		const name = document.createElement('span');
		const description = document.createElement('span');
		const parent = ancestorAreas(this.areas, area.id)[0];
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

		if (!area.enabled)
		{
			notes.push(t({
				id: 'editor.areaSelect.disabled',
				defaultMessage: 'Disabled',
				description: 'In the dialog for choosing an area, under the name of an area players can\'t go into'
			}));
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
			this.submit.disabled = false;
			void this.showPreview();
		});

		return(label);
	}

	/**
	 * Shows the chosen area's map in the preview, with its size and whether it is indoors in words
	 */
	private async showPreview(): Promise<void>
	{
		const universe = this.universe;
		const areaId = this.chosenAreaId;
		const version = ++this.version;

		this.closePreview();
		this.summary.textContent = '';

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
				showMessage(this.error, describeEditorError(error, mapMessages.loadFailed));
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
			description: 'In the dialog for choosing an area, describes the chosen area under its map preview; {height} and {width} are its size in cells'
		}, {
			indoors: String(area.indoors),
			height: ((bounds.maxRow - bounds.minRow) + 1),
			width: ((bounds.maxColumn - bounds.minColumn) + 1)
		});

		const map = new EditorMap(bounds);
		const loader = new ChunkLoader(this.api, universe.id, area.id, map, (chunkKeys) =>
		{
			this.canvas.scene?.refreshChunks(chunkKeys);
		}, (error) =>
		{
			showMessage(this.error, describeEditorError(error, mapMessages.loadFailed));
		});

		this.previewLoader = loader;
		await this.canvas.show(editorAreaPayload(area, this.tiles, universe.ruleset), map.chunks, this.previewHost(loader));
	}

	/**
	 * What the preview does: nothing but look around, loading chunks as they come into view
	 *
	 * @param loader Loads the preview area's chunks
	 * @return The host
	 */
	private previewHost(loader: ChunkLoader): MapEditorHost
	{
		return({
			pointerMode: () => 'pick',
			brush: () => ({ size: 1, shape: 'square' }),
			paintStart: () => undefined,
			paint: () => undefined,
			paintEnd: () => undefined,
			pick: () => undefined,
			hover: () => undefined,
			describe: () => '',
			viewChanged: (range) =>
			{
				loader.request(range);
			}
		});
	}

	/**
	 * Stops showing the preview's map
	 */
	private closePreview(): void
	{
		this.previewLoader?.stop();
		this.previewLoader = undefined;
		this.canvas.stop();
	}
}
