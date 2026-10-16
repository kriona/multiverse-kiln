/**
 * The settings on a Pathfinder 1E universe's Ruleset tab (see STRUCTURE-OVERVIEW.md, Tab: Ruleset)
 */
import type { Pf1eStatMethod } from './statMethods.js';

/**
 * How a PF1E universe plays
 */
export interface Pf1eSettings
{
	/**
	 * How characters get their ability scores
	 */
	statMethod: Pf1eStatMethod;

	/**
	 * The points players spend when statMethod is point_buy_custom
	 */
	customPointBuyBudget: number;

	/**
	 * Whether characters get tired and need sleep
	 */
	needsSleep: boolean;

	/**
	 * Whether coins count towards what characters carry
	 */
	coinsHaveWeight: boolean;

	/**
	 * Whether arrows, bolts and other ammunition are used up
	 */
	tracksAmmo: boolean;
}

/**
 * The settings a new universe starts with
 */
export const DEFAULT_PF1E_SETTINGS: Pf1eSettings = {
	statMethod: 'roll_4d6_drop_lowest',
	customPointBuyBudget: 15,
	needsSleep: false,
	coinsHaveWeight: false,
	tracksAmmo: false
};
