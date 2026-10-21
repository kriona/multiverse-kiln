/**
 * How a Pathfinder 1E universe's characters get their ability scores: rolled dice, or point buy
 *
 * The point buy costs are Open Game Content from the Pathfinder Roleplaying Game Core Rulebook, used under
 * the Open Game License 1.0a (client/license.html)
 */
import { defineMessages, type MessageDescriptor } from '../../localization.js';
import { PF1E_ABILITIES, type Pf1eAbilityScores } from './abilities.js';

/**
 * The ways of making ability scores a universe chooses from
 *
 * The database stores these as an enum (server/src/db/schema.ts), so adding one needs a migration
 */
export const PF1E_STAT_METHODS = [
	'roll_3d6',
	'roll_3d6_reroll_ones',
	'roll_4d6_drop_lowest',
	'roll_4d6_reroll_ones_drop_lowest',
	'point_buy_low_fantasy',
	'point_buy_standard_fantasy',
	'point_buy_high_fantasy',
	'point_buy_epic_fantasy',
	'point_buy_custom'
] as const;

export type Pf1eStatMethod = typeof PF1E_STAT_METHODS[number];

/**
 * The methods that roll dice
 */
export type Pf1eRollMethod = Extract<Pf1eStatMethod, `roll_${string}`>;

/**
 * Each stat method's name
 */
export const PF1E_STAT_METHOD_NAMES: Record<Pf1eStatMethod, MessageDescriptor> = defineMessages({
	roll_3d6: {
		id: 'pf1e.statMethod.roll_3d6',
		defaultMessage: '3d6',
		description: 'Way of making a character\'s ability scores: roll three six-sided dice for each and add them up'
	},
	roll_3d6_reroll_ones: {
		id: 'pf1e.statMethod.roll_3d6_reroll_ones',
		defaultMessage: '3d6, reroll 1s',
		description: 'Way of making a character\'s ability scores: roll three six-sided dice for each, rolling any 1 again, and add them up'
	},
	roll_4d6_drop_lowest: {
		id: 'pf1e.statMethod.roll_4d6_drop_lowest',
		defaultMessage: '4d6, drop the lowest',
		description: 'Way of making a character\'s ability scores: roll four six-sided dice for each and add up the highest three'
	},
	roll_4d6_reroll_ones_drop_lowest: {
		id: 'pf1e.statMethod.roll_4d6_reroll_ones_drop_lowest',
		defaultMessage: '4d6, reroll 1s, drop the lowest',
		description: 'Way of making a character\'s ability scores: roll four six-sided dice for each, rolling any 1 again, and add up the highest three'
	},
	point_buy_low_fantasy: {
		id: 'pf1e.statMethod.point_buy_low_fantasy',
		defaultMessage: 'point buy: low fantasy (10 points)',
		description: 'Way of making a character\'s ability scores: the player spends 10 points on them, for a campaign of weaker heroes'
	},
	point_buy_standard_fantasy: {
		id: 'pf1e.statMethod.point_buy_standard_fantasy',
		defaultMessage: 'point buy: standard fantasy (15 points)',
		description: 'Way of making a character\'s ability scores: the player spends 15 points on them, the usual amount'
	},
	point_buy_high_fantasy: {
		id: 'pf1e.statMethod.point_buy_high_fantasy',
		defaultMessage: 'point buy: high fantasy (20 points)',
		description: 'Way of making a character\'s ability scores: the player spends 20 points on them, for a campaign of stronger heroes'
	},
	point_buy_epic_fantasy: {
		id: 'pf1e.statMethod.point_buy_epic_fantasy',
		defaultMessage: 'point buy: epic fantasy (25 points)',
		description: 'Way of making a character\'s ability scores: the player spends 25 points on them, for a campaign of mighty heroes'
	},
	point_buy_custom: {
		id: 'pf1e.statMethod.point_buy_custom',
		defaultMessage: 'point buy: choose the number of points',
		description: 'Way of making a character\'s ability scores: the player spends a number of points the universe\'s editor chooses'
	}
});

/**
 * Each point buy method's budget; point_buy_custom uses the universe's own
 */
export const PF1E_POINT_BUY_BUDGETS: Partial<Record<Pf1eStatMethod, number>> = {
	point_buy_low_fantasy: 10,
	point_buy_standard_fantasy: 15,
	point_buy_high_fantasy: 20,
	point_buy_epic_fantasy: 25
};

/**
 * Lowest and highest ability score point buy can choose, before racial modifiers
 */
export const PF1E_MIN_POINT_BUY_SCORE = 7;
export const PF1E_MAX_POINT_BUY_SCORE = 18;

/**
 * What each score from PF1E_MIN_POINT_BUY_SCORE to PF1E_MAX_POINT_BUY_SCORE costs; a score under 10 gives
 * points back
 */
const POINT_BUY_COSTS: Record<number, number> = {
	7: -4,
	8: -2,
	9: -1,
	10: 0,
	11: 1,
	12: 2,
	13: 3,
	14: 5,
	15: 7,
	16: 10,
	17: 13,
	18: 17
};

/**
 * Lowest and highest custom point buy budget: nothing, up to enough for every score to be 18
 */
export const PF1E_MIN_POINT_BUY_BUDGET = 0;
export const PF1E_MAX_POINT_BUY_BUDGET = POINT_BUY_COSTS[PF1E_MAX_POINT_BUY_SCORE] * PF1E_ABILITIES.length;

/**
 * Whether a stat method rolls dice
 *
 * @param method The stat method
 * @return True for the rolling methods, false for point buy
 */
export function isPf1eRollMethod(method: Pf1eStatMethod): method is Pf1eRollMethod
{
	return(method.startsWith('roll_'));
}

/**
 * The budget a point buy method gives players to spend
 *
 * @param method The universe's stat method, which must be a point buy method
 * @param customBudget The universe's own budget, used by point_buy_custom
 * @return The number of points
 */
export function pf1ePointBuyBudget(method: Pf1eStatMethod, customBudget: number): number
{
	return((method === 'point_buy_custom') ? customBudget : (PF1E_POINT_BUY_BUDGETS[method] ?? 0));
}

/**
 * What an ability score costs in point buy
 *
 * @param score The score, from PF1E_MIN_POINT_BUY_SCORE to PF1E_MAX_POINT_BUY_SCORE
 * @return Its cost, or null for a score point buy can't choose
 */
export function pf1ePointBuyCost(score: number): number | null
{
	return(POINT_BUY_COSTS[score] ?? null);
}

/**
 * What a set of ability scores costs in point buy
 *
 * @param scores The score chosen for each ability, before racial modifiers
 * @return The total cost, or null when any score isn't one point buy can choose
 */
export function pf1ePointBuyTotal(scores: Pf1eAbilityScores): number | null
{
	let total = 0;

	for (const ability of PF1E_ABILITIES)
	{
		const cost = pf1ePointBuyCost(scores[ability]);

		if (cost === null)
		{
			return(null);
		}
		total += cost;
	}
	return(total);
}

/**
 * Whether a set of point buy scores is allowed: each a whole number from PF1E_MIN_POINT_BUY_SCORE to
 * PF1E_MAX_POINT_BUY_SCORE, costing no more than the budget in total. Points left unspent are lost
 *
 * @param scores The score chosen for each ability, before racial modifiers
 * @param budget The points the player may spend
 * @return True when the scores are allowed
 */
export function isValidPf1ePointBuy(scores: Pf1eAbilityScores, budget: number): boolean
{
	const total = pf1ePointBuyTotal(scores);

	return((total !== null) && (total <= budget));
}
