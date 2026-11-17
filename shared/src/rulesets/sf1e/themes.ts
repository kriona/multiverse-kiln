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

/**
 * Each default theme's description, shown in Create Character, the theme editor and a rulebook's Contents dialog
 */
export const SF1E_THEME_DESCRIPTIONS: Record<Sf1eThemeKey, MessageDescriptor> = defineMessages({
	ace_pilot: {
		id: 'sf1e.themeDescription.ace_pilot',
		defaultMessage: 'A natural at the controls of starships and vehicles, whether trained by the military or self-taught. Ace pilots know every make and model, and are skilled at piloting.',
		description: 'Description of the ace pilot, a character theme (background) in Starfinder, shown in Create Character, the theme editor and a rulebook\'s contents'
	},
	bounty_hunter: {
		id: 'sf1e.themeDescription.bounty_hunter',
		defaultMessage: 'A hunter who tracks people down for money. Bounty hunters pick a mark, learn all they can about them and are good at following a trail.',
		description: 'Description of the bounty hunter, a character theme (background) in Starfinder, shown in Create Character, the theme editor and a rulebook\'s contents'
	},
	icon: {
		id: 'sf1e.themeDescription.icon',
		defaultMessage: 'A celebrity known on many worlds, such as a famous performer or scientist. Icons know their profession and its culture inside out.',
		description: 'Description of the icon, a character theme (background) in Starfinder, shown in Create Character, the theme editor and a rulebook\'s contents'
	},
	mercenary: {
		id: 'sf1e.themeDescription.mercenary',
		defaultMessage: 'A soldier of fortune who fights for pay beside their companions. Mercenaries know armies, rival crews and military procedure, and are trained in athletics.',
		description: 'Description of the mercenary, a character theme (background) in Starfinder, shown in Create Character, the theme editor and a rulebook\'s contents'
	},
	outlaw: {
		id: 'sf1e.themeDescription.outlaw',
		defaultMessage: 'Someone wanted by the law, guilty or not. Outlaws know the criminal underworld and its back-alley deals, and have quick hands.',
		description: 'Description of the outlaw, a character theme (background) in Starfinder, shown in Create Character, the theme editor and a rulebook\'s contents'
	},
	priest: {
		id: 'sf1e.themeDescription.priest',
		defaultMessage: 'A devoted member of a religion or philosophy, who always has their beliefs to fall back on. Priests know religious traditions and are trained in mysticism.',
		description: 'Description of the priest, a character theme (background) in Starfinder, shown in Create Character, the theme editor and a rulebook\'s contents'
	},
	scholar: {
		id: 'sf1e.themeDescription.scholar',
		defaultMessage: 'An intellectual drawn to problems and puzzles others find daunting. Scholars are experts in one field of science, such as biology or astronomy.',
		description: 'Description of the scholar, a character theme (background) in Starfinder, shown in Create Character, the theme editor and a rulebook\'s contents'
	},
	spacefarer: {
		id: 'sf1e.themeDescription.spacefarer',
		defaultMessage: 'An explorer who longs to set foot on distant worlds and uncover their secrets. Spacefarers remember all they learn about new places and are trained in physical science.',
		description: 'Description of the spacefarer, a character theme (background) in Starfinder, shown in Create Character, the theme editor and a rulebook\'s contents'
	},
	xenoseeker: {
		id: 'sf1e.themeDescription.xenoseeker',
		defaultMessage: 'An adventurer who seeks out alien life, the stranger the better. Xenoseekers are trained to find, identify and talk with alien creatures.',
		description: 'Description of the xenoseeker, a character theme (background) in Starfinder, shown in Create Character, the theme editor and a rulebook\'s contents'
	}
});
