import assert from 'assert';
import { randomUUID } from 'node:crypto';
import type { ColyseusTestServer } from '@colyseus/testing';
import { ErrorCode, matchMaker } from 'colyseus';
import { EDITOR_ROOM_NAME, GAME_ROOM_NAME, LOBBY_ROOM_NAME } from '@multiverse-kiln/shared';

import type appConfig from '../src/app.config.js';
import { addCharacter, addGroup, addPlayableUniverse } from './db/fixtures.js';
import { addPlayer, logInBrowser } from './players.js';
import { getTestServer, testServerUrl } from './testServer.js';

/**
 * Asks matchmaking to join or make a room, without connecting to it afterward, so a room it makes stays
 * open while its seat is reserved
 *
 * @param roomName The room type
 * @param options The join options
 * @param cookie The Cookie header the browser sends, if any
 * @return Whether matchmaking reserved a seat, and the answer's body
 */
async function matchmakeAnswer(roomName: string, options: object, cookie?: string): Promise<{ ok: boolean; body: string }>
{
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };

	if (cookie !== undefined)
	{
		headers['Cookie'] = cookie;
	}

	const response = await fetch(`${testServerUrl}/matchmake/joinOrCreate/${roomName}`, {
		method: 'POST',
		headers,
		body: JSON.stringify(options)
	});

	return({
		ok: response.ok,
		body: await response.text()
	});
}

/**
 * Asks matchmaking to join or make a room (matchmakeAnswer())
 *
 * @param roomName The room type
 * @param options The join options
 * @param cookie The Cookie header the browser sends, if any
 * @return Whether matchmaking reserved a seat
 */
async function matchmake(roomName: string, options: object, cookie?: string): Promise<boolean>
{
	return((await matchmakeAnswer(roomName, options, cookie)).ok);
}

describe('matchmaking', () =>
{
	let colyseus: ColyseusTestServer<typeof appConfig>;
	let universeId: string;
	let groupId: string;
	let characterId: string;

	before(async () =>
	{
		colyseus = await getTestServer();
	});

	beforeEach(async () =>
	{
		const universe = await addPlayableUniverse();
		const player = await addPlayer('Anchor');

		universeId = universe.universeId;
		characterId = await addCharacter(player.id, universeId, 'Brokk');
		groupId = await addGroup(universeId, characterId, universe.fieldAreaId);
	});

	afterEach(async () =>
	{
		await colyseus.cleanup();
	});

	it('makes no lobby, editor or game room for a browser that is not logged in', async () =>
	{
		const requests: [string, object][] = [
			[LOBBY_ROOM_NAME, { universeId }],
			[EDITOR_ROOM_NAME, { universeId }],
			[GAME_ROOM_NAME, { groupId, characterId }]
		];

		for (const [roomName, options] of requests)
		{
			assert.strictEqual(await matchmake(roomName, options), false, roomName);
			assert.strictEqual(await matchmake(roomName, options, '__Host-kiln-session=not-a-token'), false, roomName);
			assert.deepStrictEqual(await matchMaker.query({ name: roomName }), [], roomName);
		}
	});

	it('makes a lobby for a logged-in browser', async () =>
	{
		const { cookie } = await logInBrowser((await addPlayer('Ada')).id);

		assert.strictEqual(await matchmake(LOBBY_ROOM_NAME, { universeId }, cookie), true);
		assert.strictEqual((await matchMaker.query({ name: LOBBY_ROOM_NAME })).length, 1);
	});

	it('tells a logged-in browser nothing of why a room for a group or universe that doesn\'t exist couldn\'t be made', async () =>
	{
		const { cookie } = await logInBrowser((await addPlayer('Ada')).id);
		const missingId = randomUUID();
		const requests: [string, object][] = [
			[LOBBY_ROOM_NAME, { universeId: missingId }],
			[EDITOR_ROOM_NAME, { universeId: missingId }],
			[GAME_ROOM_NAME, { groupId: missingId, characterId }]
		];

		for (const [roomName, options] of requests)
		{
			const answer = await matchmakeAnswer(roomName, options, cookie);

			assert.strictEqual(answer.ok, false, roomName);
			assert.deepStrictEqual(JSON.parse(answer.body), {
				code: ErrorCode.MATCHMAKE_UNHANDLED,
				error: 'The room could not be opened'
			}, roomName);
			assert.ok(!answer.body.includes(missingId), roomName);
		}
	});
});
