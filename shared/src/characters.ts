/**
 * Characters: the routes for a player's characters in a universe, and what they send and receive (see
 * STRUCTURE-OVERVIEW.md, Create Character)
 *
 * Every route needs a logged-in browser and a universe the player may play:
 * - GET charactersPath(universeId): the player's characters there (CharacterListPayload)
 * - GET charactersPath(universeId)/new: what Create Character offers (NewCharacterOptions), with the
 *   player's saved progress. A universe that rolls ability scores rolls them here, once: the player gets
 *   the same scores until they make a character with them
 * - PUT charactersPath(universeId)/draft: saves the player's progress in Create Character (CharacterDraft)
 * - DELETE charactersPath(universeId)/draft: throws the progress away, to start over. Rolled scores are kept
 * - POST charactersPath(universeId): makes a character (NewCharacterRequest), answering CreatedPayload,
 *   and throws the progress away
 */
import { UNIVERSES_PATH } from './constants.js';
import type { Pf1eAbility, Pf1eAbilityScores } from './rulesets/pf1e/abilities.js';
import type { Pf1eClassRules } from './rulesets/pf1e/classes.js';
import type { Pf1eRaceRules } from './rulesets/pf1e/races.js';
import type { Pf1eRollMethod, Pf1eStatMethod } from './rulesets/pf1e/statMethods.js';
import type { Ruleset } from './universes.js';

/**
 * Most characters a player may have in one universe
 */
export const MAX_CHARACTERS_PER_UNIVERSE = 20;

/**
 * Longest character name, after trimming
 */
export const MAX_CHARACTER_NAME_LENGTH = 40;

/**
 * The path of a universe's character routes
 *
 * @param universeId The universe's ID
 * @return The path
 */
export function charactersPath(universeId: string): string
{
	return(`${UNIVERSES_PATH}/${encodeURIComponent(universeId)}/characters`);
}

/**
 * A race's or class's name: the universe's own, or a default's key that finds its name in
 * DEFAULT_RACE_NAMES or DEFAULT_CLASS_NAMES
 */
export interface OptionName
{
	key: string | null;
	name: string | null;
}

/**
 * One of the player's characters, as the lobby lists them
 */
export interface CharacterSummary
{
	id: string;
	name: string;
	race: OptionName;
	characterClass: OptionName;
}

/**
 * Response of GET charactersPath(universeId): the player's characters there, oldest first
 */
export interface CharacterListPayload
{
	ruleset: Ruleset;
	characters: CharacterSummary[];
}

/**
 * A race new characters can be
 */
export interface CharacterRaceOption extends OptionName
{
	id: number;
	rules: Pf1eRaceRules;
}

/**
 * A class new characters can be
 */
export interface CharacterClassOption extends OptionName
{
	id: number;
	rules: Pf1eClassRules;
}

/**
 * How a new character gets their ability scores: six rolled scores to arrange among the abilities, or
 * points to spend on them
 */
export type Pf1eAbilityOptions =
	| { kind: 'roll'; statMethod: Pf1eRollMethod; rolls: number[] }
	| { kind: 'pointBuy'; statMethod: Exclude<Pf1eStatMethod, Pf1eRollMethod>; budget: number };

/**
 * The steps of Create Character, in order
 */
export const CHARACTER_STEPS = [
	'name',
	'race',
	'class',
	'abilities',
	'review'
] as const;

export type CharacterStep = typeof CHARACTER_STEPS[number];

/**
 * A player's progress in Create Character, kept on the server until they make the character or start
 * over. Nothing in it is checked against the universe until the character is made: a race may since
 * have been disabled, or the scores rolled again
 */
export interface CharacterDraft
{
	/**
	 * The step the player was on
	 */
	step: CharacterStep;

	/**
	 * Up to MAX_CHARACTER_NAME_LENGTH characters; may be empty
	 */
	name: string;

	raceId: number | null;
	classId: number | null;

	/**
	 * Each ability's score before racial modifiers, as the player arranged or bought them, or null
	 * before they have changed any
	 */
	baseScores: Pf1eAbilityScores | null;

	floatingAbility: Pf1eAbility | null;
}

/**
 * Response of GET charactersPath(universeId)/new: what Create Character offers
 */
export interface NewCharacterOptions
{
	/**
	 * The universe's name, for the page's title
	 */
	universeName: string;

	ruleset: Ruleset;
	abilities: Pf1eAbilityOptions;

	/**
	 * The enabled races, by ID
	 */
	races: CharacterRaceOption[];

	/**
	 * The enabled classes, by ID
	 */
	classes: CharacterClassOption[];

	/**
	 * How many characters the player already has in the universe
	 */
	characterCount: number;

	/**
	 * The player's saved progress, or null when they haven't started one
	 */
	draft: CharacterDraft | null;
}

/**
 * Body of POST charactersPath(universeId): the new character
 */
export interface NewCharacterRequest
{
	name: string;

	/**
	 * An enabled race's ID
	 */
	raceId: number;

	/**
	 * An enabled class's ID
	 */
	classId: number;

	/**
	 * Each ability's score before racial modifiers: the rolled scores in the order the player chose, or
	 * the scores the player bought. The server checks them against its rolls or the point buy budget
	 */
	baseScores: Pf1eAbilityScores;

	/**
	 * The ability that gets PF1E_FLOATING_ABILITY_BONUS, for a race with a floating bonus; null otherwise
	 */
	floatingAbility: Pf1eAbility | null;
}
