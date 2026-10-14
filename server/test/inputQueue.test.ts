import assert from 'assert';

import { InputQueue } from '../src/rooms/inputQueue.js';

describe('InputQueue', () =>
{
	it('drains inputs in the order they arrived', () =>
	{
		const queue = new InputQueue<number>(8);

		queue.push('a', 1);
		queue.push('a', 2);
		queue.push('a', 3);

		assert.deepStrictEqual(queue.drain('a'), [1, 2, 3]);
	});

	it('is empty after draining', () =>
	{
		const queue = new InputQueue<number>(8);

		queue.push('a', 1);
		queue.drain('a');

		assert.deepStrictEqual(queue.drain('a'), []);
	});

	it('keeps each player separate', () =>
	{
		const queue = new InputQueue<number>(8);

		queue.push('a', 1);
		queue.push('b', 2);

		assert.deepStrictEqual(queue.drain('a'), [1]);
		assert.deepStrictEqual(queue.drain('b'), [2]);
	});

	it('drops the oldest input when full', () =>
	{
		const queue = new InputQueue<number>(2);

		queue.push('a', 1);
		queue.push('a', 2);
		queue.push('a', 3);

		assert.deepStrictEqual(queue.drain('a'), [2, 3]);
	});

	it('discards a removed player', () =>
	{
		const queue = new InputQueue<number>(8);

		queue.push('a', 1);
		queue.remove('a');

		assert.deepStrictEqual(queue.drain('a'), []);
	});
});
