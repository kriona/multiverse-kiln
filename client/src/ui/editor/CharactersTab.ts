import { canEditUniverseSettings, MAX_GROUP_PLAYERS, MIN_GROUP_SIZE, type EditableUniverse, type StartingCell, type UniverseSettingsUpdate } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { ChangeTracker } from '../changeTracker';
import { getElement, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import { exampleMoney, formatMoney, readMoneyField } from '../moneyField';
import type { ItemSelectDialog } from './ItemSelectDialog';
import type { EditorSave } from './editorSave';
import type { SavableTab } from './SaveBar';
import { StartingItemsField } from './StartingItemsField';
import { startingAreaMessages } from './startingAreaMessages';
import type { AreaSelectDialog } from './AreaSelectDialog';

/**
 * The Characters tab: how many characters play together in a group, and the money, equipment and
 * area every character starts with
 */
export class CharactersTab implements SavableTab
{
	private readonly form = getElement('characters-form', HTMLFormElement);
	private readonly fields = getElement('characters-fields', HTMLFieldSetElement);
	private readonly groupSize = getElement('characters-group-size', HTMLInputElement);
	private readonly startingMoney = getElement('characters-starting-money', HTMLInputElement);
	private readonly startingMoneyHint = getElement('characters-starting-money-hint', HTMLElement);
	private readonly chooseItemsButton = getElement('characters-items-choose', HTMLButtonElement);
	private readonly areaName = getElement('characters-area-name', HTMLElement);
	private readonly chooseAreaButton = getElement('characters-area-choose', HTMLButtonElement);
	private readonly error = getElement('characters-error', HTMLElement);

	private universe: EditableUniverse | undefined;

	/**
	 * The settings the save being sent holds
	 */
	private collected: UniverseSettingsUpdate | undefined;

	/**
	 * The starting area the form shows, which may not be saved yet
	 */
	private startingAreaId: string | null = null;

	/**
	 * The square of the starting area characters start on, which may not be saved yet
	 */
	private startingCell: StartingCell = { column: 0, row: 0 };

	/**
	 * The starting area's name, once it has loaded
	 */
	private startingAreaName = '';

	/**
	 * The starting equipment the form shows, which may not be saved yet
	 */
	private readonly startingItems: StartingItemsField;

	/**
	 * Whether the form, the starting equipment or the starting area chosen has changes that haven't been saved
	 */
	readonly changes: ChangeTracker;

	/**
	 * Changes every time the tab opens a universe, so an area name that arrives for an earlier one is ignored
	 */
	private openVersion = 0;

	/**
	 * @param api The editor's API
	 * @param areaSelect The dialog for choosing the starting area
	 * @param itemSelect The dialog for choosing the starting equipment
	 * @param onSaved Called with the settings saved, once they are
	 */
	constructor(private readonly api: EditorApi, private readonly areaSelect: AreaSelectDialog, itemSelect: ItemSelectDialog, private readonly onSaved: (update: UniverseSettingsUpdate) => void)
	{
		this.startingItems = new StartingItemsField(api, itemSelect, {
			list: getElement('characters-items', HTMLUListElement),
			choose: this.chooseItemsButton
		}, () =>
		{
			this.changes.check();
		}, (message) =>
		{
			showMessage(this.error, message);
		});
		this.changes = new ChangeTracker({
			root: this.form,
			state: () => [this.startingAreaId, this.startingCell, this.startingItems.value]
		});
		this.groupSize.min = String(MIN_GROUP_SIZE);
		this.groupSize.max = String(MAX_GROUP_PLAYERS);
		getElement('characters-group-size-hint', HTMLElement).textContent = t({
			id: 'editor.characters.groupSizeHint',
			defaultMessage: '{min, number} is single player game. At most {max, number} characters can play together.',
			description: 'Explains the group size field on the editor\'s Characters tab; {min} and {max} are the smallest and largest group sizes'
		}, {
			min: MIN_GROUP_SIZE,
			max: MAX_GROUP_PLAYERS
		});
		for (const input of [this.groupSize, this.startingMoney])
		{
			input.addEventListener('input', () =>
			{
				setFieldError(input, undefined);
			});
		}

		this.chooseAreaButton.addEventListener('click', () =>
		{
			void this.chooseArea();
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
		this.startingMoney.value = formatMoney(universe.startingMoney, universe.ruleset);
		this.startingMoneyHint.textContent = t({
			id: 'editor.characters.startingMoneyHint',
			defaultMessage: 'Amounts of coins, like {example}. Coins stay as they are given; races and classes can add more.',
			description: 'Explains the starting money field on the editor\'s Characters tab; {example} is an amount of money, e.g. 1pp 2gp 2sp 4cp or 250cr. Coins are never changed into other coins automatically'
		}, {
			example: exampleMoney(universe.ruleset)
		});
		this.fields.disabled = !this.canSave();
		this.chooseAreaButton.hidden = this.fields.disabled;
		this.chooseItemsButton.hidden = this.fields.disabled;
		showMessage(this.error, undefined);
		clearFieldErrors(this.form);
		// Sets the starting area and equipment straight away, then loads their names
		void this.showStartingArea(universe.startingAreaId, {
			column: universe.startingColumn,
			row: universe.startingRow
		});
		void this.startingItems.show(universe, universe.startingItems);
		this.changes.markSaved();
	}

	/**
	 * Shows the starting area's name and square
	 *
	 * @param areaId The area, or null for none
	 * @param cell The square of it characters start on
	 */
	private async showStartingArea(areaId: string | null, cell: StartingCell): Promise<void>
	{
		const universe = this.universe;
		const version = ++this.openVersion;

		this.startingAreaId = areaId;
		this.startingCell = cell;
		this.startingAreaName = '';
		this.areaName.textContent = '';

		if (!universe || (areaId === null))
		{
			return;
		}

		try
		{
			const { areas } = await this.api.listAreas(universe.id);

			if (version === this.openVersion)
			{
				this.startingAreaName = (areas.find((area) => (area.id === areaId))?.name ?? '');
				this.renderStartingArea();
			}
		}
		catch (error)
		{
			if (version === this.openVersion)
			{
				showMessage(this.error, describeEditorError(error, {
					id: 'editor.characters.areaFailed',
					defaultMessage: 'Could not load the starting area.',
					description: 'Shown on the Characters tab when the name of the area characters start in couldn\'t be loaded'
				}));
			}
		}
	}

	/**
	 * Shows the starting area's name and the square of it characters start on
	 */
	private renderStartingArea(): void
	{
		this.areaName.textContent = t(startingAreaMessages.at, {
			area: this.startingAreaName,
			column: this.startingCell.column,
			row: this.startingCell.row
		});
	}

	/**
	 * Lets the player choose another starting area or square, which the form shows until it is saved
	 */
	private async chooseArea(): Promise<void>
	{
		if (!this.universe)
		{
			return;
		}

		const selection = await this.areaSelect.open(this.universe, this.startingAreaId, this.startingCell);

		this.chooseAreaButton.focus();

		if (selection)
		{
			++this.openVersion;
			this.startingAreaId = selection.area.id;
			this.startingCell = selection.cell;
			this.startingAreaName = selection.area.name;
			this.renderStartingArea();
			this.changes.check();
		}
	}

	/**
	 * Whether the player may change the character settings
	 *
	 * @return True for a creator
	 */
	canSave(): boolean
	{
		return((this.universe !== undefined) && canEditUniverseSettings(this.universe.role));
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
		const groupSize = Number(this.groupSize.value);

		if (!universe)
		{
			return(false);
		}

		if (!Number.isInteger(groupSize) || (groupSize < MIN_GROUP_SIZE) || (groupSize > MAX_GROUP_PLAYERS) || (this.groupSize.value.trim() === ''))
		{
			reportFieldError(this.groupSize, t(formMessages.wholeNumber, {
				min: MIN_GROUP_SIZE,
				max: MAX_GROUP_PLAYERS
			}));
			return(false);
		}

		const startingMoney = readMoneyField(this.startingMoney, universe.ruleset);

		if (startingMoney === undefined)
		{
			return(false);
		}

		const startingAreaId = this.startingAreaId;
		const { column: startingColumn, row: startingRow } = this.startingCell;
		const startingItems = this.startingItems.value;

		// Only a universe still being created has no starting area, and the server won't take null
		const update: UniverseSettingsUpdate = {
			groupSize,
			startingMoney,
			startingItems,
			...((startingAreaId === null) ? {} : { startingAreaId, startingColumn, startingRow })
		};

		showMessage(this.error, undefined);
		this.collected = update;
		save.add({ kind: 'universe', update }, (refusal) =>
		{
			showMessage(this.error, describeEditorError(refusal.error, {
				id: 'editor.characters.saveFailed',
				defaultMessage: 'Could not save the character settings.',
				description: 'Shown on the Characters tab when the server refused its settings, followed by why; nothing was saved'
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
			this.startingMoney.value = formatMoney(this.universe.startingMoney, universe.ruleset);
			this.changes.markSaved();
			this.onSaved(update);
		}
	}
}
