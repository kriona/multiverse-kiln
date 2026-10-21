/**
 * How a Starfinder 1E character gets their ability scores: every score starts at 10, and the player
 * spends ability points to raise them, one point for each +1, with their race's and theme's bonuses
 * added on top
 *
 * The rules are Open Game Content from the Starfinder Roleplaying Game Core Rulebook, used under the Open
 * Game License 1.0a (client/license.html)
 */
import { SF1E_ABILITIES, type Sf1eAbility, type Sf1eAbilityScores } from './abilities.js';

/**
 * Every ability score before points are spent and bonuses added
 */
export const SF1E_BASE_ABILITY_SCORE = 10;

/**
 * Highest score points can raise an ability to, with its bonuses added
 */
export const SF1E_MAX_BOUGHT_SCORE = 18;

/**
 * Lowest and highest number of ability points a universe can give: none, up to enough to raise every
 * score from SF1E_BASE_ABILITY_SCORE to SF1E_MAX_BOUGHT_SCORE
 */
export const SF1E_MIN_ABILITY_POINTS = 0;
export const SF1E_MAX_ABILITY_POINTS = (SF1E_MAX_BOUGHT_SCORE - SF1E_BASE_ABILITY_SCORE) * SF1E_ABILITIES.length;

/**
 * How many ability points a set of base scores spends
 *
 * @param baseScores The score each ability has before bonuses: SF1E_BASE_ABILITY_SCORE plus the points spent on it
 * @return The points, or null when any score is below SF1E_BASE_ABILITY_SCORE or above SF1E_MAX_BOUGHT_SCORE
 */
export function sf1eAbilityPointsSpent(baseScores: Sf1eAbilityScores): number | null
{
	let spent = 0;

	for (const ability of SF1E_ABILITIES)
	{
		const score = baseScores[ability];

		if (!Number.isInteger(score) || (score < SF1E_BASE_ABILITY_SCORE) || (score > SF1E_MAX_BOUGHT_SCORE))
		{
			return(null);
		}
		spent += score - SF1E_BASE_ABILITY_SCORE;
	}
	return(spent);
}

/**
 * The abilities whose spent points raise them above SF1E_MAX_BOUGHT_SCORE once their bonuses are added.
 * Bonuses alone may take a score past it; points can't
 *
 * @param baseScores The score each ability has before bonuses
 * @param bonuses What the race and theme add to each ability
 * @return The abilities, in the order the rules list them
 */
export function sf1eOverraisedAbilities(baseScores: Sf1eAbilityScores, bonuses: Sf1eAbilityScores): Sf1eAbility[]
{
	return(SF1E_ABILITIES.filter((ability) => ((baseScores[ability] > SF1E_BASE_ABILITY_SCORE) && ((baseScores[ability] + bonuses[ability]) > SF1E_MAX_BOUGHT_SCORE))));
}

/**
 * Whether a set of base scores is allowed: each from SF1E_BASE_ABILITY_SCORE to SF1E_MAX_BOUGHT_SCORE,
 * spending no more than the points the player has, and raising no score above SF1E_MAX_BOUGHT_SCORE
 * with its bonuses. Points left unspent are lost
 *
 * @param baseScores The score each ability has before bonuses
 * @param bonuses What the race and theme add to each ability
 * @param points The ability points the player may spend
 * @return True when the scores are allowed
 */
export function isValidSf1eAbilityBuy(baseScores: Sf1eAbilityScores, bonuses: Sf1eAbilityScores, points: number): boolean
{
	const spent = sf1eAbilityPointsSpent(baseScores);

	return((spent !== null) && (spent <= points) && (sf1eOverraisedAbilities(baseScores, bonuses).length === 0));
}
