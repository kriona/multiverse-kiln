import { canEditUniverseSettings, PF1E_MAX_POINT_BUY_BUDGET, PF1E_MIN_POINT_BUY_BUDGET, PF1E_STAT_METHOD_NAMES, PF1E_STAT_METHODS, RULESET_NAMES, type EditableUniverse, type Pf1eStatMethod, type RulesetSettings } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { ChangeTracker } from '../changeTracker';
import { getElement, namedOptions, setOptions, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';

/**
 * The Ruleset tab: how the universe plays under its ruleset. For Pathfinder 1E, how ability scores
 * are made, and whether characters need sleep, coins have weight and ammunition is used up
 */
export class RulesetTab
{
	private readonly form = getElement('ruleset-form', HTMLFormElement);
	private readonly fields = getElement('ruleset-fields', HTMLFieldSetElement);
	private readonly rulesetName = getElement('ruleset-name', HTMLElement);
	private readonly statMethod = getElement('ruleset-stat-method', HTMLSelectElement);
	private readonly budgetField = getElement('ruleset-budget-field', HTMLElement);
	private readonly budget = getElement('ruleset-budget', HTMLInputElement);
	private readonly needsSleep = getElement('ruleset-needs-sleep', HTMLInputElement);
	private readonly coinsHaveWeight = getElement('ruleset-coins-have-weight', HTMLInputElement);
	private readonly tracksAmmo = getElement('ruleset-tracks-ammo', HTMLInputElement);
	private readonly error = getElement('ruleset-error', HTMLElement);
	private readonly saved = getElement('ruleset-saved', HTMLElement);
	private readonly saveButton = getElement('ruleset-save', HTMLButtonElement);

	/**
	 * Whether the form has changes that haven't been saved
	 */
	readonly changes = new ChangeTracker({
		root: this.form,
		status: this.saved
	});

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
		setOptions(this.statMethod, namedOptions(PF1E_STAT_METHODS, PF1E_STAT_METHOD_NAMES));

		this.statMethod.addEventListener('change', () =>
		{
			this.budgetField.hidden = (this.statMethod.value !== 'point_buy_custom');
			this.saved.textContent = '';
		});

		this.budget.addEventListener('input', () =>
		{
			setFieldError(this.budget, undefined);
			this.saved.textContent = '';
		});

		for (const checkbox of [this.needsSleep, this.coinsHaveWeight, this.tracksAmmo])
		{
			checkbox.addEventListener('change', () =>
			{
				this.saved.textContent = '';
			});
		}

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.save();
		});
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
		this.fields.disabled = true;
		this.saveButton.hidden = !canEditUniverseSettings(universe.role);
		this.saved.textContent = '';
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

		const { settings } = ruleset;

		this.statMethod.value = settings.statMethod;
		this.budget.value = String(settings.customPointBuyBudget);
		this.budgetField.hidden = (settings.statMethod !== 'point_buy_custom');
		this.needsSleep.checked = settings.needsSleep;
		this.coinsHaveWeight.checked = settings.coinsHaveWeight;
		this.tracksAmmo.checked = settings.tracksAmmo;
		this.fields.disabled = !canEditUniverseSettings(universe.role);
		this.changes.markSaved();
	}

	/**
	 * Saves the settings as the form shows them
	 */
	private async save(): Promise<void>
	{
		const universe = this.universe;
		const budget = Number(this.budget.value);

		if (!universe)
		{
			return;
		}

		if (!Number.isInteger(budget) || (budget < PF1E_MIN_POINT_BUY_BUDGET) || (budget > PF1E_MAX_POINT_BUY_BUDGET) || (this.budget.value.trim() === ''))
		{
			this.budgetField.hidden = false;
			reportFieldError(this.budget, t(formMessages.wholeNumber, {
				min: PF1E_MIN_POINT_BUY_BUDGET,
				max: PF1E_MAX_POINT_BUY_BUDGET
			}));
			return;
		}

		const ruleset: RulesetSettings = {
			ruleset: 'pf1e',
			settings: {
				statMethod: this.statMethod.value as Pf1eStatMethod,
				customPointBuyBudget: budget,
				needsSleep: this.needsSleep.checked,
				coinsHaveWeight: this.coinsHaveWeight.checked,
				tracksAmmo: this.tracksAmmo.checked
			}
		};

		this.saveButton.disabled = true;
		showMessage(this.error, undefined);

		try
		{
			await this.api.saveRulesetSettings(universe.id, ruleset);
			this.changes.markSaved();
			this.saved.textContent = t(formMessages.saved);
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, {
				id: 'editor.ruleset.saveFailed',
				defaultMessage: 'Could not save the ruleset\'s settings.',
				description: 'Shown on the Ruleset tab when its settings couldn\'t be stored'
			}));
		}
		finally
		{
			this.saveButton.disabled = false;
		}
	}
}
