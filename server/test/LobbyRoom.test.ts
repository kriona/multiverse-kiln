import assert from 'assert';
import { randomUUID } from 'crypto';
import type { ColyseusTestServer } from '@colyseus/testing';
import { Client as SDKClient, type Room as ClientRoom } from '@colyseus/sdk';

import { cellIndexInChunk, chunkCoordinate, chunkKey, GRID_CELL_SIZE, LOBBY_ROOM_NAME, LobbyMessageType, LobbyServerMessageType, LobbyState, MAX_CHAT_MESSAGE_LENGTH, MessageType, NoticeReason, ServerMessageType, type ChatHistoryPayload, type ChatMessage, type ChunksPayload, type LobbyJoinOptions, type NoticePayload, type Player, type PlayingAsPayload, type WelcomePayload, type AreaPayload } from '@multiverse-kiln/shared';
import type appConfig from '../src/app.config.js';
import { listPlayableCharacters } from '../src/db/characterRepo.js';
import { loadOrCreatePlayerByName } from '../src/db/playerRepo.js';
import { saveEditedDefaultTile } from '../src/db/tileRepo.js';
import { inTransaction } from '../src/db/transactions.js';
import { createUniverse, setUniverseAreas, updateUniverseSettings } from '../src/db/universeRepo.js';
import { deleteArea, editCells, resizeArea } from '../src/db/areaRepo.js';
import { BROWSER_ID_COOKIE } from '../src/http/browserId.js';
import { cellCenter } from '../src/logic/movement.js';
import { characterChanges } from '../src/players/characterChanges.js';
import { groupChanges } from '../src/players/groupChanges.js';
import { onlinePlayers } from '../src/players/onlinePlayers.js';
import { CHAT_HISTORY_LENGTH, type LobbyRoom } from '../src/rooms/LobbyRoom.js';
import { areaChanges } from '../src/world/areaChanges.js';
import { addCharacter, addPlayableUniverse, addArea, defaultRaceId, defaultTileId, type PlayableUniverse } from './db/fixtures.js';
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
 * @param name The player's name, and their character's unless they are a ghost
 * @param options ghost: join with no character
 * @return The window, with its Welcome message already taken
 */
async function joinAsNewPlayer(universeId: string, name: string, options: { ghost?: boolean } = {}): Promise<LobbyWindow>
{
	const browserId = randomUUID();
	const playerId = (await loadOrCreatePlayerByName(name)).id;

	if (!options.ghost)
	{
		await addCharacter(playerId, universeId, name);
	}

	onlinePlayers.logIn(browserId, playerId, name);

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
		await waitUntil(() => (lobbyOf(window).getAreaId(window.playerId) === universe.houseAreaId));
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

		it('puts a new player in the universe\'s lobby area and sends them its map', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');
			const area = await ada.inbox.take<AreaPayload>(ServerMessageType.Area);

			assert.strictEqual(lobbyOf(ada).getAreaId(ada.playerId), universe.squareAreaId);
			assert.strictEqual(area.areaId, universe.squareAreaId);
			assert.strictEqual(area.name, 'Square');
			assert.deepStrictEqual(area.bounds, { minColumn: 0, minRow: 0, maxColumn: 31, maxRow: 17 });
			assert.strictEqual(area.defaultTileId, await defaultTileId('grass'));
			assert.strictEqual(area.chunks.length, 1);
			assert.deepStrictEqual(area.links, [{ column: 5, row: 5, mode: 'automatic' }]);
			const forest = area.tiles.find((tile) => (tile.key === 'forest'));

			assert.strictEqual(area.ruleset, 'pf1e');
			assert.strictEqual(area.fullVision, true, 'the lobby sees as far as by day unless the universe gives it a vision cost');
			assert.deepStrictEqual(forest, { id: forest?.id, key: 'forest', name: null, color: 0x00aa11, graphic: 'forest', uploadedGraphic: null, impassable: false, visionCost: 0 },'the lobby has no vision cost unless the universe gives it one');
			assert.strictEqual(area.tiles.find((tile) => (tile.key === 'mountains'))?.impassable, true, 'mountains can\'t be entered, so the client draws their peaks over players');
			assert.strictEqual(area.tiles.some((tile) => (tile.name !== null)), false, 'default tiles are named by key, not in English');
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

	describe('areas', () =>
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

		it('takes a player who steps onto an automatic link to its cell in the other area', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');

			await ada.inbox.take(ServerMessageType.Area);
			await walkIntoHouse(ada);

			const area = await ada.inbox.take<AreaPayload>(ServerMessageType.Area);
			const player = playerOf(ada);

			assert.strictEqual(area.name, 'House');
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
			assert.strictEqual(lobbyOf(ada).getAreaId(ada.playerId), universe.houseAreaId);

			placeOnCell(playerOf(ada), 2, 4);
			ada.room.send(MessageType.TakeLink);
			await waitUntil(() => (lobbyOf(ada).getAreaId(ada.playerId) === universe.squareAreaId));

			const player = playerOf(ada);

			assert.deepStrictEqual({ x: player.x, y: player.y }, cellCenter({ column: 5, row: 6 }, { cellSize: GRID_CELL_SIZE }));
		});

		it('shows each window only the players in its own area', async () =>
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

		it('shows each window only the players its character can see, not past mountains or beyond their sight', async () =>
		{
			await updateUniverseSettings(universe.universeId, { lobbyPassageOfTime: 'always_noon', lobbyFaerieMorning: null, lobbyNoVisionCost: false });

			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');
			const grace = await joinAsNewPlayer(universe.universeId, 'Grace');

			// The mountains at (12, 3) stand between them
			placeOnCell(playerOf(ada), 13, 3);
			placeOnCell(playerOf(grace), 11, 3);
			await waitUntil(() => !ada.room.state.players.has(grace.playerId) && !grace.room.state.players.has(ada.playerId));

			placeOnCell(playerOf(grace), 11, 5);
			await waitUntil(() => ada.room.state.players.has(grace.playerId) && grace.room.state.players.has(ada.playerId));

			// Twenty squares away by day, and no further
			placeOnCell(playerOf(ada), 0, 10);
			placeOnCell(playerOf(grace), 21, 10);
			await waitUntil(() => !ada.room.state.players.has(grace.playerId));

			placeOnCell(playerOf(grace), 20, 10);
			await waitUntil(() => ada.room.state.players.has(grace.playerId));
		});

		it('lets a character with darkvision see twelve squares at night', async () =>
		{
			await updateUniverseSettings(universe.universeId, { lobbyPassageOfTime: 'always_midnight', lobbyFaerieMorning: null });

			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');
			const grace = await joinAsNewPlayer(universe.universeId, 'Grace');

			assert.strictEqual(playerOf(ada).darkvision, true);

			placeOnCell(playerOf(ada), 0, 10);
			placeOnCell(playerOf(grace), 13, 10);
			await waitUntil(() => !ada.room.state.players.has(grace.playerId));

			placeOnCell(playerOf(grace), 12, 10);
			await waitUntil(() => ada.room.state.players.has(grace.playerId));
		});

		it('lists a player as here whichever area they are in', async () =>
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
		it('stops a player playing a character here once the character joins a group, and lets them again once it is disbanded', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');
			const grace = await joinAsNewPlayer(universe.universeId, 'Grace');
			const [character] = await listPlayableCharacters(ada.playerId, universe.universeId);
			const member = {
				characterId: character.id,
				playerId: ada.playerId,
				name: character.name,
				raceId: character.raceId,
				playable: true
			};

			await ada.inbox.take(LobbyServerMessageType.PlayingAs);
			groupChanges.publish({ kind: 'joined', groupId: randomUUID(), universeId: universe.universeId, character: member });

			assert.strictEqual((await ada.inbox.take<PlayingAsPayload>(LobbyServerMessageType.PlayingAs)).characterId, null);
			await ada.inbox.take(LobbyServerMessageType.CharactersChanged);
			await waitUntil(() => !grace.room.state.members.has(ada.playerId));

			// A character in a group can't be chosen here
			ada.room.send(LobbyMessageType.ChooseCharacter, { characterId: character.id });
			await lobbyOf(ada).waitForNextMessage();
			assert.strictEqual(playerOf(ada).ghost, true);

			groupChanges.publish({ kind: 'disbanded', groupId: randomUUID(), universeId: universe.universeId, members: [member] });

			assert.strictEqual((await ada.inbox.take<PlayingAsPayload>(LobbyServerMessageType.PlayingAs)).characterId, character.id);
			await waitUntil(() => (grace.room.state.members.get(ada.playerId)?.name === 'Ada'));
		});

		it('does not give back a character who left a group and can\'t be played', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');
			const [character] = await listPlayableCharacters(ada.playerId, universe.universeId);
			const member = {
				characterId: character.id,
				playerId: ada.playerId,
				name: character.name,
				raceId: character.raceId,
				playable: true
			};

			await ada.inbox.take(LobbyServerMessageType.PlayingAs);
			groupChanges.publish({ kind: 'joined', groupId: randomUUID(), universeId: universe.universeId, character: member });
			await ada.inbox.take(LobbyServerMessageType.PlayingAs);
			groupChanges.publish({ kind: 'left', groupId: randomUUID(), universeId: universe.universeId, character: { ...member, playable: false } });
			await ada.inbox.take(LobbyServerMessageType.CharactersChanged);
			await ada.inbox.take(LobbyServerMessageType.CharactersChanged);

			assert.strictEqual(ada.inbox.pending(LobbyServerMessageType.PlayingAs), 0);
			assert.strictEqual(playerOf(ada).ghost, true);
		});
	});

	describe('characters', () =>
	{
		it('starts a player as the character they played or made most recently, and says so', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');
			const [character] = await listPlayableCharacters(ada.playerId, universe.universeId);
			const playingAs = await ada.inbox.take<PlayingAsPayload>(LobbyServerMessageType.PlayingAs);

			assert.strictEqual(playingAs.characterId, character.id);
			assert.strictEqual(playerOf(ada).name, 'Ada');
			assert.strictEqual(playerOf(ada).ghost, false);
		});

		it('makes a player with no character a ghost, whom nobody else sees or lists', async () =>
		{
			const grace = await joinAsNewPlayer(universe.universeId, 'Grace');
			const ghost = await joinAsNewPlayer(universe.universeId, 'Casper', { ghost: true });
			const playingAs = await ghost.inbox.take<PlayingAsPayload>(LobbyServerMessageType.PlayingAs);

			assert.strictEqual(playingAs.characterId, null);

			// The ghost sees Grace and themself
			await waitUntil(() => (ghost.room.state.players?.size === 2));
			assert.strictEqual(ghost.room.state.players.get(ghost.playerId)?.ghost, true);

			const alan = await joinAsNewPlayer(universe.universeId, 'Alan');

			await waitUntil(() => (alan.room.state.players?.size === 2) && (grace.room.state.players?.size === 2));
			await lobbyOf(grace).waitForNextPatch();

			for (const window of [grace, alan])
			{
				assert.ok(!window.room.state.players.has(ghost.playerId));
				assert.ok(!window.room.state.members.has(ghost.playerId));
			}
		});

		it('keeps a ghost hidden as they move between areas', async () =>
		{
			const grace = await joinAsNewPlayer(universe.universeId, 'Grace');
			const ghost = await joinAsNewPlayer(universe.universeId, 'Casper', { ghost: true });

			await walkIntoHouse(grace);
			await walkIntoHouse(ghost);
			await waitUntil(() => ghost.room.state.players.has(grace.playerId));
			await lobbyOf(grace).waitForNextPatch();

			assert.ok(!grace.room.state.players.has(ghost.playerId));
		});

		it('does not let a ghost chat', async () =>
		{
			const ghost = await joinAsNewPlayer(universe.universeId, 'Casper', { ghost: true });

			ghost.room.send(LobbyMessageType.Chat, { text: 'Boo' });
			await lobbyOf(ghost).waitForNextMessage();
			await lobbyOf(ghost).waitForNextPatch();

			assert.strictEqual(ghost.inbox.pending(LobbyServerMessageType.Chat), 0);
		});

		it('lets ghosts and other players pass through each other', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');
			const ghost = await joinAsNewPlayer(universe.universeId, 'Casper', { ghost: true });

			placeOnCell(playerOf(ada), 3, 3);
			placeOnCell(playerOf(ghost), 4, 3);
			ada.room.send(MessageType.Move, { x: 1, y: 0 });
			ghost.room.send(MessageType.Move, { x: -1, y: 0 });

			const start = cellCenter({ column: 3, row: 3 }, { cellSize: GRID_CELL_SIZE });

			await waitUntil(() => (playerOf(ada).x > start.x + GRID_CELL_SIZE) && (playerOf(ghost).x < start.x));
		});

		it('switches every window of a player to the character they choose, and chats as them', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');
			const second = await openWindow(ada.browserId, universe.universeId);
			const grace = await joinAsNewPlayer(universe.universeId, 'Grace');
			const lovelaceId = await addCharacter(ada.playerId, universe.universeId, 'Lovelace');
			const third = await openWindow(ada.browserId, universe.universeId);

			await ada.inbox.take(LobbyServerMessageType.PlayingAs);
			await second.inbox.take(LobbyServerMessageType.PlayingAs);
			await third.inbox.take(LobbyServerMessageType.PlayingAs);

			// A window that joined before the character was made has its characters read again with the third
			ada.room.send(LobbyMessageType.ChooseCharacter, { characterId: lovelaceId });

			for (const window of [ada, second, third])
			{
				assert.strictEqual((await window.inbox.take<PlayingAsPayload>(LobbyServerMessageType.PlayingAs)).characterId, lovelaceId);
			}

			await waitUntil(() => (grace.room.state.members.get(ada.playerId)?.name === 'Lovelace'));
			assert.strictEqual(playerOf(ada).name, 'Lovelace');

			ada.room.send(LobbyMessageType.Chat, { text: 'Hello' });
			assert.strictEqual((await grace.inbox.take<ChatMessage>(LobbyServerMessageType.Chat)).name, 'Lovelace');
		});

		it('switches a player off a character that is deleted, makes them a ghost with none left, and plays one restored', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');
			const [adaCharacter] = await listPlayableCharacters(ada.playerId, universe.universeId);
			const lovelaceId = await addCharacter(ada.playerId, universe.universeId, 'Lovelace');
			const second = await openWindow(ada.browserId, universe.universeId);
			const grace = await joinAsNewPlayer(universe.universeId, 'Grace');

			await ada.inbox.take(LobbyServerMessageType.PlayingAs);
			await second.inbox.take(LobbyServerMessageType.PlayingAs);

			characterChanges.publish({
				kind: 'removed',
				playerId: ada.playerId,
				universeId: universe.universeId,
				characterId: adaCharacter.id
			});

			for (const window of [ada, second])
			{
				assert.strictEqual((await window.inbox.take<PlayingAsPayload>(LobbyServerMessageType.PlayingAs)).characterId, lovelaceId);
				await window.inbox.take(LobbyServerMessageType.CharactersChanged);
			}

			characterChanges.publish({
				kind: 'removed',
				playerId: ada.playerId,
				universeId: universe.universeId,
				characterId: lovelaceId
			});

			assert.strictEqual((await ada.inbox.take<PlayingAsPayload>(LobbyServerMessageType.PlayingAs)).characterId, null);
			await waitUntil(() => !grace.room.state.members.has(ada.playerId));
			assert.strictEqual(playerOf(ada).ghost, true);

			// A ghost can't choose a character that can no longer be played
			ada.room.send(LobbyMessageType.ChooseCharacter, { characterId: lovelaceId });
			await lobbyOf(ada).waitForNextMessage();
			assert.strictEqual(playerOf(ada).ghost, true);

			characterChanges.publish({
				kind: 'restored',
				playerId: ada.playerId,
				universeId: universe.universeId,
				character: {
					id: lovelaceId,
					name: 'Lovelace',
					raceId: await defaultRaceId('dwarf')
				},
				inGroup: false
			});

			assert.strictEqual((await ada.inbox.take<PlayingAsPayload>(LobbyServerMessageType.PlayingAs)).characterId, lovelaceId);
			await waitUntil(() => (grace.room.state.members.get(ada.playerId)?.name === 'Lovelace'));
			assert.strictEqual(playerOf(ada).ghost, false);
		});

		it('ignores a change to a character in another universe', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');
			const [adaCharacter] = await listPlayableCharacters(ada.playerId, universe.universeId);

			await ada.inbox.take(LobbyServerMessageType.PlayingAs);

			characterChanges.publish({
				kind: 'removed',
				playerId: ada.playerId,
				universeId: randomUUID(),
				characterId: adaCharacter.id
			});
			await lobbyOf(ada).waitForNextPatch();

			assert.strictEqual(ada.inbox.pending(LobbyServerMessageType.CharactersChanged), 0);
			assert.strictEqual(playerOf(ada).ghost, false);
		});

		it('ignores a choice of another player\'s character', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');
			const grace = await joinAsNewPlayer(universe.universeId, 'Grace');
			const [graceCharacter] = await listPlayableCharacters(grace.playerId, universe.universeId);

			ada.room.send(LobbyMessageType.ChooseCharacter, { characterId: graceCharacter.id });
			await lobbyOf(ada).waitForNextMessage();
			await lobbyOf(ada).waitForNextPatch();

			assert.strictEqual(playerOf(ada).name, 'Ada');
		});

		it('makes a ghost who has since made a character play them when another window joins', async () =>
		{
			const ghost = await joinAsNewPlayer(universe.universeId, 'Casper', { ghost: true });

			await ghost.inbox.take(LobbyServerMessageType.PlayingAs);

			const characterId = await addCharacter(ghost.playerId, universe.universeId, 'Casper');

			await openWindow(ghost.browserId, universe.universeId);

			assert.strictEqual((await ghost.inbox.take<PlayingAsPayload>(LobbyServerMessageType.PlayingAs)).characterId, characterId);
			assert.strictEqual(playerOf(ghost).ghost, false);
			assert.strictEqual(lobbyOf(ghost).state.members.get(ghost.playerId)?.name, 'Casper');
		});

		it('moves a ghost who becomes a character off another player\'s cell, and shows them', async () =>
		{
			const grace = await joinAsNewPlayer(universe.universeId, 'Grace');
			const ghost = await joinAsNewPlayer(universe.universeId, 'Casper', { ghost: true });

			placeOnCell(playerOf(grace), 3, 3);
			placeOnCell(playerOf(ghost), 3, 3);

			await addCharacter(ghost.playerId, universe.universeId, 'Casper');
			await openWindow(ghost.browserId, universe.universeId);
			await waitUntil(() => grace.room.state.players.has(ghost.playerId));

			assert.notDeepStrictEqual({ x: playerOf(ghost).x, y: playerOf(ghost).y }, { x: playerOf(grace).x, y: playerOf(grace).y });
		});

		it('starts a player as the character they last played the next time they join, over one made since', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');
			const { characterId } = await ada.inbox.take<PlayingAsPayload>(LobbyServerMessageType.PlayingAs);

			await addCharacter(ada.playerId, universe.universeId, 'Lovelace');
			await ada.room.leave();

			// The lobby records the character as it empties, after the window has gone
			const deadline = Date.now() + 2000;

			while (((await listPlayableCharacters(ada.playerId, universe.universeId))[0].id !== characterId) && (Date.now() < deadline))
			{
				await new Promise((resolve) => setTimeout(resolve, 10));
			}

			const again = await openWindow(ada.browserId, universe.universeId);

			assert.strictEqual((await again.inbox.take<PlayingAsPayload>(LobbyServerMessageType.PlayingAs)).characterId, characterId);
		});
	});

	describe('map chunks', () =>
	{
		it('sends the chunks near the player, and more as the player moves', async () =>
		{
			// A long lobby, forest near the center and far to the east
			const universeId = await createUniverse({ name: 'Long Universe', ruleset: 'pf1e', stage: 'let_there_be_light' });
			const areaId = await addArea(universeId, 'Road', { bounds: { minColumn: -500, minRow: -10, maxColumn: 500, maxRow: 10 } });
			const forest = await defaultTileId('forest');

			await inTransaction((transaction) => editCells(areaId, [[1, 1, forest], [400, 1, forest]], transaction));
			await setUniverseAreas(universeId, areaId, areaId);

			const ada = await joinAsNewPlayer(universeId, 'Ada');
			const area = await ada.inbox.take<AreaPayload>(ServerMessageType.Area);
			const farChunk = chunkKey(chunkCoordinate(400), 0);

			assert.ok(area.chunks.some((chunk) => (chunkKey(chunk.chunkColumn, chunk.chunkRow) === chunkKey(0, 0))));
			assert.ok(!area.chunks.some((chunk) => (chunkKey(chunk.chunkColumn, chunk.chunkRow) === farChunk)));

			// Moved by the server, as a link would
			placeOnCell(playerOf(ada), 400, 0);

			let far: ChunksPayload['chunks'][number] | undefined;

			while (!far)
			{
				const update = await ada.inbox.take<ChunksPayload>(ServerMessageType.Chunks);

				assert.strictEqual(update.areaId, areaId);
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

			await ada.inbox.take<AreaPayload>(ServerMessageType.Area);
			await inTransaction((transaction) => editCells(universe.squareAreaId, [[20, 10, water]], transaction));
			areaChanges.publish({ kind: 'cells', areaId: universe.squareAreaId, chunkKeys: [chunkKey(0, 0)] });

			const update = await ada.inbox.take<ChunksPayload>(ServerMessageType.Chunks);

			assert.deepStrictEqual(update.chunks.map((chunk) => [chunk.chunkColumn, chunk.chunkRow]), [[0, 0]]);
			assert.strictEqual(update.chunks[0].cells?.[cellIndexInChunk(20, 10)], water);
		});

		it('sends the area again when it changes, moving players its new bounds leave out', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');
			const smaller = { minColumn: 0, minRow: 0, maxColumn: 9, maxRow: 9 };

			await ada.inbox.take<AreaPayload>(ServerMessageType.Area);
			placeOnCell(playerOf(ada), 20, 15);
			await inTransaction((transaction) => resizeArea(universe.squareAreaId, smaller, true, transaction));
			areaChanges.publish({ kind: 'area', areaId: universe.squareAreaId });

			const area = await ada.inbox.take<AreaPayload>(ServerMessageType.Area);
			const column = Math.floor(playerOf(ada).x / GRID_CELL_SIZE);
			const row = Math.floor(playerOf(ada).y / GRID_CELL_SIZE);

			assert.deepStrictEqual(area.bounds, smaller);
			assert.ok((column <= 9) && (row <= 9), `player at ${column}, ${row}`);
		});

		it('sends players in a deleted area back to the lobby area', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');

			await walkIntoHouse(ada);
			await deleteArea(universe.houseAreaId);
			areaChanges.publish({ kind: 'deleted', areaId: universe.houseAreaId });

			await waitUntil(() => (lobbyOf(ada).getAreaId(ada.playerId) === universe.squareAreaId));
		});

		it('sends the area again with the universe\'s edited tiles', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');
			const grass = await defaultTileId('grass');

			await ada.inbox.take<AreaPayload>(ServerMessageType.Area);
			await saveEditedDefaultTile(universe.universeId, 'pf1e', grass, { name: 'Autumn Grass', indoors: false, outdoors: true, color: 0xc08030, graphic: 'grass', uploadedGraphicId: null, visionCost: 0, walkSeconds: 600, enabled: true });
			areaChanges.publish({ kind: 'tiles', universeId: universe.universeId });

			const area = await ada.inbox.take<AreaPayload>(ServerMessageType.Area);

			assert.deepStrictEqual(area.tiles.find((tile) => (tile.id === grass)), { id: grass, key: null, name: 'Autumn Grass', color: 0xc08030, graphic: 'grass', uploadedGraphic: null, impassable: false, visionCost: 0 });
		});

		it('sends the lobby again with its tiles\' vision costs once the universe gives it them', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');
			const forest = await defaultTileId('forest');

			await ada.inbox.take<AreaPayload>(ServerMessageType.Area);
			await updateUniverseSettings(universe.universeId, { lobbyNoVisionCost: false });
			areaChanges.publish({ kind: 'tiles', universeId: universe.universeId });

			const area = await ada.inbox.take<AreaPayload>(ServerMessageType.Area);

			assert.strictEqual(area.tiles.find((tile) => (tile.id === forest))?.visionCost, 50);
			assert.strictEqual(area.fullVision, false);
		});

		it('ignores changes to areas it hasn\'t loaded', async () =>
		{
			const ada = await joinAsNewPlayer(universe.universeId, 'Ada');

			await ada.inbox.take<AreaPayload>(ServerMessageType.Area);
			areaChanges.publish({ kind: 'area', areaId: randomUUID() });
			areaChanges.publish({ kind: 'tiles', universeId: randomUUID() });
			await new Promise((resolve) => setTimeout(resolve, 300));

			assert.strictEqual(ada.inbox.pending(ServerMessageType.Area), 0);
		});
	});
});
