/**
 * Pathfinder 1E's ability scores
 *
 * Open Game Content from the Pathfinder Roleplaying Game Core Rulebook, used under the Open Game License
 * 1.0a (client/license.html)
 */
import { defineMessages, type MessageDescriptor } from '../../localization.js';

/**
 * The six abilities, in the order the rules list them
 */
export const PF1E_ABILITIES = [
	'strength',
	'dexterity',
	'constitution',
	'intelligence',
	'wisdom',
	'charisma'
] as const;

export type Pf1eAbility = typeof PF1E_ABILITIES[number];

/**
 * A score, or a modifier, for each ability
 */
export type Pf1eAbilityScores = Record<Pf1eAbility, number>;

/**
 * Each ability's name
 */
export const PF1E_ABILITY_NAMES: Record<Pf1eAbility, MessageDescriptor> = defineMessages({
	strength: {
		id: 'pf1e.ability.strength',
		defaultMessage: 'Strength',
		description: 'Name of a character\'s ability score in Pathfinder: physical power'
	},
	dexterity: {
		id: 'pf1e.ability.dexterity',
		defaultMessage: 'Dexterity',
		description: 'Name of a character\'s ability score in Pathfinder: agility and reflexes'
	},
	constitution: {
		id: 'pf1e.ability.constitution',
		defaultMessage: 'Constitution',
		description: 'Name of a character\'s ability score in Pathfinder: health and stamina'
	},
	intelligence: {
		id: 'pf1e.ability.intelligence',
		defaultMessage: 'Intelligence',
		description: 'Name of a character\'s ability score in Pathfinder: learning and reasoning'
	},
	wisdom: {
		id: 'pf1e.ability.wisdom',
		defaultMessage: 'Wisdom',
		description: 'Name of a character\'s ability score in Pathfinder: willpower, common sense and perception'
	},
	charisma: {
		id: 'pf1e.ability.charisma',
		defaultMessage: 'Charisma',
		description: 'Name of a character\'s ability score in Pathfinder: force of personality'
	}
});

/**
 * The modifier an ability score gives: +0 for 10 or 11, one more for every 2 points above and one less for
 * every 2 points below
 *
 * @param score The ability score
 * @return The modifier
 */
export function pf1eAbilityModifier(score: number): number
{
	return(Math.floor((score - 10) / 2));
}

/**
 * Scores of 0 for every ability, to start a set of modifiers from
 *
 * @return A new set of scores, all 0
 */
export function emptyPf1eAbilityScores(): Pf1eAbilityScores
{
	return({
		strength: 0,
		dexterity: 0,
		constitution: 0,
		intelligence: 0,
		wisdom: 0,
		charisma: 0
	});
}
