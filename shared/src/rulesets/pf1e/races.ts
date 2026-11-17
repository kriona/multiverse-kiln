/**
 * Pathfinder 1E's default races, which a universe can edit, disable or add to
 *
 * Open Game Content from the Pathfinder Roleplaying Game Core Rulebook and Advanced Race Guide, used under
 * the Open Game License 1.0a (client/license.html). Each race's book is in rulebooks.ts
 */
import { defineMessages, type MessageDescriptor } from '../../localization.js';
import { emptyPf1eAbilityScores, type Pf1eAbilityScores } from './abilities.js';
import type { Darkvision } from '../../vision.js';
import type { Pf1eSize } from './sizes.js';

/**
 * The bonus a race with a floating ability bonus adds to the ability the player chooses
 */
export const PF1E_FLOATING_ABILITY_BONUS = 2;

/**
 * Lowest and highest ability modifier an editor can give a race
 */
export const PF1E_MIN_RACE_ABILITY_MODIFIER = -99;
export const PF1E_MAX_RACE_ABILITY_MODIFIER = 99;

/**
 * What a race starts with before a universe edits it
 */
export interface Pf1eRaceDefaults
{
	/**
	 * Added to the character's ability scores; abilities left out get +0
	 */
	abilityModifiers: Partial<Pf1eAbilityScores>;

	/**
	 * Whether the player chooses one ability to get PF1E_FLOATING_ABILITY_BONUS
	 */
	floatingBonus: boolean;

	darkvision: Darkvision;

	/**
	 * Whether bright light dazzles the race's characters, shortening their vision (see visionBudget)
	 */
	lightSensitivity: boolean;

	size: Pf1eSize;
}

/**
 * A race's rules as a universe stores and edits them, with a modifier for every ability
 */
export interface Pf1eRaceRules extends Omit<Pf1eRaceDefaults, 'abilityModifiers'>
{
	/**
	 * Added to the character's ability scores, each from PF1E_MIN_RACE_ABILITY_MODIFIER to
	 * PF1E_MAX_RACE_ABILITY_MODIFIER
	 */
	abilityModifiers: Pf1eAbilityScores;
}

/**
 * The rules a race the universe adds starts with: no modifiers, no darkvision, no light sensitivity, medium
 */
export const NEW_PF1E_RACE_RULES: Readonly<Pf1eRaceRules> = {
	abilityModifiers: emptyPf1eAbilityScores(),
	floatingBonus: false,
	darkvision: 'none',
	lightSensitivity: false,
	size: 'medium'
};

/**
 * A default race's rules, with +0 for each ability it leaves out
 *
 * @param race The default race
 * @return Its rules
 */
export function pf1eRaceRules(race: Pf1eRaceDefaults): Pf1eRaceRules
{
	return({
		...race,
		abilityModifiers: {
			...emptyPf1eAbilityScores(),
			...race.abilityModifiers
		}
	});
}

/**
 * The default races by key. Low-light vision isn't modeled, so the races that have only low-light vision,
 * such as elves, see like humans
 */
export const PF1E_RACES = {
	catfolk: {
		abilityModifiers: {
			dexterity: 2,
			charisma: 2,
			wisdom: -2
		},
		floatingBonus: false,
		darkvision: 'none',
		lightSensitivity: false,
		size: 'medium'
	},
	drow: {
		abilityModifiers: {
			dexterity: 2,
			charisma: 2,
			constitution: -2
		},
		floatingBonus: false,
		darkvision: 'superior',
		lightSensitivity: true,
		size: 'medium'
	},
	dwarf: {
		abilityModifiers: {
			constitution: 2,
			wisdom: 2,
			charisma: -2
		},
		floatingBonus: false,
		darkvision: 'normal',
		lightSensitivity: false,
		size: 'medium'
	},
	elf: {
		abilityModifiers: {
			dexterity: 2,
			intelligence: 2,
			constitution: -2
		},
		floatingBonus: false,
		darkvision: 'none',
		lightSensitivity: false,
		size: 'medium'
	},
	gnome: {
		abilityModifiers: {
			constitution: 2,
			charisma: 2,
			strength: -2
		},
		floatingBonus: false,
		darkvision: 'none',
		lightSensitivity: false,
		size: 'small'
	},
	goblin: {
		abilityModifiers: {
			dexterity: 4,
			strength: -2,
			charisma: -2
		},
		floatingBonus: false,
		darkvision: 'normal',
		lightSensitivity: false,
		size: 'small'
	},
	half_elf: {
		abilityModifiers: {},
		floatingBonus: true,
		darkvision: 'none',
		lightSensitivity: false,
		size: 'medium'
	},
	half_orc: {
		abilityModifiers: {},
		floatingBonus: true,
		darkvision: 'normal',
		lightSensitivity: false,
		size: 'medium'
	},
	halfling: {
		abilityModifiers: {
			dexterity: 2,
			charisma: 2,
			strength: -2
		},
		floatingBonus: false,
		darkvision: 'none',
		lightSensitivity: false,
		size: 'small'
	},
	hobgoblin: {
		abilityModifiers: {
			dexterity: 2,
			constitution: 2
		},
		floatingBonus: false,
		darkvision: 'normal',
		lightSensitivity: false,
		size: 'medium'
	},
	human: {
		abilityModifiers: {},
		floatingBonus: true,
		darkvision: 'none',
		lightSensitivity: false,
		size: 'medium'
	},
	ratfolk: {
		abilityModifiers: {
			dexterity: 2,
			intelligence: 2,
			strength: -2
		},
		floatingBonus: false,
		darkvision: 'normal',
		lightSensitivity: false,
		size: 'small'
	},
	aasimar: {
		abilityModifiers: {
			wisdom: 2,
			charisma: 2
		},
		floatingBonus: false,
		darkvision: 'normal',
		lightSensitivity: false,
		size: 'medium'
	},
	changeling: {
		abilityModifiers: {
			wisdom: 2,
			charisma: 2,
			constitution: -2
		},
		floatingBonus: false,
		darkvision: 'normal',
		lightSensitivity: false,
		size: 'medium'
	},
	dhampir: {
		abilityModifiers: {
			dexterity: 2,
			charisma: 2,
			constitution: -2
		},
		floatingBonus: false,
		darkvision: 'normal',
		lightSensitivity: true,
		size: 'medium'
	},
	duergar: {
		abilityModifiers: {
			constitution: 2,
			wisdom: 2,
			charisma: -4
		},
		floatingBonus: false,
		darkvision: 'superior',
		lightSensitivity: true,
		size: 'medium'
	},
	fetchling: {
		abilityModifiers: {
			dexterity: 2,
			charisma: 2,
			wisdom: -2
		},
		floatingBonus: false,
		darkvision: 'normal',
		lightSensitivity: false,
		size: 'medium'
	},
	gillman: {
		abilityModifiers: {
			constitution: 2,
			charisma: 2,
			wisdom: -2
		},
		floatingBonus: false,
		darkvision: 'none',
		lightSensitivity: false,
		size: 'medium'
	},
	grippli: {
		abilityModifiers: {
			dexterity: 2,
			wisdom: 2,
			strength: -2
		},
		floatingBonus: false,
		darkvision: 'normal',
		lightSensitivity: false,
		size: 'small'
	},
	ifrit: {
		abilityModifiers: {
			dexterity: 2,
			charisma: 2,
			wisdom: -2
		},
		floatingBonus: false,
		darkvision: 'normal',
		lightSensitivity: false,
		size: 'medium'
	},
	kitsune: {
		abilityModifiers: {
			dexterity: 2,
			charisma: 2,
			strength: -2
		},
		floatingBonus: false,
		darkvision: 'none',
		lightSensitivity: false,
		size: 'medium'
	},
	kobold: {
		abilityModifiers: {
			dexterity: 2,
			strength: -4,
			constitution: -2
		},
		floatingBonus: false,
		darkvision: 'normal',
		lightSensitivity: true,
		size: 'small'
	},
	merfolk: {
		abilityModifiers: {
			dexterity: 2,
			constitution: 2,
			charisma: 2
		},
		floatingBonus: false,
		darkvision: 'none',
		lightSensitivity: false,
		size: 'medium'
	},
	nagaji: {
		abilityModifiers: {
			strength: 2,
			charisma: 2,
			intelligence: -2
		},
		floatingBonus: false,
		darkvision: 'none',
		lightSensitivity: false,
		size: 'medium'
	},
	orc: {
		abilityModifiers: {
			strength: 4,
			intelligence: -2,
			wisdom: -2,
			charisma: -2
		},
		floatingBonus: false,
		darkvision: 'normal',
		lightSensitivity: true,
		size: 'medium'
	},
	oread: {
		abilityModifiers: {
			strength: 2,
			wisdom: 2,
			charisma: -2
		},
		floatingBonus: false,
		darkvision: 'normal',
		lightSensitivity: false,
		size: 'medium'
	},
	samsaran: {
		abilityModifiers: {
			intelligence: 2,
			wisdom: 2,
			constitution: -2
		},
		floatingBonus: false,
		darkvision: 'none',
		lightSensitivity: false,
		size: 'medium'
	},
	strix: {
		abilityModifiers: {
			dexterity: 2,
			charisma: -2
		},
		floatingBonus: false,
		darkvision: 'normal',
		lightSensitivity: false,
		size: 'medium'
	},
	suli: {
		abilityModifiers: {
			strength: 2,
			charisma: 2,
			intelligence: -2
		},
		floatingBonus: false,
		darkvision: 'none',
		lightSensitivity: false,
		size: 'medium'
	},
	svirfneblin: {
		abilityModifiers: {
			strength: -2,
			dexterity: 2,
			wisdom: 2,
			charisma: -4
		},
		floatingBonus: false,
		darkvision: 'superior',
		lightSensitivity: false,
		size: 'small'
	},
	sylph: {
		abilityModifiers: {
			dexterity: 2,
			intelligence: 2,
			constitution: -2
		},
		floatingBonus: false,
		darkvision: 'normal',
		lightSensitivity: false,
		size: 'medium'
	},
	tengu: {
		abilityModifiers: {
			dexterity: 2,
			wisdom: 2,
			constitution: -2
		},
		floatingBonus: false,
		darkvision: 'none',
		lightSensitivity: false,
		size: 'medium'
	},
	tiefling: {
		abilityModifiers: {
			dexterity: 2,
			intelligence: 2,
			charisma: -2
		},
		floatingBonus: false,
		darkvision: 'normal',
		lightSensitivity: false,
		size: 'medium'
	},
	undine: {
		abilityModifiers: {
			dexterity: 2,
			wisdom: 2,
			strength: -2
		},
		floatingBonus: false,
		darkvision: 'normal',
		lightSensitivity: false,
		size: 'medium'
	},
	vanara: {
		abilityModifiers: {
			dexterity: 2,
			wisdom: 2,
			charisma: -2
		},
		floatingBonus: false,
		darkvision: 'none',
		lightSensitivity: false,
		size: 'medium'
	},
	vishkanya: {
		abilityModifiers: {
			dexterity: 2,
			charisma: 2,
			wisdom: -2
		},
		floatingBonus: false,
		darkvision: 'none',
		lightSensitivity: false,
		size: 'medium'
	},
	wayang: {
		abilityModifiers: {
			dexterity: 2,
			intelligence: 2,
			wisdom: -2
		},
		floatingBonus: false,
		darkvision: 'normal',
		lightSensitivity: false,
		size: 'small'
	}
} as const satisfies Record<string, Pf1eRaceDefaults>;

export type Pf1eRaceKey = keyof typeof PF1E_RACES;

/**
 * Each default race's name
 */
export const PF1E_RACE_NAMES: Record<Pf1eRaceKey, MessageDescriptor> = defineMessages({
	catfolk: {
		id: 'pf1e.race.catfolk',
		defaultMessage: 'Catfolk',
		description: 'Name of a playable race in Pathfinder: curious, agile people who look like cats standing upright'
	},
	drow: {
		id: 'pf1e.race.drow',
		defaultMessage: 'Drow',
		description: 'Name of a playable race in Pathfinder: dark elves who live underground'
	},
	dwarf: {
		id: 'pf1e.race.dwarf',
		defaultMessage: 'Dwarf',
		description: 'Name of a playable race in Pathfinder: short, stout people of the mountains. Singular, used as a label'
	},
	elf: {
		id: 'pf1e.race.elf',
		defaultMessage: 'Elf',
		description: 'Name of a playable race in Pathfinder: long-lived, graceful people. Singular, used as a label'
	},
	gnome: {
		id: 'pf1e.race.gnome',
		defaultMessage: 'Gnome',
		description: 'Name of a playable race in Pathfinder: small, whimsical people with fey ancestry. Singular, used as a label'
	},
	goblin: {
		id: 'pf1e.race.goblin',
		defaultMessage: 'Goblin',
		description: 'Name of a playable race in Pathfinder: small, mischievous, fire-loving people. Singular, used as a label'
	},
	half_elf: {
		id: 'pf1e.race.half_elf',
		defaultMessage: 'Half-Elf',
		description: 'Name of a playable race in Pathfinder: people with one human and one elven parent. Singular, used as a label'
	},
	half_orc: {
		id: 'pf1e.race.half_orc',
		defaultMessage: 'Half-Orc',
		description: 'Name of a playable race in Pathfinder: people with one human and one orc parent. Singular, used as a label'
	},
	halfling: {
		id: 'pf1e.race.halfling',
		defaultMessage: 'Halfling',
		description: 'Name of a playable race in Pathfinder: small, lucky people about half the height of a human. Singular, used as a label'
	},
	hobgoblin: {
		id: 'pf1e.race.hobgoblin',
		defaultMessage: 'Hobgoblin',
		description: 'Name of a playable race in Pathfinder: disciplined, militaristic cousins of goblins, the size of humans. Singular, used as a label'
	},
	human: {
		id: 'pf1e.race.human',
		defaultMessage: 'Human',
		description: 'Name of a playable race in Pathfinder: humans. Singular, used as a label'
	},
	ratfolk: {
		id: 'pf1e.race.ratfolk',
		defaultMessage: 'Ratfolk',
		description: 'Name of a playable race in Pathfinder: small, clever people who look like rats standing upright'
	},
	aasimar: {
		id: 'pf1e.race.aasimar',
		defaultMessage: 'Aasimar',
		description: 'Name of a playable race in Pathfinder: humans with a trace of celestial, angelic blood. Singular, used as a label'
	},
	changeling: {
		id: 'pf1e.race.changeling',
		defaultMessage: 'Changeling',
		description: 'Name of a playable race in Pathfinder: daughters of hags raised among humans, with eyes of two colors. Singular, used as a label'
	},
	dhampir: {
		id: 'pf1e.race.dhampir',
		defaultMessage: 'Dhampir',
		description: 'Name of a playable race in Pathfinder: people with one human and one vampire parent. Singular, used as a label'
	},
	duergar: {
		id: 'pf1e.race.duergar',
		defaultMessage: 'Duergar',
		description: 'Name of a playable race in Pathfinder: gray dwarves who live deep underground. Singular, used as a label'
	},
	fetchling: {
		id: 'pf1e.race.fetchling',
		defaultMessage: 'Fetchling',
		description: 'Name of a playable race in Pathfinder: pale, shadowy descendants of humans who lived on a plane of shadow. Singular, used as a label'
	},
	gillman: {
		id: 'pf1e.race.gillman',
		defaultMessage: 'Gillman',
		description: 'Name of a playable race in Pathfinder: humans with gills, who breathe both air and water. Singular, used as a label'
	},
	grippli: {
		id: 'pf1e.race.grippli',
		defaultMessage: 'Grippli',
		description: 'Name of a playable race in Pathfinder: small frog people of the swamps and jungles. Singular, used as a label'
	},
	ifrit: {
		id: 'pf1e.race.ifrit',
		defaultMessage: 'Ifrit',
		description: 'Name of a playable race in Pathfinder: humans with a trace of the blood of fire spirits. Singular, used as a label'
	},
	kitsune: {
		id: 'pf1e.race.kitsune',
		defaultMessage: 'Kitsune',
		description: 'Name of a playable race in Pathfinder: fox people who can take human form. Singular, used as a label'
	},
	kobold: {
		id: 'pf1e.race.kobold',
		defaultMessage: 'Kobold',
		description: 'Name of a playable race in Pathfinder: small, scaly people who believe they descend from dragons. Singular, used as a label'
	},
	merfolk: {
		id: 'pf1e.race.merfolk',
		defaultMessage: 'Merfolk',
		description: 'Name of a playable race in Pathfinder: sea people with a fish\'s tail in place of legs'
	},
	nagaji: {
		id: 'pf1e.race.nagaji',
		defaultMessage: 'Nagaji',
		description: 'Name of a playable race in Pathfinder: scaled, snake-like people created to serve nagas. Singular, used as a label'
	},
	orc: {
		id: 'pf1e.race.orc',
		defaultMessage: 'Orc',
		description: 'Name of a playable race in Pathfinder: strong, brutal people who live by raiding. Singular, used as a label'
	},
	oread: {
		id: 'pf1e.race.oread',
		defaultMessage: 'Oread',
		description: 'Name of a playable race in Pathfinder: humans with a trace of the blood of earth spirits. Singular, used as a label'
	},
	samsaran: {
		id: 'pf1e.race.samsaran',
		defaultMessage: 'Samsaran',
		description: 'Name of a playable race in Pathfinder: blue-skinned people who are reborn and remember past lives. Singular, used as a label'
	},
	strix: {
		id: 'pf1e.race.strix',
		defaultMessage: 'Strix',
		description: 'Name of a playable race in Pathfinder: winged, dark-skinned people of the mountains. Singular, used as a label'
	},
	suli: {
		id: 'pf1e.race.suli',
		defaultMessage: 'Suli',
		description: 'Name of a playable race in Pathfinder: humans descended from genies of all four elements. Singular, used as a label'
	},
	svirfneblin: {
		id: 'pf1e.race.svirfneblin',
		defaultMessage: 'Svirfneblin',
		description: 'Name of a playable race in Pathfinder: deep gnomes who live underground. Singular, used as a label'
	},
	sylph: {
		id: 'pf1e.race.sylph',
		defaultMessage: 'Sylph',
		description: 'Name of a playable race in Pathfinder: humans with a trace of the blood of air spirits. Singular, used as a label'
	},
	tengu: {
		id: 'pf1e.race.tengu',
		defaultMessage: 'Tengu',
		description: 'Name of a playable race in Pathfinder: crow-like bird people. Singular, used as a label'
	},
	tiefling: {
		id: 'pf1e.race.tiefling',
		defaultMessage: 'Tiefling',
		description: 'Name of a playable race in Pathfinder: humans with a trace of fiendish, demonic blood. Singular, used as a label'
	},
	undine: {
		id: 'pf1e.race.undine',
		defaultMessage: 'Undine',
		description: 'Name of a playable race in Pathfinder: humans with a trace of the blood of water spirits. Singular, used as a label'
	},
	vanara: {
		id: 'pf1e.race.vanara',
		defaultMessage: 'Vanara',
		description: 'Name of a playable race in Pathfinder: monkey people of the jungles. Singular, used as a label'
	},
	vishkanya: {
		id: 'pf1e.race.vishkanya',
		defaultMessage: 'Vishkanya',
		description: 'Name of a playable race in Pathfinder: graceful, scaled people whose blood is poison. Singular, used as a label'
	},
	wayang: {
		id: 'pf1e.race.wayang',
		defaultMessage: 'Wayang',
		description: 'Name of a playable race in Pathfinder: small, shadowy people who live in darkness. Singular, used as a label'
	}
});

/**
 * Each default race's description, shown in Create Character, the race editor, a rulebook's Contents dialog and the Audit tab
 */
export const PF1E_RACE_DESCRIPTIONS: Record<Pf1eRaceKey, MessageDescriptor> = defineMessages({
	catfolk: {
		id: 'pf1e.raceDescription.catfolk',
		defaultMessage: 'Curious, sociable people who look like cats standing upright. They are quick and charming, with sharp senses for hunting, sneaking and tracking.',
		description: 'Description of the catfolk, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	drow: {
		id: 'pf1e.raceDescription.drow',
		defaultMessage: 'Graceful but frail elves who live deep underground. They resist magic, can call up darkness and see far in the dark, but bright light blinds them.',
		description: 'Description of the drow, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	dwarf: {
		id: 'pf1e.raceDescription.dwarf',
		defaultMessage: 'Stout, stubborn folk who live in mountain halls. They are tough, wise and hard to move once they\'ve made up their minds.',
		description: 'Description of the dwarf, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	elf: {
		id: 'pf1e.raceDescription.elf',
		defaultMessage: 'Long-lived, graceful people with a deep bond to nature and magic. They are quick and clever, with keen senses, and magic can\'t put them to sleep.',
		description: 'Description of the elf, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	gnome: {
		id: 'pf1e.raceDescription.gnome',
		defaultMessage: 'Small, whimsical people descended from the fey, always hungry for new experiences. They are hardy and charming, with a knack for illusion magic.',
		description: 'Description of the gnome, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	goblin: {
		id: 'pf1e.raceDescription.goblin',
		defaultMessage: 'Small, fast, fire-loving troublemakers. They are very nimble, sneaky and good riders, but weak and hard to get along with.',
		description: 'Description of the goblin, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	half_elf: {
		id: 'pf1e.raceDescription.half_elf',
		defaultMessage: 'Children of humans and elves, often caught between both worlds. They are adaptable and talented, with keen senses and a gift for more than one class.',
		description: 'Description of the half-elf, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	half_orc: {
		id: 'pf1e.raceDescription.half_orc',
		defaultMessage: 'Children of humans and orcs, strong and often feared. They are intimidating, see in the dark and can fight on for a moment after a blow that would drop them.',
		description: 'Description of the half-orc, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	halfling: {
		id: 'pf1e.raceDescription.halfling',
		defaultMessage: 'Small, cheerful people about half a human\'s height. They are nimble, charming and lucky, and hard to frighten.',
		description: 'Description of the halfling, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	hobgoblin: {
		id: 'pf1e.raceDescription.hobgoblin',
		defaultMessage: 'Disciplined, warlike cousins of goblins who stand as tall as humans. They are quick, hardy and stealthy, and see in the dark.',
		description: 'Description of the hobgoblin, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	human: {
		id: 'pf1e.raceDescription.human',
		defaultMessage: 'Ambitious, adaptable people found almost everywhere. They gain an extra feat and more skill ranks, and can put their +2 ability bonus where they like.',
		description: 'Description of the human, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	ratfolk: {
		id: 'pf1e.raceDescription.ratfolk',
		defaultMessage: 'Small, clever people who look like rats standing upright. They are nimble tinkerers and alchemists who crowd together in battle to gang up on foes.',
		description: 'Description of the ratfolk, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	aasimar: {
		id: 'pf1e.raceDescription.aasimar',
		defaultMessage: 'Humans touched by celestial blood, often strikingly beautiful. They are wise and charming, resist acid, cold and electricity, and can call up daylight once a day.',
		description: 'Description of the aasimar, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	changeling: {
		id: 'pf1e.raceDescription.changeling',
		defaultMessage: 'Daughters of hags raised among humans, with eyes of two colors. They are wise and charming but frail, with sharp claws and a trait passed down from their mother.',
		description: 'Description of the changeling, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	dhampir: {
		id: 'pf1e.raceDescription.dhampir',
		defaultMessage: 'Children of vampires and humans, graceful and persuasive but frail. Healing magic harms them while negative energy heals them, and bright light dazzles them.',
		description: 'Description of the dhampir, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	duergar: {
		id: 'pf1e.raceDescription.duergar',
		defaultMessage: 'Grim gray dwarves of the deep underground. They can grow larger or turn invisible, shrug off poison and paralysis, and see far in the dark, but bright light dazzles them.',
		description: 'Description of the duergar, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	fetchling: {
		id: 'pf1e.raceDescription.fetchling',
		defaultMessage: 'Pale descendants of humans who settled on the plane of shadow. They melt into dim light, resist cold and electricity, and can disguise themselves with magic.',
		description: 'Description of the fetchling, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	gillman: {
		id: 'pf1e.raceDescription.gillman',
		defaultMessage: 'Humans with gills who breathe both air and water. They are hardy and charming, swim well and resist enchantments, but must soak in water every day.',
		description: 'Description of the gillman, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	grippli: {
		id: 'pf1e.raceDescription.grippli',
		defaultMessage: 'Small frog people of swamps and jungles. They are nimble climbers who hide well among trees and reeds and move through swampy ground with ease.',
		description: 'Description of the grippli, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	ifrit: {
		id: 'pf1e.raceDescription.ifrit',
		defaultMessage: 'Humans touched by the blood of fire spirits, fiery and impulsive. They are quick and charming, resist fire and can call up a burst of flame once a day.',
		description: 'Description of the ifrit, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	kitsune: {
		id: 'pf1e.raceDescription.kitsune',
		defaultMessage: 'Fox people who can take a human form at will. They are agile, charming tricksters with a sharp bite and a talent for enchantment magic.',
		description: 'Description of the kitsune, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	kobold: {
		id: 'pf1e.raceDescription.kobold',
		defaultMessage: 'Small, scaly people who believe they descend from dragons. They are quick but weak, with keen eyes and a talent for traps, and bright light dazzles them.',
		description: 'Description of the kobold, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	merfolk: {
		id: 'pf1e.raceDescription.merfolk',
		defaultMessage: 'Sea people with a fish\'s tail in place of legs. They are graceful, hardy and charming, swim swiftly and breathe air and water, but crawl slowly on land.',
		description: 'Description of the merfolk, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	nagaji: {
		id: 'pf1e.raceDescription.nagaji',
		defaultMessage: 'Scaled, snake-like people created to serve nagas. They are strong and imposing, with tough scales, a way with reptiles, and resistance to poison and mind control.',
		description: 'Description of the nagaji, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	orc: {
		id: 'pf1e.raceDescription.orc',
		defaultMessage: 'Fierce, brutal people who live by raiding and war. They are very strong and fight on even when badly wounded, but bright light dazzles them.',
		description: 'Description of the orc, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	oread: {
		id: 'pf1e.raceDescription.oread',
		defaultMessage: 'Humans touched by the blood of earth spirits, calm and steady. They are strong and wise, resist acid and can turn pebbles into magic sling stones once a day.',
		description: 'Description of the oread, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	samsaran: {
		id: 'pf1e.raceDescription.samsaran',
		defaultMessage: 'Blue-skinned people who are reborn again and again, keeping pieces of past lives. They are wise and learned but frail, with skills carried over from lives before.',
		description: 'Description of the samsaran, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	strix: {
		id: 'pf1e.raceDescription.strix',
		defaultMessage: 'Winged people of the mountains, quick and proud, who distrust humans. They can fly from the start, see in the dark and are most alert and stealthy at night.',
		description: 'Description of the strix, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	suli: {
		id: 'pf1e.raceDescription.suli',
		defaultMessage: 'Humans descended from genies of all four elements. They are strong and persuasive, resist acid, cold, electricity and fire, and can wreathe their hands in any of them.',
		description: 'Description of the suli, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	svirfneblin: {
		id: 'pf1e.raceDescription.svirfneblin',
		defaultMessage: 'Serious, wary deep gnomes who live far underground. They are hard to hit, resist magic and see far in the dark, with innate spells for hiding and deceiving.',
		description: 'Description of the svirfneblin, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	sylph: {
		id: 'pf1e.raceDescription.sylph',
		defaultMessage: 'Humans touched by the blood of air spirits, light and restless. They are quick and clever, resist electricity and can drift gently down from a fall once a day.',
		description: 'Description of the sylph, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	tengu: {
		id: 'pf1e.raceDescription.tengu',
		defaultMessage: 'Crow-like bird people, quick and watchful but fragile. They train with swords from birth, learn languages with ease and have a sharp bite.',
		description: 'Description of the tengu, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	tiefling: {
		id: 'pf1e.raceDescription.tiefling',
		defaultMessage: 'Humans touched by fiendish blood, often marked by horns, tails or strange eyes. They are quick and clever, resist cold, electricity and fire, and can call up darkness.',
		description: 'Description of the tiefling, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	undine: {
		id: 'pf1e.raceDescription.undine',
		defaultMessage: 'Humans touched by the blood of water spirits, calm and adaptable. They are quick and wise, swim well, resist cold and can hurl a blast of water once a day.',
		description: 'Description of the undine, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	vanara: {
		id: 'pf1e.raceDescription.vanara',
		defaultMessage: 'Playful monkey people of the jungles. They are nimble and wise, climb with ease and can carry things with their tails.',
		description: 'Description of the vanara, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	vishkanya: {
		id: 'pf1e.raceDescription.vishkanya',
		defaultMessage: 'Graceful, scaled people whose blood is poison. They are quick and charming, shrug off poisons and can coat their weapons in their own venom.',
		description: 'Description of the vishkanya, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	},
	wayang: {
		id: 'pf1e.raceDescription.wayang',
		defaultMessage: 'Small, shadowy people at home in darkness. They are nimble, clever and stealthy, with a gift for shadow and illusion magic.',
		description: 'Description of the wayang, a playable race in Pathfinder, shown in Create Character, the race editor, a rulebook\'s contents and the Audit tab'
	}
});
