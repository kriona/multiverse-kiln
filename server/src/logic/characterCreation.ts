/**
 * Making a Pathfinder 1E character (see STRUCTURE-OVERVIEW.md, Create Character): checking the base
 * ability scores the player chose, adding their race's modifiers, and putting together what they start
 * with from the universe, their race and their class
 */
import { emptyPf1eMoney, isValidPf1ePointBuy, PF1E_ABILITIES, PF1E_COINS, PF1E_FLOATING_ABILITY_BONUS, PF1E_MAX_COINS, type ItemQuantity, type Pf1eAbility, type Pf1eAbilityScores, type Pf1eMoney, type Pf1eRaceRules } from '@multiverse-kiln/shared';

import { isArrangementOfRolls } from './abilityRolls.js';

/**
 * Where a character's base ability scores have to come from
 */
export type Pf1eScoreSource =
	| { kind: 'roll'; rolls: readonly number[] }
	| { kind: 'pointBuy'; budget: number };

/**
 * Whether the base ability scores a player chose are allowed: the server's rolls in some order, or
 * scores point buy allows within the budget
 *
 * @param baseScores The score the player gave each ability, before racial modifiers
 * @param source The rolls, or the point buy budget
 * @return True when they are allowed
 */
export function areValidBaseScores(baseScores: Pf1eAbilityScores, source: Pf1eScoreSource): boolean
{
	return(((source.kind === 'roll')
		? isArrangementOfRolls(source.rolls, baseScores)
		: isValidPf1ePointBuy(baseScores, source.budget)));
}

/**
 * Whether the floating ability bonus choice fits the race: an ability for a race with a floating bonus,
 * and none for any other
 *
 * @param rules The race's rules
 * @param floatingAbility The ability the player chose for the bonus, or null
 * @return True when it fits
 */
export function isValidFloatingAbility(rules: Pf1eRaceRules, floatingAbility: Pf1eAbility | null): boolean
{
	return(rules.floatingBonus === (floatingAbility !== null));
}

/**
 * A character's ability scores: their base scores with their race's modifiers and floating bonus added
 *
 * @param baseScores The score the player gave each ability
 * @param rules The race's rules
 * @param floatingAbility The ability that gets PF1E_FLOATING_ABILITY_BONUS, or null for none
 * @return The scores
 */
export function finalPf1eAbilityScores(baseScores: Pf1eAbilityScores, rules: Pf1eRaceRules, floatingAbility: Pf1eAbility | null): Pf1eAbilityScores
{
	const scores = { ...baseScores };

	for (const ability of PF1E_ABILITIES)
	{
		scores[ability] += rules.abilityModifiers[ability];
	}

	if (rules.floatingBonus && (floatingAbility !== null))
	{
		scores[floatingAbility] += PF1E_FLOATING_ABILITY_BONUS;
	}

	return(scores);
}

/**
 * The money a new character starts with: every amount put together coin by coin, each coin capped at
 * PF1E_MAX_COINS
 *
 * @param amounts The universe's, race's and class's starting money
 * @return The character's money
 */
export function combineStartingMoney(amounts: readonly Pf1eMoney[]): Pf1eMoney
{
	const total = emptyPf1eMoney();

	for (const amount of amounts)
	{
		for (const coin of PF1E_COINS)
		{
			total[coin] = Math.min(total[coin] + amount[coin], PF1E_MAX_COINS);
		}
	}

	return(total);
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
