import assert from 'assert';
import type { ColyseusTestServer } from '@colyseus/testing';

import { GAME_ROOM_NAME } from '@multiverse-kiln/shared';
import type appConfig from '../src/app.config.js';
import type { MyRoomState } from '../src/rooms/schema/MyRoomState.js';
import { getTestServer } from './testServer.js';

describe('testing your Colyseus app', () =>
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

	it('connecting into a room', async () =>
	{
		// `room` is the server-side Room instance reference
		const room = await colyseus.createRoom<MyRoomState>(GAME_ROOM_NAME, {});

		// `client1` is the client-side `Room` instance reference (same as JavaScript SDK)
		const client1 = await colyseus.connectTo(room);

		// make your assertions
		assert.strictEqual(client1.sessionId, room.clients[0].sessionId);

		assert.deepStrictEqual(client1.state.toJSON(), { mySynchronizedProperty: 'Hello world' });
	});
});
