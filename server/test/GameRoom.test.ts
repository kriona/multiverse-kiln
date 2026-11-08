import assert from 'assert';
import { randomUUID } from 'crypto';
import type { ColyseusTestServer } from '@colyseus/testing';
import { Client as SDKClient, type Room as ClientRoom } from '@colyseus/sdk';

import { cellIndexInChunk, DARKVISION_SQUARES, DEFAULT_OUTDOOR_WALK_SECONDS, DEFAULT_TILE_CELL,GAME_ROOM_NAME, GameMessageType, GameServerMessageType, GameState, GRID_CELL_SIZE, GROUP_START_SECONDS, MAX_CHAT_MESSAGE_LENGTH, MessageType, NOTHING_BARRED, NoticeReason, PLAYER_RADIUS, ServerCloseCode, ServerMessageType, UNSEEN_CELL, type AreaPayload, type CellsSeenPayload, type ChatAuthorDeletedPayload, type GameJoinOptions, type KeptChatHistoryPayload, type KeptChatMessage, type NoticePayload, type Player, type WelcomePayload } from '@multiverse-kiln/shared';
import type appConfig from '../src/app.config.js';
import { listChatMessages } from '../src/db/chatRepo.js';
import { createCharacter, scheduleCharacterDeletion } from '../src/db/characterRepo.js';
import { pool } from '../src/db/client.js';
import { addGroupMember, findGroup, leaveGroup, listGroupMembers } from '../src/db/groupRepo.js';
import { createAreaLink, updateAreaSettings } from '../src/db/areaRepo.js';
import { loadSeenChunks } from '../src/db/worldStateRepo.js';
import { inTransaction } from '../src/db/transactions.js';
import { setUniverseDisabled, updateUniverseSettings } from '../src/db/universeRepo.js';
import { liveVersion } from '../src/db/universeVersions.js';
import { cellCenter } from '../src/logic/movement.js';
import { SeenCells } from '../src/logic/seenCells.js';
import { accountDeletions } from '../src/players/accountDeletions.js';
import { characterChanges } from '../src/players/characterChanges.js';
import { connectedSessions } from '../src/players/connectedSessions.js';
import { groupChanges } from '../src/players/groupChanges.js';
import { universeAccessChanges } from '../src/players/universeAccess.js';
import type { GameRoom } from '../src/rooms/GameRoom.js';
import { areaChanges } from '../src/world/areaChanges.js';
import { addCharacter, addGroup, addPlayableUniverse, defaultClassId, defaultRaceId, dwarfFighter, type PlayableUniverse } from './db/fixtures.js';
import { Inbox } from './inbox.js';
import { changeDuringNextLookup, refusedWith } from './joinRaces.js';
import { addPlayer, TestBrowsers } from './players.js';
import { getTestServer, testServerUrl } from './testServer.js';
import { waitUntil } from './waitUntil.js';

const browserIdA = 'A';
const browserIdB = 'B';

/**
 * The browsers the tests join from, each logged in as a player
 */
const browsers = new TestBrowsers();

/**
 * The grid's cell size, for cellCenter
 */
const grid = { cellSize: GRID_CELL_SIZE };

/**
 * Center of cell (3, 3), where the movement tests place players
 */
const startCenter = cellCenter({ column: 3, row: 3 }, grid);

/**
 * A character in the test group, and their player
 */
interface Member
{
	playerId: string;
	characterId: string;
	name: string;
	raceId: number;
	classId: number;
}

/**
 * A client-side room, the Welcome and first Area payloads once they arrive, the cells the group has
 * seen for the first time since it joined (GameServerMessageType.CellsSeen), by "column,row", and the
 * group's chat it was sent
 */
interface JoinedWindow
{
	client: ClientRoom<unknown, GameState>;
	welcome: Promise<WelcomePayload>;
	area: Promise<AreaPayload>;
	cellsSeen: Map<string, number>;
	chat: Inbox<GameServerMessageType>;
}

let universe: PlayableUniverse;

/**
 * The group the tests play in, and its anchor being, whose player hasn't joined unless a test says so
 */
let groupId: string;
let anchor: Member;

/**
 * The player each browser logs in as, and the first character it played
 */
const browserMembers = new Map<string, Member>();

/**
 * The messages players wrote, leaving out the notices the server writes as characters join and leave
 *
 * @param messages A chat's messages
 * @return The messages players wrote, in the same order
 */
function playerMessages(messages: readonly KeptChatMessage[]): KeptChatMessage[]
{
	return(messages.filter((message) => (message.notice === null)));
}

/**
 * Takes the next chat message a player wrote that a window received, passing over notices
 *
 * @param chat The window's messages
 * @return The message
 */
async function takePlayerMessage(chat: Inbox<GameServerMessageType>): Promise<KeptChatMessage>
{
	for (;;)
	{
		const message = await chat.take<KeptChatMessage>(GameServerMessageType.Chat);

		if (message.notice === null)
		{
			return(message);
		}
	}
}

/**
 * Adds a player with a character to the test universe
 *
 * @param name The character's name
 * @return The player and character
 */
async function addPlayerWithCharacter(name: string): Promise<Member>
{
	const player = await addPlayer(`Player ${randomUUID().slice(0, 8)}`);
	const characterId = await addCharacter(player.id, universe.universeId, name);

	return({ playerId: player.id, characterId, name, raceId: await defaultRaceId('dwarf'), classId: await defaultClassId('fighter') });
}

/**
 * Puts a character in the test group, as accepting an invite would, telling the group's room
 *
 * @param member The character and their player
 */
async function joinGroup(member: Member): Promise<void>
{
	await inTransaction((transaction) => addGroupMember(groupId, member.characterId, transaction));
	groupChanges.publish({
		kind: 'joined',
		groupId,
		universeId: universe.universeId,
		character: { ...member, playable: true }
	});
}

/**
 * Adds another character for a member's player and puts them in the test group
 *
 * @param member A member, whose player the character belongs to
 * @param name The new character's name
 * @return The new member
 */
async function addSecondCharacter(member: Member, name: string): Promise<Member>
{
	const characterId = await addCharacter(member.playerId, universe.universeId, name);
	const second = { playerId: member.playerId, characterId, name, raceId: member.raceId, classId: member.classId };

	await joinGroup(second);

	return(second);
}

/**
 * The player a client controls, as the server's room records it
 *
 * @param room Server-side room
 * @param client Client-side room of a client still in the room
 * @return The character's ID in state.players
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
 * Connects to a room like a browser window holding the browser's session cookie
 *
 * @param room Server-side room to join
 * @param browserId The browser's name in the test
 * @param characterId The character the window asks to play
 * @return The client-side room
 */
function connectFromBrowser(room: GameRoom, browserId: string, characterId: string): Promise<ClientRoom<unknown, GameState>>
{
	const sdk = new SDKClient(testServerUrl.replace(/^http/, 'ws'), { headers: { cookie: browsers.cookieOf(browserId) } });
	const options: GameJoinOptions = { groupId, characterId };

	return(sdk.joinById<GameState>(room.roomId, options, GameState));
}

/**
 * Logs a browser in as a member's player and joins the room from one of its windows to play them,
 * listening for its Welcome and Area messages
 *
 * @param room Server-side room to join
 * @param browserId The browser's name in the test
 * @param member The character to play
 * @return The window
 */
async function joinAs(room: GameRoom, browserId: string, member: Member): Promise<JoinedWindow>
{
	await browsers.logIn(browserId, member.playerId);

	const client = await connectFromBrowser(room, browserId, member.characterId);

	// Registered straight after joining: the server sends these once the client has acknowledged the join
	const welcome = new Promise<WelcomePayload>((resolve) =>
	{
		client.onMessage(ServerMessageType.Welcome, resolve);
	});
	const area = new Promise<AreaPayload>((resolve) =>
	{
		client.onMessage(ServerMessageType.Area, resolve);
	});
	const cellsSeen = new Map<string, number>();
	const chat = new Inbox<GameServerMessageType>(client, [GameServerMessageType.ChatHistory, GameServerMessageType.Chat, GameServerMessageType.ChatAuthorDeleted]);

	client.onMessage(GameServerMessageType.CellsSeen, (payload: CellsSeenPayload) =>
	{
		for (const { column, row, value } of payload.cells)
		{
			cellsSeen.set(`${column},${row}`, value);
		}
	});

	await client.waitForInitialState();

	return({ client, welcome, area, cellsSeen, chat });
}

/**
 * Joins the room from a window of a browser, playing the browser's first character, who is made and
 * put in the group the first time the browser joins
 *
 * @param room Server-side room to join
 * @param browserId The browser's name in the test
 * @param name The character's name, the first time
 * @return The window
 */
async function joinFromBrowser(room: GameRoom, browserId: string, name: string = 'Player'): Promise<JoinedWindow>
{
	let member = browserMembers.get(browserId);

	if (!member)
	{
		member = await addPlayerWithCharacter(name);
		await joinGroup(member);
		browserMembers.set(browserId, member);
	}

	return(joinAs(room, browserId, member));
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

/**
 * Resolves with the next message of a type a client receives
 *
 * @param room Client-side room
 * @param type The message type
 * @return The payload
 */
function nextMessage<T>(room: ClientRoom, type: string): Promise<T>
{
	return(new Promise((resolve) =>
	{
		const stop = room.onMessage(type, (payload: T) =>
		{
			stop();
			resolve(payload);
		});
	}));
}

describe('GameRoom', () =>
{
	let colyseus: ColyseusTestServer<typeof appConfig>;

	/**
	 * Creates the test group's room, as its first window would
	 *
	 * @return The server-side room
	 */
	function createGameRoom(): Promise<GameRoom>
	{
		const options: GameJoinOptions = { groupId, characterId: anchor.characterId };

		return(colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, options));
	}

	before(async () =>
	{
		colyseus = await getTestServer();
	});

	beforeEach(async () =>
	{
		await colyseus.cleanup();
		browsers.clear();
		browserMembers.clear();
		universe = await addPlayableUniverse();
		anchor = await addPlayerWithCharacter('Anchor');
		groupId = await addGroup(universe.universeId, anchor.characterId, universe.fieldAreaId, 'The Fellowship');
	});

	it('adds a character to the group\'s starting area when a client joins', async () =>
	{
		const room = await createGameRoom();
		const { client, area } = await joinFromBrowser(room, randomUUID());
		const playerId = playerIdOf(room, client);

		assert.strictEqual(room.getAreaId(playerId), universe.fieldAreaId);
		assert.strictEqual((await area).areaId, universe.fieldAreaId);
		assert.strictEqual((await area).name, 'Field');
	});

	it('refuses windows while a server admin has disabled the universe, and turns away those already in', async () =>
	{
		const room = await createGameRoom();
		const { client } = await joinFromBrowser(room, randomUUID());
		const member = await addPlayerWithCharacter('Latecomer');
		const left = waitForLeave(client);

		await joinGroup(member);
		await setUniverseDisabled(universe.universeId, 'Breaks the rules');
		await assert.rejects(joinAs(room, randomUUID(), member));

		areaChanges.publish({
			kind: 'universeDisabled',
			universeId: universe.universeId
		});

		assert.strictEqual(await left, ServerCloseCode.UniverseDisabled);
	});

	it('turns away a window whose universe is disabled while it joins', async () =>
	{
		const room = await createGameRoom();
		const { client } = await joinFromBrowser(room, randomUUID());
		const member = await addPlayerWithCharacter('Latecomer');

		await joinGroup(member);
		changeDuringNextLookup(room, 'lookUp', async () =>
		{
			await setUniverseDisabled(universe.universeId, 'Breaks the rules');
			areaChanges.publish({
				kind: 'universeDisabled',
				universeId: universe.universeId
			});
		});

		const left = waitForLeave(client);

		await assert.rejects(joinAs(room, randomUUID(), member), refusedWith(ServerCloseCode.UniverseDisabled));
		assert.strictEqual(await left, ServerCloseCode.UniverseDisabled);
		assert.ok(!room.state.players.has(member.characterId));
	});

	it('opens read-only at the end of time, follows the stage as it changes, and turns away players a new stage doesn\'t let play', async () =>
	{
		await updateUniverseSettings(liveVersion(universe.universeId), { stage: 'end_of_time' });

		const room = await createGameRoom();
		const client = await joinAsNewPlayer(room);
		const player = room.state.players.get(playerIdOf(room, client)) as Player;

		await room.waitForNextPatch();
		assert.strictEqual(client.state.locked, true);
		placeOnCell(player, 3, 3);

		client.send(MessageType.Move, { x: 1, y: 0 });
		await room.waitForNextMessage();
		await room.waitForNextTimestep();
		await room.waitForNextTimestep();
		assert.strictEqual(player.x, startCenter.x, 'nothing moves while the room is locked');

		universeAccessChanges.publishStage({
			universeId: universe.universeId,
			stage: 'let_there_be_light',
			previousStage: 'end_of_time',
			roles: new Map()
		});
		assert.strictEqual(room.state.locked, false);

		client.send(MessageType.Move, { x: 1, y: 0 });
		await room.waitForNextMessage();
		await room.waitForNextTimestep();
		await room.waitForNextTimestep();
		assert.ok(player.x > startCenter.x, `x = ${player.x}`);

		// Locking again stops the character at the end of their step, though the key is still held
		universeAccessChanges.publishStage({
			universeId: universe.universeId,
			stage: 'end_of_time',
			previousStage: 'let_there_be_light',
			roles: new Map()
		});
		await waitUntilStopped(room, player);
		assertOnCellCenter(player);

		const left = waitForLeave(client);

		universeAccessChanges.publishStage({
			universeId: universe.universeId,
			stage: 'prologue',
			previousStage: 'end_of_time',
			roles: new Map()
		});
		assert.strictEqual(await left, ServerCloseCode.StageChanged);
	});

	it('syncs the group\'s name, anchor being and members', async () =>
	{
		const room = await createGameRoom();
		const { client } = await joinFromBrowser(room, browserIdA, 'Ada');

		await room.waitForNextPatch();

		const ada = browserMembers.get(browserIdA) as Member;

		assert.strictEqual(client.state.name, 'The Fellowship');
		assert.strictEqual(client.state.anchorId, anchor.characterId);
		assert.deepStrictEqual(client.state.members.get(anchor.characterId)?.toJSON(), { name: 'Anchor', playerId: anchor.playerId, present: false });
		assert.deepStrictEqual(client.state.members.get(ada.characterId)?.toJSON(), { name: 'Ada', playerId: ada.playerId, present: true });
	});

	it('cannot be created for a group that does not exist, or with no group', async () =>
	{
		await assert.rejects(colyseus.createRoom(GAME_ROOM_NAME, { groupId: randomUUID(), characterId: randomUUID() }));
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

		assert.ok(player.x > startCenter.x,`x = ${player.x}`);
		assert.strictEqual(player.y, startCenter.y);

		client.send(MessageType.Move, { x: 0, y: 0 });
		await room.waitForNextMessage();
		await waitUntilStopped(room, player);

		assert.ok(player.x > startCenter.x,`x = ${player.x}`);
		assert.strictEqual(player.y, startCenter.y);
		assertOnCellCenter(player);
	});

	it('passes game time as players walk, and saves the clock when everyone has left', async () =>
	{
		const room = await createGameRoom();
		const client = await joinAsNewPlayer(room);
		const player = room.state.players.get(playerIdOf(room, client)) as Player;

		assert.strictEqual(room.state.clock, GROUP_START_SECONDS);

		placeOnCell(player, 3, 3);

		// Standing still passes no time
		for (let i = 0; i < 10; i++)
		{
			await room.waitForNextTimestep();
		}

		assert.strictEqual(room.state.clock, GROUP_START_SECONDS);

		client.send(MessageType.Move, { x: 1, y: 0 });
		await room.waitForNextMessage();
		await waitUntil(() => (room.state.clock >= (GROUP_START_SECONDS + (2 * DEFAULT_OUTDOOR_WALK_SECONDS))));
		client.send(MessageType.Move, { x: 0, y: 0 });
		await room.waitForNextMessage();
		await waitUntilStopped(room, player);

		const clock = room.state.clock;

		await client.leave();
		await waitUntil(async () => ((await findGroup(groupId))?.clockSeconds === clock));
	});

	for (const settings of [{ passageOfTime: 'faerie', faerieMorning: 'north' }, { passageOfTime: 'always_noon', faerieMorning: null }] as const)
	{
		it(`passes no game time as players walk in an area whose time is ${settings.passageOfTime}`, async () =>
		{
			await updateAreaSettings(universe.fieldAreaId, settings);

			const room = await createGameRoom();
			const client = await joinAsNewPlayer(room);
			const player = room.state.players.get(playerIdOf(room, client)) as Player;
			const startX = player.x;

			client.send(MessageType.Move, { x: 1, y: 0 });
			await room.waitForNextMessage();
			await waitUntil(() => (player.x >= (startX + (2 * GRID_CELL_SIZE))));
			client.send(MessageType.Move, { x: 0, y: 0 });
			await room.waitForNextMessage();
			await waitUntilStopped(room, player);

			assert.strictEqual(room.state.clock, GROUP_START_SECONDS);
		});
	}

	it('shows every member in the area to the whole group, however far apart, and gives each their race\'s darkvision', async () =>
	{
		await updateAreaSettings(universe.fieldAreaId, { passageOfTime: 'always_midnight', faerieMorning: null });

		const room = await createGameRoom();
		const ada = await joinFromBrowser(room, browserIdA, 'Ada');
		const grace = await joinFromBrowser(room, browserIdB, 'Grace');
		const adaId = playerIdOf(room, ada.client);
		const graceId = playerIdOf(room, grace.client);

		placeOnCell(room.state.players.get(adaId) as Player, 0, 0);
		placeOnCell(room.state.players.get(graceId) as Player, 31, 17);

		for (let i = 0; i < 3; i++)
		{
			await room.waitForNextTimestep();
		}

		await waitUntil(() => ((ada.client.state.players?.has(graceId) ?? false) && (grace.client.state.players?.has(adaId) ?? false)));
		assert.strictEqual(room.state.players.get(adaId)?.darkvision, DARKVISION_SQUARES);
	});

	it('sends only the cells the group has seen, each as it is first seen, and remembers them after everyone has left', async () =>
	{
		await updateAreaSettings(universe.fieldAreaId, { passageOfTime: 'always_noon', faerieMorning: null });

		const room = await createGameRoom();
		const window = await joinFromBrowser(room, browserIdA, 'Ada');
		const area = await window.area;

		assert.ok(area.chunks[0].cells.every((value) => (value === UNSEEN_CELL)), 'the group hasn\'t seen anything yet');

		placeOnCell(room.state.players.get(playerIdOf(room, window.client)) as Player, 3, 3);
		await waitUntil(() => window.cellsSeen.has('20,3'));
		assert.strictEqual(window.cellsSeen.get('3,3'), DEFAULT_TILE_CELL);
		assert.strictEqual(window.cellsSeen.has('31,17'), false, 'too far to see');

		await window.client.leave();
		await waitUntil(async () => ((await loadSeenChunks(groupId)).length > 0));

		const saved = new SeenCells();

		saved.load(await loadSeenChunks(groupId));
		assert.ok(saved.has(universe.fieldAreaId, 3, 3) && saved.has(universe.fieldAreaId, 20, 3));

		const again = await joinFromBrowser(await createGameRoom(), browserIdA);
		const { chunks } = await again.area;

		assert.strictEqual(chunks[0].cells[cellIndexInChunk(20, 3)], DEFAULT_TILE_CELL);
		assert.strictEqual(chunks[0].cells[cellIndexInChunk(31, 17)], UNSEEN_CELL);
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

		assert.ok(player.x > startCenter.x,`x = ${player.x}`);
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

	it('removes the character when their player\'s client leaves', async () =>
	{
		const room = await createGameRoom();
		const client1 = await joinAsNewPlayer(room);
		const client2 = await joinAsNewPlayer(room);
		const playerId1 = playerIdOf(room, client1);

		await client1.leave();
		await waitUntil(() => !room.state.players.has(playerId1));

		assert.strictEqual(room.state.players.has(playerIdOf(room, client2)), true);
		assert.strictEqual(room.state.members.get(playerId1)?.present, false);
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

				assert.strictEqual(player.x, startCenter.x);
				assert.strictEqual(player.y, startCenter.y);
				assert.strictEqual(warnings.length, 1);
				assert.ok(warnings[0].startsWith(`${client.sessionId} sent an invalid move message (1 of 10), ignored: `), warnings[0]);

				// Still connected: a valid Move after the invalid one is applied
				client.send(MessageType.Move, { x: 1, y: 0 });
				await room.waitForNextMessage();
				await room.waitForNextTimestep();

				assert.ok(player.x > startCenter.x,`x = ${player.x}`);
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

			assert.ok((player.x > startCenter.x) && (player.x < (startCenter.x + GRID_CELL_SIZE)), `x = ${player.x}`);
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
		await waitUntil(() => !room.state.players.has(playerId));
	});

	describe('windows playing the same character', () =>
	{
		it('control one shared player', async () =>
		{
			const room = await createGameRoom();
			const window1 = await joinFromBrowser(room, browserIdA);
			const window2 = await joinFromBrowser(room, browserIdA);

			assert.strictEqual(playerIdOf(room, window1.client), playerIdOf(room, window2.client));
			assert.strictEqual(room.state.players.size, 1);
		});

		it('are told which character they control', async () =>
		{
			const room = await createGameRoom();
			const window1 = await joinFromBrowser(room, browserIdA);
			const window2 = await joinFromBrowser(room, browserIdA);

			assert.deepStrictEqual(await window1.welcome, { playerId: browserMembers.get(browserIdA)?.characterId });
			assert.deepStrictEqual(await window2.welcome, { playerId: browserMembers.get(browserIdA)?.characterId });
		});

		it('can each move the character', async () =>
		{
			const room = await createGameRoom();
			const window1 = await joinFromBrowser(room, browserIdA);
			const window2 = await joinFromBrowser(room, browserIdA);
			const player = room.state.players.get(playerIdOf(room, window1.client)) as Player;

			placeOnCell(player, 3, 3);

			window2.client.send(MessageType.Move, { x: 1, y: 0 });
			await room.waitForNextMessage();
			await room.waitForNextTimestep();

			assert.ok(player.x > startCenter.x,`x = ${player.x}`);
		});

		it('keep the character until the last one leaves', async () =>
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

		it('stop the character when one of them leaves', async () =>
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
			assert.ok(player.x <= (startCenter.x + GRID_CELL_SIZE), `x = ${player.x}`);
			assertOnCellCenter(player);
		});
	});

	it('gives different players different characters', async () =>
	{
		const room = await createGameRoom();
		const browserA = await joinFromBrowser(room, browserIdA);
		const browserB = await joinFromBrowser(room, browserIdB);

		assert.notStrictEqual(playerIdOf(room, browserA.client), playerIdOf(room, browserB.client));
		assert.strictEqual(room.state.players.size, 2);
	});

	describe('a player with several characters in the group', () =>
	{
		it('brings every one of them onto the map, controlling the one asked for', async () =>
		{
			const room = await createGameRoom();
			const ada = await addPlayerWithCharacter('Ada');

			await joinGroup(ada);

			const second = await addSecondCharacter(ada, 'Byron');
			const { client, welcome } = await joinAs(room, browserIdA, second);

			assert.deepStrictEqual(await welcome, { playerId: second.characterId });
			assert.strictEqual(playerIdOf(room, client), second.characterId);
			assert.ok(room.state.players.has(ada.characterId));
			assert.ok(room.state.players.has(second.characterId));
			assert.strictEqual(room.state.players.get(second.characterId)?.name, 'Byron');
		});

		it('switches a window to another of them without reconnecting, and only that window', async () =>
		{
			const room = await createGameRoom();
			const ada = await addPlayerWithCharacter('Ada');

			await joinGroup(ada);

			const second = await addSecondCharacter(ada, 'Byron');
			const window1 = await joinAs(room, browserIdA, ada);
			const window2 = await joinAs(room, browserIdA, ada);
			const welcome = nextMessage<WelcomePayload>(window1.client, ServerMessageType.Welcome);
			const area = nextMessage<AreaPayload>(window1.client, ServerMessageType.Area);
			const player = room.state.players.get(second.characterId) as Player;

			window1.client.send(GameMessageType.Control, { characterId: second.characterId });

			assert.deepStrictEqual(await welcome, { playerId: second.characterId });
			assert.strictEqual((await area).areaId, universe.fieldAreaId);
			assert.strictEqual(playerIdOf(room, window1.client), second.characterId);
			assert.strictEqual(playerIdOf(room, window2.client), ada.characterId);

			placeOnCell(player, 3, 3);
			window1.client.send(MessageType.Move, { x: 1, y: 0 });
			await room.waitForNextMessage();
			await room.waitForNextTimestep();

			assert.ok(player.x > startCenter.x,`x = ${player.x}`);
		});

		it('ignores switching to a character of another player', async () =>
		{
			const room = await createGameRoom();
			const { client } = await joinFromBrowser(room, browserIdA);
			const other = await joinFromBrowser(room, browserIdB);
			const own = playerIdOf(room, client);

			client.send(GameMessageType.Control, { characterId: playerIdOf(room, other.client) });
			await room.waitForNextMessage();

			assert.strictEqual(playerIdOf(room, client), own);
		});

		it('takes them all off the map when the player\'s last window leaves', async () =>
		{
			const room = await createGameRoom();
			const ada = await addPlayerWithCharacter('Ada');

			await joinGroup(ada);

			const second = await addSecondCharacter(ada, 'Byron');
			const { client } = await joinAs(room, browserIdA, ada);

			await joinFromBrowser(room, browserIdB);
			await client.leave();
			await waitUntil(() => !room.state.players.has(ada.characterId));

			assert.strictEqual(room.state.players.has(second.characterId), false);
		});
	});

	describe('chat', () =>
	{
		it('sends a message to every window as the character the window controls, and the chat to windows joining later', async () =>
		{
			const room = await createGameRoom();
			const ada = await addPlayerWithCharacter('Ada');

			await joinGroup(ada);

			const second = await addSecondCharacter(ada, 'Byron');
			const adaWindow = await joinAs(room, browserIdA, ada);
			const other = await joinFromBrowser(room, browserIdB, 'Cleo');

			assert.deepStrictEqual(playerMessages((await adaWindow.chat.take<KeptChatHistoryPayload>(GameServerMessageType.ChatHistory)).messages), []);
			adaWindow.client.send(GameMessageType.Chat, { text: '  Which way to the tower?  ' });

			const received = await takePlayerMessage(other.chat);

			assert.deepStrictEqual([received.playerId, received.name, received.username, received.text], [ada.playerId, 'Ada', null, 'Which way to the tower?']);
			assert.strictEqual((await takePlayerMessage(adaWindow.chat)).text, received.text);

			const welcome = nextMessage<WelcomePayload>(adaWindow.client, ServerMessageType.Welcome);

			adaWindow.client.send(GameMessageType.Control, { characterId: second.characterId });
			await welcome;
			adaWindow.client.send(GameMessageType.Chat, { text: 'North' });
			assert.strictEqual((await takePlayerMessage(other.chat)).name, 'Byron');

			const later = await joinFromBrowser(room, browserIdB);
			const history = playerMessages((await later.chat.take<KeptChatHistoryPayload>(GameServerMessageType.ChatHistory)).messages);

			assert.deepStrictEqual(history.map((message) => [message.name, message.text]), [['Ada', 'Which way to the tower?'], ['Byron', 'North']]);
		});

		it('takes a deleted account\'s name off its messages, telling the windows and those joining later', async () =>
		{
			const room = await createGameRoom();
			const ada = await addPlayerWithCharacter('Ada');

			await joinGroup(ada);

			const adaWindow = await joinAs(room, browserIdA, ada);
			const other = await joinFromBrowser(room, browserIdB, 'Cleo');

			adaWindow.client.send(GameMessageType.Chat, { text: 'Off I go' });
			await takePlayerMessage(other.chat);
			accountDeletions.publish(ada.playerId);
			assert.deepStrictEqual(await other.chat.take<ChatAuthorDeletedPayload>(GameServerMessageType.ChatAuthorDeleted), { playerId: ada.playerId });

			const later = await joinFromBrowser(room, browserIdB);
			const history = playerMessages((await later.chat.take<KeptChatHistoryPayload>(GameServerMessageType.ChatHistory)).messages);

			assert.deepStrictEqual(history.map((message) => [message.playerId, message.name, message.text]), [[null, '', 'Off I go']]);
		});

		it('drops messages that are empty, too long or hold disallowed characters, and tells a player sending too fast', async () =>
		{
			const room = await createGameRoom();
			const { client, chat } = await joinFromBrowser(room, browserIdA);
			const notice = nextMessage<NoticePayload>(client, GameServerMessageType.Notice);

			client.send(GameMessageType.Chat, { text: '   ' });
			client.send(GameMessageType.Chat, { text: 'x'.repeat(MAX_CHAT_MESSAGE_LENGTH + 1) });
			client.send(GameMessageType.Chat, { text: 'right‮to left' });

			for (let sent = 0; sent < 6; sent++)
			{
				client.send(GameMessageType.Chat, { text: `Line ${sent}` });
			}

			assert.strictEqual((await notice).reason, NoticeReason.ChatTooFast);
			assert.strictEqual((await takePlayerMessage(chat)).text, 'Line 0');
			assert.strictEqual(chat.pending(GameServerMessageType.Chat), 4);
		});

		it('works at the end of time, and keeps the chat in the database, written as the room closes, for the room that opens next', async () =>
		{
			await updateUniverseSettings(liveVersion(universe.universeId), { stage: 'end_of_time' });

			const chat = { kind: 'group', universeId: universe.universeId, groupId } as const;
			const room = await createGameRoom();
			const window = await joinFromBrowser(room, browserIdA, 'Ada');

			window.client.send(GameMessageType.Chat, { text: 'Saved for later' });
			await takePlayerMessage(window.chat);
			assert.deepStrictEqual(playerMessages(await listChatMessages(chat)), []);
			await window.client.leave();
			await waitUntil(async () => (playerMessages(await listChatMessages(chat)).length === 1));

			const reopened = await joinFromBrowser(await createGameRoom(), browserIdA);
			const [kept] = playerMessages((await reopened.chat.take<KeptChatHistoryPayload>(GameServerMessageType.ChatHistory)).messages);

			assert.deepStrictEqual([kept.playerId, kept.name, kept.username, kept.text], [browserMembers.get(browserIdA)?.playerId, 'Ada', null, 'Saved for later']);
		});

		it('writes new messages every few seconds while the room is open', async () =>
		{
			const room = await createGameRoom();
			const window = await joinFromBrowser(room, browserIdA);

			window.client.send(GameMessageType.Chat, { text: 'Checkpoint' });
			await takePlayerMessage(window.chat);
			await room.saveChat();
			assert.deepStrictEqual(playerMessages(await listChatMessages({ kind: 'group', universeId: universe.universeId, groupId })).map((message) => message.text), ['Checkpoint']);
		});
	});

	describe('saving where the group is', () =>
	{
		it('saves where each character was when their player leaves, and starts them there next time', async () =>
		{
			let room = await createGameRoom();
			const { client } = await joinFromBrowser(room, browserIdA);
			const characterId = playerIdOf(room, client);

			placeOnCell(room.state.players.get(characterId) as Player, 7, 4);
			await client.leave();

			await waitUntil(async () => ((await listGroupMembers(groupId)).find((member) => (member.characterId === characterId))?.position !== null));

			const saved = (await listGroupMembers(groupId)).find((member) => (member.characterId === characterId));

			assert.deepStrictEqual(saved?.position, { areaId: universe.fieldAreaId, column: 7, row: 4 });

			// Everyone left, so the room disposes; the group picks up where it was in a new one
			await waitUntil(() => (colyseus.getRoomById(room.roomId) === undefined));
			room = await createGameRoom();

			const back = await joinFromBrowser(room, browserIdA);
			const player = room.state.players.get(playerIdOf(room, back.client)) as Player;

			assert.deepStrictEqual({ x: player.x, y: player.y }, cellCenter({ column: 7, row: 4 }, grid));
		});

		it('starts a character new to the group beside the anchor being', async () =>
		{
			const room = await createGameRoom();
			const anchorWindow = await joinAs(room, browserIdA, anchor);
			const anchorPlayer = room.state.players.get(anchor.characterId) as Player;

			placeOnCell(anchorPlayer, 20, 10);

			const { client } = await joinFromBrowser(room, browserIdB);
			const player = room.state.players.get(playerIdOf(room, client)) as Player;
			const distance = Math.max(Math.abs(player.x - anchorPlayer.x), Math.abs(player.y - anchorPlayer.y)) / GRID_CELL_SIZE;

			assert.strictEqual(distance, 1);
			assert.ok(anchorWindow.client.connection.isOpen);
		});
	});

	describe('group membership', () =>
	{
		it('names the character, not the player', async () =>
		{
			const room = await createGameRoom();
			const { client } = await joinFromBrowser(room, browserIdA, 'Ada');

			assert.strictEqual(room.state.players.get(playerIdOf(room, client))?.name, 'Ada');
		});

		it('turns away a browser that is not logged in', async () =>
		{
			const room = await createGameRoom();

			await assert.rejects(connectFromBrowser(room, browserIdA, anchor.characterId));
		});

		it('turns away a character who is not in the group, or not the player\'s', async () =>
		{
			const room = await createGameRoom();
			const outsider = await addPlayerWithCharacter('Outsider');

			await browsers.logIn(browserIdA, outsider.playerId);
			await assert.rejects(connectFromBrowser(room, browserIdA, outsider.characterId));
			await assert.rejects(connectFromBrowser(room, browserIdA, anchor.characterId));
		});

		it('turns away a character given their last rites', async () =>
		{
			const room = await createGameRoom();

			await scheduleCharacterDeletion(anchor.playerId, universe.universeId, anchor.characterId, new Date(Date.now() + 60000));
			characterChanges.publish({ kind: 'removed', playerId: anchor.playerId, universeId: universe.universeId, characterId: anchor.characterId });
			await browsers.logIn(browserIdA, anchor.playerId);

			await assert.rejects(connectFromBrowser(room, browserIdA, anchor.characterId));
		});

		it('turns away a client without a session cookie', async () =>
		{
			const room = await createGameRoom();

			await assert.rejects(colyseus.connectTo(room, { groupId, characterId: anchor.characterId }));
		});

		it('turns away a browser whose session has ended', async () =>
		{
			const room = await createGameRoom();
			const browser = await browsers.logIn(browserIdA, anchor.playerId);

			await pool.query('DELETE FROM sessions WHERE id = $1', [browser.sessionId]);
			await assert.rejects(connectFromBrowser(room, browserIdA, anchor.characterId));
		});

		it('turns away a browser whose session has expired', async () =>
		{
			const room = await createGameRoom();
			const browser = await browsers.logIn(browserIdA, anchor.playerId);

			await pool.query('UPDATE sessions SET created_at = now() - interval \'25 hours\', last_used_at = now() - interval \'2 hours\' WHERE id = $1', [browser.sessionId]);
			await assert.rejects(connectFromBrowser(room, browserIdA, anchor.characterId));
		});

		it('disconnects the windows of a session when it ends, leaving the player\'s other browsers', async () =>
		{
			const room = await createGameRoom();
			const window1 = await joinAs(room, browserIdA, anchor);
			const window2 = await joinAs(room, browserIdA, anchor);
			const other = await joinAs(room, browserIdB, anchor);
			const left = [waitForLeave(window1.client), waitForLeave(window2.client)];

			connectedSessions.end([(await browsers.logIn(browserIdA, anchor.playerId)).sessionId]);

			assert.deepStrictEqual(await Promise.all(left), [ServerCloseCode.LoggedOut, ServerCloseCode.LoggedOut]);
			await waitUntil(() => (room.clients.length === 1));
			assert.strictEqual(room.clients[0].sessionId, other.client.sessionId);
		});

		it('disconnects every window of a character who leaves the group, and says so in the chat', async () =>
		{
			const room = await createGameRoom();
			const window1 = await joinFromBrowser(room, browserIdA);
			const window2 = await joinFromBrowser(room, browserIdA);
			const other = await joinFromBrowser(room, browserIdB);
			const member = browserMembers.get(browserIdA) as Member;
			const left1 = waitForLeave(window1.client);
			const left2 = waitForLeave(window2.client);
			const result = await leaveGroup(groupId, member.characterId);

			assert.strictEqual(result?.kind, 'left');
			groupChanges.publish({ kind: 'left', groupId, universeId: universe.universeId, character: { ...member, playable: true } });

			assert.strictEqual(await left1, ServerCloseCode.LeftGroup);
			assert.strictEqual(await left2, ServerCloseCode.LeftGroup);
			await waitUntil(() => !room.state.players.has(member.characterId));
			assert.strictEqual(room.state.members.has(member.characterId), false);
			assert.ok(room.state.players.has(playerIdOf(room, other.client)));

			const notice = await other.chat.take<KeptChatMessage>(GameServerMessageType.Chat);

			assert.deepStrictEqual([notice.playerId, notice.name, notice.notice, notice.text], [member.playerId, member.name, 'left', '']);
		});

		it('disconnects everyone when the group is disbanded', async () =>
		{
			const room = await createGameRoom();
			const first = await joinFromBrowser(room, browserIdA);
			const second = await joinAs(room, browserIdB, anchor);
			const left1 = waitForLeave(first.client);
			const left2 = waitForLeave(second.client);

			groupChanges.publish({ kind: 'disbanded', groupId, universeId: universe.universeId, members: [] });

			assert.strictEqual(await left1, ServerCloseCode.GroupDisbanded);
			assert.strictEqual(await left2, ServerCloseCode.GroupDisbanded);
		});

		it('ignores changes to other groups', async () =>
		{
			const room = await createGameRoom();
			const { client } = await joinFromBrowser(room, browserIdA);
			const member = browserMembers.get(browserIdA) as Member;

			groupChanges.publish({ kind: 'left', groupId: randomUUID(), universeId: universe.universeId, character: { ...member, playable: true } });
			groupChanges.publish({ kind: 'disbanded', groupId: randomUUID(), universeId: universe.universeId, members: [] });
			await room.waitForNextTimestep();

			assert.ok(client.connection.isOpen);
		});
	});

	describe('disabling what members use', () =>
	{
		/**
		 * Adds a player with an elf fighter to the group, so a dwarf being barred leaves someone in the room
		 *
		 * @return The member
		 */
		async function addElf(): Promise<Member>
		{
			const player = await addPlayer(`Elf ${randomUUID().slice(0, 8)}`);
			const raceId = await defaultRaceId('elf');
			const character = { ...(await dwarfFighter(player.id, universe.universeId, 'Elrond')), raceId };
			const characterId = await inTransaction((transaction) => createCharacter(character, transaction));
			const member: Member = { playerId: player.id, characterId, name: 'Elrond', raceId, classId: character.classId };

			await joinGroup(member);

			return(member);
		}

		it('takes a member whose race is barred off the map, saving where they were, and lets them back once allowed', async () =>
		{
			const room = await createGameRoom();
			const { client } = await joinFromBrowser(room, browserIdA);
			const member = browserMembers.get(browserIdA) as Member;
			const elf = await joinAs(room, browserIdB, await addElf());
			const left = waitForLeave(client);

			universeAccessChanges.publishBarred({ universeId: universe.universeId, barred: { raceIds: new Set([member.raceId]), classIds: new Set() } });

			assert.strictEqual(await left, ServerCloseCode.CharacterBarred);
			await waitUntil(() => !room.state.players.has(member.characterId));
			assert.ok(elf.client.connection.isOpen);
			await waitUntil(async () => ((await listGroupMembers(groupId)).find((each) => (each.characterId === member.characterId))?.position !== null));
			await assert.rejects(connectFromBrowser(room, browserIdA, member.characterId));

			universeAccessChanges.publishBarred({ universeId: universe.universeId, barred: NOTHING_BARRED });

			const back = await joinAs(room, browserIdA, member);

			assert.ok(back.client.connection.isOpen);
		});

		it('sends the members in a disabled area where they are sent, or to the group\'s starting area', async () =>
		{
			const room = await createGameRoom();
			const { client } = await joinFromBrowser(room, browserIdA);
			const characterId = playerIdOf(room, client);

			areaChanges.publish({ kind: 'evacuated', areaId: universe.fieldAreaId, destination: { areaId: universe.houseAreaId, column: 2, row: 2 } });
			await waitUntil(() => (room.getAreaId(characterId) === universe.houseAreaId));

			areaChanges.publish({ kind: 'evacuated', areaId: universe.houseAreaId, destination: null });
			await waitUntil(() => (room.getAreaId(characterId) === universe.fieldAreaId));
		});

		it('sends a member who comes back while their area is disabled where its members are sent', async () =>
		{
			const room = await createGameRoom();
			const { client } = await joinFromBrowser(room, browserIdA);
			const characterId = playerIdOf(room, client);
			const grace = await joinFromBrowser(room, browserIdB, 'Grace');
			const member = browserMembers.get(browserIdB) as Member;

			await grace.client.leave();
			await waitUntil(() => !room.state.players.has(member.characterId));

			changeDuringNextLookup((room as unknown as { areaPlayers: object }).areaPlayers, 'prepareStart', async () =>
			{
				areaChanges.publish({ kind: 'evacuated', areaId: universe.fieldAreaId, destination: { areaId: universe.houseAreaId, column: 2, row: 2 } });
				await waitUntil(() => (room.getAreaId(characterId) === universe.houseAreaId));
			});

			await joinAs(room, browserIdB, member);

			assert.strictEqual(room.getAreaId(member.characterId), universe.houseAreaId);
		});
	});

	describe('links that require the whole group', () =>
	{
		beforeEach(async () =>
		{
			await createAreaLink({ areaId: universe.fieldAreaId, column: 5, row: 5, targetAreaId: universe.houseAreaId, targetColumn: 2, targetRow: 2, mode: 'manual', requiresWholeGroup: true });
		});

		it('are refused while the anchor being isn\'t here', async () =>
		{
			const room = await createGameRoom();
			const { client } = await joinFromBrowser(room, browserIdA);
			const characterId = playerIdOf(room, client);
			const notice = nextMessage<NoticePayload>(client, GameServerMessageType.Notice);

			placeOnCell(room.state.players.get(characterId) as Player, 5, 5);
			client.send(MessageType.TakeLink);

			assert.deepStrictEqual(await notice, { reason: NoticeReason.GroupNotTogether });
			assert.strictEqual(room.getAreaId(characterId), universe.fieldAreaId);
		});

		it('take every member through together once everyone is here', async () =>
		{
			const room = await createGameRoom();
			const { client } = await joinFromBrowser(room, browserIdA);
			const characterId = playerIdOf(room, client);

			await joinAs(room, browserIdB, anchor);

			placeOnCell(room.state.players.get(characterId) as Player, 5, 5);
			placeOnCell(room.state.players.get(anchor.characterId) as Player, 15, 10);
			client.send(MessageType.TakeLink);

			await waitUntil(() => ((room.getAreaId(characterId) === universe.houseAreaId) && (room.getAreaId(anchor.characterId) === universe.houseAreaId)));
		});
	});
});
