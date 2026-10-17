import { canEditUniverseSettings, DISALLOWED_TEXT_CHARACTERS, emptyPf1eMoney, MAX_CLASS_NAME_LENGTH, NEW_PF1E_CLASS_RULES, PF1E_ABILITIES, PF1E_ABILITY_NAMES, PF1E_CASTING_STYLE_NAMES, PF1E_CASTING_STYLES, PF1E_MAGIC_TRADITION_NAMES, PF1E_MAGIC_TRADITIONS, type ClassRaceZone, type ClassSettings, type EditableUniverse, type EditorClass, type EditorRace, type MessageDescriptor, type Pf1eAbility, type Pf1eCastingStyle, type Pf1eMagicTradition } from '@multiverse-kiln/shared';
import mapPinIcon from 'virtual:icon/ph:map-pin';
import restoreIcon from 'virtual:icon/ph:arrow-counter-clockwise';
import trashIcon from 'virtual:icon/ph:trash';
import clearIcon from 'virtual:icon/ph:x';

import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { ChangeTracker } from '../changeTracker';
import { getElement, namedOptions, setButtonLabel, setOptions, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import { formatMoney, readMoneyField } from '../moneyField';
import { className, raceName } from '../raceAndClassNames';
import type { ItemSelectDialog } from './ItemSelectDialog';
import { startingZoneMessages } from './startingZoneMessages';
import { StartingItemsField } from './StartingItemsField';
import { ZoneChoice } from './ZoneChoice';
import type { ZoneSelectDialog } from './ZoneSelectDialog';

/**
 * The class editor: a dialog for a class's name, whether it is enabled, its rules, and what its
 * characters start with and where, for every race or for each race
 *
 * Saving a default class stores the universe's edited copy of it. The dialog can also delete a custom
 * class, or restore an edited default class
 */
export class ClassDialog
{
	private readonly dialog = getElement('class-dialog', HTMLDialogElement);
	private readonly form = getElement('class-form', HTMLFormElement);
	private readonly fields = getElement('class-fields', HTMLFieldSetElement);
	private readonly title = getElement('class-dialog-title', HTMLElement);
	private readonly name = getElement('class-name', HTMLInputElement);
	private readonly enabled = getElement('class-enabled', HTMLInputElement);
	private readonly primaryAbility = getElement('class-primary-ability', HTMLSelectElement);
	private readonly tradition = getElement('class-tradition', HTMLSelectElement);
	private readonly castingStyle = getElement('class-casting-style', HTMLSelectElement);
	private readonly startingMoney = getElement('class-money', HTMLInputElement);
	private readonly chooseItemsButton = getElement('class-items-choose', HTMLButtonElement);
	private readonly raceZoneList = getElement('class-race-zones', HTMLUListElement);
	private readonly raceZoneNote = getElement('class-race-zones-note', HTMLElement);
	private readonly error = getElement('class-error', HTMLElement);
	private readonly removeButton = getElement('class-remove', HTMLButtonElement);
	private readonly cancelButton = getElement('class-cancel', HTMLButtonElement);
	private readonly saveButton = getElement('class-save', HTMLButtonElement);

	private readonly startingItems: StartingItemsField;
	private readonly startingZone: ZoneChoice;

	/**
	 * The zone for each race's members of the class, by race ID, which may not be saved yet. Kept while
	 * the class has a zone for every race, so taking that zone away brings them back
	 */
	private readonly raceZones = new Map<number, string>();

	/**
	 * The choice for each race's zone, once the races have loaded
	 */
	private raceZoneChoices: ZoneChoice[] = [];

	/**
	 * Whether the class has changes that haven't been saved
	 */
	private readonly changes: ChangeTracker;

	private universe: EditableUniverse | undefined;

	/**
	 * The class being edited, or undefined for a new one
	 */
	private characterClass: EditorClass | undefined;

	/**
	 * Every zone's name, by ID, once they have loaded
	 */
	private zoneNames: ReadonlyMap<string, string> = new Map();

	/**
	 * Changes every time the dialog opens, so zones and races that arrive for an earlier opening are ignored
	 */
	private openVersion = 0;

	/**
	 * Called after the class is saved, deleted or restored
	 */
	private onChanged: () => void = () => undefined;

	/**
	 * @param api The editor's API
	 * @param zoneSelect The dialog for choosing starting zones
	 * @param itemSelect The dialog for choosing the starting equipment
	 */
	constructor(private readonly api: EditorApi, private readonly zoneSelect: ZoneSelectDialog, itemSelect: ItemSelectDialog)
	{
		this.name.maxLength = MAX_CLASS_NAME_LENGTH;
		setOptions(this.primaryAbility, namedOptions(PF1E_ABILITIES, PF1E_ABILITY_NAMES));
		setOptions(this.tradition, namedOptions(PF1E_MAGIC_TRADITIONS, PF1E_MAGIC_TRADITION_NAMES));
		setOptions(this.castingStyle, namedOptions(PF1E_CASTING_STYLES, PF1E_CASTING_STYLE_NAMES));

		this.startingItems = new StartingItemsField(api, itemSelect, {
			list: getElement('class-items', HTMLUListElement),
			none: getElement('class-items-none', HTMLElement),
			choose: this.chooseItemsButton
		}, () =>
		{
			this.changes.check();
		}, (message) =>
		{
			showMessage(this.error, message);
		});
		this.startingZone = new ZoneChoice(zoneSelect, {
			name: getElement('class-zone-name', HTMLElement),
			choose: getElement('class-zone-choose', HTMLButtonElement),
			clear: getElement('class-zone-clear', HTMLButtonElement)
		}, () => t({
			id: 'editor.class.zoneByRace',
			defaultMessage: 'Decided by race (below)',
			description: 'Shown in the class editor as the class\'s starting zone when it has none for every race, so each race\'s zone listed below it is used'
		}), () =>
		{
			this.showRaceZonesEnabled();
			this.changes.check();
		});
		this.changes = new ChangeTracker({
			root: this.form,
			state: () => [this.startingItems.value, this.startingZone.value, [...this.raceZones].sort(([a], [b]) => (a - b))]
		});
		this.changes.guardDialog(this.dialog);

		for (const input of [this.name, this.startingMoney])
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
	 * Opens the dialog for a class, or for a new one
	 *
	 * @param universe The universe the class belongs to
	 * @param characterClass The class, or undefined to add one
	 * @param onChanged Called after the class is saved, deleted or restored
	 */
	open(universe: EditableUniverse, characterClass: EditorClass | undefined, onChanged: () => void): void
	{
		const editable = canEditUniverseSettings(universe.role);
		const name = (characterClass ? className(characterClass, universe.ruleset) : '');
		const rules = (characterClass?.rules ?? NEW_PF1E_CLASS_RULES);

		this.universe = universe;
		this.characterClass = characterClass;
		this.onChanged = onChanged;
		this.zoneNames = new Map();

		if (!characterClass)
		{
			this.title.textContent = t({
				id: 'editor.class.addTitle',
				defaultMessage: 'Add Class',
				description: 'Title of the class editor when making a new character class'
			});
		}
		else if (editable)
		{
			this.title.textContent = t({
				id: 'editor.class.editTitle',
				defaultMessage: 'Edit {class}',
				description: 'Title of the class editor for a character class the player can change; {class} is its name, e.g. Wizard'
			}, { class: name });
		}
		else
		{
			this.title.textContent = name;
		}

		this.name.value = name;
		this.enabled.checked = (characterClass?.enabled ?? true);
		this.primaryAbility.value = rules.primaryAbility;
		this.tradition.value = rules.tradition;
		this.castingStyle.value = rules.castingStyle;
		this.startingMoney.value = formatMoney(characterClass?.startingMoney ?? emptyPf1eMoney());
		this.startingZone.show(universe, (characterClass?.startingZoneId ?? null), editable);
		this.raceZones.clear();

		for (const { raceId, zoneId } of (characterClass?.raceZones ?? []))
		{
			this.raceZones.set(raceId, zoneId);
		}

		this.raceZoneChoices = [];
		this.raceZoneList.replaceChildren();
		this.showRaceZonesEnabled();
		this.fields.disabled = false;
		this.saveButton.hidden = !editable;
		this.saveButton.disabled = false;
		this.chooseItemsButton.hidden = !editable;
		this.cancelButton.textContent = t(editable ? formMessages.cancel : formMessages.close);

		// Only the inputs are locked for a player who can't edit, so Close still works
		for (const input of [this.name, this.enabled, this.primaryAbility, this.tradition, this.castingStyle, this.startingMoney])
		{
			input.disabled = !editable;
		}

		this.removeButton.hidden = (!editable || !characterClass || (!characterClass.custom && !characterClass.edited));
		if (characterClass?.custom)
		{
			setButtonLabel(this.removeButton, trashIcon, t({
				id: 'editor.class.delete',
				defaultMessage: 'Delete Class',
				description: 'Button in the class editor that deletes a character class made for this universe'
			}));
		}
		else
		{
			setButtonLabel(this.removeButton, restoreIcon, t({
				id: 'editor.class.restore',
				defaultMessage: 'Restore Default',
				description: 'Button in the class editor that undoes this universe\'s changes to one of the ruleset\'s character classes'
			}));
		}

		showMessage(this.error, undefined);
		clearFieldErrors(this.dialog);
		void this.startingItems.show(universe, (characterClass?.startingItems ?? []));
		void this.loadRacesAndZones(universe, editable);
		this.dialog.showModal();
		this.changes.markSaved();
	}

	/**
	 * Loads the races and the zones' names, then lists where each race's members of the class start
	 *
	 * @param universe The universe
	 * @param editable Whether the player may change the zones
	 */
	private async loadRacesAndZones(universe: EditableUniverse, editable: boolean): Promise<void>
	{
		const version = ++this.openVersion;

		try
		{
			const [{ zones }, races] = await Promise.all([
				this.api.listZones(universe.id),
				this.api.listRaces(universe.id)
			]);

			if (version === this.openVersion)
			{
				this.zoneNames = new Map(zones.map((zone) => [zone.id, zone.name]));
				this.startingZone.setZoneNames(this.zoneNames);
				this.showRaceZones(universe, races, editable);
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
	 * Lists where each race's members of the class start: every enabled race, and any disabled race the
	 * class has a zone for
	 *
	 * @param universe The universe
	 * @param races The universe's races
	 * @param editable Whether the player may change the zones
	 */
	private showRaceZones(universe: EditableUniverse, races: EditorRace[], editable: boolean): void
	{
		const universeZoneName = ((universe.startingZoneId === null) ? '' : (this.zoneNames.get(universe.startingZoneId) ?? ''));
		const listed = races
			.filter((race) => (race.enabled || this.raceZones.has(race.id)))
			.map((race) => ({
				race,
				name: raceName(race, universe.ruleset)
			}))
			.sort((a, b) => a.name.localeCompare(b.name));

		this.raceZoneChoices = listed.map(({ race, name }) =>
		{
			const row = document.createElement('li');
			const label = document.createElement('span');
			const zoneName = document.createElement('strong');
			const choose = document.createElement('button');
			const clear = document.createElement('button');
			const choice = new ZoneChoice(this.zoneSelect, { name: zoneName, choose, clear }, () =>
			{
				return((race.startingZoneId === null)
					? t(startingZoneMessages.universes, { zone: universeZoneName })
					: t(startingZoneMessages.races, { zone: (this.zoneNames.get(race.startingZoneId) ?? '') }));
			}, () =>
			{
				if (choice.value === null)
				{
					this.raceZones.delete(race.id);
				}
				else
				{
					this.raceZones.set(race.id, choice.value);
				}

				this.changes.check();
			});

			label.textContent = name;
			choose.type = 'button';
			choose.className = 'secondary';
			setButtonLabel(choose, mapPinIcon, t({
				id: 'editor.class.chooseRaceZone',
				defaultMessage: 'Choose',
				description: 'Button in the class editor, beside a race\'s name, that chooses where the class\'s characters of that race start'
			}));
			choose.setAttribute('aria-label', t({
				id: 'editor.class.chooseRaceZoneLabel',
				defaultMessage: 'Choose the starting zone for {race}',
				description: 'Name of the button that chooses where the class\'s characters of one race start, for screen readers; {race} is the race\'s name'
			}, { race: name }));
			clear.type = 'button';
			clear.className = 'secondary';
			setButtonLabel(clear, clearIcon, t({
				id: 'editor.class.clearRaceZone',
				defaultMessage: 'Clear',
				description: 'Button in the class editor, beside a race\'s name, that takes away the class\'s zone for that race so the race\'s own is used'
			}));
			clear.setAttribute('aria-label', t({
				id: 'editor.class.clearRaceZoneLabel',
				defaultMessage: 'Clear the starting zone for {race}',
				description: 'Name of the button that takes away the class\'s zone for one race, for screen readers; {race} is the race\'s name'
			}, { race: name }));
			row.append(label, zoneName, choose, clear);
			this.raceZoneList.append(row);
			choice.show(universe, (this.raceZones.get(race.id) ?? null), editable);
			choice.setZoneNames(this.zoneNames);

			return(choice);
		});

		this.showRaceZonesEnabled();
	}

	/**
	 * Locks the zones for each race while the class has a zone for every race, and says why
	 */
	private showRaceZonesEnabled(): void
	{
		const byRace = (this.startingZone.value === null);

		this.raceZoneNote.hidden = byRace;

		for (const choice of this.raceZoneChoices)
		{
			choice.setEnabled(byRace);
		}
	}

	/**
	 * Saves the class as the form shows it
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

		const startingMoney = readMoneyField(this.startingMoney);

		if (startingMoney === undefined)
		{
			return;
		}

		// A default class whose name wasn't changed keeps the ruleset's, which players read in their own language
		const defaultName = ((this.characterClass && !this.characterClass.custom) ? className({ key: this.characterClass.key, name: null }, universe.ruleset) : undefined);
		const startingZoneId = this.startingZone.value;

		// A zone for every race leaves no room for one per race; the server refuses both
		const raceZones: ClassRaceZone[] = ((startingZoneId === null)
			? [...this.raceZones].map(([raceId, zoneId]) => ({ raceId, zoneId }))
			: []);
		const settings: ClassSettings = {
			name: ((name === defaultName) ? null : name),
			enabled: this.enabled.checked,
			startingMoney,
			startingItems: this.startingItems.value,
			startingZoneId,
			raceZones,
			rules: {
				primaryAbility: this.primaryAbility.value as Pf1eAbility,
				tradition: this.tradition.value as Pf1eMagicTradition,
				castingStyle: this.castingStyle.value as Pf1eCastingStyle
			}
		};

		await this.run({
			id: 'editor.class.saveFailed',
			defaultMessage: 'Could not save the class.',
			description: 'Shown in the class editor when the character class couldn\'t be stored'
		}, async () =>
		{
			if (this.characterClass)
			{
				await this.api.saveClass(universe.id, this.characterClass.id, settings);
			}
			else
			{
				await this.api.createClass(universe.id, settings);
			}
		});
	}

	/**
	 * Deletes a custom class, or restores an edited default class
	 */
	private async remove(): Promise<void>
	{
		const universe = this.universe;
		const characterClass = this.characterClass;

		if (!universe || !characterClass)
		{
			return;
		}

		const name = className(characterClass, universe.ruleset);
		let question: string;
		let failure: MessageDescriptor;

		if (characterClass.custom)
		{
			question = t({
				id: 'editor.class.confirmDelete',
				defaultMessage: 'Delete {class}? This can\'t be undone.',
				description: 'Asks before deleting a character class made for this universe; {class} is its name'
			}, { class: name });
			failure = {
				id: 'editor.class.deleteFailed',
				defaultMessage: 'Could not delete the class.',
				description: 'Shown in the class editor when the character class couldn\'t be deleted'
			};
		}
		else
		{
			question = t({
				id: 'editor.class.confirmRestore',
				defaultMessage: 'Restore {class} to the ruleset\'s default? Your changes to it, including its starting money, equipment and zones, will be lost.',
				description: 'Asks before undoing this universe\'s changes to one of the ruleset\'s character classes; {class} is its name'
			}, { class: name });
			failure = {
				id: 'editor.class.restoreFailed',
				defaultMessage: 'Could not restore the class.',
				description: 'Shown in the class editor when the ruleset\'s character class couldn\'t be restored'
			};
		}

		if (!window.confirm(question))
		{
			return;
		}

		await this.run(failure, () => this.api.deleteClass(universe.id, characterClass.id));
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
