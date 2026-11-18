import assert from 'assert';
import { Client as SDKClient } from '@colyseus/sdk';
import { characterPath, EDITOR_UNIVERSES_PATH, SESSION_ROOM_NAME, SessionServerMessageType, type CharacterItemsPayload, type CharacterSheet, type CreatedPayload, type EquippedItem, type ItemSettings, type ItemsReceivedPayload, type Ruleset } from '@multiverse-kiln/shared';

import { createCharacter, giveCharacterItems } from '../src/db/characterRepo.js';
import { listChatMessages } from '../src/db/chatRepo.js';
import { findDefaultClassIds } from '../src/db/classRepo.js';
import { addGroupMember } from '../src/db/groupRepo.js';
import { createCustomItem } from '../src/db/itemRepo.js';
import { findDefaultRaceIds } from '../src/db/raceRepo.js';
import { loadEditorThemes } from '../src/db/themeRepo.js';
import { inTransaction } from '../src/db/transactions.js';
import { setUniverseRole } from '../src/db/universeEditorRepo.js';
import { liveVersion } from '../src/db/universeVersions.js';
import { addCharacter, addGroup, defaultRaceId, dwarfFighter } from './db/fixtures.js';
import { Inbox } from './inbox.js';
import { addPlayer, logInBrowser, type TestBrowser } from './players.js';
import { getTestServer, testServerUrl } from './testServer.js';
import { waitUntil } from './waitUntil.js';

/**
 * What a request answered
 */
interface Answer<T>
{
	status: number;
	body: T;
}

/**
 * Logs a new browser in as a player
 *
 * @param name The player's name
 * @return The browser and its player
 */
async function logIn(name: string): Promise<TestBrowser>
{
	return(await logInBrowser((await addPlayer(name)).id));
}

/**
 * Sends a JSON request to the server
 *
 * @param browser The browser sending it
 * @param method The HTTP method
 * @param path The path
 * @param body The JSON body, if any
 * @return The status and the parsed body
 */
async function send<T = unknown>(browser: TestBrowser, method: string, path: string, body?: unknown): Promise<Answer<T>>
{
	const headers: Record<string, string> = {
		Cookie: browser.cookie
	};

	if (body !== undefined)
	{
		headers['Content-Type'] = 'application/json';
	}

	const response = await fetch(`${testServerUrl}${path}`, {
		method,
		headers,
		body: ((body === undefined) ? undefined : JSON.stringify(body))
	});
	const text = await response.text();

	return({
		status: response.status,
		body: ((text === '') ? undefined : JSON.parse(text)) as T
	});
}

/**
 * Makes a universe, with its creator logged in
 *
 * @param creator The creator's browser
 * @param ruleset The universe's ruleset
 * @return The universe's ID
 */
async function makeUniverse(creator: TestBrowser, ruleset: Ruleset): Promise<string>
{
	const created = await send<CreatedPayload>(creator, 'POST', EDITOR_UNIVERSES_PATH, {
		name: `Kilnhaven ${ruleset}`,
		shortDescription: 'A small town.',
		ruleset
	});

	assert.strictEqual(created.status, 201, JSON.stringify(created.body));

	return(created.body.id);
}

/**
 * Adds an item of the universe's own to its live version
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param name The item's name
 * @param settings Its category, types and where it equips
 * @return The item's ID
 */
function addItem(universeId: string, ruleset: Ruleset, name: string, settings: Pick<ItemSettings, 'category' | 'types' | 'equips'>): Promise<number>
{
	return(createCustomItem(liveVersion(universeId), ruleset, {
		name,
		description: null,
		enabled: true,
		...settings
	}));
}

/**
 * An item equipped in a slot
 *
 * @param slot The slot
 * @param itemId The item
 * @param bothHands Whether it is held in both hands
 * @return The equipped item
 */
function at(slot: string, itemId: number, bothHands = false): EquippedItem
{
	return({
		slot,
		itemId,
		bothHands
	});
}

describe('Equipment routes', () =>
{
	let ada: TestBrowser;
	let universeId: string;
	let brokkId: string;
	let longswordId: number;
	let heavyShieldId: number;
	let greatswordId: number;
	let shortSwordId: number;
	let bookId: number;
	let tailbladeId: number;

	before(async () =>
	{
		await getTestServer();
	});

	beforeEach(async () =>
	{
		ada = await logIn('Ada');
		universeId = await makeUniverse(ada, 'pf1e');
		brokkId = await addCharacter(ada.playerId, universeId, 'Brokk');
		longswordId = await addItem(universeId, 'pf1e', 'Longsword', { category: 'weapon', types: ['blades_heavy'], equips: 'oneHand' });
		heavyShieldId = await addItem(universeId, 'pf1e', 'Heavy steel shield', { category: 'armor', types: ['shields'], equips: 'oneHand' });
		greatswordId = await addItem(universeId, 'pf1e', 'Greatsword', { category: 'weapon', types: ['blades_heavy'], equips: 'twoHands' });
		shortSwordId = await addItem(universeId, 'pf1e', 'Short sword', { category: 'weapon', types: ['blades_light'], equips: 'oneHand' });
		bookId = await addItem(universeId, 'pf1e', 'Book', { category: 'gear', types: [], equips: 'none' });
		tailbladeId = await addItem(universeId, 'pf1e', 'Tailblade', { category: 'weapon', types: [], equips: 'tail' });
		await giveCharacterItems(brokkId, [
			{ itemId: longswordId, quantity: 1 },
			{ itemId: heavyShieldId, quantity: 1 },
			{ itemId: greatswordId, quantity: 1 },
			{ itemId: shortSwordId, quantity: 2 },
			{ itemId: bookId, quantity: 1 },
			{ itemId: tailbladeId, quantity: 1 }
		]);
	});

	/**
	 * A character's sheet, as their player sees it
	 *
	 * @param characterId The character's ID
	 * @param browser The player's browser
	 * @param universe The character's universe
	 * @return The sheet
	 */
	async function sheetOf(characterId: string, browser: TestBrowser = ada, universe: string = universeId): Promise<CharacterSheet>
	{
		const answer = await send<CharacterSheet>(browser, 'GET', characterPath(universe, characterId));

		assert.strictEqual(answer.status, 200, JSON.stringify(answer.body));

		return(answer.body);
	}

	/**
	 * Asks to equip an item on Brokk
	 *
	 * @param itemId The item
	 * @param hand The hands to hold it in
	 * @return The status
	 */
	async function equip(itemId: number, hand: 'main' | 'off' | 'both' | null): Promise<number>
	{
		return((await send(ada, 'POST', `${characterPath(universeId, brokkId)}/items/equip`, { itemId, hand })).status);
	}

	it('equips a longsword and a shield, then a greatsword unequips both', async () =>
	{
		assert.strictEqual(await equip(longswordId, 'main'), 204);
		assert.strictEqual(await equip(heavyShieldId, 'off'), 204);
		assert.deepStrictEqual((await sheetOf(brokkId)).equipment, [at('mainHand', longswordId), at('offHand', heavyShieldId)]);

		assert.strictEqual(await equip(greatswordId, null), 204);

		const sheet = await sheetOf(brokkId);

		assert.deepStrictEqual(sheet.equipment, [at('mainHand', greatswordId, true)]);
		assert.deepStrictEqual(sheet.items.find((item) => (item.id === greatswordId)), {
			id: greatswordId,
			key: null,
			name: 'Greatsword',
			description: null,
			category: 'weapon',
			types: ['blades_heavy'],
			equips: 'twoHands',
			rulebook: null,
			quantity: 1
		});
		assert.strictEqual(sheet.hasTail, false);
	});

	it('holds a short sword in each hand', async () =>
	{
		assert.strictEqual(await equip(shortSwordId, 'main'), 204);
		assert.strictEqual(await equip(shortSwordId, 'off'), 204);
		assert.deepStrictEqual((await sheetOf(brokkId)).equipment, [at('mainHand', shortSwordId), at('offHand', shortSwordId)]);
	});

	it('refuses what can\'t be equipped, isn\'t carried, needs a tail or isn\'t the player\'s', async () =>
	{
		const grace = await logIn('Grace');

		await setUniverseRole(universeId, grace.playerId, 'builder');

		assert.strictEqual(await equip(bookId, null), 409);
		assert.strictEqual(await equip(heavyShieldId, 'both'), 409);
		assert.strictEqual(await equip(tailbladeId, null), 409);
		assert.strictEqual(await equip(-1, null), 400);
		assert.strictEqual(await equip(longswordId, 'left' as 'main'), 400);
		assert.strictEqual(await equip(99999999, 'main'), 409);
		assert.strictEqual((await send(grace, 'POST', `${characterPath(universeId, brokkId)}/items/equip`, { itemId: longswordId, hand: 'main' })).status, 404);
		assert.deepStrictEqual((await sheetOf(brokkId)).equipment, []);
	});

	it('wears a tail blade on a race with a tail', async () =>
	{
		const dwarf = await dwarfFighter(ada.playerId, universeId, 'Squeak');
		const ratfolkRaceId = await defaultRaceId('ratfolk');
		const squeak = await inTransaction((transaction) => createCharacter({ ...dwarf, raceId: ratfolkRaceId, items: [{ itemId: tailbladeId, quantity: 1 }] }, transaction));

		assert.strictEqual((await send(ada, 'POST', `${characterPath(universeId, squeak)}/items/equip`, { itemId: tailbladeId, hand: null })).status, 204);

		const sheet = await sheetOf(squeak);

		assert.strictEqual(sheet.hasTail, true);
		assert.deepStrictEqual(sheet.equipment, [at('tail', tailbladeId)]);
	});

	it('unequips from one slot, or everywhere', async () =>
	{
		const path = `${characterPath(universeId, brokkId)}/items/unequip`;

		await equip(shortSwordId, 'main');
		await equip(shortSwordId, 'off');
		await equip(heavyShieldId, null);

		assert.strictEqual((await send(ada, 'POST', path, { itemId: shortSwordId, slot: 'mainHand' })).status, 204);
		assert.deepStrictEqual((await sheetOf(brokkId)).equipment, [at('offHand', shortSwordId)]);

		await equip(shortSwordId, 'main');
		assert.strictEqual((await send(ada, 'POST', path, { itemId: shortSwordId, slot: null })).status, 204);
		assert.deepStrictEqual((await sheetOf(brokkId)).equipment, []);
		assert.strictEqual((await send(ada, 'POST', path, { itemId: shortSwordId, slot: null })).status, 204);
	});

	it('unequips the off hand first when discarding more than are unequipped', async () =>
	{
		await equip(shortSwordId, 'main');
		await equip(shortSwordId, 'off');

		assert.strictEqual((await send(ada, 'POST', `${characterPath(universeId, brokkId)}/items/discard`, { items: [{ itemId: shortSwordId, quantity: 1 }] })).status, 204);
		assert.deepStrictEqual((await sheetOf(brokkId)).equipment, [at('mainHand', shortSwordId)]);
	});

	it('wears armor and holds a laser rifle in a Starfinder universe', async () =>
	{
		const starfinderId = await makeUniverse(ada, 'sf1e');
		const armorId = await addItem(starfinderId, 'sf1e', 'Second skin', { category: 'armor', types: [], equips: 'armor' });
		const rifleId = await addItem(starfinderId, 'sf1e', 'Azimuth laser rifle', { category: 'weapon', types: [], equips: 'twoHands' });
		const veskId = (await findDefaultRaceIds('sf1e')).get('vesk');
		const soldierId = (await findDefaultClassIds('sf1e')).get('soldier');
		const mercenary = (await loadEditorThemes(liveVersion(starfinderId), 'sf1e')).find((theme) => (theme.key === 'mercenary'));

		assert.ok((veskId !== undefined) && (soldierId !== undefined) && mercenary);

		const brokk = await dwarfFighter(ada.playerId, starfinderId, 'Grenn');
		const grennId = await inTransaction((transaction) => createCharacter({ ...brokk, ruleset: 'sf1e', raceId: veskId, classId: soldierId, themeId: mercenary.id, items: [{ itemId: armorId, quantity: 1 }, { itemId: rifleId, quantity: 1 }] }, transaction));
		const path = `${characterPath(starfinderId, grennId)}/items/equip`;

		assert.strictEqual((await send(ada, 'POST', path, { itemId: armorId, hand: null })).status, 204);
		assert.strictEqual((await send(ada, 'POST', path, { itemId: rifleId, hand: 'both' })).status, 204);
		assert.deepStrictEqual((await sheetOf(grennId, ada, starfinderId)).equipment, [at('armor', armorId), at('mainHand', rifleId, true)]);
	});

	describe('giving items', () =>
	{
		let grace: TestBrowser;
		let graceCharacterId: string;
		let groupId: string;

		beforeEach(async () =>
		{
			grace = await logIn('Grace');
			await setUniverseRole(universeId, grace.playerId, 'builder');
			graceCharacterId = await addCharacter(grace.playerId, universeId, 'Mara');
			groupId = await addGroup(universeId, brokkId, null);
			await inTransaction((transaction) => addGroupMember(groupId, graceCharacterId, transaction));
		});

		it('gives a dagger to another character in the group, telling their player and the group\'s chat', async () =>
		{
			const sdk = new SDKClient(testServerUrl.replace(/^http/, 'ws'), { headers: { cookie: grace.cookie } });
			const room = await sdk.joinOrCreate(SESSION_ROOM_NAME);
			const inbox = new Inbox(room, Object.values(SessionServerMessageType));

			try
			{
				await inbox.take(SessionServerMessageType.Account);

				const daggerId = (await sheetOf(brokkId)).items.find((item) => (item.key === 'dagger'))?.id;

				assert.ok(daggerId !== undefined);
				assert.deepStrictEqual((await sheetOf(brokkId)).group?.members, [
					{
						characterId: graceCharacterId,
						name: 'Mara',
						race: { key: 'dwarf', name: null },
						characterClass: { key: 'fighter', name: null }
					}
				]);

				const answer = await send(ada, 'POST', `${characterPath(universeId, brokkId)}/items/give`, {
					characterId: graceCharacterId,
					items: [{ itemId: daggerId, quantity: 1 }]
				});

				assert.strictEqual(answer.status, 204, JSON.stringify(answer.body));

				const received = await inbox.take<ItemsReceivedPayload>(SessionServerMessageType.ItemsReceived);

				assert.deepStrictEqual(received, {
					universeId,
					ruleset: 'pf1e',
					characterId: graceCharacterId,
					giver: 'Brokk',
					receiver: 'Mara',
					item: { key: 'dagger', name: null },
					quantity: 1
				});
				assert.deepStrictEqual(await inbox.take<CharacterItemsPayload>(SessionServerMessageType.CharacterItems), {
					universeId,
					characterId: graceCharacterId
				});
				assert.strictEqual((await sheetOf(graceCharacterId, grace)).items.find((item) => (item.id === daggerId))?.quantity, 3);
				assert.strictEqual((await sheetOf(brokkId)).items.find((item) => (item.id === daggerId))?.quantity, 1);

				await waitUntil(async () => (await listChatMessages({ kind: 'group', universeId, groupId })).some((message) => (message.notice === 'gave')));

				const notice = (await listChatMessages({ kind: 'group', universeId, groupId })).find((message) => (message.notice === 'gave'));

				assert.strictEqual(notice?.name, 'Brokk');
				assert.deepStrictEqual(notice?.details, {
					receiver: 'Mara',
					item: { key: 'dagger', name: null },
					quantity: 1
				});
			}
			finally
			{
				await room.leave();
			}
		});

		it('unequips what is given, and gives all of an item for more than are carried', async () =>
		{
			await equip(shortSwordId, 'main');
			await equip(shortSwordId, 'off');

			const answer = await send(ada, 'POST', `${characterPath(universeId, brokkId)}/items/give`, {
				characterId: graceCharacterId,
				items: [{ itemId: shortSwordId, quantity: 5 }]
			});

			assert.strictEqual(answer.status, 204);
			assert.deepStrictEqual((await sheetOf(brokkId)).equipment, []);
			assert.strictEqual((await sheetOf(graceCharacterId, grace)).items.find((item) => (item.id === shortSwordId))?.quantity, 2);
			assert.deepStrictEqual((await sheetOf(graceCharacterId, grace)).equipment, []);
		});

		it('refuses giving outside the group, to the giver, or what isn\'t carried', async () =>
		{
			const outsiderId = await addCharacter(grace.playerId, universeId, 'Loner');
			const path = `${characterPath(universeId, brokkId)}/items/give`;

			assert.strictEqual((await send(ada, 'POST', path, { characterId: outsiderId, items: [{ itemId: longswordId, quantity: 1 }] })).status, 409);
			assert.strictEqual((await send(ada, 'POST', path, { characterId: brokkId, items: [{ itemId: longswordId, quantity: 1 }] })).status, 400);
			assert.strictEqual((await send(ada, 'POST', path, { characterId: graceCharacterId, items: [{ itemId: 99999999, quantity: 1 }] })).status, 409);
			assert.strictEqual((await send(grace, 'POST', path, { characterId: graceCharacterId, items: [{ itemId: longswordId, quantity: 1 }] })).status, 404);
			assert.strictEqual((await sheetOf(brokkId)).items.find((item) => (item.id === longswordId))?.quantity, 1);
		});

		it('lets the universe\'s creators equip and give a player\'s character\'s items', async () =>
		{
			const base = `${EDITOR_UNIVERSES_PATH}/${universeId}/characters/${graceCharacterId}/items`;

			await giveCharacterItems(graceCharacterId, [{ itemId: longswordId, quantity: 1 }]);

			assert.strictEqual((await send(ada, 'POST', `${base}/equip`, { itemId: longswordId, hand: 'both' })).status, 204);
			assert.deepStrictEqual((await sheetOf(graceCharacterId, grace)).equipment, [at('mainHand', longswordId, true)]);
			assert.strictEqual((await send(ada, 'POST', `${base}/unequip`, { itemId: longswordId, slot: null })).status, 204);
			assert.strictEqual((await send(ada, 'POST', `${base}/give`, { characterId: brokkId, items: [{ itemId: longswordId, quantity: 1 }] })).status, 204);
			assert.strictEqual((await sheetOf(brokkId)).items.find((item) => (item.id === longswordId))?.quantity, 2);
			assert.strictEqual((await send(grace, 'POST', `${EDITOR_UNIVERSES_PATH}/${universeId}/characters/${brokkId}/items/equip`, { itemId: longswordId, hand: 'main' })).status, 403);
		});
	});
});
