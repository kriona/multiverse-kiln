import assert from 'assert';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';

import { GAME_ROOM_NAME, MessageType, ServerCloseCode } from '@multiverse-kiln/shared';
import type appConfig from '../src/app.config.js';
import type { GameState, Player } from '../src/rooms/schema/GameState.js';
import { getTestServer } from './testServer.js';

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
		const room = await colyseus.createRoom<GameState>(GAME_ROOM_NAME, {});
		const client = await colyseus.connectTo(room);
		const player = room.state.players.get(client.sessionId);

		assert.ok(player);
		assert.ok((player.x >= 0) && (player.x <= 960), `x = ${player.x}`);
		assert.ok((player.y >= 0) && (player.y <= 540), `y = ${player.y}`);
	});

	it('syncs players to clients', async () =>
	{
		const room = await colyseus.createRoom<GameState>(GAME_ROOM_NAME, {});
		const client1 = await colyseus.connectTo(room);
		const client2 = await colyseus.connectTo(room);

		await room.waitForNextPatch();

		const players = client1.state.players;

		assert.strictEqual(players.size, 2);
		assert.ok(players.has(client1.sessionId));
		assert.ok(players.has(client2.sessionId));
	});

	it('moves a player in the direction they send', async () =>
	{
		const room = await colyseus.createRoom<GameState>(GAME_ROOM_NAME, {});
		const client = await colyseus.connectTo(room);
		const player = room.state.players.get(client.sessionId) as Player;

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
		const room = await colyseus.createRoom<GameState>(GAME_ROOM_NAME, {});
		const client1 = await colyseus.connectTo(room);
		const client2 = await colyseus.connectTo(room);

		await client1.leave();
		await room.waitForNextTimestep();

		assert.strictEqual(room.state.players.has(client1.sessionId), false);
		assert.strictEqual(room.state.players.has(client2.sessionId), true);
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
				warnings.push(args.join(' '));
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
				const room = await colyseus.createRoom<GameState>(GAME_ROOM_NAME, {});
				const client = await colyseus.connectTo(room);
				const player = room.state.players.get(client.sessionId) as Player;

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
				assert.ok(room.state.players.has(client.sessionId));
			});
		}

		it('does not log the payload', async () =>
		{
			const room = await colyseus.createRoom<GameState>(GAME_ROOM_NAME, {});
			const client = await colyseus.connectTo(room);

			client.send(MessageType.Move, { x: 'secret-value', y: 0 });
			await room.waitForNextMessage();

			assert.strictEqual(warnings.length, 1);
			assert.ok(!warnings[0].includes('secret-value'), warnings[0]);
		});

		it('disconnects a client on its 10th invalid message', async () =>
		{
			const room = await colyseus.createRoom<GameState>(GAME_ROOM_NAME, {});
			const client = await colyseus.connectTo(room);
			const left = waitForLeave(client);

			for (let i = 0; i < 9; i++)
			{
				client.send(MessageType.Move, { x: 5, y: 0 });
				await room.waitForNextMessage();
			}

			assert.ok(room.state.players.has(client.sessionId), 'disconnected before the 10th invalid message');

			client.send(MessageType.Move, { x: 5, y: 0 });

			assert.strictEqual(await left, ServerCloseCode.TooManyInvalidMessages);

			// The client sees the socket close before the server's onLeave has run
			await waitUntil(() => !room.state.players.has(client.sessionId));
		});

		it('ignores extra keys on a valid payload', async () =>
		{
			const room = await colyseus.createRoom<GameState>(GAME_ROOM_NAME, {});
			const client = await colyseus.connectTo(room);
			const player = room.state.players.get(client.sessionId) as Player;

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
		const room = await colyseus.createRoom<GameState>(GAME_ROOM_NAME, {});
		const client = await colyseus.connectTo(room);
		const left = waitForLeave(client);

		for (let i = 0; i < 100; i++)
		{
			client.send(MessageType.Move, { x: 1, y: 0 });
		}

		await left;

		assert.strictEqual(room.state.players.has(client.sessionId), false);
	});
});
