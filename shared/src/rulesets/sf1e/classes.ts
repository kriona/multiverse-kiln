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

/**
 * Each default class's description, shown in Create Character, the class editor, a rulebook's Contents dialog and the Audit tab
 */
export const SF1E_CLASS_DESCRIPTIONS: Record<Sf1eClassKey, MessageDescriptor> = defineMessages({
	envoy: {
		id: 'sf1e.classDescription.envoy',
		defaultMessage: 'A charismatic leader who inspires allies and talks their way past trouble. Envoys use improvisations to boost their team and hinder foes, and are skilled at almost everything.',
		description: 'Description of the envoy, a character class in Starfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	mechanic: {
		id: 'sf1e.classDescription.mechanic',
		defaultMessage: 'An engineer who builds and hacks technology. Mechanics work with a custom drone or a brain implant that sharpens their aim, and can overload or bypass machines.',
		description: 'Description of the mechanic, a character class in Starfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	mystic: {
		id: 'sf1e.classDescription.mystic',
		defaultMessage: 'A spellcaster who draws power from a deep connection to the universe or a deity. Mystics heal allies, link minds with them and gain powers from their connection.',
		description: 'Description of the mystic, a character class in Starfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	operative: {
		id: 'sf1e.classDescription.operative',
		defaultMessage: 'A stealthy, skilled spy or scout. Operatives dart in with trick attacks for extra damage, master a specialty and are among the most skilled of all classes.',
		description: 'Description of the operative, a character class in Starfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	solarian: {
		id: 'sf1e.classDescription.solarian',
		defaultMessage: 'A warrior who wields the power of stars and black holes. Solarians form a glowing weapon or armor from their own power and channel light and gravity in battle.',
		description: 'Description of the solarian, a character class in Starfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	soldier: {
		id: 'sf1e.classDescription.soldier',
		defaultMessage: 'A trained warrior skilled with weapons and heavy armor. Soldiers pick a fighting style and learn more combat feats than any other class.',
		description: 'Description of the soldier, a character class in Starfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	technomancer: {
		id: 'sf1e.classDescription.technomancer',
		defaultMessage: 'A spellcaster who blends magic and technology. Technomancers cast spells, store magic in a device or implant and use magic hacks to bend technology to their will.',
		description: 'Description of the technomancer, a character class in Starfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	}
});
