/**
 * Pathfinder 1E's default classes, which a universe can edit, disable or add to
 *
 * Open Game Content from the Pathfinder Roleplaying Game Core Rulebook and Advanced Player's Guide, used
 * under the Open Game License 1.0a (client/license.html)
 */
import { defineMessages, type MessageDescriptor } from '../../localization.js';
import type { Pf1eAbility } from './abilities.js';

/**
 * Where a class's magic comes from
 */
export const PF1E_MAGIC_TRADITIONS = ['none', 'arcane', 'divine'] as const;

export type Pf1eMagicTradition = typeof PF1E_MAGIC_TRADITIONS[number];

/**
 * Each magic tradition's name
 */
export const PF1E_MAGIC_TRADITION_NAMES: Record<Pf1eMagicTradition, MessageDescriptor> = defineMessages({
	none: {
		id: 'pf1e.tradition.none',
		defaultMessage: 'none',
		description: 'Magic tradition of a class in Pathfinder that casts no spells'
	},
	arcane: {
		id: 'pf1e.tradition.arcane',
		defaultMessage: 'arcane',
		description: 'Magic tradition of a class in Pathfinder whose spells come from study or innate talent, like a wizard\'s'
	},
	divine: {
		id: 'pf1e.tradition.divine',
		defaultMessage: 'divine',
		description: 'Magic tradition of a class in Pathfinder whose spells come from a deity or nature, like a cleric\'s'
	}
});

/**
 * How a class casts its spells
 */
export const PF1E_CASTING_STYLES = ['none', 'prepared', 'spontaneous'] as const;

export type Pf1eCastingStyle = typeof PF1E_CASTING_STYLES[number];

/**
 * Each casting style's name
 */
export const PF1E_CASTING_STYLE_NAMES: Record<Pf1eCastingStyle, MessageDescriptor> = defineMessages({
	none: {
		id: 'pf1e.castingStyle.none',
		defaultMessage: 'none',
		description: 'Spellcasting style of a class in Pathfinder that casts no spells'
	},
	prepared: {
		id: 'pf1e.castingStyle.prepared',
		defaultMessage: 'prepared',
		description: 'Spellcasting style of a class in Pathfinder that chooses its spells ahead of time each day'
	},
	spontaneous: {
		id: 'pf1e.castingStyle.spontaneous',
		defaultMessage: 'spontaneous',
		description: 'Spellcasting style of a class in Pathfinder that casts any spell it knows without preparing it'
	}
});

/**
 * What a class starts with before a universe edits it
 */
export interface Pf1eClassDefaults
{
	/**
	 * The ability the class relies on most, a hint when the player arranges their scores
	 */
	primaryAbility: Pf1eAbility;

	tradition: Pf1eMagicTradition;
	castingStyle: Pf1eCastingStyle;
}

/**
 * The default classes by key. The alchemist's extracts count as arcane and prepared
 */
export const PF1E_CLASSES = {
	alchemist: {
		primaryAbility: 'intelligence',
		tradition: 'arcane',
		castingStyle: 'prepared'
	},
	barbarian: {
		primaryAbility: 'strength',
		tradition: 'none',
		castingStyle: 'none'
	},
	bard: {
		primaryAbility: 'charisma',
		tradition: 'arcane',
		castingStyle: 'spontaneous'
	},
	cavalier: {
		primaryAbility: 'strength',
		tradition: 'none',
		castingStyle: 'none'
	},
	cleric: {
		primaryAbility: 'wisdom',
		tradition: 'divine',
		castingStyle: 'prepared'
	},
	druid: {
		primaryAbility: 'wisdom',
		tradition: 'divine',
		castingStyle: 'prepared'
	},
	fighter: {
		primaryAbility: 'strength',
		tradition: 'none',
		castingStyle: 'none'
	},
	inquisitor: {
		primaryAbility: 'wisdom',
		tradition: 'divine',
		castingStyle: 'spontaneous'
	},
	monk: {
		primaryAbility: 'wisdom',
		tradition: 'none',
		castingStyle: 'none'
	},
	oracle: {
		primaryAbility: 'charisma',
		tradition: 'divine',
		castingStyle: 'spontaneous'
	},
	paladin: {
		primaryAbility: 'strength',
		tradition: 'divine',
		castingStyle: 'prepared'
	},
	ranger: {
		primaryAbility: 'dexterity',
		tradition: 'divine',
		castingStyle: 'prepared'
	},
	rogue: {
		primaryAbility: 'dexterity',
		tradition: 'none',
		castingStyle: 'none'
	},
	sorcerer: {
		primaryAbility: 'charisma',
		tradition: 'arcane',
		castingStyle: 'spontaneous'
	},
	summoner: {
		primaryAbility: 'charisma',
		tradition: 'arcane',
		castingStyle: 'spontaneous'
	},
	witch: {
		primaryAbility: 'intelligence',
		tradition: 'arcane',
		castingStyle: 'prepared'
	},
	wizard: {
		primaryAbility: 'intelligence',
		tradition: 'arcane',
		castingStyle: 'prepared'
	}
} as const satisfies Record<string, Pf1eClassDefaults>;

export type Pf1eClassKey = keyof typeof PF1E_CLASSES;

/**
 * Each default class's name
 */
export const PF1E_CLASS_NAMES: Record<Pf1eClassKey, MessageDescriptor> = defineMessages({
	alchemist: {
		id: 'pf1e.class.alchemist',
		defaultMessage: 'Alchemist',
		description: 'Name of a character class in Pathfinder: brews potions, bombs and magical extracts. Singular, used as a label'
	},
	barbarian: {
		id: 'pf1e.class.barbarian',
		defaultMessage: 'Barbarian',
		description: 'Name of a character class in Pathfinder: a warrior who fights in a rage. Singular, used as a label'
	},
	bard: {
		id: 'pf1e.class.bard',
		defaultMessage: 'Bard',
		description: 'Name of a character class in Pathfinder: a performer whose music and words are magic. Singular, used as a label'
	},
	cavalier: {
		id: 'pf1e.class.cavalier',
		defaultMessage: 'Cavalier',
		description: 'Name of a character class in Pathfinder: a mounted knight sworn to an order. Singular, used as a label'
	},
	cleric: {
		id: 'pf1e.class.cleric',
		defaultMessage: 'Cleric',
		description: 'Name of a character class in Pathfinder: a priest who casts spells granted by a deity. Singular, used as a label'
	},
	druid: {
		id: 'pf1e.class.druid',
		defaultMessage: 'Druid',
		description: 'Name of a character class in Pathfinder: a guardian of nature who can take animal shapes. Singular, used as a label'
	},
	fighter: {
		id: 'pf1e.class.fighter',
		defaultMessage: 'Fighter',
		description: 'Name of a character class in Pathfinder: a trained warrior skilled with weapons and armor. Singular, used as a label'
	},
	inquisitor: {
		id: 'pf1e.class.inquisitor',
		defaultMessage: 'Inquisitor',
		description: 'Name of a character class in Pathfinder: a hunter of a faith\'s enemies. Singular, used as a label'
	},
	monk: {
		id: 'pf1e.class.monk',
		defaultMessage: 'Monk',
		description: 'Name of a character class in Pathfinder: a martial artist who fights unarmed. Singular, used as a label'
	},
	oracle: {
		id: 'pf1e.class.oracle',
		defaultMessage: 'Oracle',
		description: 'Name of a character class in Pathfinder: chosen by divine powers, cursed and gifted with spells. Singular, used as a label'
	},
	paladin: {
		id: 'pf1e.class.paladin',
		defaultMessage: 'Paladin',
		description: 'Name of a character class in Pathfinder: a holy warrior. Singular, used as a label'
	},
	ranger: {
		id: 'pf1e.class.ranger',
		defaultMessage: 'Ranger',
		description: 'Name of a character class in Pathfinder: a hunter and tracker of the wilds. Singular, used as a label'
	},
	rogue: {
		id: 'pf1e.class.rogue',
		defaultMessage: 'Rogue',
		description: 'Name of a character class in Pathfinder: a sneaky, skilled thief or scout. Singular, used as a label'
	},
	sorcerer: {
		id: 'pf1e.class.sorcerer',
		defaultMessage: 'Sorcerer',
		description: 'Name of a character class in Pathfinder: casts magic that comes from their bloodline. Singular, used as a label'
	},
	summoner: {
		id: 'pf1e.class.summoner',
		defaultMessage: 'Summoner',
		description: 'Name of a character class in Pathfinder: bonded to a summoned creature from another plane. Singular, used as a label'
	},
	witch: {
		id: 'pf1e.class.witch',
		defaultMessage: 'Witch',
		description: 'Name of a character class in Pathfinder: casts spells learned from a patron through a familiar. Singular, used as a label'
	},
	wizard: {
		id: 'pf1e.class.wizard',
		defaultMessage: 'Wizard',
		description: 'Name of a character class in Pathfinder: casts spells learned from study and a spellbook. Singular, used as a label'
	}
});
