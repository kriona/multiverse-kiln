import assert from 'assert';
import { type EditorChange, type EditorItem, type EditorRace, type EquippedItem, type ItemListPayload, type ItemSettings, type RaceListPayload, type RaceSettings } from '@multiverse-kiln/shared';

import { createCharacter, giveCharacterItems } from '../src/db/characterRepo.js';
import { equipItems, listEquipment } from '../src/db/equipmentRepo.js';
import { inTransaction } from '../src/db/transactions.js';
import { setUniverseRole } from '../src/db/universeEditorRepo.js';
import { characterItemChanges, type CharacterItemChange } from '../src/players/characterItemChanges.js';
import { addPlayableUniverse, defaultRaceId, dwarfFighter, type PlayableUniverse } from './db/fixtures.js';
import { logIn, saveAll, send, type Editor } from './editorRequests.js';
import { addPlayer } from './players.js';
import { getTestServer } from './testServer.js';

/**
 * An item's settings as the item editor sends them, with some changed
 *
 * @param item The item, as listed
 * @param changes The settings to change
 * @return The settings
 */
function itemSettings(item: EditorItem, changes: Partial<ItemSettings>): ItemSettings
{
	const { name, description, category, types, equips, enabled } = item;

	return({ name, description, category, types, equips, enabled, ...changes });
}

/**
 * A race's settings as the race editor sends them, with its rules changed
 *
 * @param race The race, as listed
 * @param rules The rules to change
 * @return The settings
 */
function raceSettings(race: EditorRace, rules: Record<string, unknown>): RaceSettings
{
	const { name, description, enabled, keepPlaying, startingMoney, startingItems, startingAreaId, startingColumn, startingRow } = race;

	return({ name, description, enabled, keepPlaying, startingMoney, startingItems, startingAreaId, startingColumn, startingRow, rules: { ...race.rules, ...rules } });
}

describe('Unequipping when the world editor changes how items equip', () =>
{
	let ada: Editor;
	let universe: PlayableUniverse;
	let playerId: string;
	let characterId: string;
	let dagger: EditorItem;
	let tailblade: EditorItem;
	let ratfolkId: number;

	before(async () =>
	{
		await getTestServer();
	});

	beforeEach(async () =>
	{
		ada = await logIn('Ada');
		universe = await addPlayableUniverse();
		await setUniverseRole(universe.universeId, ada.playerId, 'creator');
		playerId = (await addPlayer('Bob')).id;
		ratfolkId = await defaultRaceId('ratfolk');
		dagger = await item('dagger');
		tailblade = await item('ratfolk_tailblade');

		const character = await dwarfFighter(playerId, universe.universeId, 'Squeak');

		characterId = await inTransaction((transaction) => createCharacter({ ...character, raceId: ratfolkId, items: [] }, transaction));
		await giveCharacterItems(characterId, [
			{ itemId: dagger.id, quantity: 2 },
			{ itemId: tailblade.id, quantity: 1 }
		]);
		await equipItems(characterId, [
			at('mainHand', dagger),
			at('offHand', dagger),
			at('tail', tailblade)
		]);
	});

	/**
	 * An item equipped in a slot
	 *
	 * @param slot The slot
	 * @param equipped The item
	 * @return The equipped item
	 */
	function at(slot: string, equipped: EditorItem): EquippedItem
	{
		return({
			slot,
			itemId: equipped.id,
			bothHands: false
		});
	}

	/**
	 * One of the universe's default items, as the Items tab lists it
	 *
	 * @param key The item's key
	 * @param version Which version to list it from
	 * @return The item
	 */
	async function item(key: string, version: 'live' | 'draft' = 'live'): Promise<EditorItem>
	{
		const items = (await send<ItemListPayload>(ada, 'GET', `/${universe.universeId}/items?custom=false${((version === 'draft') ? '&version=draft' : '')}`)).body.items;
		const found = items.find((each) => (each.key === key));

		assert.ok(found);

		return(found);
	}

	/**
	 * The ratfolk race, as the Characters tab lists it
	 *
	 * @param version Which version to list it from
	 * @return The race
	 */
	async function ratfolk(version: 'live' | 'draft' = 'live'): Promise<EditorRace>
	{
		const races = (await send<RaceListPayload>(ada, 'GET', `/${universe.universeId}/races${((version === 'draft') ? '?version=draft' : '')}`)).body.races;
		const found = races.find((race) => (race.id === ratfolkId));

		assert.ok(found);

		return(found);
	}

	/**
	 * The slots the character has something equipped in
	 *
	 * @return The slots, sorted
	 */
	async function equippedSlots(): Promise<string[]>
	{
		return((await listEquipment(characterId))
			.map((equipped) => equipped.slot)
			.sort());
	}

	/**
	 * Saves changes to the draft
	 *
	 * @param changes The changes
	 */
	async function saveToDraft(changes: EditorChange[]): Promise<void>
	{
		const answer = await send(ada, 'POST', `/${universe.universeId}/changes?version=draft`, { body: { changes } });

		assert.strictEqual(answer.status, 200, JSON.stringify(answer.body));
	}

	it('unequips an item whose place to equip a save changes, telling its player, and nothing else', async () =>
	{
		const published: CharacterItemChange[] = [];
		const stop = characterItemChanges.onChange((change) =>
		{
			published.push(change);
		});

		try
		{
			// Renaming it doesn't move it
			await saveAll(ada, universe.universeId, [{ kind: 'saveItem', id: dagger.id, settings: itemSettings(dagger, { name: 'shiv' }) }]);
			assert.deepStrictEqual(await equippedSlots(), ['mainHand', 'offHand', 'tail']);
			assert.deepStrictEqual(published, []);

			await saveAll(ada, universe.universeId, [{ kind: 'saveItem', id: dagger.id, settings: itemSettings(dagger, { equips: 'twoHands' }) }]);
			assert.deepStrictEqual(await equippedSlots(), ['tail']);
			assert.deepStrictEqual(published, [{ kind: 'changed', playerId, universeId: universe.universeId, characterId }]);
		}
		finally
		{
			stop();
		}
	});

	it('unequips an item a save makes a shield, and an edited item restored to the default', async () =>
	{
		await saveAll(ada, universe.universeId, [{ kind: 'saveItem', id: tailblade.id, settings: itemSettings(tailblade, { category: 'armor', types: ['shields'] }) }]);
		assert.deepStrictEqual(await equippedSlots(), ['mainHand', 'offHand']);

		// Changed and changed back in one save, the dagger equips as it did
		await saveAll(ada, universe.universeId, [
			{ kind: 'saveItem', id: dagger.id, settings: itemSettings(dagger, { equips: 'head' }) },
			{ kind: 'saveItem', id: dagger.id, settings: itemSettings(dagger, {}) }
		]);
		assert.deepStrictEqual(await equippedSlots(), ['mainHand', 'offHand']);

		// Restoring the default dagger, held in one hand, unequips the edited one held in two
		await saveAll(ada, universe.universeId, [{ kind: 'saveItem', id: dagger.id, settings: itemSettings(dagger, { equips: 'twoHands' }) }]);
		await equipItems(characterId, [{ ...at('mainHand', dagger), bothHands: true }]);
		assert.deepStrictEqual(await equippedSlots(), ['mainHand']);
		await saveAll(ada, universe.universeId, [{ kind: 'removeItem', id: dagger.id }]);
		assert.deepStrictEqual(await equippedSlots(), []);
	});

	it('unequips an item a save changes from a weapon to another kind, which no longer goes in both hands', async () =>
	{
		await equipItems(characterId, [{ ...at('mainHand', dagger), bothHands: true }]);
		await saveAll(ada, universe.universeId, [{ kind: 'saveItem', id: dagger.id, settings: itemSettings(dagger, { category: 'gear', types: [] }) }]);
		assert.deepStrictEqual(await equippedSlots(), ['tail']);
	});

	it('unequips an item taken from characters while disabled', async () =>
	{
		await saveAll(ada, universe.universeId, [{ kind: 'saveItem', id: dagger.id, settings: itemSettings(dagger, { enabled: false }), whenDisabled: 'remove' }]);
		assert.deepStrictEqual(await equippedSlots(), ['tail']);

		// It comes back unequipped
		await saveAll(ada, universe.universeId, [{ kind: 'saveItem', id: dagger.id, settings: itemSettings(dagger, { enabled: true }) }]);
		assert.deepStrictEqual(await equippedSlots(), ['tail']);
	});

	it('unequips the tail slot of a race whose tail a save takes away', async () =>
	{
		await saveAll(ada, universe.universeId, [{ kind: 'saveRace', id: ratfolkId, settings: raceSettings(await ratfolk(), { size: 'medium' }) }]);
		assert.deepStrictEqual(await equippedSlots(), ['mainHand', 'offHand', 'tail']);

		await saveAll(ada, universe.universeId, [{ kind: 'saveRace', id: ratfolkId, settings: raceSettings(await ratfolk(), { hasTail: false }) }]);
		assert.deepStrictEqual(await equippedSlots(), ['mainHand', 'offHand']);
		assert.strictEqual(((await ratfolk()).rules as { hasTail: boolean }).hasTail, false);

		// Restoring the default race gives it its tail back
		await saveAll(ada, universe.universeId, [{ kind: 'removeRace', id: ratfolkId }]);
		assert.strictEqual(((await ratfolk()).rules as { hasTail: boolean }).hasTail, true);
	});

	it('unequips nothing for changes saved to the draft until it is applied', async () =>
	{
		await saveAll(ada, universe.universeId, [{ kind: 'startDraft' }]);
		await saveToDraft([
			{ kind: 'saveItem', id: dagger.id, settings: itemSettings(await item('dagger', 'draft'), { equips: 'oneHand', types: ['blades_light'] }) },
			{ kind: 'saveRace', id: ratfolkId, settings: raceSettings(await ratfolk('draft'), { hasTail: false }) }
		]);
		assert.deepStrictEqual(await equippedSlots(), ['mainHand', 'offHand', 'tail']);

		// Changing only the dagger's types leaves it where it equips, and not a shield
		await saveAll(ada, universe.universeId, [{ kind: 'applyDraft', choices: { races: {}, classes: {}, items: {}, areas: {} } }]);
		assert.deepStrictEqual(await equippedSlots(), ['mainHand', 'offHand']);
	});

	it('unequips an item that equips somewhere else once a draft is applied', async () =>
	{
		await saveAll(ada, universe.universeId, [{ kind: 'startDraft' }]);
		await saveToDraft([{ kind: 'saveItem', id: dagger.id, settings: itemSettings(await item('dagger', 'draft'), { equips: 'twoHands' }) }]);
		await saveAll(ada, universe.universeId, [{ kind: 'applyDraft', choices: { races: {}, classes: {}, items: {}, areas: {} } }]);
		assert.deepStrictEqual(await equippedSlots(), ['tail']);
	});
});
