import assert from 'assert';

import { RateLimiter } from '../src/rooms/rateLimiter.js';

describe('RateLimiter', () =>
{
	it('allows up to the limit in one window', () =>
	{
		const limiter = new RateLimiter(2, 1000, () => 0);

		assert.strictEqual(limiter.tryTake('a'), true);
		assert.strictEqual(limiter.tryTake('a'), true);
		assert.strictEqual(limiter.tryTake('a'), false);
	});

	it('counts each key separately', () =>
	{
		const limiter = new RateLimiter(1, 1000, () => 0);

		assert.strictEqual(limiter.tryTake('a'), true);
		assert.strictEqual(limiter.tryTake('b'), true);
	});

	it('allows more once the earlier events are out of the window', () =>
	{
		let now = 0;
		const limiter = new RateLimiter(2, 1000, () => now);

		limiter.tryTake('a');
		now = 500;
		limiter.tryTake('a');
		now = 999;

		assert.strictEqual(limiter.tryTake('a'), false);

		now = 1000;

		assert.strictEqual(limiter.tryTake('a'), true);
		assert.strictEqual(limiter.tryTake('a'), false);
	});

	it('starts a key over once forgotten', () =>
	{
		const limiter = new RateLimiter(1, 1000, () => 0);

		limiter.tryTake('a');
		limiter.forget('a');

		assert.strictEqual(limiter.tryTake('a'), true);
	});
});
