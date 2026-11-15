import assert from 'assert';

import { watchQueries } from '../../scripts/benchmarks/queries.js';
import { keyedHash } from '../../src/auth/keyedHashes.js';
import { takeAttempt, takeCodeSend, takePasswordAttempt, type AttemptLimit, type PasswordAttemptSubjects } from '../../src/auth/rateLimits.js';
import { findRateLimitTimes, recordRateLimitEvent, type RateLimitKind } from '../../src/db/rateLimitRepo.js';
import { inTransaction } from '../../src/db/transactions.js';
import type { BotCheckState } from '../../src/logic/botChecks.js';
import { DAY_MS, HOUR_MS, MAX_EMAIL_CODES_PER_ADDRESS_HOUR } from '../../src/logic/emailCodes.js';

const NETWORK = keyedHash('network', 'network for tests');
const ADDRESS = keyedHash('address', 'ada@example.com');
const BROWSER = keyedHash('knownBrowser', 'browser for tests');

const ON: BotCheckState = {
	available: true,
	passed: false,
	checkEveryRequest: false
};

const PASSED: BotCheckState = {
	...ON,
	passed: true
};

/**
 * How many attempts of a kind a subject made in the past hour
 *
 * @param kind What is counted
 * @param subjectHash The subject
 * @return How many
 */
async function countOf(kind: RateLimitKind, subjectHash: Uint8Array): Promise<number>
{
	return((await findRateLimitTimes(kind, subjectHash, new Date(Date.now() - (24 * HOUR_MS)))).length);
}

/**
 * Records attempts some minutes ago
 *
 * @param kind What is counted
 * @param subjectHash The subject
 * @param count How many
 */
async function past(kind: RateLimitKind, subjectHash: Uint8Array, count: number): Promise<void>
{
	for (let attempt = 0; attempt < count; attempt++)
	{
		await recordRateLimitEvent(kind, subjectHash, new Date(Date.now() - (10 * 60 * 1000) - attempt));
	}
}

/**
 * How many times something reads the rate_limit_events table
 *
 * @param run What to watch
 * @return How many queries read it
 */
async function countReads(run: () => Promise<unknown>): Promise<number>
{
	const queries = watchQueries({ slowMs: 0 });

	try
	{
		await run();
	}
	finally
	{
		queries.restore();
	}

	return(queries.slowQueries.filter((query) => (query.text.startsWith('select') && query.text.includes('from "rate_limit_events"'))).length);
}

describe('rateLimits', () =>
{
	describe('takeAttempt', () =>
	{
		const now = new Date();
		const limits: AttemptLimit[] = [
			{
				kind: 'networkGuess',
				subjectHash: NETWORK,
				limit: 1
			},
			{
				kind: 'accountRoleEmail',
				subjectHash: BROWSER,
				limit: 1,
				windowMs: DAY_MS
			},
			{
				kind: 'networkUsernameCheck',
				subjectHash: null,
				limit: 1
			}
		];

		it('reads every limit\'s count in one query, each in its own window, and records the attempt against each known subject', async () =>
		{
			await recordRateLimitEvent('networkGuess', NETWORK, new Date(now.getTime() - (2 * HOUR_MS)));
			await recordRateLimitEvent('accountRoleEmail', BROWSER, new Date(now.getTime() - (25 * HOUR_MS)));

			const reads = await countReads(async () =>
			{
				assert.deepStrictEqual(await inTransaction((executor) => takeAttempt(limits, now, executor)), { allowed: true });
			});

			assert.strictEqual(reads, 1);
			assert.strictEqual(await countOf('networkGuess', NETWORK), 2);
			assert.strictEqual(await countOf('accountRoleEmail', BROWSER), 1);
		});

		it('refuses an attempt past any limit, counting it against none', async () =>
		{
			const sentAt = new Date(now.getTime() - (2 * HOUR_MS));

			await recordRateLimitEvent('accountRoleEmail', BROWSER, sentAt);

			assert.deepStrictEqual(await inTransaction((executor) => takeAttempt(limits, now, executor)), {
				allowed: false,
				retryAt: new Date(sentAt.getTime() + DAY_MS)
			});
			assert.strictEqual(await countOf('networkGuess', NETWORK), 0);
		});
	});

	describe('takePasswordAttempt', () =>
	{
		const login: PasswordAttemptSubjects = {
			source: 'login',
			networkHash: NETWORK,
			addressHash: ADDRESS
		};

		it('counts a try against the network and the address', async () =>
		{
			assert.deepStrictEqual(await inTransaction((executor) => takePasswordAttempt(login, ON, new Date(), executor)), { kind: 'allow' });
			assert.strictEqual(await countOf('networkLoginAttempt', NETWORK), 1);
			assert.strictEqual(await countOf('addressLoginAttempt', ADDRESS), 1);
		});

		it('counts a try refused for want of a check against the network only, and one refused against nothing', async () =>
		{
			await past('addressLoginAttempt', ADDRESS, 4);
			assert.deepStrictEqual(await inTransaction((executor) => takePasswordAttempt(login, ON, new Date(), executor)), { kind: 'checkNeeded' });
			assert.strictEqual(await countOf('networkLoginAttempt', NETWORK), 1);
			assert.strictEqual(await countOf('addressLoginAttempt', ADDRESS), 4);

			await past('addressLoginAttempt', ADDRESS, 6);
			assert.strictEqual((await inTransaction((executor) => takePasswordAttempt(login, { ...ON, available: false }, new Date(), executor))).kind, 'refused');
			assert.strictEqual(await countOf('networkLoginAttempt', NETWORK), 1);
		});

		it('counts a try with a check past the address\'s limit against the checked limit, not the address\'s own', async () =>
		{
			await past('addressLoginAttempt', ADDRESS, 10);
			assert.deepStrictEqual(await inTransaction((executor) => takePasswordAttempt(login, PASSED, new Date(), executor)), { kind: 'allowChecked' });
			assert.strictEqual(await countOf('addressLoginAttempt', ADDRESS), 10);
			assert.strictEqual(await countOf('addressCheckedLoginAttempt', ADDRESS), 1);
		});

		it('counts a known browser\'s try against the browser, not the address', async () =>
		{
			await inTransaction((executor) => takePasswordAttempt({
				...login,
				source: 'knownBrowser',
				browserHash: BROWSER
			}, ON, new Date(), executor));
			assert.strictEqual(await countOf('browserLoginAttempt', BROWSER), 1);
			assert.strictEqual(await countOf('addressLoginAttempt', ADDRESS), 0);
		});

		it('only decides, counting nothing, without a transaction', async () =>
		{
			await past('addressLoginAttempt', ADDRESS, 4);
			assert.deepStrictEqual(await takePasswordAttempt(login, ON, new Date(), undefined), { kind: 'checkNeeded' });
			assert.strictEqual(await countOf('networkLoginAttempt', NETWORK), 0);
		});

		it('counts tries sent at once one after another', async () =>
		{
			await Promise.all(Array.from({ length: 15 }, () => inTransaction((executor) => takePasswordAttempt(login, PASSED, new Date(), executor))));
			assert.strictEqual(await countOf('addressLoginAttempt', ADDRESS), 10);
			assert.strictEqual(await countOf('addressCheckedLoginAttempt', ADDRESS), 5);
		});

		it('reads the network\'s and the address\'s counts in one query while they are locked', async () =>
		{
			assert.strictEqual(await countReads(() => inTransaction((executor) => takePasswordAttempt(login, ON, new Date(), executor))), 1);
		});
	});

	describe('takeCodeSend', () =>
	{
		it('counts a code against the network and the address', async () =>
		{
			assert.deepStrictEqual(await inTransaction((executor) => takeCodeSend(NETWORK, ADDRESS, ON, new Date(), executor)), { kind: 'allow' });
			assert.strictEqual(await countOf('networkCodeRequest', NETWORK), 1);
			assert.strictEqual(await countOf('addressCodeSent', ADDRESS), 1);
		});

		it('counts a request refused by the address\'s limits or for want of a check against the network only', async () =>
		{
			await past('addressCodeSent', ADDRESS, 2);
			assert.deepStrictEqual(await inTransaction((executor) => takeCodeSend(NETWORK, ADDRESS, ON, new Date(), executor)), { kind: 'checkNeeded' });
			await past('addressCodeSent', ADDRESS, MAX_EMAIL_CODES_PER_ADDRESS_HOUR - 2);
			assert.strictEqual((await inTransaction((executor) => takeCodeSend(NETWORK, ADDRESS, { ...ON, available: false }, new Date(), executor))).kind, 'refused');
			assert.strictEqual(await countOf('networkCodeRequest', NETWORK), 2);
			assert.strictEqual(await countOf('addressCodeSent', ADDRESS), MAX_EMAIL_CODES_PER_ADDRESS_HOUR);
		});

		it('counts a code with a check past the address\'s limits against the checked limits it is past', async () =>
		{
			await past('addressCodeSent', ADDRESS, MAX_EMAIL_CODES_PER_ADDRESS_HOUR);
			await past('addressWrongGuess', ADDRESS, 15);
			assert.deepStrictEqual(await inTransaction((executor) => takeCodeSend(NETWORK, ADDRESS, PASSED, new Date(), executor)), {
				kind: 'allowChecked',
				pastHourly: true,
				whileBlocked: true
			});
			assert.strictEqual(await countOf('addressCodeSent', ADDRESS), MAX_EMAIL_CODES_PER_ADDRESS_HOUR);
			assert.strictEqual(await countOf('addressCheckedCodeSent', ADDRESS), 1);
			assert.strictEqual(await countOf('addressCheckedCodeWhileBlocked', ADDRESS), 1);
		});

		it('reads the network\'s and the address\'s counts in one query while they are locked', async () =>
		{
			assert.strictEqual(await countReads(() => inTransaction((executor) => takeCodeSend(NETWORK, ADDRESS, ON, new Date(), executor))), 1);
		});
	});
});
