import assert from 'assert';

import { DEFAULT_SITE_SETTINGS, MAX_UNIVERSES_PER_CREATOR, SITE_SETTINGS_PATH, type SiteSettings } from '@multiverse-kiln/shared';

import { allowedTestOrigin } from './setup.js';
import { getTestServer, testServerUrl } from './testServer.js';

const closed: SiteSettings = {
	universeCreationEnabled: false,
	universesPerCreator: 12
};

/**
 * Sends a request to the site settings route
 *
 * @param method The HTTP method
 * @param options The JSON body, a raw body, and the Origin header to send
 * @return The response
 */
function send(method: string, options: { body?: unknown; rawBody?: string; origin?: string } = {}): Promise<Response>
{
	const headers: Record<string, string> = {};

	if (options.origin !== undefined)
	{
		headers['Origin'] = options.origin;
	}

	if ((options.body !== undefined) || (options.rawBody !== undefined))
	{
		headers['Content-Type'] = 'application/json';
	}

	return(fetch(`${testServerUrl}${SITE_SETTINGS_PATH}`, {
		method,
		headers,
		body: (options.rawBody ?? ((options.body === undefined) ? undefined : JSON.stringify(options.body)))
	}));
}

describe('Site settings', () =>
{
	before(async () =>
	{
		await getTestServer();
	});

	it('answers the defaults, uncached, before any are saved', async () =>
	{
		const response = await send('GET');

		assert.strictEqual(response.status, 200);
		assert.strictEqual(response.headers.get('cache-control'), 'no-store');
		assert.strictEqual(response.headers.get('x-content-type-options'), 'nosniff');
		assert.deepStrictEqual(await response.json(), DEFAULT_SITE_SETTINGS);
	});

	it('saves settings from an allowed origin', async () =>
	{
		assert.strictEqual((await send('PUT', { body: closed, origin: allowedTestOrigin })).status, 204);
		assert.deepStrictEqual(await (await send('GET')).json(), closed);
	});

	it('refuses changes from other origins', async () =>
	{
		assert.strictEqual((await send('PUT', { body: closed, origin: 'https://evil.example' })).status, 403);
		assert.deepStrictEqual(await (await send('GET')).json(), DEFAULT_SITE_SETTINGS);
	});

	it('refuses settings that aren\'t valid', async () =>
	{
		const bodies = [
			{},
			{ universeCreationEnabled: true },
			{ ...closed, universesPerCreator: 0 },
			{ ...closed, universesPerCreator: MAX_UNIVERSES_PER_CREATOR + 1 },
			{ ...closed, universesPerCreator: 2.5 },
			{ ...closed, universeCreationEnabled: 'no' },
			{ ...closed, extra: 1 }
		];

		for (const body of bodies)
		{
			assert.strictEqual((await send('PUT', { body })).status, 400, JSON.stringify(body));
		}

		assert.strictEqual((await send('PUT', { rawBody: '{' })).status, 400);
		assert.deepStrictEqual(await (await send('GET')).json(), DEFAULT_SITE_SETTINGS);
	});
});
