/**
 * Pathfinder 1E's default races, which a universe can edit, disable or add to
 *
 * Open Game Content from the Pathfinder Roleplaying Game Core Rulebook and Advanced Race Guide, used under
 * the Open Game License 1.0a (client/license.html)
 */
import { defineMessages, type MessageDescriptor } from '../../localization.js';
import type { Pf1eAbilityScores } from './abilities.js';
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

	darkvision: boolean;
	size: Pf1eSize;
}

/**
 * The default races by key. Low-light vision isn't modeled, so catfolk, elves, gnomes and half-elves see
 * like humans until vision exists (Phase 12)
 */
export const PF1E_RACES = {
	catfolk: {
		abilityModifiers: {
			dexterity: 2,
			charisma: 2,
			wisdom: -2
		},
		floatingBonus: false,
		darkvision: false,
		size: 'medium'
	},
	drow: {
		abilityModifiers: {
			dexterity: 2,
			charisma: 2,
			constitution: -2
		},
		floatingBonus: false,
		darkvision: true,
		size: 'medium'
	},
	dwarf: {
		abilityModifiers: {
			constitution: 2,
			wisdom: 2,
			charisma: -2
		},
		floatingBonus: false,
		darkvision: true,
		size: 'medium'
	},
	elf: {
		abilityModifiers: {
			dexterity: 2,
			intelligence: 2,
			constitution: -2
		},
		floatingBonus: false,
		darkvision: false,
		size: 'medium'
	},
	gnome: {
		abilityModifiers: {
			constitution: 2,
			charisma: 2,
			strength: -2
		},
		floatingBonus: false,
		darkvision: false,
		size: 'small'
	},
	goblin: {
		abilityModifiers: {
			dexterity: 4,
			strength: -2,
			charisma: -2
		},
		floatingBonus: false,
		darkvision: true,
		size: 'small'
	},
	half_elf: {
		abilityModifiers: {},
		floatingBonus: true,
		darkvision: false,
		size: 'medium'
	},
	half_orc: {
		abilityModifiers: {},
		floatingBonus: true,
		darkvision: true,
		size: 'medium'
	},
	halfling: {
		abilityModifiers: {
			dexterity: 2,
			charisma: 2,
			strength: -2
		},
		floatingBonus: false,
		darkvision: false,
		size: 'small'
	},
	hobgoblin: {
		abilityModifiers: {
			dexterity: 2,
			constitution: 2
		},
		floatingBonus: false,
		darkvision: true,
		size: 'medium'
	},
	human: {
		abilityModifiers: {},
		floatingBonus: true,
		darkvision: false,
		size: 'medium'
	},
	ratfolk: {
		abilityModifiers: {
			dexterity: 2,
			intelligence: 2,
			strength: -2
		},
		floatingBonus: false,
		darkvision: true,
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
	}
});
