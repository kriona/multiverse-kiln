/**
 * Each ruleset's abilities, sizes, and default races, classes and themes, which the migrations in
 * server/drizzle add to the database, and the rules a universe's races, classes and themes have
 */
import type { MessageDescriptor } from './localization.js';
import { PF1E_ABILITIES, PF1E_ABILITY_NAMES, type Pf1eAbility } from './rulesets/pf1e/abilities.js';
import { NEW_PF1E_CLASS_RULES, PF1E_CLASS_NAMES, type Pf1eClassRules } from './rulesets/pf1e/classes.js';
import { NEW_PF1E_RACE_RULES, PF1E_FLOATING_ABILITY_BONUS, PF1E_RACE_NAMES, type Pf1eRaceRules } from './rulesets/pf1e/races.js';
import { PF1E_SIZE_NAMES, PF1E_SIZES, type Pf1eSize } from './rulesets/pf1e/sizes.js';
import { SF1E_ABILITIES, SF1E_ABILITY_NAMES } from './rulesets/sf1e/abilities.js';
import { NEW_SF1E_CLASS_RULES, SF1E_CLASS_NAMES, type Sf1eClassRules } from './rulesets/sf1e/classes.js';
import { NEW_SF1E_RACE_RULES, SF1E_FLOATING_ABILITY_BONUS, SF1E_RACE_NAMES, type Sf1eRaceRules } from './rulesets/sf1e/races.js';
import { SF1E_SIZE_NAMES, SF1E_SIZES } from './rulesets/sf1e/sizes.js';
import { SF1E_THEME_NAMES } from './rulesets/sf1e/themes.js';
import type { Ruleset } from './universes.js';

/**
 * An ability in any ruleset. Every ruleset so far has the same six, which RULESET_ABILITIES checks
 */
export type Ability = Pf1eAbility;

/**
 * A score, or a modifier, for each ability
 */
export type AbilityScores = Record<Ability, number>;

/**
 * A creature's size in any ruleset. Every ruleset so far has the same nine, which RULESET_SIZES checks
 */
export type Size = Pf1eSize;

/**
 * A race's rules under its universe's ruleset: Sf1eRaceRules have hit points, Pf1eRaceRules don't
 */
export type RaceRules = Pf1eRaceRules | Sf1eRaceRules;

/**
 * A class's rules under its universe's ruleset: Sf1eClassRules have a key ability, Pf1eClassRules a
 * primary ability
 */
export type ClassRules = Pf1eClassRules | Sf1eClassRules;

/**
 * Each ruleset's abilities, in the order its rules list them
 */
export const RULESET_ABILITIES: Record<Ruleset, readonly Ability[]> = {
	pf1e: PF1E_ABILITIES,
	sf1e: SF1E_ABILITIES
};

/**
 * Each ruleset's ability names
 */
export const ABILITY_NAMES: Record<Ruleset, Record<Ability, MessageDescriptor>> = {
	pf1e: PF1E_ABILITY_NAMES,
	sf1e: SF1E_ABILITY_NAMES
};

/**
 * Each ruleset's sizes, smallest first
 */
export const RULESET_SIZES: Record<Ruleset, readonly Size[]> = {
	pf1e: PF1E_SIZES,
	sf1e: SF1E_SIZES
};

/**
 * Each ruleset's size names
 */
export const SIZE_NAMES: Record<Ruleset, Record<Size, MessageDescriptor>> = {
	pf1e: PF1E_SIZE_NAMES,
	sf1e: SF1E_SIZE_NAMES
};

/**
 * What a race with a floating ability bonus adds to the ability the player chooses, by ruleset
 */
export const FLOATING_ABILITY_BONUSES: Record<Ruleset, number> = {
	pf1e: PF1E_FLOATING_ABILITY_BONUS,
	sf1e: SF1E_FLOATING_ABILITY_BONUS
};

/**
 * The rules a race the universe adds starts with, by ruleset
 */
export const NEW_RACE_RULES: Record<Ruleset, Readonly<RaceRules>> = {
	pf1e: NEW_PF1E_RACE_RULES,
	sf1e: NEW_SF1E_RACE_RULES
};

/**
 * The rules a class the universe adds starts with, by ruleset
 */
export const NEW_CLASS_RULES: Record<Ruleset, Readonly<ClassRules>> = {
	pf1e: NEW_PF1E_CLASS_RULES,
	sf1e: NEW_SF1E_CLASS_RULES
};

/**
 * Each default race's name, by ruleset and the race's key. The database stores each name's English text
 */
export const DEFAULT_RACE_NAMES: Record<Ruleset, Record<string, MessageDescriptor>> = {
	pf1e: PF1E_RACE_NAMES,
	sf1e: SF1E_RACE_NAMES
};

/**
 * Each default class's name, by ruleset and the class's key. The database stores each name's English text
 */
export const DEFAULT_CLASS_NAMES: Record<Ruleset, Record<string, MessageDescriptor>> = {
	pf1e: PF1E_CLASS_NAMES,
	sf1e: SF1E_CLASS_NAMES
};

/**
 * Each default theme's name, by ruleset and the theme's key; empty for a ruleset without themes. The
 * database stores each name's English text
 */
export const DEFAULT_THEME_NAMES: Record<Ruleset, Record<string, MessageDescriptor>> = {
	pf1e: {},
	sf1e: SF1E_THEME_NAMES
};

/**
 * Whether characters of a ruleset choose a theme, such as an ace pilot or scholar
 *
 * @param ruleset The ruleset
 * @return True for Starfinder 1E
 */
export function rulesetHasThemes(ruleset: Ruleset): ruleset is 'sf1e'
{
	return(ruleset === 'sf1e');
}

/**
 * Whether a race's rules are Starfinder 1E's
 *
 * @param rules The rules
 * @return True when they are
 */
export function isSf1eRaceRules(rules: RaceRules): rules is Sf1eRaceRules
{
	return('hitPoints' in rules);
}

/**
 * Whether a class's rules are Starfinder 1E's
 *
 * @param rules The rules
 * @return True when they are
 */
export function isSf1eClassRules(rules: ClassRules): rules is Sf1eClassRules
{
	return('keyAbility' in rules);
}

/**
 * The ability a class relies on most, its primary or key ability, a hint when the player makes their
 * ability scores
 *
 * @param rules The class's rules
 * @return The ability
 */
export function mainAbility(rules: ClassRules): Ability
{
	return((isSf1eClassRules(rules) ? rules.keyAbility : rules.primaryAbility));
}
