/**
 * The settings on a Starfinder 1E universe's Ruleset tab (see STRUCTURE-OVERVIEW.md, Tab: Ruleset)
 */
import type { RulebookSettings } from '../../rulebooks.js';

/**
 * How an SF1E universe plays, and which books it uses
 */
export interface Sf1eSettings extends RulebookSettings
{
	/**
	 * The ability points players spend on their characters' ability scores, from SF1E_MIN_ABILITY_POINTS
	 * to SF1E_MAX_ABILITY_POINTS
	 */
	abilityPoints: number;

	/**
	 * Whether characters get tired and need sleep
	 */
	needsSleep: boolean;

	/**
	 * Whether batteries, rounds and other ammunition are used up
	 */
	tracksAmmo: boolean;
}

/**
 * The settings a new universe starts with
 */
export const DEFAULT_SF1E_SETTINGS: Sf1eSettings = {
	abilityPoints: 10,
	needsSleep: false,
	tracksAmmo: false,
	rulebooks: [],
	barredRulebooks: []
};
