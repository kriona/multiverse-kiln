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
 * - GET characterPath(universeId, characterId): one of the player's characters, as their character
 *   sheet shows them (CharacterSheet)
 * - DELETE characterPath(universeId, characterId): deletes the character straight away
 * - PUT characterPath(universeId, characterId)/deletion: gives the character their last rites, so they
 *   are deleted the site's characterDeletionDays later (see shared/src/siteSettings.ts), answering
 *   CharacterDeletionPayload, or 409 while the site sets it to 0. Until then they can be restored but
 *   not played
 * - DELETE characterPath(universeId, characterId)/deletion: restores a character given their last rites
 */
import { UNIVERSES_PATH } from './constants.js';
import type { Money } from './money.js';
import { rulesetHasThemes, type Ability, type AbilityScores, type ClassRules, type RaceRules, type Size } from './racesAndClasses.js';
import type { Pf1eRollMethod, Pf1eStatMethod } from './rulesets/pf1e/statMethods.js';
import type { Sf1eThemeRules } from './rulesets/sf1e/themes.js';
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
 * The path of one of the player's characters
 *
 * @param universeId The universe's ID
 * @param characterId The character's ID
 * @return The path
 */
export function characterPath(universeId: string, characterId: string): string
{
	return(`${charactersPath(universeId)}/${encodeURIComponent(characterId)}`);
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

	/**
	 * When the character is deleted (an ISO 8601 time), once given their last rites; null otherwise.
	 * Until then they can be restored but not played
	 */
	deleteAt: string | null;
}

/**
 * Response of PUT characterPath(universeId, characterId)/deletion
 */
export interface CharacterDeletionPayload
{
	/**
	 * When the character is deleted, as an ISO 8601 time
	 */
	deleteAt: string;
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
	rules: RaceRules;
}

/**
 * A class new characters can be
 */
export interface CharacterClassOption extends OptionName
{
	id: number;
	rules: ClassRules;
}

/**
 * A theme new characters can have, in a ruleset with themes
 */
export interface CharacterThemeOption extends OptionName
{
	id: number;
	rules: Sf1eThemeRules;
}

/**
 * How a new character gets their ability scores
 *
 * - roll (PF1E): six rolled scores to arrange among the abilities
 * - pointBuy (PF1E): points to buy scores with, scores below 10 giving some back
 * - abilityPoints (SF1E): points that each raise a score of 10 by 1 (shared/src/rulesets/sf1e/abilityPoints.ts)
 */
export type AbilityOptions =
	| { kind: 'roll'; statMethod: Pf1eRollMethod; rolls: number[] }
	| { kind: 'pointBuy'; statMethod: Exclude<Pf1eStatMethod, Pf1eRollMethod>; budget: number }
	| { kind: 'abilityPoints'; points: number };

/**
 * The steps of Create Character, in order. Theme is only in rulesets with themes (characterSteps())
 */
export const CHARACTER_STEPS = [
	'name',
	'race',
	'class',
	'theme',
	'abilities',
	'review'
] as const;

export type CharacterStep = typeof CHARACTER_STEPS[number];

/**
 * The steps of Create Character in a ruleset, in order
 *
 * @param ruleset The universe's ruleset
 * @return The steps
 */
export function characterSteps(ruleset: Ruleset): CharacterStep[]
{
	return(CHARACTER_STEPS.filter((step) => ((step !== 'theme') || rulesetHasThemes(ruleset))));
}

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
	 * The theme chosen, in a ruleset with themes
	 */
	themeId: number | null;

	/**
	 * Each ability's score before racial modifiers, as the player arranged or bought them, or null
	 * before they have changed any
	 */
	baseScores: AbilityScores | null;

	floatingAbility: Ability | null;
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
	abilities: AbilityOptions;

	/**
	 * The enabled races, by ID
	 */
	races: CharacterRaceOption[];

	/**
	 * The enabled classes, by ID
	 */
	classes: CharacterClassOption[];

	/**
	 * The enabled themes, by ID; empty for a ruleset without themes
	 */
	themes: CharacterThemeOption[];

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
	 * An enabled theme's ID, in a ruleset with themes; null otherwise
	 */
	themeId: number | null;

	/**
	 * Each ability's score before racial modifiers: the rolled scores in the order the player chose, the
	 * scores the player bought, or 10 plus the ability points spent on each. The server checks them
	 * against its rolls or the points the player has
	 */
	baseScores: AbilityScores;

	/**
	 * The ability that gets the ruleset's FLOATING_ABILITY_BONUSES, for a race with a floating bonus;
	 * null otherwise
	 */
	floatingAbility: Ability | null;
}

/**
 * An item a character carries, named the way the universe names it
 */
export interface CharacterSheetItem extends OptionName
{
	id: number;

	/**
	 * The item's type, a key of the ruleset's ITEM_KINDS
	 */
	type: string;

	quantity: number;
}

/**
 * Response of GET characterPath(universeId, characterId): one of the player's characters, as their
 * character sheet shows them
 */
export interface CharacterSheet
{
	ruleset: Ruleset;
	id: string;
	name: string;
	race: OptionName;
	characterClass: OptionName;

	/**
	 * When the character is deleted (an ISO 8601 time), once given their last rites; null otherwise
	 */
	deleteAt: string | null;

	/**
	 * How many days last rites wait before deleting a character (the site's characterDeletionDays);
	 * 0 when last rites are turned off
	 */
	deletionDays: number;

	/**
	 * The race's size and darkvision, as the universe sets them now
	 */
	size: Size;
	darkvision: boolean;

	/**
	 * The character's theme, in a ruleset with themes; null otherwise
	 */
	theme: OptionName | null;

	/**
	 * Hit points and stamina points, as the race and class set them now, in a ruleset that has them
	 * (SF1E); null otherwise
	 */
	hitPoints: number | null;
	staminaPoints: number | null;

	/**
	 * The ability scores, with the race's modifiers and theme's bonus added
	 */
	abilityScores: AbilityScores;

	money: Money;

	/**
	 * The items the character carries, by ID
	 */
	items: CharacterSheetItem[];
}
