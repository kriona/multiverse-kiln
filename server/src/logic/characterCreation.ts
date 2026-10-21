/**
 * Making a character (see STRUCTURE-OVERVIEW.md, Create Character): checking the base ability scores the
 * player chose, adding their race's modifiers and theme's bonus, and putting together what they start
 * with from the universe, their race and their class
 */
import { FLOATING_ABILITY_BONUSES, isValidPf1ePointBuy, isValidSf1eAbilityBuy, RULESET_ABILITIES, SF1E_THEME_ABILITY_BONUS, type Ability, type AbilityScores, type ItemQuantity, type RaceRules, type Ruleset, type Sf1eThemeRules } from '@multiverse-kiln/shared';

import { isArrangementOfRolls } from './abilityRolls.js';

/**
 * Where a character's base ability scores have to come from
 *
 * - roll (PF1E): the server's rolls, in any order
 * - pointBuy (PF1E): scores bought within the budget
 * - abilityPoints (SF1E): scores of 10 raised with up to this many points
 */
export type ScoreSource =
	| { kind: 'roll'; rolls: readonly number[] }
	| { kind: 'pointBuy'; budget: number }
	| { kind: 'abilityPoints'; points: number };

/**
 * Whether the base ability scores a player chose are allowed: the server's rolls in some order, scores
 * point buy allows within the budget, or scores the ability points can raise to
 *
 * @param baseScores The score the player gave each ability, before racial modifiers
 * @param source The rolls, the point buy budget, or the ability points
 * @param bonuses What the race and theme add to each ability, which ability points can't raise a score past 18 with
 * @return True when they are allowed
 */
export function areValidBaseScores(baseScores: AbilityScores, source: ScoreSource, bonuses: AbilityScores): boolean
{
	switch (source.kind)
	{
		case 'roll':
			return(isArrangementOfRolls(source.rolls, baseScores));

		case 'pointBuy':
			return(isValidPf1ePointBuy(baseScores, source.budget));

		case 'abilityPoints':
			return(isValidSf1eAbilityBuy(baseScores, bonuses, source.points));
	}
}

/**
 * Whether the floating ability bonus choice fits the race: an ability for a race with a floating bonus,
 * and none for any other
 *
 * @param rules The race's rules
 * @param floatingAbility The ability the player chose for the bonus, or null
 * @return True when it fits
 */
export function isValidFloatingAbility(rules: RaceRules, floatingAbility: Ability | null): boolean
{
	return(rules.floatingBonus === (floatingAbility !== null));
}

/**
 * What a character's race and theme add to each ability: the race's modifiers, its floating bonus,
 * and the theme's bonus
 *
 * @param ruleset The universe's ruleset
 * @param rules The race's rules
 * @param floatingAbility The ability that gets the ruleset's floating bonus, or null for none
 * @param theme The theme's rules, or null in a ruleset without themes
 * @return The bonuses, which may be negative
 */
export function abilityBonuses(ruleset: Ruleset, rules: RaceRules, floatingAbility: Ability | null, theme: Sf1eThemeRules | null): AbilityScores
{
	const bonuses = { ...rules.abilityModifiers };

	if (rules.floatingBonus && (floatingAbility !== null))
	{
		bonuses[floatingAbility] += FLOATING_ABILITY_BONUSES[ruleset];
	}

	if (theme !== null)
	{
		bonuses[theme.ability] += SF1E_THEME_ABILITY_BONUS;
	}

	return(bonuses);
}

/**
 * A character's ability scores: their base scores with their bonuses added
 *
 * @param ruleset The universe's ruleset
 * @param baseScores The score the player gave each ability
 * @param bonuses What the race and theme add to each ability (abilityBonuses())
 * @return The scores
 */
export function finalAbilityScores(ruleset: Ruleset, baseScores: AbilityScores, bonuses: AbilityScores): AbilityScores
{
	const scores = { ...baseScores };

	for (const ability of RULESET_ABILITIES[ruleset])
	{
		scores[ability] += bonuses[ability];
	}

	return(scores);
}

/**
 * The items a new character starts with: every list put together, adding up an item listed more than
 * once, and leaving out items that aren't enabled
 *
 * @param lists The universe's, race's and class's starting equipment
 * @param enabledItemIds The items characters may be given
 * @return The items and how many of each, by item ID
 */
export function combineStartingItems(lists: readonly (readonly ItemQuantity[])[], enabledItemIds: ReadonlySet<number>): ItemQuantity[]
{
	const quantities = new Map<number, number>();

	for (const list of lists)
	{
		for (const { itemId, quantity } of list)
		{
			if (enabledItemIds.has(itemId))
			{
				quantities.set(itemId, (quantities.get(itemId) ?? 0) + quantity);
			}
		}
	}

	return([...quantities]
		.sort(([a], [b]) => (a - b))
		.map(([itemId, quantity]) => ({
			itemId,
			quantity
		})));
}
