import assert from 'assert';
import { randomUUID } from 'crypto';
import type { ColyseusTestServer } from '@colyseus/testing';
import { Client as SDKClient, type Room as ClientRoom } from '@colyseus/sdk';

import { cellIndexInChunk, chunkCoordinate, chunkKey, GAME_ROOM_NAME, GRID_CELL_SIZE, LOBBY_ROOM_NAME, LobbyMessageType, LobbyServerMessageType, LobbyState, MAX_CHAT_MESSAGE_LENGTH, MessageType, NoticeReason, ServerMessageType, type ChatHistoryPayload, type ChatMessage, type ChunksPayload, type LobbyJoinOptions, type NoticePayload, type Player, type WelcomePayload, type ZonePayload } from '@multiverse-kiln/shared';
import type appConfig from '../src/app.config.js';
import { saveEditedDefaultTile } from '../src/db/tileRepo.js';
import { inTransaction } from '../src/db/transactions.js';
import { createUniverse, setUniverseZones } from '../src/db/universeRepo.js';
import { deleteZone, editCells, resizeZone } from '../src/db/zoneRepo.js';
import { BROWSER_ID_COOKIE } from '../src/http/browserId.js';
import { cellCenter } from '../src/logic/movement.js';
import { onlinePlayers } from '../src/players/onlinePlayers.js';
import { CHAT_HISTORY_LENGTH, type LobbyRoom } from '../src/rooms/LobbyRoom.js';
import { zoneChanges } from '../src/world/zoneChanges.js';
import { addPlayableUniverse, addZone, defaultTileId, type PlayableUniverse } from './db/fixtures.js';
import { Inbox } from './inbox.js';
import { getTestServer, logOutEveryone, testServerUrl } from './testServer.js';
import { waitUntil } from './waitUntil.js';

type LobbyMessage = LobbyServerMessageType | ServerMessageType;

/**
 * A browser window in a universe's lobby
 */
interface LobbyWindow
{
	room: ClientRoom<unknown, LobbyState>;
	inbox: Inbox<LobbyMessage>;
	browserId: string;
	playerId: string;
}

/**
 * Connects to a universe's lobby like a browser window holding a browser ID cookie
 *
 * @param browserId Browser ID the window's cookie holds
 * @param options The join options
 * @return The client-side room
 */
function connect(browserId: string, options: unknown): Promise<ClientRoom<unknown, LobbyState>>
{
	const sdk = new SDKClient(testServerUrl.replace(/^http/, 'ws'), { headers: { cookie: `${BROWSER_ID_COOKIE}=${browserId}` } });

	return(sdk.joinOrCreate<LobbyState>(LOBBY_ROOM_NAME, options, LobbyState));
}

/**
 * Logs a new browser in, as the session room would, and opens a window of it in a universe's lobby
 *
 * @param universeId The universe whose lobby to join
 * @param name The player's name
 * @return The window, with its Welcome message already taken
 */
async function joinAsNewPlayer(universeId: string, name: string): Promise<LobbyWindow>
{
	const browserId = randomUUID();

	onlinePlayers.logIn(browserId, randomUUID(), name);

	return(openWindow(browserId, universeId));
}

/**
 * Opens a window of an already logged-in browser in a universe's lobby
 *
 * @param browserId The browser's ID
 * @param universeId The universe whose lobby to join
 * @return The window, with its Welcome message already taken
 */
async function openWindow(browserId: string, universeId: string): Promise<LobbyWindow>
{
	const options: LobbyJoinOptions = { universeId };
	const room = await connect(browserId, options);
	const inbox = new Inbox<LobbyMessage>(room, [...Object.values(LobbyServerMessageType), ...Object.values(ServerMessageType)]);
	const welcome = await inbox.take<WelcomePayload>(ServerMessageType.Welcome);

	return({ room, inbox, browserId, playerId: welcome.playerId });
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
	const center = cellCenter({ column, row }, { cellSize: GRID_CELL_SIZE });

	player.x = center.x;
	player.y = center.y;
}

describe('LobbyRoom', () =>
{
	let colyseus: ColyseusTestServer<typeof appConfig>;
	let universe: PlayableUniverse;

	/**
	 * The server-side lobby a window is in
	 *
	 * @param window The window
	 * @return The room
	 */
	function lobbyOf(window: LobbyWindow): LobbyRoom
	{
		return(colyseus.getRoomById<LobbyRoom>(window.room.roomId));
	}

	/**
	 * A window's player in the server-side room
	 *
	 * @param window The window
	 * @return The player
	 */
	function playerOf(window: LobbyWindow): Player
	{
		const player = lobbyOf(window).state.players.get(window.playerId);

		assert.ok(player, `no player ${window.playerId}`);

		return(player);
	}

	/**
	 * Sends a window's player through the square's door into the house
	 *
	 * @param window The window
	 */
	async function walkIntoHouse(window: LobbyWindow): Promise<void>
	{
		placeOnCell(playerOf(window), 4, 5);
		window.room.send(MessageType.Move, { x: 1, y: 0 });
		await waitUntil(() => (lobbyOf(window).getZoneId(window.playerId) === universe.houseZoneId));
		window.room.send(MessageType.Move, { x: 0, y: 0 });
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

	describe('joining', () =>
	{
		it('turns away a browser that is not logged in', async () =>
		{
			await assert.rejects(connect(randomUUID(), { universeId: universe.universeId }));
		});

		it('turns away a client asking for a universe that does not exist, or no universe', async () =>
		{
			const browserId = randomUUID();

			onlinePlayers.logIn(browserId, randomUUID(), 'Ada');

			await assert.rejects(connect(browserId, { universeId: randomUUID() }));
			await assert.rejects(connect(browserId, {}));
		});

		it('is one room per universe', async () =>
		{
			const other = await addPlayableUniverse();
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');
			const grace = await joinAsNewPlayer(universe.universeId, 'Grace');
			const alan = await joinAsNewPlayer(other.universeId, 'Alan');

			assert.strictEqual(ada.room.roomId, grace.room.roomId);
			assert.notStrictEqual(ada.room.roomId, alan.room.roomId);
		});

		it('puts a new player in the universe\'s lobby zone and sends them its map', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');
			const zone = await ada.inbox.take<ZonePayload>(ServerMessageType.Zone);

			assert.strictEqual(lobbyOf(ada).getZoneId(ada.playerId), universe.squareZoneId);
			assert.strictEqual(zone.zoneId, universe.squareZoneId);
			assert.strictEqual(zone.name, 'Square');
			assert.deepStrictEqual(zone.bounds, { minColumn: 0, minRow: 0, maxColumn: 31, maxRow: 17 });
			assert.strictEqual(zone.defaultTileId, await defaultTileId('grass'));
			assert.strictEqual(zone.chunks.length, 1);
			assert.deepStrictEqual(zone.links, [{ column: 5, row: 5, mode: 'automatic' }]);
			assert.strictEqual(zone.tiles.find((tile) => (tile.name === 'Forest'))?.color, 0x00aa11);
		});

		it('lists who is here, and stops listing them once they leave', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');
			const grace = await joinAsNewPlayer(universe.universeId, 'Grace');

			await waitUntil(() => (ada.room.state.members?.size === 2));
			assert.strictEqual(ada.room.state.members.get(grace.playerId)?.name, 'Grace');

			await grace.room.leave();
			await waitUntil(() => (ada.room.state.members.size === 1));
		});

		it('gives every window of a browser the same player', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');
			const second = await openWindow(ada.browserId, universe.universeId);

			assert.strictEqual(second.playerId, ada.playerId);
			assert.strictEqual(lobbyOf(ada).state.members.size, 1);
		});
	});

	describe('zones', () =>
	{
		it('does not let a player walk into the mountains', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');
			const player = playerOf(ada);

			placeOnCell(player, 11, 3);
			ada.room.send(MessageType.Move, { x: 1, y: 0 });

			for (let i = 0; i < 10; i++)
			{
				await lobbyOf(ada).waitForNextTimestep();
			}

			assert.strictEqual(player.x, cellCenter({ column: 11, row: 3 }, { cellSize: GRID_CELL_SIZE }).x);
		});

		it('takes a player who steps onto an automatic link to its cell in the other zone', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');

			await ada.inbox.take(ServerMessageType.Zone);
			await walkIntoHouse(ada);

			const zone = await ada.inbox.take<ZonePayload>(ServerMessageType.Zone);
			const player = playerOf(ada);

			assert.strictEqual(zone.name, 'House');
			assert.deepStrictEqual({ x: player.x, y: player.y }, cellCenter({ column: 2, row: 2 }, { cellSize: GRID_CELL_SIZE }));
		});

		it('takes a player standing on a manual link through it when asked, and not otherwise', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');

			await walkIntoHouse(ada);

			// (2, 2), where the player arrived, has no link
			ada.room.send(MessageType.TakeLink);
			await lobbyOf(ada).waitForNextMessage();
			await lobbyOf(ada).waitForNextTimestep();
			assert.strictEqual(lobbyOf(ada).getZoneId(ada.playerId), universe.houseZoneId);

			placeOnCell(playerOf(ada), 2, 4);
			ada.room.send(MessageType.TakeLink);
			await waitUntil(() => (lobbyOf(ada).getZoneId(ada.playerId) === universe.squareZoneId));

			const player = playerOf(ada);

			assert.deepStrictEqual({ x: player.x, y: player.y }, cellCenter({ column: 5, row: 6 }, { cellSize: GRID_CELL_SIZE }));
		});

		it('shows each window only the players in its own zone', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');
			const grace = await joinAsNewPlayer(universe.universeId, 'Grace');

			await waitUntil(() => (ada.room.state.players?.size === 2) && (grace.room.state.players?.size === 2));

			await walkIntoHouse(ada);

			await waitUntil(() => !grace.room.state.players.has(ada.playerId) && !ada.room.state.players.has(grace.playerId));
			assert.ok(ada.room.state.players.has(ada.playerId));
			assert.ok(grace.room.state.players.has(grace.playerId));

			// Grace follows Ada in, and they see each other again
			await walkIntoHouse(grace);
			await waitUntil(() => grace.room.state.players.has(ada.playerId) && ada.room.state.players.has(grace.playerId));
		});

		it('lists a player as here whichever zone they are in', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');
			const grace = await joinAsNewPlayer(universe.universeId, 'Grace');

			await walkIntoHouse(ada);
			await waitUntil(() => !grace.room.state.players.has(ada.playerId));

			assert.ok(grace.room.state.members.has(ada.playerId));
		});
	});

	describe('chat', () =>
	{
		it('sends a message to everyone in the lobby', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');
			const grace = await joinAsNewPlayer(universe.universeId, 'Grace');

			ada.room.send(LobbyMessageType.Chat, { text: ' Hello! ' });

			const received = await grace.inbox.take<ChatMessage>(LobbyServerMessageType.Chat);
			const echoed = await ada.inbox.take<ChatMessage>(LobbyServerMessageType.Chat);

			assert.strictEqual(received.text, 'Hello!');
			assert.strictEqual(received.name, 'Ada');
			assert.strictEqual(received.playerId, ada.playerId);
			assert.deepStrictEqual(echoed, received);
		});

		it('does not send a message to another universe\'s lobby', async () =>
		{
			const other = await addPlayableUniverse();
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');
			const alan = await joinAsNewPlayer(other.universeId, 'Alan');

			ada.room.send(LobbyMessageType.Chat, { text: 'Hello' });
			await ada.inbox.take(LobbyServerMessageType.Chat);
			await lobbyOf(alan).waitForNextPatch();

			assert.strictEqual(alan.inbox.pending(LobbyServerMessageType.Chat), 0);
		});

		it('ignores a message that is too long', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');

			ada.room.send(LobbyMessageType.Chat, { text: 'x'.repeat(MAX_CHAT_MESSAGE_LENGTH + 1) });
			ada.room.send(LobbyMessageType.Chat, { text: 'x'.repeat(MAX_CHAT_MESSAGE_LENGTH) });

			const received = await ada.inbox.take<ChatMessage>(LobbyServerMessageType.Chat);

			assert.strictEqual(received.text.length, MAX_CHAT_MESSAGE_LENGTH);
		});

		it('sends the recent chat to a player who joins later, keeping only the most recent messages', async () =>
		{
			const players = await Promise.all(Array.from({ length: 11 }, (_, i) => joinAsNewPlayer(universe.universeId, `Player ${i}`)));
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

			const late = await joinAsNewPlayer(universe.universeId, 'Late');
			const history = await late.inbox.take<ChatHistoryPayload>(LobbyServerMessageType.ChatHistory);

			assert.strictEqual(history.messages.length, CHAT_HISTORY_LENGTH);
			assert.strictEqual(history.messages[0].text, `message ${sent - CHAT_HISTORY_LENGTH + 1}`);
			assert.strictEqual(history.messages[CHAT_HISTORY_LENGTH - 1].text, `message ${sent}`);
		});

		it('drops messages sent too quickly, and says so', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');

			for (let i = 0; i < 6; i++)
			{
				ada.room.send(LobbyMessageType.Chat, { text: `message ${i}` });
			}

			const notice = await ada.inbox.take<NoticePayload>(LobbyServerMessageType.Notice);

			assert.strictEqual(notice.reason, NoticeReason.ChatTooFast);
			await lobbyOf(ada).waitForNextPatch();
			assert.strictEqual(ada.inbox.pending(LobbyServerMessageType.Chat), 5);
		});
	});

	describe('groups', () =>
	{
		it('creates a group in the universe and puts the player in it', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');

			ada.room.send(LobbyMessageType.CreateGroup);
			await waitUntil(() => (onlinePlayers.get(ada.browserId)?.groupId !== undefined));

			const groupId = onlinePlayers.get(ada.browserId)?.groupId as string;

			assert.strictEqual(colyseus.getRoomById(groupId).roomName, GAME_ROOM_NAME);
		});
	});

	describe('map chunks', () =>
	{
		it('sends the chunks near the player, and more as the player moves', async () =>
		{
			// A long lobby, forest near the center and far to the east
			const universeId = await createUniverse({ name: 'Long Universe', ruleset: 'pf1e', stage: 'let_there_be_light' });
			const zoneId = await addZone(universeId, 'Road', { bounds: { minColumn: -500, minRow: -10, maxColumn: 500, maxRow: 10 } });
			const forest = await defaultTileId('forest');

			await inTransaction((transaction) => editCells(zoneId, [[1, 1, forest], [400, 1, forest]], transaction));
			await setUniverseZones(universeId, zoneId, zoneId);

			const ada = await joinAsNewPlayer(universeId, 'Ada');
			const zone = await ada.inbox.take<ZonePayload>(ServerMessageType.Zone);
			const farChunk = chunkKey(chunkCoordinate(400), 0);

			assert.ok(zone.chunks.some((chunk) => (chunkKey(chunk.chunkColumn, chunk.chunkRow) === chunkKey(0, 0))));
			assert.ok(!zone.chunks.some((chunk) => (chunkKey(chunk.chunkColumn, chunk.chunkRow) === farChunk)));

			// Moved by the server, as a link would
			placeOnCell(playerOf(ada), 400, 0);

			let far: ChunksPayload['chunks'][number] | undefined;

			while (!far)
			{
				const update = await ada.inbox.take<ChunksPayload>(ServerMessageType.Chunks);

				assert.strictEqual(update.zoneId, zoneId);
				far = update.chunks.find((chunk) => (chunkKey(chunk.chunkColumn, chunk.chunkRow) === farChunk));
			}

			assert.strictEqual(far.cells?.[cellIndexInChunk(400, 1)], forest);
		});
	});

	describe('world changes', () =>
	{
		it('sends painted cells to the players near them', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');
			const water = await defaultTileId('water');

			await ada.inbox.take<ZonePayload>(ServerMessageType.Zone);
			await inTransaction((transaction) => editCells(universe.squareZoneId, [[20, 10, water]], transaction));
			zoneChanges.publish({ kind: 'cells', zoneId: universe.squareZoneId, chunkKeys: [chunkKey(0, 0)] });

			const update = await ada.inbox.take<ChunksPayload>(ServerMessageType.Chunks);

			assert.deepStrictEqual(update.chunks.map((chunk) => [chunk.chunkColumn, chunk.chunkRow]), [[0, 0]]);
			assert.strictEqual(update.chunks[0].cells?.[cellIndexInChunk(20, 10)], water);
		});

		it('sends the zone again when it changes, moving players its new bounds leave out', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');
			const smaller = { minColumn: 0, minRow: 0, maxColumn: 9, maxRow: 9 };

			await ada.inbox.take<ZonePayload>(ServerMessageType.Zone);
			placeOnCell(playerOf(ada), 20, 15);
			await inTransaction((transaction) => resizeZone(universe.squareZoneId, smaller, true, transaction));
			zoneChanges.publish({ kind: 'zone', zoneId: universe.squareZoneId });

			const zone = await ada.inbox.take<ZonePayload>(ServerMessageType.Zone);
			const column = Math.floor(playerOf(ada).x / GRID_CELL_SIZE);
			const row = Math.floor(playerOf(ada).y / GRID_CELL_SIZE);

			assert.deepStrictEqual(zone.bounds, smaller);
			assert.ok((column <= 9) && (row <= 9), `player at ${column}, ${row}`);
		});

		it('sends players in a deleted zone back to the lobby zone', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');

			await walkIntoHouse(ada);
			await deleteZone(universe.houseZoneId);
			zoneChanges.publish({ kind: 'deleted', zoneId: universe.houseZoneId });

			await waitUntil(() => (lobbyOf(ada).getZoneId(ada.playerId) === universe.squareZoneId));
		});

		it('sends the zone again with the universe\'s edited tiles', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');
			const grass = await defaultTileId('grass');

			await ada.inbox.take<ZonePayload>(ServerMessageType.Zone);
			await saveEditedDefaultTile(universe.universeId, 'pf1e', grass, { name: 'Autumn Grass', indoors: false, color: 0xc08030, visionCost: 0, movementCost: 0 });
			zoneChanges.publish({ kind: 'tiles', universeId: universe.universeId });

			const zone = await ada.inbox.take<ZonePayload>(ServerMessageType.Zone);

			assert.deepStrictEqual(zone.tiles.find((tile) => (tile.id === grass)), { id: grass, name: 'Autumn Grass', color: 0xc08030 });
		});

		it('ignores changes to zones it hasn\'t loaded', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');

			await ada.inbox.take<ZonePayload>(ServerMessageType.Zone);
			zoneChanges.publish({ kind: 'zone', zoneId: randomUUID() });
			zoneChanges.publish({ kind: 'tiles', universeId: randomUUID() });
			await new Promise((resolve) => setTimeout(resolve, 300));

			assert.strictEqual(ada.inbox.pending(ServerMessageType.Zone), 0);
		});
	});
});
