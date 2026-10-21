/**
 * Starfinder 1E's default themes, which a universe can edit, disable or add to. A theme is a character's
 * background, such as a pilot or a scholar
 *
 * Open Game Content from the Starfinder Roleplaying Game Core Rulebook, used under the Open Game License
 * 1.0a (client/license.html)
 */
import { defineMessages, type MessageDescriptor } from '../../localization.js';
import type { Sf1eAbility } from './abilities.js';

/**
 * What a theme adds to its ability
 */
export const SF1E_THEME_ABILITY_BONUS = 1;

/**
 * A theme's rules: what a default theme starts with, and what a universe stores and edits
 */
export interface Sf1eThemeRules
{
	/**
	 * The ability that gets SF1E_THEME_ABILITY_BONUS
	 */
	ability: Sf1eAbility;
}

/**
 * The rules a theme the universe adds starts with: raising strength
 */
export const NEW_SF1E_THEME_RULES: Readonly<Sf1eThemeRules> = {
	ability: 'strength'
};

/**
 * The default themes by key. Themeless, which lets the player choose the ability, isn't modeled
 */
export const SF1E_THEMES = {
	ace_pilot: {
		ability: 'dexterity'
	},
	bounty_hunter: {
		ability: 'constitution'
	},
	icon: {
		ability: 'charisma'
	},
	mercenary: {
		ability: 'strength'
	},
	outlaw: {
		ability: 'dexterity'
	},
	priest: {
		ability: 'wisdom'
	},
	scholar: {
		ability: 'intelligence'
	},
	spacefarer: {
		ability: 'constitution'
	},
	xenoseeker: {
		ability: 'charisma'
	}
} as const satisfies Record<string, Sf1eThemeRules>;

export type Sf1eThemeKey = keyof typeof SF1E_THEMES;

/**
 * Each default theme's name
 */
export const SF1E_THEME_NAMES: Record<Sf1eThemeKey, MessageDescriptor> = defineMessages({
	ace_pilot: {
		id: 'sf1e.theme.ace_pilot',
		defaultMessage: 'Ace Pilot',
		description: 'Name of a character theme (background) in Starfinder: a skilled pilot of starships and vehicles. Used as a label'
	},
	bounty_hunter: {
		id: 'sf1e.theme.bounty_hunter',
		defaultMessage: 'Bounty Hunter',
		description: 'Name of a character theme (background) in Starfinder: hunts down people for a reward. Used as a label'
	},
	icon: {
		id: 'sf1e.theme.icon',
		defaultMessage: 'Icon',
		description: 'Name of a character theme (background) in Starfinder: a celebrity, such as a performer or athlete. Used as a label'
	},
	mercenary: {
		id: 'sf1e.theme.mercenary',
		defaultMessage: 'Mercenary',
		description: 'Name of a character theme (background) in Starfinder: a soldier who fights for pay. Used as a label'
	},
	outlaw: {
		id: 'sf1e.theme.outlaw',
		defaultMessage: 'Outlaw',
		description: 'Name of a character theme (background) in Starfinder: a criminal who lives outside the law. Used as a label'
	},
	priest: {
		id: 'sf1e.theme.priest',
		defaultMessage: 'Priest',
		description: 'Name of a character theme (background) in Starfinder: devoted to a deity or philosophy. Used as a label'
	},
	scholar: {
		id: 'sf1e.theme.scholar',
		defaultMessage: 'Scholar',
		description: 'Name of a character theme (background) in Starfinder: a student of a field of knowledge. Used as a label'
	},
	spacefarer: {
		id: 'sf1e.theme.spacefarer',
		defaultMessage: 'Spacefarer',
		description: 'Name of a character theme (background) in Starfinder: an explorer of the unknown reaches of space. Used as a label'
	},
	xenoseeker: {
		id: 'sf1e.theme.xenoseeker',
		defaultMessage: 'Xenoseeker',
		description: 'Name of a character theme (background) in Starfinder: seeks out and studies alien life. Used as a label'
	}
});
