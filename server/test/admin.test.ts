import assert from 'assert';

import { DEFAULT_SITE_SETTINGS, MAX_CHARACTER_DELETION_DAYS, MAX_EMAIL_LENGTH,MAX_SITE_SOCIAL_URL_LENGTH, MAX_UNIVERSES_PER_CREATOR, SITE_SETTINGS_PATH, type SiteSettings } from '@multiverse-kiln/shared';

import { allowedTestOrigin } from './setup.js';
import { getTestServer, testServerUrl } from './testServer.js';

const closed: SiteSettings = {
	universeCreationEnabled: false,
	universesPerCreator: 12,
	characterDeletionDays: 0,
	socials: {
		...DEFAULT_SITE_SETTINGS.socials,
		discord: 'https://discord.gg/example',
		x: 'https://x.com/example'
	},
	privacyContact: 'privacy@example.com'
};

/**
 * The closed settings with one social site's link replaced
 *
 * @param site The social site
 * @param url Its link
 * @return The settings
 */
function withSocial(site: string, url: unknown): unknown
{
	return({
		...closed,
		socials: {
			...closed.socials,
			[site]: url
		}
	});
}

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
			{ ...closed, characterDeletionDays: -1 },
			{ ...closed, characterDeletionDays: MAX_CHARACTER_DELETION_DAYS + 1 },
			{ ...closed, characterDeletionDays: 1.5 },
			{ ...closed, universeCreationEnabled: 'no' },
			{ ...closed, extra: 1 },
			{ ...closed, socials: undefined },
			withSocial('discord', 'http://discord.gg/example'),
			withSocial('discord', 'https://discord.gg.evil.example/example'),
			withSocial('facebook', 'https://discord.gg/example'),
			withSocial('x', 'https://x.com:8443/example'),
			withSocial('x', 'https://someone@x.com/example'),
			withSocial('x', `https://x.com/${'a'.repeat(MAX_SITE_SOCIAL_URL_LENGTH)}`),
			withSocial('x', 'x.com/example'),
			withSocial('x', 12),
			withSocial('mastodon', 'https://mastodon.social/@example'),
			{ ...closed, privacyContact: undefined },
			{ ...closed, privacyContact: 'privacy' },
			{ ...closed, privacyContact: 'privacy@' },
			{ ...closed, privacyContact: 'pri vacy@example.com' },
			{ ...closed, privacyContact: 'a@b@example.com' },
			{ ...closed, privacyContact: `${'a'.repeat(MAX_EMAIL_LENGTH)}@example.com` }
		];

		for (const body of bodies)
		{
			assert.strictEqual((await send('PUT', { body })).status, 400, JSON.stringify(body));
		}

		assert.strictEqual((await send('PUT', { rawBody: '{' })).status, 400);
		assert.deepStrictEqual(await (await send('GET')).json(), DEFAULT_SITE_SETTINGS);
	});
});
