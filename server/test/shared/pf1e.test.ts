import assert from 'assert';
import { addMoney, changePf1eMoney, emptyMoney, emptyPf1eMoney, isPf1eRollMethod, isValidPf1ePointBuy, MAX_COINS, moneyText, parseMoney, PF1E_MAX_POINT_BUY_BUDGET, PF1E_RACES, PF1E_STAT_METHODS, pf1eAbilityModifier, pf1eMoneyValue, pf1ePointBuyBudget, pf1ePointBuyCost, pf1ePointBuyTotal, type CoinAbbreviations, type Money, type MoneyParseResult, type Pf1eAbilityScores, type Pf1eMoney } from '@multiverse-kiln/shared';

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
 * An amount of Pathfinder coins
 *
 * @param pp Platinum pieces
 * @param gp Gold pieces
 * @param sp Silver pieces
 * @param cp Copper pieces
 * @return The amount
 */
function pieces(pp: number, gp: number, sp: number, cp: number): Pf1eMoney
{
	return({ pp, gp, sp, cp });
}

/**
 * An amount of money in a Pathfinder universe, with no credits
 *
 * @param pp Platinum pieces
 * @param gp Gold pieces
 * @param sp Silver pieces
 * @param cp Copper pieces
 * @return The amount
 */
function coins(pp: number, gp: number, sp: number, cp: number): Money
{
	return({
		...pieces(pp, gp, sp, cp),
		cr: 0
	});
}

/**
 * Reads a Pathfinder money field
 *
 * @param text What the field holds
 * @param abbreviations The abbreviations to accept for each coin
 * @return The coins, or the problem with the text
 */
function readPf1e(text: string, abbreviations: CoinAbbreviations): MoneyParseResult
{
	return(parseMoney(text, 'pf1e', abbreviations));
}

/**
 * Writes an amount for a Pathfinder money field in English
 *
 * @param money The coins
 * @return The text
 */
function writePf1e(money: Money): string
{
	return(moneyText(money, 'pf1e', ENGLISH_ABBREVIATIONS));
}

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
			assert.deepStrictEqual(readPf1e('1pp 2gp 2sp 4cp', ENGLISH_COINS), { money: coins(1, 2, 2, 4) });
			assert.deepStrictEqual(readPf1e('4cp, 2 sp,1pp  2gp ', ENGLISH_COINS), { money: coins(1, 2, 2, 4) });
			assert.deepStrictEqual(readPf1e('5gp3sp', ENGLISH_COINS), { money: coins(0, 5, 3, 0) });
		});

		it('keeps coins as written, without changing them for others', () =>
		{
			assert.deepStrictEqual(readPf1e('1pp 302gp 4444sp 10cp', ENGLISH_COINS), { money: coins(1, 302, 4444, 10) });
			assert.deepStrictEqual(readPf1e('15sp', ENGLISH_COINS), { money: coins(0, 0, 15, 0) });
		});

		it('ignores capitals in the abbreviations', () =>
		{
			assert.deepStrictEqual(readPf1e('3GP 1Sp', ENGLISH_COINS), { money: coins(0, 3, 1, 0) });
		});

		it('adds up a coin written twice', () =>
		{
			assert.deepStrictEqual(readPf1e('2gp 3gp', ENGLISH_COINS), { money: coins(0, 5, 0, 0) });
		});

		it('reads an empty field as no money', () =>
		{
			assert.deepStrictEqual(readPf1e('', ENGLISH_COINS), { money: emptyMoney() });
			assert.deepStrictEqual(readPf1e('   ', ENGLISH_COINS), { money: emptyMoney() });
		});

		it('accepts every abbreviation it is given for a coin', () =>
		{
			const withPirate = {
				...ENGLISH_COINS,
				gp: ['gp', 'doubloons']
			};

			assert.deepStrictEqual(readPf1e('2 doubloons 1gp', withPirate), { money: coins(0, 3, 0, 0) });
		});

		it('refuses numbers without a coin, unknown coins and amounts that aren\'t whole', () =>
		{
			assert.deepStrictEqual(readPf1e('12', ENGLISH_COINS), { error: 'format' });
			assert.deepStrictEqual(readPf1e('12gp 5', ENGLISH_COINS), { error: 'format' });
			assert.deepStrictEqual(readPf1e('2 gold', ENGLISH_COINS), { error: 'format' });
			assert.deepStrictEqual(readPf1e('gp', ENGLISH_COINS), { error: 'format' });
			assert.deepStrictEqual(readPf1e('-2gp', ENGLISH_COINS), { error: 'format' });
			assert.deepStrictEqual(readPf1e('1.5gp', ENGLISH_COINS), { error: 'format' });
		});

		it('refuses more pieces of one coin than an amount can hold', () =>
		{
			assert.deepStrictEqual(readPf1e(`${MAX_COINS}gp ${MAX_COINS}sp`, ENGLISH_COINS), { money: coins(0, MAX_COINS, MAX_COINS, 0) });
			assert.deepStrictEqual(readPf1e(`${MAX_COINS}gp 1gp`, ENGLISH_COINS), { error: 'tooMuch' });
			assert.deepStrictEqual(readPf1e('99999999999999999999pp', ENGLISH_COINS), { error: 'tooMuch' });
		});

		it('writes each coin there is, most valuable first, leaving out coins there are none of', () =>
		{
			assert.strictEqual(writePf1e(coins(1, 302, 4444, 10)), '1pp 302gp 4444sp 10cp');
			assert.strictEqual(writePf1e(coins(0, 0, 15, 0)), '15sp');
			assert.strictEqual(writePf1e(emptyMoney()), '0gp');
		});

		it('reads back what it writes', () =>
		{
			for (const money of [emptyMoney(), coins(1, 2, 2, 4), coins(0, 0, 0, 7), coins(1, 302, 4444, 10), coins(MAX_COINS, 0, MAX_COINS, 0)])
			{
				assert.deepStrictEqual(readPf1e(writePf1e(money), ENGLISH_COINS), { money });
			}
		});

		it('adds amounts coin by coin, without changing coins for others', () =>
		{
			assert.deepStrictEqual(addMoney([coins(0, 1, 5, 0), coins(1, 0, 5, 3), coins(0, 2, 0, 0)]), coins(1, 3, 10, 3));
		});

		it('caps each coin at the most a purse can hold when adding', () =>
		{
			const full = coins(MAX_COINS, 0, 0, 0);

			assert.strictEqual(addMoney([full, full]).pp, MAX_COINS);
			assert.deepStrictEqual(addMoney([]), emptyMoney());
		});

		it('values an amount in copper pieces', () =>
		{
			assert.strictEqual(pf1eMoneyValue(pieces(1, 302, 4444, 10)), 75650);
			assert.strictEqual(pf1eMoneyValue(emptyPf1eMoney()), 0);
		});

		it('changes money into the fewest coins of the same worth, as a money changer does', () =>
		{
			assert.deepStrictEqual(changePf1eMoney(pieces(1, 302, 4444, 10)), pieces(75, 6, 5, 0));
			assert.deepStrictEqual(changePf1eMoney(pieces(0, 0, 0, 1234)), pieces(1, 2, 3, 4));
			assert.deepStrictEqual(changePf1eMoney(pieces(0, 0, 9, 9)), pieces(0, 0, 9, 9));
			assert.deepStrictEqual(changePf1eMoney(emptyPf1eMoney()), emptyPf1eMoney());
		});
	});
});
