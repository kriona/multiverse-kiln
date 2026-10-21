import assert from 'assert';
import { emptySf1eAbilityScores, NEW_PF1E_RACE_RULES, pf1eRaceRules, PF1E_RACES, SF1E_RACES, SF1E_THEMES, sf1eRaceRules, type Pf1eAbilityScores, type Sf1eAbilityScores } from '@multiverse-kiln/shared';

import { abilityBonuses, areValidBaseScores, combineStartingItems, finalAbilityScores, isValidFloatingAbility } from '../../src/logic/characterCreation.js';

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

// 6 + 0 + 4 + 0 + 0 + 0 = 10 ability points
const sf1eBuy: Sf1eAbilityScores = {
	strength: 16,
	dexterity: 10,
	constitution: 14,
	intelligence: 10,
	wisdom: 10,
	charisma: 10
};

const noBonuses = emptySf1eAbilityScores();

describe('areValidBaseScores', () =>
{
	it('accepts the rolled scores in any order', () =>
	{
		assert.strictEqual(areValidBaseScores(arranged, { kind: 'roll', rolls }, noBonuses), true);
	});

	it('refuses scores that weren\'t rolled', () =>
	{
		assert.strictEqual(areValidBaseScores({ ...arranged, charisma: 18 }, { kind: 'roll', rolls }, noBonuses), false);
	});

	it('refuses a rolled score used twice', () =>
	{
		assert.strictEqual(areValidBaseScores({ ...arranged, charisma: 17 }, { kind: 'roll', rolls }, noBonuses), false);
	});

	it('accepts point buy within the budget, and refuses it over', () =>
	{
		assert.strictEqual(areValidBaseScores(standardBuy, { kind: 'pointBuy', budget: 15 }, noBonuses), true);
		assert.strictEqual(areValidBaseScores(standardBuy, { kind: 'pointBuy', budget: 14 }, noBonuses), false);
	});

	it('refuses point buy scores outside 7 to 18', () =>
	{
		assert.strictEqual(areValidBaseScores({ ...standardBuy, charisma: 6 }, { kind: 'pointBuy', budget: 102 }, noBonuses), false);
		assert.strictEqual(areValidBaseScores({ ...standardBuy, charisma: 19 }, { kind: 'pointBuy', budget: 102 }, noBonuses), false);
	});

	it('accepts ability points within the points, and refuses them over', () =>
	{
		assert.strictEqual(areValidBaseScores(sf1eBuy, { kind: 'abilityPoints', points: 10 }, noBonuses), true);
		assert.strictEqual(areValidBaseScores(sf1eBuy, { kind: 'abilityPoints', points: 9 }, noBonuses), false);
	});

	it('refuses ability points that raise a score past 18 with its bonuses', () =>
	{
		const bonuses = {
			...noBonuses,
			strength: 3
		};

		assert.strictEqual(areValidBaseScores({ ...sf1eBuy, strength: 15 }, { kind: 'abilityPoints', points: 10 }, bonuses), true);
		assert.strictEqual(areValidBaseScores(sf1eBuy, { kind: 'abilityPoints', points: 10 }, bonuses), false);
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

describe('abilityBonuses and finalAbilityScores', () =>
{
	it('adds the race\'s modifiers', () =>
	{
		const scores = finalAbilityScores('pf1e', arranged, abilityBonuses('pf1e', pf1eRaceRules(PF1E_RACES.dwarf), null, null));

		assert.deepStrictEqual(scores, {
			...arranged,
			constitution: 15,
			wisdom: 12,
			charisma: 7
		});
	});

	it('adds the floating bonus to the chosen ability', () =>
	{
		const scores = finalAbilityScores('pf1e', arranged, abilityBonuses('pf1e', pf1eRaceRules(PF1E_RACES.human), 'intelligence', null));

		assert.deepStrictEqual(scores, {
			...arranged,
			intelligence: 14
		});
	});

	it('ignores a floating ability for a race without the bonus', () =>
	{
		assert.deepStrictEqual(finalAbilityScores('pf1e', arranged, abilityBonuses('pf1e', NEW_PF1E_RACE_RULES, 'strength', null)), arranged);
	});

	it('adds a Starfinder theme\'s bonus on top of the race\'s', () =>
	{
		const bonuses = abilityBonuses('sf1e', sf1eRaceRules(SF1E_RACES.vesk), null, SF1E_THEMES.mercenary);

		assert.deepStrictEqual(bonuses, {
			...noBonuses,
			strength: 3,
			constitution: 2,
			intelligence: -2
		});
		assert.deepStrictEqual(finalAbilityScores('sf1e', sf1eBuy, bonuses), {
			...sf1eBuy,
			strength: 19,
			constitution: 16,
			intelligence: 8
		});
	});

	it('leaves the base scores as they were', () =>
	{
		const before = { ...arranged };

		finalAbilityScores('pf1e', arranged, abilityBonuses('pf1e', pf1eRaceRules(PF1E_RACES.dwarf), null, null));
		assert.deepStrictEqual(arranged, before);
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
