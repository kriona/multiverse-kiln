import { DEFAULT_CLASS_DESCRIPTIONS, DEFAULT_CLASS_NAMES, DEFAULT_RACE_DESCRIPTIONS, DEFAULT_RACE_NAMES, DEFAULT_THEME_DESCRIPTIONS, DEFAULT_THEME_NAMES, type MessageDescriptor, type Ruleset } from '@multiverse-kiln/shared';

import { t } from '../localization';

/**
 * Something named the way races and classes are: a name of the universe's own, or a default's key
 */
interface Named
{
	key: string | null;
	name: string | null;
}

/**
 * A race's name as the player reads it: the universe's name for it, or a default race's name in the
 * player's language
 *
 * @param race The race
 * @param ruleset The universe's ruleset
 * @return The name
 */
export function raceName(race: Named, ruleset: Ruleset): string
{
	return(nameOf(race, DEFAULT_RACE_NAMES[ruleset]));
}

/**
 * A class's name as the player reads it: the universe's name for it, or a default class's name in the
 * player's language
 *
 * @param characterClass The class
 * @param ruleset The universe's ruleset
 * @return The name
 */
export function className(characterClass: Named, ruleset: Ruleset): string
{
	return(nameOf(characterClass, DEFAULT_CLASS_NAMES[ruleset]));
}

/**
 * A theme's name as the player reads it: the universe's name for it, or a default theme's name in the
 * player's language
 *
 * @param theme The theme
 * @param ruleset The universe's ruleset
 * @return The name
 */
export function themeName(theme: Named, ruleset: Ruleset): string
{
	return(nameOf(theme, DEFAULT_THEME_NAMES[ruleset]));
}

/**
 * Something described the way races, classes, themes and items are: a description of the universe's
 * own, or a default's key that finds the engine's
 */
interface Described
{
	key: string | null;
	description: string | null;
}

/**
 * A race's description as the player reads it: the universe's description of it, or a default race's
 * in the player's language
 *
 * @param race The race
 * @param ruleset The universe's ruleset
 * @return The description, or an empty string for a race the universe added without one
 */
export function raceDescription(race: Described, ruleset: Ruleset): string
{
	return(describedBy(race, DEFAULT_RACE_DESCRIPTIONS[ruleset]));
}

/**
 * A class's description as the player reads it: the universe's description of it, or a default
 * class's in the player's language
 *
 * @param characterClass The class
 * @param ruleset The universe's ruleset
 * @return The description, or an empty string for a class the universe added without one
 */
export function classDescription(characterClass: Described, ruleset: Ruleset): string
{
	return(describedBy(characterClass, DEFAULT_CLASS_DESCRIPTIONS[ruleset]));
}

/**
 * A theme's description as the player reads it: the universe's description of it, or a default
 * theme's in the player's language
 *
 * @param theme The theme
 * @param ruleset The universe's ruleset
 * @return The description, or an empty string for a theme the universe added without one
 */
export function themeDescription(theme: Described, ruleset: Ruleset): string
{
	return(describedBy(theme, DEFAULT_THEME_DESCRIPTIONS[ruleset]));
}

/**
 * A race's, class's, theme's or item's description as the player reads it
 *
 * @param described The race, class, theme or item
 * @param defaultDescriptions The default descriptions, by key
 * @return The description, or an empty string for one with none
 */
export function describedBy(described: Described, defaultDescriptions: Record<string, MessageDescriptor>): string
{
	if (described.description !== null)
	{
		return(described.description);
	}

	const message = ((described.key === null) ? undefined : defaultDescriptions[described.key]);

	return(((message === undefined) ? '' : t(message)));
}

/**
 * A character's description as the player reads it: their race and class, e.g. "Dwarf Fighter"
 *
 * @param character The character, or anything else with a race and class, such as their sheet
 * @param ruleset The universe's ruleset
 * @return The description
 */
export function characterDescription(character: { race: Named; characterClass: Named }, ruleset: Ruleset): string
{
	return(t({
		id: 'character.raceAndClass',
		defaultMessage: '{race} {class}',
		description: 'A character\'s race and class, e.g. "Dwarf Fighter": under the name at the top of their sheet, after their name in the lists of the player\'s characters in the lobby, on a universe\'s page, on an invite and on profiles, in the world editor\'s list of every character in the universe, and in brackets after each character\'s name in the Give dialog on a character\'s sheet. Reorder them as your language needs'
	}, {
		race: raceName(character.race, ruleset),
		class: className(character.characterClass, ruleset)
	}));
}

/**
 * A character's name with their race and class, e.g. "Mara (Dwarf Fighter)": the alt text of their avatar
 * at the top of their sheet, and how the Give dialog lists them
 *
 * @param character The character, or anything else with a name, race and class, such as their sheet
 * @param ruleset The universe's ruleset
 * @return The label
 */
export function characterLabel(character: { name: string; race: Named; characterClass: Named }, ruleset: Ruleset): string
{
	return(t({
		id: 'character.label',
		defaultMessage: '{name} ({description})',
		description: 'A character\'s name with their race and class, e.g. "Mara (Dwarf Fighter)": the text a screen reader reads for the character\'s avatar (a picture of the character) at the top of their sheet, and a choice in the dialog, opened from a character\'s sheet, that gives an item to another character in the group; {name} is the character\'s name and {description} their race and class'
	}, {
		name: character.name,
		description: characterDescription(character, ruleset)
	}));
}

/**
 * A race's or class's name as the player reads it
 *
 * @param named The race or class
 * @param defaultNames The default names, by key
 * @return The name, or the key for a default the ruleset has no name for
 */
function nameOf(named: Named, defaultNames: Record<string, MessageDescriptor>): string
{
	if (named.name !== null)
	{
		return(named.name);
	}

	const message = ((named.key === null) ? undefined : defaultNames[named.key]);

	return(((message === undefined) ? (named.key ?? '') : t(message)));
}
