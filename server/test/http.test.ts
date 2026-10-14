import assert from 'assert';
import { randomBytes } from 'crypto';
import http from 'http';

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
		const response = await fetch(`${testServerUrl}/hi`);

		assert.strictEqual(response.status, 200);
		assert.strictEqual(response.headers.get('x-powered-by'), null);
	});

	it('sends nosniff on Express routes, Colyseus routes and 404s', async () =>
	{
		for (const route of ['/hi', '/__healthcheck', '/nothing-here'])
		{
			const response = await fetch(`${testServerUrl}${route}`);

			assert.strictEqual(response.headers.get('x-content-type-options'), 'nosniff', route);
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
		const response = await fetch(`${testServerUrl}/hi`, { headers: { Origin: allowedTestOrigin } });

		assert.strictEqual(response.headers.get('access-control-allow-origin'), allowedTestOrigin);
		assert.strictEqual(response.headers.get('access-control-allow-credentials'), 'true');
		assert.match(response.headers.get('vary') ?? '', /Origin/);
	});

	it('does not allow other origins', async () =>
	{
		const response = await fetch(`${testServerUrl}/hi`, { headers: { Origin: otherOrigin } });

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
