import assert from 'assert';

import { ADMIN_PATH, ADMIN_PLAYERS_PATH, ADMIN_SESSIONS_PATH, ADMIN_TWO_FACTOR_ERROR_ID, AUTH_SESSION_PATH, DEFAULT_SITE_SETTINGS, MAX_ADMIN_ROWS_PER_PAGE, MAX_CHARACTER_DELETION_DAYS, MAX_EMAIL_LENGTH, MAX_SITE_SOCIAL_URL_LENGTH, MAX_UNIVERSES_PER_CREATOR, PUBLIC_SITE_SETTINGS_PATH, SITE_SETTINGS_PATH, type AdminPlayerListPayload, type AdminSessionListPayload, type ErrorPayload, type SessionPayload, type SiteSettings } from '@multiverse-kiln/shared';

import { pool } from '../src/db/client.js';
import { createPlayer, saveLastLogin } from '../src/db/playerRepo.js';
import { addProviderLogin } from '../src/db/providerLoginRepo.js';
import { addServerAdmin } from '../src/db/serverAdminRepo.js';
import { connectedSessions } from '../src/players/connectedSessions.js';
import { addPlayer, logInBrowser, type TestBrowser } from './players.js';
import { allowedTestOrigin } from './setup.js';
import { getTestServer, testServerUrl } from './testServer.js';
import { turnOnTwoFactor } from './twoFactorAccounts.js';

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
 * Sends a request to the server
 *
 * @param method The HTTP method
 * @param path The path, with any query string
 * @param options The browser to send it from, the JSON body, a raw body, and the Origin header to send
 * @return The response
 */
function send(method: string, path: string, options: { browser?: TestBrowser; body?: unknown; rawBody?: string; origin?: string } = {}): Promise<Response>
{
	const headers: Record<string, string> = {};

	if (options.browser !== undefined)
	{
		headers['Cookie'] = options.browser.cookie;
	}

	if (options.origin !== undefined)
	{
		headers['Origin'] = options.origin;
	}

	if ((options.body !== undefined) || (options.rawBody !== undefined))
	{
		headers['Content-Type'] = 'application/json';
	}

	return(fetch(`${testServerUrl}${path}`, {
		method,
		headers,
		body: (options.rawBody ?? ((options.body === undefined) ? undefined : JSON.stringify(options.body)))
	}));
}

/**
 * Logs a browser in as a new server admin with 2FA on
 *
 * @param name The admin's display name
 * @return The browser
 */
async function logInAdmin(name: string): Promise<TestBrowser>
{
	const player = await addPlayer(name);

	await addServerAdmin(player.id);
	await turnOnTwoFactor(player.id);

	return(logInBrowser(player.id));
}

describe('Admin access', () =>
{
	before(async () =>
	{
		await getTestServer();
	});

	it('refuses browsers that aren\'t logged in', async () =>
	{
		for (const path of [ADMIN_PATH, SITE_SETTINGS_PATH, ADMIN_SESSIONS_PATH, ADMIN_PLAYERS_PATH])
		{
			assert.strictEqual((await send('GET', path)).status, 401, path);
		}

		assert.strictEqual((await send('PUT', SITE_SETTINGS_PATH, { body: closed })).status, 401);
	});

	it('refuses players who aren\'t server admins, even with 2FA', async () =>
	{
		const player = await addPlayer('Ordinary');

		await turnOnTwoFactor(player.id);

		const browser = await logInBrowser(player.id);

		for (const path of [ADMIN_PATH, SITE_SETTINGS_PATH, ADMIN_SESSIONS_PATH, ADMIN_PLAYERS_PATH])
		{
			const response = await send('GET', path, { browser });

			assert.strictEqual(response.status, 403, path);
			assert.strictEqual(((await response.json()) as ErrorPayload).error.id, 'error.notServerAdmin');
		}

		assert.strictEqual((await send('PUT', SITE_SETTINGS_PATH, { browser, body: closed })).status, 403);
		assert.deepStrictEqual(await (await send('GET', PUBLIC_SITE_SETTINGS_PATH)).json(), {
			characterDeletionDays: DEFAULT_SITE_SETTINGS.characterDeletionDays,
			socials: DEFAULT_SITE_SETTINGS.socials,
			privacyContact: DEFAULT_SITE_SETTINGS.privacyContact
		});
	});

	it('refuses server admins without 2FA, saying why', async () =>
	{
		const player = await addPlayer('Unguarded');

		await addServerAdmin(player.id);

		const browser = await logInBrowser(player.id);

		for (const path of [ADMIN_PATH, ADMIN_PLAYERS_PATH])
		{
			const response = await send('GET', path, { browser });

			assert.strictEqual(response.status, 403, path);
			assert.strictEqual(((await response.json()) as ErrorPayload).error.id, ADMIN_TWO_FACTOR_ERROR_ID);
		}
	});

	it('lets server admins with 2FA in', async () =>
	{
		const player = await addPlayer('Guarded');

		await addServerAdmin(player.id);
		await turnOnTwoFactor(player.id);

		assert.strictEqual((await send('GET', ADMIN_PATH, { browser: await logInBrowser(player.id) })).status, 204);
	});

	it('tells the session whether its player is a server admin', async () =>
	{
		const admin = await addPlayer('Overseer');
		const other = await addPlayer('Wanderer');

		await addServerAdmin(admin.id);

		const adminPayload = (await (await send('GET', AUTH_SESSION_PATH, { browser: await logInBrowser(admin.id) })).json()) as SessionPayload;
		const otherPayload = (await (await send('GET', AUTH_SESSION_PATH, { browser: await logInBrowser(other.id) })).json()) as SessionPayload;

		assert.strictEqual(adminPayload.player?.serverAdmin, true);
		assert.strictEqual(otherPayload.player?.serverAdmin, false);
	});
});

describe('Site settings', () =>
{
	let admin: TestBrowser;

	before(async () =>
	{
		await getTestServer();
	});

	beforeEach(async () =>
	{
		admin = await logInAdmin('Settings Admin');
	});

	it('answers the defaults, uncached, before any are saved', async () =>
	{
		const response = await send('GET', SITE_SETTINGS_PATH, { browser: admin });

		assert.strictEqual(response.status, 200);
		assert.strictEqual(response.headers.get('cache-control'), 'no-store');
		assert.strictEqual(response.headers.get('x-content-type-options'), 'nosniff');
		assert.deepStrictEqual(await response.json(), DEFAULT_SITE_SETTINGS);
	});

	it('saves settings from an allowed origin, and shows the public ones to anyone', async () =>
	{
		assert.strictEqual((await send('PUT', SITE_SETTINGS_PATH, { browser: admin, body: closed, origin: allowedTestOrigin })).status, 204);
		assert.deepStrictEqual(await (await send('GET', SITE_SETTINGS_PATH, { browser: admin })).json(), closed);

		const publicResponse = await send('GET', PUBLIC_SITE_SETTINGS_PATH);

		assert.strictEqual(publicResponse.status, 200);
		assert.deepStrictEqual(await publicResponse.json(), {
			characterDeletionDays: closed.characterDeletionDays,
			socials: closed.socials,
			privacyContact: closed.privacyContact
		});
	});

	it('refuses changes from other origins', async () =>
	{
		assert.strictEqual((await send('PUT', SITE_SETTINGS_PATH, { browser: admin, body: closed, origin: 'https://evil.example' })).status, 403);
		assert.deepStrictEqual(await (await send('GET', SITE_SETTINGS_PATH, { browser: admin })).json(), DEFAULT_SITE_SETTINGS);
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
			assert.strictEqual((await send('PUT', SITE_SETTINGS_PATH, { browser: admin, body })).status, 400, JSON.stringify(body));
		}

		assert.strictEqual((await send('PUT', SITE_SETTINGS_PATH, { browser: admin, rawBody: '{' })).status, 400);
		assert.deepStrictEqual(await (await send('GET', SITE_SETTINGS_PATH, { browser: admin })).json(), DEFAULT_SITE_SETTINGS);
	});
});

describe('Admin session list', () =>
{
	let admin: TestBrowser;

	before(async () =>
	{
		await getTestServer();
	});

	beforeEach(async () =>
	{
		admin = await logInAdmin('Session Admin');
	});

	/**
	 * Lists sessions as the admin
	 *
	 * @param query The query string
	 * @return The page
	 */
	async function listSessions(query: string = ''): Promise<AdminSessionListPayload>
	{
		const response = await send('GET', `${ADMIN_SESSIONS_PATH}?${query}`, { browser: admin });

		assert.strictEqual(response.status, 200);

		return((await response.json()) as AdminSessionListPayload);
	}

	it('lists the sessions still going, most recently used first, marking the asking browser\'s', async () =>
	{
		const ada = await addPlayer('Ada Lovelace');
		const grace = await addPlayer('Grace Hopper');
		const older = await logInBrowser(ada.id, true);
		const expired = await logInBrowser(grace.id);

		await logInBrowser(grace.id);
		await pool.query('UPDATE sessions SET last_used_at = now() - interval \'1 hour\' WHERE id = $1', [older.sessionId]);
		await pool.query('UPDATE sessions SET last_used_at = now() - interval \'2 hours\' WHERE id = $1', [expired.sessionId]);

		const page = await listSessions();

		assert.strictEqual(page.total, 3);
		assert.deepStrictEqual(page.sessions.map((session) => [session.username, session.current, session.rememberMe]), [
			['Grace_Hopper', false, false],
			['Session_Admin', true, false],
			['Ada_Lovelace', false, true]
		]);
		assert.ok(Date.parse(page.sessions[2].expiresAt) > Date.now());
	});

	it('searches usernames and names, ignoring capitals and wildcards', async () =>
	{
		const ada = await addPlayer('Ada Lovelace');

		await logInBrowser(ada.id);

		assert.deepStrictEqual((await listSessions('search=LOVE')).sessions.map((session) => session.username), ['Ada_Lovelace']);
		assert.deepStrictEqual((await listSessions('search=ada_')).sessions.map((session) => session.username), ['Ada_Lovelace']);
		assert.strictEqual((await listSessions('search=%25')).total, 0);
	});

	it('narrows the list to sessions with windows connected, or without', async () =>
	{
		const ada = await addPlayer('Ada Lovelace');
		const playing = await logInBrowser(ada.id);

		connectedSessions.connect(playing.sessionId);

		try
		{
			const connected = await listSessions('connected=true');

			assert.deepStrictEqual(connected.sessions.map((session) => [session.username, session.connected]), [['Ada_Lovelace', true]]);
			assert.deepStrictEqual((await listSessions('connected=false')).sessions.map((session) => session.username), ['Session_Admin']);
		}
		finally
		{
			connectedSessions.disconnect(playing.sessionId);
		}
	});

	it('pages the list, and refuses pages out of range', async () =>
	{
		for (let index = 0; index < 3; index++)
		{
			await logInBrowser((await addPlayer(`Paged ${index}`)).id);
		}

		const page = await listSessions('offset=1&limit=2');

		assert.strictEqual(page.total, 4);
		assert.strictEqual(page.sessions.length, 2);

		for (const query of ['offset=-1', `limit=${MAX_ADMIN_ROWS_PER_PAGE + 1}`, 'limit=0', 'connected=maybe', `search=${'a'.repeat(101)}`])
		{
			assert.strictEqual((await send('GET', `${ADMIN_SESSIONS_PATH}?${query}`, { browser: admin })).status, 400, query);
		}
	});
});

describe('Admin player list', () =>
{
	let admin: TestBrowser;

	before(async () =>
	{
		await getTestServer();
	});

	beforeEach(async () =>
	{
		admin = await logInAdmin('Player Admin');
	});

	/**
	 * Lists players as the admin
	 *
	 * @param query The query string
	 * @return The page
	 */
	async function listPlayers(query: string = ''): Promise<AdminPlayerListPayload>
	{
		const response = await send('GET', `${ADMIN_PLAYERS_PATH}?${query}`, { browser: admin });

		assert.strictEqual(response.status, 200);

		return((await response.json()) as AdminPlayerListPayload);
	}

	it('lists every account by username ignoring case, with how each logs in', async () =>
	{
		const linked = await addPlayer('Grace Hopper');

		await createPlayer({
			username: 'ada',
			displayName: 'Ada Lovelace',
			email: 'ada@example.com',
			passwordHash: 'not a real hash'
		});
		await addProviderLogin('google', 'google-grace', linked.id);
		await addProviderLogin('discord', 'discord-grace', linked.id);

		const page = await listPlayers();

		assert.strictEqual(page.total, 3);
		assert.deepStrictEqual(page.players.map((player) => ({
			username: player.username,
			email: player.email,
			password: player.password,
			providers: player.providers,
			twoFactor: player.twoFactor,
			serverAdmin: player.serverAdmin
		})), [
			{
				username: 'ada',
				email: 'ada@example.com',
				password: true,
				providers: [],
				twoFactor: false,
				serverAdmin: false
			},
			{
				username: 'Grace_Hopper',
				email: null,
				password: false,
				providers: ['google', 'discord'],
				twoFactor: false,
				serverAdmin: false
			},
			{
				username: 'Player_Admin',
				email: null,
				password: false,
				providers: [],
				twoFactor: true,
				serverAdmin: true
			}
		]);
	});

	it('says when each account last logged in', async () =>
	{
		const ada = await addPlayer('Ada Lovelace');
		const latest = new Date('2026-10-30T12:00:00.000Z');

		await addPlayer('Grace Hopper');
		await saveLastLogin(ada.id, latest);

		const logins = new Map((await listPlayers()).players.map((player) => [player.username, player.lastLoginAt]));

		assert.strictEqual(logins.get('Ada_Lovelace'), latest.toISOString());
		assert.strictEqual(logins.get('Grace_Hopper'), null);
	});

	it('says which accounts have a window connected', async () =>
	{
		const ada = await addPlayer('Ada Lovelace');
		const grace = await addPlayer('Grace Hopper');
		const playing = await logInBrowser(grace.id);

		await addPlayer('Alan Turing');
		await logInBrowser(ada.id);
		connectedSessions.connect(playing.sessionId);

		try
		{
			assert.deepStrictEqual((await listPlayers()).players.map((player) => [player.username, player.active]), [
				['Ada_Lovelace', false],
				['Alan_Turing', false],
				['Grace_Hopper', true],
				['Player_Admin', false]
			]);
		}
		finally
		{
			connectedSessions.disconnect(playing.sessionId);
		}
	});

	it('searches usernames, names and email addresses, and narrows the list to server admins or others', async () =>
	{
		await createPlayer({
			username: 'ada',
			displayName: 'Countess',
			email: 'Lovelace@Example.com',
			passwordHash: null
		});
		await addPlayer('Grace Hopper');

		assert.deepStrictEqual((await listPlayers('search=lovelace@')).players.map((player) => player.username), ['ada']);
		assert.deepStrictEqual((await listPlayers('search=count')).players.map((player) => player.username), ['ada']);
		assert.deepStrictEqual((await listPlayers('search=grace')).players.map((player) => player.username), ['Grace_Hopper']);
		assert.deepStrictEqual((await listPlayers('serverAdmin=true')).players.map((player) => player.username), ['Player_Admin']);
		assert.strictEqual((await listPlayers('serverAdmin=false')).total, 2);
	});
});
