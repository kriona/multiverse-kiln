import assert from 'assert';
import { emptyMoney, emptySf1eAbilityScores, isRulesetMoney, isValidSf1eAbilityBuy, moneyText, parseMoney, SF1E_ABILITIES, SF1E_MAX_ABILITY_POINTS, SF1E_RACES, sf1eAbilityModifier, sf1eAbilityPointsSpent, sf1eOverraisedAbilities, sf1eRaceRules, type Sf1eAbilityScores } from '@multiverse-kiln/shared';

/**
 * Ability scores with every ability at the same score
 *
 * @param score The score
 * @return The scores
 */
function allScores(score: number): Sf1eAbilityScores
{
	return(Object.fromEntries(SF1E_ABILITIES.map((ability) => [ability, score])) as Sf1eAbilityScores);
}

describe('Starfinder 1E rules', () =>
{
	describe('ability points', () =>
	{
		it('counts one point for each point a score is above 10', () =>
		{
			assert.strictEqual(sf1eAbilityPointsSpent(allScores(10)), 0);
			assert.strictEqual(sf1eAbilityPointsSpent({ ...allScores(10), strength: 14, wisdom: 16 }), 10);
			assert.strictEqual(sf1eAbilityPointsSpent(allScores(18)), SF1E_MAX_ABILITY_POINTS);
		});

		it('refuses base scores below 10 or above 18', () =>
		{
			assert.strictEqual(sf1eAbilityPointsSpent({ ...allScores(10), strength: 9 }), null);
			assert.strictEqual(sf1eAbilityPointsSpent({ ...allScores(10), strength: 19 }), null);
			assert.strictEqual(sf1eAbilityPointsSpent({ ...allScores(10), strength: 12.5 }), null);
		});

		it('allows spending up to the points, leaving some unspent', () =>
		{
			const bonuses = emptySf1eAbilityScores();

			assert.strictEqual(isValidSf1eAbilityBuy({ ...allScores(10), dexterity: 16, constitution: 14 }, bonuses, 10), true);
			assert.strictEqual(isValidSf1eAbilityBuy({ ...allScores(10), dexterity: 15 }, bonuses, 10), true);
			assert.strictEqual(isValidSf1eAbilityBuy({ ...allScores(10), dexterity: 16, constitution: 15 }, bonuses, 10), false);
		});

		it('stops points raising a score above 18 with its bonuses, but not bonuses alone', () =>
		{
			const bonuses = {
				...emptySf1eAbilityScores(),
				strength: 3,
				wisdom: 9
			};

			assert.deepStrictEqual(sf1eOverraisedAbilities({ ...allScores(10), strength: 15 }, bonuses), []);
			assert.deepStrictEqual(sf1eOverraisedAbilities({ ...allScores(10), strength: 16 }, bonuses), ['strength']);
			assert.deepStrictEqual(sf1eOverraisedAbilities(allScores(10), bonuses), []);
			assert.strictEqual(isValidSf1eAbilityBuy({ ...allScores(10), strength: 16 }, bonuses, 10), false);
		});
	});

	it('gives ability modifiers the way Pathfinder does', () =>
	{
		assert.strictEqual(sf1eAbilityModifier(10), 0);
		assert.strictEqual(sf1eAbilityModifier(11), 0);
		assert.strictEqual(sf1eAbilityModifier(18), 4);
		assert.strictEqual(sf1eAbilityModifier(7), -2);
	});

	it('fills in +0 for the abilities a default race leaves out', () =>
	{
		assert.deepStrictEqual(sf1eRaceRules(SF1E_RACES.ysoki).abilityModifiers, {
			...emptySf1eAbilityScores(),
			dexterity: 2,
			intelligence: 2,
			strength: -2
		});
	});

	describe('credits', () =>
	{
		const english = { cr: ['cr'] };

		it('reads and writes credits', () =>
		{
			assert.deepStrictEqual(parseMoney('250cr', 'sf1e', english), { money: { ...emptyMoney(), cr: 250 } });
			assert.deepStrictEqual(parseMoney('100 cr, 50cr', 'sf1e', english), { money: { ...emptyMoney(), cr: 150 } });
			assert.strictEqual(moneyText({ ...emptyMoney(), cr: 250 }, 'sf1e', { cr: 'cr' }), '250cr');
			assert.strictEqual(moneyText(emptyMoney(), 'sf1e', { cr: 'cr' }), '0cr');
		});

		it('refuses Pathfinder coins, even with their abbreviations given', () =>
		{
			assert.deepStrictEqual(parseMoney('2gp', 'sf1e', { ...english, gp: ['gp'] }), { error: 'format' });
		});

		it('tells whether an amount holds only a ruleset\'s coins', () =>
		{
			assert.strictEqual(isRulesetMoney({ ...emptyMoney(), cr: 5 }, 'sf1e'), true);
			assert.strictEqual(isRulesetMoney({ ...emptyMoney(), cr: 5 }, 'pf1e'), false);
			assert.strictEqual(isRulesetMoney({ ...emptyMoney(), gp: 5 }, 'sf1e'), false);
			assert.strictEqual(isRulesetMoney(emptyMoney(), 'sf1e'), true);
		});
	});
});
