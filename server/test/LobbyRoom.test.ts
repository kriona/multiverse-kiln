import assert from 'assert';
import { randomUUID } from 'crypto';
import type { ColyseusTestServer } from '@colyseus/testing';
import { Client as SDKClient, type Room as ClientRoom } from '@colyseus/sdk';

import { GAME_ROOM_NAME, LOBBY_ROOM_NAME, LobbyMessageType, LobbyServerMessageType, LobbyState, MAX_CHAT_MESSAGE_LENGTH, MAX_GROUP_PLAYERS, MAX_PLAYER_NAME_LENGTH, NoticeReason, type AccountPayload, type AccountPlayer, type ChatHistoryPayload, type ChatMessage, type NoticePayload } from '@multiverse-kiln/shared';
import type appConfig from '../src/app.config.js';
import { BROWSER_ID_COOKIE } from '../src/http/browserId.js';
import { onlinePlayers } from '../src/players/onlinePlayers.js';
import { CHAT_HISTORY_LENGTH, type LobbyRoom } from '../src/rooms/LobbyRoom.js';
import { getTestServer, logOutEveryone, testServerUrl } from './testServer.js';

type LobbyClient = ClientRoom<unknown, LobbyState>;

/**
 * Collects the messages the lobby sends one window, so a test can wait for them in order
 */
class Inbox
{
	private readonly received = new Map<string, unknown[]>();
	private readonly waiting = new Map<string, Array<(payload: unknown) => void>>();

	/**
	 * Starts listening for every lobby message type
	 *
	 * @param room Client-side lobby room
	 */
	constructor(room: LobbyClient)
	{
		for (const type of Object.values(LobbyServerMessageType))
		{
			room.onMessage(type, (payload: unknown) =>
			{
				const resolve = this.waiting.get(type)?.shift();

				if (resolve)
				{
					resolve(payload);
				}
				else
				{
					this.received.set(type, [...(this.received.get(type) ?? []), payload]);
				}
			});
		}
	}

	/**
	 * Takes the oldest message of a type not taken yet, waiting for one if there is none
	 *
	 * @param type Message type
	 * @param timeoutMs How long to wait before failing
	 * @return The message's payload
	 */
	take<T>(type: LobbyServerMessageType, timeoutMs: number = 2000): Promise<T>
	{
		const queued = this.received.get(type);

		if (queued && (queued.length > 0))
		{
			return(Promise.resolve(queued.shift() as T));
		}

		return(new Promise<T>((resolve, reject) =>
		{
			const waiter = (payload: unknown) =>
			{
				clearTimeout(timer);
				resolve(payload as T);
			};
			const timer = setTimeout(() =>
			{
				const waiters = this.waiting.get(type) ?? [];

				waiters.splice(waiters.indexOf(waiter), 1);
				reject(new Error(`no ${type} message within ${timeoutMs}ms`));
			}, timeoutMs);

			this.waiting.set(type, [...(this.waiting.get(type) ?? []), waiter]);
		}));
	}

	/**
	 * Takes the next Account message's player
	 *
	 * @return The player, or null when the browser isn't logged in
	 */
	async takeAccount(): Promise<AccountPlayer | null>
	{
		return((await this.take<AccountPayload>(LobbyServerMessageType.Account)).player);
	}

	/**
	 * How many messages of a type have arrived and not been taken
	 *
	 * @param type Message type
	 * @return The number of messages
	 */
	pending(type: LobbyServerMessageType): number
	{
		return(this.received.get(type)?.length ?? 0);
	}
}

/**
 * A browser window connected to the lobby
 */
interface LobbyWindow
{
	room: LobbyClient;
	inbox: Inbox;
}

/**
 * Opens a window of a browser: joins the lobby with the browser's ID cookie
 *
 * @param browserId Browser ID the window's cookie holds
 * @return The window, with the Account message it is sent on joining already taken
 */
async function openWindow(browserId: string): Promise<LobbyWindow & { account: AccountPlayer | null }>
{
	const sdk = new SDKClient(testServerUrl.replace(/^http/, 'ws'), { headers: { cookie: `${BROWSER_ID_COOKIE}=${browserId}` } });
	const room = await sdk.joinOrCreate<LobbyState>(LOBBY_ROOM_NAME, {}, LobbyState);
	const inbox = new Inbox(room);
	const account = await inbox.takeAccount();

	return({ room, inbox, account });
}

/**
 * Opens a window of a new browser and logs it in
 *
 * @param name The player's name
 * @return The window and its player
 */
async function logInNewBrowser(name: string): Promise<LobbyWindow & { browserId: string; player: AccountPlayer }>
{
	const browserId = randomUUID();
	const window = await openWindow(browserId);

	window.room.send(LobbyMessageType.Login, { name });

	const player = await window.inbox.takeAccount();

	assert.ok(player);
	await window.inbox.take(LobbyServerMessageType.ChatHistory);

	return({ ...window, browserId, player });
}

/**
 * Waits for one round trip to the lobby, so that messages sent before it have been handled
 *
 * @param colyseus Test server
 * @param window A window in the lobby
 */
async function settle(colyseus: ColyseusTestServer<typeof appConfig>, window: LobbyWindow): Promise<void>
{
	const room = colyseus.getRoomById<LobbyRoom>(window.room.roomId);

	await room.waitForNextPatch();
	await room.waitForNextPatch();
}

describe('LobbyRoom', () =>
{
	let colyseus: ColyseusTestServer<typeof appConfig>;

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

		await assert.rejects(sdk.joinOrCreate(LOBBY_ROOM_NAME));
	});

	it('is a single room shared by every window', async () =>
	{
		const window1 = await openWindow(randomUUID());
		const window2 = await openWindow(randomUUID());

		assert.strictEqual(window1.room.roomId, window2.room.roomId);
		await assert.rejects(colyseus.sdk.create(LOBBY_ROOM_NAME));
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

			window1.room.send(LobbyMessageType.Login, { name: '  Ada  ' });

			const player1 = await window1.inbox.takeAccount();
			const player2 = await window2.inbox.takeAccount();

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

				window.room.send(LobbyMessageType.Login, { name });
				await settle(colyseus, window);

				assert.strictEqual(onlinePlayers.get(browserId), undefined);
				assert.strictEqual(window.inbox.pending(LobbyServerMessageType.Account), 0);
			});
		}

		it('logs the browser out once its last window leaves', async () =>
		{
			const { browserId, room } = await logInNewBrowser('Ada');
			const other = await logInNewBrowser('Grace');
			const second = await openWindow(browserId);

			await room.leave();
			await settle(colyseus, other);

			assert.ok(onlinePlayers.get(browserId));

			await second.room.leave();
			await settle(colyseus, other);

			assert.strictEqual(onlinePlayers.get(browserId), undefined);
		});
	});

	describe('online list', () =>
	{
		it('shows logged-in windows who is online', async () =>
		{
			const ada = await logInNewBrowser('Ada');
			const grace = await logInNewBrowser('Grace');

			await settle(colyseus, ada);

			assert.strictEqual(ada.room.state.players.size, 2);
			assert.strictEqual(ada.room.state.players.get(grace.player.playerId)?.name, 'Grace');
		});

		it('hides the online list from windows that are not logged in', async () =>
		{
			await logInNewBrowser('Ada');

			const window = await openWindow(randomUUID());

			await settle(colyseus, window);

			assert.strictEqual(window.room.state.players?.size ?? 0, 0);
		});

		it('removes a player who logs out', async () =>
		{
			const ada = await logInNewBrowser('Ada');
			const grace = await logInNewBrowser('Grace');

			await grace.room.leave();
			await settle(colyseus, ada);
			await settle(colyseus, ada);

			assert.strictEqual(ada.room.state.players.has(grace.player.playerId), false);
		});
	});

	describe('chat', () =>
	{
		it('sends a message to every logged-in window, but not to windows that are not logged in', async () =>
		{
			const ada = await logInNewBrowser('Ada');
			const grace = await logInNewBrowser('Grace');
			const loggedOut = await openWindow(randomUUID());

			ada.room.send(LobbyMessageType.Chat, { text: ' Hello! ' });

			const received = await grace.inbox.take<ChatMessage>(LobbyServerMessageType.Chat);
			const echoed = await ada.inbox.take<ChatMessage>(LobbyServerMessageType.Chat);

			assert.strictEqual(received.text, 'Hello!');
			assert.strictEqual(received.name, 'Ada');
			assert.strictEqual(received.playerId, ada.player.playerId);
			assert.deepStrictEqual(echoed, received);
			assert.strictEqual(loggedOut.inbox.pending(LobbyServerMessageType.Chat), 0);
		});

		it('ignores chat from a window that is not logged in', async () =>
		{
			const ada = await logInNewBrowser('Ada');
			const loggedOut = await openWindow(randomUUID());

			loggedOut.room.send(LobbyMessageType.Chat, { text: 'Hello' });
			await settle(colyseus, ada);

			assert.strictEqual(ada.inbox.pending(LobbyServerMessageType.Chat), 0);
		});

		it('ignores a message that is too long', async () =>
		{
			const ada = await logInNewBrowser('Ada');

			ada.room.send(LobbyMessageType.Chat, { text: 'x'.repeat(MAX_CHAT_MESSAGE_LENGTH + 1) });
			ada.room.send(LobbyMessageType.Chat, { text: 'x'.repeat(MAX_CHAT_MESSAGE_LENGTH) });

			const received = await ada.inbox.take<ChatMessage>(LobbyServerMessageType.Chat);

			assert.strictEqual(received.text.length, MAX_CHAT_MESSAGE_LENGTH);
		});

		it('sends the recent chat to a player who logs in', async () =>
		{
			const ada = await logInNewBrowser('Ada');

			ada.room.send(LobbyMessageType.Chat, { text: 'first' });
			ada.room.send(LobbyMessageType.Chat, { text: 'second' });
			await ada.inbox.take(LobbyServerMessageType.Chat);
			await ada.inbox.take(LobbyServerMessageType.Chat);

			const window = await openWindow(randomUUID());

			window.room.send(LobbyMessageType.Login, { name: 'Grace' });

			const history = await window.inbox.take<ChatHistoryPayload>(LobbyServerMessageType.ChatHistory);

			assert.deepStrictEqual(history.messages.map((message) => message.text), ['first', 'second']);
		});

		it('keeps only the most recent messages', async () =>
		{
			const players = await Promise.all(Array.from({ length: 11 }, (_, i) => logInNewBrowser(`Player ${i}`)));
			let sent = 0;

			// Each player may send 5 messages at a time
			for (const player of players)
			{
				for (let i = 0; i < 5; i++)
				{
					player.room.send(LobbyMessageType.Chat, { text: `message ${++sent}` });
					await player.inbox.take(LobbyServerMessageType.Chat);
				}
			}

			const { room, inbox } = await openWindow(randomUUID());

			room.send(LobbyMessageType.Login, { name: 'Late' });

			const history = await inbox.take<ChatHistoryPayload>(LobbyServerMessageType.ChatHistory);

			assert.strictEqual(history.messages.length, CHAT_HISTORY_LENGTH);
			assert.strictEqual(history.messages[0].text, `message ${sent - CHAT_HISTORY_LENGTH + 1}`);
			assert.strictEqual(history.messages[CHAT_HISTORY_LENGTH - 1].text, `message ${sent}`);
		});

		it('drops messages sent too quickly, and says so', async () =>
		{
			const ada = await logInNewBrowser('Ada');

			for (let i = 0; i < 6; i++)
			{
				ada.room.send(LobbyMessageType.Chat, { text: `message ${i}` });
			}

			const notice = await ada.inbox.take<NoticePayload>(LobbyServerMessageType.Notice);

			assert.strictEqual(notice.reason, NoticeReason.ChatTooFast);
			await settle(colyseus, ada);
			assert.strictEqual(ada.inbox.pending(LobbyServerMessageType.Chat), 5);
		});
	});

	describe('groups', () =>
	{
		it('creates a group and puts the player in it, in every window', async () =>
		{
			const ada = await logInNewBrowser('Ada');
			const second = await openWindow(ada.browserId);

			ada.room.send(LobbyMessageType.CreateGroup);

			const player = await ada.inbox.takeAccount();
			const inSecond = await second.inbox.takeAccount();

			assert.ok(player?.groupId);
			assert.deepStrictEqual(inSecond, player);
			assert.strictEqual(colyseus.getRoomById(player.groupId).roomName, GAME_ROOM_NAME);
		});

		it('does not create a group for a window that is not logged in', async () =>
		{
			const window = await openWindow(randomUUID());

			window.room.send(LobbyMessageType.CreateGroup);
			await settle(colyseus, window);

			assert.strictEqual(window.inbox.pending(LobbyServerMessageType.Account), 0);
		});

		it('puts a player in an existing group', async () =>
		{
			const ada = await logInNewBrowser('Ada');
			const grace = await logInNewBrowser('Grace');

			ada.room.send(LobbyMessageType.CreateGroup);

			const groupId = (await ada.inbox.takeAccount())?.groupId;

			assert.ok(groupId);

			grace.room.send(LobbyMessageType.JoinGroup, { groupId });

			assert.strictEqual((await grace.inbox.takeAccount())?.groupId, groupId);
		});

		it('moves a player who joins another group out of their first one', async () =>
		{
			const ada = await logInNewBrowser('Ada');
			const grace = await logInNewBrowser('Grace');

			ada.room.send(LobbyMessageType.CreateGroup);
			grace.room.send(LobbyMessageType.CreateGroup);

			const adaGroupId = (await ada.inbox.takeAccount())?.groupId;
			const graceGroupId = (await grace.inbox.takeAccount())?.groupId;

			assert.ok(adaGroupId && graceGroupId);

			grace.room.send(LobbyMessageType.JoinGroup, { groupId: adaGroupId });

			assert.strictEqual((await grace.inbox.takeAccount())?.groupId, adaGroupId);
			assert.strictEqual(onlinePlayers.countInGroup(graceGroupId), 0);
		});

		it('says so when the group does not exist', async () =>
		{
			const ada = await logInNewBrowser('Ada');

			ada.room.send(LobbyMessageType.JoinGroup, { groupId: 'missing' });

			assert.strictEqual((await ada.inbox.take<NoticePayload>(LobbyServerMessageType.Notice)).reason, NoticeReason.GroupNotFound);
			assert.strictEqual(onlinePlayers.get(ada.browserId)?.groupId, undefined);
		});

		it('does not treat the lobby as a group', async () =>
		{
			const ada = await logInNewBrowser('Ada');

			ada.room.send(LobbyMessageType.JoinGroup, { groupId: ada.room.roomId });

			assert.strictEqual((await ada.inbox.take<NoticePayload>(LobbyServerMessageType.Notice)).reason, NoticeReason.GroupNotFound);
		});

		it(`says so when the group already has ${MAX_GROUP_PLAYERS} players`, async () =>
		{
			const players = await Promise.all(Array.from({ length: MAX_GROUP_PLAYERS + 1 }, (_, i) => logInNewBrowser(`Player ${i}`)));
			const [creator, ...others] = players;
			const latecomer = others.pop();

			assert.ok(latecomer);

			creator.room.send(LobbyMessageType.CreateGroup);

			const groupId = (await creator.inbox.takeAccount())?.groupId;

			assert.ok(groupId);

			for (const player of others)
			{
				player.room.send(LobbyMessageType.JoinGroup, { groupId });
				await player.inbox.takeAccount();
			}

			latecomer.room.send(LobbyMessageType.JoinGroup, { groupId });

			assert.strictEqual((await latecomer.inbox.take<NoticePayload>(LobbyServerMessageType.Notice)).reason, NoticeReason.GroupFull);
			assert.strictEqual(onlinePlayers.countInGroup(groupId), MAX_GROUP_PLAYERS);
		});

		it('takes a player out of their group', async () =>
		{
			const ada = await logInNewBrowser('Ada');

			ada.room.send(LobbyMessageType.CreateGroup);
			await ada.inbox.takeAccount();

			ada.room.send(LobbyMessageType.LeaveGroup);

			assert.strictEqual((await ada.inbox.takeAccount())?.groupId, null);
		});

		it('takes a player out of their group when they log out', async () =>
		{
			const ada = await logInNewBrowser('Ada');
			const grace = await logInNewBrowser('Grace');

			ada.room.send(LobbyMessageType.CreateGroup);

			const groupId = (await ada.inbox.takeAccount())?.groupId;

			assert.ok(groupId);

			await ada.room.leave();
			await settle(colyseus, grace);

			assert.strictEqual(onlinePlayers.countInGroup(groupId), 0);
		});
	});
});
