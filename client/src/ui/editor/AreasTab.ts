import { ancestorAreas, canEditWorld, childAreas, defineMessages, descendantAreaIds, DISALLOWED_TEXT_CHARACTERS, FAERIE_MORNING_NAMES, FAERIE_MORNINGS, MAX_AREA_NAME_LENGTH, PASSAGE_OF_TIME_NAMES, AREA_PASSAGES_OF_TIME, areasTabListing, type EditableUniverse, type EditorTile, type EditorArea, type EditorAreaSummary, type FaerieMorning, type AreaListPayload, type AreaPassageOfTime, type AreaSettings } from '@multiverse-kiln/shared';

import { formatList, t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { ChangeTracker } from '../changeTracker';
import { getElement, namedOptions, setOptions, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import { tileName } from '../tileNames';
import { MapEditor } from './MapEditor';

/**
 * Text the area editor shows in more than one place (see src/localization.ts)
 */
const messages = defineMessages({
	indoorTiles: {
		id: 'editor.area.indoorTiles',
		defaultMessage: 'Indoor tiles',
		description: 'Heading of a group of choices of default tile'
	},
	outdoorTiles: {
		id: 'editor.area.outdoorTiles',
		defaultMessage: 'Outdoor tiles',
		description: 'Heading of a group of choices of default tile'
	}
});

/**
 * The Areas tab: the universe's areas, opening the area editor, and adding areas
 *
 * The area editor is a view in the tab rather than a dialog, since it holds the area's map
 */
export class AreasTab
{
	private readonly listView = getElement('area-list-view', HTMLElement);
	private readonly list = getElement('area-list', HTMLUListElement);
	private readonly empty = getElement('area-empty', HTMLElement);
	private readonly addButton = getElement('area-add', HTMLButtonElement);
	private readonly editorView = getElement('area-editor-view', HTMLElement);
	private readonly editorTitle = getElement('area-editor-title', HTMLElement);
	private readonly form = getElement('area-form', HTMLFormElement);
	private readonly fields = getElement('area-fields', HTMLFieldSetElement);
	private readonly name = getElement('area-name', HTMLInputElement);
	private readonly enabled = getElement('area-enabled', HTMLInputElement);
	private readonly parentDisabled = getElement('area-parent-disabled', HTMLElement);
	private readonly parent = getElement('area-parent', HTMLSelectElement);
	private readonly outdoors = getElement('area-outdoors', HTMLInputElement);
	private readonly indoors = getElement('area-indoors', HTMLInputElement);
	private readonly defaultTile = getElement('area-default-tile', HTMLSelectElement);
	private readonly time = getElement('area-time', HTMLSelectElement);
	private readonly faerieField = getElement('area-faerie-field', HTMLElement);
	private readonly faerie = getElement('area-faerie', HTMLSelectElement);
	private readonly loopsEastWest = getElement('area-loops-east-west', HTMLInputElement);
	private readonly loopsNorthSouth = getElement('area-loops-north-south', HTMLInputElement);
	private readonly loopsHint = getElement('area-loops-hint', HTMLElement);
	private readonly size = getElement('area-size', HTMLElement);
	private readonly error = getElement('area-error', HTMLElement);
	private readonly saved = getElement('area-saved', HTMLElement);
	private readonly deleteButton = getElement('area-delete', HTMLButtonElement);
	private readonly saveButton = getElement('area-save', HTMLButtonElement);
	private readonly children = getElement('area-children', HTMLElement);
	private readonly childList = getElement('area-child-list', HTMLUListElement);
	private readonly addDialog = getElement('area-add-dialog', HTMLDialogElement);
	private readonly addForm = getElement('area-add-form', HTMLFormElement);
	private readonly addName = getElement('area-add-name', HTMLInputElement);
	private readonly addIndoors = getElement('area-add-indoors', HTMLInputElement);
	private readonly addError = getElement('area-add-error', HTMLElement);
	private readonly addSubmit = getElement('area-add-submit', HTMLButtonElement);
	private readonly mapEditor: MapEditor;

	/**
	 * Whether the map editor has painting or growth that hasn't been saved
	 */
	private mapUnsaved = false;

	/**
	 * Whether the area editor's settings or map have changes that haven't been saved
	 */
	readonly changes = new ChangeTracker({
		root: this.form,
		state: () => this.mapUnsaved,
		status: this.saved
	});

	/**
	 * Whether the Add Area dialog has been filled in
	 */
	private readonly addChanges = new ChangeTracker({ root: this.addForm });

	private universe: EditableUniverse | undefined;

	/**
	 * Every area of the universe, and which are the lobby and starting areas, as last loaded
	 */
	private areas: AreaListPayload = { areas: [], lobbyAreaId: null, startingAreaId: null };

	/**
	 * Every tile the universe can use, for the default tile choice
	 */
	private tiles: EditorTile[] = [];

	/**
	 * The area the editor is showing
	 */
	private area: EditorArea | undefined;

	/**
	 * Changes every time the tab opens a universe or an area, so data that arrives for an earlier one is ignored
	 */
	private openVersion = 0;

	/**
	 * @param api The editor's API
	 * @param onAreaChanged Called with the area the area editor opens, or undefined when the tab goes back to the list
	 */
	constructor(private readonly api: EditorApi, private readonly onAreaChanged: (areaId: string | undefined) => void)
	{
		this.mapEditor = new MapEditor(api, (bounds) =>
		{
			if (this.area)
			{
				this.area = { ...this.area, bounds };
				this.showSize(this.area);
			}
		}, (unsaved) =>
		{
			this.mapUnsaved = unsaved;
			this.changes.check();
		});
		this.name.maxLength = MAX_AREA_NAME_LENGTH;
		this.addName.maxLength = MAX_AREA_NAME_LENGTH;
		setOptions(this.time, namedOptions(AREA_PASSAGES_OF_TIME, PASSAGE_OF_TIME_NAMES));
		setOptions(this.faerie, namedOptions(FAERIE_MORNINGS, FAERIE_MORNING_NAMES));

		this.time.addEventListener('change', () =>
		{
			this.updateTimeFields();
		});

		this.enabled.addEventListener('change', () =>
		{
			this.saved.textContent = '';
		});

		for (const choice of [this.outdoors, this.indoors])
		{
			choice.addEventListener('change', () =>
			{
				this.fillDefaultTiles(this.indoors.checked, Number(this.defaultTile.value));
				this.saved.textContent = '';
			});
		}

		this.name.addEventListener('input', () =>
		{
			setFieldError(this.name, undefined);
			this.saved.textContent = '';
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.save();
		});

		this.deleteButton.addEventListener('click', () =>
		{
			void this.deleteArea();
		});

		getElement('area-back', HTMLButtonElement).addEventListener('click', () =>
		{
			if (this.changes.confirmDiscard())
			{
				void this.showList();
			}
		});

		this.addChanges.guardDialog(this.addDialog);

		this.addButton.addEventListener('click', () =>
		{
			this.addForm.reset();
			showMessage(this.addError, undefined);
			clearFieldErrors(this.addForm);
			this.addSubmit.disabled = false;
			this.addDialog.showModal();
			this.addChanges.markSaved();
			this.addName.focus();
		});

		getElement('area-add-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			if (this.addChanges.confirmDiscard())
			{
				this.addDialog.close();
			}
		});

		this.addName.addEventListener('input', () =>
		{
			setFieldError(this.addName, undefined);
		});

		this.addForm.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.addArea();
		});
	}

	/**
	 * Lists a universe's areas, or opens one of them
	 *
	 * @param universe The universe
	 * @param areaId The area to open, or undefined for the list
	 */
	open(universe: EditableUniverse, areaId?: string): void
	{
		this.universe = universe;
		this.addButton.hidden = !canEditWorld(universe.role);

		if (areaId === undefined)
		{
			void this.showList();
		}
		else
		{
			void this.openArea(areaId);
		}
	}

	/**
	 * Keeps up with changes to the universe made on other tabs
	 *
	 * @param universe The universe as it now is
	 */
	setUniverse(universe: EditableUniverse): void
	{
		if (this.universe?.id === universe.id)
		{
			this.universe = universe;
		}
	}

	/**
	 * Opens an area in the area editor, first asking whether to discard the unsaved changes of the area it shows
	 *
	 * @param areaId The area's ID
	 */
	async openArea(areaId: string): Promise<void>
	{
		const universe = this.universe;

		if (!universe || (!this.editorView.hidden && !this.changes.confirmDiscard()))
		{
			return;
		}

		const version = ++this.openVersion;

		// Any unsaved painting has been discarded, so the map loads afresh
		this.mapEditor.hide();
		this.changes.markSaved();
		this.onAreaChanged(areaId);
		this.listView.hidden = true;
		this.editorView.hidden = false;
		this.editorTitle.textContent = t({
			id: 'editor.area.loading',
			defaultMessage: 'Loading...',
			description: 'Heading of the area editor while the area loads'
		});
		this.fields.disabled = true;
		showMessage(this.error, undefined);

		let area: EditorArea;

		try
		{
			[area] = await Promise.all([
				this.api.getArea(universe.id, areaId),
				this.loadAreas(universe),
				this.loadTiles(universe)
			]);
		}
		catch (error)
		{
			if (version === this.openVersion)
			{
				this.editorTitle.textContent = '';
				showMessage(this.error, describeEditorError(error, {
					id: 'editor.area.openFailed',
					defaultMessage: 'Could not open the area.',
					description: 'Shown in the area editor when the area couldn\'t be loaded'
				}));
			}

			return;
		}

		if (version === this.openVersion)
		{
			this.showArea(universe, area);
		}
	}

	/**
	 * Shows the list of areas, loading them afresh
	 */
	private async showList(): Promise<void>
	{
		const universe = this.universe;
		const version = ++this.openVersion;

		this.area = undefined;
		this.onAreaChanged(undefined);
		this.mapEditor.hide();
		// The hidden area editor is filled afresh when an area opens, so nothing left in it can be saved
		this.changes.markSaved();
		this.listView.hidden = false;
		this.editorView.hidden = true;

		if (!universe)
		{
			return;
		}

		try
		{
			await this.loadAreas(universe);
		}
		catch (error)
		{
			if (version === this.openVersion)
			{
				this.list.replaceChildren();
				showMessage(this.empty, describeEditorError(error, {
					id: 'editor.areas.listFailed',
					defaultMessage: 'Could not list the areas.',
					description: 'Shown on the Areas tab when the areas couldn\'t be loaded'
				}));
			}

			return;
		}

		if (version !== this.openVersion)
		{
			return;
		}

		const listing = areasTabListing(this.areas.areas, this.areas.lobbyAreaId);

		// An area the listing passed through is shown above the areas inside it, indented by how deep each is
		this.list.replaceChildren(
			...listing.path.map((area, depth) => this.createItem(area, depth)),
			...listing.areas.map((area) => this.createItem(area, listing.path.length))
		);
		showMessage(this.empty, ((listing.areas.length === 0)
			? t({
				id: 'editor.areas.none',
				defaultMessage: 'There are no areas besides the lobby.',
				description: 'Shown instead of the list of areas when the universe only has its lobby'
			})
			: undefined));
	}

	/**
	 * Loads every area of the universe
	 *
	 * @param universe The universe
	 */
	private async loadAreas(universe: EditableUniverse): Promise<void>
	{
		this.areas = await this.api.listAreas(universe.id);
	}

	/**
	 * Loads every tile the universe can use, a page at a time
	 *
	 * @param universe The universe
	 */
	private async loadTiles(universe: EditableUniverse): Promise<void>
	{
		this.tiles = await this.api.listAllTiles(universe.id);
	}

	/**
	 * An area's entry in a list, opening it in the area editor
	 *
	 * @param area The area
	 * @param depth How far to indent it
	 * @return The list item
	 */
	private createItem(area: EditorAreaSummary, depth: number): HTMLLIElement
	{
		const item = document.createElement('li');
		const button = document.createElement('button');
		const name = document.createElement('strong');
		const details = document.createElement('span');
		const tags = [
			(area.indoors
				? t({
					id: 'editor.areas.indoorsTag',
					defaultMessage: 'indoors',
					description: 'Under an area in the list of areas, for an area that is indoors'
				})
				: t({
					id: 'editor.areas.outdoorsTag',
					defaultMessage: 'outdoors',
					description: 'Under an area in the list of areas, for an area that is outdoors'
				})),
			((area.id === this.areas.startingAreaId)
				? t({
					id: 'editor.areas.startingAreaTag',
					defaultMessage: 'starting area',
					description: 'Under an area in the list of areas, for the area new characters start in'
				})
				: undefined),
			(area.enabled
				? undefined
				: t({
					id: 'editor.areas.disabledTag',
					defaultMessage: 'disabled',
					description: 'Under an area in the list of areas, for an area players can\'t go into'
				}))
		].filter((tag) => (tag !== undefined));

		item.style.paddingLeft = `${depth * 20}px`;
		button.type = 'button';
		button.className = 'universe-item';
		name.textContent = area.name;
		details.className = 'universe-ruleset';
		details.textContent = formatList(tags);
		button.append(name, details);
		button.addEventListener('click', () =>
		{
			void this.openArea(area.id);
		});

		item.append(button);

		return(item);
	}

	/**
	 * Fills the area editor with an area's settings
	 *
	 * @param universe The area's universe
	 * @param area The area
	 */
	private showArea(universe: EditableUniverse, area: EditorArea): void
	{
		const editable = canEditWorld(universe.role);
		const excluded = descendantAreaIds(this.areas.areas, area.id).add(area.id);
		const isLobby = (area.id === this.areas.lobbyAreaId);
		const isStart = (area.id === this.areas.startingAreaId);

		this.area = area;
		this.editorTitle.textContent = (isLobby
			? t({
				id: 'editor.area.lobbyTitle',
				defaultMessage: '{area} (the lobby)',
				description: 'Heading of the area editor for the universe\'s lobby; {area} is its name'
			}, {
				area: area.name
			})
			: area.name);
		this.name.value = area.name;
		this.enabled.checked = area.enabled;
		setOptions(this.parent, [
			{
				value: '',
				label: t({
					id: 'editor.area.noParent',
					defaultMessage: 'None (a top-level area)',
					description: 'Choice of parent area for an area that isn\'t inside another'
				})
			},
			...this.areas.areas
				.filter((other) => !excluded.has(other.id))
				.map((other) => ({
					value: other.id,
					label: other.name
				}))
		]);
		this.parent.value = (area.parentAreaId ?? '');
		this.outdoors.checked = !area.indoors;
		this.indoors.checked = area.indoors;
		this.fillDefaultTiles(area.indoors, area.defaultTileId);
		this.time.value = area.passageOfTime;
		this.faerie.value = (area.faerieMorning ?? FAERIE_MORNINGS[0]);
		this.loopsEastWest.checked = area.loopsEastWest;
		this.loopsNorthSouth.checked = area.loopsNorthSouth;
		this.showSize(area);
		this.updateTimeFields();
		this.updateParentMessage();
		this.fields.disabled = !editable;
		this.saveButton.hidden = !editable;
		this.deleteButton.hidden = (!editable || isLobby || isStart);
		this.saved.textContent = '';
		showMessage(this.error, undefined);
		clearFieldErrors(this.form);

		const children = childAreas(this.areas.areas, area.id);

		this.childList.replaceChildren(...children.map((child) => this.createItem(child, 0)));
		this.children.hidden = (children.length === 0);
		this.changes.markSaved();
		void this.mapEditor.show(universe, area, this.tiles, this.areas.areas);
	}

	/**
	 * Shows how large an area's map is
	 *
	 * @param area The area
	 */
	private showSize(area: EditorArea): void
	{
		const width = (area.bounds.maxColumn - area.bounds.minColumn) + 1;
		const height = (area.bounds.maxRow - area.bounds.minRow) + 1;

		this.size.textContent = t({
			id: 'editor.area.size',
			defaultMessage: 'The map is {height, number} tall x {width, number} wide.',
			description: 'The size of the area\'s map, in cells'
		}, {
			height,
			width
		});
	}

	/**
	 * Lists the tiles an area can use by default: outdoor tiles first for an outdoor area, indoor tiles first for an indoor one
	 *
	 * @param indoors Whether the area is indoors
	 * @param selectedTileId The tile to select
	 */
	private fillDefaultTiles(indoors: boolean, selectedTileId: number): void
	{
		const ruleset = this.universe?.ruleset;
		const groups = [
			{
				label: t(indoors ? messages.indoorTiles : messages.outdoorTiles),
				tiles: this.tiles.filter((tile) => (tile.indoors === indoors))
			},
			{
				label: t(indoors ? messages.outdoorTiles : messages.indoorTiles),
				tiles: this.tiles.filter((tile) => (tile.indoors !== indoors))
			}
		];

		this.defaultTile.replaceChildren(...groups
			.filter((group) => (group.tiles.length > 0))
			.map((group) =>
			{
				const element = document.createElement('optgroup');

				element.label = group.label;
				element.append(...group.tiles.map((tile) => new Option(((ruleset === undefined) ? (tile.name ?? '') : tileName(tile, ruleset)), String(tile.id))));

				return(element);
			}));
		this.defaultTile.value = String(selectedTileId);
	}

	/**
	 * Shows "where is morning?" for faerie time, which also can't loop
	 */
	private updateTimeFields(): void
	{
		const faerie = (this.time.value === 'faerie');

		this.faerieField.hidden = !faerie;
		this.loopsHint.hidden = !faerie;
		this.loopsEastWest.disabled = faerie;
		this.loopsNorthSouth.disabled = faerie;

		if (faerie)
		{
			this.loopsEastWest.checked = false;
			this.loopsNorthSouth.checked = false;
		}

		this.saved.textContent = '';
	}

	/**
	 * Warns when an area this one is inside is disabled
	 */
	private updateParentMessage(): void
	{
		const area = this.area;
		const disabled = ((area === undefined) ? [] : ancestorAreas(this.areas.areas, area.id).filter((ancestor) => !ancestor.enabled));

		showMessage(this.parentDisabled, ((disabled.length === 0)
			? undefined
			: t({
				id: 'editor.area.parentDisabled',
				defaultMessage: 'This area is inside {areas}, which {count, plural, one {is} other {are}} disabled.',
				description: 'Warns that players can\'t reach the area; {areas} lists the areas it is inside that are disabled, and {count} is how many'
			}, {
				areas: formatList(disabled.map((ancestor) => ancestor.name), 'conjunction'),
				count: disabled.length
			})));
	}

	/**
	 * Saves the map's painting, then the area's settings as the form shows them
	 */
	private async save(): Promise<void>
	{
		const universe = this.universe;
		const area = this.area;
		const name = this.name.value.trim();

		if (!universe || !area)
		{
			return;
		}

		if ((name === '') || DISALLOWED_TEXT_CHARACTERS.test(name))
		{
			reportFieldError(this.name, t(formMessages.invalidText));
			return;
		}

		const passageOfTime = this.time.value as AreaPassageOfTime;
		const settings: AreaSettings = {
			name,
			parentAreaId: ((this.parent.value === '') ? null : this.parent.value),
			enabled: this.enabled.checked,
			indoors: this.indoors.checked,
			defaultTileId: Number(this.defaultTile.value),
			passageOfTime,
			faerieMorning: ((passageOfTime === 'faerie') ? this.faerie.value as FaerieMorning : null),
			loopsEastWest: this.loopsEastWest.checked,
			loopsNorthSouth: this.loopsNorthSouth.checked
		};

		this.saveButton.disabled = true;
		showMessage(this.error, undefined);

		try
		{
			await this.mapEditor.save();
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, {
				id: 'editor.area.mapSaveFailed',
				defaultMessage: 'Could not save the map.',
				description: 'Shown in the area editor when the painting on the area\'s map, or its new size, couldn\'t be stored'
			}));
			this.saveButton.disabled = false;
			return;
		}

		try
		{
			await this.api.updateArea(universe.id, area.id, settings);
			await this.loadAreas(universe);

			if (this.area === area)
			{
				this.showArea(universe, { ...area, ...settings });
				this.saved.textContent = t(formMessages.saved);
			}
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, {
				id: 'editor.area.saveFailed',
				defaultMessage: 'Could not save the area.',
				description: 'Shown in the area editor when the area\'s settings couldn\'t be stored'
			}));
		}
		finally
		{
			this.saveButton.disabled = false;
		}
	}

	/**
	 * Deletes the area after asking, and goes back to the list
	 */
	private async deleteArea(): Promise<void>
	{
		const universe = this.universe;
		const area = this.area;

		if (!universe || !area)
		{
			return;
		}

		const question = t({
			id: 'editor.area.confirmDelete',
			defaultMessage: 'Delete {area}, its map and every link into it? Areas inside it become top-level areas. This can\'t be undone.',
			description: 'Asks before deleting an area; {area} is its name'
		}, {
			area: area.name
		});

		if (!window.confirm(question))
		{
			return;
		}

		this.deleteButton.disabled = true;

		try
		{
			await this.api.deleteArea(universe.id, area.id);
			await this.showList();
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, {
				id: 'editor.area.deleteFailed',
				defaultMessage: 'Could not delete the area.',
				description: 'Shown in the area editor when the area couldn\'t be deleted'
			}));
		}
		finally
		{
			this.deleteButton.disabled = false;
		}
	}

	/**
	 * Adds the area the Add Area dialog describes, and opens it in the area editor
	 */
	private async addArea(): Promise<void>
	{
		const universe = this.universe;
		const name = this.addName.value.trim();

		if (!universe)
		{
			return;
		}

		if ((name === '') || DISALLOWED_TEXT_CHARACTERS.test(name))
		{
			reportFieldError(this.addName, t(formMessages.invalidText));
			return;
		}

		this.addSubmit.disabled = true;

		try
		{
			const areaId = await this.api.createArea(universe.id, { name, indoors: this.addIndoors.checked });

			this.addDialog.close();
			await this.openArea(areaId);
		}
		catch (error)
		{
			showMessage(this.addError, describeEditorError(error, {
				id: 'editor.areaAdd.failed',
				defaultMessage: 'Could not add the area.',
				description: 'Shown in the Add Area dialog when the area couldn\'t be made'
			}));
			this.addSubmit.disabled = false;
		}
	}
}
