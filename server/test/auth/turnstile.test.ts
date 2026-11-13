import assert from 'assert';

import { createBotCheckVerifier, readTurnstileKeys, REACHABLE_FOR_MS, SITEVERIFY_URL, TEST_SECRET_KEYS, UNREACHABLE_FOR_MS, type TurnstileKeys } from '../../src/auth/turnstile.js';

const KEYS: TurnstileKeys = {
	siteKey: '0x4AAAAAAAsiteKeyForTests',
	secretKey: '0x4AAAAAAAsecretKeyForTests'
};

const HOSTNAME = 'www.example.test';
const NOW = new Date('2026-11-13T12:00:00Z');

/**
 * A time after NOW
 *
 * @param ms How many milliseconds after
 * @return The time
 */
function later(ms: number): Date
{
	return(new Date(NOW.getTime() + ms));
}

/**
 * A stand-in for Cloudflare: answers each call with the next answer, and remembers what it was sent
 *
 * @param answers What to answer, in order: a body with status 200, a status, or 'down' to fail to connect
 * @return The fetch, and the tokens it was sent
 */
function fakeCloudflare(...answers: (object | number | 'down')[]): { fetcher: typeof fetch; tokens: string[] }
{
	const tokens: string[] = [];
	const fetcher = ((url: string | URL | Request, init?: RequestInit): Promise<Response> =>
	{
		assert.strictEqual(((url instanceof Request) ? url.url : url.toString()), SITEVERIFY_URL);
		assert.ok(init?.body instanceof URLSearchParams);
		tokens.push(init.body.get('response') ?? '');

		const answer = answers.shift();

		if ((answer === undefined) || (answer === 'down'))
		{
			return(Promise.reject(new TypeError('fetch failed')));
		}

		if (typeof answer === 'number')
		{
			return(Promise.resolve(new Response('', { status: answer })));
		}

		return(Promise.resolve(Response.json(answer)));
	}) as typeof fetch;

	return({
		fetcher,
		tokens
	});
}

/**
 * Siteverify's answer to a passed check
 *
 * @param action The check's action
 * @param hostname Where it was made
 * @return The answer
 */
function passedAnswer(action = 'login', hostname = HOSTNAME): object
{
	return({
		'success': true,
		'error-codes': [],
		action,
		hostname
	});
}

const REFUSED = {
	'success': false,
	'error-codes': ['invalid-input-response']
};

describe('turnstile', () =>
{
	let warn: typeof console.warn;
	let error: typeof console.error;

	beforeEach(() =>
	{
		warn = console.warn;
		error = console.error;
		console.warn = () => undefined;
		console.error = () => undefined;
	});

	afterEach(() =>
	{
		console.warn = warn;
		console.error = error;
	});

	describe('readTurnstileKeys', () =>
	{
		it('turns checks off with neither key set', () =>
		{
			assert.strictEqual(readTurnstileKeys({}), undefined);
			assert.strictEqual(readTurnstileKeys({
				TURNSTILE_SITE_KEY: '',
				TURNSTILE_SECRET_KEY: ' '
			}), undefined);
		});

		it('refuses only one key', () =>
		{
			assert.throws(() => readTurnstileKeys({ TURNSTILE_SITE_KEY: KEYS.siteKey }), /both/);
			assert.throws(() => readTurnstileKeys({ TURNSTILE_SECRET_KEY: KEYS.secretKey }), /both/);
		});

		it('reads both keys', () =>
		{
			assert.deepStrictEqual(readTurnstileKeys({
				TURNSTILE_SITE_KEY: KEYS.siteKey,
				TURNSTILE_SECRET_KEY: KEYS.secretKey
			}), KEYS);
		});

		it('takes a test secret key only with dev tools on or in tests', () =>
		{
			for (const secretKey of TEST_SECRET_KEYS)
			{
				const keys = {
					TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
					TURNSTILE_SECRET_KEY: secretKey
				};

				assert.throws(() => readTurnstileKeys(keys), /test keys/);
				assert.throws(() => readTurnstileKeys({
					...keys,
					NODE_ENV: 'production',
					ENABLE_DEV_TOOLS: 'true'
				}), /test keys/);
				assert.throws(() => readTurnstileKeys({
					...keys,
					ENABLE_DEV_TOOLS: 'true',
					COLYSEUS_CLOUD: '1'
				}), /test keys/);
				assert.strictEqual(readTurnstileKeys({
					...keys,
					ENABLE_DEV_TOOLS: 'true'
				})?.secretKey, secretKey);
				assert.strictEqual(readTurnstileKeys({
					...keys,
					NODE_ENV: 'test'
				})?.secretKey, secretKey);
			}
		});
	});

	describe('createBotCheckVerifier', () =>
	{
		it('is off without keys', async () =>
		{
			const cloudflare = fakeCloudflare();
			const verifier = createBotCheckVerifier(undefined, HOSTNAME, cloudflare.fetcher);

			assert.strictEqual(verifier.siteKey, undefined);
			assert.strictEqual(verifier.available(NOW), false);
			assert.strictEqual(await verifier.confirmAvailable(NOW), false);
			assert.strictEqual(await verifier.verify('token', 'login', NOW), 'unreachable');
			assert.deepStrictEqual(cloudflare.tokens, []);
		});

		it('passes a token made for the action on this site', async () =>
		{
			const cloudflare = fakeCloudflare(passedAnswer('email-code'));
			const verifier = createBotCheckVerifier(KEYS, HOSTNAME, cloudflare.fetcher);

			assert.strictEqual(verifier.siteKey, KEYS.siteKey);
			assert.strictEqual(await verifier.verify('the-token', 'email-code', NOW), 'passed');
			assert.deepStrictEqual(cloudflare.tokens, ['the-token']);
		});

		it('fails a token Cloudflare refuses, or made for another action or site', async () =>
		{
			const verifier = createBotCheckVerifier(KEYS, HOSTNAME, fakeCloudflare(REFUSED, passedAnswer('password'), passedAnswer('login', 'evil.example')).fetcher);

			assert.strictEqual(await verifier.verify('a', 'login', NOW), 'failed');
			assert.strictEqual(await verifier.verify('b', 'login', NOW), 'failed');
			assert.strictEqual(await verifier.verify('c', 'login', NOW), 'failed');
			assert.strictEqual(verifier.available(NOW), true);
		});

		it('skips the action and hostname with a test secret key', async () =>
		{
			const verifier = createBotCheckVerifier({
				siteKey: '1x00000000000000000000AA',
				secretKey: TEST_SECRET_KEYS[0]
			}, HOSTNAME, fakeCloudflare({
				'success': true,
				'error-codes': [],
				'action': '',
				'hostname': 'example.com'
			}).fetcher);

			assert.strictEqual(await verifier.verify('XXXX.DUMMY.TOKEN.XXXX', 'login', NOW), 'passed');
		});

		it('turns checks off for a few minutes when Cloudflare can\'t be reached or fails', async () =>
		{
			for (const failure of ['down', 500, 503, { 'success': false, 'error-codes': ['internal-error'] }, { 'success': false, 'error-codes': ['invalid-input-secret'] }] as const)
			{
				const verifier = createBotCheckVerifier(KEYS, HOSTNAME, fakeCloudflare(failure, passedAnswer()).fetcher);

				assert.strictEqual(await verifier.verify('a', 'login', NOW), 'unreachable', JSON.stringify(failure));
				assert.strictEqual(verifier.available(NOW), false);
				assert.strictEqual(verifier.available(later(UNREACHABLE_FOR_MS - 1)), false);
				assert.strictEqual(await verifier.verify('b', 'login', later(UNREACHABLE_FOR_MS - 1)), 'unreachable');
				assert.strictEqual(verifier.available(later(UNREACHABLE_FOR_MS)), true);
				assert.strictEqual(await verifier.verify('c', 'login', later(UNREACHABLE_FOR_MS)), 'passed');
			}
		});

		it('checks Cloudflare can be reached, with a token that can\'t be valid, when it hasn\'t heard from it for a while', async () =>
		{
			const cloudflare = fakeCloudflare(REFUSED, passedAnswer(), REFUSED);
			const verifier = createBotCheckVerifier(KEYS, HOSTNAME, cloudflare.fetcher);

			assert.strictEqual(verifier.reachedRecently(NOW), false);
			assert.strictEqual(await verifier.confirmAvailable(NOW), true);
			assert.strictEqual(cloudflare.tokens.length, 1);
			assert.strictEqual(verifier.reachedRecently(NOW), true);

			// Heard from recently, by the check above and then by verifying a token
			assert.strictEqual(await verifier.confirmAvailable(later(REACHABLE_FOR_MS - 1)), true);
			assert.strictEqual(await verifier.verify('token', 'login', later(REACHABLE_FOR_MS - 1)), 'passed');
			assert.strictEqual(await verifier.confirmAvailable(later((2 * REACHABLE_FOR_MS) - 2)), true);
			assert.strictEqual(cloudflare.tokens.length, 2);

			assert.strictEqual(await verifier.confirmAvailable(later(2 * REACHABLE_FOR_MS)), true);
			assert.strictEqual(cloudflare.tokens.length, 3);
			assert.notStrictEqual(cloudflare.tokens[0], 'token');
		});

		it('turns checks off when that check fails, and shares one check between requests at once', async () =>
		{
			const cloudflare = fakeCloudflare('down');
			const verifier = createBotCheckVerifier(KEYS, HOSTNAME, cloudflare.fetcher);

			assert.deepStrictEqual(await Promise.all([verifier.confirmAvailable(NOW), verifier.confirmAvailable(NOW)]), [false, false]);
			assert.strictEqual(cloudflare.tokens.length, 1);
			assert.strictEqual(verifier.available(NOW), false);
			assert.strictEqual(await verifier.confirmAvailable(later(UNREACHABLE_FOR_MS - 1)), false);
			assert.strictEqual(cloudflare.tokens.length, 1);
		});
	});
});
