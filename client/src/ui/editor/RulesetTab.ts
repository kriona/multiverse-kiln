import { canEditUniverseSettings, PF1E_MAX_POINT_BUY_BUDGET, PF1E_MIN_POINT_BUY_BUDGET, PF1E_STAT_METHOD_NAMES, PF1E_STAT_METHODS, RULESET_NAMES, SF1E_MAX_ABILITY_POINTS, SF1E_MIN_ABILITY_POINTS, type EditableUniverse, type Pf1eStatMethod, type RulesetSettings } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { ChangeTracker } from '../changeTracker';
import { getElement, namedOptions, setOptions, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import type { SavableTab } from './SaveBar';

/**
 * The Ruleset tab: how the universe plays under its ruleset. For Pathfinder 1E, how ability scores
 * are made, and whether characters need sleep, coins have weight and ammunition is tracked. For
 * Starfinder 1E, how many ability points characters spend, and whether characters need sleep and
 * ammunition is tracked
 */
export class RulesetTab implements SavableTab
{
	private readonly form = getElement('ruleset-form', HTMLFormElement);
	private readonly fields = getElement('ruleset-fields', HTMLFieldSetElement);
	private readonly rulesetName = getElement('ruleset-name', HTMLElement);
	private readonly pf1eStats = getElement('ruleset-pf1e-stats', HTMLElement);
	private readonly sf1eStats = getElement('ruleset-sf1e-stats', HTMLElement);
	private readonly statMethod = getElement('ruleset-stat-method', HTMLSelectElement);
	private readonly budgetField = getElement('ruleset-budget-field', HTMLElement);
	private readonly budget = getElement('ruleset-budget', HTMLInputElement);
	private readonly abilityPoints = getElement('ruleset-ability-points', HTMLInputElement);
	private readonly needsSleep = getElement('ruleset-needs-sleep', HTMLInputElement);
	private readonly coinsHaveWeightField = getElement('ruleset-coins-have-weight-field', HTMLElement);
	private readonly coinsHaveWeight = getElement('ruleset-coins-have-weight', HTMLInputElement);
	private readonly tracksAmmo = getElement('ruleset-tracks-ammo', HTMLInputElement);
	private readonly error = getElement('ruleset-error', HTMLElement);

	/**
	 * Whether the form has changes that haven't been saved
	 */
	readonly changes = new ChangeTracker({ root: this.form });

	private universe: EditableUniverse | undefined;

	/**
	 * Changes every time the tab opens a universe, so settings that arrive for an earlier one are ignored
	 */
	private openVersion = 0;

	/**
	 * @param api The editor's API
	 */
	constructor(private readonly api: EditorApi)
	{
		this.budget.min = String(PF1E_MIN_POINT_BUY_BUDGET);
		this.budget.max = String(PF1E_MAX_POINT_BUY_BUDGET);
		this.abilityPoints.min = String(SF1E_MIN_ABILITY_POINTS);
		this.abilityPoints.max = String(SF1E_MAX_ABILITY_POINTS);
		setOptions(this.statMethod, namedOptions(PF1E_STAT_METHODS, PF1E_STAT_METHOD_NAMES));

		this.statMethod.addEventListener('change', () =>
		{
			this.budgetField.hidden = (this.statMethod.value !== 'point_buy_custom');
		});

		for (const input of [this.budget, this.abilityPoints])
		{
			input.addEventListener('input', () =>
			{
				setFieldError(input, undefined);
			});
		}
	}

	/**
	 * Shows a universe's ruleset settings, read-only unless the player's role may change them
	 *
	 * @param universe The universe
	 */
	async open(universe: EditableUniverse): Promise<void>
	{
		const version = ++this.openVersion;

		this.universe = universe;
		this.rulesetName.textContent = t(RULESET_NAMES[universe.ruleset]);
		this.pf1eStats.hidden = (universe.ruleset !== 'pf1e');
		this.coinsHaveWeightField.hidden = (universe.ruleset !== 'pf1e');
		this.sf1eStats.hidden = (universe.ruleset !== 'sf1e');
		this.fields.disabled = true;
		showMessage(this.error, undefined);
		clearFieldErrors(this.form);

		let ruleset: RulesetSettings;

		try
		{
			ruleset = await this.api.getRulesetSettings(universe.id);
		}
		catch (error)
		{
			if (version === this.openVersion)
			{
				showMessage(this.error, describeEditorError(error, {
					id: 'editor.ruleset.loadFailed',
					defaultMessage: 'Could not load the ruleset\'s settings.',
					description: 'Shown on the Ruleset tab when its settings couldn\'t be loaded'
				}));
			}

			return;
		}

		if (version !== this.openVersion)
		{
			return;
		}

		if (ruleset.ruleset === 'pf1e')
		{
			const { settings } = ruleset;

			this.statMethod.value = settings.statMethod;
			this.budget.value = String(settings.customPointBuyBudget);
			this.budgetField.hidden = (settings.statMethod !== 'point_buy_custom');
			this.coinsHaveWeight.checked = settings.coinsHaveWeight;
		}
		else
		{
			this.abilityPoints.value = String(ruleset.settings.abilityPoints);
		}

		this.needsSleep.checked = ruleset.settings.needsSleep;
		this.tracksAmmo.checked = ruleset.settings.tracksAmmo;
		this.fields.disabled = !canEditUniverseSettings(universe.role);
		this.changes.markSaved();
	}

	/**
	 * Whether the player may change the ruleset's settings
	 *
	 * @return True for a creator
	 */
	canSave(): boolean
	{
		return((this.universe !== undefined) && canEditUniverseSettings(this.universe.role));
	}

	/**
	 * Saves the settings as the form shows them
	 *
	 * @return True when they were saved
	 */
	async save(): Promise<boolean>
	{
		const universe = this.universe;

		if (!universe)
		{
			return(false);
		}

		const ruleset = this.readSettings(universe);

		if (ruleset === undefined)
		{
			return(false);
		}

		showMessage(this.error, undefined);

		try
		{
			await this.api.saveRulesetSettings(universe.id, ruleset);
			this.changes.markSaved();

			return(true);
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, {
				id: 'editor.ruleset.saveFailed',
				defaultMessage: 'Could not save the ruleset\'s settings.',
				description: 'Shown on the Ruleset tab when its settings couldn\'t be stored'
			}));

			return(false);
		}
	}

	/**
	 * The settings as the form shows them, reporting the first number that is out of range
	 *
	 * @param universe The universe
	 * @return The settings for the universe's ruleset, or undefined when a field is wrong
	 */
	private readSettings(universe: EditableUniverse): RulesetSettings | undefined
	{
		if (universe.ruleset === 'sf1e')
		{
			const abilityPoints = wholeNumberIn(this.abilityPoints, SF1E_MIN_ABILITY_POINTS, SF1E_MAX_ABILITY_POINTS);

			if (abilityPoints === undefined)
			{
				reportNotWholeNumber(this.abilityPoints, SF1E_MIN_ABILITY_POINTS, SF1E_MAX_ABILITY_POINTS);
				return(undefined);
			}

			return({
				ruleset: 'sf1e',
				settings: {
					abilityPoints,
					needsSleep: this.needsSleep.checked,
					tracksAmmo: this.tracksAmmo.checked
				}
			});
		}

		const budget = wholeNumberIn(this.budget, PF1E_MIN_POINT_BUY_BUDGET, PF1E_MAX_POINT_BUY_BUDGET);

		if (budget === undefined)
		{
			this.budgetField.hidden = false;
			reportNotWholeNumber(this.budget, PF1E_MIN_POINT_BUY_BUDGET, PF1E_MAX_POINT_BUY_BUDGET);
			return(undefined);
		}

		return({
			ruleset: 'pf1e',
			settings: {
				statMethod: this.statMethod.value as Pf1eStatMethod,
				customPointBuyBudget: budget,
				needsSleep: this.needsSleep.checked,
				coinsHaveWeight: this.coinsHaveWeight.checked,
				tracksAmmo: this.tracksAmmo.checked
			}
		});
	}
}

/**
 * Reads a number field that must hold a whole number in a range
 *
 * @param field The field
 * @param min The lowest number allowed
 * @param max The highest number allowed
 * @return The number, or undefined when the field holds anything else
 */
function wholeNumberIn(field: HTMLInputElement, min: number, max: number): number | undefined
{
	const value = Number(field.value);

	return(((!Number.isInteger(value) || (value < min) || (value > max) || (field.value.trim() === '')) ? undefined : value));
}

/**
 * Shows under a number field that it needs a whole number in a range, and takes the player there
 *
 * @param field The field, which must be showing
 * @param min The lowest number allowed
 * @param max The highest number allowed
 */
function reportNotWholeNumber(field: HTMLInputElement, min: number, max: number): void
{
	reportFieldError(field, t(formMessages.wholeNumber, {
		min,
		max
	}));
}
