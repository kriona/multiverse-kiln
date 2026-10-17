import { ancestorZones, type EditableUniverse, type EditorTile, type EditorZone, type EditorZoneSummary } from '@multiverse-kiln/shared';

import { ChunkLoader } from '../../editor/ChunkLoader';
import { EditorMap } from '../../editor/EditorMap';
import { editorZonePayload, MapCanvas } from '../../editor/MapCanvas';
import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import type { MapEditorHost } from '../../scenes/MapEditorScene';
import { getElement, showMessage } from '../dom';
import { mapMessages } from './mapMessages';

/**
 * Width of the chosen zone's preview, in pixels
 */
const PREVIEW_WIDTH = 420;

/**
 * Height of the chosen zone's preview, in pixels
 */
const PREVIEW_HEIGHT = 240;

/**
 * Most zones the dialog lists at once; typing narrows them down
 */
const MAX_RESULTS = 20;

/**
 * Selection: Zone (see STRUCTURE-OVERVIEW.md): a dialog for choosing one of the universe's zones by
 * typing part of its name, with a preview of the chosen zone's map
 *
 * The lobby isn't offered, since nothing a zone is chosen for here may be the lobby
 */
export class ZoneSelectDialog
{
	private readonly dialog = getElement('zone-select-dialog', HTMLDialogElement);
	private readonly form = getElement('zone-select-form', HTMLFormElement);
	private readonly search = getElement('zone-select-search', HTMLInputElement);
	private readonly results = getElement('zone-select-results', HTMLFieldSetElement);
	private readonly none = getElement('zone-select-none', HTMLElement);
	private readonly summary = getElement('zone-select-summary', HTMLElement);
	private readonly error = getElement('zone-select-error', HTMLElement);
	private readonly submit = getElement('zone-select-submit', HTMLButtonElement);
	private readonly canvas = new MapCanvas(getElement('zone-select-preview', HTMLElement), PREVIEW_WIDTH, PREVIEW_HEIGHT);

	private universe: EditableUniverse | undefined;

	/**
	 * The zones that can be chosen, by name
	 */
	private zones: EditorZoneSummary[] = [];

	/**
	 * Every tile the universe can use, for drawing the preview
	 */
	private tiles: EditorTile[] = [];

	private chosenZoneId: string | undefined;

	/**
	 * Loads the chunks of the zone the preview shows
	 */
	private previewLoader: ChunkLoader | undefined;

	/**
	 * Settles the promise open() returned: with the zone chosen, or undefined when the dialog closed without one
	 */
	private settle: ((zone: EditorZoneSummary | undefined) => void) | undefined;

	/**
	 * Changes every time the dialog opens or the preview switches zone, so data that arrives for an earlier one is ignored
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

		getElement('zone-select-cancel', HTMLButtonElement).addEventListener('click', () =>
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

			const zone = this.zones.find((candidate) => (candidate.id === this.chosenZoneId));

			if (zone)
			{
				this.finish(zone);
				this.dialog.close();
			}
		});
	}

	/**
	 * Opens the dialog
	 *
	 * @param universe The universe whose zones to choose from
	 * @param zoneId The zone chosen now, which starts out chosen, if any
	 * @return The zone chosen, or undefined when the dialog was closed without choosing
	 */
	async open(universe: EditableUniverse, zoneId: string | null): Promise<EditorZoneSummary | undefined>
	{
		const version = ++this.version;

		this.finish(undefined);
		this.universe = universe;
		this.zones = [];
		this.chosenZoneId = (zoneId ?? undefined);
		this.search.value = '';
		this.results.replaceChildren();
		this.none.hidden = true;
		this.summary.textContent = '';
		this.submit.disabled = true;
		showMessage(this.error, undefined);
		this.dialog.showModal();
		this.search.focus();

		const chosen = new Promise<EditorZoneSummary | undefined>((resolve) =>
		{
			this.settle = resolve;
		});

		try
		{
			const [list, tiles] = await Promise.all([
				this.api.listZones(universe.id),
				this.api.listAllTiles(universe.id)
			]);

			if (version === this.version)
			{
				this.zones = list.zones.filter((zone) => (zone.id !== list.lobbyZoneId));
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
					id: 'editor.zoneSelect.loadFailed',
					defaultMessage: 'Could not load the zones.',
					description: 'Shown in the dialog for choosing a zone when the universe\'s zones couldn\'t be loaded'
				}));
			}
		}

		return(chosen);
	}

	/**
	 * Settles the promise open() returned, once
	 *
	 * @param zone The zone chosen, or undefined for none
	 */
	private finish(zone: EditorZoneSummary | undefined): void
	{
		const settle = this.settle;

		this.settle = undefined;
		settle?.(zone);
	}

	/**
	 * Lists the zones whose names hold what is typed in the search field, up to MAX_RESULTS, keeping the
	 * chosen zone listed first when it matches
	 */
	private showResults(): void
	{
		const search = this.search.value.trim().toLocaleLowerCase();
		const matches = this.zones.filter((zone) => zone.name.toLocaleLowerCase().includes(search));
		const chosen = matches.find((zone) => (zone.id === this.chosenZoneId));
		const listed = (chosen ? [chosen, ...matches.filter((zone) => (zone !== chosen))] : matches).slice(0, MAX_RESULTS);

		this.results.replaceChildren(...listed.map((zone) => this.createChoice(zone)));
		this.results.hidden = (listed.length === 0);
		this.none.hidden = (listed.length > 0);
		this.submit.disabled = (chosen === undefined);
	}

	/**
	 * One zone's choice: a radio button with the zone's name, the zone it is inside and whether it is disabled
	 *
	 * @param zone The zone
	 * @return The choice's label, holding its radio button
	 */
	private createChoice(zone: EditorZoneSummary): HTMLLabelElement
	{
		const label = document.createElement('label');
		const input = document.createElement('input');
		const text = document.createElement('span');
		const name = document.createElement('span');
		const description = document.createElement('span');
		const parent = ancestorZones(this.zones, zone.id)[0];
		const notes: string[] = [];

		if (parent)
		{
			notes.push(t({
				id: 'editor.zoneSelect.inside',
				defaultMessage: 'Inside {zone}',
				description: 'In the dialog for choosing a zone, under a zone\'s name: the zone it is inside; {zone} is that zone\'s name'
			}, {
				zone: parent.name
			}));
		}

		if (!zone.enabled)
		{
			notes.push(t({
				id: 'editor.zoneSelect.disabled',
				defaultMessage: 'Disabled',
				description: 'In the dialog for choosing a zone, under the name of a zone players can\'t go into'
			}));
		}

		label.className = 'checkbox described-choice';
		input.type = 'radio';
		input.name = 'zone-select';
		input.value = zone.id;
		input.checked = (zone.id === this.chosenZoneId);
		text.className = 'choice-text';
		name.textContent = zone.name;
		description.className = 'choice-description';
		description.textContent = notes.join(' - ');
		text.append(name, description);
		label.append(input, text);

		input.addEventListener('change', () =>
		{
			this.chosenZoneId = zone.id;
			this.submit.disabled = false;
			void this.showPreview();
		});

		return(label);
	}

	/**
	 * Shows the chosen zone's map in the preview, with its size and whether it is indoors in words
	 */
	private async showPreview(): Promise<void>
	{
		const universe = this.universe;
		const zoneId = this.chosenZoneId;
		const version = ++this.version;

		this.closePreview();
		this.summary.textContent = '';

		if (!universe || (zoneId === undefined) || !this.zones.some((zone) => (zone.id === zoneId)))
		{
			return;
		}

		let zone: EditorZone;

		try
		{
			zone = await this.api.getZone(universe.id, zoneId);
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

		const { bounds } = zone;

		this.summary.textContent = t({
			id: 'editor.zoneSelect.summary',
			defaultMessage: '{indoors, select, true {Indoors} other {Outdoors}}, {height, number} tall by {width, number} wide',
			description: 'In the dialog for choosing a zone, describes the chosen zone under its map preview; {height} and {width} are its size in cells'
		}, {
			indoors: String(zone.indoors),
			height: ((bounds.maxRow - bounds.minRow) + 1),
			width: ((bounds.maxColumn - bounds.minColumn) + 1)
		});

		const map = new EditorMap(bounds);
		const loader = new ChunkLoader(this.api, universe.id, zone.id, map, (chunkKeys) =>
		{
			this.canvas.scene?.refreshChunks(chunkKeys);
		}, (error) =>
		{
			showMessage(this.error, describeEditorError(error, mapMessages.loadFailed));
		});

		this.previewLoader = loader;
		await this.canvas.show(editorZonePayload(zone, this.tiles, universe.ruleset), map.chunks, this.previewHost(loader));
	}

	/**
	 * What the preview does: nothing but look around, loading chunks as they come into view
	 *
	 * @param loader Loads the preview zone's chunks
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
