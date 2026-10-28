/**
 * Starfinder 1E's default races, which a universe can edit, disable or add to
 *
 * Open Game Content from the Starfinder Roleplaying Game Core Rulebook, used under the Open Game License
 * 1.0a (client/license.html)
 */
import { defineMessages, type MessageDescriptor } from '../../localization.js';
import { emptySf1eAbilityScores, type Sf1eAbilityScores } from './abilities.js';
import type { Darkvision } from '../../vision.js';
import type { Sf1eSize } from './sizes.js';

/**
 * The bonus a race with a floating ability bonus adds to the ability the player chooses
 */
export const SF1E_FLOATING_ABILITY_BONUS = 2;

/**
 * Lowest and highest ability modifier an editor can give a race
 */
export const SF1E_MIN_RACE_ABILITY_MODIFIER = -99;
export const SF1E_MAX_RACE_ABILITY_MODIFIER = 99;

/**
 * Lowest and highest hit points an editor can give a race
 */
export const SF1E_MIN_RACE_HIT_POINTS = 0;
export const SF1E_MAX_RACE_HIT_POINTS = 99;

/**
 * What a race starts with before a universe edits it
 */
export interface Sf1eRaceDefaults
{
	/**
	 * Added to the character's ability scores; abilities left out get +0
	 */
	abilityModifiers: Partial<Sf1eAbilityScores>;

	/**
	 * Whether the player chooses one ability to get SF1E_FLOATING_ABILITY_BONUS
	 */
	floatingBonus: boolean;

	darkvision: Darkvision;

	/**
	 * Whether bright light dazzles the race's characters, shortening their vision (see visionBudget)
	 */
	lightSensitivity: boolean;

	size: Sf1eSize;

	/**
	 * The hit points the race gives a character, on top of their class's
	 */
	hitPoints: number;
}

/**
 * A race's rules as a universe stores and edits them, with a modifier for every ability
 */
export interface Sf1eRaceRules extends Omit<Sf1eRaceDefaults, 'abilityModifiers'>
{
	/**
	 * Added to the character's ability scores, each from SF1E_MIN_RACE_ABILITY_MODIFIER to
	 * SF1E_MAX_RACE_ABILITY_MODIFIER
	 */
	abilityModifiers: Sf1eAbilityScores;
}

/**
 * The rules a race the universe adds starts with: no modifiers, no darkvision, no light sensitivity,
 * medium, 4 hit points
 */
export const NEW_SF1E_RACE_RULES: Readonly<Sf1eRaceRules> = {
	abilityModifiers: emptySf1eAbilityScores(),
	floatingBonus: false,
	darkvision: 'none',
	lightSensitivity: false,
	size: 'medium',
	hitPoints: 4
};

/**
 * A default race's rules, with +0 for each ability it leaves out
 *
 * @param race The default race
 * @return Its rules
 */
export function sf1eRaceRules(race: Sf1eRaceDefaults): Sf1eRaceRules
{
	return({
		...race,
		abilityModifiers: {
			...emptySf1eAbilityScores(),
			...race.abilityModifiers
		}
	});
}

/**
 * The default races by key. Low-light vision and blindsense aren't modeled, so kasathas, lashuntas,
 * shirrens and vesk see like humans until vision exists (Phase 12). Lashuntas' two kinds, korasha and
 * damaya, aren't modeled either, so a lashunta gets only the +2 Charisma both share
 */
export const SF1E_RACES = {
	android: {
		abilityModifiers: {
			dexterity: 2,
			intelligence: 2,
			charisma: -2
		},
		floatingBonus: false,
		darkvision: 'normal',
		lightSensitivity: false,
		size: 'medium',
		hitPoints: 4
	},
	human: {
		abilityModifiers: {},
		floatingBonus: true,
		darkvision: 'none',
		lightSensitivity: false,
		size: 'medium',
		hitPoints: 4
	},
	kasatha: {
		abilityModifiers: {
			strength: 2,
			wisdom: 2,
			intelligence: -2
		},
		floatingBonus: false,
		darkvision: 'none',
		lightSensitivity: false,
		size: 'medium',
		hitPoints: 4
	},
	lashunta: {
		abilityModifiers: {
			charisma: 2
		},
		floatingBonus: false,
		darkvision: 'none',
		lightSensitivity: false,
		size: 'medium',
		hitPoints: 4
	},
	shirren: {
		abilityModifiers: {
			constitution: 2,
			wisdom: 2,
			charisma: -2
		},
		floatingBonus: false,
		darkvision: 'none',
		lightSensitivity: false,
		size: 'medium',
		hitPoints: 6
	},
	vesk: {
		abilityModifiers: {
			strength: 2,
			constitution: 2,
			intelligence: -2
		},
		floatingBonus: false,
		darkvision: 'none',
		lightSensitivity: false,
		size: 'medium',
		hitPoints: 6
	},
	ysoki: {
		abilityModifiers: {
			dexterity: 2,
			intelligence: 2,
			strength: -2
		},
		floatingBonus: false,
		darkvision: 'normal',
		lightSensitivity: false,
		size: 'small',
		hitPoints: 2
	}
} as const satisfies Record<string, Sf1eRaceDefaults>;

export type Sf1eRaceKey = keyof typeof SF1E_RACES;

/**
 * Each default race's name
 */
export const SF1E_RACE_NAMES: Record<Sf1eRaceKey, MessageDescriptor> = defineMessages({
	android: {
		id: 'sf1e.race.android',
		defaultMessage: 'Android',
		description: 'Name of a playable race in Starfinder: artificial people with bodies of machinery and flesh. Singular, used as a label'
	},
	human: {
		id: 'sf1e.race.human',
		defaultMessage: 'Human',
		description: 'Name of a playable race in Starfinder: humans. Singular, used as a label'
	},
	kasatha: {
		id: 'sf1e.race.kasatha',
		defaultMessage: 'Kasatha',
		description: 'Name of a playable race in Starfinder: tall, four-armed desert people. Singular, used as a label'
	},
	lashunta: {
		id: 'sf1e.race.lashunta',
		defaultMessage: 'Lashunta',
		description: 'Name of a playable race in Starfinder: telepathic people with antennae. Singular, used as a label'
	},
	shirren: {
		id: 'sf1e.race.shirren',
		defaultMessage: 'Shirren',
		description: 'Name of a playable race in Starfinder: insect-like people who broke free of a hive mind. Singular, used as a label'
	},
	vesk: {
		id: 'sf1e.race.vesk',
		defaultMessage: 'Vesk',
		description: 'Name of a playable race in Starfinder: large, warlike reptilian people. Singular, used as a label'
	},
	ysoki: {
		id: 'sf1e.race.ysoki',
		defaultMessage: 'Ysoki',
		description: 'Name of a playable race in Starfinder: small, clever people who look like rats standing upright. Singular, used as a label'
	}
});
