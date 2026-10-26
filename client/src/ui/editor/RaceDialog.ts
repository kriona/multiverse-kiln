import { ABILITY_NAMES, canEditUniverseSettings, DISALLOWED_TEXT_CHARACTERS, emptyMoney, emptyPf1eAbilityScores, FLOATING_ABILITY_BONUSES, isSf1eRaceRules, MAX_RACE_NAME_LENGTH, NEW_RACE_RULES, PF1E_ABILITIES, PF1E_MAX_RACE_ABILITY_MODIFIER, PF1E_MIN_RACE_ABILITY_MODIFIER, RULESET_SIZES, SF1E_MAX_RACE_HIT_POINTS, SF1E_MIN_RACE_HIT_POINTS, SIZE_NAMES, type Ability, type AbilityScores, type EditableUniverse, type EditorRace, type Pf1eSize, type RaceRules, type RaceSettings, type Sf1eSize } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { ChangeTracker } from '../changeTracker';
import { getElement, namedOptions, setOptions, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import { formatMoney, readMoneyField } from '../moneyField';
import { raceName } from '../raceAndClassNames';
import { editorMessages } from './editorMessages';
import type { ItemSelectDialog } from './ItemSelectDialog';
import { startingAreaMessages } from './startingAreaMessages';
import { StartingItemsField } from './StartingItemsField';
import { AreaChoice } from './AreaChoice';
import type { AreaSelectDialog } from './AreaSelectDialog';
import { labelRemoveButton, type StagedEdit } from './stagedChanges';

/**
 * The race editor: a dialog for a race's name, whether it is enabled, its rules, and what its
 * characters start with and where
 *
 * Applying keeps the changes on the Characters tab until it is saved; for a default race, saving stores the
 * universe's edited copy of it. The dialog can also delete a custom race, or restore an edited default
 * race, when the tab is saved
 */
export class RaceDialog
{
	private readonly dialog = getElement('race-dialog', HTMLDialogElement);
	private readonly form = getElement('race-form', HTMLFormElement);
	private readonly title = getElement('race-dialog-title', HTMLElement);
	private readonly name = getElement('race-name', HTMLInputElement);
	private readonly enabled = getElement('race-enabled', HTMLInputElement);
	private readonly floatingBonus = getElement('race-floating', HTMLInputElement);
	private readonly darkvision = getElement('race-darkvision', HTMLInputElement);
	private readonly size = getElement('race-size', HTMLSelectElement);
	private readonly hitPointsField = getElement('race-hit-points-field', HTMLElement);
	private readonly hitPoints = getElement('race-hit-points', HTMLInputElement);
	private readonly floatingHint = getElement('race-floating-hint', HTMLElement);
	private readonly startingMoney = getElement('race-money', HTMLInputElement);
	private readonly chooseItemsButton = getElement('race-items-choose', HTMLButtonElement);
	private readonly error = getElement('race-error', HTMLElement);
	private readonly removeButton = getElement('race-remove', HTMLButtonElement);
	private readonly cancelButton = getElement('race-cancel', HTMLButtonElement);
	private readonly saveButton = getElement('race-save', HTMLButtonElement);

	/**
	 * The field for each ability's modifier, and the name beside it
	 */
	private readonly modifiers: Record<Ability, HTMLInputElement>;
	private readonly modifierNames: Record<Ability, Text>;

	private readonly startingItems: StartingItemsField;
	private readonly startingArea: AreaChoice;

	/**
	 * Whether the race has changes that haven't been applied
	 */
	private readonly changes: ChangeTracker;

	private universe: EditableUniverse | undefined;

	/**
	 * The race being edited, or undefined for a new one
	 */
	private race: EditorRace | undefined;

	/**
	 * Where the dialog's changes go
	 */
	private edit: StagedEdit<RaceSettings> | undefined;

	/**
	 * The universe's starting area's name, which characters of a race without an area start in
	 */
	private universeAreaName = '';

	/**
	 * Changes every time the dialog opens, so area names that arrive for an earlier opening are ignored
	 */
	private openVersion = 0;

	/**
	 * Called after the race's changes are applied, or it is marked to delete or restore
	 */
	private onChanged: () => void = () => undefined;

	/**
	 * @param api The editor's API
	 * @param areaSelect The dialog for choosing the starting area
	 * @param itemSelect The dialog for choosing the starting equipment
	 */
	constructor(private readonly api: EditorApi, areaSelect: AreaSelectDialog, itemSelect: ItemSelectDialog)
	{
		this.name.maxLength = MAX_RACE_NAME_LENGTH;
		this.hitPoints.min = String(SF1E_MIN_RACE_HIT_POINTS);
		this.hitPoints.max = String(SF1E_MAX_RACE_HIT_POINTS);
		({ inputs: this.modifiers, names: this.modifierNames } = createModifierFields(getElement('race-modifiers', HTMLElement)));

		this.startingItems = new StartingItemsField(api, itemSelect, {
			list: getElement('race-items', HTMLUListElement),
			choose: this.chooseItemsButton
		}, () =>
		{
			this.changes.check();
		}, (message) =>
		{
			showMessage(this.error, message);
		});
		this.startingArea = new AreaChoice(areaSelect, {
			name: getElement('race-area-name', HTMLElement),
			choose: getElement('race-area-choose', HTMLButtonElement),
			clear: getElement('race-area-clear', HTMLButtonElement)
		}, () => t(startingAreaMessages.universes, { area: this.universeAreaName }), () =>
		{
			this.changes.check();
		});
		this.changes = new ChangeTracker({
			root: this.form,
			state: () => [this.startingItems.value, this.startingArea.value, this.startingArea.cell]
		});
		this.changes.guardDialog(this.dialog);

		for (const input of [this.name, this.startingMoney, this.hitPoints, ...Object.values(this.modifiers)])
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
			this.remove();
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			this.apply();
		});
	}

	/**
	 * Opens the dialog for a race, or for a new one
	 *
	 * @param universe The universe the race belongs to
	 * @param race The race, or undefined to add one
	 * @param edit Where the dialog's changes go
	 * @param onChanged Called after the race's changes are applied, or it is marked to delete or restore
	 */
	open(universe: EditableUniverse, race: EditorRace | undefined, edit: StagedEdit<RaceSettings>, onChanged: () => void): void
	{
		const canEdit = canEditUniverseSettings(universe.role);
		const editable = (canEdit && !edit.removed);
		const name = (race ? raceName(race, universe.ruleset) : '');
		const rules = (race?.rules ?? NEW_RACE_RULES[universe.ruleset]);

		this.universe = universe;
		this.race = race;
		this.edit = edit;
		this.onChanged = onChanged;
		this.universeAreaName = '';

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
			this.modifierNames[ability].data = t(ABILITY_NAMES[universe.ruleset][ability]);
			this.modifiers[ability].value = String(rules.abilityModifiers[ability]);
		}

		this.floatingBonus.checked = rules.floatingBonus;
		this.floatingHint.textContent = floatingBonusHint(universe);
		this.darkvision.checked = rules.darkvision;
		setOptions(this.size, namedOptions(RULESET_SIZES[universe.ruleset], SIZE_NAMES[universe.ruleset]));
		this.size.value = rules.size;
		this.hitPointsField.hidden = !isSf1eRaceRules(rules);
		this.hitPoints.value = (isSf1eRaceRules(rules) ? String(rules.hitPoints) : '');
		this.startingMoney.value = formatMoney((race?.startingMoney ?? emptyMoney()), universe.ruleset);
		this.startingArea.show(universe, (race?.startingAreaId ?? null), {
			column: (race?.startingColumn ?? 0),
			row: (race?.startingRow ?? 0)
		}, editable);
		this.saveButton.hidden = !editable;
		this.chooseItemsButton.hidden = !editable;
		this.cancelButton.textContent = t(editable ? formMessages.cancel : formMessages.close);

		// Only the inputs are locked for a player who can't edit, so Close still works
		for (const input of [this.name, this.enabled, this.floatingBonus, this.darkvision, this.size, this.startingMoney, ...Object.values(this.modifiers)])
		{
			input.disabled = !editable;
		}

		// The field is hidden and empty in a ruleset without race hit points; disabling it keeps the browser from requiring it
		this.hitPoints.disabled = (!editable || !isSf1eRaceRules(rules));

		this.removeButton.hidden = (!canEdit || !race || (!race.custom && !race.edited));
		labelRemoveButton(this.removeButton, edit, !race?.custom, (race?.custom
			? t({
				id: 'editor.race.delete',
				defaultMessage: 'Delete Race',
				description: 'Button in the race editor that deletes a race made for this universe'
			})
			: t(editorMessages.restore)));

		showMessage(this.error, undefined);
		clearFieldErrors(this.dialog);
		void this.startingItems.show(universe, (race?.startingItems ?? []));
		void this.loadAreaNames(universe);
		this.dialog.showModal();
		this.changes.markSaved();
	}

	/**
	 * Loads the areas' names, for the race's starting area and the universe's
	 *
	 * @param universe The universe
	 */
	private async loadAreaNames(universe: EditableUniverse): Promise<void>
	{
		const version = ++this.openVersion;

		try
		{
			const { areas } = await this.api.listAreas(universe.id);

			if (version === this.openVersion)
			{
				const names = new Map(areas.map((area) => [area.id, area.name]));

				this.universeAreaName = ((universe.startingAreaId === null) ? '' : (names.get(universe.startingAreaId) ?? ''));
				this.startingArea.setAreaNames(names);
			}
		}
		catch (error)
		{
			if (version === this.openVersion)
			{
				showMessage(this.error, describeEditorError(error, startingAreaMessages.loadFailed));
			}
		}
	}

	/**
	 * Keeps the race as the form shows it, until the tab is saved
	 */
	private apply(): void
	{
		const universe = this.universe;
		const name = this.name.value.trim();

		if (!universe || !this.edit)
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

		const rules = this.readRules(universe, abilityModifiers);

		if (rules === undefined)
		{
			return;
		}

		const startingMoney = readMoneyField(this.startingMoney, universe.ruleset);

		if (startingMoney === undefined)
		{
			return;
		}

		// A default race whose name wasn't changed keeps the ruleset's, which players read in their own language
		const defaultName = ((this.race && !this.race.custom) ? raceName({ key: this.race.key, name: null }, universe.ruleset) : undefined);

		this.edit.apply({
			name: ((name === defaultName) ? null : name),
			enabled: this.enabled.checked,
			startingMoney,
			startingItems: this.startingItems.value,
			startingAreaId: this.startingArea.value,
			startingColumn: this.startingArea.cell.column,
			startingRow: this.startingArea.cell.row,
			rules
		});
		this.close();
	}

	/**
	 * The race's rules under the universe's ruleset as the form shows them, reporting hit points out of range
	 *
	 * @param universe The universe
	 * @param abilityModifiers The ability modifiers, already read
	 * @return The rules, or undefined when a field shows a problem
	 */
	private readRules(universe: EditableUniverse, abilityModifiers: AbilityScores): RaceRules | undefined
	{
		const common = {
			abilityModifiers,
			floatingBonus: this.floatingBonus.checked,
			darkvision: this.darkvision.checked
		};

		if (universe.ruleset === 'pf1e')
		{
			return({
				...common,
				size: this.size.value as Pf1eSize
			});
		}

		const hitPoints = Number(this.hitPoints.value);

		if ((this.hitPoints.value.trim() === '') || !Number.isInteger(hitPoints) || (hitPoints < SF1E_MIN_RACE_HIT_POINTS) || (hitPoints > SF1E_MAX_RACE_HIT_POINTS))
		{
			reportFieldError(this.hitPoints, t(formMessages.wholeNumber, {
				min: SF1E_MIN_RACE_HIT_POINTS,
				max: SF1E_MAX_RACE_HIT_POINTS
			}));
			return(undefined);
		}

		return({
			...common,
			size: this.size.value as Sf1eSize,
			hitPoints
		});
	}

	/**
	 * Marks a custom race to delete, or an edited default race to restore, when the tab is saved; or takes
	 * that back
	 */
	private remove(): void
	{
		if (!this.edit)
		{
			return;
		}

		if (this.edit.removed)
		{
			this.edit.undoRemove();
		}
		else
		{
			this.edit.remove();
		}

		this.close();
	}

	/**
	 * Closes the dialog once its change is made, and shows the change in the list
	 */
	private close(): void
	{
		this.changes.markSaved();
		this.dialog.close();
		this.onChanged();
	}
}

/**
 * What the race editor's floating ability bonus checkbox does, naming the ruleset's races that have one
 *
 * @param universe The universe
 * @return The hint
 */
function floatingBonusHint(universe: EditableUniverse): string
{
	const bonus = FLOATING_ABILITY_BONUSES[universe.ruleset];

	if (universe.ruleset === 'sf1e')
	{
		return(t({
			id: 'editor.race.floatingBonusHintSf1e',
			defaultMessage: 'The player chooses one ability to get +{bonus, number}, as humans do.',
			description: 'Explains the race editor\'s Floating ability bonus checkbox in a Starfinder universe; {bonus} is how much the chosen ability score goes up'
		}, {
			bonus
		}));
	}

	return(t({
		id: 'editor.race.floatingBonusHint',
		defaultMessage: 'The player chooses one ability to get +{bonus, number}, as humans, half-elves and half-orcs do.',
		description: 'Explains the race editor\'s Floating ability bonus checkbox; {bonus} is how much the chosen ability score goes up'
	}, {
		bonus
	}));
}

/**
 * Adds a number field for each ability's modifier. Every ruleset has the same abilities; each field's
 * name is set when the dialog opens, in the universe's ruleset's words
 *
 * @param container Where the fields go
 * @return The fields and the names beside them, by ability
 */
function createModifierFields(container: HTMLElement): { inputs: Record<Ability, HTMLInputElement>; names: Record<Ability, Text> }
{
	const inputs = {} as Record<Ability, HTMLInputElement>;
	const names = {} as Record<Ability, Text>;

	for (const ability of PF1E_ABILITIES)
	{
		const label = document.createElement('label');
		const input = document.createElement('input');
		const name = document.createTextNode('');

		input.type = 'number';
		input.min = String(PF1E_MIN_RACE_ABILITY_MODIFIER);
		input.max = String(PF1E_MAX_RACE_ABILITY_MODIFIER);
		input.step = '1';
		input.required = true;
		label.append(name, input);
		container.append(label);
		inputs[ability] = input;
		names[ability] = name;
	}

	return({
		inputs,
		names
	});
}

/**
 * Reads the ability modifier fields, reporting the first that isn't a whole number in range
 *
 * @param fields The fields, by ability
 * @return The modifiers, or undefined when one is wrong
 */
function readModifierFields(fields: Record<Ability, HTMLInputElement>): AbilityScores | undefined
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
