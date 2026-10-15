import assert from 'assert';
import { BROWSER_ID_PATH } from '@multiverse-kiln/shared';

import { BROWSER_ID_COOKIE, readBrowserId } from '../src/http/browserId.js';
import { getTestServer, testServerUrl } from './testServer.js';

const validBrowserId = '0b6f4c1e-8d2a-4f3b-9c5d-7e1a2b3c4d5e';

describe('readBrowserId', () =>
{
	it('reads the browser ID among other cookies', () =>
	{
		assert.strictEqual(readBrowserId(`theme=dark; ${BROWSER_ID_COOKIE}=${validBrowserId}; lang=en`), validBrowserId);
	});

	it('returns undefined without the cookie', () =>
	{
		assert.strictEqual(readBrowserId(undefined), undefined);
		assert.strictEqual(readBrowserId(null), undefined);
		assert.strictEqual(readBrowserId(''), undefined);
		assert.strictEqual(readBrowserId('theme=dark'), undefined);
	});

	it('rejects a value that is not a random UUID', () =>
	{
		for (const value of ['', 'alice', `${validBrowserId}x`, validBrowserId.toUpperCase(), '00000000-0000-0000-0000-000000000000'])
		{
			assert.strictEqual(readBrowserId(`${BROWSER_ID_COOKIE}=${value}`), undefined, value);
		}
	});

	it('does not match a cookie whose name only contains the browser ID cookie\'s name', () =>
	{
		assert.strictEqual(readBrowserId(`x${BROWSER_ID_COOKIE}=${validBrowserId}`), undefined);
	});
});

describe('Browser ID route', () =>
{
	before(async () =>
	{
		await getTestServer();
	});

	it('sets a secure, HttpOnly, same-site session cookie holding a new browser ID', async () =>
	{
		const response = await fetch(`${testServerUrl}${BROWSER_ID_PATH}`, { method: 'POST' });
		const cookie = response.headers.get('set-cookie') ?? '';

		assert.strictEqual(response.status, 204);
		assert.strictEqual(response.headers.get('cache-control'), 'no-store');
		assert.ok(readBrowserId(cookie.split(';')[0]), cookie);
		assert.match(cookie, /; Path=\/(;|$)/);
		assert.match(cookie, /; HttpOnly(;|$)/);
		assert.match(cookie, /; Secure(;|$)/);
		assert.match(cookie, /; SameSite=Strict(;|$)/);
		assert.doesNotMatch(cookie, /Expires=|Max-Age=|Domain=/i);
	});

	it('gives each browser a different ID', async () =>
	{
		const first = await fetch(`${testServerUrl}${BROWSER_ID_PATH}`, { method: 'POST' });
		const second = await fetch(`${testServerUrl}${BROWSER_ID_PATH}`, { method: 'POST' });

		assert.notStrictEqual(first.headers.get('set-cookie'), second.headers.get('set-cookie'));
	});

	it('keeps a browser\'s existing valid ID', async () =>
	{
		const response = await fetch(`${testServerUrl}${BROWSER_ID_PATH}`, {
			method: 'POST',
			headers: { Cookie: `${BROWSER_ID_COOKIE}=${validBrowserId}` }
		});

		assert.strictEqual(response.status, 204);
		assert.strictEqual(response.headers.get('set-cookie'), null);
	});

	it('replaces an invalid ID', async () =>
	{
		const response = await fetch(`${testServerUrl}${BROWSER_ID_PATH}`, {
			method: 'POST',
			headers: { Cookie: `${BROWSER_ID_COOKIE}=alice` }
		});

		assert.ok(readBrowserId((response.headers.get('set-cookie') ?? '').split(';')[0]));
	});
});
