import assert from 'assert';
import type { ColyseusTestServer } from '@colyseus/testing';
import { Client as SDKClient, type Room as ClientRoom } from '@colyseus/sdk';

import { SESSION_ROOM_NAME, SessionServerMessageType, type AccountPayload, type AccountPlayer } from '@multiverse-kiln/shared';
import type appConfig from '../src/app.config.js';
import { pool } from '../src/db/client.js';
import { addServerAdmin } from '../src/db/serverAdminRepo.js';
import { SESSION_LIFETIMES } from '../src/logic/sessionLifetimes.js';
import { connectedSessions } from '../src/players/connectedSessions.js';
import { Inbox } from './inbox.js';
import { addPlayer, logInBrowser, type TestBrowser } from './players.js';
import { getTestServer, testServerUrl } from './testServer.js';
import { waitUntil } from './waitUntil.js';

/**
 * A browser window connected to the session room
 */
interface SessionWindow
{
	room: ClientRoom;
	inbox: Inbox<SessionServerMessageType>;

	/**
	 * The player the room said the window has on joining
	 */
	account: AccountPlayer | null;
}

/**
 * Opens a window of a browser: joins the session room with the browser's cookies
 *
 * @param cookie The Cookie header the window sends, if any
 * @return The window, with the Account message it is sent on joining already taken
 */
async function openWindow(cookie?: string): Promise<SessionWindow>
{
	const sdk = new SDKClient(testServerUrl.replace(/^http/, 'ws'), ((cookie !== undefined) ? { headers: { cookie } } : undefined));
	const room = await sdk.joinOrCreate(SESSION_ROOM_NAME);
	const inbox = new Inbox(room, Object.values(SessionServerMessageType));
	const account = await takeAccount(inbox);

	return({ room, inbox, account });
}

/**
 * Takes the next Account message's player
 *
 * @param inbox The window's inbox
 * @return The player, or null when the browser isn't logged in
 */
async function takeAccount(inbox: Inbox<SessionServerMessageType>): Promise<AccountPlayer | null>
{
	return((await inbox.take<AccountPayload>(SessionServerMessageType.Account)).player);
}

/**
 * Logs a new browser in as a new player
 *
 * @param name The player's name
 * @return The browser
 */
async function logInNewBrowser(name: string): Promise<TestBrowser>
{
	return(await logInBrowser((await addPlayer(name)).id));
}

describe('SessionRoom', () =>
{
	let colyseus: ColyseusTestServer<typeof appConfig>;

	before(async () =>
	{
		colyseus = await getTestServer();
	});

	beforeEach(async () =>
	{
		await colyseus.cleanup();
	});

	it('admits a window that is not logged in, and tells it so', async () =>
	{
		const window = await openWindow();

		assert.strictEqual(window.account, null);
	});

	it('is a single room shared by every window', async () =>
	{
		const window1 = await openWindow();
		const window2 = await openWindow((await logInNewBrowser('Ada')).cookie);

		assert.strictEqual(window1.room.roomId, window2.room.roomId);
		await assert.rejects(colyseus.sdk.create(SESSION_ROOM_NAME));
	});

	it('tells a logged-in window who its player is, and when its session ends if it isn\'t used again', async () =>
	{
		const browser = await logInNewBrowser('Ada');
		const window = await openWindow(browser.cookie);
		const { sessionExpiresInMs, ...player } = (window.account ?? { sessionExpiresInMs: 0 });

		assert.deepStrictEqual(player, {
			playerId: browser.playerId,
			name: 'Ada',
			serverAdmin: false
		});
		assert.ok((sessionExpiresInMs > (SESSION_LIFETIMES.short.idleMs - 60000)) && (sessionExpiresInMs <= SESSION_LIFETIMES.short.idleMs));
	});

	it('tells a server admin\'s window that they are one', async () =>
	{
		const browser = await logInNewBrowser('Ada');

		await addServerAdmin(browser.playerId);

		assert.strictEqual((await openWindow(browser.cookie)).account?.serverAdmin, true);
	});

	it('treats a session token it doesn\'t know as not logged in', async () =>
	{
		const window = await openWindow('__Host-kiln-session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

		assert.strictEqual(window.account, null);
	});

	it('treats an expired session as not logged in, and deletes it', async () =>
	{
		const browser = await logInNewBrowser('Ada');

		await pool.query('UPDATE sessions SET last_used_at = now() - interval \'2 hours\' WHERE id = $1', [browser.sessionId]);

		const window = await openWindow(browser.cookie);
		const remaining = await pool.query('SELECT id FROM sessions WHERE id = $1', [browser.sessionId]);

		assert.strictEqual(window.account, null);
		assert.strictEqual(remaining.rowCount, 0);
	});

	it('logs in two browsers of one player separately', async () =>
	{
		const playerId = (await addPlayer('Ada')).id;
		const first = await logInBrowser(playerId);
		const second = await logInBrowser(playerId);
		const window1 = await openWindow(first.cookie);
		const window2 = await openWindow(second.cookie);

		assert.strictEqual(window1.account?.playerId, playerId);
		assert.strictEqual(window2.account?.playerId, playerId);
	});

	it('tells every window of a session when it ends, and only that session\'s', async () =>
	{
		const playerId = (await addPlayer('Ada')).id;
		const ending = await logInBrowser(playerId);
		const staying = await logInBrowser(playerId);
		const window1 = await openWindow(ending.cookie);
		const window2 = await openWindow(ending.cookie);
		const other = await openWindow(staying.cookie);

		connectedSessions.end([ending.sessionId]);

		assert.strictEqual(await takeAccount(window1.inbox), null);
		assert.strictEqual(await takeAccount(window2.inbox), null);
		assert.strictEqual(other.inbox.pending(SessionServerMessageType.Account), 0);
	});

	it('counts a session\'s connected windows until the last leaves', async () =>
	{
		const browser = await logInNewBrowser('Ada');
		const window1 = await openWindow(browser.cookie);
		const window2 = await openWindow(browser.cookie);

		assert.ok(connectedSessions.ids().includes(browser.sessionId));

		await window1.room.leave();
		assert.ok(connectedSessions.ids().includes(browser.sessionId));

		await window2.room.leave();
		await waitUntil(() => !connectedSessions.ids().includes(browser.sessionId));
	});
});
