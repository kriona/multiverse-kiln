/**
 * Rolling Pathfinder 1E ability scores (see STRUCTURE-OVERVIEW.md, Tab: Ruleset)
 *
 * The server rolls six scores, and the player arranges them among the abilities. The random source is
 * passed in, so tests can choose the dice
 */
import { PF1E_ABILITIES, type Pf1eAbilityScores, type Pf1eRollMethod } from '@multiverse-kiln/shared';

/**
 * Gives a number from 0 up to but not including 1, like Math.random()
 */
export type RandomSource = () => number;

/**
 * Rolls one die
 *
 * @param sides How many sides the die has
 * @param random Where the roll comes from
 * @return A number from 1 to sides
 */
export function rollDie(sides: number, random: RandomSource): number
{
	return(Math.floor(random() * sides) + 1);
}

/**
 * Rolls one six-sided die, rolling again while it shows a 1 when rerollOnes is set
 *
 * @param rerollOnes Whether a 1 is rolled again
 * @param random Where the rolls come from
 * @return A number from 1 to 6, or 2 to 6 when rerolling 1s
 */
function rollD6(rerollOnes: boolean, random: RandomSource): number
{
	let roll = rollDie(6, random);

	while (rerollOnes && (roll === 1))
	{
		roll = rollDie(6, random);
	}
	return(roll);
}

/**
 * Rolls one ability score
 *
 * @param method How to roll it
 * @param random Where the rolls come from
 * @return The score
 */
export function rollPf1eAbilityScore(method: Pf1eRollMethod, random: RandomSource): number
{
	const rerollOnes = ((method === 'roll_3d6_reroll_ones') || (method === 'roll_4d6_reroll_ones_drop_lowest'));
	const diceCount = (((method === 'roll_4d6_drop_lowest') || (method === 'roll_4d6_reroll_ones_drop_lowest')) ? 4 : 3);
	const rolls: number[] = [];

	for (let i = 0; i < diceCount; i++)
	{
		rolls.push(rollD6(rerollOnes, random));
	}

	// The highest three count
	return(rolls
		.sort((a, b) => (b - a))
		.slice(0, 3)
		.reduce((total, roll) => (total + roll), 0));
}

/**
 * Rolls a score for each ability, for the player to arrange
 *
 * @param method How to roll them
 * @param random Where the rolls come from
 * @return One score per ability, in the order they were rolled
 */
export function rollPf1eAbilityScores(method: Pf1eRollMethod, random: RandomSource): number[]
{
	return(PF1E_ABILITIES.map(() => rollPf1eAbilityScore(method, random)));
}

/**
 * Whether a player's arrangement of their rolled scores uses each rolled score exactly once
 *
 * @param rolled The scores the server rolled
 * @param arranged The score the player gave each ability
 * @return True when arranged is the rolled scores in some order
 */
export function isArrangementOfRolls(rolled: readonly number[], arranged: Pf1eAbilityScores): boolean
{
	const sortedRolls = [...rolled].sort((a, b) => (a - b));
	const sortedArranged = PF1E_ABILITIES
		.map((ability) => arranged[ability])
		.sort((a, b) => (a - b));

	return((sortedRolls.length === sortedArranged.length) && sortedRolls.every((score, index) => (score === sortedArranged[index])));
}
