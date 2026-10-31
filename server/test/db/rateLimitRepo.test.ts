import assert from 'assert';

import { hashAddress, keyedHash } from '../../src/auth/keyedHashes.js';
import { deleteRateLimitEventsBefore, findRateLimitTimes, lockRateLimitSubject, recordRateLimitEvent } from '../../src/db/rateLimitRepo.js';
import { inTransaction } from '../../src/db/transactions.js';

const NOW = new Date('2026-10-29T12:00:00Z');
const ADDRESS = hashAddress('ada@example.com');
const NETWORK = keyedHash('network', '192.0.2.1');

/**
 * A time some seconds before NOW
 *
 * @param seconds How many seconds before
 * @return The time
 */
function secondsAgo(seconds: number): Date
{
	return(new Date(NOW.getTime() - (seconds * 1000)));
}

describe('rateLimitRepo', () =>
{
	it('finds a subject\'s attempts of a kind within a window, oldest first', async () =>
	{
		await recordRateLimitEvent('addressCodeSent', ADDRESS, secondsAgo(10));
		await recordRateLimitEvent('addressCodeSent', ADDRESS, secondsAgo(4000));
		await recordRateLimitEvent('addressCodeSent', ADDRESS, secondsAgo(100));
		await recordRateLimitEvent('addressWrongGuess', ADDRESS, secondsAgo(20));
		await recordRateLimitEvent('addressCodeSent', hashAddress('grace@example.com'), secondsAgo(30));

		assert.deepStrictEqual(await findRateLimitTimes('addressCodeSent', ADDRESS, secondsAgo(3600)), [secondsAgo(100), secondsAgo(10)]);
	});

	it('counts attempts made at once one after another under the lock', async () =>
	{
		const limit = 3;

		// Each attempt counts what is recorded and records itself only while under the limit
		const attempt = (): Promise<boolean> => inTransaction(async (executor) =>
		{
			await lockRateLimitSubject(NETWORK, executor);

			const times = await findRateLimitTimes('networkGuess', NETWORK, secondsAgo(3600), executor);

			if (times.length >= limit)
			{
				return(false);
			}

			await recordRateLimitEvent('networkGuess', NETWORK, NOW, executor);

			return(true);
		});
		const results = await Promise.all(Array.from({ length: 8 }, attempt));

		assert.strictEqual(results.filter((allowed) => allowed).length, limit);
		assert.strictEqual((await findRateLimitTimes('networkGuess', NETWORK, secondsAgo(3600))).length, limit);
	});

	it('deletes old attempts of the kinds given', async () =>
	{
		await recordRateLimitEvent('networkGuess', NETWORK, secondsAgo(4000));
		await recordRateLimitEvent('networkGuess', NETWORK, secondsAgo(10));
		await recordRateLimitEvent('addressWrongGuess', ADDRESS, secondsAgo(4000));

		assert.strictEqual(await deleteRateLimitEventsBefore(['networkGuess'], secondsAgo(3600)), 1);
		assert.strictEqual((await findRateLimitTimes('networkGuess', NETWORK, secondsAgo(86400))).length, 1);
		assert.strictEqual((await findRateLimitTimes('addressWrongGuess', ADDRESS, secondsAgo(86400))).length, 1);
	});
});
