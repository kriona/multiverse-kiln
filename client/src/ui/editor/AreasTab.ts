import { ancestorAreas, AREA_LIGHT_LEVEL_NAMES, AREA_LIGHT_LEVELS, canEditWorld, canPaintTile, childAreas, DEFAULT_AREA_TILE_KEYS, descendantAreaIds, DISALLOWED_TEXT_CHARACTERS, FAERIE_MORNING_NAMES, FAERIE_MORNINGS, MAX_AREA_NAME_LENGTH, PASSAGE_OF_TIME_NAMES, AREA_PASSAGES_OF_TIME, areasTabListing, type EditableUniverse, type EditorTile, type EditorArea, type EditorAreaSummary, type FaerieMorning, type AreaListPayload, type AreaLightLevel, type AreaPassageOfTime, type AreaSettings } from '@multiverse-kiln/shared';

import { formatList, t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { ChangeTracker } from '../changeTracker';
import { getElement, namedOptions, setOptions, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import { tileName } from '../tileNames';
import type { AreaSource } from './areaSource';
import { editorMessages } from './editorMessages';
import { MapEditor } from './MapEditor';
import { newRef, numberRef, type EditorSave, type SavedIds } from './editorSave';
import { combineChanges, type SavableTab } from './SaveBar';
import { isNewAreaId, StagedAreas } from './stagedAreas';
import { deletedNote, labelRemoveButton, stagedTag, type StagedTiles } from './stagedChanges';

/**
 * How a save names an area: a saved one by its ID, and one added since the tab was last saved by its ref
 *
 * @param areaId The area's ID on the page
 * @return The reference
 */
function areaRef(areaId: string): string
{
	return((isNewAreaId(areaId) ? newRef('', areaId) : areaId));
}

/**
 * The Areas tab: the universe's areas, opening the area editor, and adding and deleting areas
 *
 * The area editor is a view in the tab rather than a dialog, since it holds the area's map. Areas added
 * and deleted wait on the page until the tab is saved, as do the changes made to the area open in the
 * area editor; a new area can be opened, painted and linked to before it is saved
 */
export class AreasTab implements SavableTab
{
	private readonly listView = getElement('area-list-view', HTMLElement);
	private readonly list = getElement('area-list', HTMLUListElement);
	private readonly empty = getElement('area-empty', HTMLElement);
	private readonly listError = getElement('area-list-error', HTMLElement);
	private readonly addButton = getElement('area-add', HTMLButtonElement);
	private readonly editorView = getElement('area-editor-view', HTMLElement);
	private readonly form = getElement('area-form', HTMLFormElement);
	private readonly fields = getElement('area-fields', HTMLFieldSetElement);
	private readonly name = getElement('area-name', HTMLInputElement);
	private readonly enabled = getElement('area-enabled', HTMLInputElement);
	private readonly parentDisabled = getElement('area-parent-disabled', HTMLElement);
	private readonly parent = getElement('area-parent', HTMLSelectElement);
	private readonly outdoors = getElement('area-outdoors', HTMLInputElement);
	private readonly indoors = getElement('area-indoors', HTMLInputElement);
	private readonly lightField = getElement('area-light-field', HTMLElement);
	private readonly lightLevel = getElement('area-light', HTMLSelectElement);
	private readonly lightHint = getElement('area-light-hint', HTMLElement);
	private readonly defaultTile = getElement('area-default-tile', HTMLSelectElement);
	private readonly timeField = getElement('area-time-field', HTMLElement);
	private readonly time = getElement('area-time', HTMLSelectElement);

	/**
	 * Shown in place of the passage of time for the lobby, whose time the Lobby tab sets
	 */
	private readonly lobbyTimeHint = getElement('area-lobby-time-hint', HTMLElement);
	private readonly faerieField = getElement('area-faerie-field', HTMLElement);
	private readonly faerie = getElement('area-faerie', HTMLSelectElement);
	private readonly loopsEastWest = getElement('area-loops-east-west', HTMLInputElement);
	private readonly loopsNorthSouth = getElement('area-loops-north-south', HTMLInputElement);
	private readonly loopsHint = getElement('area-loops-hint', HTMLElement);
	private readonly size = getElement('area-size', HTMLElement);
	private readonly error = getElement('area-error', HTMLElement);
	private readonly deleteButton = getElement('area-delete', HTMLButtonElement);
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
	 * Whether the map editor has painting, a change of size or links that haven't been saved
	 */
	private mapUnsaved = false;

	/**
	 * Whether the area editor's settings or map have changes that haven't been saved
	 */
	private readonly areaChanges = new ChangeTracker({
		root: this.form,
		state: () => this.mapUnsaved
	});

	/**
	 * The areas added and deleted since the tab was last saved
	 */
	private readonly staged = new StagedAreas();

	/**
	 * Whether the tab has changes that haven't been saved: areas added or deleted, or changes to the area open
	 */
	readonly changes = combineChanges(this.areaChanges, this.staged);

	/**
	 * Where the map editor gets areas: the page for an area added since the tab was last saved, whose
	 * map is all its default tile and has no links yet, and the server for the rest
	 */
	private readonly source: AreaSource = {
		getArea: async (areaId) => (this.staged.get(areaId) ?? this.api.getArea(this.universeId(), areaId)),
		listLinks: async (areaId) => (isNewAreaId(areaId) ? [] : this.api.listLinks(this.universeId(), areaId)),
		loadChunks: async (areaId, range) => (isNewAreaId(areaId) ? { chunks: [] } : this.api.loadChunks(this.universeId(), areaId, range))
	};

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
	 * Every tile the universe can use, as last loaded
	 */
	private savedTiles: EditorTile[] = [];

	/**
	 * Every tile the universe can use with the Tilesets tab's changes, for the default tile choice and
	 * the map editor
	 */
	private tiles: EditorTile[] = [];

	/**
	 * The tiles the Tilesets tab will delete, with the tiles chosen to replace them on the maps
	 */
	private deletedTiles: ReadonlyMap<number, number | undefined> = new Map();

	/**
	 * What the save being sent holds: the areas deleted and added, the area open as it is saved, and
	 * the openVersion when the save started
	 */
	private collected: { deletedIds: string[]; createdIds: string[]; area: EditorArea | undefined; version: number } = { deletedIds: [], createdIds: [], area: undefined, version: -1 };

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
	 * @param stagedTiles The Tilesets tab's changes, which the maps are drawn and painted with
	 * @param onAreaChanged Called with the area the area editor opens, or undefined when the tab goes back to the list
	 */
	constructor(private readonly api: EditorApi, private readonly stagedTiles: StagedTiles, private readonly onAreaChanged: (areaId: string | undefined) => void)
	{
		stagedTiles.tileChanges.subscribe(() =>
		{
			this.showTileChanges();
		});

		this.mapEditor = new MapEditor(this.source, (bounds) =>
		{
			if (this.area)
			{
				this.area = { ...this.area, bounds };
				this.showSize(this.area);
			}
		}, (unsaved) =>
		{
			this.mapUnsaved = unsaved;
			this.areaChanges.check();
		});
		this.name.maxLength = MAX_AREA_NAME_LENGTH;
		this.addName.maxLength = MAX_AREA_NAME_LENGTH;
		setOptions(this.time, namedOptions(AREA_PASSAGES_OF_TIME, PASSAGE_OF_TIME_NAMES));
		setOptions(this.faerie, namedOptions(FAERIE_MORNINGS, FAERIE_MORNING_NAMES));
		setOptions(this.lightLevel, namedOptions(AREA_LIGHT_LEVELS, AREA_LIGHT_LEVEL_NAMES));

		this.time.addEventListener('change', () =>
		{
			this.updateTimeFields();
		});


		for (const choice of [this.outdoors, this.indoors])
		{
			choice.addEventListener('change', () =>
			{
				this.fillDefaultTiles(this.indoors.checked, Number(this.defaultTile.value));
				this.mapEditor.showTilesFor(this.indoors.checked);
				this.showLightField();
			});
		}

		this.name.addEventListener('input', () =>
		{
			setFieldError(this.name, undefined);
		});

		this.deleteButton.addEventListener('click', () =>
		{
			this.toggleDelete();
		});

		getElement('area-back', HTMLButtonElement).addEventListener('click', () =>
		{
			if (this.areaChanges.confirmDiscard())
			{
				void this.showList();
			}
		});

		this.staged.subscribe(() =>
		{
			if (!this.listView.hidden)
			{
				this.renderList();
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
		if (this.universe?.id !== universe.id)
		{
			this.staged.clear();
		}

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
		if (!this.editorView.hidden && !this.areaChanges.confirmDiscard())
		{
			return;
		}

		await this.loadArea(areaId);
	}

	/**
	 * Opens an area, or the list for none, that the page's history went back or forward to, first asking
	 * whether to discard the unsaved changes of the area the editor shows
	 *
	 * @param areaId The area's ID, or undefined for the list
	 * @return False when the player kept the changes, leaving the tab as it was
	 */
	showPlace(areaId: string | undefined): boolean
	{
		if (!this.editorView.hidden && !this.areaChanges.confirmDiscard())
		{
			return(false);
		}

		void ((areaId === undefined) ? this.showList() : this.loadArea(areaId));

		return(true);
	}

	/**
	 * Opens an area in the area editor, discarding any unsaved changes of the area it shows
	 *
	 * @param areaId The area's ID
	 */
	private async loadArea(areaId: string): Promise<void>
	{
		const universe = this.universe;

		if (!universe)
		{
			return;
		}

		const version = ++this.openVersion;

		// Any unsaved painting has been discarded, so the map loads afresh
		this.mapEditor.hide();
		this.areaChanges.markSaved();
		// A new area has no address until it is saved
		this.onAreaChanged((isNewAreaId(areaId) ? undefined : areaId));
		this.listView.hidden = true;
		this.editorView.hidden = false;
		this.fields.disabled = true;
		this.name.disabled = true;
		showMessage(this.error, undefined);

		let area: EditorArea;

		try
		{
			[area] = await Promise.all([
				this.source.getArea(areaId),
				this.loadAreas(universe),
				this.loadTiles(universe)
			]);
		}
		catch (error)
		{
			if (version === this.openVersion)
			{
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
		this.areaChanges.markSaved();
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

		if (version === this.openVersion)
		{
			this.renderList();
		}
	}

	/**
	 * Shows the list of areas as last loaded, with the areas added and deleted since the tab was last saved
	 */
	private renderList(): void
	{
		const listing = areasTabListing(this.allAreas(), this.areas.lobbyAreaId);

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
		this.savedTiles = await this.api.listAllTiles(universe.id);
		this.applyTileChanges();
	}

	/**
	 * Loads the tiles afresh, keeping the tiles last loaded when they can't be
	 *
	 * @param universe The universe
	 */
	private async loadTilesQuietly(universe: EditableUniverse): Promise<void>
	{
		try
		{
			await this.loadTiles(universe);
		}
		catch
		{
			// The tiles stay as they were last loaded, until the next area opens
		}
	}

	/**
	 * Takes the tiles as the Tilesets tab's changes make them, from the tiles last loaded
	 */
	private applyTileChanges(): void
	{
		const { tiles, deleted } = this.stagedTiles.withChanges(this.savedTiles);

		this.tiles = tiles;
		this.deletedTiles = deleted;
	}

	/**
	 * Lists the tiles in the area editor's default tile choice and map editor as the Tilesets tab's
	 * changes make them, keeping the area's unsaved changes
	 */
	private showTileChanges(): void
	{
		this.applyTileChanges();

		if (this.area)
		{
			this.fillDefaultTiles(this.indoors.checked, Number(this.defaultTile.value));
			void this.mapEditor.setTiles(this.tiles, this.deletedTiles, this.indoors.checked);
		}
	}

	/**
	 * Loads the tiles afresh after a save that may have changed them, and shows them
	 */
	async reloadTiles(): Promise<void>
	{
		const universe = this.universe;
		const version = this.openVersion;

		if (!universe || !this.area)
		{
			return;
		}

		await this.loadTilesQuietly(universe);

		if (version === this.openVersion)
		{
			this.showTileChanges();
		}
	}

	/**
	 * The ID of the universe the tab shows
	 *
	 * @return The ID; throws while no universe has opened
	 */
	private universeId(): string
	{
		if (!this.universe)
		{
			throw new Error('The Areas tab has no universe open');
		}

		return(this.universe.id);
	}

	/**
	 * Every area of the universe as last loaded, then the areas added since the tab was last saved
	 *
	 * @return The areas, including those that will be deleted
	 */
	private allAreas(): EditorAreaSummary[]
	{
		return([
			...this.areas.areas,
			...this.staged.newAreas().map(({ id, name, parentAreaId, enabled, indoors }) => ({ id, name, parentAreaId, enabled, indoors }))
		]);
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
				: t(editorMessages.disabledTag)),
			(isNewAreaId(area.id) ? stagedTag('new', false) : undefined)
		].filter((tag) => (tag !== undefined));

		item.style.paddingLeft = `${depth * 20}px`;
		button.type = 'button';
		button.className = 'universe-item';
		name.textContent = area.name;
		details.className = 'universe-ruleset';
		details.textContent = formatList(tags);
		button.append(name, details);

		if (this.staged.isDeleted(area.id))
		{
			item.classList.add('staged-deleted');
			name.append(deletedNote());
		}
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
		const deleted = this.staged.isDeleted(area.id);
		const editable = (canEditWorld(universe.role) && !deleted);
		const areas = this.allAreas();
		const excluded = descendantAreaIds(areas, area.id).add(area.id);
		const isLobby = (area.id === this.areas.lobbyAreaId);
		const isStart = (area.id === this.areas.startingAreaId);

		this.area = area;
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
			...areas
				.filter((other) => (!excluded.has(other.id) && (!this.staged.isDeleted(other.id) || (other.id === area.parentAreaId))))
				.map((other) => ({
					value: other.id,
					label: other.name
				}))
		]);
		this.parent.value = (area.parentAreaId ?? '');
		this.outdoors.checked = !area.indoors;
		this.indoors.checked = area.indoors;
		this.lightLevel.value = area.lightLevel;
		this.showLightField();
		this.fillDefaultTiles(area.indoors, area.defaultTileId);
		this.time.value = area.passageOfTime;
		this.timeField.hidden = isLobby;
		this.lobbyTimeHint.hidden = !isLobby;
		this.faerie.value = (area.faerieMorning ?? FAERIE_MORNINGS[0]);
		this.loopsEastWest.checked = area.loopsEastWest;
		this.loopsNorthSouth.checked = area.loopsNorthSouth;
		this.showSize(area);
		this.updateTimeFields();
		this.updateParentMessage();
		this.fields.disabled = !editable;
		this.name.disabled = !editable;
		this.deleteButton.hidden = (!canEditWorld(universe.role) || isLobby || isStart);
		labelRemoveButton(this.deleteButton, { removed: deleted }, false, t({
			id: 'editor.area.delete',
			defaultMessage: 'Delete Area',
			description: 'Button that deletes the area being edited when the Areas tab is saved'
		}));
		showMessage(this.error, undefined);
		clearFieldErrors(this.form);

		const children = childAreas(areas, area.id);

		this.childList.replaceChildren(...children.map((child) => this.createItem(child, 0)));
		this.children.hidden = (children.length === 0);
		this.areaChanges.markSaved();
		void this.mapEditor.show(universe, area, this.tiles, this.deletedTiles, areas.filter((other) => !this.staged.isDeleted(other.id)), editable);
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
	 * Lists the tiles an area can use by default: the enabled indoor tiles for an indoor area or outdoor
	 * tiles for an outdoor one, leaving out tiles the Tilesets tab will delete, and the selected tile even
	 * when it is disabled or for the other kind, so switching the area between them doesn't change its
	 * default tile
	 *
	 * @param indoors Whether the area is indoors
	 * @param selectedTileId The tile to select
	 */
	private fillDefaultTiles(indoors: boolean, selectedTileId: number): void
	{
		const ruleset = this.universe?.ruleset;

		setOptions(this.defaultTile, this.tiles
			.filter((tile) => ((canPaintTile(tile, indoors) && !this.deletedTiles.has(tile.id)) || (tile.id === selectedTileId)))
			.map((tile) => ({
				value: String(tile.id),
				label: ((ruleset === undefined) ? (tile.name ?? '') : tileName(tile, ruleset))
			})));
		this.defaultTile.value = String(selectedTileId);
	}

	/**
	 * Shows the light level while the area is indoors, the only place it has an effect
	 */
	private showLightField(): void
	{
		this.lightField.hidden = !this.indoors.checked;
		this.lightHint.hidden = !this.indoors.checked;
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
	}

	/**
	 * Warns when an area this one is inside is disabled
	 */
	private updateParentMessage(): void
	{
		const area = this.area;
		const disabled = ((area === undefined) ? [] : ancestorAreas(this.allAreas(), area.id).filter((ancestor) => !ancestor.enabled));

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
	 * Whether the player may change areas
	 *
	 * @return True for a creator or builder
	 */
	canSave(): boolean
	{
		return((this.universe !== undefined) && canEditWorld(this.universe.role));
	}

	/**
	 * The area editor's settings as the form shows them, or why they can't be saved
	 *
	 * @return The settings, or undefined after showing what is wrong
	 */
	private readSettings(): AreaSettings | undefined
	{
		const name = this.name.value.trim();

		if ((name === '') || DISALLOWED_TEXT_CHARACTERS.test(name))
		{
			reportFieldError(this.name, t(formMessages.invalidText));
			return(undefined);
		}

		const passageOfTime = this.time.value as AreaPassageOfTime;

		return({
			name,
			parentAreaId: ((this.parent.value === '') ? null : this.parent.value),
			enabled: this.enabled.checked,
			indoors: this.indoors.checked,
			lightLevel: this.lightLevel.value as AreaLightLevel,
			defaultTileId: Number(this.defaultTile.value),
			passageOfTime,
			faerieMorning: ((passageOfTime === 'faerie') ? this.faerie.value as FaerieMorning : null),
			loopsEastWest: this.loopsEastWest.checked,
			loopsNorthSouth: this.loopsNorthSouth.checked
		});
	}

	/**
	 * Adds the tab's changes to a save: the areas deleted, the areas added, then the area open in the area
	 * editor, its map first and then its settings as the form shows them
	 *
	 * Deleting goes first, so deleting areas can make room for new ones (MAX_AREAS); a new area is added
	 * after the area it is inside, so it can name it. Tiles staged for deletion on the Tilesets tab are
	 * sent as the tiles chosen to replace them, as the Tilesets tab's changes repaint the saved maps
	 *
	 * @param save The save
	 * @return False when the area editor's settings have a problem
	 */
	collect(save: EditorSave): boolean
	{
		const universe = this.universe;
		const area = this.area;
		const error = (area ? this.error : this.listError);

		if (!universe)
		{
			return(true);
		}

		// The area open, unless it is going to be deleted
		const editing = ((area !== undefined) && !this.staged.isDeleted(area.id));
		const settings = (editing ? this.readSettings() : undefined);

		if (editing && !settings)
		{
			return(false);
		}

		const deletedIds = this.staged.deletedIds();
		const created = this.creationOrder(settings);

		/**
		 * An area's parent as a save names it: none for a deleted parent, whose areas the server makes
		 * top-level, and a new parent by its ref
		 *
		 * @param parentAreaId The parent's ID, or null for none
		 * @return The parent, or null for none
		 */
		const parentOf = (parentAreaId: string | null): string | null => (((parentAreaId === null) || deletedIds.includes(parentAreaId)) ? null : areaRef(parentAreaId));

		showMessage(error, undefined);

		for (const areaId of deletedIds)
		{
			save.add({ kind: 'deleteArea', areaId }, (refusal) =>
			{
				showMessage(error, describeEditorError(refusal.error, {
					id: 'editor.areas.deleteFailed',
					defaultMessage: 'Could not delete {area}.',
					description: 'Shown on the Areas tab when the server refused to delete an area, followed by why; {area} is its name. Nothing was saved'
				}, {
					area: this.nameOf(areaId)
				}));
			});
		}

		for (const newArea of created)
		{
			const fields = (((newArea.id === area?.id) && settings) ? settings : newArea);

			save.add({
				kind: 'createArea',
				ref: newRef('', newArea.id),
				area: {
					name: fields.name,
					parentAreaId: parentOf(fields.parentAreaId),
					enabled: fields.enabled,
					indoors: fields.indoors,
					lightLevel: fields.lightLevel,
					defaultTileId: numberRef('tile', this.paintedAs(fields.defaultTileId)),
					passageOfTime: fields.passageOfTime,
					faerieMorning: fields.faerieMorning,
					loopsEastWest: fields.loopsEastWest,
					loopsNorthSouth: fields.loopsNorthSouth
				}
			}, (refusal) =>
			{
				showMessage(error, describeEditorError(refusal.error, {
					id: 'editor.areas.createFailed',
					defaultMessage: 'Could not add {area}.',
					description: 'Shown on the Areas tab when the server refused an area added on it, followed by why; {area} is its name. Nothing was saved'
				}, {
					area: fields.name
				}));
			});
		}

		let saved: EditorArea | undefined;

		if (area && settings)
		{
			const defaultTileId = this.paintedAs(settings.defaultTileId);

			this.mapEditor.collect(save, areaRef, (tileId) => numberRef('tile', this.paintedAs(tileId)), (refusal) =>
			{
				showMessage(this.error, describeEditorError(refusal.error, {
					id: 'editor.area.mapSaveFailed',
					defaultMessage: 'Could not save the map.',
					description: 'Shown in the area editor when the server refused the painting on the area\'s map, its new size or its links, followed by why; nothing was saved'
				}));
			});

			// A new area is added with the form's settings
			if (this.areaChanges.hasUnsavedChanges() && !isNewAreaId(area.id))
			{
				save.add({
					kind: 'updateArea',
					areaId: area.id,
					update: {
						...settings,
						parentAreaId: parentOf(settings.parentAreaId),
						defaultTileId: numberRef('tile', defaultTileId)
					}
				}, (refusal) =>
				{
					showMessage(this.error, describeEditorError(refusal.error, {
						id: 'editor.area.saveFailed',
						defaultMessage: 'Could not save the area.',
						description: 'Shown in the area editor when the server refused the area\'s settings, followed by why; nothing was saved'
					}));
				});
			}

			saved = { ...area, ...settings, defaultTileId };
		}

		this.collected = {
			deletedIds,
			createdIds: created.map((newArea) => newArea.id),
			area: saved,
			version: this.openVersion
		};

		return(true);
	}

	/**
	 * Takes the tab's changes as saved: the new areas get the IDs they were saved with, and the list or
	 * the area editor shows them as the server has them
	 *
	 * @param ids The IDs the save gave the areas and tiles it made
	 */
	async saved(ids: SavedIds): Promise<void>
	{
		const universe = this.universe;
		const { deletedIds, createdIds, area, version } = this.collected;

		this.collected = { deletedIds: [], createdIds: [], area: undefined, version: -1 };

		if (!universe)
		{
			return;
		}

		this.mapEditor.saved();

		for (const areaId of deletedIds)
		{
			this.staged.markDeleted(areaId);
		}

		for (const areaId of createdIds)
		{
			const savedId = ids.string(areaRef(areaId));

			if (savedId !== undefined)
			{
				this.areaCreated(areaId, savedId);
			}
		}

		await this.loadTilesQuietly(universe);
		await this.refreshAfterSave(universe, version, (area && {
			...area,
			id: (ids.string(areaRef(area.id)) ?? area.id),
			parentAreaId: ((area.parentAreaId === null) ? null : (ids.string(areaRef(area.parentAreaId)) ?? null)),
			defaultTileId: (ids.number(numberRef('tile', area.defaultTileId)) ?? area.defaultTileId)
		}));
	}

	/**
	 * The tile a cell or area's default painted with a tile shows once saved: the tile chosen to replace
	 * one staged for deletion on the Tilesets tab, or the tile itself
	 *
	 * @param tileId The tile's ID
	 * @return The tile to save
	 */
	private paintedAs(tileId: number): number
	{
		return(this.deletedTiles.get(tileId) ?? tileId);
	}

	/**
	 * The areas added since the tab was last saved, each after the new area it is inside, so it can name
	 * that area's saved ID
	 *
	 * @param settings The area editor's settings, for the area open, whose parent the form may have changed
	 * @return The areas
	 */
	private creationOrder(settings: AreaSettings | undefined): EditorArea[]
	{
		const waiting = this.staged.newAreas().map((area) => (((area.id === this.area?.id) && settings) ? { ...area, parentAreaId: settings.parentAreaId } : area));
		const order: EditorArea[] = [];

		while (waiting.length > 0)
		{
			// The area editor's parent choices leave out an area's own descendants, so there is always one
			const index = Math.max(0, waiting.findIndex((area) => !waiting.some((other) => (other.id === area.parentAreaId))));

			order.push(...waiting.splice(index, 1));
		}

		return(order);
	}

	/**
	 * Takes a new area as saved: everything that named it by the ID it had on the page names its saved ID
	 *
	 * @param areaId The ID it had on the page
	 * @param savedId The ID the server saved it with
	 */
	private areaCreated(areaId: string, savedId: string): void
	{
		this.staged.markCreated(areaId, savedId);
		this.mapEditor.resolveIds(new Map([[areaId, savedId]]));

		for (const option of this.parent.options)
		{
			if (option.value === areaId)
			{
				option.value = savedId;
			}
		}

		if (this.area?.id === areaId)
		{
			this.area = { ...this.area, id: savedId };
			this.onAreaChanged(savedId);
		}
	}

	/**
	 * Shows the tab afresh once it has saved: the list, or the area editor with the area as saved. The
	 * list of areas is loaded again first, since saving added and deleted areas
	 *
	 * @param universe The universe
	 * @param version The tab's openVersion when saving started; when another area or the list has opened since, it is left alone
	 * @param area The area open, as saved, or undefined when the area editor isn't showing one to keep
	 */
	private async refreshAfterSave(universe: EditableUniverse, version: number, area?: EditorArea): Promise<void>
	{
		if (version !== this.openVersion)
		{
			return;
		}

		if (!area)
		{
			await this.showList();
			return;
		}

		try
		{
			await this.loadAreas(universe);
		}
		catch
		{
			// The list stays as it was last loaded, with the saved areas it doesn't know yet left out
		}

		if (version === this.openVersion)
		{
			this.showArea(universe, area);
		}
	}

	/**
	 * An area's name, for messages
	 *
	 * @param areaId The area's ID
	 * @return Its name, or an empty string when it isn't known
	 */
	private nameOf(areaId: string): string
	{
		return(this.allAreas().find((area) => (area.id === areaId))?.name ?? '');
	}

	/**
	 * Deletes the area open when the tab is saved, after asking, and goes back to the list; or, for an
	 * area that will be deleted, keeps it after all. A new area is deleted immediately, since it was
	 * never saved
	 */
	private toggleDelete(): void
	{
		const universe = this.universe;
		const area = this.area;

		if (!universe || !area)
		{
			return;
		}

		if (this.staged.isDeleted(area.id))
		{
			this.staged.undoDelete(area.id);
			this.showArea(universe, area);
			return;
		}

		const question = (isNewAreaId(area.id)
			? t({
				id: 'editor.area.confirmDeleteNew',
				defaultMessage: 'Delete {area}? It hasn\'t been saved, so its settings, map and links will be lost.',
				description: 'Asks before deleting an area added since the Areas tab was last saved, which goes immediately; {area} is its name'
			}, {
				area: area.name
			})
			: t({
				id: 'editor.area.confirmDelete',
				defaultMessage: 'Delete {area}, its map and every link into it when the Areas tab is saved? Areas inside it become top-level areas.',
				description: 'Asks before marking an area to be deleted when the Areas tab is saved; {area} is its name'
			}, {
				area: area.name
			}));

		if (!window.confirm(question))
		{
			return;
		}

		this.staged.delete(area.id);
		void this.showList();
	}

	/**
	 * The tile a new area uses by default, as the server picks it (DEFAULT_AREA_TILE_KEYS)
	 *
	 * @param universe The universe
	 * @param indoors Whether the area is indoors
	 * @return The tile's ID, or undefined when the universe has no such tile
	 */
	private defaultTileFor(universe: EditableUniverse, indoors: boolean): number | undefined
	{
		const keys = DEFAULT_AREA_TILE_KEYS[universe.ruleset];
		const key = (indoors ? keys.indoors : keys.outdoors);

		return(this.tiles.find((tile) => (tile.key === key))?.id);
	}

	/**
	 * Adds the area the Add Area dialog describes, to be saved with the tab, and opens it in the area
	 * editor. It takes the settings the server gives a new area
	 */
	private async addArea(): Promise<void>
	{
		const universe = this.universe;
		const name = this.addName.value.trim();
		const indoors = this.addIndoors.checked;
		const failed = {
			id: 'editor.areaAdd.failed',
			defaultMessage: 'Could not add the area.',
			description: 'Shown in the Add Area dialog when the area couldn\'t be made'
		};

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
		showMessage(this.addError, undefined);

		try
		{
			await this.loadTiles(universe);
		}
		catch (error)
		{
			showMessage(this.addError, describeEditorError(error, failed));
			this.addSubmit.disabled = false;
			return;
		}

		const defaultTileId = this.defaultTileFor(universe, indoors);

		if (defaultTileId === undefined)
		{
			showMessage(this.addError, t(failed));
			this.addSubmit.disabled = false;
			return;
		}

		const area = this.staged.create({
			name,
			parentAreaId: null,
			enabled: (universe.stage === 'in_the_beginning'),
			indoors,
			lightLevel: 'lit',
			defaultTileId,
			passageOfTime: 'inherit',
			faerieMorning: null,
			loopsEastWest: false,
			loopsNorthSouth: false
		});

		this.addChanges.markSaved();
		this.addDialog.close();
		await this.openArea(area.id);
	}
}
