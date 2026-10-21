/**
 * Starfinder 1E's default classes, which a universe can edit, disable or add to
 *
 * Open Game Content from the Starfinder Roleplaying Game Core Rulebook, used under the Open Game License
 * 1.0a (client/license.html)
 */
import { defineMessages, type MessageDescriptor } from '../../localization.js';
import type { Sf1eAbility } from './abilities.js';

/**
 * Lowest and highest hit points, and stamina points, an editor can give a class for each level
 */
export const SF1E_MIN_CLASS_POINTS = 0;
export const SF1E_MAX_CLASS_POINTS = 99;

/**
 * A class's rules: what a default class starts with, and what a universe stores and edits
 */
export interface Sf1eClassRules
{
	/**
	 * The ability the class relies on most, a hint when the player spends their ability points
	 */
	keyAbility: Sf1eAbility;

	/**
	 * The hit points the class gives a character at each level, on top of their race's at 1st level
	 */
	hitPoints: number;

	/**
	 * The stamina points the class gives a character at each level, with their Constitution modifier added
	 */
	staminaPoints: number;
}

/**
 * The rules a class the universe adds starts with: relying on strength, with 6 hit points and 6 stamina
 * points a level
 */
export const NEW_SF1E_CLASS_RULES: Readonly<Sf1eClassRules> = {
	keyAbility: 'strength',
	hitPoints: 6,
	staminaPoints: 6
};

/**
 * The default classes by key. A soldier's key ability is Strength or Dexterity; Strength is the default
 */
export const SF1E_CLASSES = {
	envoy: {
		keyAbility: 'charisma',
		hitPoints: 6,
		staminaPoints: 6
	},
	mechanic: {
		keyAbility: 'intelligence',
		hitPoints: 6,
		staminaPoints: 6
	},
	mystic: {
		keyAbility: 'wisdom',
		hitPoints: 6,
		staminaPoints: 6
	},
	operative: {
		keyAbility: 'dexterity',
		hitPoints: 6,
		staminaPoints: 6
	},
	solarian: {
		keyAbility: 'charisma',
		hitPoints: 7,
		staminaPoints: 7
	},
	soldier: {
		keyAbility: 'strength',
		hitPoints: 7,
		staminaPoints: 7
	},
	technomancer: {
		keyAbility: 'intelligence',
		hitPoints: 5,
		staminaPoints: 5
	}
} as const satisfies Record<string, Sf1eClassRules>;

export type Sf1eClassKey = keyof typeof SF1E_CLASSES;

/**
 * Each default class's name
 */
export const SF1E_CLASS_NAMES: Record<Sf1eClassKey, MessageDescriptor> = defineMessages({
	envoy: {
		id: 'sf1e.class.envoy',
		defaultMessage: 'Envoy',
		description: 'Name of a character class in Starfinder: a charismatic leader who inspires allies and talks their way past trouble. Singular, used as a label'
	},
	mechanic: {
		id: 'sf1e.class.mechanic',
		defaultMessage: 'Mechanic',
		description: 'Name of a character class in Starfinder: an engineer with a drone or a computer implant. Singular, used as a label'
	},
	mystic: {
		id: 'sf1e.class.mystic',
		defaultMessage: 'Mystic',
		description: 'Name of a character class in Starfinder: casts spells drawn from a connection to the universe or a deity. Singular, used as a label'
	},
	operative: {
		id: 'sf1e.class.operative',
		defaultMessage: 'Operative',
		description: 'Name of a character class in Starfinder: a stealthy, skilled spy or scout. Singular, used as a label'
	},
	solarian: {
		id: 'sf1e.class.solarian',
		defaultMessage: 'Solarian',
		description: 'Name of a character class in Starfinder: a warrior who wields the power of stars and black holes. Singular, used as a label'
	},
	soldier: {
		id: 'sf1e.class.soldier',
		defaultMessage: 'Soldier',
		description: 'Name of a character class in Starfinder: a trained warrior skilled with weapons and armor. Singular, used as a label'
	},
	technomancer: {
		id: 'sf1e.class.technomancer',
		defaultMessage: 'Technomancer',
		description: 'Name of a character class in Starfinder: casts spells that blend magic and technology. Singular, used as a label'
	}
});
