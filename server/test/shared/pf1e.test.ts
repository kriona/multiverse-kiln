import assert from 'assert';
import { formatPf1eMoney, isPf1eRollMethod, isValidPf1eMoney, isValidPf1ePointBuy, parsePf1eMoney, PF1E_MAX_MONEY, PF1E_MAX_POINT_BUY_BUDGET, PF1E_RACES, PF1E_STAT_METHODS, pf1eAbilityModifier, pf1ePointBuyBudget, pf1ePointBuyCost, pf1ePointBuyTotal, type Pf1eAbilityScores } from '@multiverse-kiln/shared';

const ENGLISH_COINS = {
	pp: ['pp'],
	gp: ['gp'],
	sp: ['sp'],
	cp: ['cp']
};

const ENGLISH_ABBREVIATIONS = {
	pp: 'pp',
	gp: 'gp',
	sp: 'sp',
	cp: 'cp'
};

/**
 * Ability scores with every ability at the same score
 *
 * @param score The score
 * @return The scores
 */
function allScores(score: number): Pf1eAbilityScores
{
	return({
		strength: score,
		dexterity: score,
		constitution: score,
		intelligence: score,
		wisdom: score,
		charisma: score
	});
}

describe('PF1E ruleset (shared)', () =>
{
	describe('pf1eAbilityModifier', () =>
	{
		it('gives +0 for 10 and 11, and changes by one every two points', () =>
		{
			assert.strictEqual(pf1eAbilityModifier(10), 0);
			assert.strictEqual(pf1eAbilityModifier(11), 0);
			assert.strictEqual(pf1eAbilityModifier(12), 1);
			assert.strictEqual(pf1eAbilityModifier(18), 4);
			assert.strictEqual(pf1eAbilityModifier(9), -1);
			assert.strictEqual(pf1eAbilityModifier(7), -2);
			assert.strictEqual(pf1eAbilityModifier(1), -5);
		});
	});

	describe('races', () =>
	{
		it('give a floating bonus only to races without fixed modifiers', () =>
		{
			for (const race of Object.values(PF1E_RACES))
			{
				assert.strictEqual(race.floatingBonus, (Object.keys(race.abilityModifiers).length === 0));
			}
		});
	});

	describe('point buy', () =>
	{
		it('costs what the Core Rulebook lists', () =>
		{
			const costs = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map((score) => pf1ePointBuyCost(score));

			assert.deepStrictEqual(costs, [-4, -2, -1, 0, 1, 2, 3, 5, 7, 10, 13, 17]);
		});

		it('can\'t choose scores below 7, above 18 or between whole numbers', () =>
		{
			assert.strictEqual(pf1ePointBuyCost(6), null);
			assert.strictEqual(pf1ePointBuyCost(19), null);
			assert.strictEqual(pf1ePointBuyCost(10.5), null);
			assert.strictEqual(pf1ePointBuyTotal({
				...allScores(10),
				wisdom: 19
			}), null);
		});

		it('adds up the cost of every score', () =>
		{
			assert.strictEqual(pf1ePointBuyTotal(allScores(10)), 0);
			assert.strictEqual(pf1ePointBuyTotal({
				strength: 16,
				dexterity: 14,
				constitution: 14,
				intelligence: 10,
				wisdom: 8,
				charisma: 7
			}), 10 + 5 + 5 + 0 - 2 - 4);
		});

		it('allows spending up to the budget, and leaving points unspent', () =>
		{
			const fifteen: Pf1eAbilityScores = {
				strength: 16,
				dexterity: 14,
				constitution: 10,
				intelligence: 10,
				wisdom: 10,
				charisma: 10
			};

			assert.ok(isValidPf1ePointBuy(fifteen, 15));
			assert.ok(isValidPf1ePointBuy(fifteen, 20));
			assert.ok(!isValidPf1ePointBuy(fifteen, 14));
		});

		it('allows a custom budget that buys every score at 18', () =>
		{
			assert.ok(isValidPf1ePointBuy(allScores(18), PF1E_MAX_POINT_BUY_BUDGET));
			assert.strictEqual(PF1E_MAX_POINT_BUY_BUDGET, 102);
		});

		it('takes each method\'s budget, or the universe\'s for a custom budget', () =>
		{
			assert.strictEqual(pf1ePointBuyBudget('point_buy_low_fantasy', 40), 10);
			assert.strictEqual(pf1ePointBuyBudget('point_buy_epic_fantasy', 40), 25);
			assert.strictEqual(pf1ePointBuyBudget('point_buy_custom', 40), 40);
		});

		it('tells rolling methods from point buy', () =>
		{
			const rolling = PF1E_STAT_METHODS.filter((method) => isPf1eRollMethod(method));

			assert.deepStrictEqual(rolling, ['roll_3d6', 'roll_3d6_reroll_ones', 'roll_4d6_drop_lowest', 'roll_4d6_reroll_ones_drop_lowest']);
		});
	});

	describe('money', () =>
	{
		it('reads coins in any order, with or without spaces and commas', () =>
		{
			assert.deepStrictEqual(parsePf1eMoney('1pp 2gp 2sp 4cp', ENGLISH_COINS), { copper: 1224 });
			assert.deepStrictEqual(parsePf1eMoney('4cp, 2 sp,1pp  2gp ', ENGLISH_COINS), { copper: 1224 });
			assert.deepStrictEqual(parsePf1eMoney('5gp3sp', ENGLISH_COINS), { copper: 530 });
		});

		it('ignores capitals in the abbreviations', () =>
		{
			assert.deepStrictEqual(parsePf1eMoney('3GP 1Sp', ENGLISH_COINS), { copper: 310 });
		});

		it('adds up a coin written twice', () =>
		{
			assert.deepStrictEqual(parsePf1eMoney('2gp 3gp', ENGLISH_COINS), { copper: 500 });
		});

		it('reads an empty field as no money', () =>
		{
			assert.deepStrictEqual(parsePf1eMoney('', ENGLISH_COINS), { copper: 0 });
			assert.deepStrictEqual(parsePf1eMoney('   ', ENGLISH_COINS), { copper: 0 });
		});

		it('accepts every abbreviation it is given for a coin', () =>
		{
			const withPirate = {
				...ENGLISH_COINS,
				gp: ['gp', 'doubloons']
			};

			assert.deepStrictEqual(parsePf1eMoney('2 doubloons 1gp', withPirate), { copper: 300 });
		});

		it('refuses numbers without a coin, unknown coins and amounts that aren\'t whole', () =>
		{
			assert.deepStrictEqual(parsePf1eMoney('12', ENGLISH_COINS), { error: 'format' });
			assert.deepStrictEqual(parsePf1eMoney('12gp 5', ENGLISH_COINS), { error: 'format' });
			assert.deepStrictEqual(parsePf1eMoney('2 gold', ENGLISH_COINS), { error: 'format' });
			assert.deepStrictEqual(parsePf1eMoney('gp', ENGLISH_COINS), { error: 'format' });
			assert.deepStrictEqual(parsePf1eMoney('-2gp', ENGLISH_COINS), { error: 'format' });
			assert.deepStrictEqual(parsePf1eMoney('1.5gp', ENGLISH_COINS), { error: 'format' });
		});

		it('refuses more than the most money there can be', () =>
		{
			assert.deepStrictEqual(parsePf1eMoney('10000000gp', ENGLISH_COINS), { copper: PF1E_MAX_MONEY });
			assert.deepStrictEqual(parsePf1eMoney('10000000gp 1cp', ENGLISH_COINS), { error: 'tooMuch' });
			assert.deepStrictEqual(parsePf1eMoney('99999999999999999999pp', ENGLISH_COINS), { error: 'tooMuch' });
		});

		it('writes amounts in gold, silver and copper, leaving out coins there are none of', () =>
		{
			assert.strictEqual(formatPf1eMoney(1224, ENGLISH_ABBREVIATIONS), '12gp 2sp 4cp');
			assert.strictEqual(formatPf1eMoney(1500, ENGLISH_ABBREVIATIONS), '15gp');
			assert.strictEqual(formatPf1eMoney(7, ENGLISH_ABBREVIATIONS), '7cp');
			assert.strictEqual(formatPf1eMoney(0, ENGLISH_ABBREVIATIONS), '0gp');
		});

		it('reads back what it writes', () =>
		{
			for (const copper of [0, 1, 99, 1224, 31415, PF1E_MAX_MONEY])
			{
				assert.deepStrictEqual(parsePf1eMoney(formatPf1eMoney(copper, ENGLISH_ABBREVIATIONS), ENGLISH_COINS), { copper });
			}
		});

		it('validates amounts from untrusted input', () =>
		{
			assert.ok(isValidPf1eMoney(0));
			assert.ok(isValidPf1eMoney(PF1E_MAX_MONEY));
			assert.ok(!isValidPf1eMoney(-1));
			assert.ok(!isValidPf1eMoney(PF1E_MAX_MONEY + 1));
			assert.ok(!isValidPf1eMoney(1.5));
			assert.ok(!isValidPf1eMoney('100'));
			assert.ok(!isValidPf1eMoney(null));
		});
	});
});
