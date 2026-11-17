/**
 * Pathfinder 1E's default classes, which a universe can edit, disable or add to
 *
 * Open Game Content from the Pathfinder Roleplaying Game Core Rulebook, Advanced Player's Guide and
 * Advanced Class Guide, used under the Open Game License 1.0a (client/license.html). Each class's book is
 * in rulebooks.ts
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
 * A class's rules: what a default class starts with, and what a universe stores and edits
 */
export interface Pf1eClassRules
{
	/**
	 * The ability the class relies on most, a hint when the player arranges their scores
	 */
	primaryAbility: Pf1eAbility;

	tradition: Pf1eMagicTradition;
	castingStyle: Pf1eCastingStyle;
}

/**
 * The rules a class the universe adds starts with: relying on strength, casting no spells
 */
export const NEW_PF1E_CLASS_RULES: Readonly<Pf1eClassRules> = {
	primaryAbility: 'strength',
	tradition: 'none',
	castingStyle: 'none'
};

/**
 * The default classes by key. The alchemist's and investigator's extracts count as arcane and prepared,
 * and the arcanist, who prepares spells but casts them from slots, as prepared
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
	},
	arcanist: {
		primaryAbility: 'intelligence',
		tradition: 'arcane',
		castingStyle: 'prepared'
	},
	bloodrager: {
		primaryAbility: 'strength',
		tradition: 'arcane',
		castingStyle: 'spontaneous'
	},
	brawler: {
		primaryAbility: 'strength',
		tradition: 'none',
		castingStyle: 'none'
	},
	hunter: {
		primaryAbility: 'wisdom',
		tradition: 'divine',
		castingStyle: 'spontaneous'
	},
	investigator: {
		primaryAbility: 'intelligence',
		tradition: 'arcane',
		castingStyle: 'prepared'
	},
	shaman: {
		primaryAbility: 'wisdom',
		tradition: 'divine',
		castingStyle: 'prepared'
	},
	skald: {
		primaryAbility: 'charisma',
		tradition: 'arcane',
		castingStyle: 'spontaneous'
	},
	slayer: {
		primaryAbility: 'dexterity',
		tradition: 'none',
		castingStyle: 'none'
	},
	swashbuckler: {
		primaryAbility: 'dexterity',
		tradition: 'none',
		castingStyle: 'none'
	},
	warpriest: {
		primaryAbility: 'wisdom',
		tradition: 'divine',
		castingStyle: 'prepared'
	}
} as const satisfies Record<string, Pf1eClassRules>;

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
	},
	arcanist: {
		id: 'pf1e.class.arcanist',
		defaultMessage: 'Arcanist',
		description: 'Name of a character class in Pathfinder: a scholar who prepares spells but shapes them freely as they cast. Singular, used as a label'
	},
	bloodrager: {
		id: 'pf1e.class.bloodrager',
		defaultMessage: 'Bloodrager',
		description: 'Name of a character class in Pathfinder: a warrior whose rage awakens magic in their blood. Singular, used as a label'
	},
	brawler: {
		id: 'pf1e.class.brawler',
		defaultMessage: 'Brawler',
		description: 'Name of a character class in Pathfinder: a fighter who wins with fists and quick adaptation. Singular, used as a label'
	},
	hunter: {
		id: 'pf1e.class.hunter',
		defaultMessage: 'Hunter',
		description: 'Name of a character class in Pathfinder: a wilderness spellcaster who fights alongside an animal companion. Singular, used as a label'
	},
	investigator: {
		id: 'pf1e.class.investigator',
		defaultMessage: 'Investigator',
		description: 'Name of a character class in Pathfinder: a detective who solves mysteries with keen wits and alchemy. Singular, used as a label'
	},
	shaman: {
		id: 'pf1e.class.shaman',
		defaultMessage: 'Shaman',
		description: 'Name of a character class in Pathfinder: casts spells granted by spirits through a spirit animal. Singular, used as a label'
	},
	skald: {
		id: 'pf1e.class.skald',
		defaultMessage: 'Skald',
		description: 'Name of a character class in Pathfinder: a warrior poet whose songs stir allies into a rage. Singular, used as a label'
	},
	slayer: {
		id: 'pf1e.class.slayer',
		defaultMessage: 'Slayer',
		description: 'Name of a character class in Pathfinder: a hunter of people who studies a target to strike it down. Singular, used as a label'
	},
	swashbuckler: {
		id: 'pf1e.class.swashbuckler',
		defaultMessage: 'Swashbuckler',
		description: 'Name of a character class in Pathfinder: a daring sword fighter who relies on flair and nimble moves. Singular, used as a label'
	},
	warpriest: {
		id: 'pf1e.class.warpriest',
		defaultMessage: 'Warpriest',
		description: 'Name of a character class in Pathfinder: a warrior who fights for their faith and casts divine spells. Singular, used as a label'
	}
});

/**
 * Each default class's description, shown in Create Character, the class editor, a rulebook's Contents dialog and the Audit tab
 */
export const PF1E_CLASS_DESCRIPTIONS: Record<Pf1eClassKey, MessageDescriptor> = defineMessages({
	alchemist: {
		id: 'pf1e.classDescription.alchemist',
		defaultMessage: 'An inventor who brews bombs, extracts and mutagens. Alchemists hurl explosives, drink extracts that work like spells and take mutagens that make them stronger in a fight.',
		description: 'Description of the alchemist, a character class in Pathfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	barbarian: {
		id: 'pf1e.classDescription.barbarian',
		defaultMessage: 'A fierce warrior who draws strength from fury. Barbarians rage to hit harder and shrug off blows, move fast and are hard to catch off guard.',
		description: 'Description of the barbarian, a character class in Pathfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	bard: {
		id: 'pf1e.classDescription.bard',
		defaultMessage: 'A performer whose music and words weave magic. Bards inspire their allies, know a little about everything and cast spells to help, charm and trick.',
		description: 'Description of the bard, a character class in Pathfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	cavalier: {
		id: 'pf1e.classDescription.cavalier',
		defaultMessage: 'A mounted knight sworn to an order and its cause. Cavaliers fight from the saddle of a loyal mount, challenge foes to single combat and rally their allies.',
		description: 'Description of the cavalier, a character class in Pathfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	cleric: {
		id: 'pf1e.classDescription.cleric',
		defaultMessage: 'A priest who channels the power of a god. Clerics cast divine spells, heal allies with channeled energy and draw powers from two domains of their faith.',
		description: 'Description of the cleric, a character class in Pathfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	druid: {
		id: 'pf1e.classDescription.druid',
		defaultMessage: 'A guardian of nature who draws magic from the wild. Druids cast divine spells, bond with an animal companion or a nature domain and can take the shapes of animals.',
		description: 'Description of the druid, a character class in Pathfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	fighter: {
		id: 'pf1e.classDescription.fighter',
		defaultMessage: 'A master of weapons and armor who wins battles through training and skill. Fighters learn more combat feats than any other class.',
		description: 'Description of the fighter, a character class in Pathfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	inquisitor: {
		id: 'pf1e.classDescription.inquisitor',
		defaultMessage: 'A relentless agent of a faith who roots out its enemies. Inquisitors cast divine spells, pass judgment on foes in battle and are hard to lie to.',
		description: 'Description of the inquisitor, a character class in Pathfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	monk: {
		id: 'pf1e.classDescription.monk',
		defaultMessage: 'A martial artist who trains body and mind to perfection. Monks fight without weapons or armor, strike in flurries of blows and grow faster as they train.',
		description: 'Description of the monk, a character class in Pathfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	oracle: {
		id: 'pf1e.classDescription.oracle',
		defaultMessage: 'A spellcaster chosen by divine powers, whether they wanted it or not. Oracles carry a curse that both hinders and helps them, and draw spells and powers from a mystery.',
		description: 'Description of the oracle, a character class in Pathfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	paladin: {
		id: 'pf1e.classDescription.paladin',
		defaultMessage: 'A holy warrior sworn to a strict code of honor. Paladins smite evil, heal with a touch, stand firm against fear and disease, and later cast a few divine spells.',
		description: 'Description of the paladin, a character class in Pathfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	ranger: {
		id: 'pf1e.classDescription.ranger',
		defaultMessage: 'A hunter and tracker of the wilds. Rangers fight best against chosen foes and in favored lands, with a bow or two weapons, and later gain a hunting companion and spells.',
		description: 'Description of the ranger, a character class in Pathfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	rogue: {
		id: 'pf1e.classDescription.rogue',
		defaultMessage: 'A sneaky, skilled scout and thief. Rogues land sneak attacks on unwary foes, find and disarm traps, and learn more skills than any other class.',
		description: 'Description of the rogue, a character class in Pathfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	sorcerer: {
		id: 'pf1e.classDescription.sorcerer',
		defaultMessage: 'A spellcaster whose magic flows from their bloodline. Sorcerers know fewer spells than wizards but cast them more often, without a spellbook, and gain powers from their blood.',
		description: 'Description of the sorcerer, a character class in Pathfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	summoner: {
		id: 'pf1e.classDescription.summoner',
		defaultMessage: 'A spellcaster bonded to an eidolon, a creature from another plane that grows and changes with them. Summoners fight beside it, call up other creatures and cast arcane spells.',
		description: 'Description of the summoner, a character class in Pathfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	witch: {
		id: 'pf1e.classDescription.witch',
		defaultMessage: 'A spellcaster who learns magic from a mysterious patron through a familiar. Witches cast arcane spells and use hexes to curse foes and aid allies.',
		description: 'Description of the witch, a character class in Pathfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	wizard: {
		id: 'pf1e.classDescription.wizard',
		defaultMessage: 'A scholar who learns magic from study and a spellbook. Wizards have the widest range of arcane spells and can specialize in one school of magic.',
		description: 'Description of the wizard, a character class in Pathfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	arcanist: {
		id: 'pf1e.classDescription.arcanist',
		defaultMessage: 'A scholar who studies magic like a wizard but casts it like a sorcerer. Arcanists prepare spells each day, cast them freely from their slots and draw on a pool of arcane power.',
		description: 'Description of the arcanist, a character class in Pathfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	bloodrager: {
		id: 'pf1e.classDescription.bloodrager',
		defaultMessage: 'A warrior whose rage awakens magic in their blood. Bloodragers fight in a fury, gain powers from a bloodline as they rage and cast a few arcane spells.',
		description: 'Description of the bloodrager, a character class in Pathfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	brawler: {
		id: 'pf1e.classDescription.brawler',
		defaultMessage: 'A versatile unarmed fighter who thinks fast in a brawl. Brawlers hit hard with their fists, pick up the combat feat they need on the spot and excel at combat maneuvers.',
		description: 'Description of the brawler, a character class in Pathfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	hunter: {
		id: 'pf1e.classDescription.hunter',
		defaultMessage: 'A wilderness spellcaster who fights alongside an animal companion. Hunters and their companions share tactics and animal powers, track their prey and cast nature spells.',
		description: 'Description of the hunter, a character class in Pathfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	investigator: {
		id: 'pf1e.classDescription.investigator',
		defaultMessage: 'A detective who solves mysteries with sharp wits and alchemy. Investigators draw on inspiration to boost their checks, brew extracts and study foes to strike them down.',
		description: 'Description of the investigator, a character class in Pathfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	shaman: {
		id: 'pf1e.classDescription.shaman',
		defaultMessage: 'A spellcaster who speaks with spirits through a spirit animal. Shamans cast divine spells, use hexes and take on the powers of a chosen spirit.',
		description: 'Description of the shaman, a character class in Pathfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	skald: {
		id: 'pf1e.classDescription.skald',
		defaultMessage: 'A warrior poet whose songs drive allies into a rage. Skalds fight on the front line, cast arcane spells and share their fury with the whole party.',
		description: 'Description of the skald, a character class in Pathfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	slayer: {
		id: 'pf1e.classDescription.slayer',
		defaultMessage: 'A hunter of people who studies a target to strike it down. Slayers track their quarry, land sneak attacks and pick up tricks from rogues and rangers.',
		description: 'Description of the slayer, a character class in Pathfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	swashbuckler: {
		id: 'pf1e.classDescription.swashbuckler',
		defaultMessage: 'A daring sword fighter who relies on flair and nimble moves. Swashbucklers spend panache on bold deeds, parry attacks and strike with deadly precision using thrusting blades.',
		description: 'Description of the swashbuckler, a character class in Pathfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	},
	warpriest: {
		id: 'pf1e.classDescription.warpriest',
		defaultMessage: 'A warrior who fights for their faith with weapon and spell. Warpriests bless themselves and their weapons, learn combat feats and cast divine spells.',
		description: 'Description of the warpriest, a character class in Pathfinder, shown in Create Character, the class editor, a rulebook\'s contents and the Audit tab'
	}
});
