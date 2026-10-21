import assert from 'assert';
import { NEW_PF1E_RACE_RULES, pf1eRaceRules, PF1E_MAX_COINS, PF1E_RACES, type Pf1eAbilityScores } from '@multiverse-kiln/shared';

import { areValidBaseScores, combineStartingItems, combineStartingMoney, finalPf1eAbilityScores, isValidFloatingAbility } from '../../src/logic/characterCreation.js';

const rolls = [15, 12, 9, 17, 10, 13];

const arranged: Pf1eAbilityScores = {
	strength: 17,
	dexterity: 15,
	constitution: 13,
	intelligence: 12,
	wisdom: 10,
	charisma: 9
};

// 7 + 5 + 2 + 0 + 0 + 1 = 15 points
const standardBuy: Pf1eAbilityScores = {
	strength: 15,
	dexterity: 14,
	constitution: 12,
	intelligence: 10,
	wisdom: 10,
	charisma: 11
};

describe('areValidBaseScores', () =>
{
	it('accepts the rolled scores in any order', () =>
	{
		assert.strictEqual(areValidBaseScores(arranged, { kind: 'roll', rolls }), true);
	});

	it('refuses scores that weren\'t rolled', () =>
	{
		assert.strictEqual(areValidBaseScores({ ...arranged, charisma: 18 }, { kind: 'roll', rolls }), false);
	});

	it('refuses a rolled score used twice', () =>
	{
		assert.strictEqual(areValidBaseScores({ ...arranged, charisma: 17 }, { kind: 'roll', rolls }), false);
	});

	it('accepts point buy within the budget, and refuses it over', () =>
	{
		assert.strictEqual(areValidBaseScores(standardBuy, { kind: 'pointBuy', budget: 15 }), true);
		assert.strictEqual(areValidBaseScores(standardBuy, { kind: 'pointBuy', budget: 14 }), false);
	});

	it('refuses point buy scores outside 7 to 18', () =>
	{
		assert.strictEqual(areValidBaseScores({ ...standardBuy, charisma: 6 }, { kind: 'pointBuy', budget: 102 }), false);
		assert.strictEqual(areValidBaseScores({ ...standardBuy, charisma: 19 }, { kind: 'pointBuy', budget: 102 }), false);
	});
});

describe('isValidFloatingAbility', () =>
{
	it('needs an ability for a race with a floating bonus', () =>
	{
		const human = pf1eRaceRules(PF1E_RACES.human);

		assert.strictEqual(isValidFloatingAbility(human, 'wisdom'), true);
		assert.strictEqual(isValidFloatingAbility(human, null), false);
	});

	it('refuses an ability for a race without one', () =>
	{
		const dwarf = pf1eRaceRules(PF1E_RACES.dwarf);

		assert.strictEqual(isValidFloatingAbility(dwarf, null), true);
		assert.strictEqual(isValidFloatingAbility(dwarf, 'wisdom'), false);
	});
});

describe('finalPf1eAbilityScores', () =>
{
	it('adds the race\'s modifiers', () =>
	{
		const scores = finalPf1eAbilityScores(arranged, pf1eRaceRules(PF1E_RACES.dwarf), null);

		assert.deepStrictEqual(scores, {
			...arranged,
			constitution: 15,
			wisdom: 12,
			charisma: 7
		});
	});

	it('adds the floating bonus to the chosen ability', () =>
	{
		const scores = finalPf1eAbilityScores(arranged, pf1eRaceRules(PF1E_RACES.human), 'intelligence');

		assert.deepStrictEqual(scores, {
			...arranged,
			intelligence: 14
		});
	});

	it('ignores a floating ability for a race without the bonus', () =>
	{
		assert.deepStrictEqual(finalPf1eAbilityScores(arranged, NEW_PF1E_RACE_RULES, 'strength'), arranged);
	});

	it('leaves the base scores as they were', () =>
	{
		const before = { ...arranged };

		finalPf1eAbilityScores(arranged, pf1eRaceRules(PF1E_RACES.dwarf), null);
		assert.deepStrictEqual(arranged, before);
	});
});

describe('combineStartingMoney', () =>
{
	it('adds the amounts coin by coin, without changing coins', () =>
	{
		const money = combineStartingMoney([
			{ pp: 0, gp: 10, sp: 5, cp: 0 },
			{ pp: 1, gp: 0, sp: 5, cp: 3 },
			{ pp: 0, gp: 2, sp: 0, cp: 0 }
		]);

		assert.deepStrictEqual(money, { pp: 1, gp: 12, sp: 10, cp: 3 });
	});

	it('caps each coin at the most a purse can hold', () =>
	{
		const full = { pp: PF1E_MAX_COINS, gp: 0, sp: 0, cp: 0 };

		assert.strictEqual(combineStartingMoney([full, full]).pp, PF1E_MAX_COINS);
	});

	it('is no money for no amounts', () =>
	{
		assert.deepStrictEqual(combineStartingMoney([]), { pp: 0, gp: 0, sp: 0, cp: 0 });
	});
});

describe('combineStartingItems', () =>
{
	it('adds up an item listed more than once, by item ID', () =>
	{
		const items = combineStartingItems([
			[{ itemId: 5, quantity: 1 }],
			[{ itemId: 2, quantity: 20 }, { itemId: 5, quantity: 2 }],
			[{ itemId: 2, quantity: 10 }]
		], new Set([2, 5]));

		assert.deepStrictEqual(items, [
			{ itemId: 2, quantity: 30 },
			{ itemId: 5, quantity: 3 }
		]);
	});

	it('leaves out items that aren\'t enabled', () =>
	{
		const items = combineStartingItems([[{ itemId: 5, quantity: 1 }, { itemId: 7, quantity: 1 }]], new Set([7]));

		assert.deepStrictEqual(items, [{ itemId: 7, quantity: 1 }]);
	});
});
