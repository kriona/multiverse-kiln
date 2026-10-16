import assert from 'assert';
import { randomUUID } from 'crypto';
import type { ColyseusTestServer } from '@colyseus/testing';
import { Client as SDKClient, type Room as ClientRoom } from '@colyseus/sdk';

import { GAME_ROOM_NAME, MAX_GROUP_PLAYERS, MAX_PLAYER_NAME_LENGTH, NoticeReason, SESSION_ROOM_NAME, SessionMessageType, SessionServerMessageType, type AccountPayload, type AccountPlayer, type NoticePayload } from '@multiverse-kiln/shared';
import type appConfig from '../src/app.config.js';
import { BROWSER_ID_COOKIE } from '../src/http/browserId.js';
import { onlinePlayers } from '../src/players/onlinePlayers.js';
import type { GameRoom } from '../src/rooms/GameRoom.js';
import type { SessionRoom } from '../src/rooms/SessionRoom.js';
import { addPlayableUniverse } from './db/fixtures.js';
import { Inbox } from './inbox.js';
import { getTestServer, logOutEveryone, testServerUrl } from './testServer.js';
import { waitUntil } from './waitUntil.js';

/**
 * A browser window connected to the session room
 */
interface SessionWindow
{
	room: ClientRoom;
	inbox: Inbox<SessionServerMessageType>;
}

/**
 * Opens a window of a browser: joins the session room with the browser's ID cookie
 *
 * @param browserId Browser ID the window's cookie holds
 * @return The window, with the Account message it is sent on joining already taken
 */
async function openWindow(browserId: string): Promise<SessionWindow & { account: AccountPlayer | null }>
{
	const sdk = new SDKClient(testServerUrl.replace(/^http/, 'ws'), { headers: { cookie: `${BROWSER_ID_COOKIE}=${browserId}` } });
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
 * Opens a window of a new browser and logs it in
 *
 * @param name The player's name
 * @return The window and its player
 */
async function logInNewBrowser(name: string): Promise<SessionWindow & { browserId: string; player: AccountPlayer }>
{
	const browserId = randomUUID();
	const window = await openWindow(browserId);

	window.room.send(SessionMessageType.Login, { name });

	const player = await takeAccount(window.inbox);

	assert.ok(player);

	return({ ...window, browserId, player });
}

describe('SessionRoom', () =>
{
	let colyseus: ColyseusTestServer<typeof appConfig>;

	/**
	 * Sends a message from a window and waits until the session room has handled it
	 *
	 * @param window The window
	 * @param type The message type
	 * @param payload The message's payload
	 */
	async function sendAndSettle(window: SessionWindow, type: SessionMessageType, payload: unknown): Promise<void>
	{
		const handled = colyseus.getRoomById<SessionRoom>(window.room.roomId).waitForNextMessage();

		window.room.send(type, payload);
		await handled;
	}

	/**
	 * Creates a group's game room, as a universe's lobby would
	 *
	 * @return The room's ID, which is the group's ID
	 */
	async function createGroup(): Promise<string>
	{
		const { universeId } = await addPlayableUniverse();
		const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, { universeId });

		return(room.roomId);
	}

	before(async () =>
	{
		colyseus = await getTestServer();
	});

	beforeEach(async () =>
	{
		await colyseus.cleanup();
		logOutEveryone();
	});

	it('turns away a client without a browser ID', async () =>
	{
		const sdk = new SDKClient(testServerUrl.replace(/^http/, 'ws'));

		await assert.rejects(sdk.joinOrCreate(SESSION_ROOM_NAME));
	});

	it('is a single room shared by every window', async () =>
	{
		const window1 = await openWindow(randomUUID());
		const window2 = await openWindow(randomUUID());

		assert.strictEqual(window1.room.roomId, window2.room.roomId);
		await assert.rejects(colyseus.sdk.create(SESSION_ROOM_NAME));
	});

	it('tells a window that is not logged in', async () =>
	{
		const window = await openWindow(randomUUID());

		assert.strictEqual(window.account, null);
	});

	describe('logging in', () =>
	{
		it('logs in every window of the browser', async () =>
		{
			const browserId = randomUUID();
			const window1 = await openWindow(browserId);
			const window2 = await openWindow(browserId);

			window1.room.send(SessionMessageType.Login, { name: '  Ada  ' });

			const player1 = await takeAccount(window1.inbox);
			const player2 = await takeAccount(window2.inbox);

			assert.strictEqual(player1?.name, 'Ada');
			assert.strictEqual(player1?.groupId, null);
			assert.deepStrictEqual(player2, player1);
		});

		it('tells a window opened later that it is already logged in', async () =>
		{
			const { browserId, player } = await logInNewBrowser('Ada');
			const window = await openWindow(browserId);

			assert.deepStrictEqual(window.account, player);
		});

		it('logs a name in as the same player every time, whatever the capitals', async () =>
		{
			const first = await logInNewBrowser('Ada');

			// Forgetting who is online is what a server restart does; the player is in the database
			logOutEveryone();

			const second = await logInNewBrowser('ADA');

			assert.strictEqual(second.player.playerId, first.player.playerId);
			assert.strictEqual(second.player.name, 'Ada');
		});

		it('gives different names different players', async () =>
		{
			const ada = await logInNewBrowser('Ada');
			const grace = await logInNewBrowser('Grace');

			assert.notStrictEqual(ada.player.playerId, grace.player.playerId);
		});

		it('does not log in a player who is logged in from another browser, and says so', async () =>
		{
			await logInNewBrowser('Ada');

			const browserId = randomUUID();
			const window = await openWindow(browserId);

			window.room.send(SessionMessageType.Login, { name: 'ada' });

			assert.strictEqual((await window.inbox.take<NoticePayload>(SessionServerMessageType.Notice)).reason, NoticeReason.NameInUse);
			assert.strictEqual(onlinePlayers.get(browserId), undefined);
			assert.strictEqual(window.inbox.pending(SessionServerMessageType.Account), 0);
		});

		for (const [label, name] of [
			['an empty name', ''],
			['a name of only spaces', '   '],
			['a name that is too long', 'x'.repeat(MAX_PLAYER_NAME_LENGTH + 1)],
			['a name with a control character', 'Ada\nLovelace'],
			['a name with a bidirectional override', `Ada${String.fromCharCode(0x202E)}`],
			['a name that is not a string', 42]
		] as const)
		{
			it(`does not log in with ${label}`, async () =>
			{
				const browserId = randomUUID();
				const window = await openWindow(browserId);

				await sendAndSettle(window, SessionMessageType.Login, { name });

				assert.strictEqual(onlinePlayers.get(browserId), undefined);
				assert.strictEqual(window.inbox.pending(SessionServerMessageType.Account), 0);
			});
		}

		it('logs the browser out once its last window leaves', async () =>
		{
			const { browserId, room } = await logInNewBrowser('Ada');
			const second = await openWindow(browserId);
			const sessionRoom = colyseus.getRoomById<SessionRoom>(room.roomId);

			await room.leave();
			await waitUntil(() => (sessionRoom.clients.length === 1));

			assert.ok(onlinePlayers.get(browserId));

			await second.room.leave();
			await waitUntil(() => (onlinePlayers.get(browserId) === undefined));
		});
	});

	describe('groups', () =>
	{
		it('puts a player in an existing group, in every window', async () =>
		{
			const groupId = await createGroup();
			const ada = await logInNewBrowser('Ada');
			const second = await openWindow(ada.browserId);

			ada.room.send(SessionMessageType.JoinGroup, { groupId });

			assert.strictEqual((await takeAccount(ada.inbox))?.groupId, groupId);
			assert.strictEqual((await takeAccount(second.inbox))?.groupId, groupId);
		});

		it('moves a player who joins another group out of their first one', async () =>
		{
			const firstGroupId = await createGroup();
			const secondGroupId = await createGroup();
			const ada = await logInNewBrowser('Ada');

			ada.room.send(SessionMessageType.JoinGroup, { groupId: firstGroupId });
			await takeAccount(ada.inbox);
			ada.room.send(SessionMessageType.JoinGroup, { groupId: secondGroupId });

			assert.strictEqual((await takeAccount(ada.inbox))?.groupId, secondGroupId);
			assert.strictEqual(onlinePlayers.countInGroup(firstGroupId), 0);
		});

		it('says so when the group does not exist', async () =>
		{
			const ada = await logInNewBrowser('Ada');

			ada.room.send(SessionMessageType.JoinGroup, { groupId: 'missing' });

			assert.strictEqual((await ada.inbox.take<NoticePayload>(SessionServerMessageType.Notice)).reason, NoticeReason.GroupNotFound);
			assert.strictEqual(onlinePlayers.get(ada.browserId)?.groupId, undefined);
		});

		it('does not treat the session room as a group', async () =>
		{
			const ada = await logInNewBrowser('Ada');

			ada.room.send(SessionMessageType.JoinGroup, { groupId: ada.room.roomId });

			assert.strictEqual((await ada.inbox.take<NoticePayload>(SessionServerMessageType.Notice)).reason, NoticeReason.GroupNotFound);
		});

		it(`says so when the group already has ${MAX_GROUP_PLAYERS} players`, async () =>
		{
			const groupId = await createGroup();
			const players = await Promise.all(Array.from({ length: MAX_GROUP_PLAYERS + 1 }, (_, i) => logInNewBrowser(`Player ${i}`)));
			const latecomer = players.pop();

			assert.ok(latecomer);

			for (const player of players)
			{
				player.room.send(SessionMessageType.JoinGroup, { groupId });
				await takeAccount(player.inbox);
			}

			latecomer.room.send(SessionMessageType.JoinGroup, { groupId });

			assert.strictEqual((await latecomer.inbox.take<NoticePayload>(SessionServerMessageType.Notice)).reason, NoticeReason.GroupFull);
			assert.strictEqual(onlinePlayers.countInGroup(groupId), MAX_GROUP_PLAYERS);
		});

		it('takes a player out of their group', async () =>
		{
			const groupId = await createGroup();
			const ada = await logInNewBrowser('Ada');

			ada.room.send(SessionMessageType.JoinGroup, { groupId });
			await takeAccount(ada.inbox);
			ada.room.send(SessionMessageType.LeaveGroup);

			assert.strictEqual((await takeAccount(ada.inbox))?.groupId, null);
		});

		it('takes a player out of their group when they log out', async () =>
		{
			const groupId = await createGroup();
			const ada = await logInNewBrowser('Ada');

			ada.room.send(SessionMessageType.JoinGroup, { groupId });
			await takeAccount(ada.inbox);
			await ada.room.leave();

			await waitUntil(() => (onlinePlayers.countInGroup(groupId) === 0));
		});
	});
});
