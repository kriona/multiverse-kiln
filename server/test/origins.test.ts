import assert from 'assert';
import { createAuthContext } from 'colyseus';

import { createOriginCheck, isOriginAllowed, parseAllowedOrigins } from '../src/http/origins.js';

describe('parseAllowedOrigins', () =>
{
	it('requires at least one origin', () =>
	{
		assert.throws(() => parseAllowedOrigins(undefined), /ALLOWED_ORIGINS is required/);
		assert.throws(() => parseAllowedOrigins(''), /ALLOWED_ORIGINS is required/);
		assert.throws(() => parseAllowedOrigins(' , '), /ALLOWED_ORIGINS is required/);
	});

	it('parses a comma-separated list', () =>
	{
		const origins = parseAllowedOrigins('https://a.example, https://b.example:5173');

		assert.deepStrictEqual([...origins], ['https://a.example', 'https://b.example:5173']);
	});

	it('normalizes case, default ports and trailing slashes', () =>
	{
		const origins = parseAllowedOrigins('https://Example.COM/,https://port.example:443');

		assert.deepStrictEqual([...origins], ['https://example.com', 'https://port.example']);
	});

	it('rejects entries that are not plain origins', () =>
	{
		assert.throws(() => parseAllowedOrigins('*'), /not a valid origin/);
		assert.throws(() => parseAllowedOrigins('example.com'), /not a valid origin/);
		assert.throws(() => parseAllowedOrigins('https://example.com/game'), /must be just a scheme/);
		assert.throws(() => parseAllowedOrigins('https://example.com?x=1'), /must be just a scheme/);
		assert.throws(() => parseAllowedOrigins('ftp://example.com'), /must be just a scheme/);
	});
});

describe('isOriginAllowed', () =>
{
	const allowed = parseAllowedOrigins('https://www.multiversekiln-dev.com:5173');

	it('allows an exact match', () =>
	{
		assert.strictEqual(isOriginAllowed('https://www.multiversekiln-dev.com:5173', allowed), true);
	});

	it('rejects a different scheme, host or port', () =>
	{
		assert.strictEqual(isOriginAllowed('http://www.multiversekiln-dev.com:5173', allowed), false);
		assert.strictEqual(isOriginAllowed('https://multiversekiln-dev.com:5173', allowed), false);
		assert.strictEqual(isOriginAllowed('https://www.multiversekiln-dev.com:2567', allowed), false);
		assert.strictEqual(isOriginAllowed('https://www.multiversekiln-dev.com:5173.evil.example', allowed), false);
	});

	it('rejects a missing origin', () =>
	{
		assert.strictEqual(isOriginAllowed(null, allowed), false);
	});
});

describe('createOriginCheck', () =>
{
	const check = createOriginCheck(parseAllowedOrigins('https://allowed.example'));
	const request = new Request('http://localhost/');

	/**
	 * Runs the check for an upgrade request with the given headers
	 *
	 * @param headers Request headers
	 * @return The check's result: a Response to reject, or undefined to allow
	 */
	async function runCheck(headers: Record<string, string>): Promise<Response | void>
	{
		return(await check(request, createAuthContext({ headers })));
	}

	it('allows origins in the allowlist', async () =>
	{
		assert.strictEqual(await runCheck({ origin: 'https://allowed.example' }), undefined);
	});

	it('rejects other origins with 403', async () =>
	{
		const response = await runCheck({ origin: 'https://evil.example' });

		assert.ok(response instanceof Response);
		assert.strictEqual(response.status, 403);
	});

	it('allows requests without an Origin header', async () =>
	{
		assert.strictEqual(await runCheck({}), undefined);
	});
});
