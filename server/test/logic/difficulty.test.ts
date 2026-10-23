import assert from 'assert';
import { MAX_MOB_SCALE, MIN_MOB_SCALE, MIN_SCALED_HIT_CHANCE } from '@multiverse-kiln/shared';

import { scaleHitChance, scaleMobHitPoints } from '../../src/logic/difficulty.js';

describe('difficulty', () =>
{
	describe('scaleMobHitPoints', () =>
	{
		it('leaves hit points alone at 0%', () =>
		{
			assert.strictEqual(scaleMobHitPoints(20, 0), 20);
		});

		it('scales hit points by the mob scale', () =>
		{
			assert.strictEqual(scaleMobHitPoints(20, 50), 30);
			assert.strictEqual(scaleMobHitPoints(20, 100), 40);
			assert.strictEqual(scaleMobHitPoints(20, -50), 10);
			assert.strictEqual(scaleMobHitPoints(20, MAX_MOB_SCALE), 220);
		});

		it('rounds to whole hit points', () =>
		{
			assert.strictEqual(scaleMobHitPoints(7, 50), 11);
			assert.strictEqual(scaleMobHitPoints(7, -50), 4);
		});

		it('never goes below 1', () =>
		{
			assert.strictEqual(scaleMobHitPoints(1, -50), 1);
			assert.strictEqual(scaleMobHitPoints(20, -100), 1);
			assert.strictEqual(scaleMobHitPoints(20, MIN_MOB_SCALE), 1);
			assert.strictEqual(scaleMobHitPoints(0, 0), 1);
		});
	});

	describe('scaleHitChance', () =>
	{
		it('leaves the chance alone at 0%', () =>
		{
			assert.strictEqual(scaleHitChance(55, 0, 'mob'), 55);
			assert.strictEqual(scaleHitChance(55, 0, 'character'), 55);
		});

		it('makes mobs hit more often when harder and less often when easier', () =>
		{
			assert.strictEqual(scaleHitChance(40, 50, 'mob'), 60);
			assert.strictEqual(scaleHitChance(40, -50, 'mob'), 20);
		});

		it('makes mobs harder to hit when harder and easier to hit when easier', () =>
		{
			assert.strictEqual(scaleHitChance(60, 50, 'character'), 40);
			assert.strictEqual(scaleHitChance(60, 100, 'character'), 30);
			assert.strictEqual(scaleHitChance(30, -50, 'character'), 60);
		});

		it('never goes above 100%', () =>
		{
			assert.strictEqual(scaleHitChance(80, 100, 'mob'), 100);
			assert.strictEqual(scaleHitChance(80, -50, 'character'), 100);
			assert.strictEqual(scaleHitChance(10, -100, 'character'), 100);
			assert.strictEqual(scaleHitChance(10, MIN_MOB_SCALE, 'character'), 100);
		});

		it('keeps a chance of at least 5% from dropping below 5%', () =>
		{
			assert.strictEqual(scaleHitChance(50, -100, 'mob'), MIN_SCALED_HIT_CHANCE);
			assert.strictEqual(scaleHitChance(50, MIN_MOB_SCALE, 'mob'), MIN_SCALED_HIT_CHANCE);
			assert.strictEqual(scaleHitChance(8, -50, 'mob'), MIN_SCALED_HIT_CHANCE);
			assert.strictEqual(scaleHitChance(50, MAX_MOB_SCALE, 'character'), MIN_SCALED_HIT_CHANCE);
			assert.strictEqual(scaleHitChance(MIN_SCALED_HIT_CHANCE, 50, 'character'), MIN_SCALED_HIT_CHANCE);
		});

		it('lets a chance under 5% drop lower', () =>
		{
			assert.strictEqual(scaleHitChance(4, -50, 'mob'), 2);
			assert.strictEqual(scaleHitChance(4, 100, 'character'), 2);
			assert.strictEqual(scaleHitChance(4, 50, 'mob'), 6);
		});

		it('never lets an attack that can\'t hit hit', () =>
		{
			assert.strictEqual(scaleHitChance(0, 100, 'mob'), 0);
			assert.strictEqual(scaleHitChance(0, -100, 'character'), 0);
		});
	});
});
