import assert from 'assert';
import type { ColyseusTestServer } from '@colyseus/testing';
import { Client as SDKClient, type Room as ClientRoom } from '@colyseus/sdk';
import { GAME_ROOM_NAME, GameServerMessageType, GameState, SESSION_ROOM_NAME, SessionServerMessageType, sourceTextHash, type GameJoinOptions, type ItemSettings, type ItemsReceivedPayload, type KeptChatHistoryPayload, type KeptChatMessage, type MessageDescriptor, type OptionName, type SessionJoinOptions } from '@multiverse-kiln/shared';

import type appConfig from '../src/app.config.js';
import { giveCharacterItems, takeCharacterItems } from '../src/db/characterRepo.js';
import { addChatMessages, listChatMessages } from '../src/db/chatRepo.js';
import { addGroupMember } from '../src/db/groupRepo.js';
import { createCustomItem, deleteCustomItem, updateCustomItem } from '../src/db/itemRepo.js';
import { inTransaction } from '../src/db/transactions.js';
import { saveTranslation } from '../src/db/universeTextRepo.js';
import { updateUniverseSettings } from '../src/db/universeRepo.js';
import { liveVersion } from '../src/db/universeVersions.js';
import { giveItems } from '../src/http/characters.js';
import { RateLimiter } from '../src/rooms/rateLimiter.js';
import { addCharacter, addGroup, addPlayableUniverse, withoutLobby, type PlayableUniverse } from './db/fixtures.js';
import { Inbox } from './inbox.js';
import { addPlayer, logInBrowser } from './players.js';
import { getTestServer, testServerUrl } from './testServer.js';
import { waitUntil } from './waitUntil.js';

const noSuchCharacter: MessageDescriptor = {
	id: 'error.noSuchCharacter',
	defaultMessage: 'No such character',
	description: 'Why a character who isn\'t there can\'t give items'
};

/**
 * A character in the test group, and their player
 */
interface Member
{
	playerId: string;
	characterId: string;
}

/**
 * A window in the group's game room, and the chat it was sent
 */
interface GameWindow
{
	room: ClientRoom<unknown, GameState>;
	chat: Inbox<GameServerMessageType>;
}

/**
 * The gave notice among a chat's messages
 *
 * @param messages The messages
 * @param itemId The item given
 * @return The item as the notice names it
 */
function gaveItem(messages: readonly KeptChatMessage[], itemId: number): OptionName | undefined
{
	return(messages.find((message) => ((message.notice === 'gave') && (message.details?.itemId === itemId)))?.details?.item);
}

describe('Gift item names', () =>
{
	let colyseus: ColyseusTestServer<typeof appConfig>;
	let universe: PlayableUniverse;
	let groupId: string;
	let giver: Member;
	let german: Member;
	let english: Member;
	let lanternId: number;
	let ropeId: number;

	/**
	 * The client-side rooms a test joined, left after it
	 */
	let joined: ClientRoom[] = [];

	/**
	 * Adds a player with a character in the test group
	 *
	 * @param name The character's name
	 * @return The player and character
	 */
	async function addMember(name: string): Promise<Member>
	{
		const player = await addPlayer(name);
		const characterId = await addCharacter(player.id, universe.universeId, name);

		return({
			playerId: player.id,
			characterId
		});
	}

	/**
	 * Gives one of an item from the giver to another member, as their player's sheet would
	 *
	 * @param receiver Who gets it
	 * @param itemId The item
	 */
	async function give(receiver: Member, itemId: number): Promise<void>
	{
		const refusal = await giveItems({ id: universe.universeId, ruleset: 'pf1e' }, giver.characterId, { characterId: receiver.characterId, itemId, quantity: 1 }, giver.playerId, noSuchCharacter, new RateLimiter(10, 3000));

		assert.strictEqual(refusal, undefined);
	}

	/**
	 * Joins the group's room from a new browser window of a member's player
	 *
	 * @param member The member to play
	 * @param languages The languages the window wants universe text in
	 * @return The window
	 */
	async function joinGame(member: Member, languages: string[]): Promise<GameWindow>
	{
		const browser = await logInBrowser(member.playerId);
		const sdk = new SDKClient(testServerUrl.replace(/^http/, 'ws'), { headers: { cookie: browser.cookie } });
		const options: GameJoinOptions = {
			groupId,
			characterId: member.characterId,
			languages
		};
		const room = await sdk.joinOrCreate<GameState>(GAME_ROOM_NAME, options, GameState);

		joined.push(room);

		return({
			room,
			chat: new Inbox(room, [GameServerMessageType.ChatHistory, GameServerMessageType.Chat])
		});
	}

	/**
	 * The item a gave notice in the chat a window was sent as it joined names
	 *
	 * @param window The window
	 * @param itemId The item given
	 * @return The item as the notice names it
	 */
	async function historyItem(window: GameWindow, itemId: number): Promise<OptionName | undefined>
	{
		return(gaveItem((await window.chat.take<KeptChatHistoryPayload>(GameServerMessageType.ChatHistory)).messages, itemId));
	}

	/**
	 * Takes the next gave notice a window is sent as it is written
	 *
	 * @param window The window
	 * @return The item the notice names
	 */
	async function nextGaveItem(window: GameWindow): Promise<OptionName | undefined>
	{
		for (;;)
		{
			const message = await window.chat.take<KeptChatMessage>(GameServerMessageType.Chat);

			if (message.notice === 'gave')
			{
				return(message.details?.item);
			}
		}
	}

	before(async () =>
	{
		colyseus = await getTestServer();
	});

	beforeEach(async () =>
	{
		await colyseus.cleanup();
		joined = [];
		universe = await addPlayableUniverse();
		await withoutLobby(universe);
		giver = await addMember('Giver');
		german = await addMember('Greta');
		english = await addMember('Edwin');
		groupId = await addGroup(universe.universeId, giver.characterId, universe.fieldAreaId, 'The Fellowship');
		await inTransaction(async (transaction) =>
		{
			await addGroupMember(groupId, german.characterId, transaction);
			await addGroupMember(groupId, english.characterId, transaction);
		});

		const settings: Omit<ItemSettings, 'name'> = {
			description: null,
			enabled: true,
			category: 'gear',
			types: [],
			equips: 'none'
		};

		lanternId = await createCustomItem(liveVersion(universe.universeId), 'pf1e', { ...settings, name: 'Lantern' });
		ropeId = await createCustomItem(liveVersion(universe.universeId), 'pf1e', { ...settings, name: 'Rope' });
		await giveCharacterItems(giver.characterId, [
			{ itemId: lanternId, quantity: 5 },
			{ itemId: ropeId, quantity: 5 }
		]);
		await saveTranslation(liveVersion(universe.universeId), {
			kind: 'item',
			thingId: String(lanternId),
			field: 'name',
			language: 'de',
			text: 'Laterne',
			sourceHash: sourceTextHash('Lantern')
		});
		await updateUniverseSettings(liveVersion(universe.universeId), { translationLanguages: ['de'] });
	});

	afterEach(async () =>
	{
		await Promise.all(joined.map((room) => room.leave()));
	});

	it('names a universe\'s item in the toast in the language of each window of the receiver', async () =>
	{
		const browser = await logInBrowser(german.playerId);

		/**
		 * Opens a window of the German player's browser
		 *
		 * @param languages The languages the window wants universe text in
		 * @return Its messages, once it is told who its player is
		 */
		const openWindow = async (languages: string[]): Promise<Inbox<SessionServerMessageType>> =>
		{
			const sdk = new SDKClient(testServerUrl.replace(/^http/, 'ws'), { headers: { cookie: browser.cookie } });
			const options: SessionJoinOptions = { languages };
			const room = await sdk.joinOrCreate(SESSION_ROOM_NAME, options);
			const inbox = new Inbox(room, Object.values(SessionServerMessageType));

			joined.push(room);
			await inbox.take(SessionServerMessageType.Account);

			return(inbox);
		};

		const inGerman = await openWindow(['de-DE', 'en']);
		const inEnglish = await openWindow(['en-US']);

		await give(german, lanternId);
		assert.strictEqual((await inGerman.take<ItemsReceivedPayload>(SessionServerMessageType.ItemsReceived)).item, 'Laterne');
		assert.strictEqual((await inEnglish.take<ItemsReceivedPayload>(SessionServerMessageType.ItemsReceived)).item, 'Lantern');

		// An item without a German translation keeps the universe's name for it
		await give(german, ropeId);
		assert.strictEqual((await inGerman.take<ItemsReceivedPayload>(SessionServerMessageType.ItemsReceived)).item, 'Rope');
	});

	it('names the item in the group chat\'s gift line in each window\'s language, as it is given and in the chat sent to windows joining', async () =>
	{
		const inGerman = await joinGame(german, ['de-DE']);
		const inEnglish = await joinGame(english, ['en-US']);

		await inGerman.chat.take(GameServerMessageType.ChatHistory);
		await inEnglish.chat.take(GameServerMessageType.ChatHistory);
		await give(english, lanternId);

		assert.deepStrictEqual(await nextGaveItem(inGerman), { key: null, name: 'Laterne' });
		assert.deepStrictEqual(await nextGaveItem(inEnglish), { key: null, name: 'Lantern' });

		assert.deepStrictEqual(await historyItem(await joinGame(german, ['de']), lanternId), { key: null, name: 'Laterne' });
		assert.deepStrictEqual(await historyItem(await joinGame(english, []), lanternId), { key: null, name: 'Lantern' });
	});

	it('names the items in old lines as they are now, and keeps the name a line holds for an item since deleted or a line without the item\'s ID', async () =>
	{
		// Given while nobody has the group's room open, so the lines are read from the database
		await give(german, lanternId);
		await give(german, ropeId);
		await waitUntil(async () => ((await listChatMessages({ kind: 'group', universeId: universe.universeId, groupId })).filter((message) => (message.notice === 'gave')).length === 2));
		await addChatMessages({ kind: 'group', universeId: universe.universeId, groupId }, [
			{
				playerId: giver.playerId,
				authorName: 'Giver',
				notice: 'gave',
				noticeDetails: {
					receiver: 'Greta',
					item: { key: null, name: 'Old lamp' },
					quantity: 1
				},
				text: '',
				sentAt: new Date()
			}
		]);

		await updateCustomItem(liveVersion(universe.universeId), lanternId, {
			name: 'Storm lantern',
			description: null,
			enabled: true,
			category: 'gear',
			types: [],
			equips: 'none'
		});
		await inTransaction(async (transaction) =>
		{
			await takeCharacterItems(german.characterId, 'pf1e', [{ itemId: ropeId, quantity: 1 }], transaction);
			await takeCharacterItems(giver.characterId, 'pf1e', [{ itemId: ropeId, quantity: 4 }], transaction);
		});
		await deleteCustomItem(liveVersion(universe.universeId), ropeId);

		const window = await joinGame(english, ['en']);
		const history = (await window.chat.take<KeptChatHistoryPayload>(GameServerMessageType.ChatHistory)).messages;
		const withoutId = history.find((message) => ((message.notice === 'gave') && (message.details?.itemId === undefined)));

		assert.deepStrictEqual(gaveItem(history, lanternId), { key: null, name: 'Storm lantern' });
		assert.deepStrictEqual(gaveItem(history, ropeId), { key: null, name: 'Rope' });
		assert.deepStrictEqual(withoutId?.details?.item, { key: null, name: 'Old lamp' });
	});
});
