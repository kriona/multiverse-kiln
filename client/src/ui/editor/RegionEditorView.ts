import { DISALLOWED_TEXT_CHARACTERS, editsEveryPlace, INHERITED_SETTINGS, loadedFor, MAX_REGION_NAME_LENGTH, placeKey, type EditableUniverse, type EditorRegion, type NumberRef, type PlaceRef, type RegionChangeUpdate, type SavedEditDetail, type UniverseEditorSummary } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { ChangeTracker } from '../changeTracker';
import { getElement, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import { SearchSelect } from '../SearchSelect';
import type { PlaceOverride, PlacesHost } from './AreasTab';
import type { EditorSave, SaveRefusal } from './editorSave';
import { ChangedSinceLine, type OtherSave } from './otherSaves';
import { ParentsField } from './ParentsField';
import { PlaceFields } from './PlaceFields';
import { describeProblem } from './places';
import { RegionDeleteDialog } from './RegionDeleteDialog';
import { isNewPlace } from './stagedAreas';
import { labelRemoveButton } from './stagedChanges';

/**
 * How a save names a region: a saved one by its ID, and one added since the tab was last saved by its ref
 */
type RefParents = (parents: readonly PlaceRef[]) => PlaceRef[];

/**
 * The region editor on the Areas tab (see Editor: Region in STRUCTURE-OVERVIEW.md): a region's name,
 * parents and settings, the builders assigned to it, what is inside it, and deleting it. Its changes wait
 * on the page until the tab is saved
 */
export class RegionEditorView
{
	private readonly view = getElement('region-editor-view', HTMLElement);
	private readonly form = getElement('region-form', HTMLFormElement);
	private readonly fields = getElement('region-fields', HTMLFieldSetElement);
	private readonly name = getElement('region-name', HTMLInputElement);
	private readonly warnings = getElement('region-warnings', HTMLElement);
	private readonly warningList = getElement('region-warning-list', HTMLUListElement);
	private readonly problems = getElement('region-problems', HTMLElement);
	private readonly problemList = getElement('region-problem-list', HTMLUListElement);
	private readonly assignments = getElement('region-assignments', HTMLFieldSetElement);
	private readonly builderList = getElement('region-builder-list', HTMLUListElement);
	private readonly builderNone = getElement('region-builder-none', HTMLElement);
	private readonly builderDraft = getElement('region-builder-draft', HTMLElement);
	private readonly builderField = getElement('region-builder-add', HTMLInputElement);
	private readonly childList = getElement('region-child-list', HTMLUListElement);
	private readonly childNone = getElement('region-child-none', HTMLElement);
	private readonly error = getElement('region-error', HTMLElement);
	private readonly deleteButton = getElement('region-delete', HTMLButtonElement);
	private readonly settings: PlaceFields;
	private readonly parents: ParentsField;
	private readonly deleteDialog: RegionDeleteDialog;

	/**
	 * Assigns a builder, chosen by typing part of their name
	 */
	private readonly addBuilder: SearchSelect;

	/**
	 * The builders assigned to the region, as the editor shows them
	 */
	private builderIds: string[] = [];

	/**
	 * The universe's builders, by player ID
	 */
	private builders = new Map<string, UniverseEditorSummary>();

	/**
	 * Whether the region's settings, parents or builders have changes that haven't been saved
	 */
	readonly changes: ChangeTracker;

	/**
	 * Says above the region's settings what other windows saved to it while it had unsaved changes
	 */
	private readonly changedSince: ChangedSinceLine;

	/**
	 * The region open, as it was loaded
	 */
	private region: EditorRegion | undefined;

	/**
	 * What the save being sent holds of the region open: its ID, or undefined when it held none
	 */
	private collectedId: string | undefined;

	/**
	 * @param api The editor's API
	 * @param host The Areas tab
	 */
	constructor(private readonly api: EditorApi, private readonly host: PlacesHost)
	{
		this.settings = new PlaceFields('region', () =>
		{
			this.settingsChanged();
		});
		this.parents = new ParentsField('region', () =>
		{
			this.settingsChanged();
		});
		this.changes = new ChangeTracker({
			root: this.form,
			state: () => [this.parents.value.map(placeKey).join(','), this.builderIds.join(',')]
		});
		this.changedSince = new ChangedSinceLine(this.form, this.changes);
		this.deleteDialog = new RegionDeleteDialog(host, () =>
		{
			host.showList();
		});
		this.addBuilder = new SearchSelect({
			searchId: 'region-builder-add',
			listboxId: 'region-builder-add-options',
			choices: [],
			onChange: () =>
			{
				const playerId = this.addBuilder.value;

				this.addBuilder.value = '';

				if ((playerId !== '') && !this.builderIds.includes(playerId))
				{
					this.builderIds = [...this.builderIds, playerId];
					this.showBuilders();
					this.changes.check();
				}
			}
		});
		this.name.maxLength = MAX_REGION_NAME_LENGTH;

		this.name.addEventListener('input', () =>
		{
			setFieldError(this.name, undefined);
		});

		getElement('region-back', HTMLButtonElement).addEventListener('click', () =>
		{
			if (this.changes.confirmDiscard())
			{
				host.showList();
			}
		});

		this.deleteButton.addEventListener('click', () =>
		{
			this.toggleDelete();
		});
	}

	/**
	 * Whether the region editor may be left: asks first while it has unsaved changes
	 *
	 * @return False when the player kept the changes
	 */
	confirmLeave(): boolean
	{
		return(this.view.hidden || this.changes.confirmDiscard());
	}

	/**
	 * Hides the region editor, throwing its unsaved changes away
	 */
	hide(): void
	{
		this.view.hidden = true;
		this.region = undefined;
		this.changes.markSaved();
		this.changedSince.hide();
	}

	/**
	 * Opens a region
	 *
	 * @param universe The universe
	 * @param regionId The region's ID
	 */
	show(universe: EditableUniverse, regionId: string): void
	{
		const region = this.host.regions().find((each) => (each.id === regionId));

		this.changedSince.hide();

		if (!region)
		{
			this.host.showList();
			return;
		}

		this.view.hidden = false;
		this.region = region;
		this.fill(universe, region);
		void this.loadBuilders(universe);
	}

	/**
	 * Scrolls to the region open and moves focus to its name, once the player opened it from a row or link
	 * that is hidden now
	 */
	focus(): void
	{
		this.view.scrollIntoView({ block: 'start' });
		this.name.focus({ preventScroll: true });
	}

	/**
	 * Fills the editor with a region's settings
	 *
	 * @param universe The universe
	 * @param region The region
	 */
	private fill(universe: EditableUniverse, region: EditorRegion): void
	{
		const place: PlaceRef = { kind: 'region', id: region.id };
		const deleted = this.host.staged.isPlaceDeleted(place);
		const editable = (this.host.canEditPlace(place) && !deleted);
		const assigned = (!editsEveryPlace(universe.role) && universe.assignedRegionIds.includes(region.id));
		const override: PlaceOverride = { place, node: region };

		this.name.value = region.name;
		this.parents.set(region.parents, this.host.names(), this.host.parentChoices(place, 'region', override));
		this.settings.fill(region, this.host.inheritedView(place, override));
		this.builderIds = [...region.builderIds];
		this.fields.disabled = !editable;
		this.name.disabled = !editable;

		// Only creators move the regions builders are assigned to, or assign builders
		this.parents.setDisabled(!editable || assigned);
		this.assignments.disabled = !(editable && editsEveryPlace(universe.role));
		this.builderField.hidden = this.assignments.disabled;
		this.deleteButton.hidden = (!this.host.canEditPlace(place) || assigned);
		labelRemoveButton(this.deleteButton, { removed: deleted }, false, t({
			id: 'editor.region.delete',
			defaultMessage: 'Delete Region',
			description: 'Button in the region editor that deletes the region when the Areas tab is saved, after asking what happens to what is in it; also the Delete Region dialog\'s button'
		}));
		showMessage(this.error, undefined);
		clearFieldErrors(this.form);
		this.showBuilders();
		this.settingsChanged();
		this.changes.markSaved();
	}

	/**
	 * Loads the universe's editors, for naming and assigning builders
	 *
	 * @param universe The universe
	 */
	private async loadBuilders(universe: EditableUniverse): Promise<void>
	{
		try
		{
			const editors = await this.api.listEditors(universe.id);

			this.builders = new Map(editors
				.filter((editor) => (editor.role === 'builder'))
				.map((editor) => [editor.playerId, editor]));
		}
		catch
		{
			// Builders are named by what is known until they load
		}

		this.showBuilders();
	}

	/**
	 * Lists the builders assigned to the region, each with a Remove button for those who may change them,
	 * and offers the others
	 */
	private showBuilders(): void
	{
		const region = this.region;
		const isNew = ((region !== undefined) && isNewPlace({ kind: 'region', id: region.id }));
		const draftAdded = ((region !== undefined) && (this.host.universe()?.version === 'draft') && (region.builderIds.length === 0) && isNew);

		this.builderList.replaceChildren(...this.builderIds.map((playerId) =>
		{
			const item = document.createElement('li');
			const name = document.createElement('span');
			const builder = this.builders.get(playerId);
			const remove = document.createElement('button');

			name.textContent = ((builder === undefined) ? playerId : `${builder.displayName} (@${builder.username})`);
			remove.type = 'button';
			remove.className = 'secondary';
			remove.hidden = this.assignments.disabled;
			remove.textContent = t({
				id: 'editor.place.removeParent',
				defaultMessage: 'Remove',
				description: 'Button beside one of a region\'s or area\'s parents in its editor, which takes it out of that parent'
			});
			remove.addEventListener('click', () =>
			{
				this.builderIds = this.builderIds.filter((each) => (each !== playerId));
				this.showBuilders();
				this.changes.check();
			});
			item.append(name, remove);

			return(item);
		}));
		this.builderNone.hidden = (this.builderIds.length > 0);
		this.builderDraft.hidden = !draftAdded;
		this.addBuilder.setChoices([...this.builders.values()]
			.filter((builder) => !this.builderIds.includes(builder.playerId))
			.map((builder) => ({
				value: builder.playerId,
				name: builder.displayName,
				detail: `@${builder.username}`
			})));
	}

	/**
	 * The region open as its editor shows it
	 *
	 * @return The override
	 */
	private override(): PlaceOverride | undefined
	{
		const region = this.region;

		if (!region)
		{
			return(undefined);
		}

		return({
			place: { kind: 'region', id: region.id },
			node: {
				...region,
				...this.settings.read(),
				name: this.name.value,
				parents: this.parents.value
			}
		});
	}

	/**
	 * Shows what the region inherits, the regions above it that disagree, the problems its settings make
	 * for the areas below it, and what is inside it, as a setting or parent changes
	 */
	private settingsChanged(): void
	{
		const override = this.override();
		const universe = this.host.universe();

		if (!override || !universe)
		{
			return;
		}

		const view = this.host.inheritedView(override.place, override);
		const names = this.host.names();

		this.settings.showInherited(view);
		this.parents.setChoices(this.host.parentChoices(override.place, 'region', override));

		// A region's own conflicting inheritance only warns: an area below it may settle it
		const conflicts = INHERITED_SETTINGS.flatMap((setting) =>
		{
			const found = view.resolved[setting];

			return(((found.kind === 'conflict') ? [describeProblem({ kind: 'conflict', areaId: '', setting, values: found.values }, (place) => ((place.id === '') ? override.node.name : names(place)), this.host.tiles(), universe.ruleset)] : []));
		});

		this.warningList.replaceChildren(...conflicts.map((text) =>
		{
			const item = document.createElement('li');

			item.textContent = text;

			return(item);
		}));
		this.warnings.hidden = (conflicts.length === 0);
		this.host.problemsFor(override.place, override, this.problemList, this.problems);
		this.showChildren(override.place);
		this.changes.check();
	}

	/**
	 * Lists the regions and areas directly inside the region
	 *
	 * @param place The region
	 */
	private showChildren(place: PlaceRef): void
	{
		const inside = [
			...this.host.regions()
				.filter((region) => region.parents.some((parent) => (parent.id === place.id)))
				.map((region): PlaceRef => ({ kind: 'region', id: region.id })),
			...this.host.areas()
				.filter((area) => area.parents.some((parent) => ((parent.kind === 'region') && (parent.id === place.id))))
				.map((area): PlaceRef => ({ kind: 'area', id: area.id }))
		];

		this.childList.replaceChildren(...inside.map((child) => this.host.listItem(child)));
		this.childNone.hidden = (inside.length > 0);
	}

	/**
	 * Shows the region open again, after another tab's changes or the claims changed
	 */
	refresh(): void
	{
		if (this.region && !this.view.hidden)
		{
			this.settingsChanged();
		}
	}

	/**
	 * Deletes the region open when the tab is saved, after asking what happens to what is in it; or, for
	 * a region that will be deleted, keeps it after all
	 */
	private toggleDelete(): void
	{
		const region = this.region;
		const universe = this.host.universe();

		if (!region || !universe)
		{
			return;
		}

		const place: PlaceRef = { kind: 'region', id: region.id };

		if (this.host.staged.isPlaceDeleted(place))
		{
			this.host.staged.undoDeletePlace(place);
			this.fill(universe, region);
			return;
		}

		if (this.changes.confirmDiscard())
		{
			this.deleteDialog.open(region);
		}
	}

	/**
	 * The region open as its form shows it, checked for saving
	 *
	 * @return The region, for one with changes to save; undefined for none; false after showing what is
	 * wrong with it
	 */
	readForSave(): EditorRegion | undefined | false
	{
		const region = this.region;

		if (!region || this.view.hidden || this.host.staged.isPlaceDeleted({ kind: 'region', id: region.id }))
		{
			this.collectedId = undefined;
			return(undefined);
		}

		const name = this.name.value.trim();
		const lower = name.toLowerCase();

		if ((name === '') || DISALLOWED_TEXT_CHARACTERS.test(name))
		{
			reportFieldError(this.name, t(formMessages.invalidText));
			return(false);
		}

		if (this.host.regions().some((other) => ((other.id !== region.id) && (other.name.toLowerCase() === lower))))
		{
			reportFieldError(this.name, t({
				id: 'editor.regionAdd.nameTaken',
				defaultMessage: 'Another region is already named that.',
				description: 'Shown under the name field of the Add Region dialog or region editor when another region has the name, not counting capitals'
			}));
			return(false);
		}

		this.collectedId = region.id;

		return({
			...region,
			...this.settings.read(),
			name,
			parents: this.parents.value,
			builderIds: this.builderIds
		});
	}

	/**
	 * Adds the region open's changes to a save, once the regions are added: its settings and parents, and
	 * the builders assigned to it
	 *
	 * @param save The save
	 * @param region The region as readForSave() read it
	 * @param refParents How the save names its parents
	 * @param defaultTileRef How the save names the region's default tile, from the one its form shows
	 */
	collect(save: EditorSave, region: EditorRegion | undefined, refParents: RefParents, defaultTileRef: (tileId: number | null) => NumberRef | null): void
	{
		const loadedRegion = this.region;

		if (!region || !loadedRegion)
		{
			return;
		}

		const universe = this.host.universe();
		const isNew = isNewPlace({ kind: 'region', id: region.id });
		const regionRef = (isNew ? `new:${region.id}` : region.id);
		const fallback = {
			id: 'editor.region.saveFailed',
			defaultMessage: 'Could not save the region.',
			description: 'Shown in the region editor when the server refused its settings, parents or builders, followed by why; nothing was saved'
		};

		// A new region is added with the form's settings
		if (!isNew && this.changes.hasUnsavedChanges())
		{
			const update: RegionChangeUpdate = {
				name: region.name,
				parents: refParents(region.parents),
				enabled: region.enabled,
				indoors: region.indoors,
				lightLevel: region.lightLevel,
				defaultTileId: defaultTileRef(region.defaultTileId),
				passageOfTime: region.passageOfTime,
				faerieMorning: region.faerieMorning,
				fogOfWar: region.fogOfWar
			};

			save.add({
				kind: 'updateRegion',
				regionId: region.id,
				update,
				loaded: loadedFor(loadedRegion, update)
			}, (refusal) =>
			{
				this.showRefusal(refusal, fallback);
			});
		}

		const builders = [...region.builderIds].sort().join(',');

		if ((universe !== undefined) && editsEveryPlace(universe.role) && (builders !== [...loadedRegion.builderIds].sort().join(',')))
		{
			save.add({
				kind: 'assignBuilders',
				regionId: regionRef,
				builderIds: region.builderIds
			}, (refusal) =>
			{
				this.showRefusal(refusal, fallback);
			});
		}
	}

	/**
	 * Shows why a save was refused in the region editor, when it is open
	 *
	 * @param refusal Why
	 * @param fallback What to say when the server said nothing more
	 * @return False when the region editor isn't open
	 */
	showRefusal(refusal: SaveRefusal, fallback: Parameters<typeof describeEditorError>[1]): boolean
	{
		if (this.view.hidden)
		{
			return(false);
		}

		showMessage(this.error, describeEditorError(refusal.error, fallback));

		if (refusal.placeProblems)
		{
			const universe = this.host.universe();
			const named = refusal.placeProblems.names;
			const ours = this.host.names();

			this.problemList.replaceChildren(...refusal.placeProblems.problems.map((problem) =>
			{
				const item = document.createElement('li');

				item.textContent = describeProblem(problem, (place) => (named[placeKey(place)] ?? ours(place)), this.host.tiles(), (universe?.ruleset ?? 'pf1e'));

				return(item);
			}));
			this.problems.hidden = (refusal.placeProblems.problems.length === 0);
		}

		return(true);
	}

	/**
	 * Takes the region open as saved
	 *
	 * @param savedIds The IDs the save gave the regions and areas it made, by the IDs they had on the page
	 * @return The region open, by its saved ID, or undefined when none was
	 */
	saved(savedIds: ReadonlyMap<string, string>): string | undefined
	{
		const id = this.collectedId;

		this.collectedId = undefined;

		if ((id === undefined) || this.view.hidden)
		{
			return(undefined);
		}

		this.parents.replaceIds(savedIds);

		return(savedIds.get(id) ?? id);
	}

	/**
	 * Shows the region open as the save left it
	 *
	 * @param universe The universe
	 * @param regionId The region's ID
	 */
	showAfterSave(universe: EditableUniverse, regionId: string): void
	{
		this.show(universe, regionId);
	}

	/**
	 * Follows a save made in another window to the region open while it has unsaved changes here: keeps
	 * them, saying above its settings what the save changed
	 *
	 * @param save The save
	 * @param changed What the save changed on the Areas tab
	 * @return True when the save changed the region open while it had unsaved changes here
	 */
	otherSaved(save: OtherSave, changed: readonly SavedEditDetail[]): boolean
	{
		const region = this.region;

		if (!region || this.view.hidden || !this.changes.hasUnsavedChanges())
		{
			return(false);
		}

		const about = changed.filter((detail) => ((detail.subject === 'region') && (detail.id === region.id)));

		if (about.length === 0)
		{
			return(false);
		}

		this.changedSince.add(save.name, about);

		return(true);
	}

	/**
	 * Shows the region open afresh, once the tab has loaded the regions again after another window
	 * saved, unless it has unsaved changes here; a region the save deleted goes back to the list
	 */
	reshow(): void
	{
		const region = this.region;
		const universe = this.host.universe();

		if (!region || !universe || this.view.hidden || this.changes.hasUnsavedChanges())
		{
			return;
		}

		this.show(universe, region.id);
	}
}
