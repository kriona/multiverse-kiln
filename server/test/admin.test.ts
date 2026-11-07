import assert from 'assert';
import { randomUUID } from 'crypto';

import { ADMIN_ADMINS_PATH, ADMIN_ADMINS_SEARCH_PATH, ADMIN_PATH, ADMIN_ROLE, ADMIN_PLAYERS_PATH, ADMIN_SESSIONS_PATH, ADMIN_TWO_FACTOR_ERROR_ID, ADMIN_UNIVERSES_PATH, AUTH_SESSION_PATH, DEFAULT_SITE_SETTINGS, EDITOR_UNIVERSES_PATH, MAX_ADMIN_ROWS_PER_PAGE, MAX_CHARACTER_DELETION_DAYS, MAX_DISABLED_REASON_LENGTH, MAX_EMAIL_LENGTH, MAX_SITE_SOCIAL_URL_LENGTH, MAX_UNIVERSES_PER_CREATOR, PROFILE_PATH, PUBLIC_SITE_SETTINGS_PATH, SITE_SETTINGS_PATH, UNIVERSES_PATH, type AdminPlayerListPayload, type AdminSessionListPayload, type AdminUniverseListPayload, type EditableUniverse, type EditableUniverseListPayload, type ErrorPayload, type OwnProfilePayload, type PlayerSearchPayload, type ServerAdminListPayload, type SessionPayload, type SiteSettings, type UniverseListPayload } from '@multiverse-kiln/shared';

import { findPlayerAdminEvents, findUniverseAdminEvents } from '../src/db/adminEventRepo.js';
import { pool } from '../src/db/client.js';
import { createPlayer, saveLastLogin } from '../src/db/playerRepo.js';
import { addProviderLogin } from '../src/db/providerLoginRepo.js';
import { addServerAdmin, isServerAdmin } from '../src/db/serverAdminRepo.js';
import { listUniverseEdits } from '../src/db/universeEditRepo.js';
import { findUniverseAccess, setUniverseRole } from '../src/db/universeEditorRepo.js';
import { findDisabledReason, setUniverseDisabled } from '../src/db/universeRepo.js';
import { connectedSessions } from '../src/players/connectedSessions.js';
import { serverAdminChanges } from '../src/players/serverAdminChanges.js';
import { areaChanges, type AreaChange } from '../src/world/areaChanges.js';
import { addPlayableUniverse, addUniverse } from './db/fixtures.js';
import { saveChanges } from './editorRequests.js';
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
		for (const path of [ADMIN_PATH, SITE_SETTINGS_PATH, ADMIN_SESSIONS_PATH, ADMIN_PLAYERS_PATH, ADMIN_ADMINS_PATH, `${ADMIN_ADMINS_SEARCH_PATH}?query=ada`, ADMIN_UNIVERSES_PATH])
		{
			assert.strictEqual((await send('GET', path)).status, 401, path);
		}

		assert.strictEqual((await send('PUT', SITE_SETTINGS_PATH, { body: closed })).status, 401);
		assert.strictEqual((await send('POST', ADMIN_ADMINS_PATH, { body: { username: 'ada' } })).status, 401);
		assert.strictEqual((await send('DELETE', `${ADMIN_ADMINS_PATH}/ada`)).status, 401);
		assert.strictEqual((await send('PUT', `${ADMIN_UNIVERSES_PATH}/${randomUUID()}/disabled`, { body: { reason: 'Spam' } })).status, 401);
		assert.strictEqual((await send('DELETE', `${ADMIN_UNIVERSES_PATH}/${randomUUID()}/disabled`)).status, 401);
	});

	it('refuses players who aren\'t server admins, even with 2FA', async () =>
	{
		const player = await addPlayer('Ordinary');

		await turnOnTwoFactor(player.id);

		const browser = await logInBrowser(player.id);

		const universeId = await addUniverse();

		for (const path of [ADMIN_PATH, SITE_SETTINGS_PATH, ADMIN_SESSIONS_PATH, ADMIN_PLAYERS_PATH, ADMIN_ADMINS_PATH, `${ADMIN_ADMINS_SEARCH_PATH}?query=ada`, ADMIN_UNIVERSES_PATH])
		{
			const response = await send('GET', path, { browser });

			assert.strictEqual(response.status, 403, path);
			assert.strictEqual(((await response.json()) as ErrorPayload).error.id, 'error.notServerAdmin');
		}

		assert.strictEqual((await send('PUT', SITE_SETTINGS_PATH, { browser, body: closed })).status, 403);
		assert.strictEqual((await send('POST', ADMIN_ADMINS_PATH, { browser, body: { username: 'Ordinary' } })).status, 403);
		assert.strictEqual((await send('PUT', `${ADMIN_UNIVERSES_PATH}/${universeId}/disabled`, { browser, body: { reason: 'Spam' } })).status, 403);
		assert.strictEqual(await isServerAdmin(player.id), false);
		assert.strictEqual(await findDisabledReason(universeId), null);
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

		for (const path of [ADMIN_PATH, ADMIN_PLAYERS_PATH, ADMIN_ADMINS_PATH, ADMIN_UNIVERSES_PATH])
		{
			const response = await send('GET', path, { browser });

			assert.strictEqual(response.status, 403, path);
			assert.strictEqual(((await response.json()) as ErrorPayload).error.id, ADMIN_TWO_FACTOR_ERROR_ID);
		}

		assert.strictEqual((await send('POST', ADMIN_ADMINS_PATH, { browser, body: { username: 'Unguarded' } })).status, 403);
		assert.strictEqual((await send('DELETE', `${ADMIN_ADMINS_PATH}/Unguarded`, { browser })).status, 403);
		assert.strictEqual(await isServerAdmin(player.id), true);
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
			{ ...closed, privacyContact: 'privacy\u0000@example.com' },
			{ ...closed, privacyContact: 'privacy@‮moc.elpmaxe' },
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

describe('Admin server admin list', () =>
{
	let admin: TestBrowser;

	before(async () =>
	{
		await getTestServer();
	});

	beforeEach(async () =>
	{
		admin = await logInAdmin('Head Admin');
	});

	/**
	 * Lists the server admins as the admin
	 *
	 * @return The admins
	 */
	async function listAdmins(): Promise<ServerAdminListPayload['admins']>
	{
		const response = await send('GET', ADMIN_ADMINS_PATH, { browser: admin });

		assert.strictEqual(response.status, 200);

		return(((await response.json()) as ServerAdminListPayload).admins);
	}

	it('lists the admins by username ignoring case, saying which has 2FA and which is asking', async () =>
	{
		await addServerAdmin((await addPlayer('alan')).id);

		assert.deepStrictEqual((await listAdmins()).map((each) => [each.username, each.displayName, each.twoFactor, each.current]), [
			['alan', 'alan', false, false],
			['Head_Admin', 'Head Admin', true, true]
		]);
	});

	it('finds players who aren\'t admins yet, and refuses searches too short', async () =>
	{
		await addPlayer('Grace Hopper');
		await addServerAdmin((await addPlayer('Grace Admin')).id);

		const response = await send('GET', `${ADMIN_ADMINS_SEARCH_PATH}?query=grace`, { browser: admin });

		assert.strictEqual(response.status, 200);
		assert.deepStrictEqual(((await response.json()) as PlayerSearchPayload).players.map((player) => player.username), ['Grace_Hopper']);
		assert.strictEqual((await send('GET', `${ADMIN_ADMINS_SEARCH_PATH}?query=gr`, { browser: admin })).status, 400);
	});

	it('adds an admin by username, recording who did it', async () =>
	{
		const grace = await addPlayer('Grace Hopper');
		const response = await send('POST', ADMIN_ADMINS_PATH, { browser: admin, body: { username: 'grace_hopper' } });

		assert.strictEqual(response.status, 204);
		assert.strictEqual(await isServerAdmin(grace.id), true);
		assert.deepStrictEqual((await findPlayerAdminEvents(grace.id)).map((event) => [event.kind, event.adminId, event.playerId]), [
			['adminAdded', admin.playerId, grace.id]
		]);
	});

	it('refuses to add a username no one has, or an admin again, recording nothing', async () =>
	{
		const missing = await send('POST', ADMIN_ADMINS_PATH, { browser: admin, body: { username: 'nobody_here' } });
		const again = await send('POST', ADMIN_ADMINS_PATH, { browser: admin, body: { username: 'Head_Admin' } });

		assert.strictEqual(missing.status, 404);
		assert.strictEqual(((await missing.json()) as ErrorPayload).error.id, 'error.noSuchPlayerToMakeAdmin');
		assert.strictEqual(again.status, 409);
		assert.strictEqual(((await again.json()) as ErrorPayload).error.id, 'error.alreadyServerAdmin');
		assert.strictEqual((await send('POST', ADMIN_ADMINS_PATH, { browser: admin, body: { username: '' } })).status, 400);
		assert.deepStrictEqual(await findPlayerAdminEvents(admin.playerId), []);
	});

	it('removes another admin, or the admin asking, recording who did it and telling the editor rooms', async () =>
	{
		const alan = await addPlayer('Alan Turing');
		const lost: string[] = [];
		const stop = serverAdminChanges.onLost((playerId) =>
		{
			lost.push(playerId);
		});

		try
		{
			await addServerAdmin(alan.id);

			assert.strictEqual((await send('DELETE', `${ADMIN_ADMINS_PATH}/Alan_Turing`, { browser: admin })).status, 204);
			assert.strictEqual(await isServerAdmin(alan.id), false);
			assert.deepStrictEqual((await findPlayerAdminEvents(alan.id)).map((event) => [event.kind, event.adminId]), [
				['adminRemoved', admin.playerId]
			]);

			await addServerAdmin(alan.id);

			assert.strictEqual((await send('DELETE', `${ADMIN_ADMINS_PATH}/Head_Admin`, { browser: admin })).status, 204);
			assert.strictEqual(await isServerAdmin(admin.playerId), false);
			assert.strictEqual((await send('GET', ADMIN_ADMINS_PATH, { browser: admin })).status, 403);
			assert.deepStrictEqual(lost, [alan.id, admin.playerId]);
		}
		finally
		{
			stop();
		}
	});

	it('never removes the last admin, and refuses players who aren\'t admins', async () =>
	{
		await addPlayer('Grace Hopper');

		const lost: string[] = [];
		const stop = serverAdminChanges.onLost((playerId) =>
		{
			lost.push(playerId);
		});

		try
		{
			const last = await send('DELETE', `${ADMIN_ADMINS_PATH}/Head_Admin`, { browser: admin });
			const notAdmin = await send('DELETE', `${ADMIN_ADMINS_PATH}/Grace_Hopper`, { browser: admin });

			assert.strictEqual(last.status, 409);
			assert.strictEqual(((await last.json()) as ErrorPayload).error.id, 'error.lastServerAdmin');
			assert.strictEqual(await isServerAdmin(admin.playerId), true);
			assert.strictEqual(notAdmin.status, 404);
			assert.strictEqual((await send('DELETE', `${ADMIN_ADMINS_PATH}/nobody_here`, { browser: admin })).status, 404);
			assert.deepStrictEqual(await findPlayerAdminEvents(admin.playerId), []);
			assert.deepStrictEqual(lost, []);
		}
		finally
		{
			stop();
		}
	});

	it('keeps one admin when two remove each other at once', async () =>
	{
		const other = await logInAdmin('Other Admin');
		const answers = await Promise.all([
			send('DELETE', `${ADMIN_ADMINS_PATH}/Other_Admin`, { browser: admin }),
			send('DELETE', `${ADMIN_ADMINS_PATH}/Head_Admin`, { browser: other })
		]);

		const statuses = answers.map((answer) => answer.status).sort();

		// The one that loses waits for the other's lock and finds itself last, or is already no admin to ask
		assert.strictEqual(statuses[0], 204);
		assert.ok([403, 409].includes(statuses[1]), String(statuses[1]));
		assert.strictEqual((await pool.query('SELECT 1 FROM server_admins')).rowCount, 1);
	});

	it('tells an admin\'s own profile that they are one, for the warning when turning 2FA off', async () =>
	{
		const own = (await (await send('GET', PROFILE_PATH, { browser: admin })).json()) as OwnProfilePayload;
		const other = (await (await send('GET', PROFILE_PATH, { browser: await logInBrowser((await addPlayer('Grace Hopper')).id) })).json()) as OwnProfilePayload;

		assert.strictEqual(own.serverAdmin, true);
		assert.strictEqual(other.serverAdmin, false);
	});
});

describe('Admin universe list', () =>
{
	let admin: TestBrowser;

	before(async () =>
	{
		await getTestServer();
	});

	beforeEach(async () =>
	{
		admin = await logInAdmin('Universe Admin');
	});

	/**
	 * Lists universes as the admin
	 *
	 * @param query The query string
	 * @return The page
	 */
	async function listUniverses(query: string = ''): Promise<AdminUniverseListPayload>
	{
		const response = await send('GET', `${ADMIN_UNIVERSES_PATH}?${query}`, { browser: admin });

		assert.strictEqual(response.status, 200);

		return((await response.json()) as AdminUniverseListPayload);
	}

	/**
	 * Disables a universe as the admin
	 *
	 * @param universeId The universe
	 * @param reason Why
	 * @return The response
	 */
	function disable(universeId: string, reason: unknown): Promise<Response>
	{
		return(send('PUT', `${ADMIN_UNIVERSES_PATH}/${universeId}/disabled`, { browser: admin, body: { reason } }));
	}

	it('lists every universe by name ignoring case, with its creators, searched and filtered', async () =>
	{
		const zed = await addUniverse('zed');
		const kilnhaven = await addUniverse('Kilnhaven');

		await setUniverseRole(kilnhaven, (await addPlayer('Grace Hopper')).id, 'creator');
		await setUniverseRole(kilnhaven, (await addPlayer('ada')).id, 'creator');
		await setUniverseRole(kilnhaven, (await addPlayer('Alan Turing')).id, 'builder');
		await setUniverseDisabled(zed, 'Spam');

		const page = await listUniverses();

		assert.deepStrictEqual(page.universes.map((universe) => [universe.name, universe.stage, universe.disabledReason]), [
			['Kilnhaven', 'in_the_beginning', null],
			['zed', 'in_the_beginning', 'Spam']
		]);
		assert.deepStrictEqual(page.universes[0].creators, [
			{ username: 'ada', displayName: 'ada' },
			{ username: 'Grace_Hopper', displayName: 'Grace Hopper' }
		]);
		assert.ok(page.universes[1].disabledAt !== null);
		assert.deepStrictEqual((await listUniverses('search=KILN')).universes.map((universe) => universe.name), ['Kilnhaven']);
		assert.deepStrictEqual((await listUniverses('disabled=true')).universes.map((universe) => universe.name), ['zed']);
		assert.deepStrictEqual((await listUniverses('disabled=false')).universes.map((universe) => universe.name), ['Kilnhaven']);
		assert.strictEqual((await listUniverses('limit=1&offset=1')).total, 2);
	});

	it('disables a universe with a reason, turning its players out and recording who did it', async () =>
	{
		const universeId = await addUniverse();
		const published: AreaChange[] = [];
		const stop = areaChanges.onChange((change) =>
		{
			published.push(change);
		});

		try
		{
			assert.strictEqual((await disable(universeId, '  Copied from another game\r\nwithout permission  ')).status, 204);
		}
		finally
		{
			stop();
		}

		assert.deepStrictEqual(published, [{ kind: 'universeDisabled', universeId }]);
		assert.strictEqual(await findDisabledReason(universeId), 'Copied from another game\nwithout permission');
		assert.deepStrictEqual((await findUniverseAdminEvents(universeId)).map((event) => [event.kind, event.adminId, event.reason]), [
			['universeDisabled', admin.playerId, 'Copied from another game\nwithout permission']
		]);
	});

	it('refuses a reason that is empty, too long or holds control characters, a universe disabled already, and one that doesn\'t exist', async () =>
	{
		const universeId = await addUniverse();

		assert.strictEqual((await disable(universeId, '   ')).status, 400);
		assert.strictEqual((await disable(universeId, 'x'.repeat(MAX_DISABLED_REASON_LENGTH + 1))).status, 400);
		assert.strictEqual((await disable(universeId, 'Bad\u0007')).status, 400);
		assert.strictEqual((await disable(universeId, 7)).status, 400);
		assert.strictEqual(await findDisabledReason(universeId), null);
		assert.strictEqual((await disable(universeId, 'x'.repeat(MAX_DISABLED_REASON_LENGTH))).status, 204);

		const again = await disable(universeId, 'Again');

		assert.strictEqual(again.status, 409);
		assert.strictEqual(((await again.json()) as ErrorPayload).error.id, 'error.universeAlreadyDisabled');
		assert.strictEqual((await disable(randomUUID(), 'Gone')).status, 404);
		assert.strictEqual((await disable('not-a-universe', 'Gone')).status, 404);
		assert.strictEqual((await findUniverseAdminEvents(universeId)).length, 1);
	});

	it('enables a disabled universe again, and refuses one that isn\'t disabled', async () =>
	{
		const universeId = await addUniverse();

		await setUniverseDisabled(universeId, 'Spam');

		assert.strictEqual((await send('DELETE', `${ADMIN_UNIVERSES_PATH}/${universeId}/disabled`, { browser: admin })).status, 204);
		assert.strictEqual(await findDisabledReason(universeId), null);

		const again = await send('DELETE', `${ADMIN_UNIVERSES_PATH}/${universeId}/disabled`, { browser: admin });

		assert.strictEqual(again.status, 409);
		assert.strictEqual(((await again.json()) as ErrorPayload).error.id, 'error.universeNotDisabled');
		assert.strictEqual((await send('DELETE', `${ADMIN_UNIVERSES_PATH}/${randomUUID()}/disabled`, { browser: admin })).status, 404);
		assert.deepStrictEqual((await findUniverseAdminEvents(universeId)).map((event) => [event.kind, event.adminId, event.reason]), [
			['universeEnabled', admin.playerId, null]
		]);
	});

	it('takes a disabled universe off Home and its page, and refuses characters in it, until it is enabled', async () =>
	{
		const universe = await addPlayableUniverse();
		const player = await logInBrowser((await addPlayer('Grace Hopper')).id);
		const charactersPath = `${UNIVERSES_PATH}/${universe.universeId}/characters`;

		/**
		 * The IDs of the universes Home lists
		 *
		 * @return The IDs
		 */
		const listed = async (): Promise<string[]> => ((await (await send('GET', UNIVERSES_PATH)).json()) as UniverseListPayload).universes.map((each) => each.id);

		assert.ok((await listed()).includes(universe.universeId));
		assert.strictEqual((await disable(universe.universeId, 'Spam')).status, 204);
		assert.ok(!(await listed()).includes(universe.universeId));
		assert.strictEqual((await send('GET', `${UNIVERSES_PATH}/${universe.universeId}`)).status, 404);
		assert.strictEqual((await send('GET', charactersPath, { browser: player })).status, 404);

		assert.strictEqual((await send('DELETE', `${ADMIN_UNIVERSES_PATH}/${universe.universeId}/disabled`, { browser: admin })).status, 204);
		assert.ok((await listed()).includes(universe.universeId));
		assert.strictEqual((await send('GET', charactersPath, { browser: player })).status, 200);
	});

	it('shows a disabled universe\'s editors why, and refuses their saves', async () =>
	{
		const creator = await logInBrowser((await addPlayer('Ada Lovelace')).id);
		const universeId = await addUniverse();

		await setUniverseRole(universeId, creator.playerId, 'creator');
		await disable(universeId, 'Spam');

		const universe = (await (await send('GET', `${EDITOR_UNIVERSES_PATH}/${universeId}`, { browser: creator })).json()) as EditableUniverse;
		const own = (await (await send('GET', EDITOR_UNIVERSES_PATH, { browser: creator })).json()) as EditableUniverseListPayload;
		const saved = await saveChanges(creator, universeId, [{ kind: 'universe', update: { shortDescription: 'Changed' } }]);

		assert.strictEqual(universe.disabledReason, 'Spam');
		assert.deepStrictEqual(own.universes.map((each) => each.disabled), [true]);
		assert.strictEqual(saved.status, 403);
		assert.strictEqual(saved.body.changeIndex, null);
		assert.strictEqual(saved.body.error.id, 'error.universeDisabledSave');

		await send('DELETE', `${ADMIN_UNIVERSES_PATH}/${universeId}/disabled`, { browser: admin });

		assert.strictEqual((await saveChanges(creator, universeId, [{ kind: 'universe', update: { shortDescription: 'Changed' } }])).status, 200);
	});
});

describe('Editing universes as a server admin', () =>
{
	let admin: TestBrowser;

	before(async () =>
	{
		await getTestServer();
	});

	beforeEach(async () =>
	{
		admin = await logInAdmin('Editing Admin');
	});

	/**
	 * Opens a universe in the editor
	 *
	 * @param browser The browser
	 * @param universeId The universe
	 * @return The response, and the universe when it opened
	 */
	async function openEditor(browser: TestBrowser, universeId: string): Promise<{ status: number; universe: EditableUniverse }>
	{
		const response = await send('GET', `${EDITOR_UNIVERSES_PATH}/${universeId}`, { browser });

		return({
			status: response.status,
			universe: ((response.status === 200) ? (await response.json()) as EditableUniverse : ({} as EditableUniverse))
		});
	}

	/**
	 * The roles a universe's recorded saves were made with
	 *
	 * @param universeId The universe
	 * @return The roles, newest save first
	 */
	async function savedRoles(universeId: string): Promise<string[]>
	{
		return((await listUniverseEdits(universeId, { offset: 0, limit: 100 })).edits.map((edit) => edit.role));
	}

	it('opens any universe with the site admin role, which saves as a creator would, recording each save', async () =>
	{
		const universeId = await addUniverse();
		const grace = await addPlayer('Grace Hopper');
		const opened = await openEditor(admin, universeId);
		const saved = await saveChanges(admin, universeId, [
			{ kind: 'universe', update: { shortDescription: 'Cleaned up' } },
			{ kind: 'addEditor', username: 'Grace_Hopper', settings: { role: 'creator', languages: [] } }
		]);

		assert.strictEqual(opened.status, 200);
		assert.strictEqual(opened.universe.role, ADMIN_ROLE);
		assert.strictEqual(opened.universe.serverAdmin, true);
		assert.strictEqual(saved.status, 200);
		assert.strictEqual((await findUniverseAccess(universeId, grace.id))?.role, 'creator');
		assert.strictEqual(await findUniverseAccess(universeId, admin.playerId), undefined);
		assert.deepStrictEqual(await savedRoles(universeId), [ADMIN_ROLE]);
		assert.deepStrictEqual(await findUniverseAdminEvents(universeId), []);
	});

	it('uses the site admin role over a weaker role, but a creator\'s own, recording the role each save used', async () =>
	{
		const built = await addUniverse();
		const created = await addUniverse();

		await setUniverseRole(built, admin.playerId, 'beta_tester');
		await setUniverseRole(created, admin.playerId, 'creator');

		assert.strictEqual((await openEditor(admin, built)).universe.role, ADMIN_ROLE);
		assert.strictEqual((await openEditor(admin, created)).universe.role, 'creator');
		assert.strictEqual((await saveChanges(admin, built, [{ kind: 'universe', update: { name: 'Renamed By Admin' } }])).status, 200);
		assert.strictEqual((await saveChanges(admin, created, [{ kind: 'universe', update: { shortDescription: 'Mine' } }])).status, 200);
		assert.deepStrictEqual(await savedRoles(built), [ADMIN_ROLE]);
		assert.deepStrictEqual(await savedRoles(created), ['creator']);
	});

	it('lets a server admin save a disabled universe, as its creator too, while its other editors can\'t', async () =>
	{
		const universeId = await addUniverse();
		const creator = await logInBrowser((await addPlayer('Ada Lovelace')).id);

		await setUniverseRole(universeId, creator.playerId, 'creator');
		await setUniverseRole(universeId, admin.playerId, 'creator');
		await setUniverseDisabled(universeId, 'Spam');

		assert.strictEqual((await saveChanges(admin, universeId, [{ kind: 'universe', update: { shortDescription: 'Fixed' } }])).status, 200);
		assert.strictEqual((await saveChanges(creator, universeId, [{ kind: 'universe', update: { shortDescription: 'Mine' } }])).status, 403);
		assert.strictEqual((await openEditor(creator, universeId)).universe.serverAdmin, false);
	});

	it('gives no site admin role to an admin without 2FA', async () =>
	{
		const player = await addPlayer('Unguarded Admin');
		const browser = await logInBrowser(player.id);
		const universeId = await addUniverse();

		await addServerAdmin(player.id);

		assert.strictEqual((await openEditor(browser, universeId)).status, 404);
		assert.strictEqual((await saveChanges(browser, universeId, [{ kind: 'universe', update: { shortDescription: 'Sneaky' } }])).status, 404);
		assert.deepStrictEqual(await savedRoles(universeId), []);
	});
});
