import { canEditWorld, canEditWorldOpen, canHaveNeighbors, canTakeParent, defineMessages, DISALLOWED_TEXT_CHARACTERS, editsEveryPlace, halfLoopingEnd, hasNeighbors, isInLobby, isWithinAssignments, loadedFor, lobbyAreaIds, lobbyProblems, lobbyProblemsOfMove, loopPlace, MAX_AREA_NAME_LENGTH, misalignedLoops, MAX_REGION_NAME_LENGTH, MIN_NEIGHBOR_AREA_SIDE, NEIGHBOR_SIDES, neighborPairs, neighborProblems, neighborRefusal, NEW_AREA_BOUNDS, newNeighbor, NO_NEIGHBORS, PlaceGraph, placeKey, placeNeighbors, resolveAreaSettings, resolvePlace, samePlace, withNeighbors, withoutNeighbor, type AreaBounds, type AreaNeighbors, type GridArea, type NeighborGrid, type NeighborSide, type AreaChangeUpdate, type AreaLinkPair, type AreaNode, type AreaSettings, type AuditSubject, type EditableUniverse, type EditorArea, type EditorAreaSummary, type EditorRegion, type EditorTile, type AreaListPayload, type MessageValues, type NumberRef, type PlaceKind, type PlaceNode, type PlaceProblem, type PlaceRef, type PlaceSettings, type PlaceWorld, type SavedEditDetail, type TileUsedFor } from '@multiverse-kiln/shared';

import { formatList, t } from '../../localization';
import { describeEditorError, EditorApiError, type EditorApi } from '../../network/editorApi';
import { announce } from '../announcer';
import { ChangeTracker } from '../changeTracker';
import { getElement, scrollBackTo, setOptions, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import { SearchSelect } from '../SearchSelect';
import { claimTag, sameClaims, type AreaClaims } from './areaClaims';
import { AreaEditor, type FollowedPainting } from './AreaEditor';
import type { AreaSelectDialog } from './AreaSelectDialog';
import type { AreaSource } from './areaSource';
import { editorMessages } from './editorMessages';
import { newRef, numberRef, type EditorSave, type SaveRefusal, type SavedIds } from './editorSave';
import { ChangedSinceLine, type FollowsOtherSaves, type OtherSave } from './otherSaves';
import { OverallMapDialog } from './OverallMapDialog';
import { ParentsField, type ParentChoice } from './ParentsField';
import { PlaceFields, type InheritedView } from './PlaceFields';
import { describeProblem, placeNamer, problemPlaces, type PlaceNames } from './places';
import { PlacesList, type ListedPlace } from './PlacesList';
import { RegionEditorView } from './RegionEditorView';
import { combineChanges, type SavableTab } from './SaveBar';
import { isNewAreaId, isNewPlace, StagedAreas, withoutParent } from './stagedAreas';
import { CheckedChanges, labelRemoveButton, stagedTag, type StagedTiles } from './stagedChanges';
import type { TilePlaces } from './TileReplaceDialog';

/**
 * Text the tab shows in more than one place (see src/localization.ts)
 */
const messages = defineMessages({
	needsParent: {
		id: 'editor.area.needsParent',
		defaultMessage: 'An area must be inside at least one region or area.',
		description: 'Shown when an area\'s parents have all been removed, which keeps it from saving: in the area editor, or on the Areas tab after the name of an area left before saving'
	},
	neighborSide: {
		id: 'editor.area.neighborSide',
		defaultMessage: '{side, select, north {North} east {East} south {South} other {West}}',
		description: 'Names a side of the area in the area editor\'s Neighbors section: before the neighboring area on that side, and as a choice in the list of sides to add a neighbor on'
	},
	chooseNeighbor: {
		id: 'editor.area.chooseNeighbor',
		defaultMessage: 'Choose',
		description: 'Button in the area editor\'s Neighbors section, beside a neighboring area or the side chosen to add one on, that opens a dialog for choosing the area next to it on that side, walked across without a link'
	}
});

/**
 * How a save names a region or area: a saved one by its ID, and one added since the tab was last saved
 * by its ref
 *
 * @param id The region's or area's ID on the page
 * @return The reference
 */
export function placeRef(id: string): string
{
	return((isNewAreaId(id) ? newRef('', id) : id));
}

/**
 * Whether two sets of bounds are the same
 *
 * @param first One area's bounds
 * @param second The other's
 * @return True when every edge matches
 */
function sameBoundsAs(first: AreaBounds, second: AreaBounds): boolean
{
	return((first.minColumn === second.minColumn) && (first.minRow === second.minRow) && (first.maxColumn === second.maxColumn) && (first.maxRow === second.maxRow));
}

/**
 * Settings that all inherit
 */
const BLANK_SETTINGS: PlaceSettings = {
	enabled: null,
	indoors: null,
	lightLevel: null,
	defaultTileId: null,
	passageOfTime: null,
	faerieMorning: null,
	fogOfWar: null
};

/**
 * What a save changes on the tab, as the Audit tab names it
 */
const AREA_SUBJECTS: ReadonlySet<AuditSubject> = new Set(['region', 'area', 'cells', 'links']);

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
 * A region or area with its settings changed to the ones the editor shows, for working out settings with
 * changes not yet saved
 */
export type PlaceOverride = { place: PlaceRef; node: PlaceNode | AreaNode };

/**
 * The settings changed in a saved area that the area editor left before they were saved
 */
interface KeptSettings
{
	/**
	 * The area as it was loaded when the settings were changed, which the save compares with what is saved
	 */
	loaded: EditorArea;

	/**
	 * The settings changed, as the area editor showed them
	 */
	changes: Partial<AreaSettings>;
}

/**
 * What a save in another window changed in an area, said above the area's settings
 */
interface ChangedSinceNote
{
	name: string;
	details: readonly SavedEditDetail[];
}

/**
 * An area's settings, without the rest of what the editor has of it
 *
 * @param area The area
 * @return Its settings
 */
function settingsOf(area: AreaSettings): AreaSettings
{
	return({
		name: area.name,
		parents: area.parents,
		enabled: area.enabled,
		indoors: area.indoors,
		lightLevel: area.lightLevel,
		defaultTileId: area.defaultTileId,
		passageOfTime: area.passageOfTime,
		faerieMorning: area.faerieMorning,
		fogOfWar: area.fogOfWar,
		loopsEastWest: area.loopsEastWest,
		loopsNorthSouth: area.loopsNorthSouth
	});
}

/**
 * The settings of an area that differ between two sets of them
 *
 * @param settings The settings now
 * @param before The settings before
 * @return The settings that differ, as they are now
 */
function changedSettings(settings: AreaSettings, before: AreaSettings): Partial<AreaSettings>
{
	return(Object.fromEntries((Object.keys(settings) as (keyof AreaSettings)[])
		.filter((key) => (JSON.stringify(settings[key]) !== JSON.stringify(before[key])))
		.map((key) => [key, settings[key]])));
}

/**
 * Why an area's settings can't be saved: a name that is blank or holds characters names can't, or no
 * parents
 *
 * @param settings The settings
 * @return The problem, or undefined for none
 */
function settingsProblem(settings: Partial<AreaSettings>): 'name' | 'parents' | undefined
{
	if ((settings.name !== undefined) && ((settings.name.trim() === '') || DISALLOWED_TEXT_CHARACTERS.test(settings.name)))
	{
		return('name');
	}

	if ((settings.parents !== undefined) && (settings.parents.length === 0))
	{
		return('parents');
	}

	return(undefined);
}

/**
 * What the Areas tab gives the region editor: the regions and areas with the tab's changes, and the
 * world worked out from them
 */
export interface PlacesHost
{
	readonly staged: StagedAreas;
	universe(): EditableUniverse | undefined;
	regions(): EditorRegion[];
	areas(): EditorAreaSummary[];
	world(override?: PlaceOverride): PlaceWorld;
	names(): PlaceNames;
	tiles(): readonly EditorTile[];
	deletedTiles(): ReadonlySet<number>;
	canEditPlace(place: PlaceRef): boolean;
	parentChoices(place: PlaceRef, kind: 'region' | 'area', override: PlaceOverride): ParentChoice[];
	open(place: PlaceRef): void;
	showList(): void;
	listItem(place: PlaceRef): HTMLLIElement;
	problemsFor(place: PlaceRef, override: PlaceOverride, list: HTMLElement, container: HTMLElement): void;
	inheritedView(place: PlaceRef, override: PlaceOverride): InheritedView;
	lobbyRegionId(): string | null;
	lobbyProblemsIn(world: PlaceWorld): PlaceProblem[];
	backToLobby(): void;
}

/**
 * The Areas tab: the universe's regions and areas, opening the region and area editors, and adding and
 * deleting them (see Tab: Areas in STRUCTURE-OVERVIEW.md)
 *
 * The area editor is a view in the tab rather than a dialog, since it holds the area's cells. Regions and
 * areas added, deleted and moved wait on the page until the tab is saved, as do the changes made to the
 * region or area open; a new area can be opened, painted and linked to before it is saved. Opening
 * another area, a region or the list keeps the changes of the area left, until they are saved
 */
export class AreasTab implements SavableTab, FollowsOtherSaves, PlacesHost, TilePlaces
{
	private readonly listView = getElement('area-list-view', HTMLElement);
	private readonly empty = getElement('area-empty', HTMLElement);
	private readonly listError = getElement('area-list-error', HTMLElement);
	private readonly addButton = getElement('area-add', HTMLButtonElement);
	private readonly addRegionButton = getElement('region-add', HTMLButtonElement);
	private readonly editorView = getElement('area-editor-view', HTMLElement);
	private readonly form = getElement('area-form', HTMLFormElement);
	private readonly fields = getElement('area-fields', HTMLFieldSetElement);
	private readonly name = getElement('area-name', HTMLInputElement);
	private readonly lobbyTimeHint = getElement('area-lobby-time-hint', HTMLElement);
	private readonly lobbyNotice = getElement('area-lobby-notice', HTMLElement);
	private readonly backToLobbyButton = getElement('area-back-lobby', HTMLButtonElement);
	private readonly loopsEastWest = getElement('area-loops-east-west', HTMLInputElement);
	private readonly loopsNorthSouth = getElement('area-loops-north-south', HTMLInputElement);
	private readonly loopsHint = getElement('area-loops-hint', HTMLElement);
	private readonly problems = getElement('area-problems', HTMLElement);
	private readonly problemList = getElement('area-problem-list', HTMLUListElement);
	private readonly size = getElement('area-size', HTMLElement);
	private readonly error = getElement('area-error', HTMLElement);
	private readonly deleteButton = getElement('area-delete', HTMLButtonElement);
	private readonly children = getElement('area-children', HTMLElement);
	private readonly childList = getElement('area-child-list', HTMLUListElement);
	private readonly addDialog = getElement('area-add-dialog', HTMLDialogElement);
	private readonly addForm = getElement('area-add-form', HTMLFormElement);
	private readonly addName = getElement('area-add-name', HTMLInputElement);
	private readonly addError = getElement('area-add-error', HTMLElement);
	private readonly addSubmit = getElement('area-add-submit', HTMLButtonElement);
	private readonly regionDialog = getElement('region-add-dialog', HTMLDialogElement);
	private readonly regionForm = getElement('region-add-form', HTMLFormElement);
	private readonly regionName = getElement('region-add-name', HTMLInputElement);
	private readonly regionError = getElement('region-add-error', HTMLElement);
	private readonly loopsNeighbors = getElement('area-loops-neighbors', HTMLElement);
	private readonly neighborsHint = getElement('area-neighbors-hint', HTMLElement);
	private readonly neighborList = getElement('area-neighbor-list', HTMLUListElement);
	private readonly overallMapButton = getElement('area-overall-map', HTMLButtonElement);
	private readonly neighborDialog = getElement('neighbor-add-dialog', HTMLDialogElement);
	private readonly neighborForm = getElement('neighbor-add-form', HTMLFormElement);
	private readonly neighborName = getElement('neighbor-add-name', HTMLInputElement);
	private readonly neighborHint = getElement('neighbor-add-hint', HTMLElement);
	private readonly overallMap = new OverallMapDialog();
	private readonly areaEditor: AreaEditor;

	/**
	 * The neighbors changed in the area editor and not yet saved: each changed area's four sides as they
	 * will be, by area ID (see Neighboring areas in STRUCTURE-OVERVIEW.md)
	 */
	private stagedNeighbors = new Map<string, AreaNeighbors>();

	/**
	 * The bounds Edit Size gave the saved areas its resize carried along, not yet saved, by area ID. An
	 * area left with changes of its own takes them as its size instead, as does an area opened
	 */
	private carriedBounds = new Map<string, AreaBounds>();

	/**
	 * The settings changed in the saved areas the area editor left before they were saved, by area ID. An
	 * area added since the tab was saved keeps its settings in staged
	 */
	private readonly keptSettings = new Map<string, KeptSettings>();

	/**
	 * What saves in other windows changed in the areas left with changes, by area ID, said above an area's
	 * settings when it opens again
	 */
	private readonly keptNotes = new Map<string, ChangedSinceNote[]>();

	/**
	 * What saves in other windows changed in the area open while it had changes, as changedSince says
	 */
	private openNotes: ChangedSinceNote[] = [];

	/**
	 * The settings the area open showed once it had opened, which leaving it compares the form with
	 */
	private openedSettings: AreaSettings | undefined;

	/**
	 * The area open as it was loaded when its settings were first changed: as it opened, or for an area
	 * left with changes, as it was when they were made
	 */
	private areaLoaded: EditorArea | undefined;

	/**
	 * Whether the tab has changes not yet saved outside the area open: the areas left with changes, the
	 * links and neighbors changed, and the sizes Edit Size carried areas to
	 */
	private readonly keptChanges: CheckedChanges;

	/**
	 * The side last chosen in the Neighbors section's list of sides to add a neighbor on
	 */
	private neighborAddSide: NeighborSide | undefined;

	/**
	 * The side Add Neighbor adds a new area to, while its dialog is open
	 */
	private addingSide: NeighborSide | undefined;

	/**
	 * Whether the Add Neighbor dialog has a name typed
	 */
	private readonly neighborChanges = new ChangeTracker({ root: this.neighborForm });
	private readonly list: PlacesList;
	private readonly regionEditor: RegionEditorView;

	/**
	 * The area's own settings shared with regions, each with its inherit choice
	 */
	private readonly settings = new PlaceFields('area', () =>
	{
		this.settingsChanged();
	});

	/**
	 * The regions and area the area is inside
	 */
	private readonly parents = new ParentsField('area', () =>
	{
		this.settingsChanged();
	}, (place) =>
	{
		this.open(place);
	});

	/**
	 * Where the Add Area dialog puts the new area
	 */
	private readonly addParent = new SearchSelect({
		searchId: 'area-add-parent',
		listboxId: 'area-add-parent-options',
		choices: [],
		onChange: () =>
		{
			this.addChanges.check();
		}
	});

	/**
	 * Where the Add Region dialog puts the new region; '' for the top level
	 */
	private readonly regionParent = new SearchSelect({
		searchId: 'region-add-parent',
		listboxId: 'region-add-parent-options',
		choices: [],
		onChange: () =>
		{
			this.regionChanges.check();
		}
	});

	/**
	 * Whether the cell editor has painting, a change of size or links that haven't been saved
	 */
	private cellsUnsaved = false;

	/**
	 * Whether the area open has changes to its settings or cells that haven't been saved
	 */
	private readonly areaChanges = new ChangeTracker({
		root: this.form,
		state: () => [this.cellsUnsaved, this.parents.value.map(placeKey).join(',')]
	});

	/**
	 * Says above the area editor's settings what other windows saved to the area open while it had
	 * unsaved changes
	 */
	private readonly changedSince = new ChangedSinceLine(this.form, this.areaChanges);

	/**
	 * The regions and areas added, deleted and moved since the tab was last saved
	 */
	readonly staged = new StagedAreas();

	/**
	 * Whether the tab has changes that haven't been saved: regions and areas added, deleted or moved, or
	 * changes to the region or area open or to the areas left with changes
	 */
	readonly changes: ReturnType<typeof combineChanges>;

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
	 * Whether the Add Area and Add Region dialogs have been filled in
	 */
	private readonly addChanges = new ChangeTracker({
		root: this.addForm,
		state: () => [this.addParent.value]
	});
	private readonly regionChanges = new ChangeTracker({
		root: this.regionForm,
		state: () => [this.regionParent.value]
	});

	private universeOpen: EditableUniverse | undefined;

	/**
	 * Every region and area of the universe, its lobby region and starting square, its starting areas and
	 * its links between areas, as last loaded
	 */
	private loaded: AreaListPayload = { regions: [], areas: [], lobbyRegionId: null, lobbyAreaId: null, startingAreaId: null, startingAreaIds: [], links: [] };

	/**
	 * The universe the regions and areas, and the tiles, were last loaded for, as the editor had it open
	 */
	private areasLoadedFor: EditableUniverse | undefined;
	private tilesLoadedFor: EditableUniverse | undefined;

	/**
	 * Every tile the universe can use, as last loaded
	 */
	private savedTiles: EditorTile[] = [];

	/**
	 * Every tile the universe can use with the Tilesets tab's changes, for the default tile choice and
	 * the cell editor
	 */
	private tileList: EditorTile[] = [];

	/**
	 * The tiles the Tilesets tab will delete, with the tiles chosen to replace them in the areas
	 */
	private tilesDeleted: ReadonlyMap<number, number | undefined> = new Map();

	/**
	 * What the save being sent holds: the regions and areas deleted and added, the area open as it is
	 * saved and its settings as the form showed them, the settings of the areas left with changes, and the
	 * openVersion when the save started
	 */
	private collected: { createdIds: PlaceRef[]; area: EditorArea | undefined; shown: AreaSettings | undefined; kept: ReadonlyMap<string, KeptSettings>; version: number } = { createdIds: [], area: undefined, shown: undefined, kept: new Map(), version: -1 };

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
	 * Changes every time the tab opens a universe, a region or an area, so data that arrives for an
	 * earlier one is ignored
	 */
	private openVersion = 0;

	/**
	 * @param api The editor's API
	 * @param stagedTiles The Tilesets tab's changes, which the areas are drawn and painted with
	 * @param areaSelect The dialog for choosing an area, which chooses a neighbor
	 * @param onPlaceChanged Called with the region or area the tab opens, or undefined when it goes back to the list or opens one not yet saved
	 * @param onAreasLoaded Called each time the tab has loaded the universe's areas, which areaName() names
	 * @param onBackToLobby Called when the player leaves the lobby's area with Back to Lobby, to show the Lobby tab
	 */
	constructor(private readonly api: EditorApi, private readonly stagedTiles: StagedTiles, private readonly areaSelect: AreaSelectDialog, private readonly onPlaceChanged: (place: PlaceRef | undefined) => void, private readonly onAreasLoaded: () => void, private readonly onBackToLobby: () => void)
	{
		this.regionEditor = new RegionEditorView(api, this);
		this.list = new PlacesList((place) =>
		{
			this.open(place);
		}, (count) =>
		{
			showMessage(this.empty, ((count === 0)
				? t({
					id: 'editor.areas.none',
					defaultMessage: 'There are no areas yet.',
					description: 'Shown instead of the list of areas when the universe has none'
				})
				: undefined));
		});

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
				this.showNeighborSection();
			}
		}, (unsaved) =>
		{
			this.cellsUnsaved = unsaved;
			this.areaChanges.check();
			this.keptChanges.check();
		}, {
			grid: () => this.neighborGrid(),
			area: (areaId) => this.neighborArea(areaId),
			setBounds: (areaId, bounds) =>
			{
				this.setCarriedBounds(areaId, bounds);
			},
			open: (areaId) =>
			{
				this.open({ kind: 'area', id: areaId });
			}
		});

		this.keptChanges = new CheckedChanges(() => ((this.keptSettings.size > 0) || (this.stagedNeighbors.size > 0) || (this.carriedBounds.size > 0) || this.areaEditor.hasAnyChanges()));
		this.changes = combineChanges(this.areaChanges, this.staged, this.regionEditor.changes, this.keptChanges);

		this.areaChanges.subscribe((unsaved) =>
		{
			if (!unsaved)
			{
				this.openNotes = [];
			}
		});

		this.overallMapButton.addEventListener('click', () =>
		{
			this.openOverallMap();
		});

		this.neighborChanges.guardDialog(this.neighborDialog);

		getElement('neighbor-add-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			if (this.neighborChanges.confirmDiscard())
			{
				this.neighborDialog.close();
			}
		});

		this.neighborName.addEventListener('input', () =>
		{
			setFieldError(this.neighborName, undefined);
		});

		this.neighborForm.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			this.addNeighbor();
		});
		this.name.maxLength = MAX_AREA_NAME_LENGTH;
		this.addName.maxLength = MAX_AREA_NAME_LENGTH;
		this.regionName.maxLength = MAX_REGION_NAME_LENGTH;

		this.name.addEventListener('input', () =>
		{
			setFieldError(this.name, undefined);
		});

		for (const loop of [this.loopsEastWest, this.loopsNorthSouth])
		{
			loop.addEventListener('change', () =>
			{
				this.settingsChanged();
			});
		}

		this.deleteButton.addEventListener('click', () =>
		{
			this.toggleDelete();
		});

		getElement('area-back', HTMLButtonElement).addEventListener('click', () =>
		{
			void this.showListView();
		});

		this.backToLobbyButton.addEventListener('click', () =>
		{
			this.backToLobby();
		});

		this.staged.subscribe(() =>
		{
			if (!this.listView.hidden)
			{
				this.renderList();
			}
		});

		this.addChanges.guardDialog(this.addDialog);
		this.regionChanges.guardDialog(this.regionDialog);

		this.addButton.addEventListener('click', () =>
		{
			this.openAddDialog();
		});

		this.addRegionButton.addEventListener('click', () =>
		{
			this.openRegionDialog();
		});

		getElement('area-add-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			if (this.addChanges.confirmDiscard())
			{
				this.addDialog.close();
			}
		});

		getElement('region-add-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			if (this.regionChanges.confirmDiscard())
			{
				this.regionDialog.close();
			}
		});

		this.addName.addEventListener('input', () =>
		{
			setFieldError(this.addName, undefined);
		});

		this.regionName.addEventListener('input', () =>
		{
			setFieldError(this.regionName, undefined);
		});

		this.addForm.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.addArea();
		});

		this.regionForm.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			this.addRegion();
		});
	}

	/**
	 * Lists a universe's regions and areas, or opens one of them
	 *
	 * @param universe The universe
	 * @param place The region or area to open, or undefined for the list
	 */
	open(universe: EditableUniverse, place?: PlaceRef): void;

	/**
	 * Opens a region or area in its editor, first asking whether to discard the unsaved changes of the one
	 * shown
	 *
	 * @param place The region or area
	 */
	open(place: PlaceRef): void;

	/**
	 * Lists a universe's regions and areas, or opens one of them; or opens a region or area
	 *
	 * @param target The universe, or the region or area to open
	 * @param place The region or area to open with the universe, or undefined for the list
	 */
	open(target: EditableUniverse | PlaceRef, place?: PlaceRef): void
	{
		if ('kind' in target)
		{
			if (target.kind === 'area')
			{
				void this.openArea(target.id);
			}
			else if (this.confirmLeave())
			{
				this.showRegion(target.id);
			}

			return;
		}

		// The draft's regions and areas have IDs of their own, so the other version's changes go too
		if ((this.universeOpen?.id !== target.id) || (this.universeOpen.version !== target.version))
		{
			this.discardChanges();
		}

		this.universeOpen = target;
		this.showAddButtons();
		void this.loadPlace(place);
	}

	/**
	 * Shows Add Region and Add Area to those who may add them: creators, and builders while a region they
	 * are assigned can hold them
	 */
	private showAddButtons(): void
	{
		const universe = this.universeOpen;
		const may = ((universe !== undefined) && canEditWorldOpen(universe) && (editsEveryPlace(universe.role) || (universe.assignedRegionIds.length > 0)));

		this.addButton.hidden = !may;
		this.addRegionButton.hidden = !may;
	}

	/**
	 * Keeps up with changes to the universe made on other tabs
	 *
	 * @param universe The universe as it now is
	 */
	setUniverse(universe: EditableUniverse): void
	{
		if (this.universeOpen?.id === universe.id)
		{
			this.universeOpen = universe;
			this.showAddButtons();
		}
	}

	/**
	 * Follows the lobby moving to another region or starting square, or to none, once the Lobby tab has
	 * saved it
	 *
	 * @param lobbyRegionId The lobby region, or null for none
	 * @param lobbyAreaId The area of the lobby's starting square, or null for none
	 */
	setLobby(lobbyRegionId: string | null, lobbyAreaId: string | null): void
	{
		this.loaded = { ...this.loaded, lobbyRegionId, lobbyAreaId };
		this.renderList();

		if (this.area && this.universeOpen)
		{
			this.deleteButton.hidden = (!this.canEditPlace({ kind: 'area', id: this.area.id }) || (this.area.id === lobbyAreaId) || (this.area.id === this.loaded.startingAreaId));
			this.settingsChanged();
		}

		this.regionEditor.refresh();
	}

	/**
	 * The lobby region, as last saved
	 *
	 * @return Its ID, or null for none
	 */
	lobbyRegionId(): string | null
	{
		return(this.loaded.lobbyRegionId);
	}

	/**
	 * Leaves the region or area editor for the list, and shows the Lobby tab: the region editor's changes
	 * already confirmed thrown away, and the area editor's kept
	 */
	backToLobby(): void
	{
		void this.showListView();
		this.onBackToLobby();
	}

	/**
	 * Says in the area editor whether the area shown is below the lobby region, whose passage of time is
	 * set on the Lobby tab instead, and offers to go back to the Lobby tab
	 *
	 * @param isLobby Whether it is
	 */
	private showLobby(isLobby: boolean): void
	{
		this.lobbyNotice.hidden = !isLobby;
		this.backToLobbyButton.hidden = !isLobby;
		this.settings.hideTime(isLobby);
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
		return(this.loaded.areas.find((area) => (area.id === areaId))?.name);
	}

	/**
	 * Whether the region or area editor may be left: asks first while the region editor has unsaved
	 * changes. The area editor's are kept
	 *
	 * @return False when the player kept the changes
	 */
	private confirmLeave(): boolean
	{
		return(this.regionEditor.confirmLeave());
	}

	/**
	 * Opens an area in the area editor, first asking whether to discard the unsaved changes of the region
	 * it shows, and keeping those of the area it shows. An area opened from the area editor keeps the
	 * page where it was, and the area editor's view and tools
	 *
	 * @param areaId The area's ID
	 */
	async openArea(areaId: string): Promise<void>
	{
		if (!this.confirmLeave())
		{
			return;
		}

		const fromArea = (this.area !== undefined);
		const opener = document.activeElement;
		const fromCells = this.areaEditor.element.contains(opener);
		// What the player was looking at stays put in the window: the cells, or the top of the editor
		const anchor = (fromCells ? this.areaEditor.element : this.editorView);
		const anchorTop = anchor.getBoundingClientRect().top;

		await this.loadArea(areaId, fromArea);

		if (this.area?.id !== areaId)
		{
			return;
		}

		// The row that opened it is hidden, so focus moves to the editor
		if (!fromArea)
		{
			this.editorView.scrollIntoView({ block: 'start' });
			this.name.focus({ preventScroll: true });
			return;
		}

		scrollBackTo(anchor, anchorTop);

		// Focus stays where it was, unless what had it was hidden or replaced while the area opened
		const focused = document.activeElement;

		if ((focused !== null) && (focused !== document.body))
		{
			return;
		}

		if ((opener instanceof HTMLElement) && opener.isConnected && opener.checkVisibility())
		{
			opener.focus({ preventScroll: true });
		}
		else if (fromCells)
		{
			this.areaEditor.focusCells();
		}
		else
		{
			this.name.focus({ preventScroll: true });
		}
	}

	/**
	 * Opens a region in the region editor, first asking whether to discard the unsaved changes of the
	 * region it shows, and keeping those of the area the area editor shows
	 *
	 * @param regionId The region's ID
	 */
	async openRegion(regionId: string): Promise<void>
	{
		if (!this.confirmLeave())
		{
			return;
		}

		await this.loadRegion(regionId);
	}

	/**
	 * Opens a region or area, or the list for none, that the page's history went back or forward to, first
	 * asking whether to discard the unsaved changes of the region the editor shows, and keeping those of
	 * the area
	 *
	 * @param place The region or area, or undefined for the list
	 * @return False when the player kept the changes, leaving the tab as it was
	 */
	showPlace(place: PlaceRef | undefined): boolean
	{
		if (!this.confirmLeave())
		{
			return(false);
		}

		void this.loadPlace(place);

		return(true);
	}

	/**
	 * Opens a region or area, or the list for none, discarding any unsaved changes of the region the tab
	 * shows, and keeping those of the area
	 *
	 * @param place The region or area, or undefined for the list
	 */
	private async loadPlace(place: PlaceRef | undefined): Promise<void>
	{
		if (place === undefined)
		{
			await this.showListView();
		}
		else if (place.kind === 'area')
		{
			await this.loadArea(place.id, false);
		}
		else
		{
			await this.loadRegion(place.id);
		}
	}

	/**
	 * Opens a region in the region editor, discarding any unsaved changes of the region the tab shows and
	 * keeping those of the area, once the regions have loaded, as they haven't when the page opens at a
	 * region
	 *
	 * @param regionId The region's ID
	 */
	private async loadRegion(regionId: string): Promise<void>
	{
		const universe = this.universeOpen;

		if (!universe)
		{
			return;
		}

		// The region editor goes back to the list for a region it can't find, as for a role that can't load them
		if (!canEditWorld(universe.role) || (this.areasLoadedFor === universe))
		{
			this.showRegion(regionId);
			return;
		}

		const version = ++this.openVersion;

		this.hideAreaEditor();
		this.regionEditor.hide();
		this.listView.hidden = true;

		try
		{
			await Promise.all([
				this.loadAreas(universe),
				this.loadTiles(universe)
			]);
		}
		catch
		{
			// The list loads them again, saying why when it can't
			if (version === this.openVersion)
			{
				await this.showListView();
			}

			return;
		}

		if (version === this.openVersion)
		{
			this.showRegion(regionId);
		}
	}

	/**
	 * Opens a region in the region editor and moves focus to it, its changes being thrown away already
	 *
	 * @param regionId The region's ID
	 */
	private showRegion(regionId: string): void
	{
		const universe = this.universeOpen;

		if (!universe)
		{
			return;
		}

		const region: PlaceRef = { kind: 'region', id: regionId };

		++this.openVersion;
		this.hideAreaEditor();
		// A new region has no address until it is saved
		this.onPlaceChanged((isNewPlace(region) ? undefined : region));
		this.listView.hidden = true;
		this.regionEditor.show(universe, regionId);
		this.regionEditor.focus();
	}

	/**
	 * Hides the area editor, keeping the area's unsaved changes until the tab is saved
	 *
	 * @param carryTo The area being opened in its place, which takes over its view, or undefined for none
	 */
	private hideAreaEditor(carryTo?: string): void
	{
		const area = this.area;

		this.keepArea();
		this.area = undefined;
		this.areaLoaded = undefined;
		this.openedSettings = undefined;
		this.openNotes = [];
		this.areaEditor.hide(carryTo);

		// A new area deleted while it was open takes its painting with it
		if (area && isNewAreaId(area.id) && !this.staged.get(area.id))
		{
			this.areaEditor.forget(area.id);
		}

		this.areaChanges.markSaved();
		this.changedSince.hide();
		this.editorView.hidden = true;
		showMessage(this.claimLine, undefined);
		this.shownClaim = [];
		this.keptChanges.check();
	}

	/**
	 * Keeps the settings changed in the area open as the area editor leaves it, with what saves in other
	 * windows changed in it meanwhile, until the tab is saved. A new area takes them as its settings
	 */
	private keepArea(): void
	{
		const area = this.area;
		const opened = this.openedSettings;

		// A new area deleted since it opened took its changes with it
		if (!area || !opened || (isNewAreaId(area.id) && !this.staged.get(area.id)))
		{
			return;
		}

		const shown = this.shownSettings();
		const changes = changedSettings(shown, opened);

		if (Object.keys(changes).length > 0)
		{
			if (isNewAreaId(area.id))
			{
				this.staged.setNewSettings(area.id, shown);
			}
			else
			{
				this.keptSettings.set(area.id, {
					loaded: (this.areaLoaded ?? area),
					changes
				});
			}
		}

		if ((this.openNotes.length > 0) && this.areaChanges.hasUnsavedChanges())
		{
			this.keptNotes.set(area.id, this.openNotes);
		}
	}

	/**
	 * Throws away every change on the tab, for when another universe or version opens
	 */
	private discardChanges(): void
	{
		this.staged.clear();
		this.keptSettings.clear();
		this.keptNotes.clear();
		this.stagedNeighbors.clear();
		this.carriedBounds.clear();
		this.area = undefined;
		this.areaEditor.discard();
		this.keptChanges.check();
	}

	/**
	 * Throws away the changes kept for an area that is gone: one added since the tab was saved and then
	 * deleted, or one a save deleted. The areas whose kept parents name it take its parents in its place,
	 * as the server gives the areas inside a deleted area. Neighbors naming it are left out when saving
	 *
	 * @param areaId The area's ID
	 * @param parents Its parents
	 */
	private forgetArea(areaId: string, parents: readonly PlaceRef[]): void
	{
		const place: PlaceRef = { kind: 'area', id: areaId };

		this.areaEditor.forget(areaId);
		this.keptSettings.delete(areaId);
		this.keptNotes.delete(areaId);
		this.carriedBounds.delete(areaId);
		this.stagedNeighbors.delete(areaId);

		for (const [keptId, kept] of this.keptSettings)
		{
			if (kept.changes.parents)
			{
				this.keptSettings.set(keptId, { ...kept, changes: { ...kept.changes, parents: withoutParent(kept.changes.parents, place, parents) } });
			}
		}

		this.keptChanges.check();
	}

	/**
	 * Opens an area in the area editor, keeping any unsaved changes of the area it shows and discarding
	 * those of the region
	 *
	 * @param areaId The area's ID
	 * @param fromArea Whether the area editor's view and tools carry over from the area it shows
	 * @return Once the area's cells show
	 */
	private async loadArea(areaId: string, fromArea: boolean): Promise<void>
	{
		const universe = this.universeOpen;

		if (!universe)
		{
			return;
		}

		// A role that can't load areas gets the empty list instead
		if (!canEditWorld(universe.role))
		{
			await this.showListView();
			return;
		}

		const version = ++this.openVersion;

		this.hideAreaEditor((fromArea ? areaId : undefined));
		this.regionEditor.hide();
		// A new area has no address until it is saved
		this.onPlaceChanged((isNewAreaId(areaId) ? undefined : { kind: 'area', id: areaId }));
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
				// Full page carried over from the area left would cover the error
				this.areaEditor.hide();
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
			await this.showArea(universe, area);
		}
	}

	/**
	 * Shows the list of regions and areas, loading them when a save may have changed them since they
	 * last loaded
	 */
	showList(): void
	{
		void this.showListView();
	}

	/**
	 * Shows the list of regions and areas, loading them afresh
	 */
	private async showListView(): Promise<void>
	{
		const universe = this.universeOpen;
		const version = ++this.openVersion;

		this.hideAreaEditor();
		this.regionEditor.hide();
		this.onPlaceChanged(undefined);
		this.listView.hidden = false;
		this.showClaim();

		// Only roles that change the world may load the areas (see shared/src/editor.ts)
		if (!universe || !canEditWorld(universe.role))
		{
			this.list.clear();
			return;
		}

		try
		{
			await Promise.all([
				this.loadAreas(universe),
				this.loadTiles(universe)
			]);
		}
		catch (error)
		{
			if (version === this.openVersion)
			{
				this.list.clear();
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
	 * Shows the list of regions and areas as last loaded, with the tab's changes
	 */
	private renderList(): void
	{
		const lobby = this.lobbyPlaceKeys();
		const listed: ListedPlace[] = [
			...this.regions().map((region): ListedPlace => ({
				place: { kind: 'region', id: region.id },
				name: region.name,
				parents: region.parents,
				tags: this.tagsOf({ kind: 'region', id: region.id }, true, lobby),
				deleted: this.staged.isPlaceDeleted({ kind: 'region', id: region.id }),
				lobby: (region.id === this.loaded.lobbyRegionId)
			})),
			...this.areas().map((area): ListedPlace => ({
				place: { kind: 'area', id: area.id },
				name: area.name,
				parents: area.parents,
				tags: this.tagsOf({ kind: 'area', id: area.id }, area.resolved.enabled, lobby),
				deleted: this.staged.isDeleted(area.id)
			}))
		];

		this.list.show(listed);
	}

	/**
	 * The lobby region and the lobby areas below it, as the tab's changes leave them, which the list tags
	 * "lobby"
	 *
	 * @return Their keys (placeKey())
	 */
	private lobbyPlaceKeys(): Set<string>
	{
		const world = this.world();
		const regionId = world.lobbyRegionId;

		if (regionId === null)
		{
			return(new Set());
		}

		return(new Set([
			placeKey({ kind: 'region', id: regionId }),
			...[...lobbyAreaIds(new PlaceGraph(world.regions, world.areas), regionId)].map((id) => placeKey({ kind: 'area', id }))
		]));
	}

	/**
	 * What the list says of a region or area
	 *
	 * @param place The region or area
	 * @param enabled Whether it is enabled, as last saved for an area
	 * @param lobby The lobby region and lobby areas (lobbyPlaceKeys())
	 * @return The tags
	 */
	private tagsOf(place: PlaceRef, enabled: boolean, lobby: ReadonlySet<string>): string[]
	{
		const node = ((place.kind === 'region') ? this.regions().find((region) => (region.id === place.id)) : undefined);

		return([
			(lobby.has(placeKey(place))
				? t({
					id: 'editor.areas.lobbyTag',
					defaultMessage: 'lobby',
					description: 'Under a region or area in the list of regions and areas, for the lobby region and the areas below it, which players walk in the universe\'s lobby'
				})
				: undefined),
			((place.id === this.loaded.startingAreaId)
				? t({
					id: 'editor.areas.startingAreaTag',
					defaultMessage: 'starting area',
					description: 'Under an area in the list of areas, for the area new characters start in'
				})
				: undefined),
			((!enabled || (node?.enabled === false)) ? t(editorMessages.disabledTag) : undefined),
			(isNewPlace(place) ? stagedTag('new', false) : undefined),
			(((place.kind === 'area') && !isNewPlace(place) && this.hasKeptChanges(place.id))
				? t({
					id: 'editor.areas.unsavedTag',
					defaultMessage: 'unsaved changes',
					description: 'Under an area in the list of regions and areas, for one changed in the area editor that was left before the changes were saved. The editor\'s Save button saves them'
				})
				: undefined),
			((place.kind === 'area') && this.claims.has(place.id) ? claimTag(this.claims.get(place.id) ?? []) : undefined)
		].filter((tag) => (tag !== undefined)));
	}

	/**
	 * Whether an area other than the one open has changes not yet saved: settings, painting, size, links
	 * or neighbors
	 *
	 * @param areaId The area's ID
	 * @return True when it has
	 */
	private hasKeptChanges(areaId: string): boolean
	{
		return(this.keptSettings.has(areaId) || this.areaEditor.changedAreaIds().has(areaId) || this.stagedNeighbors.has(areaId) || this.carriedBounds.has(areaId));
	}

	/**
	 * Loads every region and area of the universe, sharing the load with the other tabs (see
	 * EditorApi.sendShared())
	 *
	 * @param universe The universe
	 */
	private async loadAreas(universe: EditableUniverse): Promise<void>
	{
		this.loaded = await this.api.listAreas(universe.id);
		this.areasLoadedFor = universe;
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
		this.tilesLoadedFor = universe;
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

		this.tileList = tiles;
		this.tilesDeleted = deleted;
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
			this.settingsChanged();
			void this.areaEditor.setTiles(this.tileList, this.tilesDeleted, this.isIndoors());
		}

		this.regionEditor.refresh();
	}

	/**
	 * Follows a save made in another window that changed regions or areas: loads the list again, and the
	 * area open when the save changed it and it has no unsaved changes here; with them, keeps them and says
	 * above the area's settings what the save changed. The areas left with changes keep them too, and say
	 * what the save changed once they open again. An area the save deleted is taken as deleted here too,
	 * and one with changes here is kept as a new area. Painting the cells of the area open and the areas
	 * left with changes is left to followPainting()
	 *
	 * @param save The save
	 * @return True when the save changed a region or area with unsaved changes here: the one open, one left
	 * with changes, or one being deleted when the tab is saved
	 */
	otherSaved(save: OtherSave): boolean
	{
		const universe = this.universeOpen;
		const changed = save.details.filter((detail) => AREA_SUBJECTS.has(detail.subject));

		if (!universe || (changed.length === 0))
		{
			return(false);
		}

		const deletedOf = (subject: AuditSubject): Set<string> => new Set(changed.flatMap((detail) => (((detail.subject === subject) && (detail.action === 'deleted') && (typeof detail.id === 'string')) ? [detail.id] : [])));
		const deletedAreaIds = deletedOf('area');
		const deletedRegionIds = deletedOf('region');
		const keptChanged = this.followKeptAreas(save.name, changed, deletedAreaIds);

		for (const areaId of deletedAreaIds)
		{
			this.staged.markDeleted(areaId, (this.loaded.areas.find((area) => (area.id === areaId))?.parents ?? []));
		}

		for (const regionId of deletedRegionIds)
		{
			this.staged.markPlaceDeleted({ kind: 'region', id: regionId });
		}

		const deletedHere = (keptChanged || changed.some((detail) => ((typeof detail.id === 'string') && (this.staged.isDeleted(detail.id) || this.staged.isPlaceDeleted({ kind: 'region', id: detail.id })))));
		const regionChanged = this.regionEditor.otherSaved(save, changed);

		if (regionChanged)
		{
			return(true);
		}

		const open = this.area;
		const aboutOpen = changed.filter((detail) => ((open !== undefined) && (detail.id === open.id)));

		if (open === undefined)
		{
			if (!this.listView.hidden)
			{
				void this.showListView();
			}
			else
			{
				void this.loadAreas(universe)
					.then(() =>
					{
						this.regionEditor.reshow();
					})
					.catch(() =>
					{
						// The regions and areas stay as they were last loaded
					});
			}

			return(deletedHere);
		}

		// Painting is taken into the area's cells as they are by followPainting()
		const rest = aboutOpen.filter((detail) => !isFollowedPainting(detail));

		if (rest.length === 0)
		{
			void this.loadAreas(universe)
				.then(() =>
				{
					this.settingsChanged();
				})
				.catch(() =>
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
			this.openNotes.push({ name: save.name, details: rest });

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

		void (aboutOpen.some((detail) => ((detail.subject === 'area') && (detail.action === 'deleted'))) ? this.showListView() : this.refreshArea(open.id, save.name, rest));

		return(deletedHere);
	}

	/**
	 * Follows what a save in another window changed in the saved areas left with changes: notes it, to say
	 * above an area's settings when it opens again, and keeps an area it deleted as a new area. Changes to
	 * an area's neighbors or a size carried to it go with an area it deleted. Call it before the areas
	 * are taken as deleted, while the tab still has their parents
	 *
	 * @param name Who saved
	 * @param changed What the save changed in regions and areas
	 * @param deletedAreaIds The areas it deleted
	 * @return True when it changed an area left with changes
	 */
	private followKeptAreas(name: string, changed: readonly SavedEditDetail[], deletedAreaIds: ReadonlySet<string>): boolean
	{
		const withWork = new Set([...this.keptSettings.keys(), ...this.areaEditor.changedAreaIds()]);
		const open = this.area?.id;
		let followed = false;

		for (const areaId of withWork)
		{
			const details = changed.filter((detail) => ((detail.id === areaId) && !isFollowedPainting(detail)));

			if ((areaId === open) || isNewAreaId(areaId) || (details.length === 0))
			{
				continue;
			}

			followed = true;
			this.keptNotes.set(areaId, [...(this.keptNotes.get(areaId) ?? []), { name, details }]);

			// An area with only links changed loses them; one with settings, painting or a size changed is kept
			if (deletedAreaIds.has(areaId) && (this.keptSettings.has(areaId) || (this.areaEditor.keptBounds(areaId) !== undefined)))
			{
				this.recreateKeptArea(areaId, deletedAreaIds);
			}
			else if (deletedAreaIds.has(areaId))
			{
				this.forgetArea(areaId, (this.loaded.areas.find((area) => (area.id === areaId))?.parents ?? []));
			}
		}

		for (const areaId of deletedAreaIds)
		{
			if ((areaId !== open) && (this.stagedNeighbors.has(areaId) || this.carriedBounds.has(areaId)) && !withWork.has(areaId))
			{
				this.forgetArea(areaId, (this.loaded.areas.find((area) => (area.id === areaId))?.parents ?? []));
			}
		}

		return(followed);
	}

	/**
	 * Whether a region or area a recreated area names as a parent is still there: not the area itself, and
	 * not one a save in another window deleted
	 *
	 * @param areaId The recreated area's ID
	 * @param deletedAreaIds The areas the save deleted
	 * @return Whether a parent is still there
	 */
	private parentExists(areaId: string, deletedAreaIds: ReadonlySet<string>): (parent: PlaceRef) => boolean
	{
		return((parent) => ((parent.kind === 'region') ? this.regions().some((region) => (region.id === parent.id)) : this.areas().some((other) => ((other.id === parent.id) && (other.id !== areaId) && !deletedAreaIds.has(other.id)))));
	}

	/**
	 * Keeps the area open, which a save in another window deleted while it had unsaved changes here, as a
	 * new area with the settings it was loaded with and its cells as they show here (AreaEditor.recreate()),
	 * so saving adds it again with the changes made to it, and deleting it discards them. Parents the save
	 * deleted are left out, as the server leaves them out of the areas inside them
	 *
	 * @param area The area, as it was loaded
	 * @param deletedAreaIds The areas the save deleted
	 */
	private recreateOpenArea(area: EditorArea, deletedAreaIds: ReadonlySet<string>): void
	{
		const exists = this.parentExists(area.id, deletedAreaIds);
		const settings = settingsOf(area);
		const added = this.staged.create({
			...settings,
			parents: settings.parents.filter(exists)
		});

		this.parents.set(this.parents.value.filter(exists), this.names(), this.parentChoices({ kind: 'area', id: added.id }, 'area', this.areaOverride()));
		this.areaEditor.recreate(area.id, added.id, added.bounds);
		this.area = { ...area, id: added.id };
		// A new area has no address until it is saved
		this.onPlaceChanged(undefined);
		this.showClaim();
	}

	/**
	 * Keeps an area left with changes, which a save in another window deleted, as a new area with its
	 * settings as they were left and its cells as they show here (AreaEditor.recreate()), as the area open
	 * is kept (recreateOpenArea())
	 *
	 * @param areaId The area's ID
	 * @param deletedAreaIds The areas the save deleted
	 */
	private recreateKeptArea(areaId: string, deletedAreaIds: ReadonlySet<string>): void
	{
		const kept = this.keptSettings.get(areaId);
		const area = (kept?.loaded ?? this.loaded.areas.find((each) => (each.id === areaId)));

		if (!area)
		{
			this.forgetArea(areaId, []);
			return;
		}

		const settings = { ...settingsOf(area), ...kept?.changes };
		const added = this.staged.create({
			...settings,
			name: settings.name.trim(),
			parents: settings.parents.filter(this.parentExists(areaId, deletedAreaIds))
		});

		this.areaEditor.recreate(areaId, added.id, added.bounds);
		this.keptSettings.delete(areaId);
		this.keptNotes.set(added.id, (this.keptNotes.get(areaId) ?? []));
		this.keptNotes.delete(areaId);
		this.carriedBounds.delete(areaId);
		this.stagedNeighbors.delete(areaId);
		this.keptChanges.check();
	}

	/**
	 * Takes the painting a save made in another window to the open area, and to the areas left with
	 * changes, into their cells, unsaved changes or not, marking the cells it changed
	 * (AreaEditor.followPainting()). Call it after otherSaved()
	 *
	 * @param save The save
	 * @return How many of the cells it changed had been painted here while the areas were open, and what
	 * takes its marks off them
	 */
	async followPainting(save: OtherSave): Promise<FollowedPainting>
	{
		const followed = await Promise.all(save.details
			.filter((detail) => (isFollowedPainting(detail) && (typeof detail.id === 'string')))
			.map((detail) => this.areaEditor.followPainting(String(detail.id), (detail.chunks ?? []), save.name)));

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
			this.showChildren(this.area.id);
		}

		this.regionEditor.refresh();
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
		const universe = this.universeOpen;
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
				await this.loadArea(areaId, true);
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
		void this.showArea(universe, area);
	}

	/**
	 * Loads the tiles afresh after a save that may have changed them, and shows them
	 */
	async reloadTiles(): Promise<void>
	{
		const universe = this.universeOpen;
		const version = this.openVersion;

		if (!universe)
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
		if (!this.universeOpen)
		{
			throw new Error('The Areas tab has no universe open');
		}

		return(this.universeOpen.id);
	}

	/**
	 * The universe the tab shows
	 *
	 * @return The universe, or undefined while none has opened
	 */
	universe(): EditableUniverse | undefined
	{
		return(this.universeOpen);
	}

	/**
	 * Every region of the universe as last loaded, then the regions added since the tab was last saved,
	 * with the parents the tab's changes give them
	 *
	 * @return The regions, including those that will be deleted
	 */
	regions(): EditorRegion[]
	{
		return([...this.loaded.regions, ...this.staged.newRegions()].map((region) => ({
			...region,
			parents: [...(this.staged.movedParents({ kind: 'region', id: region.id }) ?? region.parents)]
		})));
	}

	/**
	 * Every area of the universe as last loaded, then the areas added since the tab was last saved, with
	 * the parents the tab's changes give them and the settings changed in the areas left with changes
	 *
	 * @return The areas, including those that will be deleted
	 */
	areas(): EditorAreaSummary[]
	{
		return([...this.loaded.areas, ...this.staged.newAreas()].map((area) =>
		{
			const changes = this.keptSettings.get(area.id)?.changes;

			return({
				...area,
				...changes,
				parents: [...(changes?.parents ?? this.staged.movedParents({ kind: 'area', id: area.id }) ?? area.parents)]
			});
		}));
	}

	/**
	 * The tiles the universe can use, with the Tilesets tab's changes
	 *
	 * @return The tiles
	 */
	tiles(): readonly EditorTile[]
	{
		return(this.tileList);
	}

	/**
	 * The tiles the Tilesets tab will delete
	 *
	 * @return Their IDs
	 */
	deletedTiles(): ReadonlySet<number>
	{
		return(new Set(this.tilesDeleted.keys()));
	}

	/**
	 * Names regions and areas
	 *
	 * @return The namer
	 */
	names(): PlaceNames
	{
		return(placeNamer([
			...this.regions().map((region) => ({ kind: 'region' as const, id: region.id, name: region.name })),
			...this.areas().map((area) => ({ kind: 'area' as const, id: area.id, name: area.name }))
		]));
	}

	/**
	 * The regions and areas as the tab's changes leave them, with the region or area open as its editor
	 * shows it, the kinds of the tiles as the Tilesets tab's changes leave them, and the lobby's area. The
	 * places that will be deleted are left out, an area's taking its place in the parents of the areas
	 * inside it, as the server does
	 *
	 * @param override The region or area open, as its editor shows it
	 * @return The world
	 */
	world(override?: PlaceOverride): PlaceWorld
	{
		const paint = (kind: PlaceKind, settings: PlaceNode): PlaceSettings => ({ ...settings, defaultTileId: this.defaultTileFor({ kind, id: settings.id }, settings.defaultTileId) });
		let regions: PlaceNode[] = this.regions().map(({ builderIds: _builderIds, ...region }) => ({ ...region, ...paint('region', region) }));
		let areas: AreaNode[] = this.areas().map(({ resolved: _resolved, ...area }) => ({ ...area, ...paint('area', area) }));

		if (override)
		{
			if (override.place.kind === 'region')
			{
				regions = regions.map((region) => ((region.id === override.place.id) ? { ...override.node, ...paint('region', override.node) } : region));
			}
			else
			{
				areas = areas.map((area) => ((area.id === override.place.id) ? { ...(override.node as AreaNode), ...paint('area', override.node) } : area));
			}
		}

		// The deleted places go, those inside a deleted area taking its parents
		const deletedAreas = new Map(areas
			.filter((area) => this.staged.isDeleted(area.id))
			.map((area) => [area.id, area.parents]));
		const replace = (parents: readonly PlaceRef[], seen: Set<string>): PlaceRef[] => parents.flatMap((parent) =>
		{
			if (this.staged.isPlaceDeleted(parent))
			{
				if ((parent.kind === 'area') && !seen.has(parent.id))
				{
					seen.add(parent.id);
					return(replace((deletedAreas.get(parent.id) ?? []), seen));
				}

				return([]);
			}

			return([parent]);
		});
		const unique = (parents: PlaceRef[]): PlaceRef[] => parents.filter((parent, index) => (parents.findIndex((each) => samePlace(each, parent)) === index));

		regions = regions
			.filter((region) => !this.staged.isPlaceDeleted({ kind: 'region', id: region.id }))
			.map((region) => ({ ...region, parents: unique(replace(region.parents, new Set())) }));
		areas = areas
			.filter((area) => !this.staged.isDeleted(area.id))
			.map((area) => ({ ...area, parents: unique(replace(area.parents, new Set())) }));

		const tileKinds = new Map<number, TileUsedFor>(this.tileList
			.filter((tile) => !this.tilesDeleted.has(tile.id))
			.map((tile) => [tile.id, { indoors: tile.indoors, outdoors: tile.outdoors }]));

		return({ regions, areas, tileKinds, lobbyRegionId: this.loaded.lobbyRegionId });
	}

	/**
	 * Every link between areas, as saved with the area editor's changes not yet saved
	 *
	 * @return The links' areas and the areas they lead to
	 */
	links(): AreaLinkPair[]
	{
		const targets = new Map<string, AreaLinkPair | null>();
		const keyOf = (link: { areaId: string; column: number; row: number }): string => `${link.areaId},${link.column},${link.row}`;

		for (const link of this.loaded.links)
		{
			targets.set(keyOf(link), { areaId: link.areaId, targetAreaId: link.targetAreaId });
		}

		for (const change of this.areaEditor.stagedLinkChanges())
		{
			targets.set(keyOf(change), ((change.target === null) ? null : { areaId: change.areaId, targetAreaId: change.target.targetAreaId }));
		}

		return([...targets.values()].filter((link) => (link !== null)));
	}

	/**
	 * The universe's areas as the grid of neighbors sees them, with the tab's changes: the area open at its
	 * size and loops as its editor shows them, the areas left with changes at their sizes, the neighbors
	 * the area editor changed, the sizes its resizes carried other areas to, and without the areas that
	 * will be deleted
	 *
	 * @return The areas, by ID
	 */
	private neighborGrid(): Map<string, GridArea>
	{
		const open = this.area;
		const areas = this.areas().filter((area) => !this.staged.isDeleted(area.id));
		const kept = new Set(areas.map((area) => area.id));
		const grid = new Map<string, GridArea>();

		for (const area of areas)
		{
			const isOpen = (area.id === open?.id);
			const neighbors = (this.stagedNeighbors.get(area.id) ?? area.neighbors);

			grid.set(area.id, {
				id: area.id,
				bounds: ((isOpen && open) ? open.bounds : (this.areaEditor.keptBounds(area.id) ?? this.carriedBounds.get(area.id) ?? area.bounds)),
				neighbors: {
					north: (((neighbors.north !== null) && kept.has(neighbors.north)) ? neighbors.north : null),
					east: (((neighbors.east !== null) && kept.has(neighbors.east)) ? neighbors.east : null),
					south: (((neighbors.south !== null) && kept.has(neighbors.south)) ? neighbors.south : null),
					west: (((neighbors.west !== null) && kept.has(neighbors.west)) ? neighbors.west : null)
				},
				loopsEastWest: (isOpen ? this.loopsEastWest.checked : area.loopsEastWest),
				loopsNorthSouth: (isOpen ? this.loopsNorthSouth.checked : area.loopsNorthSouth)
			});
		}

		return(grid);
	}

	/**
	 * The areas that are neighbors, as the tab's changes leave them, for keeping the lobby areas apart
	 *
	 * @return Each pair once
	 */
	private neighborPairs(): AreaLinkPair[]
	{
		return(neighborPairs(this.neighborGrid()));
	}

	/**
	 * An area as the area editor shows it beside the area open: with the tab's changes, its size as a
	 * resize carried it, and its settings worked out
	 *
	 * @param areaId The area's ID
	 * @return The area, or undefined for one the tab doesn't have
	 */
	private neighborArea(areaId: string): EditorArea | undefined
	{
		const area = this.areas().find((each) => (each.id === areaId));
		const gridArea = this.neighborGrid().get(areaId);

		return(area && {
			...area,
			bounds: (gridArea?.bounds ?? area.bounds),
			neighbors: (gridArea?.neighbors ?? area.neighbors),
			resolved: this.resolvedOf(area)
		});
	}

	/**
	 * Gives an area the area open carries along in a resize its new bounds: an area left with changes takes
	 * them as its size, a saved one keeps them until the tab is saved, and a new one takes them for good
	 *
	 * @param areaId The area's ID
	 * @param bounds Its bounds
	 */
	private setCarriedBounds(areaId: string, bounds: AreaBounds): void
	{
		const saved = this.loaded.areas.find((area) => (area.id === areaId));
		const kept = this.areaEditor.carry(areaId, bounds);

		if (!kept && isNewAreaId(areaId))
		{
			this.staged.setNewBounds(areaId, bounds);
		}
		else if (!kept && saved && sameBoundsAs(saved.bounds, bounds))
		{
			this.carriedBounds.delete(areaId);
		}
		else if (!kept)
		{
			this.carriedBounds.set(areaId, bounds);
		}

		this.keptChanges.check();
		this.areaEditor.showNeighbors();
		this.showNeighborSection();
	}

	/**
	 * Stages the neighbors a change to the grid leaves: every area whose neighbors differ from those saved
	 *
	 * @param grid The areas after the change
	 */
	private stageGrid(grid: ReadonlyMap<string, GridArea>): void
	{
		for (const [areaId, area] of grid)
		{
			const saved = (this.areas().find((each) => (each.id === areaId))?.neighbors ?? NO_NEIGHBORS);

			if (NEIGHBOR_SIDES.every((side) => (saved[side] === area.neighbors[side])))
			{
				this.stagedNeighbors.delete(areaId);
			}
			else
			{
				this.stagedNeighbors.set(areaId, { ...area.neighbors });
			}
		}

		this.keptChanges.check();
		this.settingsChanged();
		this.areaEditor.showNeighbors();
	}

	/**
	 * Lists the area open's neighbors, each with Choose and Remove beside it for those who may change them,
	 * then a row for adding a neighbor on a side without one: the side, Choose and Add Neighbor. An area
	 * with none says None to those who can't add one, and one too small to have neighbors says why instead
	 */
	private showNeighborSection(): void
	{
		const area = this.area;

		if (!area)
		{
			return;
		}

		const grid = this.neighborGrid();
		const own = grid.get(area.id);
		const neighbors = (own?.neighbors ?? NO_NEIGHBORS);
		const editable = (this.canEditPlace({ kind: 'area', id: area.id }) && !this.staged.isDeleted(area.id));
		const bigEnough = canHaveNeighbors(own?.bounds ?? area.bounds);
		const freeSides = NEIGHBOR_SIDES.filter((side) => (neighbors[side] === null));
		const items = NEIGHBOR_SIDES.flatMap((side) =>
		{
			const neighborId = neighbors[side];

			return(((neighborId === null) ? [] : [this.neighborItem(area.id, side, neighborId, editable, bigEnough)]));
		});

		showMessage(this.neighborsHint, (bigEnough
			? undefined
			: t({
				id: 'editor.area.neighborsTooSmall',
				defaultMessage: 'An area must be at least {cells, number} cells each way to have neighbors. Make it larger with Edit Size first.',
				description: 'In the area editor\'s Neighbors section, for an area too small to have neighboring areas (walked across without links), in place of the sides and their buttons; {cells} is the fewest cells along each side'
			}, {
				cells: MIN_NEIGHBOR_AREA_SIDE
			})));
		this.overallMapButton.hidden = !hasNeighbors(neighbors);

		if (editable && bigEnough && (freeSides.length > 0))
		{
			items.push(this.neighborAddItem(freeSides));
		}
		else if (bigEnough && (items.length === 0))
		{
			const none = document.createElement('li');

			none.textContent = t({
				id: 'editor.area.noNeighbor',
				defaultMessage: 'None',
				description: 'In the area editor\'s Neighbors section, for an area with no neighboring areas, shown to those who can\'t add one'
			});
			items.push(none);
		}

		this.neighborList.hidden = (items.length === 0);
		this.neighborList.replaceChildren(...items);
	}

	/**
	 * The Neighbors section's row for a neighbor: its side, its name, which opens its editor, and Choose and
	 * Remove for those who may change it
	 *
	 * @param areaId The area open
	 * @param side The side the neighbor is on
	 * @param neighborId The neighbor
	 * @param editable Whether the area open can be changed
	 * @param bigEnough Whether the area open is large enough to have neighbors
	 * @return The row
	 */
	private neighborItem(areaId: string, side: NeighborSide, neighborId: string, editable: boolean, bigEnough: boolean): HTMLLIElement
	{
		const names = this.names();
		const item = document.createElement('li');
		const label = document.createElement('span');
		const open = document.createElement('button');

		label.className = 'area-neighbor-side';
		label.textContent = t(messages.neighborSide, {
			side
		});
		open.type = 'button';
		open.className = 'link-button';
		open.textContent = names({ kind: 'area', id: neighborId });
		open.addEventListener('click', () =>
		{
			this.open({ kind: 'area', id: neighborId });
		});
		item.append(label, open);

		if (editable && bigEnough)
		{
			item.append(this.neighborButton(t(messages.chooseNeighbor), side, () =>
			{
				void this.chooseNeighbor(side);
			}));
		}

		if (editable && this.canEditPlace({ kind: 'area', id: neighborId }))
		{
			item.append(this.neighborButton(t({
				id: 'editor.area.removeNeighbor',
				defaultMessage: 'Remove',
				description: 'Button beside a neighboring area in the area editor\'s Neighbors section that makes it no longer the area\'s neighbor; neither area is deleted'
			}), side, () =>
			{
				this.stageGrid(withoutNeighbor(this.neighborGrid(), areaId, side));
				announce(t({
					id: 'editor.area.neighborRemoved',
					defaultMessage: '{area} is no longer a neighbor.',
					description: 'Read out by screen readers after Remove in the area editor\'s Neighbors section; {area} is the area that is no longer next to the area being edited'
				}, {
					area: names({ kind: 'area', id: neighborId })
				}));
			}));
		}

		return(item);
	}

	/**
	 * The Neighbors section's row for adding a neighbor: a list of the sides without one, and Choose and
	 * Add Neighbor for the side chosen there
	 *
	 * @param freeSides The sides without a neighbor
	 * @return The row
	 */
	private neighborAddItem(freeSides: readonly NeighborSide[]): HTMLLIElement
	{
		const item = document.createElement('li');
		const select = document.createElement('select');
		const chooseText = t(messages.chooseNeighbor);
		const addText = t({
			id: 'editor.area.addNeighbor',
			defaultMessage: 'Add Neighbor',
			description: 'Button in the area editor\'s Neighbors section that adds a new area on the side chosen beside it, walked across without a link, after asking for its name'
		});
		const sideChosen = (): NeighborSide => (freeSides.find((side) => (side === select.value)) ?? freeSides[0]);
		const choose = this.neighborButton(chooseText, freeSides[0], () =>
		{
			void this.chooseNeighbor(sideChosen());
		});
		const add = this.neighborButton(addText, freeSides[0], () =>
		{
			this.openAddNeighbor(sideChosen());
		});
		const label = (): void =>
		{
			this.labelNeighborButton(choose, chooseText, sideChosen());
			this.labelNeighborButton(add, addText, sideChosen());
		};

		item.className = 'area-neighbor-add';
		select.setAttribute('aria-label', t({
			id: 'editor.area.neighborAddSide',
			defaultMessage: 'Side to add a neighbor on',
			description: 'What screen readers hear for the list of sides in the area editor\'s Neighbors section, which chooses the side the Choose and Add Neighbor buttons beside it add a neighboring area on'
		}));
		setOptions(select, freeSides.map((side) => ({
			value: side,
			label: t(messages.neighborSide, {
				side
			})
		})));
		select.value = (((this.neighborAddSide !== undefined) && freeSides.includes(this.neighborAddSide)) ? this.neighborAddSide : freeSides[0]);
		select.addEventListener('change', () =>
		{
			this.neighborAddSide = sideChosen();
			label();
		});
		label();
		item.append(select, choose, add);

		return(item);
	}

	/**
	 * A button in the Neighbors section, named for screen readers with the side it is for
	 *
	 * @param text What it says
	 * @param side The side it is for
	 * @param onClick What it does
	 * @return The button
	 */
	private neighborButton(text: string, side: NeighborSide, onClick: () => void): HTMLButtonElement
	{
		const button = document.createElement('button');

		button.type = 'button';
		button.className = 'secondary';
		button.textContent = text;
		this.labelNeighborButton(button, text, side);
		button.addEventListener('click', onClick);

		return(button);
	}

	/**
	 * Names a button in the Neighbors section for screen readers with the side it is for
	 *
	 * @param button The button
	 * @param text What it says
	 * @param side The side it is for
	 */
	private labelNeighborButton(button: HTMLButtonElement, text: string, side: NeighborSide): void
	{
		button.setAttribute('aria-label', t({
			id: 'editor.area.neighborButton',
			defaultMessage: '{action} ({side, select, north {north} east {east} south {south} other {west}})',
			description: 'What screen readers hear for a button in the area editor\'s Neighbors section, such as Choose or Remove, with the side of the area it is for'
		}, {
			action: text,
			side
		}));
	}

	/**
	 * Why an area can't be the area open's neighbor on a side, in words, or undefined when it can be
	 *
	 * @param grid The areas
	 * @param areaId The area open
	 * @param side The side
	 * @param candidateId The area that would go there
	 * @return Why not, or undefined
	 */
	private neighborRefusalText(grid: NeighborGrid, areaId: string, side: NeighborSide, candidateId: string): string | undefined
	{
		const world = this.world();
		const inLobby = lobbyAreaIds(new PlaceGraph(world.regions, world.areas), world.lobbyRegionId);
		const refusal = neighborRefusal(grid, areaId, side, candidateId);
		const joins = (((refusal === undefined) || (refusal === 'grid')) ? placeNeighbors(grid, areaId, side) : new Map<NeighborSide, string>());
		let reason: string | undefined = refusal;

		if ((reason === undefined) && (inLobby.has(candidateId) !== inLobby.has(areaId)))
		{
			reason = 'lobby';
		}
		else if ((reason === undefined) && ![candidateId, ...joins.values()].every((id) => this.canEditPlace({ kind: 'area', id })))
		{
			reason = 'assignments';
		}

		if (reason === undefined)
		{
			return(undefined);
		}

		return(t({
			id: 'editor.area.neighborRefusal',
			defaultMessage: '{reason, select, itself {This area itself} tooSmall {Smaller than {cells, number} cells each way} taken {It or an area next to here already has a neighbor on that side} size {A side touching here is a different length} lobby {On the other side of the lobby\'s edge} assignments {Outside the regions you\'re assigned} other {It wouldn\'t fit the rest of the grid}}',
			description: 'Under an area in the dialog for choosing the area editor\'s neighbor on a side, when it can\'t be chosen; {reason} is why: it is the area itself, it is smaller than {cells} cells each way, a side that would join here has another neighbor, sides that would touch are of different lengths, it is across the lobby region\'s edge (the lobby is never connected to the rest of the world), it is outside the regions a builder is assigned, or joining it would break the grid of neighbors elsewhere'
		}, {
			reason,
			cells: MIN_NEIGHBOR_AREA_SIDE
		}));
	}

	/**
	 * Chooses the area open's neighbor on a side with the area selection dialog, listing every other area
	 * and why those that can't be chosen can't, and joins the one chosen to every area next to that place
	 *
	 * @param side The side
	 */
	private async chooseNeighbor(side: NeighborSide): Promise<void>
	{
		const universe = this.universeOpen;
		const area = this.area;

		if (!universe || !area)
		{
			return;
		}

		const grid = this.neighborGrid();
		const choices = [...grid.keys()]
			.filter((areaId) => (areaId !== area.id))
			.map((areaId) => this.neighborArea(areaId))
			.filter((candidate) => (candidate !== undefined))
			.map((candidate) => ({
				area: candidate,
				refusal: this.neighborRefusalText(grid, area.id, side, candidate.id)
			}));
		const chosen = await this.areaSelect.openForNeighbor(universe, choices, this.tileList, this.source, t({
			id: 'editor.area.chooseNeighborHint',
			defaultMessage: 'Choose the area to put {side, select, north {north} east {east} south {south} other {west}} of {area}. It also becomes a neighbor of the other areas next to that spot.',
			description: 'At the top of the dialog for choosing the area editor\'s neighbor on a side: {side} is the side and {area} the area being edited'
		}, {
			side,
			area: this.name.value
		}));

		// The area may have closed, or the grid changed, while the dialog was open
		if (!chosen || (this.area?.id !== area.id))
		{
			return;
		}

		const now = this.neighborGrid();

		if (neighborRefusal(now, area.id, side, chosen.id) !== undefined)
		{
			return;
		}

		this.stageGrid(withNeighbors(now, chosen.id, placeNeighbors(now, area.id, side)));
	}

	/**
	 * Opens the Add Neighbor dialog for a side of the area open
	 *
	 * @param side The side
	 */
	private openAddNeighbor(side: NeighborSide): void
	{
		const area = this.area;

		if (!area)
		{
			return;
		}

		this.addingSide = side;
		this.neighborForm.reset();
		clearFieldErrors(this.neighborForm);
		this.neighborName.maxLength = MAX_AREA_NAME_LENGTH;
		this.neighborHint.textContent = t({
			id: 'editor.neighborAdd.hint',
			defaultMessage: 'The new area goes {side, select, north {north} east {east} south {south} other {west}} of {area}. It\'s in the same regions and areas, has the same settings, and is painted with its default tile. It\'s saved with the rest of your changes.',
			description: 'In the Add Neighbor dialog of the area editor: {side} is the side of the area being edited the new area goes on, walked across without a link, and {area} the area being edited'
		}, {
			side,
			area: this.name.value
		});
		this.neighborDialog.showModal();
		this.neighborChanges.markSaved();
		this.neighborName.focus();
	}

	/**
	 * Adds the area the Add Neighbor dialog names beside the area open, to be saved with the tab: inside
	 * the same parents, with the same settings of its own, as tall as the row it joins and as wide as the
	 * column, and the neighbor of every area next to its place. The editor stays on the area open
	 */
	private addNeighbor(): void
	{
		const area = this.area;
		const side = this.addingSide;
		const name = this.neighborName.value.trim();

		if (!area || (side === undefined))
		{
			return;
		}

		if ((name === '') || DISALLOWED_TEXT_CHARACTERS.test(name))
		{
			reportFieldError(this.neighborName, t(formMessages.invalidText));
			return;
		}

		const grid = this.neighborGrid();
		const placed = newNeighbor(grid, area.id, side);

		if (typeof placed === 'string')
		{
			reportFieldError(this.neighborName, t({
				id: 'editor.neighborAdd.refused',
				defaultMessage: '{reason, select, tooSmall {This area must be at least {cells, number} cells each way to have neighbors.} taken {An area next to that spot already has a neighbor there.} size {The areas next to that spot have sides of different lengths.} other {A new area there wouldn\'t fit the rest of the grid.}}',
				description: 'Shown in the Add Neighbor dialog when no new area fits beside the area being edited on that side; {reason} is why, and {cells} the fewest cells along each side of an area with neighbors'
			}, {
				reason: placed,
				cells: MIN_NEIGHBOR_AREA_SIDE
			}));
			return;
		}

		if (![...placed.joins.values()].every((id) => this.canEditPlace({ kind: 'area', id })))
		{
			reportFieldError(this.neighborName, t({
				id: 'editor.neighborAdd.outsideAssignments',
				defaultMessage: 'An area next to that spot is outside the regions you\'re assigned. A new area can\'t be added there.',
				description: 'Shown in the Add Neighbor dialog to a builder when the new area would be the neighbor of an area outside the regions assigned to them, which they can\'t change'
			}));
			return;
		}

		const settings = this.shownSettings();
		const added = this.staged.create({
			...settings,
			name,
			loopsEastWest: false,
			loopsNorthSouth: false
		}, placed.bounds);

		this.neighborChanges.markSaved();
		this.neighborDialog.close();
		this.stageGrid(withNeighbors(this.neighborGrid(), added.id, placed.joins));
		announce(t({
			id: 'editor.neighborAdd.added',
			defaultMessage: 'Added {area} {side, select, north {north} east {east} south {south} other {west}} of this area.',
			description: 'Read out by screen readers after the Add Neighbor dialog added a new area beside the area being edited; {area} is its name and {side} the side'
		}, {
			area: name,
			side
		}));
	}

	/**
	 * Opens See Overall Map for the grid the area open is in, with the tab's changes
	 */
	private openOverallMap(): void
	{
		const area = this.area;

		if (!area)
		{
			return;
		}

		this.overallMap.open(this.neighborGrid(), area.id, {
			area: (areaId) => ((areaId === area.id) ? { ...area, name: this.name.value, resolved: this.resolvedOf(area) } : this.neighborArea(areaId)),
			cells: (shown) => this.areaEditor.cellsOf(shown),
			tiles: () => this.tileList,
			open: (areaId) =>
			{
				this.open({ kind: 'area', id: areaId });
			}
		});
	}

	/**
	 * What would connect the lobby areas to the rest of the world, or keep the lobby from working, in a
	 * world as the tab's changes leave it (lobbyProblems()). A world without the lobby region, such as one
	 * deleting it, leaves the universe without a lobby or starting square, and so without these problems
	 *
	 * @param world The regions and areas
	 * @return The problems
	 */
	lobbyProblemsIn(world: PlaceWorld): PlaceProblem[]
	{
		const lobbyRegionId = (world.regions.some((region) => (region.id === world.lobbyRegionId)) ? world.lobbyRegionId : null);

		return(lobbyProblems(new PlaceGraph(world.regions, world.areas), {
			lobbyRegionId,
			lobbyAreaId: ((lobbyRegionId === null) ? null : this.loaded.lobbyAreaId),
			faerie: (this.universeOpen?.lobbyPassageOfTime === 'faerie')
		}, this.links(), this.loaded.startingAreaIds, this.neighborPairs()));
	}

	/**
	 * Whether the player may change a region or area: creators and the site admin role every one, and
	 * builders those within the regions assigned to them, in a version they may change
	 *
	 * @param place The region or area
	 * @return True when they may
	 */
	canEditPlace(place: PlaceRef): boolean
	{
		const universe = this.universeOpen;

		if (!universe || !canEditWorldOpen(universe))
		{
			return(false);
		}

		if (editsEveryPlace(universe.role))
		{
			return(true);
		}

		const world = this.world();
		const graph = new PlaceGraph(world.regions, world.areas);

		return(isWithinAssignments(graph, place, new Set(universe.assignedRegionIds)));
	}

	/**
	 * What a region or area can be put inside, besides its parents: the regions (and, for an area without
	 * a parent area, the areas) that don't put it inside itself or nest anything more than ten levels
	 * deep, leaving out those that will be deleted and, for a builder, those outside their assignments.
	 * Those that would carry it into the lobby while links lead from it out of the lobby, or characters
	 * start in it, are listed but can't be chosen, saying why
	 *
	 * @param place The region or area
	 * @param kind Whether it is a region or an area
	 * @param override It, as its editor shows it
	 * @return The choices, by name
	 */
	parentChoices(place: PlaceRef, kind: 'region' | 'area', override: PlaceOverride): ParentChoice[]
	{
		const world = this.world(override);
		const graph = new PlaceGraph(world.regions, world.areas);
		const names = this.names();
		const hasParentArea = override.node.parents.some((parent) => (parent.kind === 'area'));
		const candidates: PlaceRef[] = [
			...world.regions.map((region): PlaceRef => ({ kind: 'region', id: region.id })),
			...(((kind === 'area') && !hasParentArea) ? world.areas.map((area): PlaceRef => ({ kind: 'area', id: area.id })) : [])
		];
		const refusal = this.lobbyEntryRefusal(world, graph, place, override);

		return(candidates
			.filter((candidate) => (canTakeParent(graph, place, candidate) && this.canEditPlace(candidate)))
			.map((candidate) => ({
				place: candidate,
				name: names(candidate),
				detail: (formatList(graph.parentsOf(candidate).map(names), 'conjunction') || undefined),
				refusal: (((refusal !== undefined) && isInLobby(graph, candidate, world.lobbyRegionId)) ? refusal : undefined)
			}))
			.sort((first, second) => first.name.localeCompare(second.name)));
	}

	/**
	 * Why a region or area outside the lobby can't be put inside a parent in the lobby: links lead from
	 * it, or from what is below it, out of the lobby, or characters start there. Taking a parent never
	 * takes anything out of the lobby, so every parent in the lobby is refused alike
	 *
	 * @param world The regions and areas, as the editor shows them
	 * @param graph The same, indexed
	 * @param place The region or area
	 * @param override It, as its editor shows it
	 * @return Why, or undefined when it can be, or is in the lobby already
	 */
	private lobbyEntryRefusal(world: PlaceWorld, graph: PlaceGraph, place: PlaceRef, override: PlaceOverride): string | undefined
	{
		const lobbyRegionId = world.lobbyRegionId;

		if ((lobbyRegionId === null) || isInLobby(graph, place, lobbyRegionId))
		{
			return(undefined);
		}

		const problems = lobbyProblemsOfMove(world, place, [...override.node.parents, { kind: 'region', id: lobbyRegionId }], this.links(), this.loaded.startingAreaIds, this.neighborPairs());

		if (problems.length === 0)
		{
			return(undefined);
		}

		return(t({
			id: 'editor.place.lobbyParentRefused',
			defaultMessage: '{reason, select, starting {in the lobby, where characters can\'t start} other {in the lobby, and links here lead out of it}}',
			description: 'After a region or area offered as a parent in the region and area editors\' Add Parent, when it can\'t be chosen: it is below the lobby region, and {reason} is "starting" when characters start in this region or area (or below it), or otherwise links lead from here to areas outside the lobby. The lobby areas are never connected to the rest of the world'
		}, {
			reason: (problems.some((problem) => (problem.kind === 'lobbyStartingArea')) ? 'starting' : 'links')
		}));
	}

	/**
	 * What a region or area inherits with the changes its editor shows
	 *
	 * @param place The region or area
	 * @param override It, as its editor shows it
	 * @return What the fields show
	 */
	inheritedView(place: PlaceRef, override: PlaceOverride): InheritedView
	{
		const universe = this.universeOpen;
		const world = this.world(override);
		const graph = new PlaceGraph(world.regions, world.areas);
		const blank = this.world({ place, node: { ...override.node, ...BLANK_SETTINGS } });
		const blankGraph = new PlaceGraph(blank.regions, blank.areas);

		return({
			inherited: resolvePlace(blankGraph, place, world.tileKinds, world.lobbyRegionId),
			resolved: resolvePlace(graph, place, world.tileKinds, world.lobbyRegionId),
			names: this.names(),
			tiles: this.tileList,
			deletedTiles: this.deletedTiles(),
			ruleset: (universe?.ruleset ?? 'pf1e'),
			topLevel: ((place.kind === 'region') && (override.node.parents.length === 0)),
			region: (place.kind === 'region')
		});
	}

	/**
	 * Lists the problems the tab's changes, with a region or area open as its editor shows it, make for
	 * it and what is below it
	 *
	 * @param place The region or area
	 * @param override It, as its editor shows it
	 * @param list Where the problems are listed
	 * @param container What holds the list, hidden when there are none
	 */
	problemsFor(place: PlaceRef, override: PlaceOverride, list: HTMLElement, container: HTMLElement): void
	{
		const universe = this.universeOpen;
		const world = this.world(override);
		const resolution = resolveAreaSettings(world);
		const below = new Set([placeKey(place), ...resolution.graph.descendantsOf(place).map(placeKey)]);
		const names = this.names();
		const problems = [...resolution.problems, ...this.lobbyProblemsIn(world), ...neighborProblems(this.neighborGrid())].filter((problem) => problemPlaces(problem).some((each) => below.has(placeKey(each))));

		this.listProblems(problems, names, list, container, (universe?.ruleset ?? 'pf1e'));
	}

	/**
	 * Lists problems, each linking to the area it is about
	 *
	 * @param problems The problems
	 * @param names Names the places
	 * @param list Where they are listed
	 * @param container What holds the list, hidden when there are none
	 * @param ruleset The universe's ruleset
	 */
	private listProblems(problems: readonly PlaceProblem[], names: PlaceNames, list: HTMLElement, container: HTMLElement, ruleset: EditableUniverse['ruleset']): void
	{
		list.replaceChildren(...problems.map((problem) =>
		{
			const item = document.createElement('li');
			const place = problemPlaces(problem)[0];
			const button = document.createElement('button');

			button.type = 'button';
			button.className = 'link-button';
			button.textContent = describeProblem(problem, names, this.tileList, ruleset);
			button.addEventListener('click', () =>
			{
				this.open(place);
			});
			item.append(button);

			return(item);
		}));
		container.hidden = (problems.length === 0);
	}

	/**
	 * A region's or area's entry in a list, opening its editor
	 *
	 * @param place The region or area
	 * @return The list item
	 */
	listItem(place: PlaceRef): HTMLLIElement
	{
		const item = document.createElement('li');
		const button = document.createElement('button');
		const name = document.createElement('strong');
		const details = document.createElement('span');
		const area = ((place.kind === 'area') ? this.areas().find((each) => (each.id === place.id)) : undefined);

		button.type = 'button';
		button.className = `universe-item place-${place.kind}`;
		button.classList.toggle('place-lobby', ((place.kind === 'region') && (place.id === this.loaded.lobbyRegionId)));
		name.textContent = this.names()(place);
		details.className = 'universe-ruleset';
		details.textContent = formatList(this.tagsOf(place, (area?.resolved.enabled ?? true), this.lobbyPlaceKeys()));
		button.append(name, details);
		button.addEventListener('click', () =>
		{
			this.open(place);
		});
		item.append(button);

		return(item);
	}

	/**
	 * Lists the areas inside the area open
	 *
	 * @param areaId The area's ID
	 */
	private showChildren(areaId: string): void
	{
		const children = this.areas().filter((area) => area.parents.some((parent) => ((parent.kind === 'area') && (parent.id === areaId))));

		this.childList.replaceChildren(...children.map((child) => this.listItem({ kind: 'area', id: child.id })));
		this.children.hidden = (children.length === 0);
	}

	/**
	 * The area open as its editor shows it
	 *
	 * @return The override
	 */
	private areaOverride(): PlaceOverride
	{
		const area = this.area;

		return({
			place: { kind: 'area', id: (area?.id ?? '') },
			node: {
				...(area ?? BLANK_SETTINGS),
				...this.settings.read(),
				id: (area?.id ?? ''),
				name: this.name.value,
				parents: this.parents.value,
				loopsEastWest: this.loopsEastWest.checked,
				loopsNorthSouth: this.loopsNorthSouth.checked
			}
		});
	}

	/**
	 * Whether the area open is indoors, as its editor shows it: its own choice, or what it inherits
	 *
	 * @return True when it is
	 */
	private isIndoors(): boolean
	{
		return(this.settings.kind() ?? false);
	}

	/**
	 * Shows what the area open inherits, the problems its settings make, and the tiles it can paint, as
	 * a setting or parent changes
	 */
	private settingsChanged(): void
	{
		const area = this.area;

		if (!area)
		{
			return;
		}

		const place: PlaceRef = { kind: 'area', id: area.id };
		const override = this.areaOverride();
		const view = this.inheritedView(place, override);

		// A lobby area's passage of time is the Lobby tab's, so its own isn't shown, and only the lobby's
		// keeps it from looping
		this.showLobby(view.resolved.lobby);

		const faerie = (view.resolved.lobby ? (this.universeOpen?.lobbyPassageOfTime === 'faerie') : this.settings.isFaerie());

		this.settings.showInherited(view);
		this.parents.setChoices(this.parentChoices(place, 'area', override));
		this.loopsHint.hidden = !faerie;
		this.loopsEastWest.disabled = faerie;
		this.loopsNorthSouth.disabled = faerie;

		if (faerie)
		{
			this.loopsEastWest.checked = false;
			this.loopsNorthSouth.checked = false;
		}

		this.problemsFor(place, this.areaOverride(), this.problemList, this.problems);
		this.showLoopsAlongNeighbors(faerie);
		this.showNeighborSection();
		this.areaEditor.showTilesFor(this.isIndoors());
		this.areaChanges.check();
	}

	/**
	 * Disables the loop checkboxes that don't matter for an area with neighbors, saying why, and warns
	 * about a row or column that doesn't loop because only one of its ends is checked, naming the other end,
	 * and one that loops unlike the row or column beside it, naming the areas beside it
	 *
	 * @param faerie Whether the area's passage of time is faerie, which keeps it from looping anyway
	 */
	private showLoopsAlongNeighbors(faerie: boolean): void
	{
		const area = this.area;
		const notes: string[] = [];

		if (!area)
		{
			return;
		}

		const grid = this.neighborGrid();

		for (const [axis, checkbox] of [['eastWest', this.loopsEastWest], ['northSouth', this.loopsNorthSouth]] as const)
		{
			const place = loopPlace(grid, area.id, axis);
			const otherEnd = ((place === 'end') ? halfLoopingEnd(grid, area.id, axis) : undefined);

			checkbox.disabled = (faerie || (place !== 'end'));

			if (place !== 'end')
			{
				notes.push(t({
					id: 'editor.area.loopNotHere',
					defaultMessage: '{place, select, ring {Its {axis, select, eastWest {row} other {column}} of neighbors joins back onto itself. It always loops {axis, select, eastWest {east-west} other {north-south}}.} other {It has neighbors to the {axis, select, eastWest {east and west} other {north and south}}. Only the areas at the ends of its {axis, select, eastWest {row} other {column}} decide whether it loops.}}',
					description: 'Beside the area editor\'s loop checkboxes, which are disabled, for an area with neighboring areas (walked across without links): {place} is "ring" when its row or column of neighbors joins back onto itself, which always loops, and otherwise the area has neighbors on both sides, so only the ends\' checkboxes count; {axis} is which way (eastWest or northSouth)'
				}, {
					place,
					axis
				}));
			}
			else if (otherEnd !== undefined)
			{
				notes.push(t({
					id: 'editor.area.loopHalf',
					defaultMessage: 'Its {axis, select, eastWest {row} other {column}} of neighbors doesn\'t loop {axis, select, eastWest {east-west} other {north-south}}. Only one of its ends is checked. Check both this area and {area} at the other end.',
					description: 'Warning beside the area editor\'s loop checkboxes, for an area at one end of a row or column of neighboring areas (walked across without links) when only one of the two ends loops, so the row or column doesn\'t; {axis} is which way (eastWest or northSouth) and {area} the name of the area at the other end'
				}, {
					axis,
					area: this.names()({ kind: 'area', id: otherEnd })
				}));
			}

			const misaligned = misalignedLoops(grid, area.id, axis);

			if (misaligned.length > 0)
			{
				notes.push(t({
					id: 'editor.area.loopMisaligned',
					defaultMessage: 'Its {axis, select, eastWest {row} other {column}} of neighbors and the one beside it with {areas} don\'t both loop {axis, select, eastWest {east-west} other {north-south}}. Walking where they meet reaches different areas depending on the route taken. Make all {axis, select, eastWest {rows} other {columns}} side by side loop.',
					description: 'Warning beside the area editor\'s loop checkboxes, for an area with neighboring areas (walked across without links) whose row or column loops differently from the one beside it: one loops and the other doesn\'t, or their ends aren\'t lined up. {axis} is which way (eastWest or northSouth) and {areas} the names of the areas beside this one in that row or column'
				}, {
					axis,
					areas: formatList(misaligned.map((id) => this.names()({ kind: 'area', id })), 'conjunction')
				}));
			}
		}

		showMessage(this.loopsNeighbors, ((notes.length === 0) ? undefined : notes.join(' ')));
	}

	/**
	 * Fills the area editor with an area's settings, and shows its cells
	 *
	 * @param universe The area's universe
	 * @param area The area
	 * @return Once its cells show
	 */
	private showArea(universe: EditableUniverse, area: EditorArea): Promise<void>
	{
		const editable = (this.canEditPlace({ kind: 'area', id: area.id }) && !this.staged.isDeleted(area.id));
		const kept = this.keptSettings.get(area.id);
		const notes = (this.keptNotes.get(area.id) ?? []);
		// An area Edit Size in another area carried to a size takes it as its own size
		const carried = this.carriedBounds.get(area.id);

		this.area = { ...area, bounds: (this.areaEditor.keptBounds(area.id) ?? carried ?? area.bounds) };
		this.fillSettings(area);
		this.showSize(this.area);
		this.showEditable();
		showMessage(this.error, undefined);
		clearFieldErrors(this.form);
		this.showChildren(area.id);
		this.showClaim();
		this.areaChanges.markSaved();
		this.openedSettings = this.shownSettings();
		this.areaLoaded = (kept?.loaded ?? area);
		this.keptSettings.delete(area.id);
		this.keptNotes.delete(area.id);
		this.carriedBounds.delete(area.id);

		// An area left with changes shows them over the area as it now is, as the save will merge them
		if (kept)
		{
			this.fillSettings({ ...area, ...kept.changes }, kept.changes.parents);
			this.areaChanges.check();
		}

		for (const note of notes)
		{
			this.changedSince.add(note.name, note.details);
		}

		this.openNotes = notes;
		this.keptChanges.check();
		return(this.areaEditor.show(universe, { ...area, resolved: this.resolvedOf(area) }, this.tileList, this.tilesDeleted, this.linkTargets(area.id), editable, carried));
	}

	/**
	 * Lets the area open be changed, or makes it read-only for a player who can't change it or while it
	 * will be deleted, and offers Delete Area or Undo Delete
	 */
	private showEditable(): void
	{
		const area = this.area;

		if (!area)
		{
			return;
		}

		const place: PlaceRef = { kind: 'area', id: area.id };
		const deleted = this.staged.isDeleted(area.id);
		const editable = (this.canEditPlace(place) && !deleted);

		this.fields.disabled = !editable;
		this.name.disabled = !editable;
		this.parents.setDisabled(!editable);
		this.deleteButton.hidden = (!this.canEditPlace(place) || (area.id === this.loaded.lobbyAreaId) || (area.id === this.loaded.startingAreaId));
		labelRemoveButton(this.deleteButton, { removed: deleted }, false, t({
			id: 'editor.area.delete',
			defaultMessage: 'Delete Area',
			description: 'Button that deletes the area being edited when the Areas tab is saved'
		}));
		this.areaEditor.setEditable(editable);
	}

	/**
	 * The areas a link from an area can lead to: those on its side of the lobby region's edge, as the tab's
	 * changes leave them, other than those that will be deleted
	 *
	 * @param areaId The area's ID
	 * @return The areas
	 */
	private linkTargets(areaId: string): EditorAreaSummary[]
	{
		const world = this.world();
		const inLobby = lobbyAreaIds(new PlaceGraph(world.regions, world.areas), world.lobbyRegionId);
		const side = inLobby.has(areaId);

		return(this.areas().filter((other) => (!this.staged.isDeleted(other.id) && (inLobby.has(other.id) === side))));
	}

	/**
	 * The settings an area works out with the tab's changes, as the editor draws it: those stored for a
	 * saved area, and those worked out for a new one
	 *
	 * @param area The area
	 * @return The settings
	 */
	private resolvedOf(area: EditorArea): EditorArea['resolved']
	{
		if (!isNewAreaId(area.id))
		{
			return(area.resolved);
		}

		const world = this.world();

		return(resolveAreaSettings(world).stored.get(area.id) ?? area.resolved);
	}

	/**
	 * Fills the area editor's settings fields
	 *
	 * @param settings The settings
	 * @param parents The parents to show, when the form changed them; otherwise those the tab's changes give the area
	 */
	private fillSettings(settings: EditorArea, parents?: readonly PlaceRef[]): void
	{
		const place: PlaceRef = { kind: 'area', id: settings.id };
		const node = { ...settings, parents: [...(parents ?? this.staged.movedParents(place) ?? settings.parents)] };

		this.name.value = node.name;
		this.parents.set(node.parents, this.names(), this.parentChoices(place, 'area', { place, node }));
		this.loopsEastWest.checked = node.loopsEastWest;
		this.loopsNorthSouth.checked = node.loopsNorthSouth;
		this.settings.fill(node, this.inheritedView(place, { place, node }));
		this.settingsChanged();
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
		const changed = ((collected === undefined) ? [] : (Object.keys(shown) as (keyof AreaSettings)[]).filter((key) => (JSON.stringify(shown[key]) !== JSON.stringify(collected[key]))));

		void this.showArea(universe, area);

		if (changed.length > 0)
		{
			this.fillSettings({
				...area,
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
			defaultMessage: '({width, number}x{height, number})',
			description: 'The size of the area in cells, width by height, shown before the area editor\'s Edit Size button'
		}, {
			height,
			width
		});
	}

	/**
	 * Whether the player may change areas
	 *
	 * @return True for a creator or builder, in a version they may change
	 */
	canSave(): boolean
	{
		return((this.universeOpen !== undefined) && canEditWorldOpen(this.universeOpen));
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

		if (settings.parents.length === 0)
		{
			showMessage(this.error, t(messages.needsParent));
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
		return({
			name: this.name.value,
			parents: this.parents.value,
			...this.settings.read(),
			loopsEastWest: this.loopsEastWest.checked,
			loopsNorthSouth: this.loopsNorthSouth.checked
		});
	}

	/**
	 * Shows the problems the server found keeping a save from saving, under the region or area editor open
	 *
	 * @param refusal Why the save was refused
	 * @param fallback What to say when the server named no problems
	 * @param values The values fallback names, such as the area's name
	 * @param error Where to say it
	 * @param problemList Where to list the problems
	 * @param problems What holds the list
	 */
	showRefusal(refusal: SaveRefusal, fallback: Parameters<typeof describeEditorError>[1], values: MessageValues | undefined, error: HTMLElement, problemList: HTMLElement, problems: HTMLElement): void
	{
		showMessage(error, describeEditorError(refusal.error, fallback, values));

		if (refusal.placeProblems)
		{
			const named = refusal.placeProblems.names;
			const ours = this.names();

			this.listProblems(refusal.placeProblems.problems, (place) => (named[placeKey(place)] ?? ours(place)), problemList, problems, (this.universeOpen?.ruleset ?? 'pf1e'));
		}
	}

	/**
	 * Adds the tab's changes to a save: the regions added, the places moved, the areas deleted and added,
	 * the regions deleted, then the region open in its editor, then the areas the area editor changed: the
	 * cells of the area open and the areas left with changes, then their links, then their settings
	 *
	 * A new region or area is added after what it is inside, so it can name it. Tiles staged for deletion
	 * on the Tilesets tab are sent as the tiles chosen to replace them, as the Tilesets tab's changes
	 * repaint the saved areas
	 *
	 * @param save The save
	 * @return False when the settings of the region or area open, or of an area left with changes, have a
	 * problem
	 */
	collect(save: EditorSave): boolean
	{
		const universe = this.universeOpen;
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

		const regionCollected = this.regionEditor.readForSave();

		if (regionCollected === false)
		{
			return(false);
		}

		const refParents = (parents: readonly PlaceRef[]): PlaceRef[] => parents.map((parent) => ({ kind: parent.kind, id: placeRef(parent.id) }));
		const onRefused = (fallback: Parameters<typeof describeEditorError>[1], values?: MessageValues) => (refusal: SaveRefusal): void =>
		{
			if (this.area)
			{
				this.showRefusal(refusal, fallback, values, this.error, this.problemList, this.problems);
			}
			else if (!this.regionEditor.showRefusal(refusal, fallback, values))
			{
				showMessage(this.listError, describeEditorError(refusal.error, fallback, values));
			}
		};
		const names = this.names();
		const areaName = (areaId: string): string => names({ kind: 'area', id: areaId });
		const keptFallback = {
			id: 'editor.areas.keptSaveFailed',
			defaultMessage: 'Could not save {area}.',
			description: 'Shown on the Areas tab when an area changed in the area editor and left before saving can\'t be saved, followed by why; {area} is its name. Nothing was saved'
		};
		const keptProblem = this.keptProblem();

		if (keptProblem)
		{
			onRefused(keptFallback, { area: keptProblem.name })({
				error: new EditorApiError(keptProblem.reason, 400, undefined),
				retry: () =>
				{
					// Nothing was sent
				}
			});
			return(false);
		}
		const regionFallback = {
			id: 'editor.regions.saveFailed',
			defaultMessage: 'Could not save the regions.',
			description: 'Shown on the Areas tab when the server refused a change to its regions, followed by why; nothing was saved'
		};
		const neighborFallback = {
			id: 'editor.area.neighborsSaveFailed',
			defaultMessage: 'Could not save the neighboring areas.',
			description: 'Shown in the area editor when the server refused a change to the area\'s neighbors (areas walked across without links), or to the size of an area resized along with it, followed by why; nothing was saved'
		};

		showMessage(error, undefined);

		const createdRegions = this.regionCreationOrder(regionCollected);

		for (const region of createdRegions)
		{
			save.add({
				kind: 'createRegion',
				ref: newRef('', region.id),
				region: {
					name: region.name,
					parents: refParents(region.parents),
					enabled: region.enabled,
					indoors: region.indoors,
					lightLevel: region.lightLevel,
					defaultTileId: this.defaultTileRef({ kind: 'region', id: region.id }, region.defaultTileId),
					passageOfTime: region.passageOfTime,
					faerieMorning: region.faerieMorning,
					fogOfWar: region.fogOfWar
				}
			}, onRefused(regionFallback));
		}

		for (const { place, parents } of this.staged.movedPlaces())
		{
			save.add(((place.kind === 'region')
				? { kind: 'updateRegion', regionId: place.id, update: { parents: refParents(parents) } }
				: { kind: 'updateArea', areaId: place.id, update: { parents: refParents(parents) } }), onRefused(regionFallback));
		}

		for (const areaId of this.staged.deletedIds())
		{
			save.add({ kind: 'deleteArea', areaId }, onRefused({
				id: 'editor.areas.deleteFailed',
				defaultMessage: 'Could not delete {area}.',
				description: 'Shown on the Areas tab when the server refused to delete an area, followed by why; {area} is its name. Nothing was saved'
			}, {
				area: areaName(areaId)
			}));
		}

		const created = this.creationOrder(settings);

		for (const newArea of created)
		{
			const fields = (((newArea.id === area?.id) && settings) ? settings : newArea);

			save.add({
				kind: 'createArea',
				ref: newRef('', newArea.id),
				area: {
					name: fields.name.trim(),
					parents: refParents(fields.parents),
					enabled: fields.enabled,
					indoors: fields.indoors,
					lightLevel: fields.lightLevel,
					defaultTileId: this.defaultTileRef({ kind: 'area', id: newArea.id }, fields.defaultTileId),
					passageOfTime: fields.passageOfTime,
					faerieMorning: fields.faerieMorning,
					fogOfWar: fields.fogOfWar,
					loopsEastWest: fields.loopsEastWest,
					loopsNorthSouth: fields.loopsNorthSouth
				}
			}, onRefused({
				id: 'editor.areas.createFailed',
				defaultMessage: 'Could not add {area}.',
				description: 'Shown on the Areas tab when the server refused an area added on it, followed by why; {area} is its name. Nothing was saved'
			}, {
				area: fields.name.trim()
			}));

			// A neighbor Add Neighbor made is as large as its row and column, and every new area starts out the same size
			if (!sameBoundsAs(newArea.bounds, NEW_AREA_BOUNDS))
			{
				save.add({ kind: 'resizeArea', areaId: newRef('', newArea.id), bounds: newArea.bounds, discard: false }, onRefused(neighborFallback));
			}
		}

		for (const regionId of this.staged.deletedRegionIds())
		{
			save.add({ kind: 'deleteRegion', regionId }, onRefused(regionFallback));
		}

		this.regionEditor.collect(save, regionCollected, refParents, (tileId) => ((regionCollected === undefined) ? null : this.defaultTileRef({ kind: 'region', id: regionCollected.id }, tileId)));

		let saved: EditorArea | undefined;

		this.areaEditor.collect(save, placeRef, (tileId) => numberRef('tile', this.paintedAs(tileId)), (areaId) => !this.staged.isDeleted(areaId), (areaId, refusal) =>
		{
			if (areaId === this.area?.id)
			{
				showMessage(this.error, describeEditorError(refusal.error, {
					id: 'editor.area.cellsSaveFailed',
					defaultMessage: 'Could not save the area\'s cells.',
					description: 'Shown in the area editor when the server refused the painting on the area\'s cells, its new size or its links, followed by why; nothing was saved'
				}));
			}
			else
			{
				onRefused(keptFallback, { area: areaName(areaId) })(refusal);
			}
		});

		// The parents an area left with changes takes, those that will be deleted giving theirs in their place
		const world = this.world();
		const keptCollected = new Map(this.keptSettings);

		for (const [areaId, kept] of keptCollected)
		{
			const { name, parents, defaultTileId, ...others } = kept.changes;

			if (this.staged.isDeleted(areaId))
			{
				continue;
			}

			const update: AreaChangeUpdate = {
				...others,
				...((name === undefined) ? {} : { name: name.trim() }),
				...((parents === undefined) ? {} : { parents: refParents(world.areas.find((each) => (each.id === areaId))?.parents ?? parents) }),
				...((defaultTileId === undefined) ? {} : { defaultTileId: this.defaultTileRef({ kind: 'area', id: areaId }, defaultTileId) })
			};

			save.add({
				kind: 'updateArea',
				areaId,
				update,
				loaded: loadedFor(kept.loaded, update)
			}, onRefused(keptFallback, {
				area: areaName(areaId)
			}));
		}

		if (area && settings)
		{
			// A new area is added with the form's settings
			if (this.areaChanges.hasUnsavedChanges() && !isNewAreaId(area.id))
			{
				const update: AreaChangeUpdate = {
					...settings,
					parents: refParents(settings.parents),
					defaultTileId: this.defaultTileRef({ kind: 'area', id: area.id }, settings.defaultTileId)
				};

				save.add({
					kind: 'updateArea',
					areaId: area.id,
					update,
					loaded: loadedFor((this.areaLoaded ?? area), update)
				}, onRefused({
					id: 'editor.area.saveFailed',
					defaultMessage: 'Could not save the area.',
					description: 'Shown in the area editor when the server refused the area\'s settings, followed by why; nothing was saved'
				}));
			}

			saved = { ...area, ...settings, defaultTileId: this.defaultTileFor({ kind: 'area', id: area.id }, settings.defaultTileId) };
		}

		// The sizes a resize carried the rest of the row or column to, which the warning in Edit Size covered
		for (const [areaId, bounds] of this.carriedBounds)
		{
			if (!this.staged.isDeleted(areaId))
			{
				save.add({ kind: 'resizeArea', areaId, bounds, discard: true }, onRefused(neighborFallback));
			}
		}

		// Setting a neighbor sets both ways, so the change from the other side of a pair finds nothing to
		// change. The grid leaves out the areas that are gone or will be deleted, and neighbors naming them
		const grid = this.neighborGrid();

		for (const areaId of this.stagedNeighbors.keys())
		{
			const before = (this.areas().find((each) => (each.id === areaId))?.neighbors ?? NO_NEIGHBORS);
			const neighbors = grid.get(areaId)?.neighbors;

			if (!neighbors)
			{
				continue;
			}

			for (const side of NEIGHBOR_SIDES)
			{
				const neighborId = neighbors[side];

				if (neighborId !== before[side])
				{
					save.add({ kind: 'setNeighbor', areaId: placeRef(areaId), side, neighborId: ((neighborId === null) ? null : placeRef(neighborId)) }, onRefused(neighborFallback));
				}
			}
		}

		this.collected = {
			createdIds: [
				...createdRegions.map((region): PlaceRef => ({ kind: 'region', id: region.id })),
				...created.map((newArea): PlaceRef => ({ kind: 'area', id: newArea.id }))
			],
			area: saved,
			shown: ((saved === undefined) ? undefined : this.shownSettings()),
			kept: keptCollected,
			version: this.openVersion
		};

		return(true);
	}

	/**
	 * The first area left with changes whose settings can't be saved: a name that is blank or holds
	 * characters names can't, or no parents
	 *
	 * @return The area's name and what is wrong, or undefined when every area's settings can be saved
	 */
	private keptProblem(): { name: string; reason: string } | undefined
	{
		const kept = [...this.keptSettings]
			.filter(([areaId]) => !this.staged.isDeleted(areaId))
			.map(([, { loaded, changes }]) => ({ name: loaded.name, settings: changes }));
		const added = this.staged.newAreas()
			.filter((newArea) => (newArea.id !== this.area?.id))
			.map((newArea) => ({ name: newArea.name, settings: newArea }));

		for (const { name, settings } of [...kept, ...added])
		{
			const problem = settingsProblem(settings);

			if (problem !== undefined)
			{
				return({
					name,
					reason: ((problem === 'name') ? t(formMessages.invalidText) : t(messages.needsParent))
				});
			}
		}

		return(undefined);
	}

	/**
	 * Takes the tab's changes as saved: the new regions and areas get the IDs they were saved with, and the
	 * list or the editor open shows them as the server has them
	 *
	 * @param ids The IDs the save gave the regions, areas and tiles it made
	 */
	async saved(ids: SavedIds): Promise<void>
	{
		const universe = this.universeOpen;
		const { createdIds, area, shown, kept, version } = this.collected;

		this.collected = { createdIds: [], area: undefined, shown: undefined, kept: new Map(), version: -1 };

		if (!universe)
		{
			return;
		}

		this.areaEditor.saved();

		// The neighbors and sizes the area editor changed are saved, and the areas it added are saved areas now
		this.stagedNeighbors.clear();
		this.carriedBounds.clear();

		// Settings changed again while the save was sent stay unsaved
		for (const [areaId, settings] of kept)
		{
			if (this.keptSettings.get(areaId) === settings)
			{
				this.keptSettings.delete(areaId);
			}
		}

		const deletedAreas = this.staged.deletedIds();

		for (const areaId of deletedAreas)
		{
			const parents = (this.loaded.areas.find((each) => (each.id === areaId))?.parents ?? []);

			this.staged.markDeleted(areaId, parents);
			this.forgetArea(areaId, parents);
		}

		for (const areaId of [...this.keptNotes.keys()])
		{
			if (!this.hasKeptChanges(areaId))
			{
				this.keptNotes.delete(areaId);
			}
		}

		this.keptChanges.check();

		for (const regionId of this.staged.deletedRegionIds())
		{
			this.staged.markPlaceDeleted({ kind: 'region', id: regionId });
		}

		this.staged.markMovesSaved();

		const savedIds = new Map<string, string>();

		for (const place of createdIds)
		{
			const savedId = ids.string(placeRef(place.id));

			if (savedId !== undefined)
			{
				savedIds.set(place.id, savedId);
				this.placeCreated(place, savedId);
			}
		}

		await this.loadTilesQuietly(universe);

		const regionOpen = this.regionEditor.saved(savedIds);

		if (regionOpen !== undefined)
		{
			try
			{
				await this.loadAreas(universe);
			}
			catch
			{
				// The list stays as it was last loaded
			}

			if (version === this.openVersion)
			{
				this.regionEditor.showAfterSave(universe, regionOpen);

				// Gives a region new until the save its address
				if (this.regions().some((region) => (region.id === regionOpen)))
				{
					this.onPlaceChanged({ kind: 'region', id: regionOpen });
				}
			}

			return;
		}

		await this.refreshAfterSave(universe, version, (area && {
			...area,
			id: (savedIds.get(area.id) ?? area.id),
			parents: area.parents.map((parent) => ({ kind: parent.kind, id: (savedIds.get(parent.id) ?? parent.id) })),
			defaultTileId: ((area.defaultTileId === null) ? null : (ids.number(numberRef('tile', area.defaultTileId)) ?? area.defaultTileId))
		}), shown);
	}

	/**
	 * The tile a cell or a default tile painted with a tile shows once saved: the tile chosen to replace
	 * one staged for deletion on the Tilesets tab, or the tile itself
	 *
	 * @param tileId The tile's ID
	 * @return The tile to save
	 */
	private paintedAs(tileId: number): number
	{
		return(this.tilesDeleted.get(tileId) ?? tileId);
	}

	/**
	 * The default tile a region or area takes once saved: what the Tilesets tab chose for it in place of
	 * the tile it sets, when that tile is being deleted or is no longer for its areas' kind, and otherwise
	 * the tile it sets
	 *
	 * @param place The region or area
	 * @param defaultTileId The default tile it sets, or null when it inherits one
	 * @return The default tile, or null
	 */
	private defaultTileFor(place: PlaceRef, defaultTileId: number | null): number | null
	{
		if (defaultTileId === null)
		{
			return(null);
		}

		const change = this.stagedTiles.defaultTileChanges().get(placeKey(place));

		return((((change !== undefined) && (change.from === defaultTileId)) ? change.to : this.paintedAs(defaultTileId)));
	}

	/**
	 * How a save names the default tile a region or area takes (defaultTileFor())
	 *
	 * @param place The region or area
	 * @param defaultTileId The default tile it sets, or null when it inherits one
	 * @return The tile's ref, or null
	 */
	private defaultTileRef(place: PlaceRef, defaultTileId: number | null): NumberRef | null
	{
		const tileId = this.defaultTileFor(place, defaultTileId);

		return(((tileId === null) ? null : numberRef('tile', tileId)));
	}

	/**
	 * Shows the regions and areas as a save of the Tilesets tab left them, once it gave some of them other
	 * default tiles: the list, the region open or the area open, loaded again. While the tab has unsaved
	 * changes, it was saved too, and shows them once it takes them as saved
	 */
	async placesSaved(): Promise<void>
	{
		const universe = this.universeOpen;
		const version = this.openVersion;

		if (!universe || (this.areasLoadedFor !== universe) || this.changes.hasUnsavedChanges())
		{
			return;
		}

		if (this.area && !this.editorView.hidden)
		{
			await this.refreshAfterSave(universe, version, this.area);
			return;
		}

		try
		{
			await Promise.all([
				this.loadAreas(universe),
				this.loadTiles(universe)
			]);
		}
		catch
		{
			// The regions and areas stay as they were last loaded
			return;
		}

		if (version !== this.openVersion)
		{
			return;
		}

		if (!this.listView.hidden)
		{
			this.renderList();
		}

		this.regionEditor.reshow();
	}

	/**
	 * Loads the regions, areas and tiles for the dialog replacing a default tile on the Tilesets tab,
	 * unless they have loaded for the universe open
	 */
	async loadPlaces(): Promise<void>
	{
		const universe = this.universeOpen;

		if (!universe)
		{
			return;
		}

		await Promise.all([
			((this.areasLoadedFor === universe) ? undefined : this.loadAreas(universe)),
			((this.tilesLoadedFor === universe) ? undefined : this.loadTiles(universe))
		]);
	}

	/**
	 * The regions added since the tab was last saved, each after the new regions it is inside, so it can
	 * name their saved IDs
	 *
	 * @param open The region open in the region editor, as its form shows it, when it is new
	 * @return The regions
	 */
	private regionCreationOrder(open: EditorRegion | undefined): EditorRegion[]
	{
		const waiting = this.staged.newRegions().map((region) => (((open !== undefined) && (region.id === open.id)) ? open : region));
		const order: EditorRegion[] = [];

		while (waiting.length > 0)
		{
			// A region's parents leave out what is below it, so there is always one
			const index = Math.max(0, waiting.findIndex((region) => !region.parents.some((parent) => waiting.some((other) => (other.id === parent.id)))));

			order.push(...waiting.splice(index, 1));
		}

		return(order);
	}

	/**
	 * The areas added since the tab was last saved, each after the new area it is inside, so it can name
	 * that area's saved ID
	 *
	 * @param settings The area editor's settings, for the area open, whose parents the form may have changed
	 * @return The areas
	 */
	private creationOrder(settings: AreaSettings | undefined): EditorArea[]
	{
		const waiting = this.staged.newAreas().map((area) => (((area.id === this.area?.id) && settings) ? { ...area, parents: settings.parents } : area));
		const order: EditorArea[] = [];

		while (waiting.length > 0)
		{
			// The area editor's parent choices leave out an area's own descendants, so there is always one
			const index = Math.max(0, waiting.findIndex((area) => !area.parents.some((parent) => waiting.some((other) => (other.id === parent.id)))));

			order.push(...waiting.splice(index, 1));
		}

		return(order);
	}

	/**
	 * Takes a new region or area as saved: everything that named it by the ID it had on the page names its
	 * saved ID
	 *
	 * @param place The region or area, by the ID it had on the page
	 * @param savedId The ID the server saved it with
	 */
	private placeCreated(place: PlaceRef, savedId: string): void
	{
		this.staged.markPlaceCreated(place, savedId);
		this.parents.replaceId(place.id, savedId);

		for (const [areaId, kept] of this.keptSettings)
		{
			if (kept.changes.parents)
			{
				this.keptSettings.set(areaId, { ...kept, changes: { ...kept.changes, parents: kept.changes.parents.map((parent) => (samePlace(parent, place) ? { ...parent, id: savedId } : parent)) } });
			}
		}

		if (place.kind === 'area')
		{
			this.areaEditor.resolveIds(new Map([[place.id, savedId]]));

			if (this.area?.id === place.id)
			{
				this.area = { ...this.area, id: savedId };
				this.onPlaceChanged({ kind: 'area', id: savedId });
			}
		}
	}

	/**
	 * Shows the tab afresh once it has saved: the list, or the area editor with the area as saved. The
	 * list of regions and areas is loaded again first, since saving added and deleted them
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
			await this.showListView();
			return;
		}

		try
		{
			[area] = await Promise.all([
				this.api.getArea(universe.id, area.id),
				this.loadAreas(universe)
			]);
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
	 * Deletes the area open when the tab is saved, after asking, and goes back to the list; or, for an
	 * area that will be deleted, keeps it after all. A new area is deleted immediately, since it was
	 * never saved. The areas inside it take its parents, and deleting it waits while that leaves one of
	 * them with a problem
	 */
	private toggleDelete(): void
	{
		const universe = this.universeOpen;
		const area = this.area;

		if (!universe || !area)
		{
			return;
		}

		if (this.staged.isDeleted(area.id))
		{
			this.staged.undoDelete(area.id);
			this.showEditable();
			return;
		}

		// What deleting it leaves, as the server will check it
		const world = this.world();
		const children = new PlaceGraph(world.regions, world.areas).descendantsOf({ kind: 'area', id: area.id });

		this.staged.delete(area.id);

		const after = resolveAreaSettings(this.world()).problems.filter((problem) => problemPlaces(problem).some((place) => children.some((child) => samePlace(child, place))));

		this.staged.undoDelete(area.id);

		if (after.length > 0)
		{
			showMessage(this.error, t({
				id: 'editor.area.deleteLeavesProblems',
				defaultMessage: 'Deleting this area would leave the areas inside it, which take its parents in its place, with problems: {problems}',
				description: 'Shown in the area editor in place of deleting the area, when the areas inside it would be left without a setting or with different values from above; {problems} lists the problems'
			}, {
				problems: formatList(after.map((problem) => describeProblem(problem, this.names(), this.tileList, universe.ruleset)), 'conjunction')
			}));
			return;
		}

		const neighbors = NEIGHBOR_SIDES
			.map((side) => this.neighborGrid().get(area.id)?.neighbors[side] ?? null)
			.filter((neighborId) => (neighborId !== null))
			.map((neighborId) => this.names()({ kind: 'area', id: neighborId }));
		const neighborNames = [...new Set(neighbors)];
		let question: string;

		if (isNewAreaId(area.id))
		{
			question = t({
				id: 'editor.area.confirmDeleteNew',
				defaultMessage: 'Delete {area}? It hasn\'t been saved, so its settings, painting and links will be lost.',
				description: 'Asks before deleting an area added since the Areas tab was last saved, which goes immediately; {area} is its name'
			}, {
				area: area.name
			});
		}
		else if (neighborNames.length > 0)
		{
			question = t({
				id: 'editor.area.confirmDeleteWithNeighbors',
				defaultMessage: 'Delete {area} and every link into it when the Areas tab is saved? The areas inside it take its parents in its place. {count, plural, one {Its neighbor {neighbors} will have} other {Its neighbors {neighbors} will have}} an edge where it was.',
				description: 'Asks before marking an area to be deleted when the Areas tab is saved, when it has neighboring areas (walked across without links), which are left with nothing past that side; {area} is its name, {neighbors} lists the neighbors\' names and {count} how many'
			}, {
				area: area.name,
				neighbors: formatList(neighborNames, 'conjunction'),
				count: neighborNames.length
			});
		}
		else
		{
			question = t({
				id: 'editor.area.confirmDeleteInRegions',
				defaultMessage: 'Delete {area} and every link into it when the Areas tab is saved? The areas inside it take its parents in its place.',
				description: 'Asks before marking an area to be deleted when the Areas tab is saved; {area} is its name'
			}, {
				area: area.name
			});
		}

		if (!window.confirm(question))
		{
			return;
		}

		this.staged.delete(area.id);

		// A new area goes at once, with its changes, and the areas beside it lose it as a neighbor
		if (isNewAreaId(area.id))
		{
			this.forgetArea(area.id, this.parents.value);
			this.stageGrid(this.neighborGrid());
		}

		void this.showListView();
	}

	/**
	 * Fills a dialog's Inside field with what a new region or area can go inside
	 *
	 * @param field The field
	 * @param kind Whether the new one is a region or an area
	 */
	private fillInsideChoices(field: SearchSelect, kind: 'region' | 'area'): void
	{
		const universe = this.universeOpen;
		const world = this.world();
		const names = this.names();
		const graph = new PlaceGraph(world.regions, world.areas);
		const candidates: PlaceRef[] = [
			...world.regions.map((region): PlaceRef => ({ kind: 'region', id: region.id })),
			...((kind === 'area') ? world.areas.map((area): PlaceRef => ({ kind: 'area', id: area.id })) : [])
		];
		const topLevel = ((kind === 'region') && (universe !== undefined) && editsEveryPlace(universe.role));

		field.setChoices([
			{
				value: '',
				name: (topLevel
					? t({
						id: 'editor.regionAdd.topLevel',
						defaultMessage: 'Nothing (a top-level region)',
						description: 'Choice in the Add Region dialog\'s Inside field for a region inside no other'
					})
					: '')
			},
			...candidates
				.filter((candidate) => ((graph.depths().get(placeKey(candidate)) ?? 1) < 10) && this.canEditPlace(candidate))
				.map((candidate) => ({
					value: placeKey(candidate),
					name: names(candidate),
					detail: (formatList(graph.parentsOf(candidate).map(names), 'conjunction') || undefined)
				}))
				.sort((first, second) => first.name.localeCompare(second.name))
		]);
		field.value = '';
	}

	/**
	 * Opens the Add Area dialog, with what the new area can go inside
	 */
	private openAddDialog(): void
	{
		this.addForm.reset();
		showMessage(this.addError, undefined);
		clearFieldErrors(this.addForm);
		this.addSubmit.disabled = false;
		this.fillInsideChoices(this.addParent, 'area');
		this.addDialog.showModal();
		this.addChanges.markSaved();
		this.addName.focus();
	}

	/**
	 * Opens the Add Region dialog, with what the new region can go inside
	 */
	private openRegionDialog(): void
	{
		this.regionForm.reset();
		showMessage(this.regionError, undefined);
		clearFieldErrors(this.regionForm);
		this.fillInsideChoices(this.regionParent, 'region');
		this.regionDialog.showModal();
		this.regionChanges.markSaved();
		this.regionName.focus();
	}

	/**
	 * The place a dialog's Inside field chose
	 *
	 * @param field The field
	 * @return The place, or undefined for none
	 */
	private chosenInside(field: SearchSelect): PlaceRef | undefined
	{
		const value = field.value;

		if (value === '')
		{
			return(undefined);
		}

		return({
			kind: (value.startsWith('region:') ? 'region' : 'area'),
			id: value.slice(value.indexOf(':') + 1)
		});
	}

	/**
	 * Adds the area the Add Area dialog describes, to be saved with the tab, and opens it in the area
	 * editor. Its settings inherit, but for being disabled once the universe is past in_the_beginning, as
	 * the server makes a new area
	 */
	private async addArea(): Promise<void>
	{
		const universe = this.universeOpen;
		const name = this.addName.value.trim();
		const inside = this.chosenInside(this.addParent);

		if (!universe)
		{
			return;
		}

		if ((name === '') || DISALLOWED_TEXT_CHARACTERS.test(name))
		{
			reportFieldError(this.addName, t(formMessages.invalidText));
			return;
		}

		if (inside === undefined)
		{
			showMessage(this.addError, t({
				id: 'editor.areaAdd.needsParent',
				defaultMessage: 'Choose the region or area the new area goes inside.',
				description: 'Shown in the Add Area dialog when nothing was chosen for the new area to go inside'
			}));
			return;
		}

		const area = this.staged.create({
			name,
			parents: [inside],
			...BLANK_SETTINGS,
			enabled: ((universe.stage === 'in_the_beginning') ? null : false),
			loopsEastWest: false,
			loopsNorthSouth: false
		});

		this.addChanges.markSaved();
		this.addDialog.close();
		await this.openArea(area.id);
	}

	/**
	 * Adds the region the Add Region dialog describes, to be saved with the tab, and opens it in the region
	 * editor
	 */
	private addRegion(): void
	{
		const universe = this.universeOpen;
		const name = this.regionName.value.trim();
		const inside = this.chosenInside(this.regionParent);
		const lower = name.toLowerCase();

		if (!universe)
		{
			return;
		}

		if ((name === '') || DISALLOWED_TEXT_CHARACTERS.test(name))
		{
			reportFieldError(this.regionName, t(formMessages.invalidText));
			return;
		}

		if (this.regions().some((region) => (region.name.toLowerCase() === lower)))
		{
			reportFieldError(this.regionName, t({
				id: 'editor.regionAdd.nameTaken',
				defaultMessage: 'Another region is already named that.',
				description: 'Shown under the name field of the Add Region dialog or region editor when another region has the name, not counting capitals'
			}));
			return;
		}

		if ((inside === undefined) && !editsEveryPlace(universe.role))
		{
			showMessage(this.regionError, t({
				id: 'editor.regionAdd.needsParent',
				defaultMessage: 'Choose the region the new region goes inside.',
				description: 'Shown in the Add Region dialog to a builder who chose nothing for the new region to go inside: builders add regions only inside the regions they\'re assigned'
			}));
			return;
		}

		const region = this.staged.createRegion({
			name,
			parents: ((inside === undefined) ? [] : [inside]),
			...BLANK_SETTINGS
		});

		this.regionChanges.markSaved();
		this.regionDialog.close();
		this.open({ kind: 'region', id: region.id });
	}
}
