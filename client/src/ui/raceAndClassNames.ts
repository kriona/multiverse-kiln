import { DEFAULT_CLASS_NAMES, DEFAULT_RACE_NAMES, DEFAULT_THEME_NAMES, type MessageDescriptor, type Ruleset } from '@multiverse-kiln/shared';

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
		description: 'A character\'s race and class, e.g. "Dwarf Fighter": under the name at the top of their sheet, after their name in the lists of the player\'s characters in the lobby, on a universe\'s page, on an invite and on profiles, and in the world editor\'s list of every character in the universe. Reorder them as your language needs'
	}, {
		race: raceName(character.race, ruleset),
		class: className(character.characterClass, ruleset)
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
