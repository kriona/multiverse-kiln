import assert from 'assert';
import { WALK_SECONDS_PER_SQUARE } from '@multiverse-kiln/shared';

import { GroupClock, SIMULTANEOUS_STEP_MS, stepSeconds } from '../../src/logic/gameClock.js';

const east = {
	from: { column: 0, row: 0 },
	to: { column: 1, row: 0 }
};

const southeast = {
	from: { column: 0, row: 0 },
	to: { column: 1, row: 1 }
};

/**
 * Real milliseconds between steps of a member walking on grass: a step takes 0.15 seconds
 */
const STEP_MS = 150;

describe('game clock', () =>
{
	describe('stepSeconds', () =>
	{
		it('takes the walking time for a square with no movement cost', () =>
		{
			assert.strictEqual(stepSeconds(east, 0), WALK_SECONDS_PER_SQUARE);
		});

		it('takes twice as long into a cell with a movement cost of 50', () =>
		{
			assert.strictEqual(stepSeconds(east, 50), WALK_SECONDS_PER_SQUARE * 2);
		});

		it('counts a diagonal step as one and a half squares', () =>
		{
			assert.strictEqual(stepSeconds(southeast, 0), WALK_SECONDS_PER_SQUARE * 1.5);
		});

		it('counts a cell that can\'t be entered as having no movement cost', () =>
		{
			assert.strictEqual(stepSeconds(east, 100), WALK_SECONDS_PER_SQUARE);
		});
	});

	describe('GroupClock', () =>
	{
		it('moves on with every step one member takes', () =>
		{
			const clock = new GroupClock(100);

			assert.strictEqual(clock.walk('a', 5, 0), true);
			assert.strictEqual(clock.walk('a', 5, 10), true);
			assert.strictEqual(clock.seconds, 110);
		});

		it('passes the time of one when members walk side by side', () =>
		{
			const clock = new GroupClock(0);

			for (let step = 0; step < 10; step++)
			{
				clock.walk('a', 1, step * STEP_MS);
				clock.walk('b', 1, (step * STEP_MS) + 70);
				clock.walk('c', 1, (step * STEP_MS) + 100);
			}

			assert.strictEqual(clock.seconds, 10);
		});

		it('passes time for everyone while one member walks and the others stand still', () =>
		{
			const clock = new GroupClock(0);

			clock.walk('a', 1, 0);
			clock.walk('a', 1, STEP_MS);

			assert.strictEqual(clock.seconds, 2);
		});

		it('lets another member\'s steps keep the time once the first stops', () =>
		{
			const clock = new GroupClock(0);

			clock.walk('a', 1, 0);

			assert.strictEqual(clock.walk('b', 1, SIMULTANEOUS_STEP_MS - 1), false);
			assert.strictEqual(clock.walk('b', 1, SIMULTANEOUS_STEP_MS), true);
			assert.strictEqual(clock.walk('a', 1, SIMULTANEOUS_STEP_MS + 10), false);
			assert.strictEqual(clock.seconds, 2);
		});

		it('passes time for everyone at once', () =>
		{
			const clock = new GroupClock(0);

			clock.walk('a', 10, 0);
			clock.pass(6);

			assert.strictEqual(clock.seconds, 16);
		});
	});
});
