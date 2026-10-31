import assert from 'assert';
import { createHash } from 'crypto';

import { checkPwnedPassword } from '../../src/auth/pwnedPasswords.js';

// The range API speaks in uppercase SHA-1: the first 5 characters are sent, and the rest are listed
const PASSWORD_SHA1 = createHash('sha1')
	.update('password')
	.digest('hex')
	.toUpperCase();
const PASSWORD_PREFIX = PASSWORD_SHA1.slice(0, 5);
const PASSWORD_SUFFIX = PASSWORD_SHA1.slice(5);

/**
 * A stand-in for fetch that answers with a body, and records the address and headers it was asked for
 *
 * @param body The answer's body
 * @param status The answer's status
 * @return The stand-in, and what it was asked
 */
function fakeRange(body: string, status: number = 200): { fetchRange: typeof fetch; requests: { url: string; headers: HeadersInit | undefined }[] }
{
	const requests: { url: string; headers: HeadersInit | undefined }[] = [];
	const fetchRange = ((url: string, init?: RequestInit) =>
	{
		requests.push({
			url,
			headers: init?.headers
		});

		return(Promise.resolve(new Response(body, { status })));
	}) as typeof fetch;

	return({
		fetchRange,
		requests
	});
}

describe('checkPwnedPassword', () =>
{
	it('sends only the first 5 characters of the hash, asking for padding', async () =>
	{
		const { fetchRange, requests } = fakeRange('');

		await checkPwnedPassword('password', fetchRange);

		assert.deepStrictEqual(requests, [{
			url: `https://api.pwnedpasswords.com/range/${PASSWORD_PREFIX}`,
			headers: {
				'Add-Padding': 'true'
			}
		}]);
	});

	it('finds a breached password in the range', async () =>
	{
		const { fetchRange } = fakeRange(`0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n${PASSWORD_SUFFIX}:9659365\r\n00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2`);

		assert.strictEqual(await checkPwnedPassword('password', fetchRange), true);
	});

	it('passes a password not in the range', async () =>
	{
		const { fetchRange } = fakeRange('0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2');

		assert.strictEqual(await checkPwnedPassword('password', fetchRange), false);
	});

	it('ignores padding entries, which have a count of 0', async () =>
	{
		const { fetchRange } = fakeRange(`${PASSWORD_SUFFIX}:0`);

		assert.strictEqual(await checkPwnedPassword('password', fetchRange), false);
	});

	it('answers unknown when the service fails', async () =>
	{
		const failing = (() => Promise.reject(new Error('offline'))) as typeof fetch;

		assert.strictEqual(await checkPwnedPassword('password', fakeRange('', 503).fetchRange), 'unknown');
		assert.strictEqual(await checkPwnedPassword('password', failing), 'unknown');
	});
});
