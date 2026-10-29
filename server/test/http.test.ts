import assert from 'assert';
import { randomBytes, randomUUID } from 'crypto';
import http from 'http';

import { AUTH_PROVIDERS_PATH, AUTH_SESSION_PATH, invitePath, MAX_UNIVERSES_PER_PAGE, UNIVERSES_PATH, type UniverseDetails, type UniverseListPayload, type UniverseStage } from '@multiverse-kiln/shared';

import { createUniverse } from '../src/db/universeRepo.js';
import { DEV_BOT_LOGIN_PATH } from '../src/http/devLogin.js';
import { HEALTH_PATH } from '../src/http/health.js';
import { allowedTestOrigin } from './setup.js';
import { getTestServer, testServerUrl } from './testServer.js';

const otherOrigin = 'https://evil.example';

/**
 * Attempts a WebSocket handshake with the test server
 *
 * @param origin Origin header to send, or undefined to send none (like a non-browser client)
 * @return HTTP status: 101 when the upgrade is accepted, otherwise the rejection status
 */
function attemptWebSocketUpgrade(origin: string | undefined): Promise<number>
{
	return(new Promise((resolve, reject) =>
	{
		const headers: Record<string, string> = {
			'Connection': 'Upgrade',
			'Upgrade': 'websocket',
			'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
			'Sec-WebSocket-Version': '13'
		};

		if (origin !== undefined)
		{
			headers['Origin'] = origin;
		}

		const request = http.request(`${testServerUrl}/`, { headers });

		request.on('upgrade', (response, socket) =>
		{
			socket.destroy();
			resolve(response.statusCode ?? 0);
		});

		request.on('response', (response) =>
		{
			response.resume();
			resolve(response.statusCode ?? 0);
		});

		request.on('error', reject);
		request.end();
	}));
}

describe('HTTP responses', () =>
{
	before(async () =>
	{
		await getTestServer();
	});

	it('does not advertise the Colyseus version at /', async () =>
	{
		const response = await fetch(`${testServerUrl}/`);
		const body = await response.text();

		assert.strictEqual(response.status, 404);
		assert.ok(!body.includes('Colyseus'), `unexpected body: ${body}`);
	});

	it('does not send X-Powered-By', async () =>
	{
		const response = await fetch(`${testServerUrl}${HEALTH_PATH}`);

		assert.strictEqual(response.status, 200);
		assert.strictEqual(response.headers.get('x-powered-by'), null);
	});

	it('sends nosniff on Express routes, Colyseus routes and 404s', async () =>
	{
		for (const route of [HEALTH_PATH, AUTH_SESSION_PATH, AUTH_PROVIDERS_PATH, '/__healthcheck', '/nothing-here', invitePath('no-such-invite-token')])
		{
			const response = await fetch(`${testServerUrl}${route}`);

			assert.strictEqual(response.headers.get('x-content-type-options'), 'nosniff', route);
		}
	});

	it('does not serve the Colyseus template routes', async () =>
	{
		for (const route of ['/hi', '/api/hello'])
		{
			const response = await fetch(`${testServerUrl}${route}`);

			assert.strictEqual(response.status, 404, route);
		}
	});

	it('does not serve the bot login without dev tools', async () =>
	{
		const response = await fetch(`${testServerUrl}${DEV_BOT_LOGIN_PATH}`, { method: 'POST' });

		assert.strictEqual(response.status, 404);
	});
});

describe('Session', () =>
{
	before(async () =>
	{
		await getTestServer();
	});

	it('answers that a browser without a session isn\'t logged in, uncached', async () =>
	{
		const response = await fetch(`${testServerUrl}${AUTH_SESSION_PATH}`);

		assert.strictEqual(response.status, 200);
		assert.strictEqual(response.headers.get('cache-control'), 'no-store');
		assert.deepStrictEqual(await response.json(), { player: null });
	});
});

describe('Health check', () =>
{
	before(async () =>
	{
		await getTestServer();
	});

	it('answers 200 with an uncached status', async () =>
	{
		const response = await fetch(`${testServerUrl}${HEALTH_PATH}`);

		assert.strictEqual(response.status, 200);
		assert.strictEqual(response.headers.get('cache-control'), 'no-store');
		assert.deepStrictEqual(await response.json(), { status: 'ok' });
	});
});

describe('Universe list', () =>
{
	before(async () =>
	{
		await getTestServer();
	});

	/**
	 * Adds a universe in a stage
	 *
	 * @param name The universe's name
	 * @param stage The universe's stage
	 * @return The universe's ID
	 */
	function addUniverseIn(name: string, stage: UniverseStage): Promise<string>
	{
		return(createUniverse({ name, shortDescription: `About ${name}.`, ruleset: 'pf1e', stage }));
	}

	/**
	 * Fetches the universe list
	 *
	 * @param query The query string, if any
	 * @return The response and its body
	 */
	async function fetchUniverses(query: string = ''): Promise<{ response: Response; body: unknown }>
	{
		const response = await fetch(`${testServerUrl}${UNIVERSES_PATH}${query}`);

		return({ response, body: await response.json() });
	}

	it('lists the universes ready for everyone, by name, uncached', async () =>
	{
		const zebraId = await addUniverseIn('Zebra', 'let_there_be_light');
		const appleId = await addUniverseIn('Apple', 'let_there_be_light');

		await addUniverseIn('Unfinished', 'in_the_beginning');
		await addUniverseIn('Testing', 'prologue');
		await addUniverseIn('Retired', 'end_of_time');

		const { response, body } = await fetchUniverses();

		assert.strictEqual(response.status, 200);
		assert.strictEqual(response.headers.get('cache-control'), 'no-store');
		assert.deepStrictEqual(body, {
			universes: [
				{ id: appleId, name: 'Apple', slug: 'apple', shortDescription: 'About Apple.', ruleset: 'pf1e' },
				{ id: zebraId, name: 'Zebra', slug: 'zebra', shortDescription: 'About Zebra.', ruleset: 'pf1e' }
			],
			hasMore: false
		});
	});

	it('pages through the list with offset and limit', async () =>
	{
		for (const name of ['A', 'B', 'C'])
		{
			await addUniverseIn(name, 'let_there_be_light');
		}

		const first = (await fetchUniverses('?limit=2')).body as UniverseListPayload;
		const second = (await fetchUniverses('?offset=2&limit=2')).body as UniverseListPayload;

		assert.deepStrictEqual(first.universes.map((universe) => universe.name), ['A', 'B']);
		assert.strictEqual(first.hasMore, true);
		assert.deepStrictEqual(second.universes.map((universe) => universe.name), ['C']);
		assert.strictEqual(second.hasMore, false);
	});

	it('answers 400 for an offset or limit out of range', async () =>
	{
		for (const query of ['?limit=0', `?limit=${MAX_UNIVERSES_PER_PAGE + 1}`, '?offset=-1', '?limit=two', '?offset=1.5'])
		{
			assert.strictEqual((await fetchUniverses(query)).response.status, 400, query);
		}
	});

	it('gives one listed universe in full, uncached', async () =>
	{
		const universeId = await createUniverse({
			name: 'Kilnhaven',
			shortDescription: 'A small town.',
			longDescription: 'A **small** town.',
			ruleset: 'pf1e',
			stage: 'let_there_be_light'
		});
		const { response, body } = await fetchUniverses(`/${universeId}`);

		assert.strictEqual(response.status, 200);
		assert.strictEqual(response.headers.get('cache-control'), 'no-store');
		assert.deepStrictEqual(body, {
			id: universeId,
			name: 'Kilnhaven',
			slug: 'kilnhaven',
			shortDescription: 'A small town.',
			longDescription: 'A **small** town.',
			ruleset: 'pf1e'
		});
	});

	it('finds a listed universe by its slug as well as its ID', async () =>
	{
		const universeId = await addUniverseIn('The Shattered Isles!', 'let_there_be_light');

		for (const path of ['/the-shattered-isles', `/${universeId}`])
		{
			const { response, body } = await fetchUniverses(path);

			assert.strictEqual(response.status, 200, path);
			assert.strictEqual((body as UniverseDetails).id, universeId, path);
		}
	});

	it('answers 404 for a universe that is not listed, does not exist or has no such slug', async () =>
	{
		const unlistedId = await addUniverseIn('Unfinished', 'in_the_beginning');

		for (const path of [`/${unlistedId}`, '/unfinished', `/${randomUUID()}`, '/no-such-universe'])
		{
			assert.strictEqual((await fetchUniverses(path)).response.status, 404, path);
		}
	});
});

describe('CORS', () =>
{
	before(async () =>
	{
		await getTestServer();
	});

	it('allows origins in ALLOWED_ORIGINS', async () =>
	{
		const response = await fetch(`${testServerUrl}${HEALTH_PATH}`, { headers: { Origin: allowedTestOrigin } });

		assert.strictEqual(response.headers.get('access-control-allow-origin'), allowedTestOrigin);
		assert.strictEqual(response.headers.get('access-control-allow-credentials'), 'true');
		assert.match(response.headers.get('vary') ?? '', /Origin/);
	});

	it('does not allow other origins', async () =>
	{
		const response = await fetch(`${testServerUrl}${HEALTH_PATH}`, { headers: { Origin: otherOrigin } });

		assert.strictEqual(response.headers.get('access-control-allow-origin'), null);
	});

	it('does not allow other origins to matchmake', async () =>
	{
		const preflight = await fetch(`${testServerUrl}/matchmake/joinOrCreate/game`, {
			method: 'OPTIONS',
			headers: { 'Origin': otherOrigin, 'Access-Control-Request-Method': 'POST' }
		});

		assert.strictEqual(preflight.headers.get('access-control-allow-origin'), null);
	});

	it('allows origins in ALLOWED_ORIGINS to matchmake', async () =>
	{
		const preflight = await fetch(`${testServerUrl}/matchmake/joinOrCreate/game`, {
			method: 'OPTIONS',
			headers: { 'Origin': allowedTestOrigin, 'Access-Control-Request-Method': 'POST' }
		});

		assert.strictEqual(preflight.headers.get('access-control-allow-origin'), allowedTestOrigin);
	});
});

describe('WebSocket origin check', () =>
{
	before(async () =>
	{
		await getTestServer();
	});

	it('rejects browsers on other origins', async () =>
	{
		assert.strictEqual(await attemptWebSocketUpgrade(otherOrigin), 403);
	});

	it('accepts origins in ALLOWED_ORIGINS', async () =>
	{
		assert.strictEqual(await attemptWebSocketUpgrade(allowedTestOrigin), 101);
	});

	it('accepts clients that send no Origin', async () =>
	{
		assert.strictEqual(await attemptWebSocketUpgrade(undefined), 101);
	});
});
