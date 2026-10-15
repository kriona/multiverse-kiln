import assert from 'assert';
import type { ColyseusTestServer } from '@colyseus/testing';
import { Client as SDKClient, type Room as ClientRoom } from '@colyseus/sdk';

import { GAME_ROOM_NAME, GameState, MessageType, PLAYER_RADIUS, ServerCloseCode, ServerMessageType, WORLD_HEIGHT, WORLD_WIDTH, type Player, type WelcomePayload } from '@multiverse-kiln/shared';
import type appConfig from '../src/app.config.js';
import { BROWSER_ID_COOKIE } from '../src/http/browserId.js';
import type { GameRoom } from '../src/rooms/GameRoom.js';
import { getTestServer, testServerUrl } from './testServer.js';

const browserIdA = '0b6f4c1e-8d2a-4f3b-9c5d-7e1a2b3c4d5e';
const browserIdB = '6a1d2e3f-4b5c-4d6e-8f70-819a2b3c4d5e';

/**
 * The player a client controls, as the server's room records it
 *
 * @param room Server-side room
 * @param client Client-side room of a client still in the room
 * @return The player's ID in state.players
 */
function playerIdOf(room: GameRoom, client: ClientRoom): string
{
	const playerId = room.getPlayerId(client.sessionId);

	assert.ok(playerId, `no player for session ${client.sessionId}`);

	return(playerId);
}

/**
 * Joins a room like a browser window holding a browser ID cookie, listening for its Welcome message
 *
 * @param room Server-side room to join
 * @param browserId Browser ID the window's cookie holds
 * @return The client-side room, and the Welcome payload once it arrives
 */
async function joinFromBrowser(room: GameRoom, browserId: string): Promise<{ client: ClientRoom<unknown, GameState>; welcome: Promise<WelcomePayload> }>
{
	const sdk = new SDKClient(testServerUrl.replace(/^http/, 'ws'), { headers: { cookie: `${BROWSER_ID_COOKIE}=${browserId}` } });
	const client = await sdk.joinById<GameState>(room.roomId, {}, GameState);

	// Registered straight after joining: the server sends Welcome once the client has acknowledged the join
	const welcome = new Promise<WelcomePayload>((resolve) =>
	{
		client.onMessage(ServerMessageType.Welcome, resolve);
	});

	await client.waitForInitialState();

	return({ client, welcome });
}

/**
 * Resolves when a client-side room is left (by the client or because the server closed it)
 *
 * @param room Client-side room
 * @return The WebSocket close code
 */
function waitForLeave(room: ClientRoom): Promise<number>
{
	return(new Promise((resolve) =>
	{
		room.onLeave((code) =>
		{
			resolve(code);
		});
	}));
}

/**
 * Resolves once a condition is true, checking every few milliseconds
 *
 * For server-side effects with no event to wait on, such as onLeave after the room has emptied
 * (an empty room is disposed, so waiting for its next timestep would never resolve)
 *
 * @param condition Returns true when the wait is over
 * @param timeoutMs How long to wait before failing
 */
async function waitUntil(condition: () => boolean, timeoutMs: number = 2000): Promise<void>
{
	const deadline = Date.now() + timeoutMs;

	while (!condition())
	{
		if (Date.now() > deadline)
		{
			throw new Error(`condition not met within ${timeoutMs}ms`);
		}

		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

describe('GameRoom', () =>
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

	it('adds a player inside the world when a client joins', async () =>
	{
		const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {});
		const client = await colyseus.connectTo(room);
		const player = room.state.players.get(playerIdOf(room, client));

		// The whole player is inside the world, not just its center
		assert.ok(player);
		assert.ok((player.x >= PLAYER_RADIUS) && (player.x <= WORLD_WIDTH - PLAYER_RADIUS), `x = ${player.x}`);
		assert.ok((player.y >= PLAYER_RADIUS) && (player.y <= WORLD_HEIGHT - PLAYER_RADIUS), `y = ${player.y}`);
	});

	it('syncs players to clients', async () =>
	{
		const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {});
		const client1 = await colyseus.connectTo(room);
		const client2 = await colyseus.connectTo(room);

		await room.waitForNextPatch();

		const players = client1.state.players;

		assert.strictEqual(players.size, 2);
		assert.ok(players.has(playerIdOf(room, client1)));
		assert.ok(players.has(playerIdOf(room, client2)));
	});

	it('moves a player in the direction they send', async () =>
	{
		const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {});
		const client = await colyseus.connectTo(room);
		const player = room.state.players.get(playerIdOf(room, client)) as Player;

		player.x = 100;
		player.y = 100;

		client.send(MessageType.Move, { x: 1, y: 0 });
		await room.waitForNextMessage();
		await room.waitForNextTimestep();
		await room.waitForNextTimestep();

		assert.ok(player.x > 100, `x = ${player.x}`);
		assert.strictEqual(player.y, 100);

		client.send(MessageType.Move, { x: 0, y: 0 });
		await room.waitForNextMessage();
		await room.waitForNextTimestep();

		const stoppedAt = player.x;

		await room.waitForNextTimestep();

		assert.strictEqual(player.x, stoppedAt);
	});

	it('removes the player when the client leaves', async () =>
	{
		const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {});
		const client1 = await colyseus.connectTo(room);
		const client2 = await colyseus.connectTo(room);
		const playerId1 = playerIdOf(room, client1);

		await client1.leave();
		await room.waitForNextTimestep();

		assert.strictEqual(room.state.players.has(playerId1), false);
		assert.strictEqual(room.state.players.has(playerIdOf(room, client2)), true);
	});

	describe('invalid Move payloads', () =>
	{
		const originalWarn = console.warn;
		let warnings: string[];

		beforeEach(() =>
		{
			warnings = [];
			console.warn = (...args: unknown[]) =>
			{
				const warning = args.join(' ');

				// The SDK's clients run in this process too, and warn about the Welcome message these tests don't listen for
				if (!warning.startsWith('@colyseus/sdk:'))
				{
					warnings.push(warning);
				}
			};
		});

		afterEach(() =>
		{
			console.warn = originalWarn;
		});

		for (const [label, payload] of [
			['an out-of-range direction', { x: 5, y: 0 }],
			['a direction sent as a string', { x: '1', y: 0 }],
			['a missing field', { x: 1 }],
			['a payload that is not an object', 'left']
		] as const)
		{
			it(`ignores ${label} and keeps the client connected`, async () =>
			{
				const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {});
				const client = await colyseus.connectTo(room);
				const player = room.state.players.get(playerIdOf(room, client)) as Player;

				player.x = 100;
				player.y = 100;

				client.send(MessageType.Move, payload);
				await room.waitForNextMessage();
				await room.waitForNextTimestep();

				assert.strictEqual(player.x, 100);
				assert.strictEqual(player.y, 100);
				assert.strictEqual(warnings.length, 1);
				assert.ok(warnings[0].startsWith(`${client.sessionId} sent an invalid move message (1 of 10), ignored: `), warnings[0]);

				// Still connected: a valid Move after the invalid one is applied
				client.send(MessageType.Move, { x: 1, y: 0 });
				await room.waitForNextMessage();
				await room.waitForNextTimestep();

				assert.ok(player.x > 100, `x = ${player.x}`);
				assert.ok(room.state.players.has(playerIdOf(room, client)));
			});
		}

		it('does not log the payload', async () =>
		{
			const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {});
			const client = await colyseus.connectTo(room);

			client.send(MessageType.Move, { x: 'secret-value', y: 0 });
			await room.waitForNextMessage();

			assert.strictEqual(warnings.length, 1);
			assert.ok(!warnings[0].includes('secret-value'), warnings[0]);
		});

		it('disconnects a client on its 10th invalid message', async () =>
		{
			const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {});
			const client = await colyseus.connectTo(room);
			const playerId = playerIdOf(room, client);
			const left = waitForLeave(client);

			for (let i = 0; i < 9; i++)
			{
				client.send(MessageType.Move, { x: 5, y: 0 });
				await room.waitForNextMessage();
			}

			assert.ok(room.state.players.has(playerId), 'disconnected before the 10th invalid message');

			client.send(MessageType.Move, { x: 5, y: 0 });

			assert.strictEqual(await left, ServerCloseCode.TooManyInvalidMessages);

			// The client sees the socket close before the server's onLeave has run
			await waitUntil(() => !room.state.players.has(playerId));
		});

		it('ignores extra keys on a valid payload', async () =>
		{
			const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {});
			const client = await colyseus.connectTo(room);
			const player = room.state.players.get(playerIdOf(room, client)) as Player;

			player.x = 100;

			client.send(MessageType.Move, { x: 1, y: 0, speed: 9999 });
			await room.waitForNextMessage();
			await room.waitForNextTimestep();

			assert.ok((player.x > 100) && (player.x < 150), `x = ${player.x}`);
			assert.strictEqual(warnings.length, 0);
		});
	});

	it('disconnects a client that sends too many messages', async () =>
	{
		const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {});
		const client = await colyseus.connectTo(room);
		const playerId = playerIdOf(room, client);
		const left = waitForLeave(client);

		for (let i = 0; i < 100; i++)
		{
			client.send(MessageType.Move, { x: 1, y: 0 });
		}

		await left;

		assert.strictEqual(room.state.players.has(playerId), false);
	});

	describe('windows of the same browser', () =>
	{
		it('control one shared player', async () =>
		{
			const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {});
			const window1 = await joinFromBrowser(room, browserIdA);
			const window2 = await joinFromBrowser(room, browserIdA);

			assert.strictEqual(playerIdOf(room, window1.client), playerIdOf(room, window2.client));
			assert.strictEqual(room.state.players.size, 1);
		});

		it('are told which player they control', async () =>
		{
			const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {});
			const window1 = await joinFromBrowser(room, browserIdA);
			const window2 = await joinFromBrowser(room, browserIdA);

			assert.deepStrictEqual(await window1.welcome, { playerId: playerIdOf(room, window1.client) });
			assert.deepStrictEqual(await window2.welcome, { playerId: playerIdOf(room, window1.client) });
		});

		it('can each move the player', async () =>
		{
			const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {});
			const window1 = await joinFromBrowser(room, browserIdA);
			const window2 = await joinFromBrowser(room, browserIdA);
			const player = room.state.players.get(playerIdOf(room, window1.client)) as Player;

			player.x = 100;

			window2.client.send(MessageType.Move, { x: 1, y: 0 });
			await room.waitForNextMessage();
			await room.waitForNextTimestep();

			assert.ok(player.x > 100, `x = ${player.x}`);
		});

		it('keep the player until the last one leaves', async () =>
		{
			const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {});
			const window1 = await joinFromBrowser(room, browserIdA);
			const window2 = await joinFromBrowser(room, browserIdA);
			const playerId = playerIdOf(room, window1.client);

			await window1.client.leave();
			await waitUntil(() => (room.getPlayerId(window1.client.sessionId) === undefined));

			assert.ok(room.state.players.has(playerId));

			await window2.client.leave();
			await waitUntil(() => !room.state.players.has(playerId));
		});

		it('stop the player when one of them leaves', async () =>
		{
			const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {});
			const window1 = await joinFromBrowser(room, browserIdA);
			const window2 = await joinFromBrowser(room, browserIdA);
			const player = room.state.players.get(playerIdOf(room, window2.client)) as Player;

			player.x = 100;

			window1.client.send(MessageType.Move, { x: 1, y: 0 });
			await room.waitForNextMessage();
			await window1.client.leave();
			await waitUntil(() => (room.getPlayerId(window1.client.sessionId) === undefined));
			await room.waitForNextTimestep();

			const stoppedAt = player.x;

			await room.waitForNextTimestep();

			assert.strictEqual(player.x, stoppedAt);
		});
	});

	it('gives different browsers different players', async () =>
	{
		const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {});
		const browserA = await joinFromBrowser(room, browserIdA);
		const browserB = await joinFromBrowser(room, browserIdB);

		assert.notStrictEqual(playerIdOf(room, browserA.client), playerIdOf(room, browserB.client));
		assert.strictEqual(room.state.players.size, 2);
	});
});
