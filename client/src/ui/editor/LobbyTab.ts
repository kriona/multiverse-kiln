import { canEditUniverseSettings, FAERIE_MORNING_NAMES, FAERIE_MORNINGS, LOBBY_PASSAGES_OF_TIME, MAX_LOBBY_DAY_HOURS, MIN_LOBBY_DAY_HOURS, PASSAGE_OF_TIME_NAMES, REAL_TIME_NAME, type EditableUniverse, type FaerieMorning, type LobbyPassageOfTime, type UniverseSettingsUpdate } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { ChangeTracker } from '../changeTracker';
import { getElement, namedOptions, setOptions, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import type { SavableTab } from './SaveBar';

/**
 * The Lobby tab's settings: how the time of day changes in the lobby, and whether its tiles have a
 * vision cost
 */
export class LobbyTab implements SavableTab
{
	private readonly form = getElement('lobby-form', HTMLFormElement);
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
	readonly changes = new ChangeTracker({ root: this.form });

	/**
	 * The universe as it was last loaded or saved
	 */
	private universe: EditableUniverse | undefined;

	/**
	 * @param api The editor's API
	 * @param onSaved Called with the universe after its lobby settings are saved
	 */
	constructor(private readonly api: EditorApi, private readonly onSaved: (universe: EditableUniverse) => void)
	{
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
	 * Whether the player may change the lobby's settings
	 *
	 * @return True for a creator
	 */
	canSave(): boolean
	{
		return((this.universe !== undefined) && canEditUniverseSettings(this.universe.role));
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
	 * Saves the settings as the form shows them
	 *
	 * @return True when they were saved
	 */
	async save(): Promise<boolean>
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

		const update: Required<Pick<UniverseSettingsUpdate, 'lobbyPassageOfTime' | 'lobbyFaerieMorning' | 'lobbyNoVisionCost'>> & Pick<UniverseSettingsUpdate, 'lobbyDayHours'> = {
			lobbyPassageOfTime,
			lobbyFaerieMorning: ((lobbyPassageOfTime === 'faerie') ? this.faerie.value as FaerieMorning : null),
			lobbyNoVisionCost: this.noVisionCost.checked,
			// A day length typed while another passage of time is chosen isn't kept
			...((lobbyPassageOfTime === 'real_time') ? { lobbyDayHours } : {})
		};

		showMessage(this.error, undefined);

		try
		{
			await this.api.updateUniverse(universe.id, update);
			this.universe = { ...universe, ...update };
			this.dayHours.value = String(this.universe.lobbyDayHours);
			this.changes.markSaved();
			this.onSaved(this.universe);

			return(true);
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, {
				id: 'editor.lobby.saveFailed',
				defaultMessage: 'Could not save the lobby\'s settings.',
				description: 'Shown on the Lobby tab when its settings couldn\'t be stored'
			}));

			return(false);
		}
	}
}
