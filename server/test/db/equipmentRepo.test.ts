import assert from 'assert';
import type { EquippedItem } from '@multiverse-kiln/shared';

import { createCharacter, giveCharacterItems, takeCharacterItems } from '../../src/db/characterRepo.js';
import { equipItems, listEquipment, listEquipmentOf, unequipItemsInUniverse, unequipSlots, unequipSlotsOfRaces } from '../../src/db/equipmentRepo.js';
import { findDefaultItemIds } from '../../src/db/itemRepo.js';
import { inTransaction } from '../../src/db/transactions.js';
import { addPlayer } from '../players.js';
import { addCharacter, addUniverse, defaultRaceId, dwarfFighter } from './fixtures.js';

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

/**
 * A default Pathfinder item's ID
 *
 * @param key The item's key
 * @return Its ID
 */
async function defaultItemId(key: string): Promise<number>
{
	const id = (await findDefaultItemIds('pf1e')).get(key);

	if (id === undefined)
	{
		throw new Error(`The default ${key} is missing from the test database`);
	}

	return(id);
}

/**
 * Equipment sorted by slot, to compare without minding the order
 *
 * @param equipment The equipment
 * @return The same items, sorted
 */
function sorted(equipment: readonly EquippedItem[]): EquippedItem[]
{
	return([...equipment].sort((a, b) => a.slot.localeCompare(b.slot)));
}

describe('equipmentRepo', () =>
{
	let playerId: string;
	let universeId: string;
	let characterId: string;
	let daggerId: number;
	let cestusId: number;

	beforeEach(async () =>
	{
		playerId = (await addPlayer('Ada')).id;
		universeId = await addUniverse();
		characterId = await addCharacter(playerId, universeId, 'Brokk');
		daggerId = await defaultItemId('dagger');
		cestusId = await defaultItemId('cestus');
		await giveCharacterItems(characterId, [{ itemId: cestusId, quantity: 1 }]);
	});

	it('equips items, replacing what was in their slots, and unequips them', async () =>
	{
		await equipItems(characterId, [at('mainHand', daggerId), at('offHand', daggerId), at('hands', cestusId)]);
		assert.deepStrictEqual(sorted(await listEquipment(characterId)), [at('hands', cestusId), at('mainHand', daggerId), at('offHand', daggerId)]);

		await equipItems(characterId, [at('mainHand', daggerId, true)]);
		await unequipSlots(characterId, ['offHand', 'hands']);
		assert.deepStrictEqual(await listEquipment(characterId), [at('mainHand', daggerId, true)]);
	});

	it('refuses an item the character doesn\'t carry, and both hands anywhere but the main hand', async () =>
	{
		const swordCaneId = await defaultItemId('sword_cane');

		await assert.rejects(equipItems(characterId, [at('mainHand', swordCaneId)]));
		await assert.rejects(equipItems(characterId, [at('offHand', daggerId, true)]));
	});

	it('unequips the extra ones taken, off hand first, and all of an item taken whole', async () =>
	{
		await equipItems(characterId, [at('mainHand', daggerId), at('offHand', daggerId), at('hands', cestusId)]);

		assert.ok(await inTransaction((transaction) => takeCharacterItems(characterId, 'pf1e', [{ itemId: daggerId, quantity: 1 }], transaction)));
		assert.deepStrictEqual(sorted(await listEquipment(characterId)), [at('hands', cestusId), at('mainHand', daggerId)]);

		assert.ok(await inTransaction((transaction) => takeCharacterItems(characterId, 'pf1e', [{ itemId: cestusId, quantity: 5 }], transaction)));
		assert.deepStrictEqual(await listEquipment(characterId), [at('mainHand', daggerId)]);
	});

	it('lists several characters\' equipment', async () =>
	{
		const otherId = await addCharacter(playerId, universeId, 'Dorn');

		await equipItems(characterId, [at('mainHand', daggerId)]);
		await equipItems(otherId, [at('offHand', daggerId)]);

		const equipment = await listEquipmentOf([characterId, otherId, characterId]);

		assert.deepStrictEqual(equipment.get(characterId), [at('mainHand', daggerId)]);
		assert.deepStrictEqual(equipment.get(otherId), [at('offHand', daggerId)]);
		assert.strictEqual((await listEquipmentOf([])).size, 0);
	});

	it('unequips items from a universe\'s characters only, naming them and their players', async () =>
	{
		const otherUniverseId = await addUniverse('Elsewhere');
		const elsewhereId = await addCharacter(playerId, otherUniverseId, 'Faraway');

		await equipItems(characterId, [at('mainHand', daggerId), at('hands', cestusId)]);
		await equipItems(elsewhereId, [at('mainHand', daggerId)]);

		assert.deepStrictEqual(await unequipItemsInUniverse(universeId, [daggerId]), [{ characterId, playerId }]);
		assert.deepStrictEqual(await listEquipment(characterId), [at('hands', cestusId)]);
		assert.deepStrictEqual(await listEquipment(elsewhereId), [at('mainHand', daggerId)]);
		assert.deepStrictEqual(await unequipItemsInUniverse(universeId, [daggerId]), []);
		assert.deepStrictEqual(await unequipItemsInUniverse(universeId, []), []);
	});

	it('unequips some slots of a race\'s characters', async () =>
	{
		const dwarf = await dwarfFighter(playerId, universeId, 'Dorn');
		const ratfolkRaceId = await defaultRaceId('ratfolk');
		const ratfolk = await inTransaction((transaction) => createCharacter({ ...dwarf, name: 'Squeak', raceId: ratfolkRaceId }, transaction));

		await equipItems(characterId, [at('tail', daggerId), at('mainHand', daggerId)]);
		await equipItems(ratfolk, [at('tail', daggerId)]);

		assert.deepStrictEqual(await unequipSlotsOfRaces(universeId, [ratfolkRaceId], ['tail']), [{ characterId: ratfolk, playerId }]);
		assert.deepStrictEqual(await listEquipment(ratfolk), []);
		assert.strictEqual((await listEquipment(characterId)).length, 2);
	});
});
