import assert from 'assert';
import { randomUUID } from 'crypto';
import type { ColyseusTestServer } from '@colyseus/testing';
import { Client as SDKClient, type Room as ClientRoom } from '@colyseus/sdk';

import { GAME_ROOM_NAME, GameState, GRID_CELL_SIZE, MessageType, PLAYER_RADIUS, ServerCloseCode, ServerMessageType, type Player, type WelcomePayload, type AreaPayload } from '@multiverse-kiln/shared';
import type appConfig from '../src/app.config.js';
import { pool } from '../src/db/client.js';
import { BROWSER_ID_COOKIE } from '../src/http/browserId.js';
import { cellCenter } from '../src/logic/movement.js';
import { onlinePlayers } from '../src/players/onlinePlayers.js';
import type { GameRoom } from '../src/rooms/GameRoom.js';
import { addPlayableUniverse, type PlayableUniverse } from './db/fixtures.js';
import { getTestServer, logOutEveryone, testServerUrl } from './testServer.js';
import { waitUntil } from './waitUntil.js';

const browserIdA = '0b6f4c1e-8d2a-4f3b-9c5d-7e1a2b3c4d5e';
const browserIdB = '6a1d2e3f-4b5c-4d6e-8f70-819a2b3c4d5e';

/**
 * The grid's cell size, for cellCenter
 */
const grid = { cellSize: GRID_CELL_SIZE };

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
 * Puts a standing player on a cell's center
 *
 * @param player Server-side player
 * @param column Cell's column
 * @param row Cell's row
 */
function placeOnCell(player: Player, column: number, row: number): void
{
	const center = cellCenter({ column, row }, grid);

	player.x = center.x;
	player.y = center.y;
}

/**
 * Checks that a player is exactly on a cell center
 *
 * @param player Server-side player
 */
function assertOnCellCenter(player: Player): void
{
	const offset = GRID_CELL_SIZE / 2;

	assert.strictEqual((player.x - offset) % GRID_CELL_SIZE, 0, `x = ${player.x}`);
	assert.strictEqual((player.y - offset) % GRID_CELL_SIZE, 0, `y = ${player.y}`);
}

/**
 * Waits for timesteps until a player stops moving
 *
 * @param room Server-side room
 * @param player Server-side player
 */
async function waitUntilStopped(room: GameRoom, player: Player): Promise<void>
{
	for (let i = 0; i < 30; i++)
	{
		const x = player.x;
		const y = player.y;

		await room.waitForNextTimestep();

		if ((player.x === x) && (player.y === y))
		{
			return;
		}
	}

	throw new Error(`player still moving at (${player.x}, ${player.y})`);
}

/**
 * Connects to a room like a browser window holding a browser ID cookie
 *
 * @param room Server-side room to join
 * @param browserId Browser ID the window's cookie holds
 * @return The client-side room
 */
function connectFromBrowser(room: GameRoom, browserId: string): Promise<ClientRoom<unknown, GameState>>
{
	const sdk = new SDKClient(testServerUrl.replace(/^http/, 'ws'), { headers: { cookie: `${BROWSER_ID_COOKIE}=${browserId}` } });

	return(sdk.joinById<GameState>(room.roomId, {}, GameState));
}

/**
 * Logs a browser in and puts its player in a room's group, as the lobby would, then joins the room from
 * one of its windows, listening for its Welcome message
 *
 * @param room Server-side room to join
 * @param browserId Browser ID the window's cookie holds
 * @param name The player's name
 * @return The client-side room, and the Welcome and Area payloads once they arrive
 */
async function joinFromBrowser(room: GameRoom, browserId: string, name: string = 'Player'): Promise<{ client: ClientRoom<unknown, GameState>; welcome: Promise<WelcomePayload>; area: Promise<AreaPayload> }>
{
	// A browser stays logged in as its first player, so a second window joins as the same player
	onlinePlayers.logIn(browserId, randomUUID(), name);
	onlinePlayers.setGroup(browserId, room.roomId);

	const client = await connectFromBrowser(room, browserId);

	// Registered straight after joining: the server sends these once the client has acknowledged the join
	const welcome = new Promise<WelcomePayload>((resolve) =>
	{
		client.onMessage(ServerMessageType.Welcome, resolve);
	});
	const area = new Promise<AreaPayload>((resolve) =>
	{
		client.onMessage(ServerMessageType.Area, resolve);
	});

	await client.waitForInitialState();

	return({ client, welcome, area });
}

/**
 * Joins a room as a new player, from a browser of its own
 *
 * @param room Server-side room to join
 * @return The client-side room
 */
async function joinAsNewPlayer(room: GameRoom): Promise<ClientRoom<unknown, GameState>>
{
	return((await joinFromBrowser(room, randomUUID())).client);
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

describe('GameRoom', () =>
{
	let colyseus: ColyseusTestServer<typeof appConfig>;
	let universe: PlayableUniverse;

	/**
	 * Creates a game room for the test universe, as its lobby would
	 *
	 * @return The server-side room
	 */
	function createGameRoom(): Promise<GameRoom>
	{
		return(colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, { universeId: universe.universeId }));
	}

	before(async () =>
	{
		colyseus = await getTestServer();
	});

	beforeEach(async () =>
	{
		await colyseus.cleanup();
		logOutEveryone();
		universe = await addPlayableUniverse();
	});

	it('adds a player to the universe\'s starting area when a client joins', async () =>
	{
		const room = await createGameRoom();
		const { client, area } = await joinFromBrowser(room, randomUUID());
		const playerId = playerIdOf(room, client);

		assert.strictEqual(room.getAreaId(playerId), universe.fieldAreaId);
		assert.strictEqual((await area).areaId, universe.fieldAreaId);
		assert.strictEqual((await area).name, 'Field');
	});

	it('cannot be created for a universe that does not exist, or with no universe', async () =>
	{
		await assert.rejects(colyseus.createRoom(GAME_ROOM_NAME, { universeId: randomUUID() }));
		await assert.rejects(colyseus.createRoom(GAME_ROOM_NAME, {}));
	});

	it('syncs players to clients', async () =>
	{
		const room = await createGameRoom();
		const client1 = await joinAsNewPlayer(room);
		const client2 = await joinAsNewPlayer(room);

		await room.waitForNextPatch();

		const players = client1.state.players;

		assert.strictEqual(players.size, 2);
		assert.ok(players.has(playerIdOf(room, client1)));
		assert.ok(players.has(playerIdOf(room, client2)));
	});

	it('moves a player in the direction they send', async () =>
	{
		const room = await createGameRoom();
		const client = await joinAsNewPlayer(room);
		const player = room.state.players.get(playerIdOf(room, client)) as Player;

		placeOnCell(player, 3, 3);

		client.send(MessageType.Move, { x: 1, y: 0 });
		await room.waitForNextMessage();
		await room.waitForNextTimestep();
		await room.waitForNextTimestep();

		assert.ok(player.x > 105, `x = ${player.x}`);
		assert.strictEqual(player.y, 105);

		client.send(MessageType.Move, { x: 0, y: 0 });
		await room.waitForNextMessage();
		await waitUntilStopped(room, player);

		assert.ok(player.x > 105, `x = ${player.x}`);
		assert.strictEqual(player.y, 105);
		assertOnCellCenter(player);
	});

	it('does not use the database while players move', async () =>
	{
		const room = await createGameRoom();
		const client = await joinAsNewPlayer(room);
		const player = room.state.players.get(playerIdOf(room, client)) as Player;
		let checkouts = 0;
		const countCheckout = () =>
		{
			checkouts++;
		};

		placeOnCell(player, 3, 3);

		// Every query, from a repository or anything else, checks a connection out of the pool
		pool.on('acquire', countCheckout);

		try
		{
			client.send(MessageType.Move, { x: 1, y: 1 });
			await room.waitForNextMessage();

			for (let i = 0; i < 10; i++)
			{
				await room.waitForNextTimestep();
			}
		}
		finally
		{
			pool.off('acquire', countCheckout);
		}

		assert.ok(player.x > 105, `x = ${player.x}`);
		assert.strictEqual(checkouts, 0);
	});

	it('does not let a player move into another player\'s cell', async () =>
	{
		const room = await createGameRoom();
		const client1 = await joinAsNewPlayer(room);
		const client2 = await joinAsNewPlayer(room);
		const player1 = room.state.players.get(playerIdOf(room, client1)) as Player;
		const player2 = room.state.players.get(playerIdOf(room, client2)) as Player;

		placeOnCell(player1, 3, 3);
		placeOnCell(player2, 6, 3);

		// Player 1 walks right until player 2 is in the way
		client1.send(MessageType.Move, { x: 1, y: 0 });
		await room.waitForNextMessage();

		for (let i = 0; i < 30; i++)
		{
			await room.waitForNextTimestep();
		}

		assert.strictEqual(player1.x, cellCenter({ column: 5, row: 3 }, grid).x);
		assert.strictEqual(player1.y, player2.y);
		assert.strictEqual(player2.x, cellCenter({ column: 6, row: 3 }, grid).x);
	});

	it('spawns players on a cell center', async () =>
	{
		const room = await createGameRoom();
		const client = await joinAsNewPlayer(room);

		assertOnCellCenter(room.state.players.get(playerIdOf(room, client)) as Player);
	});

	it('uses cells wider than a player', () =>
	{
		// The whole player stays inside its cell, so a player on an edge cell is inside the map
		assert.ok((GRID_CELL_SIZE / 2) >= PLAYER_RADIUS);
	});

	it('removes the player when the client leaves', async () =>
	{
		const room = await createGameRoom();
		const client1 = await joinAsNewPlayer(room);
		const client2 = await joinAsNewPlayer(room);
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
				const room = await createGameRoom();
				const client = await joinAsNewPlayer(room);
				const player = room.state.players.get(playerIdOf(room, client)) as Player;

				placeOnCell(player, 3, 3);

				client.send(MessageType.Move, payload);
				await room.waitForNextMessage();
				await room.waitForNextTimestep();

				assert.strictEqual(player.x, 105);
				assert.strictEqual(player.y, 105);
				assert.strictEqual(warnings.length, 1);
				assert.ok(warnings[0].startsWith(`${client.sessionId} sent an invalid move message (1 of 10), ignored: `), warnings[0]);

				// Still connected: a valid Move after the invalid one is applied
				client.send(MessageType.Move, { x: 1, y: 0 });
				await room.waitForNextMessage();
				await room.waitForNextTimestep();

				assert.ok(player.x > 105, `x = ${player.x}`);
				assert.ok(room.state.players.has(playerIdOf(room, client)));
			});
		}

		it('does not log the payload', async () =>
		{
			const room = await createGameRoom();
			const client = await joinAsNewPlayer(room);

			client.send(MessageType.Move, { x: 'secret-value', y: 0 });
			await room.waitForNextMessage();

			assert.strictEqual(warnings.length, 1);
			assert.ok(!warnings[0].includes('secret-value'), warnings[0]);
		});

		it('disconnects a client on its 10th invalid message', async () =>
		{
			const room = await createGameRoom();
			const client = await joinAsNewPlayer(room);
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
			const room = await createGameRoom();
			const client = await joinAsNewPlayer(room);
			const player = room.state.players.get(playerIdOf(room, client)) as Player;

			placeOnCell(player, 3, 3);

			client.send(MessageType.Move, { x: 1, y: 0, speed: 9999 });
			await room.waitForNextMessage();
			await room.waitForNextTimestep();

			assert.ok((player.x > 105) && (player.x < 150), `x = ${player.x}`);
			assert.strictEqual(warnings.length, 0);
		});
	});

	it('disconnects a client that sends too many messages', async () =>
	{
		const room = await createGameRoom();
		const client = await joinAsNewPlayer(room);
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
			const room = await createGameRoom();
			const window1 = await joinFromBrowser(room, browserIdA);
			const window2 = await joinFromBrowser(room, browserIdA);

			assert.strictEqual(playerIdOf(room, window1.client), playerIdOf(room, window2.client));
			assert.strictEqual(room.state.players.size, 1);
		});

		it('are told which player they control', async () =>
		{
			const room = await createGameRoom();
			const window1 = await joinFromBrowser(room, browserIdA);
			const window2 = await joinFromBrowser(room, browserIdA);

			assert.deepStrictEqual(await window1.welcome, { playerId: playerIdOf(room, window1.client) });
			assert.deepStrictEqual(await window2.welcome, { playerId: playerIdOf(room, window1.client) });
		});

		it('can each move the player', async () =>
		{
			const room = await createGameRoom();
			const window1 = await joinFromBrowser(room, browserIdA);
			const window2 = await joinFromBrowser(room, browserIdA);
			const player = room.state.players.get(playerIdOf(room, window1.client)) as Player;

			placeOnCell(player, 3, 3);

			window2.client.send(MessageType.Move, { x: 1, y: 0 });
			await room.waitForNextMessage();
			await room.waitForNextTimestep();

			assert.ok(player.x > 105, `x = ${player.x}`);
		});

		it('keep the player until the last one leaves', async () =>
		{
			const room = await createGameRoom();
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
			const room = await createGameRoom();
			const window1 = await joinFromBrowser(room, browserIdA);
			const window2 = await joinFromBrowser(room, browserIdA);
			const player = room.state.players.get(playerIdOf(room, window2.client)) as Player;

			placeOnCell(player, 3, 3);

			window1.client.send(MessageType.Move, { x: 1, y: 0 });
			await room.waitForNextMessage();
			await window1.client.leave();
			await waitUntil(() => (room.getPlayerId(window1.client.sessionId) === undefined));
			await waitUntilStopped(room, player);

			// At most one step, finished on the next cell's center
			assert.ok(player.x <= 135, `x = ${player.x}`);
			assertOnCellCenter(player);
		});
	});

	it('gives different browsers different players', async () =>
	{
		const room = await createGameRoom();
		const browserA = await joinFromBrowser(room, browserIdA);
		const browserB = await joinFromBrowser(room, browserIdB);

		assert.notStrictEqual(playerIdOf(room, browserA.client), playerIdOf(room, browserB.client));
		assert.strictEqual(room.state.players.size, 2);
	});

	describe('group membership', () =>
	{
		it('uses the player ID and name from the login', async () =>
		{
			const room = await createGameRoom();
			const { client } = await joinFromBrowser(room, browserIdA, 'Ada');
			const playerId = playerIdOf(room, client);

			assert.strictEqual(playerId, onlinePlayers.get(browserIdA)?.playerId);
			assert.strictEqual(room.state.players.get(playerId)?.name, 'Ada');
		});

		it('turns away a browser that is not logged in', async () =>
		{
			const room = await createGameRoom();

			await assert.rejects(connectFromBrowser(room, browserIdA));
		});

		it('turns away a player who is not in the group', async () =>
		{
			const room = await createGameRoom();

			onlinePlayers.logIn(browserIdA, randomUUID(), 'Ada');
			await assert.rejects(connectFromBrowser(room, browserIdA));

			onlinePlayers.setGroup(browserIdA, 'another-group');
			await assert.rejects(connectFromBrowser(room, browserIdA));
		});

		it('turns away a client without a browser ID', async () =>
		{
			const room = await createGameRoom();

			await assert.rejects(colyseus.connectTo(room));
		});

		it('disconnects every window of a player who leaves the group', async () =>
		{
			const room = await createGameRoom();
			const window1 = await joinFromBrowser(room, browserIdA);
			const window2 = await joinFromBrowser(room, browserIdA);
			const other = await joinFromBrowser(room, browserIdB);
			const playerId = playerIdOf(room, window1.client);
			const left1 = waitForLeave(window1.client);
			const left2 = waitForLeave(window2.client);

			onlinePlayers.setGroup(browserIdA, undefined);

			assert.strictEqual(await left1, ServerCloseCode.LeftGroup);
			assert.strictEqual(await left2, ServerCloseCode.LeftGroup);
			await waitUntil(() => !room.state.players.has(playerId));
			assert.ok(room.state.players.has(playerIdOf(room, other.client)));
		});

		it('disconnects a player who joins another group', async () =>
		{
			const room = await createGameRoom();
			const { client } = await joinFromBrowser(room, browserIdA);
			await joinFromBrowser(room, browserIdB);
			const left = waitForLeave(client);

			onlinePlayers.setGroup(browserIdA, 'another-group');

			assert.strictEqual(await left, ServerCloseCode.LeftGroup);
		});

		it('sends the group back to the lobby when the room is disposed', async () =>
		{
			const room = await createGameRoom();

			onlinePlayers.logIn(browserIdA, randomUUID(), 'Ada');
			onlinePlayers.setGroup(browserIdA, room.roomId);
			onlinePlayers.logIn(browserIdB, randomUUID(), 'Grace');
			onlinePlayers.setGroup(browserIdB, 'another-group');

			await room.disconnect();

			assert.strictEqual(onlinePlayers.get(browserIdA)?.groupId, undefined);
			assert.strictEqual(onlinePlayers.get(browserIdB)?.groupId, 'another-group');
		});
	});
});
