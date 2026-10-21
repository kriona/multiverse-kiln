import assert from 'assert';
import { isArrangementOfRolls, rollDie, rollPf1eAbilityScore, rollPf1eAbilityScores, type RandomSource } from '../../src/logic/abilityRolls.js';

/**
 * A random source that makes six-sided dice show the given faces, in order
 *
 * @param faces The faces to roll, each 1 to 6
 * @return The random source; it fails the test if more dice are rolled than faces given
 */
function dice(...faces: number[]): RandomSource
{
	let next = 0;

	return(() =>
	{
		assert.ok(next < faces.length, 'rolled more dice than expected');

		const face = faces[next++];

		// The middle of the face's sixth of the range
		return((face - 0.5) / 6);
	});
}

describe('ability rolls', () =>
{
	describe('rollDie', () =>
	{
		it('maps the random source onto the die\'s faces', () =>
		{
			assert.strictEqual(rollDie(6, () => 0), 1);
			assert.strictEqual(rollDie(6, () => 0.999999), 6);
			assert.strictEqual(rollDie(20, () => 0.5), 11);
		});
	});

	describe('rollPf1eAbilityScore', () =>
	{
		it('adds up three dice for 3d6', () =>
		{
			assert.strictEqual(rollPf1eAbilityScore('roll_3d6', dice(1, 4, 6)), 11);
		});

		it('rolls each 1 again, as often as it takes, for 3d6 reroll 1s', () =>
		{
			assert.strictEqual(rollPf1eAbilityScore('roll_3d6_reroll_ones', dice(1, 1, 3, 5, 1, 2)), 10);
		});

		it('drops the lowest of four dice for 4d6 drop lowest', () =>
		{
			assert.strictEqual(rollPf1eAbilityScore('roll_4d6_drop_lowest', dice(2, 6, 1, 5)), 13);
		});

		it('rerolls 1s before dropping the lowest for 4d6 reroll 1s drop lowest', () =>
		{
			assert.strictEqual(rollPf1eAbilityScore('roll_4d6_reroll_ones_drop_lowest', dice(1, 2, 3, 3, 4)), 10);
		});

		it('stays within each method\'s range', () =>
		{
			for (let roll = 0; roll < 200; roll++)
			{
				const score = rollPf1eAbilityScore('roll_4d6_reroll_ones_drop_lowest', Math.random);

				assert.ok((score >= 6) && (score <= 18), String(score));
			}
		});
	});

	describe('rollPf1eAbilityScores', () =>
	{
		it('rolls one score per ability', () =>
		{
			assert.deepStrictEqual(rollPf1eAbilityScores('roll_3d6', dice(1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6)), [3, 6, 9, 12, 15, 18]);
		});
	});

	describe('isArrangementOfRolls', () =>
	{
		const rolled = [12, 15, 9, 15, 10, 8];

		it('accepts the rolled scores in any order', () =>
		{
			assert.ok(isArrangementOfRolls(rolled, {
				strength: 15,
				dexterity: 8,
				constitution: 15,
				intelligence: 10,
				wisdom: 9,
				charisma: 12
			}));
		});

		it('refuses a score that wasn\'t rolled, or one rolled score used twice', () =>
		{
			assert.ok(!isArrangementOfRolls(rolled, {
				strength: 18,
				dexterity: 8,
				constitution: 15,
				intelligence: 10,
				wisdom: 9,
				charisma: 12
			}));
			assert.ok(!isArrangementOfRolls(rolled, {
				strength: 15,
				dexterity: 15,
				constitution: 15,
				intelligence: 10,
				wisdom: 9,
				charisma: 12
			}));
		});
	});
});
