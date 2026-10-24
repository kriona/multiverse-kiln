import { ABILITY_NAMES, characterSteps, DISALLOWED_TEXT_CHARACTERS, FLOATING_ABILITY_BONUSES, isReservedName, mainAbility, MAX_CHARACTER_NAME_LENGTH, MAX_CHARACTERS_PER_UNIVERSE, NAME_MESSAGES, PF1E_ABILITIES, PF1E_MAX_POINT_BUY_SCORE, PF1E_MIN_POINT_BUY_SCORE, PF1E_STAT_METHOD_NAMES, pf1eAbilityModifier, pf1ePointBuyCost, pf1ePointBuyTotal, SF1E_BASE_ABILITY_SCORE, SF1E_MAX_BOUGHT_SCORE, SF1E_THEME_ABILITY_BONUS, sf1eAbilityPointsSpent, sf1eOverraisedAbilities, type Ability, type AbilityScores, type CharacterClassOption, type CharacterDraft, type CharacterRaceOption, type CharacterStep, type CharacterThemeOption, type NewCharacterOptions, type Ruleset } from '@multiverse-kiln/shared';

import { currentLocale, formatList, signedNumber, t } from '../localization';
import type { CharacterApi } from '../network/characterApi';
import { describeEditorError } from '../network/editorApi';
import { universePageUrl } from '../pages';
import { announce } from './announcer';
import { ChangeTracker } from './changeTracker';
import { getElement, setOptions, showMessage, titleLink } from './dom';
import { clearFieldErrors, reportFieldError, setFieldError } from './fieldErrors';
import { formMessages } from './formMessages';
import { className, raceName, themeName } from './raceAndClassNames';

/**
 * How long after the player's last change their progress is saved, in milliseconds
 */
const SAVE_DELAY_MS = 1000;

/**
 * One ability's row in the table of scores
 */
interface AbilityRow
{
	/**
	 * The ability's name, with "(main ability)" for the class's primary ability
	 */
	name: HTMLElement;

	/**
	 * The rolled score (by its place among the rolls), bought score or raised score the ability gets
	 */
	base: HTMLSelectElement;

	race: HTMLElement;
	score: HTMLElement;
	modifier: HTMLElement;
}

/**
 * Create Character (see STRUCTURE-OVERVIEW.md, Create Character): the steps of making a character, from
 * its name to its ability scores, and a review before it is made
 *
 * The player's progress is saved on the server a moment after each change and whenever the step changes,
 * so they can leave and come back to it, in this browser or another. The server checks everything again
 * when the character is made: the scores must be its rolls in some order, within the point buy budget,
 * or within the ability points
 */
export class CreateCharacterScreen
{
	private readonly title = getElement('character-title', HTMLElement);
	private readonly universe = getElement('character-universe', HTMLElement);
	private readonly saveStatus = getElement('character-save-status', HTMLElement);
	private readonly loading = getElement('character-loading', HTMLElement);
	private readonly pageError = getElement('character-error', HTMLElement);
	private readonly body = getElement('character-body', HTMLElement);
	private readonly form = getElement('character-form', HTMLFormElement);
	private readonly fields = getElement('character-fields', HTMLFieldSetElement);
	private readonly name = getElement('character-name', HTMLInputElement);
	private readonly race = getElement('character-race', HTMLSelectElement);
	private readonly raceSummary = getElement('character-race-summary', HTMLElement);
	private readonly floatingLabel = getElement('character-floating-label', HTMLElement);
	private readonly floating = getElement('character-floating', HTMLSelectElement);
	private readonly characterClass = getElement('character-class', HTMLSelectElement);
	private readonly classHint = getElement('character-class-hint', HTMLElement);
	private readonly theme = getElement('character-theme', HTMLSelectElement);
	private readonly themeHint = getElement('character-theme-hint', HTMLElement);
	private readonly raceColumn = getElement('character-race-column', HTMLElement);
	private readonly method = getElement('character-method', HTMLElement);
	private readonly points = getElement('character-points', HTMLElement);
	private readonly overBudget = getElement('character-over-budget', HTMLElement);
	private readonly overLimit = getElement('character-over-limit', HTMLElement);
	private readonly review = getElement('character-review', HTMLElement);
	private readonly error = getElement('character-form-error', HTMLElement);
	private readonly backButton = getElement('character-back', HTMLButtonElement);
	private readonly nextButton = getElement('character-next', HTMLButtonElement);
	private readonly createButton = getElement('character-create', HTMLButtonElement);

	private readonly rows: Record<Ability, AbilityRow>;

	/**
	 * Whether the page holds progress the server hasn't saved yet, so leaving asks first
	 */
	private readonly changes: ChangeTracker;

	/**
	 * What the server offered, once it has loaded
	 */
	private options: NewCharacterOptions | undefined;

	private universeId = '';
	private step: CharacterStep = 'name';

	/**
	 * The steps of the universe's ruleset, in order
	 */
	private steps: CharacterStep[] = characterSteps('pf1e');

	/**
	 * The progress as last saved, as JSON
	 */
	private savedDraft = '';

	/**
	 * The save waiting for the player to stop making changes
	 */
	private saveTimer: number | undefined;

	/**
	 * The save on its way to the server, if any; saves are sent one at a time
	 */
	private saving: Promise<void> | undefined;

	/**
	 * @param api The character routes
	 * @param leave Goes back to the universe's lobby
	 */
	constructor(private readonly api: CharacterApi, private readonly leave: () => void)
	{
		this.name.maxLength = MAX_CHARACTER_NAME_LENGTH;
		this.rows = createAbilityRows(getElement('character-abilities', HTMLTableSectionElement));
		this.changes = new ChangeTracker({
			root: this.form,
			state: () => this.step
		});

		for (const type of ['input', 'change'])
		{
			this.form.addEventListener(type, () =>
			{
				this.queueSave();
			});
		}

		// Says straight away when a name can't be taken; the server checks it again
		this.name.addEventListener('input', () =>
		{
			setFieldError(this.name, (isReservedName(this.name.value) ? t(NAME_MESSAGES.reserved) : undefined));
		});

		this.race.addEventListener('change', () =>
		{
			this.showRace();
		});

		this.floating.addEventListener('change', () =>
		{
			this.showScores();
		});

		this.characterClass.addEventListener('change', () =>
		{
			this.showClass();
		});

		this.theme.addEventListener('change', () =>
		{
			this.showTheme();
		});

		for (const ability of PF1E_ABILITIES)
		{
			this.rows[ability].base.addEventListener('change', () =>
			{
				this.onBaseChanged(ability);
			});
		}

		for (const step of characterSteps('sf1e'))
		{
			getElement(`character-nav-${step}`, HTMLButtonElement).addEventListener('click', () =>
			{
				this.goToStep(step);
			});
		}

		this.backButton.addEventListener('click', () =>
		{
			this.goToStep(this.steps[Math.max(this.steps.indexOf(this.step) - 1, 0)]);
		});

		this.nextButton.addEventListener('click', () =>
		{
			this.goToStep(this.steps[Math.min(this.steps.indexOf(this.step) + 1, this.steps.length - 1)]);
		});

		getElement('character-start-over', HTMLButtonElement).addEventListener('click', () =>
		{
			void this.startOver();
		});

		getElement('character-lobby', HTMLButtonElement).addEventListener('click', () =>
		{
			void this.saveAndLeave();
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.create();
		});
	}

	/**
	 * Loads what Create Character offers in a universe and the player's progress, and shows the step they were on
	 *
	 * @param universeId The universe's ID
	 */
	async open(universeId: string): Promise<void>
	{
		let options: NewCharacterOptions;

		this.universeId = universeId;
		this.setTitle(undefined);

		try
		{
			options = await this.api.getNewCharacterOptions(universeId);
		}
		catch (error)
		{
			this.loading.hidden = true;
			showMessage(this.pageError, describeEditorError(error, {
				id: 'character.create.loadFailed',
				defaultMessage: 'Could not load the races, classes and ability scores.',
				description: 'Shown on the Create Character page when what it offers couldn\'t be loaded'
			}));
			return;
		}

		const { ruleset } = options;

		this.options = options;
		this.steps = characterSteps(ruleset);
		this.setTitle(options.universeName);
		this.showRulesetSteps(ruleset);
		setOptions(this.race, sortByName(options.races.map((race) => ({
			value: String(race.id),
			label: raceName(race, ruleset)
		}))));
		setOptions(this.characterClass, sortByName(options.classes.map((characterClass) => ({
			value: String(characterClass.id),
			label: className(characterClass, ruleset)
		}))));
		setOptions(this.theme, sortByName(options.themes.map((theme) => ({
			value: String(theme.id),
			label: themeName(theme, ruleset)
		}))));
		setOptions(this.floating, PF1E_ABILITIES.map((ability) => ({
			value: ability,
			label: this.abilityName(ability)
		})));
		this.nameAbilityRows();
		this.showAbilityOptions(options);
		this.applyDraft(options.draft);
		this.loading.hidden = true;
		this.body.hidden = false;

		if (options.characterCount >= MAX_CHARACTERS_PER_UNIVERSE)
		{
			showMessage(this.pageError, t({
				id: 'character.create.limit',
				defaultMessage: 'You have {max, plural, one {# character} other {# characters}} in this universe, as many as you can have.',
				description: 'Shown on the Create Character page when the player can\'t make another character in this universe; {max} is the most allowed'
			}, {
				max: MAX_CHARACTERS_PER_UNIVERSE
			}));
			this.createButton.disabled = true;
		}

		this.step = (this.steps.find((step) => (step === options.draft?.step)) ?? 'name');
		this.savedDraft = JSON.stringify(this.readDraft());
		this.changes.markSaved();
		this.goToStep(this.step);
	}

	/**
	 * Shows the universe's name in the toolbar and the browser tab's title
	 *
	 * @param universeName The name, or undefined until it has loaded
	 */
	private setTitle(universeName: string | undefined): void
	{
		this.universe.replaceChildren(...((universeName === undefined) ? [] : [titleLink(universeName, universePageUrl(this.universeId))]));
		document.title = ((universeName === undefined)
			? t({
				id: 'character.pageTitleLoading',
				defaultMessage: 'Create Character - Multiverse Kiln',
				description: 'The browser tab\'s title for the Create Character page until the universe\'s name has loaded'
			})
			: t({
				id: 'character.pageTitle',
				defaultMessage: 'Create Character - {universe} - Multiverse Kiln',
				description: 'The browser tab\'s title for the Create Character page; {universe} is the universe\'s name and Multiverse Kiln is the game engine\'s name'
			}, {
				universe: universeName
			}));
	}

	/**
	 * Shows the steps of the universe's ruleset in the list of steps, and names the table's column of
	 * bonuses for what adds to the scores
	 *
	 * @param ruleset The universe's ruleset
	 */
	private showRulesetSteps(ruleset: Ruleset): void
	{
		for (const step of characterSteps('sf1e'))
		{
			const item = getElement(`character-nav-${step}`, HTMLButtonElement).parentElement;

			if (item)
			{
				item.hidden = !this.steps.includes(step);
			}
		}

		if (ruleset === 'sf1e')
		{
			this.raceColumn.textContent = t({
				id: 'character.create.raceAndThemeColumn',
				defaultMessage: 'Race and theme',
				description: 'Heading of the column of how much the chosen race and theme add to or take from each score, in Create Character in Starfinder'
			});
		}
	}

	/**
	 * Fills the form with saved progress, leaving out what no longer fits the universe: a race, class or
	 * theme that can't be chosen now, or scores that aren't the current rolls or can't be bought
	 *
	 * @param draft The progress, or null to start from nothing
	 */
	private applyDraft(draft: CharacterDraft | null): void
	{
		const options = this.options;

		if (!options)
		{
			return;
		}

		this.name.value = (draft?.name ?? '');
		this.race.value = String(options.races.find((race) => (race.id === draft?.raceId))?.id ?? (this.race.options[0]?.value ?? ''));
		this.characterClass.value = String(options.classes.find((characterClass) => (characterClass.id === draft?.classId))?.id ?? (this.characterClass.options[0]?.value ?? ''));
		this.theme.value = String(options.themes.find((theme) => (theme.id === draft?.themeId))?.id ?? (this.theme.options[0]?.value ?? ''));
		this.setBaseScores(draft?.baseScores ?? null);
		this.floatingLabel.hidden = true;
		this.showClass();
		this.showTheme();
		this.showRace();

		if (draft?.floatingAbility)
		{
			this.floating.value = draft.floatingAbility;
		}

		clearFieldErrors(this.form);
		showMessage(this.error, undefined);
		this.showScores();
	}

	/**
	 * Fills the base score fields with the rolled scores, in the order rolled, with point buy's scores,
	 * or with the scores ability points can raise to, and says how the scores are made
	 *
	 * @param options What the server offered
	 */
	private showAbilityOptions(options: NewCharacterOptions): void
	{
		const { abilities } = options;

		// A rolled score's field shows only its number while closed, so it can be narrower
		for (const ability of PF1E_ABILITIES)
		{
			this.rows[ability].base.classList.toggle('rolled-score', (abilities.kind === 'roll'));
		}

		if (abilities.kind === 'roll')
		{
			const choices = abilities.rolls.map((score, index) => ({
				value: String(index),
				label: String(score)
			}));

			for (const ability of PF1E_ABILITIES)
			{
				setOptions(this.rows[ability].base, choices);
			}

			this.method.textContent = t({
				id: 'character.create.rolled',
				defaultMessage: 'The server rolled your scores with {method}. Choose which ability gets each score: giving an ability another score swaps the two.',
				description: 'Explains the ability scores in Create Character when they were rolled; {method} is how, e.g. "4d6, drop the lowest"'
			}, {
				method: t(PF1E_STAT_METHOD_NAMES[abilities.statMethod])
			});
		}
		else if (abilities.kind === 'pointBuy')
		{
			const choices = [];

			for (let score = PF1E_MIN_POINT_BUY_SCORE; score <= PF1E_MAX_POINT_BUY_SCORE; score++)
			{
				choices.push({
					value: String(score),
					label: t({
						id: 'character.create.boughtScore',
						defaultMessage: '{score, number} ({cost, plural, one {# point} other {# points}})',
						description: 'One choice of ability score when buying scores with points in Create Character; {score} is the score and {cost} what it costs, which is negative for scores under 10'
					}, {
						score,
						cost: (pf1ePointBuyCost(score) ?? 0)
					})
				});
			}

			for (const ability of PF1E_ABILITIES)
			{
				setOptions(this.rows[ability].base, choices);
			}

			this.method.textContent = t({
				id: 'character.create.pointBuy',
				defaultMessage: 'Buy your scores with {budget, plural, one {# point} other {# points}}. Scores above 10 cost points, and scores below 10 give some back.',
				description: 'Explains the ability scores in Create Character when the player buys them with points; {budget} is how many points they have'
			}, {
				budget: abilities.budget
			});
		}
		else
		{
			const choices = [];

			for (let score = SF1E_BASE_ABILITY_SCORE; score <= SF1E_MAX_BOUGHT_SCORE; score++)
			{
				choices.push({
					value: String(score),
					label: t({
						id: 'character.create.raisedScore',
						defaultMessage: '{score, number} ({points, plural, one {# point} other {# points}})',
						description: 'One choice of ability score when raising scores with ability points in Create Character in Starfinder; {score} is the score and {points} how many points it takes from 10'
					}, {
						score,
						points: (score - SF1E_BASE_ABILITY_SCORE)
					})
				});
			}

			for (const ability of PF1E_ABILITIES)
			{
				setOptions(this.rows[ability].base, choices);
			}

			this.method.textContent = t({
				id: 'character.create.abilityPoints',
				defaultMessage: 'Every score starts at {base, number}. Spend {points, plural, one {# ability point} other {# ability points}} to raise them, one point for each +1, up to {max, number} with your race\'s and theme\'s bonuses.',
				description: 'Explains the ability scores in Create Character in Starfinder; {base} is the score every ability starts at, {points} how many points the player has, and {max} the highest score points can raise one to'
			}, {
				base: SF1E_BASE_ABILITY_SCORE,
				points: abilities.points,
				max: SF1E_MAX_BOUGHT_SCORE
			});
		}
	}

	/**
	 * Sets the base score fields: rolled scores in the order saved when they are still the rolls, or in
	 * the order rolled; bought or raised scores as saved when the ruleset allows each, or 10
	 *
	 * @param scores The saved scores, or null for none
	 */
	private setBaseScores(scores: AbilityScores | null): void
	{
		const abilities = this.options?.abilities;

		if (!abilities)
		{
			return;
		}

		if (abilities.kind === 'roll')
		{
			const unused = abilities.rolls.map((_score, index) => index);
			const indexes = PF1E_ABILITIES.map((ability) =>
			{
				const position = unused.findIndex((index) => (abilities.rolls[index] === scores?.[ability]));

				return(((position === -1) ? undefined : unused.splice(position, 1)[0]));
			});

			PF1E_ABILITIES.forEach((ability, order) =>
			{
				this.rows[ability].base.value = String((indexes.every((index) => (index !== undefined)) ? indexes[order] : order));
			});
		}
		else
		{
			for (const ability of PF1E_ABILITIES)
			{
				const score = (scores?.[ability] ?? 10);
				const allowed = ((abilities.kind === 'pointBuy')
					? (pf1ePointBuyCost(score) !== null)
					: ((score >= SF1E_BASE_ABILITY_SCORE) && (score <= SF1E_MAX_BOUGHT_SCORE)));

				this.rows[ability].base.value = String((allowed ? score : 10));
			}
		}
	}

	/**
	 * Shows a step and hides the others, saving the progress, and moves focus to its heading
	 *
	 * @param step The step
	 */
	private goToStep(step: CharacterStep): void
	{
		const index = this.steps.indexOf(step);

		this.step = step;

		for (const other of characterSteps('sf1e'))
		{
			const button = getElement(`character-nav-${other}`, HTMLButtonElement);

			getElement(`character-step-${other}`, HTMLElement).hidden = (other !== step);

			if (other === step)
			{
				button.setAttribute('aria-current', 'step');
			}
			else
			{
				button.removeAttribute('aria-current');
			}
		}

		this.backButton.hidden = (index === 0);
		this.nextButton.hidden = (index === (this.steps.length - 1));
		this.createButton.hidden = (step !== 'review');

		if (step === 'review')
		{
			this.showReview();
		}

		const heading = getElement(`character-heading-${step}`, HTMLElement);

		heading.tabIndex = -1;
		heading.focus();
		this.changes.check();
		void this.saveNow();
	}

	/**
	 * Shows whether the chosen race lets the player place a bonus, what it changes, and the scores with its modifiers
	 */
	private showRace(): void
	{
		const race = this.chosenRace();
		const characterClass = this.chosenClass();
		const floatingBonus = (race?.rules.floatingBonus ?? false);

		if (floatingBonus && this.floatingLabel.hidden)
		{
			this.floating.value = (characterClass ? mainAbility(characterClass.rules) : PF1E_ABILITIES[0]);
		}

		this.floatingLabel.hidden = !floatingBonus;
		this.raceSummary.textContent = (race ? this.describeRace(race) : '');
		this.showScores();
	}

	/**
	 * Says which ability the chosen class relies on most, and marks it in the table
	 */
	private showClass(): void
	{
		const characterClass = this.chosenClass();
		const classAbility = (characterClass ? mainAbility(characterClass.rules) : undefined);

		for (const ability of PF1E_ABILITIES)
		{
			this.rows[ability].name.textContent = ((classAbility === ability)
				? t({
					id: 'character.create.primaryAbility',
					defaultMessage: '{ability} (main ability)',
					description: 'An ability\'s name in Create Character\'s table of scores when the chosen class relies on it most; {ability} is its name, e.g. Strength'
				}, {
					ability: this.abilityName(ability)
				})
				: this.abilityName(ability));
		}

		this.classHint.textContent = ((classAbility === undefined)
			? ''
			: t({
				id: 'character.create.classHint',
				defaultMessage: 'This class relies most on {ability}, so it is a good place for a high score.',
				description: 'Hint under the class field of Create Character; {ability} is the ability the chosen class relies on, e.g. Strength'
			}, {
				ability: this.abilityName(classAbility)
			}));
	}

	/**
	 * Says which ability the chosen theme raises, and shows the scores with its bonus
	 */
	private showTheme(): void
	{
		const theme = this.chosenTheme();

		this.themeHint.textContent = (theme
			? t({
				id: 'character.create.themeHint',
				defaultMessage: 'This theme raises {ability} by {bonus, number}.',
				description: 'Hint under the theme field of Create Character in Starfinder; {ability} is the ability the chosen theme raises, e.g. Dexterity, and {bonus} by how much'
			}, {
				ability: this.abilityName(theme.rules.ability),
				bonus: SF1E_THEME_ABILITY_BONUS
			})
			: '');
		this.showScores();
	}

	/**
	 * Swaps the score an ability had onto the ability that had the rolled score it was just given, so
	 * each rolled score is used once
	 *
	 * @param changed The ability whose score the player changed
	 */
	private onBaseChanged(changed: Ability): void
	{
		const abilities = this.options?.abilities;

		if (abilities?.kind === 'roll')
		{
			const taken = new Set(PF1E_ABILITIES.map((ability) => this.rows[ability].base.value));
			const freed = [...this.rows[changed].base.options]
				.map((option) => option.value)
				.find((value) => !taken.has(value));
			const other = PF1E_ABILITIES.find((ability) => ((ability !== changed) && (this.rows[ability].base.value === this.rows[changed].base.value)));

			if ((freed !== undefined) && (other !== undefined))
			{
				const otherBase = this.rows[other].base;

				otherBase.value = freed;
				announce(t({
					id: 'character.create.swapped',
					defaultMessage: '{ability} now has {score, number}.',
					description: 'Read out by screen readers in Create Character when giving one ability a rolled score moves that ability\'s old score to another; {ability} is the other ability, e.g. Dexterity'
				}, {
					ability: this.abilityName(other),
					score: (abilities.rolls[Number(freed)] ?? 0)
				}));
			}
		}

		this.showScores();
	}

	/**
	 * Shows each ability's race modifier, final score and its modifier, the points spent, and whether
	 * they are more than the player has or raise a score too high
	 */
	private showScores(): void
	{
		const options = this.options;

		if (!options)
		{
			return;
		}

		const scores = this.finalScores(options);
		const { abilities } = options;

		this.labelRolledScores(options);

		for (const ability of PF1E_ABILITIES)
		{
			const row = this.rows[ability];

			row.race.textContent = signedNumber(this.bonus(ability));
			row.score.textContent = String(scores[ability]);
			row.modifier.textContent = signedNumber(pf1eAbilityModifier(scores[ability]));
		}

		if (abilities.kind === 'roll')
		{
			this.points.hidden = true;
			this.showOverBudget(undefined);
			this.showOverLimit([]);
			return;
		}

		const budget = ((abilities.kind === 'pointBuy') ? abilities.budget : abilities.points);

		this.points.textContent = t({
			id: 'character.create.pointsSpent',
			defaultMessage: 'Points spent: {spent, number} of {budget, number}',
			description: 'Under the ability scores in Create Character when buying them with points; {spent} is how many the chosen scores cost and {budget} how many the player has'
		}, {
			spent: (this.pointsSpent(options) ?? 0),
			budget
		});
		this.points.hidden = false;
		this.showOverBudget(this.isOverBudget(options) ? budget : undefined);
		this.showOverLimit(this.overraisedAbilities(options));
	}

	/**
	 * Names, in each ability's choice of rolled scores, the ability that holds each other score, so
	 * equal scores can be told apart: choosing "15 (Wisdom)" swaps with Wisdom. The ability's own score
	 * is just the number
	 *
	 * @param options What Create Character offers
	 */
	private labelRolledScores(options: NewCharacterOptions): void
	{
		const { abilities } = options;

		if (abilities.kind !== 'roll')
		{
			return;
		}

		const holders = new Map(PF1E_ABILITIES.map((ability) => [this.rows[ability].base.value, ability]));

		for (const ability of PF1E_ABILITIES)
		{
			for (const option of this.rows[ability].base.options)
			{
				const score = (abilities.rolls[Number(option.value)] ?? 0);
				const holder = holders.get(option.value);

				option.textContent = (((holder === undefined) || (holder === ability))
					? score.toLocaleString(currentLocale())
					: t({
						id: 'character.create.rolledScoreHeld',
						defaultMessage: '{score, number} ({ability})',
						description: 'One choice of rolled score for an ability in Create Character, naming the other ability that has it now, which choosing it swaps with; {score} is the score and {ability} that ability, e.g. "15 (Wisdom)"'
					}, {
						score,
						ability: this.abilityName(holder)
					}));
			}
		}
	}

	/**
	 * How many points the bought or raised scores spend
	 *
	 * @param options What Create Character offers
	 * @return The points, or null when the universe rolls scores or a score can't be bought
	 */
	private pointsSpent(options: NewCharacterOptions): number | null
	{
		const baseScores = this.baseScores(options);

		switch (options.abilities.kind)
		{
			case 'roll':
				return(null);

			case 'pointBuy':
				return(pf1ePointBuyTotal(baseScores));

			case 'abilityPoints':
				return(sf1eAbilityPointsSpent(baseScores));
		}
	}

	/**
	 * Whether the bought or raised scores spend more points than the player has
	 *
	 * @param options What Create Character offers
	 * @return True when they do; false when the universe rolls scores
	 */
	private isOverBudget(options: NewCharacterOptions): boolean
	{
		const { abilities } = options;

		if (abilities.kind === 'roll')
		{
			return(false);
		}

		return((this.pointsSpent(options) ?? Infinity) > ((abilities.kind === 'pointBuy') ? abilities.budget : abilities.points));
	}

	/**
	 * The abilities that ability points raise above SF1E_MAX_BOUGHT_SCORE with their bonuses
	 *
	 * @param options What Create Character offers
	 * @return The abilities; none unless the universe uses ability points
	 */
	private overraisedAbilities(options: NewCharacterOptions): Ability[]
	{
		if (options.abilities.kind !== 'abilityPoints')
		{
			return([]);
		}

		const bonuses = Object.fromEntries(PF1E_ABILITIES.map((ability) => [ability, this.bonus(ability)])) as AbilityScores;

		return(sf1eOverraisedAbilities(this.baseScores(options), bonuses));
	}

	/**
	 * Shows or hides the warning that the bought scores cost too much, changing it only when that
	 * changes, so a screen reader reads it out once each time it appears
	 *
	 * @param budget The points the player has while the scores cost more, or undefined to hide it
	 */
	private showOverBudget(budget: number | undefined): void
	{
		const message = ((budget === undefined)
			? undefined
			: t({
				id: 'character.create.overBudget',
				defaultMessage: 'These scores cost more than your {budget, plural, one {# point} other {# points}}. Lower some of them.',
				description: 'Shown in Create Character, under the ability scores, while the bought scores cost more points than the player has; {budget} is how many they have'
			}, {
				budget
			}));

		showChangedMessage(this.overBudget, message);
	}

	/**
	 * Shows or hides the warning that ability points raise scores too high, changing it only when that
	 * changes, so a screen reader reads it out once each time it appears
	 *
	 * @param abilities The abilities raised too high; none hides it
	 */
	private showOverLimit(abilities: Ability[]): void
	{
		const message = ((abilities.length === 0)
			? undefined
			: t({
				id: 'character.create.overLimit',
				defaultMessage: 'Ability points can\'t raise a score above {max, number} with its bonuses. Lower {abilities}.',
				description: 'Shown in Create Character in Starfinder, under the ability scores, while points raise a score past the most allowed; {max} is that score and {abilities} the abilities to lower, e.g. "Strength and Dexterity"'
			}, {
				max: SF1E_MAX_BOUGHT_SCORE,
				abilities: formatList(abilities.map((ability) => this.abilityName(ability)))
			}));

		showChangedMessage(this.overLimit, message);
	}

	/**
	 * Lists the choices made, for the last step
	 */
	private showReview(): void
	{
		const options = this.options;
		const race = this.chosenRace();
		const characterClass = this.chosenClass();
		const theme = this.chosenTheme();

		if (!options)
		{
			return;
		}

		const { ruleset } = options;
		const scores = this.finalScores(options);
		const floatingAbility = this.chosenFloatingAbility();
		const entries: [string, string][] = [
			[t({
				id: 'character.review.name',
				defaultMessage: 'Name',
				description: 'In the review step of Create Character, the label of the character\'s name'
			}), ((this.name.value.trim() === '')
				? t({
					id: 'character.review.noName',
					defaultMessage: 'Not chosen yet',
					description: 'In the review step of Create Character, shown for the name when the player hasn\'t written one'
				})
				: this.name.value.trim())],
			[t({
				id: 'character.review.race',
				defaultMessage: 'Race',
				description: 'In the review step of Create Character, the label of the character\'s race'
			}), ((race && floatingAbility)
				? t({
					id: 'character.review.raceWithBonus',
					defaultMessage: '{race}, +{bonus, number} {ability}',
					description: 'In the review step of Create Character, a race that lets the player place a bonus, with where it went; {race} is e.g. Human, {bonus} the bonus and {ability} e.g. Strength'
				}, {
					race: raceName(race, ruleset),
					bonus: FLOATING_ABILITY_BONUSES[ruleset],
					ability: this.abilityName(floatingAbility)
				})
				: (race ? raceName(race, ruleset) : ''))],
			[t({
				id: 'character.review.class',
				defaultMessage: 'Class',
				description: 'In the review step of Create Character, the label of the character\'s class'
			}), (characterClass ? className(characterClass, ruleset) : '')]
		];

		if (this.steps.includes('theme'))
		{
			entries.push([t({
				id: 'character.review.theme',
				defaultMessage: 'Theme',
				description: 'In the review step of Create Character in Starfinder, the label of the character\'s theme (a background, such as ace pilot)'
			}), (theme ? themeName(theme, ruleset) : '')]);
		}

		entries.push(...PF1E_ABILITIES.map((ability): [string, string] => [this.abilityName(ability), t({
			id: 'character.review.score',
			defaultMessage: '{score, number} ({modifier})',
			description: 'In the review step of Create Character, an ability score with the bonus or penalty it gives; {score} is e.g. 16 and {modifier} e.g. +3'
		}, {
			score: scores[ability],
			modifier: signedNumber(pf1eAbilityModifier(scores[ability]))
		})]));

		this.review.replaceChildren(...entries.flatMap(([term, value]) =>
		{
			const termElement = document.createElement('dt');
			const valueElement = document.createElement('dd');

			termElement.textContent = term;
			valueElement.textContent = value;

			return([termElement, valueElement]);
		}));
	}

	/**
	 * Saves the progress once the player has stopped making changes for SAVE_DELAY_MS
	 */
	private queueSave(): void
	{
		window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() =>
		{
			void this.saveNow();
		}, SAVE_DELAY_MS);
	}

	/**
	 * Saves the progress now if it changed since it was last saved, after any save already on its way
	 */
	private async saveNow(): Promise<void>
	{
		window.clearTimeout(this.saveTimer);
		this.saveTimer = undefined;

		while (this.saving)
		{
			await this.saving;
		}

		if (!this.options)
		{
			return;
		}

		const draft = this.readDraft();
		const json = JSON.stringify(draft);

		if (json === this.savedDraft)
		{
			this.changes.markSaved();
			return;
		}

		this.saveStatus.textContent = t(formMessages.saving);
		this.saving = this.api.saveDraft(this.universeId, draft)
			.then(() =>
			{
				this.savedDraft = json;
				this.saveStatus.textContent = t({
					id: 'character.saved',
					defaultMessage: 'Progress saved',
					description: 'In the toolbar of the Create Character page once the player\'s progress is saved, so they can leave and come back to it'
				});

				// Changes made while the save was on its way are saved by their own queued save
				if (JSON.stringify(this.readDraft()) === json)
				{
					this.changes.markSaved();
				}
			})
			.catch((error: unknown) =>
			{
				this.saveStatus.textContent = describeEditorError(error, {
					id: 'character.saveFailed',
					defaultMessage: 'Could not save your progress.',
					description: 'In the toolbar of the Create Character page when the player\'s progress couldn\'t be saved; it is tried again after their next change'
				});
			})
			.finally(() =>
			{
				this.saving = undefined;
			});

		await this.saving;
	}

	/**
	 * Saves the progress and goes back to the lobby. If saving fails, the browser asks before leaving
	 */
	private async saveAndLeave(): Promise<void>
	{
		await this.saveNow();
		this.leave();
	}

	/**
	 * Throws away the progress after asking, keeping the rolled scores
	 */
	private async startOver(): Promise<void>
	{
		if (!window.confirm(t({
			id: 'character.confirmStartOver',
			defaultMessage: 'Start over? Your choices so far will be lost. Your rolled ability scores stay the same.',
			description: 'Asks before the Create Character page throws away the player\'s choices; the scores the server rolled are kept'
		})))
		{
			return;
		}

		window.clearTimeout(this.saveTimer);

		while (this.saving)
		{
			await this.saving;
		}

		try
		{
			await this.api.deleteDraft(this.universeId);
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, {
				id: 'character.startOverFailed',
				defaultMessage: 'Could not start over.',
				description: 'Shown on the Create Character page when the player\'s progress couldn\'t be thrown away'
			}));
			return;
		}

		this.applyDraft(null);
		this.step = 'name';
		this.savedDraft = JSON.stringify(this.readDraft());
		this.saveStatus.textContent = '';
		this.goToStep('name');
	}

	/**
	 * Sends the character to the server, and goes back to the lobby once it is made
	 */
	private async create(): Promise<void>
	{
		const options = this.options;
		const race = this.chosenRace();
		const characterClass = this.chosenClass();
		const theme = this.chosenTheme();
		const name = this.name.value.trim();

		if (!options || !race || !characterClass || (this.steps.includes('theme') && !theme))
		{
			return;
		}

		if ((name === '') || DISALLOWED_TEXT_CHARACTERS.test(name))
		{
			this.goToStep('name');
			reportFieldError(this.name, t(formMessages.invalidText));
			return;
		}

		if (isReservedName(name))
		{
			this.goToStep('name');
			reportFieldError(this.name, t(NAME_MESSAGES.reserved));
			return;
		}

		const baseScores = this.baseScores(options);

		// The abilities step shows why
		if (this.isOverBudget(options) || (this.overraisedAbilities(options).length > 0))
		{
			this.goToStep('abilities');
			return;
		}

		window.clearTimeout(this.saveTimer);
		this.fields.disabled = true;
		showMessage(this.error, undefined);

		try
		{
			await this.api.createCharacter(this.universeId, {
				name,
				raceId: race.id,
				classId: characterClass.id,
				themeId: (theme?.id ?? null),
				baseScores,
				floatingAbility: this.chosenFloatingAbility()
			});
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, {
				id: 'character.create.failed',
				defaultMessage: 'Could not make the character.',
				description: 'Shown in Create Character when the character couldn\'t be made'
			}));
			this.fields.disabled = false;
			return;
		}

		// The server threw the progress away along with the rolls
		this.changes.markSaved();
		this.leave();
	}

	/**
	 * The progress as the form shows it
	 *
	 * @return The progress
	 */
	private readDraft(): CharacterDraft
	{
		const options = this.options;

		return({
			step: this.step,
			name: this.name.value.slice(0, MAX_CHARACTER_NAME_LENGTH),
			raceId: (this.chosenRace()?.id ?? null),
			classId: (this.chosenClass()?.id ?? null),
			themeId: (this.chosenTheme()?.id ?? null),
			baseScores: (options ? this.baseScores(options) : null),
			floatingAbility: this.chosenFloatingAbility()
		});
	}

	/**
	 * The score each ability's base field gives it
	 *
	 * @param options What the server offered
	 * @return The scores, before racial modifiers
	 */
	private baseScores(options: NewCharacterOptions): AbilityScores
	{
		const { abilities } = options;

		return(Object.fromEntries(PF1E_ABILITIES.map((ability) =>
		{
			const value = Number(this.rows[ability].base.value);

			return([ability, ((abilities.kind === 'roll') ? (abilities.rolls[value] ?? 0) : value)]);
		})) as AbilityScores);
	}

	/**
	 * Each ability's score with the chosen race's modifiers and bonus, and the chosen theme's bonus
	 *
	 * @param options What the server offered
	 * @return The scores
	 */
	private finalScores(options: NewCharacterOptions): AbilityScores
	{
		const base = this.baseScores(options);

		return(Object.fromEntries(PF1E_ABILITIES.map((ability) => [ability, (base[ability] + this.bonus(ability))])) as AbilityScores);
	}

	/**
	 * What the chosen race and theme add to an ability, the race's floating bonus included
	 *
	 * @param ability The ability
	 * @return The amount, which may be negative
	 */
	private bonus(ability: Ability): number
	{
		const ruleset = (this.options?.ruleset ?? 'pf1e');
		const race = (this.chosenRace()?.rules.abilityModifiers[ability] ?? 0);
		const floating = ((ability === this.chosenFloatingAbility()) ? FLOATING_ABILITY_BONUSES[ruleset] : 0);
		const theme = ((this.chosenTheme()?.rules.ability === ability) ? SF1E_THEME_ABILITY_BONUS : 0);

		return(race + floating + theme);
	}

	/**
	 * The race chosen
	 *
	 * @return The race, or undefined before the options load
	 */
	private chosenRace(): CharacterRaceOption | undefined
	{
		return(this.options?.races.find((race) => (String(race.id) === this.race.value)));
	}

	/**
	 * The class chosen
	 *
	 * @return The class, or undefined before the options load
	 */
	private chosenClass(): CharacterClassOption | undefined
	{
		return(this.options?.classes.find((characterClass) => (String(characterClass.id) === this.characterClass.value)));
	}

	/**
	 * The theme chosen
	 *
	 * @return The theme, or undefined in a ruleset without themes or before the options load
	 */
	private chosenTheme(): CharacterThemeOption | undefined
	{
		return(this.options?.themes.find((theme) => (String(theme.id) === this.theme.value)));
	}

	/**
	 * The ability chosen for the race's floating bonus
	 *
	 * @return The ability, or null when the race has no floating bonus
	 */
	private chosenFloatingAbility(): Ability | null
	{
		if (!this.chosenRace()?.rules.floatingBonus)
		{
			return(null);
		}

		return((PF1E_ABILITIES.find((ability) => (ability === this.floating.value)) ?? null));
	}

	/**
	 * An ability's name in the universe's ruleset, in the player's language
	 *
	 * @param ability The ability
	 * @return The name
	 */
	private abilityName(ability: Ability): string
	{
		return(t(ABILITY_NAMES[this.options?.ruleset ?? 'pf1e'][ability]));
	}

	/**
	 * Names each ability's base score field for screen readers, in the universe's ruleset's words
	 */
	private nameAbilityRows(): void
	{
		for (const ability of PF1E_ABILITIES)
		{
			this.rows[ability].base.setAttribute('aria-label', t({
				id: 'character.create.baseLabel',
				defaultMessage: '{ability} base score',
				description: 'Name for screen readers of the field for one ability\'s score before the race changes it, in Create Character; {ability} is e.g. Strength'
			}, {
				ability: this.abilityName(ability)
			}));
		}
	}

	/**
	 * What a race changes, in a sentence: its ability modifiers and whether the player places a bonus
	 *
	 * @param race The race
	 * @return The sentence, e.g. "+2 Constitution, +2 Wisdom, -2 Charisma"
	 */
	private describeRace(race: CharacterRaceOption): string
	{
		const modifiers = PF1E_ABILITIES
			.filter((ability) => (race.rules.abilityModifiers[ability] !== 0))
			.map((ability) => t({
				id: 'character.race.modifier',
				defaultMessage: '{modifier} {ability}',
				description: 'One of a race\'s ability modifiers in Create Character; {modifier} is e.g. +2 and {ability} e.g. Wisdom. Reorder them as your language needs'
			}, {
				modifier: signedNumber(race.rules.abilityModifiers[ability]),
				ability: this.abilityName(ability)
			}));

		if (race.rules.floatingBonus)
		{
			modifiers.push(t({
				id: 'character.race.floatingBonus',
				defaultMessage: '+{bonus, number} to an ability you choose',
				description: 'In Create Character, part of what a race (such as human) changes: the player raises one ability of their choice; {bonus} is how much'
			}, {
				bonus: FLOATING_ABILITY_BONUSES[this.options?.ruleset ?? 'pf1e']
			}));
		}

		if (modifiers.length === 0)
		{
			return(t({
				id: 'character.race.noModifiers',
				defaultMessage: 'No changes to ability scores',
				description: 'In Create Character, shown for a race that doesn\'t raise or lower any ability score'
			}));
		}

		return(formatList(modifiers));
	}
}

/**
 * Adds a row for each ability to the table of scores. Every ruleset has the same abilities; the rows
 * are named once the universe's ruleset is known
 *
 * @param body The table's body
 * @return The rows' cells and fields, by ability
 */
function createAbilityRows(body: HTMLTableSectionElement): Record<Ability, AbilityRow>
{
	const rows = {} as Record<Ability, AbilityRow>;

	for (const ability of PF1E_ABILITIES)
	{
		const row = document.createElement('tr');
		const name = document.createElement('th');
		const baseCell = document.createElement('td');
		const base = document.createElement('select');
		const race = document.createElement('td');
		const score = document.createElement('td');
		const modifier = document.createElement('td');

		name.scope = 'row';
		base.id = `character-base-${ability}`;
		baseCell.append(base);
		row.append(name, baseCell, race, score, modifier);
		body.append(row);
		rows[ability] = { name, base, race, score, modifier };
	}

	return(rows);
}

/**
 * Shows or hides a warning, changing it only when its text changes, so a screen reader reads it out once
 * each time it appears
 *
 * @param element The warning
 * @param message The text, or undefined to hide it
 */
function showChangedMessage(element: HTMLElement, message: string | undefined): void
{
	if ((message ?? '') !== (element.hidden ? '' : element.textContent))
	{
		showMessage(element, message);
	}
}

/**
 * Choices sorted by their labels, the way the player's language sorts them
 *
 * @param options The choices
 * @return A new sorted list
 */
function sortByName<T extends { label: string }>(options: T[]): T[]
{
	return([...options].sort((a, b) => a.label.localeCompare(b.label, currentLocale())));
}
