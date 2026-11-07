import { canEditUniverseSettings, DISALLOWED_TEXT_CHARACTERS, loadedFor, duplicateCoinAbbreviation, isValidCoinAbbreviation, MAX_COIN_ABBREVIATION_LENGTH, MAX_COIN_NAME_LENGTH, RULESET_COINS, shownCoinAbbreviations, type Coin, type EditableUniverse, type UniverseCoinAbbreviations, type UniverseCoinNames, type UniverseSettingsUpdate } from '@multiverse-kiln/shared';

import { capitalized, t } from '../../localization';
import { describeEditorError } from '../../network/editorApi';
import { ChangeTracker } from '../changeTracker';
import { getElement, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import { coinAbbreviationMessages, engineCoinAbbreviation, engineCoinName } from '../moneyField';
import type { EditorSave } from './editorSave';
import type { SavableTab } from './SaveBar';

/**
 * The coins on the Ruleset tab: a row for each of the ruleset's coins, with the name and abbreviation
 * the universe gives it. Changes wait on the page until the tab is saved
 */
export class CoinsSection implements SavableTab
{
	private readonly form = getElement('coins-form', HTMLFormElement);
	private readonly fields = getElement('coins-fields', HTMLFieldSetElement);
	private readonly rows = getElement('coin-rows', HTMLTableSectionElement);
	private readonly error = getElement('coins-error', HTMLElement);

	/**
	 * The fields for each of the ruleset's coins' name and abbreviation, made when a universe opens
	 */
	private readonly nameInputs = new Map<Coin, HTMLInputElement>();
	private readonly abbreviationInputs = new Map<Coin, HTMLInputElement>();

	/**
	 * Whether the fields have changes that haven't been saved
	 */
	readonly changes = new ChangeTracker({ root: this.form });

	private universe: EditableUniverse | undefined;

	/**
	 * The abbreviations as last saved
	 */
	private savedAbbreviations: UniverseCoinAbbreviations = {};

	/**
	 * The settings the save being sent holds
	 */
	private collected: UniverseSettingsUpdate | undefined;

	/**
	 * @param onInput Called when an abbreviation field changes
	 * @param onSaved Called with the settings saved, once they are
	 */
	constructor(private readonly onInput: () => void, private readonly onSaved: (update: UniverseSettingsUpdate) => void)
	{
	}

	/**
	 * Shows a universe's coins, read-only unless the player's role may change them
	 *
	 * @param universe The universe
	 */
	open(universe: EditableUniverse): void
	{
		this.universe = universe;
		this.savedAbbreviations = universe.coinAbbreviations;
		this.nameInputs.clear();
		this.abbreviationInputs.clear();

		const rows = RULESET_COINS[universe.ruleset].map((coin) =>
		{
			const row = document.createElement('tr');
			const heading = document.createElement('th');

			heading.id = `coin-${coin}`;
			heading.scope = 'row';
			heading.textContent = capitalized(engineCoinName(coin));
			row.append(heading);
			this.nameInputs.set(coin, this.addField(row, coin, 'name', (universe.coinNames[coin] ?? ''), engineCoinName(coin), MAX_COIN_NAME_LENGTH));
			this.abbreviationInputs.set(coin, this.addField(row, coin, 'abbreviation', (universe.coinAbbreviations[coin] ?? ''), engineCoinAbbreviation(coin), MAX_COIN_ABBREVIATION_LENGTH));

			return(row);
		});

		this.rows.replaceChildren(...rows);
		this.fields.disabled = !this.canSave();
		showMessage(this.error, undefined);
		clearFieldErrors(this.form);
		this.changes.markSaved();
	}

	/**
	 * The abbreviations the fields give the coins, which may not be saved yet, without reporting
	 * problems: a field that can't be an abbreviation leaves its coin as saved
	 *
	 * @return The abbreviations, leaving out the coins without one
	 */
	abbreviations(): UniverseCoinAbbreviations
	{
		const abbreviations: UniverseCoinAbbreviations = {};

		for (const [coin, input] of this.abbreviationInputs)
		{
			const abbreviation = input.value.trim();
			const shown = (((abbreviation === '') || isValidCoinAbbreviation(abbreviation)) ? abbreviation : (this.savedAbbreviations[coin] ?? ''));

			if (shown !== '')
			{
				abbreviations[coin] = shown;
			}
		}

		return(abbreviations);
	}

	/**
	 * Whether the player may change the coins
	 *
	 * @return True for a creator
	 */
	canSave(): boolean
	{
		return((this.universe !== undefined) && canEditUniverseSettings(this.universe.role));
	}

	/**
	 * Adds the coins as the fields show them to a save
	 *
	 * @param save The save
	 * @return False when a field is wrong
	 */
	collect(save: EditorSave): boolean
	{
		const universe = this.universe;
		const coinNames = this.readNames();
		const coinAbbreviations = ((!universe || (coinNames === undefined)) ? undefined : this.readAbbreviations(universe));

		if ((coinNames === undefined) || (coinAbbreviations === undefined))
		{
			return(false);
		}

		const update: UniverseSettingsUpdate = {
			coinNames,
			coinAbbreviations
		};

		showMessage(this.error, undefined);
		this.collected = update;
		save.add({ kind: 'universe', update, loaded: loadedFor(this.universe, update) }, (refusal) =>
		{
			showMessage(this.error, describeEditorError(refusal.error, {
				id: 'editor.coins.saveFailed',
				defaultMessage: 'Could not save the coins.',
				description: 'Shown on the Ruleset tab when the server refused the names and abbreviations given to the coins, followed by why; nothing was saved'
			}));
		});

		return(true);
	}

	/**
	 * Takes the coins as saved
	 */
	saved(): void
	{
		const update = this.collected;

		this.collected = undefined;

		if (this.universe && update)
		{
			this.universe = { ...this.universe, ...update };
			this.savedAbbreviations = (update.coinAbbreviations ?? this.savedAbbreviations);
			this.changes.markSaved();
			this.onSaved(update);
		}
	}

	/**
	 * Adds a cell with a field to a coin's row, labeled by the coin and its column
	 *
	 * @param row The coin's row, which starts with its heading
	 * @param coin The coin
	 * @param column Which of the coin's text the field holds
	 * @param value The universe's own text, or empty for none
	 * @param placeholder The engine's text, shown while the field is empty
	 * @param maxLength Most characters the field holds
	 * @return The field
	 */
	private addField(row: HTMLTableRowElement, coin: Coin, column: 'name' | 'abbreviation', value: string, placeholder: string, maxLength: number): HTMLInputElement
	{
		const cell = document.createElement('td');
		const input = document.createElement('input');

		input.id = `coin-${coin}-${column}`;
		input.className = `coin-${column}`;
		input.autocomplete = 'off';
		input.maxLength = maxLength;
		input.placeholder = placeholder;
		input.value = value;
		input.setAttribute('aria-labelledby', `coin-${coin} coins-${column}`);
		input.addEventListener('input', () =>
		{
			setFieldError(input, undefined);

			if (column === 'abbreviation')
			{
				this.onInput();
			}
		});
		cell.append(input);
		row.append(cell);

		return(input);
	}

	/**
	 * The names the fields give the coins, reporting the first field that holds characters that aren't
	 * allowed
	 *
	 * @return The names, leaving out the coins left empty, or undefined when a field shows a problem
	 */
	private readNames(): UniverseCoinNames | undefined
	{
		const names: UniverseCoinNames = {};

		for (const [coin, input] of this.nameInputs)
		{
			const name = input.value.trim();

			if (DISALLOWED_TEXT_CHARACTERS.test(name))
			{
				reportFieldError(input, t(formMessages.invalidText));
				return(undefined);
			}

			if (name !== '')
			{
				names[coin] = name;
			}
		}

		return(names);
	}

	/**
	 * The abbreviations the fields give the coins, reporting the first field that is wrong
	 *
	 * @param universe The universe
	 * @return The abbreviations, leaving out the coins left empty, or undefined when a field shows a problem
	 */
	private readAbbreviations(universe: EditableUniverse): UniverseCoinAbbreviations | undefined
	{
		const abbreviations: UniverseCoinAbbreviations = {};

		for (const [coin, input] of this.abbreviationInputs)
		{
			const abbreviation = input.value.trim();

			if (abbreviation === '')
			{
				continue;
			}

			if (!isValidCoinAbbreviation(abbreviation))
			{
				reportFieldError(input, t(coinAbbreviationMessages.invalid, {
					max: MAX_COIN_ABBREVIATION_LENGTH
				}));
				return(undefined);
			}

			abbreviations[coin] = abbreviation;
		}

		const shown = shownCoinAbbreviations(universe.ruleset, abbreviations, engineCoinAbbreviation);
		const duplicate = duplicateCoinAbbreviation(universe.ruleset, shown);
		const duplicateInput = ((duplicate === undefined) ? undefined : this.abbreviationInputs.get(duplicate));

		if ((duplicate !== undefined) && duplicateInput)
		{
			reportFieldError(duplicateInput, t({
				id: 'editor.coins.abbreviationTaken',
				defaultMessage: 'Another coin is already written with {abbreviation}.',
				description: 'Shown under a coin\'s abbreviation on the editor\'s Ruleset tab when a more valuable coin has the same one, so amounts couldn\'t tell them apart; {abbreviation} is the abbreviation, typed or the usual one'
			}, {
				abbreviation: (shown[duplicate] ?? '')
			}));
			return(undefined);
		}

		return(abbreviations);
	}
}
