import assert from 'assert';

import { findStoredLooks, listCharacterIdsOf, listHiddenSlots, saveAvatarHash, setCharacterAppearance, setSlotHidden } from '../../src/db/avatarRepo.js';
import { giveCharacterItems, setCarriedItemsHidden, takeCharacterItems } from '../../src/db/characterRepo.js';
import { equipItems, listEquipment, listLayeredEquipmentOf, listSocialEquipment, unequipItemsInUniverse, wearSocially } from '../../src/db/equipmentRepo.js';
import { findDefaultItemIds } from '../../src/db/itemRepo.js';
import { inTransaction } from '../../src/db/transactions.js';
import { addPlayer } from '../players.js';
import { addCharacter, addUniverse } from './fixtures.js';

describe('avatarRepo', () =>
{
	let playerId: string;
	let universeId: string;
	let characterId: string;

	beforeEach(async () =>
	{
		playerId = (await addPlayer('Ada')).id;
		universeId = await addUniverse();
		characterId = await addCharacter(playerId, universeId, 'Brokk');
	});

	it('gives new characters the look characters had before avatars, and changes it', async () =>
	{
		const look = (await findStoredLooks([characterId])).get(characterId);

		assert.deepStrictEqual({
			bodyType: look?.bodyType,
			artType: look?.artType,
			background: look?.background,
			avatarHash: look?.avatarHash,
			ruleset: look?.ruleset,
			universeId: look?.universeId
		}, {
			bodyType: 'mascThick',
			artType: 'stickFigure',
			background: 'darkGreen',
			avatarHash: null,
			ruleset: 'pf1e',
			universeId
		});

		assert.strictEqual(await setCharacterAppearance(characterId, { artType: 'lucia', background: 'darkRed' }), true);
		await saveAvatarHash(characterId, '0123456789abcdef');

		const changed = (await findStoredLooks([characterId])).get(characterId);

		assert.strictEqual(changed?.bodyType, 'mascThick');
		assert.strictEqual(changed?.artType, 'lucia');
		assert.strictEqual(changed?.background, 'darkRed');
		assert.strictEqual(changed?.avatarHash, '0123456789abcdef');
		assert.strictEqual(await setCharacterAppearance('00000000-0000-4000-8000-000000000000', { artType: 'lucia' }), false);
	});

	it('hides slots and shows them again, saying whether anything changed', async () =>
	{
		assert.strictEqual(await setSlotHidden(characterId, 'shoulders', true), true);
		assert.strictEqual(await setSlotHidden(characterId, 'shoulders', true), false);
		assert.strictEqual(await setSlotHidden(characterId, 'armor', true), true);
		assert.deepStrictEqual(await listHiddenSlots(characterId), ['armor', 'shoulders']);
		assert.deepStrictEqual((await findStoredLooks([characterId])).get(characterId)?.hiddenSlots, ['armor', 'shoulders']);
		assert.strictEqual(await setSlotHidden(characterId, 'armor', false), true);
		assert.strictEqual(await setSlotHidden(characterId, 'armor', false), false);
		assert.deepStrictEqual(await listHiddenSlots(characterId), ['shoulders']);
	});

	it('lists the characters of a universe and of a player', async () =>
	{
		const otherUniverseId = await addUniverse();
		const otherId = await addCharacter(playerId, otherUniverseId, 'Mara');

		assert.deepStrictEqual(await listCharacterIdsOf({ universeId }), [characterId]);
		assert.deepStrictEqual((await listCharacterIdsOf({ playerId })).sort(), [characterId, otherId].sort());
	});
});

describe('equipmentRepo social layer', () =>
{
	let universeId: string;
	let characterId: string;
	let leatherArmorId: number;
	let studdedLeatherId: number;

	beforeEach(async () =>
	{
		const playerId = (await addPlayer('Ada')).id;
		const defaults = await findDefaultItemIds('pf1e');

		universeId = await addUniverse();
		characterId = await addCharacter(playerId, universeId, 'Brokk');
		leatherArmorId = defaults.get('leather_armor') ?? 0;
		studdedLeatherId = defaults.get('studded_leather') ?? 0;
		await giveCharacterItems(characterId, [
			{ itemId: leatherArmorId, quantity: 2 },
			{ itemId: studdedLeatherId, quantity: 1 }
		]);
	});

	it('keeps social items apart from equipped ones', async () =>
	{
		await equipItems(characterId, [{ slot: 'armor', itemId: studdedLeatherId, bothHands: false }]);
		assert.strictEqual(await wearSocially(characterId, 'armor', leatherArmorId), true);
		assert.strictEqual(await wearSocially(characterId, 'armor', leatherArmorId), false);

		assert.deepStrictEqual(await listEquipment(characterId), [{ slot: 'armor', itemId: studdedLeatherId, bothHands: false }]);
		assert.deepStrictEqual(await listSocialEquipment(characterId), [{ slot: 'armor', itemId: leatherArmorId, bothHands: false }]);
		assert.deepStrictEqual((await listLayeredEquipmentOf([characterId])).get(characterId), [
			{ layer: 'social', slot: 'armor', itemId: leatherArmorId, bothHands: false },
			{ layer: 'stats', slot: 'armor', itemId: studdedLeatherId, bothHands: false }
		]);

		assert.strictEqual(await wearSocially(characterId, 'armor', null), true);
		assert.strictEqual(await wearSocially(characterId, 'armor', null), false);
		assert.deepStrictEqual(await listSocialEquipment(characterId), []);
		assert.strictEqual((await listEquipment(characterId)).length, 1);
	});

	it('keeps a social item until the last of it goes', async () =>
	{
		await wearSocially(characterId, 'armor', leatherArmorId);
		await inTransaction((transaction) => takeCharacterItems(characterId, 'pf1e', [{ itemId: leatherArmorId, quantity: 1 }], transaction));
		assert.strictEqual((await listSocialEquipment(characterId)).length, 1);
		await inTransaction((transaction) => takeCharacterItems(characterId, 'pf1e', [{ itemId: leatherArmorId, quantity: 1 }], transaction));
		assert.deepStrictEqual(await listSocialEquipment(characterId), []);
	});

	it('takes items out of both layers when a universe unequips them, as removing a disabled item does', async () =>
	{
		await equipItems(characterId, [{ slot: 'armor', itemId: leatherArmorId, bothHands: false }]);
		await wearSocially(characterId, 'armor', leatherArmorId);
		await setCarriedItemsHidden(universeId, [leatherArmorId], true);

		const owners = await unequipItemsInUniverse(universeId, [leatherArmorId]);

		assert.deepStrictEqual(owners.map((owner) => owner.characterId), [characterId]);
		assert.deepStrictEqual(await listEquipment(characterId), []);
		assert.deepStrictEqual(await listSocialEquipment(characterId), []);
	});
});
