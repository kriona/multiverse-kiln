import { canEditUniverseSettings, MAX_GROUP_PLAYERS, MIN_GROUP_SIZE, type EditableUniverse } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { ChangeTracker } from '../changeTracker';
import { getElement, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import { formatMoney, readMoneyField } from '../moneyField';
import type { ItemSelectDialog } from './ItemSelectDialog';
import { StartingItemsField } from './StartingItemsField';
import type { ZoneSelectDialog } from './ZoneSelectDialog';

/**
 * The Characters tab: how many characters play together in a group, and the money, equipment and
 * zone every character starts with
 */
export class CharactersTab
{
	private readonly form = getElement('characters-form', HTMLFormElement);
	private readonly fields = getElement('characters-fields', HTMLFieldSetElement);
	private readonly groupSize = getElement('characters-group-size', HTMLInputElement);
	private readonly startingMoney = getElement('characters-starting-money', HTMLInputElement);
	private readonly chooseItemsButton = getElement('characters-items-choose', HTMLButtonElement);
	private readonly zoneName = getElement('characters-zone-name', HTMLElement);
	private readonly chooseZoneButton = getElement('characters-zone-choose', HTMLButtonElement);
	private readonly error = getElement('characters-error', HTMLElement);
	private readonly saved = getElement('characters-saved', HTMLElement);
	private readonly saveButton = getElement('characters-save', HTMLButtonElement);

	private universe: EditableUniverse | undefined;

	/**
	 * The starting zone the form shows, which may not be saved yet
	 */
	private startingZoneId: string | null = null;

	/**
	 * The starting equipment the form shows, which may not be saved yet
	 */
	private readonly startingItems: StartingItemsField;

	/**
	 * Whether the form, the starting equipment or the starting zone chosen has changes that haven't been saved
	 */
	readonly changes: ChangeTracker;

	/**
	 * Changes every time the tab opens a universe, so a zone name that arrives for an earlier one is ignored
	 */
	private openVersion = 0;

	/**
	 * @param api The editor's API
	 * @param zoneSelect The dialog for choosing the starting zone
	 * @param itemSelect The dialog for choosing the starting equipment
	 * @param onSaved Called with the universe after the settings are saved
	 */
	constructor(private readonly api: EditorApi, private readonly zoneSelect: ZoneSelectDialog, itemSelect: ItemSelectDialog, private readonly onSaved: (universe: EditableUniverse) => void)
	{
		this.startingItems = new StartingItemsField(api, itemSelect, {
			list: getElement('characters-items', HTMLUListElement),
			none: getElement('characters-items-none', HTMLElement),
			choose: this.chooseItemsButton
		}, () =>
		{
			this.saved.textContent = '';
			this.changes.check();
		}, (message) =>
		{
			showMessage(this.error, message);
		});
		this.changes = new ChangeTracker({
			root: this.form,
			state: () => [this.startingZoneId, this.startingItems.value],
			status: this.saved
		});
		this.groupSize.min = String(MIN_GROUP_SIZE);
		this.groupSize.max = String(MAX_GROUP_PLAYERS);
		getElement('characters-group-size-hint', HTMLElement).textContent = t({
			id: 'editor.characters.groupSizeHint',
			defaultMessage: '{min, number} is single player. At most {max, number} characters can play together.',
			description: 'Explains the group size field on the editor\'s Characters tab; {min} and {max} are the smallest and largest group sizes'
		}, {
			min: MIN_GROUP_SIZE,
			max: MAX_GROUP_PLAYERS
		});
		getElement('characters-starting-money-hint', HTMLElement).textContent = t({
			id: 'editor.characters.startingMoneyHint',
			defaultMessage: 'Amounts of coins, like {example}. Coins stay as they are given; races and classes can add more.',
			description: 'Explains the starting money field on the editor\'s Characters tab; {example} is an amount of money, e.g. 12gp 5sp. Coins are never changed into other coins automatically'
		}, {
			example: formatMoney({
				pp: 0,
				gp: 12,
				sp: 5,
				cp: 0
			})
		});

		for (const input of [this.groupSize, this.startingMoney])
		{
			input.addEventListener('input', () =>
			{
				setFieldError(input, undefined);
				this.saved.textContent = '';
			});
		}

		this.chooseZoneButton.addEventListener('click', () =>
		{
			void this.chooseZone();
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.save();
		});
	}

	/**
	 * Shows a universe's character settings, read-only unless the player's role may change them
	 *
	 * @param universe The universe
	 */
	open(universe: EditableUniverse): void
	{
		this.universe = universe;
		this.groupSize.value = String(universe.groupSize);
		this.startingMoney.value = formatMoney(universe.startingMoney);
		this.fields.disabled = !canEditUniverseSettings(universe.role);
		this.saveButton.hidden = this.fields.disabled;
		this.chooseZoneButton.hidden = this.fields.disabled;
		this.chooseItemsButton.hidden = this.fields.disabled;
		this.saved.textContent = '';
		showMessage(this.error, undefined);
		clearFieldErrors(this.form);
		// Sets the starting zone and equipment straight away, then loads their names
		void this.showStartingZone(universe.startingZoneId);
		void this.startingItems.show(universe, universe.startingItems);
		this.changes.markSaved();
	}

	/**
	 * Shows the starting zone's name
	 *
	 * @param zoneId The zone, or null for none
	 */
	private async showStartingZone(zoneId: string | null): Promise<void>
	{
		const universe = this.universe;
		const version = ++this.openVersion;

		this.startingZoneId = zoneId;
		this.zoneName.textContent = '';

		if (!universe || (zoneId === null))
		{
			return;
		}

		try
		{
			const { zones } = await this.api.listZones(universe.id);

			if (version === this.openVersion)
			{
				this.zoneName.textContent = (zones.find((zone) => (zone.id === zoneId))?.name ?? '');
			}
		}
		catch (error)
		{
			if (version === this.openVersion)
			{
				showMessage(this.error, describeEditorError(error, {
					id: 'editor.characters.zoneFailed',
					defaultMessage: 'Could not load the starting zone.',
					description: 'Shown on the Characters tab when the name of the zone characters start in couldn\'t be loaded'
				}));
			}
		}
	}

	/**
	 * Lets the player choose another starting zone, which the form shows until it is saved
	 */
	private async chooseZone(): Promise<void>
	{
		if (!this.universe)
		{
			return;
		}

		const zone = await this.zoneSelect.open(this.universe, this.startingZoneId);

		this.chooseZoneButton.focus();

		if (zone && (zone.id !== this.startingZoneId))
		{
			++this.openVersion;
			this.startingZoneId = zone.id;
			this.zoneName.textContent = zone.name;
			this.saved.textContent = '';
			this.changes.check();
		}
	}

	/**
	 * Saves the settings as the form shows them
	 */
	private async save(): Promise<void>
	{
		const universe = this.universe;
		const groupSize = Number(this.groupSize.value);

		if (!universe)
		{
			return;
		}

		if (!Number.isInteger(groupSize) || (groupSize < MIN_GROUP_SIZE) || (groupSize > MAX_GROUP_PLAYERS) || (this.groupSize.value.trim() === ''))
		{
			reportFieldError(this.groupSize, t(formMessages.wholeNumber, {
				min: MIN_GROUP_SIZE,
				max: MAX_GROUP_PLAYERS
			}));
			return;
		}

		const startingMoney = readMoneyField(this.startingMoney);

		if (startingMoney === undefined)
		{
			return;
		}

		const startingZoneId = this.startingZoneId;
		const startingItems = this.startingItems.value;

		this.saveButton.disabled = true;
		showMessage(this.error, undefined);

		try
		{
			// Only a universe still being created has no starting zone, and the server won't take null
			await this.api.updateUniverse(universe.id, {
				groupSize,
				startingMoney,
				startingItems,
				...((startingZoneId === null) ? {} : { startingZoneId })
			});
			this.universe = {
				...universe,
				groupSize,
				startingMoney,
				startingItems,
				startingZoneId
			};
			this.startingMoney.value = formatMoney(startingMoney);
			this.changes.markSaved();
			this.saved.textContent = t(formMessages.saved);
			this.onSaved(this.universe);
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, {
				id: 'editor.characters.saveFailed',
				defaultMessage: 'Could not save the character settings.',
				description: 'Shown on the Characters tab when its settings couldn\'t be stored'
			}));
		}
		finally
		{
			this.saveButton.disabled = false;
		}
	}
}
