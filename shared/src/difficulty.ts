/**
 * Difficulty levels: how hard a universe's mobs are for a group, and whether its characters die for good
 * (see STRUCTURE-OVERVIEW.md, Difficulty)
 *
 * Every universe has its own levels, starting with DEFAULT_DIFFICULTY_LEVELS, and exactly one of them is
 * its default. A group plays at the level chosen when it was made. The editor's routes are listed in
 * shared/src/editor.ts. Players making a group read the levels from:
 * - GET difficultyLevelsPath(universeId): DifficultyLevelListPayload
 */
import { groupsPath } from './groups.js';
import { defineMessages, type MessageDescriptor } from './localization.js';

/**
 * Most a level can make mobs easier, as a percentage
 */
export const MIN_MOB_SCALE = -1000;

/**
 * Most a level can make mobs harder, as a percentage
 */
export const MAX_MOB_SCALE = 1000;

/**
 * Most characters in a difficulty level's name
 */
export const MAX_DIFFICULTY_NAME_LENGTH = 40;

/**
 * Most difficulty levels a universe may have
 */
export const MAX_DIFFICULTY_LEVELS = 20;

/**
 * Lowest chance to hit, as a percentage, that a difficulty level can bring a chance of at least this
 * much down to
 */
export const MIN_SCALED_HIT_CHANCE = 5;

/**
 * Each default level's name, by key, which players read in their language until a universe renames it
 */
export const DIFFICULTY_LEVEL_NAMES: Record<string, MessageDescriptor> = defineMessages({
	story: {
		id: 'difficulty.story',
		defaultMessage: 'Story',
		description: 'Name of the easiest default difficulty level, for players who are there for the story: mobs (monsters and enemies) are 50% easier'
	},
	normal: {
		id: 'difficulty.normal',
		defaultMessage: 'Normal',
		description: 'Name of the default difficulty level that plays mobs (monsters and enemies) as their universe made them'
	},
	hard: {
		id: 'difficulty.hard',
		defaultMessage: 'Hard',
		description: 'Name of the default difficulty level whose mobs (monsters and enemies) are 50% harder'
	},
	hardcore: {
		id: 'difficulty.hardcore',
		defaultMessage: 'Hardcore',
		description: 'Name of the hardest default difficulty level: mobs (monsters and enemies) are 100% harder, and characters who die are gone for good'
	}
});

/**
 * The levels every universe starts with, easiest first
 */
export const DEFAULT_DIFFICULTY_LEVELS: readonly Readonly<{ key: string } & Omit<DifficultyLevelSettings, 'name'>>[] = [
	{
		key: 'story',
		isDefault: false,
		mobScale: -50,
		permadeath: false
	},
	{
		key: 'normal',
		isDefault: true,
		mobScale: 0,
		permadeath: false
	},
	{
		key: 'hard',
		isDefault: false,
		mobScale: 50,
		permadeath: false
	},
	{
		key: 'hardcore',
		isDefault: false,
		mobScale: 100,
		permadeath: true
	}
];

/**
 * The path of a universe's difficulty levels, for players making a group
 *
 * @param universeId The universe's ID
 * @return The path
 */
export function difficultyLevelsPath(universeId: string): string
{
	return(`${groupsPath(universeId)}/difficulty-levels`);
}

/**
 * A difficulty level's settings, as the editor shows and changes them
 */
export interface DifficultyLevelSettings
{
	/**
	 * Null for a default level that keeps its name, which players read in their language
	 * (DIFFICULTY_LEVEL_NAMES). A level the universe added must have one
	 */
	name: string | null;

	/**
	 * Whether Create Group starts on this level. Exactly one of a universe's levels is its default
	 */
	isDefault: boolean;

	/**
	 * How much harder mobs are, as a percentage from MIN_MOB_SCALE to MAX_MOB_SCALE: 50 is 50% harder,
	 * -50 is 50% easier
	 */
	mobScale: number;

	/**
	 * Whether a character who dies is gone for good
	 */
	permadeath: boolean;
}

/**
 * One of a universe's difficulty levels
 */
export interface DifficultyLevel extends DifficultyLevelSettings
{
	id: number;

	/**
	 * A default level's key, e.g. normal, which finds its name in DIFFICULTY_LEVEL_NAMES; null for a level
	 * the universe added
	 */
	key: string | null;
}

/**
 * Response of GET difficultyLevelsPath(universeId) and the editor's list: every level of the universe,
 * easiest first
 */
export interface DifficultyLevelListPayload
{
	difficultyLevels: DifficultyLevel[];
}
