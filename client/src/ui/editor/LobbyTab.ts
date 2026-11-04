import { canEditUniverseSettings, FAERIE_MORNING_NAMES, FAERIE_MORNINGS, LOBBY_PASSAGES_OF_TIME, MAX_LOBBY_DAY_HOURS, MIN_LOBBY_DAY_HOURS, PASSAGE_OF_TIME_NAMES, REAL_TIME_NAME, type EditableUniverse, type FaerieMorning, type LobbyPassageOfTime, type UniverseSettingsUpdate } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { ChangeTracker } from '../changeTracker';
import { getElement, namedOptions, setOptions, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import { AreaChoice } from './AreaChoice';
import type { AreaSelectDialog } from './AreaSelectDialog';
import type { EditorSave } from './editorSave';
import type { SavableTab } from './SaveBar';
import { startingAreaMessages } from './startingAreaMessages';

/**
 * The Lobby tab's settings: the area players walk around in the lobby and the square they start on, how
 * the time of day changes in the lobby, and whether its tiles have a vision cost
 */
export class LobbyTab implements SavableTab
{
	private readonly form = getElement('lobby-form', HTMLFormElement);
	private readonly area: AreaChoice;
	private readonly noMapHint = getElement('lobby-no-map-hint', HTMLElement);
	private readonly fields = getElement('lobby-fields', HTMLFieldSetElement);
	private readonly time = getElement('lobby-time', HTMLSelectElement);
	private readonly dayHoursField = getElement('lobby-day-hours-field', HTMLElement);
	private readonly dayHours = getElement('lobby-day-hours', HTMLInputElement);
	private readonly dayHoursHint = getElement('lobby-day-hours-hint', HTMLElement);
	private readonly faerieField = getElement('lobby-faerie-field', HTMLElement);
	private readonly faerie = getElement('lobby-faerie', HTMLSelectElement);
	private readonly noVisionCost = getElement('lobby-no-vision-cost', HTMLInputElement);
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
	 * The universe's disabled areas, once they have loaded
	 */
	private disabledAreaIds: ReadonlySet<string> = new Set();

	/**
	 * The settings the save being sent holds
	 */
	private collected: UniverseSettingsUpdate | undefined;

	/**
	 * Changes every time a universe is opened, so area names that arrive for an earlier one are ignored
	 */
	private version = 0;

	/**
	 * @param api The editor's API
	 * @param areaSelect The dialog for choosing the lobby's area
	 * @param onSaved Called with the lobby settings saved, once they are
	 */
	constructor(private readonly api: EditorApi, areaSelect: AreaSelectDialog, private readonly onSaved: (update: UniverseSettingsUpdate) => void)
	{
		this.area = new AreaChoice(areaSelect, {
			name: getElement('lobby-area-name', HTMLElement),
			choose: getElement('lobby-area-choose', HTMLButtonElement),
			clear: getElement('lobby-area-clear', HTMLButtonElement)
		}, () => t({
			id: 'editor.lobby.noArea',
			defaultMessage: 'None',
			description: 'Shown on the editor\'s Lobby tab as the lobby\'s area when it has none, so the lobby has no map'
		}), (area) =>
		{
			if (area)
			{
				const disabled = new Set(this.disabledAreaIds);

				if (area.enabled)
				{
					disabled.delete(area.id);
				}
				else
				{
					disabled.add(area.id);
				}

				this.disabledAreaIds = disabled;
			}

			this.showNoMapHint();
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
		this.disabledAreaIds = new Set();
		this.area.show(universe, universe.lobbyAreaId, {
			column: universe.lobbyColumn,
			row: universe.lobbyRow
		}, this.canSave());
		this.showNoMapHint();
		void this.loadAreas(universe);
		this.time.value = universe.lobbyPassageOfTime;
		this.dayHours.value = String(universe.lobbyDayHours);
		this.faerie.value = (universe.lobbyFaerieMorning ?? FAERIE_MORNINGS[0]);
		this.noVisionCost.checked = universe.lobbyNoVisionCost;
		this.showTimeFields();
		this.fields.disabled = !this.canSave();
		showMessage(this.error, undefined);
		clearFieldErrors(this.form);
		this.changes.markSaved();
	}

	/**
	 * Loads the areas again, so the lobby's area shows its current name and whether it is disabled
	 */
	refreshAreas(): void
	{
		if (this.universe)
		{
			void this.loadAreas(this.universe);
		}
	}

	/**
	 * Loads the areas' names, for the lobby's area, and which areas are disabled
	 *
	 * @param universe The universe
	 */
	private async loadAreas(universe: EditableUniverse): Promise<void>
	{
		const version = ++this.version;

		try
		{
			const { areas } = await this.api.listAreas(universe.id);

			if (version === this.version)
			{
				this.disabledAreaIds = new Set(areas
					.filter((area) => !area.enabled)
					.map((area) => area.id));
				this.area.setAreaNames(new Map(areas.map((area) => [area.id, area.name])));
				this.showNoMapHint();
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
	 * Whether the player may change the lobby's settings
	 *
	 * @return True for a creator
	 */
	canSave(): boolean
	{
		return((this.universe !== undefined) && canEditUniverseSettings(this.universe.role));
	}

	/**
	 * Explains that the lobby has no map, while it has no area or its area is disabled
	 */
	private showNoMapHint(): void
	{
		const areaId = this.area.value;

		if ((areaId !== null) && !this.disabledAreaIds.has(areaId))
		{
			showMessage(this.noMapHint, undefined);
			return;
		}

		showMessage(this.noMapHint, t({
			id: 'editor.lobby.noMapHint',
			defaultMessage: '{reason, select, disabled {The lobby\'s area is disabled, so players only chat and choose their characters.} other {Without a lobby area, players only chat and choose their characters.}}',
			description: 'Shown on the editor\'s Lobby tab when the lobby has no map to walk around: {reason} is "disabled" when its area is disabled, and otherwise it has no area'
		}, {
			reason: ((areaId === null) ? 'none' : 'disabled')
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

		const update: Required<Pick<UniverseSettingsUpdate, 'lobbyAreaId' | 'lobbyColumn' | 'lobbyRow' | 'lobbyPassageOfTime' | 'lobbyFaerieMorning' | 'lobbyNoVisionCost'>> & Pick<UniverseSettingsUpdate, 'lobbyDayHours'> = {
			lobbyAreaId: this.area.value,
			lobbyColumn: this.area.cell.column,
			lobbyRow: this.area.cell.row,
			lobbyPassageOfTime,
			lobbyFaerieMorning: ((lobbyPassageOfTime === 'faerie') ? this.faerie.value as FaerieMorning : null),
			lobbyNoVisionCost: this.noVisionCost.checked,
			// A day length typed while another passage of time is chosen isn't kept
			...((lobbyPassageOfTime === 'real_time') ? { lobbyDayHours } : {})
		};

		showMessage(this.error, undefined);
		this.collected = update;
		save.add({ kind: 'universe', update }, (refusal) =>
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
	 * Takes the settings as saved
	 */
	saved(): void
	{
		const universe = this.universe;
		const update = this.collected;

		this.collected = undefined;

		if (universe && update)
		{
			this.universe = { ...universe, ...update };
			this.dayHours.value = String(this.universe.lobbyDayHours);
			this.changes.markSaved();
			this.onSaved(update);
		}
	}
}
