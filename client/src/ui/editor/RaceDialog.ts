import { canEditUniverseSettings, DISALLOWED_TEXT_CHARACTERS, emptyPf1eAbilityScores, emptyPf1eMoney, MAX_RACE_NAME_LENGTH, NEW_PF1E_RACE_RULES, PF1E_ABILITIES, PF1E_ABILITY_NAMES, PF1E_FLOATING_ABILITY_BONUS, PF1E_MAX_RACE_ABILITY_MODIFIER, PF1E_MIN_RACE_ABILITY_MODIFIER, PF1E_SIZE_NAMES, PF1E_SIZES, type EditableUniverse, type EditorRace, type MessageDescriptor, type Pf1eAbility, type Pf1eAbilityScores, type Pf1eSize, type RaceSettings } from '@multiverse-kiln/shared';
import restoreIcon from 'virtual:icon/ph:arrow-counter-clockwise';
import trashIcon from 'virtual:icon/ph:trash';

import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { ChangeTracker } from '../changeTracker';
import { getElement, namedOptions, setButtonLabel, setOptions, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import { formatMoney, readMoneyField } from '../moneyField';
import { raceName } from '../raceAndClassNames';
import type { ItemSelectDialog } from './ItemSelectDialog';
import { startingZoneMessages } from './startingZoneMessages';
import { StartingItemsField } from './StartingItemsField';
import { ZoneChoice } from './ZoneChoice';
import type { ZoneSelectDialog } from './ZoneSelectDialog';

/**
 * The race editor: a dialog for a race's name, whether it is enabled, its rules, and what its
 * characters start with and where
 *
 * Saving a default race stores the universe's edited copy of it. The dialog can also delete a custom
 * race, or restore an edited default race
 */
export class RaceDialog
{
	private readonly dialog = getElement('race-dialog', HTMLDialogElement);
	private readonly form = getElement('race-form', HTMLFormElement);
	private readonly fields = getElement('race-fields', HTMLFieldSetElement);
	private readonly title = getElement('race-dialog-title', HTMLElement);
	private readonly name = getElement('race-name', HTMLInputElement);
	private readonly enabled = getElement('race-enabled', HTMLInputElement);
	private readonly floatingBonus = getElement('race-floating', HTMLInputElement);
	private readonly darkvision = getElement('race-darkvision', HTMLInputElement);
	private readonly size = getElement('race-size', HTMLSelectElement);
	private readonly startingMoney = getElement('race-money', HTMLInputElement);
	private readonly chooseItemsButton = getElement('race-items-choose', HTMLButtonElement);
	private readonly error = getElement('race-error', HTMLElement);
	private readonly removeButton = getElement('race-remove', HTMLButtonElement);
	private readonly cancelButton = getElement('race-cancel', HTMLButtonElement);
	private readonly saveButton = getElement('race-save', HTMLButtonElement);

	/**
	 * The field for each ability's modifier
	 */
	private readonly modifiers: Record<Pf1eAbility, HTMLInputElement>;

	private readonly startingItems: StartingItemsField;
	private readonly startingZone: ZoneChoice;

	/**
	 * Whether the race has changes that haven't been saved
	 */
	private readonly changes: ChangeTracker;

	private universe: EditableUniverse | undefined;

	/**
	 * The race being edited, or undefined for a new one
	 */
	private race: EditorRace | undefined;

	/**
	 * The universe's starting zone's name, which characters of a race without a zone start in
	 */
	private universeZoneName = '';

	/**
	 * Changes every time the dialog opens, so zone names that arrive for an earlier opening are ignored
	 */
	private openVersion = 0;

	/**
	 * Called after the race is saved, deleted or restored
	 */
	private onChanged: () => void = () => undefined;

	/**
	 * @param api The editor's API
	 * @param zoneSelect The dialog for choosing the starting zone
	 * @param itemSelect The dialog for choosing the starting equipment
	 */
	constructor(private readonly api: EditorApi, zoneSelect: ZoneSelectDialog, itemSelect: ItemSelectDialog)
	{
		this.name.maxLength = MAX_RACE_NAME_LENGTH;
		this.modifiers = createModifierFields(getElement('race-modifiers', HTMLElement));
		setOptions(this.size, namedOptions(PF1E_SIZES, PF1E_SIZE_NAMES));
		getElement('race-floating-hint', HTMLElement).textContent = t({
			id: 'editor.race.floatingBonusHint',
			defaultMessage: 'The player chooses one ability to get +{bonus, number}, as humans, half-elves and half-orcs do.',
			description: 'Explains the race editor\'s Floating ability bonus checkbox; {bonus} is how much the chosen ability score goes up'
		}, {
			bonus: PF1E_FLOATING_ABILITY_BONUS
		});

		this.startingItems = new StartingItemsField(api, itemSelect, {
			list: getElement('race-items', HTMLUListElement),
			none: getElement('race-items-none', HTMLElement),
			choose: this.chooseItemsButton
		}, () =>
		{
			this.changes.check();
		}, (message) =>
		{
			showMessage(this.error, message);
		});
		this.startingZone = new ZoneChoice(zoneSelect, {
			name: getElement('race-zone-name', HTMLElement),
			choose: getElement('race-zone-choose', HTMLButtonElement),
			clear: getElement('race-zone-clear', HTMLButtonElement)
		}, () => t(startingZoneMessages.universes, { zone: this.universeZoneName }), () =>
		{
			this.changes.check();
		});
		this.changes = new ChangeTracker({
			root: this.form,
			state: () => [this.startingItems.value, this.startingZone.value]
		});
		this.changes.guardDialog(this.dialog);

		for (const input of [this.name, this.startingMoney, ...Object.values(this.modifiers)])
		{
			input.addEventListener('input', () =>
			{
				setFieldError(input, undefined);
			});
		}

		this.cancelButton.addEventListener('click', () =>
		{
			if (this.changes.confirmDiscard())
			{
				this.dialog.close();
			}
		});

		this.removeButton.addEventListener('click', () =>
		{
			void this.remove();
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.save();
		});
	}

	/**
	 * Opens the dialog for a race, or for a new one
	 *
	 * @param universe The universe the race belongs to
	 * @param race The race, or undefined to add one
	 * @param onChanged Called after the race is saved, deleted or restored
	 */
	open(universe: EditableUniverse, race: EditorRace | undefined, onChanged: () => void): void
	{
		const editable = canEditUniverseSettings(universe.role);
		const name = (race ? raceName(race, universe.ruleset) : '');
		const rules = (race?.rules ?? NEW_PF1E_RACE_RULES);

		this.universe = universe;
		this.race = race;
		this.onChanged = onChanged;
		this.universeZoneName = '';

		if (!race)
		{
			this.title.textContent = t({
				id: 'editor.race.addTitle',
				defaultMessage: 'Add Race',
				description: 'Title of the race editor when making a new race'
			});
		}
		else if (editable)
		{
			this.title.textContent = t({
				id: 'editor.race.editTitle',
				defaultMessage: 'Edit {race}',
				description: 'Title of the race editor for a race the player can change; {race} is its name, e.g. Dwarf'
			}, {
				race: name
			});
		}
		else
		{
			this.title.textContent = name;
		}

		this.name.value = name;
		this.enabled.checked = (race?.enabled ?? true);

		for (const ability of PF1E_ABILITIES)
		{
			this.modifiers[ability].value = String(rules.abilityModifiers[ability]);
		}

		this.floatingBonus.checked = rules.floatingBonus;
		this.darkvision.checked = rules.darkvision;
		this.size.value = rules.size;
		this.startingMoney.value = formatMoney(race?.startingMoney ?? emptyPf1eMoney());
		this.startingZone.show(universe, (race?.startingZoneId ?? null), editable);
		this.fields.disabled = false;
		this.saveButton.hidden = !editable;
		this.saveButton.disabled = false;
		this.chooseItemsButton.hidden = !editable;
		this.cancelButton.textContent = t(editable ? formMessages.cancel : formMessages.close);

		// Only the inputs are locked for a player who can't edit, so Close still works
		for (const input of [this.name, this.enabled, this.floatingBonus, this.darkvision, this.size, this.startingMoney, ...Object.values(this.modifiers)])
		{
			input.disabled = !editable;
		}

		this.removeButton.hidden = (!editable || !race || (!race.custom && !race.edited));
		if (race?.custom)
		{
			setButtonLabel(this.removeButton, trashIcon, t({
				id: 'editor.race.delete',
				defaultMessage: 'Delete Race',
				description: 'Button in the race editor that deletes a race made for this universe'
			}));
		}
		else
		{
			setButtonLabel(this.removeButton, restoreIcon, t({
				id: 'editor.race.restore',
				defaultMessage: 'Restore Default',
				description: 'Button in the race editor that undoes this universe\'s changes to one of the ruleset\'s races'
			}));
		}

		showMessage(this.error, undefined);
		clearFieldErrors(this.dialog);
		void this.startingItems.show(universe, (race?.startingItems ?? []));
		void this.loadZoneNames(universe);
		this.dialog.showModal();
		this.changes.markSaved();
	}

	/**
	 * Loads the zones' names, for the race's starting zone and the universe's
	 *
	 * @param universe The universe
	 */
	private async loadZoneNames(universe: EditableUniverse): Promise<void>
	{
		const version = ++this.openVersion;

		try
		{
			const { zones } = await this.api.listZones(universe.id);

			if (version === this.openVersion)
			{
				const names = new Map(zones.map((zone) => [zone.id, zone.name]));

				this.universeZoneName = ((universe.startingZoneId === null) ? '' : (names.get(universe.startingZoneId) ?? ''));
				this.startingZone.setZoneNames(names);
			}
		}
		catch (error)
		{
			if (version === this.openVersion)
			{
				showMessage(this.error, describeEditorError(error, startingZoneMessages.loadFailed));
			}
		}
	}

	/**
	 * Saves the race as the form shows it
	 */
	private async save(): Promise<void>
	{
		const universe = this.universe;
		const name = this.name.value.trim();

		if (!universe)
		{
			return;
		}

		if ((name === '') || DISALLOWED_TEXT_CHARACTERS.test(name))
		{
			reportFieldError(this.name, t(formMessages.invalidText));
			return;
		}

		const abilityModifiers = readModifierFields(this.modifiers);

		if (abilityModifiers === undefined)
		{
			return;
		}

		const startingMoney = readMoneyField(this.startingMoney);

		if (startingMoney === undefined)
		{
			return;
		}

		// A default race whose name wasn't changed keeps the ruleset's, which players read in their own language
		const defaultName = ((this.race && !this.race.custom) ? raceName({ key: this.race.key, name: null }, universe.ruleset) : undefined);
		const settings: RaceSettings = {
			name: ((name === defaultName) ? null : name),
			enabled: this.enabled.checked,
			startingMoney,
			startingItems: this.startingItems.value,
			startingZoneId: this.startingZone.value,
			rules: {
				abilityModifiers,
				floatingBonus: this.floatingBonus.checked,
				darkvision: this.darkvision.checked,
				size: this.size.value as Pf1eSize
			}
		};

		await this.run({
			id: 'editor.race.saveFailed',
			defaultMessage: 'Could not save the race.',
			description: 'Shown in the race editor when the race couldn\'t be stored'
		}, async () =>
		{
			if (this.race)
			{
				await this.api.saveRace(universe.id, this.race.id, settings);
			}
			else
			{
				await this.api.createRace(universe.id, settings);
			}
		});
	}

	/**
	 * Deletes a custom race, or restores an edited default race
	 */
	private async remove(): Promise<void>
	{
		const universe = this.universe;
		const race = this.race;

		if (!universe || !race)
		{
			return;
		}

		const name = raceName(race, universe.ruleset);
		let question: string;
		let failure: MessageDescriptor;

		if (race.custom)
		{
			question = t({
				id: 'editor.race.confirmDelete',
				defaultMessage: 'Delete {race}? This can\'t be undone.',
				description: 'Asks before deleting a race made for this universe; {race} is its name'
			}, {
				race: name
			});
			failure = {
				id: 'editor.race.deleteFailed',
				defaultMessage: 'Could not delete the race.',
				description: 'Shown in the race editor when the race couldn\'t be deleted'
			};
		}
		else
		{
			question = t({
				id: 'editor.race.confirmRestore',
				defaultMessage: 'Restore {race} to the ruleset\'s default? Your changes to it, including its starting money, equipment and zone, will be lost.',
				description: 'Asks before undoing this universe\'s changes to one of the ruleset\'s races; {race} is its name'
			}, {
				race: name
			});
			failure = {
				id: 'editor.race.restoreFailed',
				defaultMessage: 'Could not restore the race.',
				description: 'Shown in the race editor when the ruleset\'s race couldn\'t be restored'
			};
		}

		if (!window.confirm(question))
		{
			return;
		}

		await this.run(failure, () => this.api.deleteRace(universe.id, race.id));
	}

	/**
	 * Makes a change, closing the dialog when it succeeds and explaining in it when it doesn't
	 *
	 * @param failure What failed, as a sentence, for the error message
	 * @param change The change
	 */
	private async run(failure: MessageDescriptor, change: () => Promise<void>): Promise<void>
	{
		this.fields.disabled = true;
		showMessage(this.error, undefined);

		try
		{
			await change();
			this.dialog.close();
			this.onChanged();
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, failure));
		}
		finally
		{
			this.fields.disabled = false;
		}
	}
}

/**
 * Adds a number field for each ability's modifier
 *
 * @param container Where the fields go
 * @return The fields, by ability
 */
function createModifierFields(container: HTMLElement): Record<Pf1eAbility, HTMLInputElement>
{
	const fields = {} as Record<Pf1eAbility, HTMLInputElement>;

	for (const ability of PF1E_ABILITIES)
	{
		const label = document.createElement('label');
		const input = document.createElement('input');

		input.type = 'number';
		input.min = String(PF1E_MIN_RACE_ABILITY_MODIFIER);
		input.max = String(PF1E_MAX_RACE_ABILITY_MODIFIER);
		input.step = '1';
		input.required = true;
		label.append(t(PF1E_ABILITY_NAMES[ability]), input);
		container.append(label);
		fields[ability] = input;
	}

	return(fields);
}

/**
 * Reads the ability modifier fields, reporting the first that isn't a whole number in range
 *
 * @param fields The fields, by ability
 * @return The modifiers, or undefined when one is wrong
 */
function readModifierFields(fields: Record<Pf1eAbility, HTMLInputElement>): Pf1eAbilityScores | undefined
{
	const modifiers = emptyPf1eAbilityScores();

	for (const ability of PF1E_ABILITIES)
	{
		const field = fields[ability];
		const value = Number(field.value);

		if ((field.value.trim() === '') || !Number.isInteger(value) || (value < PF1E_MIN_RACE_ABILITY_MODIFIER) || (value > PF1E_MAX_RACE_ABILITY_MODIFIER))
		{
			reportFieldError(field, t(formMessages.wholeNumber, {
				min: PF1E_MIN_RACE_ABILITY_MODIFIER,
				max: PF1E_MAX_RACE_ABILITY_MODIFIER
			}));
			return(undefined);
		}

		modifiers[ability] = value;
	}

	return(modifiers);
}
