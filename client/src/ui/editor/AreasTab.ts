import { ancestorAreas, AREA_LIGHT_LEVEL_NAMES, AREA_LIGHT_LEVELS, canEditWorld, canEditWorldOpen, canPaintTile, childAreas, DEFAULT_AREA_TILE_KEYS, descendantAreaIds, DISALLOWED_TEXT_CHARACTERS, FAERIE_MORNING_NAMES, FAERIE_MORNINGS, MAX_AREA_NAME_LENGTH, parentAreas, PASSAGE_OF_TIME_NAMES, AREA_PASSAGES_OF_TIME, areasTabListing, loadedFor, type AreaChangeUpdate, type AuditSubject, type EditableUniverse, type EditorTile, type EditorArea, type EditorAreaSummary, type FaerieMorning, type AreaListPayload, type AreaLightLevel, type AreaPassageOfTime, type AreaSettings, type SavedEditDetail } from '@multiverse-kiln/shared';

import { formatList, t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { announce } from '../announcer';
import { ChangeTracker } from '../changeTracker';
import { getElement, namedOptions, setOptions, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import { SearchSelect } from '../SearchSelect';
import { tileName } from '../tileNames';
import { claimTag, sameClaims, type AreaClaims } from './areaClaims';
import { AreaEditor, type FollowedPainting } from './AreaEditor';
import type { AreaSource } from './areaSource';
import { editorMessages } from './editorMessages';
import { newRef, numberRef, type EditorSave, type SavedIds } from './editorSave';
import { ChangedSinceLine, type FollowsOtherSaves, type OtherSave } from './otherSaves';
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
 * What a save changes on the tab, as the Audit tab names it
 */
const AREA_SUBJECTS: ReadonlySet<AuditSubject> = new Set(['area', 'cells', 'links']);

/**
 * Whether a save's detail is painting the cell editor takes into its cells as they are: painting that names
 * the chunks it touched
 *
 * @param detail The detail
 * @return True when it is
 */
function isFollowedPainting(detail: SavedEditDetail): boolean
{
	return((detail.subject === 'cells') && (detail.chunks !== undefined));
}

/**
 * The Areas tab: the universe's areas, opening the area editor, and adding and deleting areas
 *
 * The area editor is a view in the tab rather than a dialog, since it holds the area's cells. Areas added
 * and deleted wait on the page until the tab is saved, as do the changes made to the area open in the
 * area editor; a new area can be opened, painted and linked to before it is saved
 */
export class AreasTab implements SavableTab, FollowsOtherSaves
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
	private readonly parentField = getElement('area-parent', HTMLInputElement);

	/**
	 * The area the area shown is inside, chosen by typing part of its name; '' for none
	 */
	private readonly parent = new SearchSelect({
		searchId: 'area-parent',
		listboxId: 'area-parent-options',
		choices: [],
		onChange: () =>
		{
			this.areaChanges.check();
		}
	});
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
	private readonly lobbyNotice = getElement('area-lobby-notice', HTMLElement);
	private readonly backToLobby = getElement('area-back-lobby', HTMLButtonElement);
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
	private readonly areaEditor: AreaEditor;

	/**
	 * Whether the cell editor has painting, a change of size or links that haven't been saved
	 */
	private cellsUnsaved = false;

	/**
	 * Whether the area editor's settings or cells have changes that haven't been saved
	 */
	private readonly areaChanges = new ChangeTracker({
		root: this.form,
		state: () => [this.cellsUnsaved, this.parent.value]
	});

	/**
	 * Says above the area editor's settings what other windows saved to the area open while it had
	 * unsaved changes
	 */
	private readonly changedSince = new ChangedSinceLine(this.form, this.areaChanges);

	/**
	 * The areas added and deleted since the tab was last saved
	 */
	private readonly staged = new StagedAreas();

	/**
	 * Whether the tab has changes that haven't been saved: areas added or deleted, or changes to the area open
	 */
	readonly changes = combineChanges(this.areaChanges, this.staged);

	/**
	 * Where the cell editor gets areas: the page for an area added since the tab was last saved, whose
	 * cells are all its default tile and which has no links yet, and the server for the rest
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
	private areas: AreaListPayload = { areas: [], lobbyAreaId: null, startingAreaId: null, startingAreaIds: [] };

	/**
	 * Every tile the universe can use, as last loaded
	 */
	private savedTiles: EditorTile[] = [];

	/**
	 * Every tile the universe can use with the Tilesets tab's changes, for the default tile choice and
	 * the cell editor
	 */
	private tiles: EditorTile[] = [];

	/**
	 * The tiles the Tilesets tab will delete, with the tiles chosen to replace them in the areas
	 */
	private deletedTiles: ReadonlyMap<number, number | undefined> = new Map();

	/**
	 * What the save being sent holds: the areas deleted and added, the area open as it is saved and its
	 * settings as the form showed them, and the openVersion when the save started
	 */
	private collected: { deletedIds: string[]; createdIds: string[]; area: EditorArea | undefined; shown: AreaSettings | undefined; version: number } = { deletedIds: [], createdIds: [], area: undefined, shown: undefined, version: -1 };

	/**
	 * The area the editor is showing
	 */
	private area: EditorArea | undefined;

	/**
	 * Says above the area's cells who else is editing the area open
	 */
	private readonly claimLine = getElement('area-cells-claim', HTMLParagraphElement);

	/**
	 * Who else has each area open in the area editor, as the editor room last said
	 */
	private claims: AreaClaims = new Map();

	/**
	 * The names the claim line last showed, so it is read out only when they change
	 */
	private shownClaim: readonly string[] = [];

	/**
	 * Changes every time the tab opens a universe or an area, so data that arrives for an earlier one is ignored
	 */
	private openVersion = 0;

	/**
	 * @param api The editor's API
	 * @param stagedTiles The Tilesets tab's changes, which the areas are drawn and painted with
	 * @param onAreaChanged Called with the area the area editor opens, or undefined when the tab goes back to the list
	 * @param onAreasLoaded Called each time the tab has loaded the universe's areas, which areaName() names
	 * @param onBackToLobby Called when the player leaves the lobby's area with Back to Lobby, to show the Lobby tab
	 */
	constructor(private readonly api: EditorApi, private readonly stagedTiles: StagedTiles, private readonly onAreaChanged: (areaId: string | undefined) => void, private readonly onAreasLoaded: () => void, private readonly onBackToLobby: () => void)
	{
		stagedTiles.tileChanges.subscribe(() =>
		{
			this.showTileChanges();
		});

		this.areaEditor = new AreaEditor(this.source, (bounds) =>
		{
			if (this.area)
			{
				this.area = { ...this.area, bounds };
				this.showSize(this.area);
			}
		}, (unsaved) =>
		{
			this.cellsUnsaved = unsaved;
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
				this.areaEditor.showTilesFor(this.indoors.checked);
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

		this.backToLobby.addEventListener('click', () =>
		{
			if (this.areaChanges.confirmDiscard())
			{
				void this.showList();
				this.onBackToLobby();
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
		this.addButton.hidden = !canEditWorldOpen(universe);

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
	 * Follows the lobby moving to another area, or to none, once the Lobby tab has saved it
	 *
	 * @param lobbyAreaId The lobby's area, or null for none
	 */
	setLobbyArea(lobbyAreaId: string | null): void
	{
		this.areas = { ...this.areas, lobbyAreaId };
		this.renderList();

		if (this.area && this.universe)
		{
			const isLobby = (this.area.id === lobbyAreaId);

			this.showLobby(isLobby);
			this.deleteButton.hidden = (!canEditWorldOpen(this.universe) || isLobby || (this.area.id === this.areas.startingAreaId));
		}
	}

	/**
	 * Says in the area editor whether the area shown is the lobby's, whose passage of time is set on the
	 * Lobby tab instead, and offers to go back to the Lobby tab
	 *
	 * @param isLobby Whether it is
	 */
	private showLobby(isLobby: boolean): void
	{
		this.lobbyNotice.hidden = !isLobby;
		this.backToLobby.hidden = !isLobby;
		this.timeField.hidden = isLobby;
		this.lobbyTimeHint.hidden = !isLobby;
	}

	/**
	 * The name of a saved area, as the tab last loaded the universe's areas
	 *
	 * @param areaId The area's ID
	 * @return Its name, or undefined while the areas haven't loaded or it isn't one of them
	 */
	areaName(areaId: string): string | undefined
	{
		return(this.areas.areas.find((area) => (area.id === areaId))?.name);
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

		// A role that can't load areas gets the empty list instead
		if (!canEditWorld(universe.role))
		{
			await this.showList();
			return;
		}

		const version = ++this.openVersion;

		// Any unsaved painting has been discarded, so the area's cells load afresh
		this.areaEditor.hide();
		this.areaChanges.markSaved();
		this.changedSince.hide();
		showMessage(this.claimLine, undefined);
		this.shownClaim = [];
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
	 * Shows the list of areas, loading them when a save may have changed them since they last loaded
	 */
	private async showList(): Promise<void>
	{
		const universe = this.universe;
		const version = ++this.openVersion;

		this.area = undefined;
		this.onAreaChanged(undefined);
		this.areaEditor.hide();
		// The hidden area editor is filled afresh when an area opens, so nothing left in it can be saved
		this.areaChanges.markSaved();
		this.changedSince.hide();
		this.listView.hidden = false;
		this.editorView.hidden = true;
		this.showClaim();

		// Only roles that change the world may load the areas (see shared/src/editor.ts)
		if (!universe || !canEditWorld(universe.role))
		{
			this.list.replaceChildren();
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
		const listing = areasTabListing(this.allAreas());

		// An area the listing passed through is shown above the areas inside it, indented by how deep each is
		this.list.replaceChildren(
			...listing.path.map((area, depth) => this.createItem(area, depth)),
			...listing.areas.map((area) => this.createItem(area, listing.path.length))
		);
		showMessage(this.empty, ((listing.areas.length === 0)
			? t({
				id: 'editor.areas.none',
				defaultMessage: 'There are no areas yet.',
				description: 'Shown instead of the list of areas when the universe has none'
			})
			: undefined));
	}

	/**
	 * Loads every area of the universe, sharing the load with the other tabs (see EditorApi.sendShared())
	 *
	 * @param universe The universe
	 */
	private async loadAreas(universe: EditableUniverse): Promise<void>
	{
		this.areas = await this.api.listAreas(universe.id);
		this.onAreasLoaded();
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
	 * Lists the tiles in the area editor's default tile choice and cell editor as the Tilesets tab's
	 * changes make them, keeping the area's unsaved changes
	 */
	private showTileChanges(): void
	{
		this.applyTileChanges();

		if (this.area)
		{
			this.fillDefaultTiles(this.indoors.checked, Number(this.defaultTile.value));
			void this.areaEditor.setTiles(this.tiles, this.deletedTiles, this.indoors.checked);
		}
	}

	/**
	 * Follows a save made in another window that changed areas: loads the list again, and the area open
	 * when the save changed it and it has no unsaved changes here; with them, keeps them and says above
	 * the area's settings what the save changed. An area the save deleted is taken as deleted here too
	 * (StagedAreas.markDeleted()). Painting the open area's cells is left to followPainting()
	 *
	 * @param save The save
	 * @return True when the save changed an area with unsaved changes here: the area open, or one being
	 * deleted when the tab is saved
	 */
	otherSaved(save: OtherSave): boolean
	{
		const universe = this.universe;
		const changed = save.details.filter((detail) => AREA_SUBJECTS.has(detail.subject));

		if (!universe || (changed.length === 0))
		{
			return(false);
		}

		const deletedAreaIds = new Set(changed.flatMap((detail) => (((detail.subject === 'area') && (detail.action === 'deleted') && (typeof detail.id === 'string')) ? [detail.id] : [])));

		for (const areaId of deletedAreaIds)
		{
			this.staged.markDeleted(areaId);
		}

		const open = this.area;
		const aboutOpen = changed.filter((detail) => ((open !== undefined) && (detail.id === open.id)));
		const deletedHere =changed.some((detail) => ((typeof detail.id === 'string') && this.staged.isDeleted(detail.id)));

		if (open === undefined)
		{
			void this.showList();
			return(deletedHere);
		}

		// Painting is taken into the area's cells as they are by followPainting()
		const rest = aboutOpen.filter((detail) => !isFollowedPainting(detail));

		if (rest.length === 0)
		{
			void this.loadAreas(universe).catch(() =>
			{
				// The areas stay as they were last loaded, until the next area opens
			});
			return(deletedHere);
		}

		// A link dialog with changes not yet applied applies them to the area as it is open, so the area stays
		const linkDialog = this.areaEditor.linkDialogFollowing();

		if (this.areaChanges.hasUnsavedChanges() || linkDialog.hasUnappliedChanges())
		{
			this.changedSince.add(save.name, rest);

			if (deletedAreaIds.has(open.id) && !isNewAreaId(open.id))
			{
				this.recreateOpenArea(open, deletedAreaIds);
			}

			return(true);
		}

		if (linkDialog.isOpen())
		{
			linkDialog.close();
		}

		void (aboutOpen.some((detail) => ((detail.subject === 'area') && (detail.action === 'deleted'))) ? this.showList() : this.refreshArea(open.id, save.name, rest));

		return(deletedHere);
	}

	/**
	 * Keeps the area open, which a save in another window deleted while it had unsaved changes here, as a
	 * new area with the settings it was loaded with and its cells as they show here (AreaEditor.recreate()),
	 * so saving adds it again with the changes made to it, and deleting it discards them. One inside an
	 * area the save deleted too becomes a top-level area, as the server makes the areas inside it
	 *
	 * @param area The area, as it was loaded
	 * @param deletedAreaIds The areas the save deleted
	 */
	private recreateOpenArea(area: EditorArea, deletedAreaIds: ReadonlySet<string>): void
	{
		const parentDeleted = ((area.parentAreaId !== null) && deletedAreaIds.has(area.parentAreaId));

		if ((this.parent.value !== '') && deletedAreaIds.has(this.parent.value))
		{
			this.parent.value = '';
			this.updateParentMessage();
		}

		const added = this.staged.create({
			name: area.name,
			parentAreaId: (parentDeleted ? null : area.parentAreaId),
			enabled: area.enabled,
			indoors: area.indoors,
			lightLevel: area.lightLevel,
			defaultTileId: area.defaultTileId,
			passageOfTime: area.passageOfTime,
			faerieMorning: area.faerieMorning,
			loopsEastWest: area.loopsEastWest,
			loopsNorthSouth: area.loopsNorthSouth
		});

		this.areaEditor.recreate(added.id, added.bounds);
		this.area = { ...area, id: added.id };
		// A new area has no address until it is saved
		this.onAreaChanged(undefined);
		this.showClaim();
	}

	/**
	 * Takes the painting a save made in another window to the open area into its cells, unsaved changes or
	 * not, marking the cells it changed (AreaEditor.followPainting()). Call it after otherSaved()
	 *
	 * @param save The save
	 * @return How many of the cells it changed had been painted here while the area was open, and what
	 * takes its marks off the area
	 */
	async followPainting(save: OtherSave): Promise<FollowedPainting>
	{
		const open = this.area;
		const followed = ((open === undefined)
			? []
			: await Promise.all(save.details
				.filter((detail) => (isFollowedPainting(detail) && (detail.id === open.id)))
				.map((detail) => this.areaEditor.followPainting(open.id, (detail.chunks ?? []), save.name))));

		return({
			paintedOver: followed.reduce((sum, each) => (sum + each.paintedOver), 0),
			unmark: () =>
			{
				for (const each of followed)
				{
					each.unmark();
				}
			}
		});
	}

	/**
	 * Follows who else is editing each area, as the editor room says: tags the areas in the lists, and
	 * says above the area's cells who else is editing the area open
	 *
	 * @param claims Who else has each area open, from areaClaims()
	 */
	setClaims(claims: AreaClaims): void
	{
		if (sameClaims(claims, this.claims))
		{
			return;
		}

		this.claims = claims;

		if (!this.listView.hidden)
		{
			this.renderList();
		}

		if (this.area)
		{
			this.childList.replaceChildren(...childAreas(this.allAreas(), this.area.id).map((child) => this.createItem(child, 0)));
		}

		this.showClaim();
	}

	/**
	 * Says above the area's cells who else is editing the area open, reading it out when the names change
	 */
	private showClaim(): void
	{
		const names = (((this.area === undefined) || this.editorView.hidden) ? [] : (this.claims.get(this.area.id) ?? []));
		const changed = ((names.length !== this.shownClaim.length) || names.some((name, index) => (name !== this.shownClaim[index])));

		this.shownClaim = names;

		if (names.length === 0)
		{
			showMessage(this.claimLine, undefined);
			return;
		}

		const text = t({
			id: 'editor.area.claimed',
			defaultMessage: '{count, plural, one {{names} is also editing this area. You can still modify it; cells the other person paints will be shown to you (including conflicts).} other {{names} are editing this area too. You can still modify it; cells the others paint will be shown to you (including conflicts).}}',
			description: 'Above the area\'s cells in the area editor while other editors have the same area open in theirs; {names} is their display names as a list, e.g. "Bea and Cal", and {count} how many. It warns rather than locks. Also read out by screen readers when it changes'
		}, {
			names: formatList(names, 'conjunction'),
			count: names.length
		});

		showMessage(this.claimLine, text);

		if (changed)
		{
			announce(text);
		}
	}

	/**
	 * Loads the open area's settings and links again after another window saved them, keeping its cells as
	 * they have loaded, with the painting other editors saved taken in, unless its size changed. One that
	 * can't be loaded opens afresh, and one that has unsaved changes by the time it loads keeps them,
	 * saying above its settings what the save changed
	 *
	 * @param areaId The area's ID
	 * @param name Who saved, for the note above the settings
	 * @param details What the save changed in the area
	 */
	private async refreshArea(areaId: string, name: string, details: readonly SavedEditDetail[]): Promise<void>
	{
		const universe = this.universe;
		const version = this.openVersion;

		if (!universe)
		{
			return;
		}

		let area: EditorArea;

		try
		{
			[area] = await Promise.all([
				this.source.getArea(areaId),
				this.loadAreas(universe)
			]);
		}
		catch
		{
			if (version === this.openVersion)
			{
				await this.loadArea(areaId);
			}

			return;
		}

		if ((version !== this.openVersion) || (this.area?.id !== areaId))
		{
			return;
		}

		if (this.areaChanges.hasUnsavedChanges() || this.areaEditor.linkDialogFollowing().hasUnappliedChanges())
		{
			this.changedSince.add(name, details);
			return;
		}

		this.changedSince.hide();
		this.showArea(universe, area);
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
			((area.id === this.areas.lobbyAreaId)
				? t({
					id: 'editor.areas.lobbyTag',
					defaultMessage: 'lobby',
					description: 'Under an area in the list of areas, for the area players walk around in the universe\'s lobby'
				})
				: undefined),
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
			(isNewAreaId(area.id) ? stagedTag('new', false) : undefined),
			(this.claims.has(area.id) ? claimTag(this.claims.get(area.id) ?? []) : undefined)
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
		const editable = (canEditWorldOpen(universe) && !deleted);
		const areas = this.allAreas();
		const excluded = descendantAreaIds(areas, area.id).add(area.id);
		const parents = parentAreas(areas);
		const isLobby = (area.id === this.areas.lobbyAreaId);
		const isStart = (area.id === this.areas.startingAreaId);

		this.area = area;
		const noParent = t({
			id: 'editor.area.noParent',
			defaultMessage: 'None (a top-level area)',
			description: 'Choice of parent area for an area that isn\'t inside another, also shown in the empty Parent area field, where typing finds an area by name'
		});

		this.parentField.placeholder = noParent;
		this.parent.setChoices([
			{
				value: '',
				name: noParent
			},
			...areas
				.filter((other) => (!excluded.has(other.id) && (!this.staged.isDeleted(other.id) || (other.id === area.parentAreaId))))
				.map((other) => ({
					value: other.id,
					name: other.name,
					detail: parents.get(other.id)?.name
				}))
		]);
		this.fillSettings(area);
		this.showLobby(isLobby);
		this.showSize(area);
		this.updateParentMessage();
		this.fields.disabled = !editable;
		this.name.disabled = !editable;
		this.deleteButton.hidden = (!canEditWorldOpen(universe) || isLobby || isStart);
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
		this.showClaim();
		this.areaChanges.markSaved();
		void this.areaEditor.show(universe, area, this.tiles, this.deletedTiles, areas.filter((other) => !this.staged.isDeleted(other.id)), editable);
	}

	/**
	 * Fills the area editor's settings fields, after its parent choices
	 *
	 * @param settings The settings
	 */
	private fillSettings(settings: AreaSettings): void
	{
		this.name.value = settings.name;
		this.enabled.checked = settings.enabled;
		this.parent.value = (settings.parentAreaId ?? '');
		this.outdoors.checked = !settings.indoors;
		this.indoors.checked = settings.indoors;
		this.lightLevel.value = settings.lightLevel;
		this.showLightField();
		this.fillDefaultTiles(settings.indoors, settings.defaultTileId);
		this.time.value = settings.passageOfTime;
		this.faerie.value = (settings.faerieMorning ?? FAERIE_MORNINGS[0]);
		this.loopsEastWest.checked = settings.loopsEastWest;
		this.loopsNorthSouth.checked = settings.loopsNorthSouth;
		this.updateTimeFields();
	}

	/**
	 * Fills the area editor with the area open as a save made in this window saved it. Settings changed
	 * in the form while the save was sent keep their values, as unsaved changes
	 *
	 * @param universe The area's universe
	 * @param area The area, as saved
	 * @param collected The form's settings as the save collected them, or undefined when it didn't
	 */
	private showSavedArea(universe: EditableUniverse, area: EditorArea, collected: AreaSettings | undefined): void
	{
		const shown = this.shownSettings();
		const changed = ((collected === undefined) ? [] : (Object.keys(shown) as (keyof AreaSettings)[]).filter((key) => (shown[key] !== collected[key])));

		this.showArea(universe, area);

		if (changed.length > 0)
		{
			this.fillSettings({
				...this.shownSettings(),
				...Object.fromEntries(changed.map((key) => [key, shown[key]]))
			});
			this.areaChanges.check();
		}
	}

	/**
	 * Shows how large an area is
	 *
	 * @param area The area
	 */
	private showSize(area: EditorArea): void
	{
		const width = (area.bounds.maxColumn - area.bounds.minColumn) + 1;
		const height = (area.bounds.maxRow - area.bounds.minRow) + 1;

		this.size.textContent = t({
			id: 'editor.area.size',
			defaultMessage: 'The area is {height, number} tall x {width, number} wide.',
			description: 'The size of the area, in cells'
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
	 * @return True for a creator or builder, in a version they may change
	 */
	canSave(): boolean
	{
		return((this.universe !== undefined) && canEditWorldOpen(this.universe));
	}

	/**
	 * The area editor's settings as the form shows them, or why they can't be saved
	 *
	 * @return The settings, or undefined after showing what is wrong
	 */
	private readSettings(): AreaSettings | undefined
	{
		const settings = this.shownSettings();
		const name = settings.name.trim();

		if ((name === '') || DISALLOWED_TEXT_CHARACTERS.test(name))
		{
			reportFieldError(this.name, t(formMessages.invalidText));
			return(undefined);
		}

		return({
			...settings,
			name
		});
	}

	/**
	 * The area editor's settings exactly as the form shows them, the name untrimmed, whether or not they
	 * can be saved
	 *
	 * @return The settings
	 */
	private shownSettings(): AreaSettings
	{
		const passageOfTime = this.time.value as AreaPassageOfTime;

		return({
			name: this.name.value,
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
	 * editor, its cells first and then its settings as the form shows them
	 *
	 * Deleting goes first, so deleting areas can make room for new ones (the site's areasPerUniverse); a new area is added
	 * after the area it is inside, so it can name it. Tiles staged for deletion on the Tilesets tab are
	 * sent as the tiles chosen to replace them, as the Tilesets tab's changes repaint the saved areas
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

			this.areaEditor.collect(save, areaRef, (tileId) => numberRef('tile', this.paintedAs(tileId)), (refusal) =>
			{
				showMessage(this.error, describeEditorError(refusal.error, {
					id: 'editor.area.cellsSaveFailed',
					defaultMessage: 'Could not save the area\'s cells.',
					description: 'Shown in the area editor when the server refused the painting on the area\'s cells, its new size or its links, followed by why; nothing was saved'
				}));
			});

			// A new area is added with the form's settings
			if (this.areaChanges.hasUnsavedChanges() && !isNewAreaId(area.id))
			{
				const update: AreaChangeUpdate = {
					...settings,
					parentAreaId: parentOf(settings.parentAreaId),
					defaultTileId: numberRef('tile', defaultTileId)
				};

				save.add({
					kind: 'updateArea',
					areaId: area.id,
					update,
					loaded: loadedFor(area, update)
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
			shown: ((saved === undefined) ? undefined : this.shownSettings()),
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
		const { deletedIds, createdIds, area, shown, version } = this.collected;

		this.collected = { deletedIds: [], createdIds: [], area: undefined, shown: undefined, version: -1 };

		if (!universe)
		{
			return;
		}

		this.areaEditor.saved();

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
		}), shown);
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
		this.areaEditor.resolveIds(new Map([[areaId, savedId]]));

		this.parent.replaceValue(areaId, savedId);

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
	 * @param shown The area editor's settings as the save collected them
	 */
	private async refreshAfterSave(universe: EditableUniverse, version: number, area?: EditorArea, shown?: AreaSettings): Promise<void>
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
			this.showSavedArea(universe, area, shown);
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
				defaultMessage: 'Delete {area}? It hasn\'t been saved, so its settings, painting and links will be lost.',
				description: 'Asks before deleting an area added since the Areas tab was last saved, which goes immediately; {area} is its name'
			}, {
				area: area.name
			})
			: t({
				id: 'editor.area.confirmDelete',
				defaultMessage: 'Delete {area} and every link into it when the Areas tab is saved? Areas inside it become top-level areas.',
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
