import { canEditUniverseSettings, canEditWorld, FAERIE_MORNING_NAMES, loadedFor, FAERIE_MORNINGS, LOBBY_PASSAGES_OF_TIME, lobbyAreaIds, lobbyProblems, MAX_LOBBY_DAY_HOURS, MIN_LOBBY_DAY_HOURS, PASSAGE_OF_TIME_NAMES, PlaceGraph, REAL_TIME_NAME, type AreaListPayload, type EditableUniverse, type FaerieMorning, type LobbyPassageOfTime, type UniverseSettingsUpdate } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { ChangeTracker, type FormSnapshot } from '../changeTracker';
import { getElement, namedOptions, setOptions, showMessage, type SelectOption } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import { AreaChoice } from './AreaChoice';
import type { AreaSelectDialog } from './AreaSelectDialog';
import type { EditorSave } from './editorSave';
import type { SavableTab } from './SaveBar';
import { startingAreaMessages } from './startingAreaMessages';

/**
 * The Lobby tab's settings: the lobby region, whose areas players walk in the lobby, the square they
 * start on, and how the time of day changes in the lobby
 */
export class LobbyTab implements SavableTab
{
	private readonly form = getElement('lobby-form', HTMLFormElement);
	private readonly region = getElement('lobby-region', HTMLSelectElement);
	private readonly area: AreaChoice;
	private readonly noAreaHint = getElement('lobby-no-area-hint', HTMLElement);
	private readonly fields = getElement('lobby-fields', HTMLFieldSetElement);
	private readonly time = getElement('lobby-time', HTMLSelectElement);
	private readonly dayHoursField = getElement('lobby-day-hours-field', HTMLElement);
	private readonly dayHours = getElement('lobby-day-hours', HTMLInputElement);
	private readonly dayHoursHint = getElement('lobby-day-hours-hint', HTMLElement);
	private readonly faerieField = getElement('lobby-faerie-field', HTMLElement);
	private readonly faerie = getElement('lobby-faerie', HTMLSelectElement);
	private readonly error = getElement('lobby-error', HTMLElement);

	/**
	 * Whether the form has changes that haven't been saved
	 */
	readonly changes: ChangeTracker;

	/**
	 * The universe as it was last loaded or saved
	 */
	private universe: EditableUniverse | undefined;

	/**
	 * The universe's regions, areas, links and starting areas as saved, once they have loaded
	 */
	private list: AreaListPayload | undefined;

	/**
	 * The universe's disabled areas, once they have loaded
	 */
	private disabledAreaIds: ReadonlySet<string> = new Set();

	/**
	 * The settings the save being sent holds, and the form as it collected them
	 */
	private collected: { update: UniverseSettingsUpdate; form: FormSnapshot } | undefined;

	/**
	 * Changes every time a universe is opened, so area names that arrive for an earlier one are ignored
	 */
	private version = 0;

	/**
	 * @param api The editor's API
	 * @param areaSelect The dialog for choosing the lobby's starting square
	 * @param onSaved Called with the lobby settings saved, once they are
	 */
	constructor(private readonly api: EditorApi, areaSelect: AreaSelectDialog, private readonly onSaved: (update: UniverseSettingsUpdate) => void)
	{
		this.area = new AreaChoice(areaSelect, {
			name: getElement('lobby-area-name', HTMLElement),
			choose: getElement('lobby-area-choose', HTMLButtonElement),
			clear: getElement('lobby-area-clear', HTMLButtonElement)
		}, () => t({
			id: 'editor.lobby.noSquare',
			defaultMessage: 'None',
			description: 'Shown on the editor\'s Lobby tab as the lobby\'s starting square when it has none, so the lobby has no area to walk around'
		}), (area) =>
		{
			if (area)
			{
				const disabled = new Set(this.disabledAreaIds);

				if (area.resolved.enabled)
				{
					disabled.delete(area.id);
				}
				else
				{
					disabled.add(area.id);
				}

				this.disabledAreaIds = disabled;
			}

			this.showNoAreaHint();
			this.changes.check();
		}, 'lobby');
		this.changes = new ChangeTracker({
			root: this.form,
			state: () => [this.area.value, this.area.cell]
		});

		setOptions(this.time, LOBBY_PASSAGES_OF_TIME.map((passage) => ({
			value: passage,
			label: t((passage === 'real_time') ? REAL_TIME_NAME : PASSAGE_OF_TIME_NAMES[passage])
		})));
		setOptions(this.faerie, namedOptions(FAERIE_MORNINGS, FAERIE_MORNING_NAMES));
		this.dayHours.min = String(MIN_LOBBY_DAY_HOURS);
		this.dayHours.max = String(MAX_LOBBY_DAY_HOURS);
		this.dayHoursHint.textContent = t({
			id: 'editor.lobby.dayHoursHint',
			defaultMessage: 'How long in real time it takes for one day in the lobby to pass, from {min, plural, one {# hour} other {# hours}} to {max, plural, one {# hour} other {# hours}}. The time of day is the same for everyone, counted from the start of 1970.',
			description: 'Explains the lobby\'s "How quickly?" field; {min} and {max} are the fewest and most hours allowed'
		}, {
			min: MIN_LOBBY_DAY_HOURS,
			max: MAX_LOBBY_DAY_HOURS
		});

		this.region.addEventListener('change', () =>
		{
			this.regionChanged();
		});

		this.time.addEventListener('change', () =>
		{
			this.showTimeFields();
		});

		this.dayHours.addEventListener('input', () =>
		{
			setFieldError(this.dayHours, undefined);
		});
	}

	/**
	 * Shows a universe's lobby settings, read-only unless the player's role may change them
	 *
	 * @param universe The universe
	 */
	open(universe: EditableUniverse): void
	{
		this.universe = universe;
		this.list = undefined;
		this.disabledAreaIds = new Set();
		this.fillRegions(universe.lobbyRegionId);
		this.area.setLobbyRegion(universe.lobbyRegionId);
		this.area.show(universe, universe.lobbyAreaId, {
			column: universe.lobbyColumn,
			row: universe.lobbyRow
		}, this.canSave());
		this.showNoAreaHint();
		void this.loadAreas(universe);
		this.time.value = universe.lobbyPassageOfTime;
		this.dayHours.value = String(universe.lobbyDayHours);
		this.faerie.value = (universe.lobbyFaerieMorning ?? FAERIE_MORNINGS[0]);
		this.showTimeFields();
		this.region.disabled = !this.canSave();
		this.fields.disabled = !this.canSave();
		showMessage(this.error, undefined);
		clearFieldErrors(this.form);
		this.changes.markSaved();
	}

	/**
	 * Loads the areas again, so the lobby region and starting square show their current names, and which
	 * regions can be the lobby region
	 */
	refreshAreas(): void
	{
		if (this.universe)
		{
			void this.loadAreas(this.universe);
		}
	}

	/**
	 * The lobby region chosen
	 *
	 * @return Its ID, or null for none
	 */
	private regionValue(): string | null
	{
		return(((this.region.value === '') ? null : this.region.value));
	}

	/**
	 * Loads the regions and areas: their names, which areas are disabled, and the links and starting areas
	 * that keep regions from being the lobby region
	 *
	 * @param universe The universe
	 */
	private async loadAreas(universe: EditableUniverse): Promise<void>
	{
		const version = ++this.version;

		// Only roles that change the world may load the areas (see shared/src/editor.ts)
		if (!canEditWorld(universe.role))
		{
			return;
		}

		try
		{
			const list = await this.api.listAreas(universe.id);

			if (version === this.version)
			{
				// A choice made while they loaded is kept, and so is whether it is saved
				const unsaved = this.changes.hasUnsavedChanges();

				this.list = list;
				this.disabledAreaIds = new Set(list.areas
					.filter((area) => !area.resolved.enabled)
					.map((area) => area.id));
				this.area.setAreaNames(new Map(list.areas.map((area) => [area.id, area.name])));
				this.fillRegions(this.regionValue());
				this.showNoAreaHint();

				if (!unsaved)
				{
					this.changes.markSaved();
				}
			}
		}
		catch (error)
		{
			if (version === this.version)
			{
				showMessage(this.error, describeEditorError(error, startingAreaMessages.loadFailed));
			}
		}
	}

	/**
	 * Lists the regions that can be the lobby region, by name, after No Lobby Region. Those with a starting
	 * area below them or links leading out of them are listed but can't be chosen, saying why; the one
	 * saved stays a choice
	 *
	 * @param selected The region to choose, or null for none
	 */
	private fillRegions(selected: string | null): void
	{
		const list = this.list;
		const saved = (this.universe?.lobbyRegionId ?? null);
		const options: SelectOption[] = [{
			value: '',
			label: t({
				id: 'editor.lobby.noRegion',
				defaultMessage: 'No Lobby Region',
				description: 'Choice of the lobby region on the editor\'s Lobby tab that leaves the universe without a lobby to walk in: players only chat and choose their characters'
			})
		}];

		if (list)
		{
			const graph = new PlaceGraph(list.regions, list.areas);
			const regions = [...list.regions].sort((first, second) => first.name.localeCompare(second.name));

			for (const region of regions)
			{
				const problems = lobbyProblems(graph, { lobbyRegionId: region.id, lobbyAreaId: null, faerie: false }, list.links, list.startingAreaIds);
				const reason = (problems.some((problem) => (problem.kind === 'lobbyStartingArea'))
					? 'starting'
					: (problems.some((problem) => (problem.kind === 'lobbyLink')) ? 'links' : undefined));

				options.push({
					value: region.id,
					label: ((reason === undefined)
						? region.name
						: t({
							id: 'editor.lobby.regionLeftOut',
							defaultMessage: '{region} ({reason, select, starting {characters start in an area below it} other {links lead out of it}})',
							description: 'A region in the editor Lobby tab\'s choice of the lobby region that can\'t be chosen, and why: {region} is its name, and {reason} is "starting" when characters start in an area below it, or otherwise links lead from its areas to areas outside it. The lobby areas are never connected to the rest of the world'
						}, {
							region: region.name,
							reason
						})),
					disabled: ((reason !== undefined) && (region.id !== saved))
				});
			}
		}
		else if (selected !== null)
		{
			// Named once the regions load
			options.push({ value: selected, label: '' });
		}

		setOptions(this.region, options);
		this.region.value = (selected ?? '');
	}

	/**
	 * Follows another lobby region being chosen: the starting square goes unless its area is below the
	 * new one too
	 */
	private regionChanged(): void
	{
		const regionId = this.regionValue();
		const areaId = this.area.value;

		this.area.setLobbyRegion(regionId);

		if ((areaId !== null) && (!this.list || !lobbyAreaIds(new PlaceGraph(this.list.regions, this.list.areas), regionId).has(areaId)))
		{
			this.area.clear();
		}

		this.showNoAreaHint();
		this.changes.check();
	}

	/**
	 * Whether the player may change the lobby's settings
	 *
	 * @return True for a creator
	 */
	canSave(): boolean
	{
		return((this.universe !== undefined) && canEditUniverseSettings(this.universe.role));
	}

	/**
	 * Explains that the lobby has no area to walk around, while it has no lobby region or starting square,
	 * or the starting square's area is disabled
	 */
	private showNoAreaHint(): void
	{
		const areaId = this.area.value;
		const reason = ((this.regionValue() === null) ? 'noRegion' : ((areaId === null) ? 'none' : (this.disabledAreaIds.has(areaId) ? 'disabled' : undefined)));

		this.area.setEnabled(this.regionValue() !== null);

		if (reason === undefined)
		{
			showMessage(this.noAreaHint, undefined);
			return;
		}

		showMessage(this.noAreaHint, t({
			id: 'editor.lobby.noAreaHint',
			defaultMessage: '{reason, select, noRegion {Without a lobby region, players only chat and choose their characters.} disabled {The area of the lobby\'s starting square is disabled, so players only chat and choose their characters.} other {Without a starting square, players only chat and choose their characters.}}',
			description: 'Shown on the editor\'s Lobby tab when the lobby has no area to walk around: {reason} is "noRegion" when no lobby region is chosen, "disabled" when the area of its starting square is disabled, and otherwise it has no starting square'
		}, {
			reason
		}));
	}

	/**
	 * Shows the day length for real time, and where morning is for faerie time
	 */
	private showTimeFields(): void
	{
		const realTime = (this.time.value === 'real_time');

		this.dayHoursField.hidden = !realTime;
		this.dayHoursHint.hidden = !realTime;
		this.dayHours.required = realTime;
		this.faerieField.hidden = (this.time.value !== 'faerie');
	}

	/**
	 * Adds the settings as the form shows them to a save
	 *
	 * @param save The save
	 * @return False when a field is wrong
	 */
	collect(save: EditorSave): boolean
	{
		const universe = this.universe;
		const lobbyPassageOfTime = this.time.value as LobbyPassageOfTime;
		const lobbyDayHours = Number(this.dayHours.value);

		if (!universe)
		{
			return(false);
		}

		if ((lobbyPassageOfTime === 'real_time') && (!Number.isInteger(lobbyDayHours) || (lobbyDayHours < MIN_LOBBY_DAY_HOURS) || (lobbyDayHours > MAX_LOBBY_DAY_HOURS) || (this.dayHours.value.trim() === '')))
		{
			reportFieldError(this.dayHours, t(formMessages.wholeNumber, {
				min: MIN_LOBBY_DAY_HOURS,
				max: MAX_LOBBY_DAY_HOURS
			}));
			return(false);
		}

		const update: Required<Pick<UniverseSettingsUpdate, 'lobbyRegionId' | 'lobbyAreaId' | 'lobbyColumn' | 'lobbyRow' | 'lobbyPassageOfTime' | 'lobbyFaerieMorning'>> & Pick<UniverseSettingsUpdate, 'lobbyDayHours'> = {
			lobbyRegionId: this.regionValue(),
			lobbyAreaId: this.area.value,
			lobbyColumn: this.area.cell.column,
			lobbyRow: this.area.cell.row,
			lobbyPassageOfTime,
			lobbyFaerieMorning: ((lobbyPassageOfTime === 'faerie') ? this.faerie.value as FaerieMorning : null),
			// A day length typed while another passage of time is chosen isn't kept
			...((lobbyPassageOfTime === 'real_time') ? { lobbyDayHours } : {})
		};

		showMessage(this.error, undefined);
		this.collected = {
			update,
			form: this.changes.snapshot()
		};
		save.add({ kind: 'universe', update, loaded: loadedFor(this.universe, update) }, (refusal) =>
		{
			showMessage(this.error, describeEditorError(refusal.error, {
				id: 'editor.lobby.saveFailed',
				defaultMessage: 'Could not save the lobby\'s settings.',
				description: 'Shown on the Lobby tab when the server refused its settings, followed by why; nothing was saved'
			}));
		});

		return(true);
	}

	/**
	 * Takes the settings as saved. Changes made while the save was sent stay unsaved
	 */
	saved(): void
	{
		const universe = this.universe;
		const collected = this.collected;

		this.collected = undefined;

		if (universe && collected)
		{
			this.universe = { ...universe, ...collected.update };

			if (this.changes.changedSince(collected.form))
			{
				this.changes.markSaved(collected.form);
			}
			else
			{
				this.dayHours.value = String(this.universe.lobbyDayHours);
				this.changes.markSaved();
			}

			this.onSaved(collected.update);
			this.refreshAreas();
		}
	}
}
