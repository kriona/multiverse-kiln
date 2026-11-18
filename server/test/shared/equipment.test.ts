import assert from 'assert';
import { characterSlots, DEFAULT_ITEM_EQUIPS, DEFAULT_ITEM_NAMES, equipChangesNothing, equipmentSlots, fitsSlot, handChoices, isItemEquips, isShield, itemEquipsChoices, itemEquipsName, planEquip, ringChoices, slotName, startingEquipment, unequippedByRemoval, type EquipmentItem, type EquippedItem, type EquipPlan, type Ruleset } from '@multiverse-kiln/shared';

const dagger: EquipmentItem = {
	id: 1,
	category: 'weapon',
	types: ['blades_light', 'thrown'],
	equips: 'oneHand'
};
const longsword: EquipmentItem = {
	id: 2,
	category: 'weapon',
	types: ['blades_heavy'],
	equips: 'oneHand'
};
const greatsword: EquipmentItem = {
	id: 3,
	category: 'weapon',
	types: ['blades_heavy'],
	equips: 'twoHands'
};
const heavyShield: EquipmentItem = {
	id: 4,
	category: 'armor',
	types: ['shields'],
	equips: 'oneHand'
};
const buckler: EquipmentItem = {
	id: 5,
	category: 'armor',
	types: ['shields'],
	equips: 'offArm'
};
const torch: EquipmentItem = {
	id: 6,
	category: 'gear',
	types: ['light_source'],
	equips: 'oneHand'
};
const ring: EquipmentItem = {
	id: 7,
	category: 'gear',
	types: [],
	equips: 'ring'
};
const tailblade: EquipmentItem = {
	id: 8,
	category: 'weapon',
	types: ['blades_light'],
	equips: 'tail'
};
const book: EquipmentItem = {
	id: 9,
	category: 'gear',
	types: [],
	equips: 'none'
};
const chainShirt: EquipmentItem = {
	id: 10,
	category: 'armor',
	types: ['light_armor'],
	equips: 'armor'
};
const lightShield: EquipmentItem = {
	id: 11,
	category: 'armor',
	types: ['shields'],
	equips: 'oneHand'
};
const silverRing: EquipmentItem = {
	id: 12,
	category: 'gear',
	types: [],
	equips: 'ring'
};
const items = new Map([dagger, longsword, greatsword, heavyShield, buckler, torch, ring, tailblade, book, chainShirt, lightShield, silverRing].map((item) => [item.id, item]));

/**
 * An item equipped in a slot
 *
 * @param slot The slot
 * @param item The item
 * @param bothHands Whether it is held in both hands
 * @return The equipped item
 */
function at(slot: string, item: EquipmentItem, bothHands = false): EquippedItem
{
	return({
		slot,
		itemId: item.id,
		bothHands
	});
}

/**
 * Plans equipping a Pathfinder item, failing the test when it is refused
 *
 * @param equipment What is equipped
 * @param item The item
 * @param quantity How many the character carries
 * @param hand The hands asked for
 * @param ruleset The ruleset
 * @param ring The ring slot asked for
 * @return The plan
 */
function plan(equipment: readonly EquippedItem[], item: EquipmentItem, quantity: number, hand: 'main' | 'off' | 'both' | null, ruleset: Ruleset = 'pf1e', ring: 'left' | 'right' | null = null): EquipPlan
{
	const result = planEquip(ruleset, equipment, items, item, quantity, hand, true, ring);

	if (typeof result === 'string')
	{
		assert.fail(`Equipping item ${item.id} was refused: ${result}`);
	}

	return(result);
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

describe('equipment', () =>
{
	it('lists each ruleset\'s slots, worn ones then the hands', () =>
	{
		assert.deepStrictEqual(equipmentSlots('pf1e'), ['head', 'headband', 'eyes', 'shoulders', 'neck', 'chest', 'body', 'armor', 'belt', 'wrists', 'hands', 'ringLeft', 'ringRight', 'feet', 'tail', 'offArm', 'mainHand', 'offHand']);
		assert.deepStrictEqual(equipmentSlots('sf1e'), ['armor', 'clothing', 'mainHand', 'offHand']);
	});

	it('gives only characters with a tail the tail slot', () =>
	{
		assert.ok(characterSlots('pf1e', true).includes('tail'));
		assert.ok(!characterSlots('pf1e', false).includes('tail'));
		assert.deepStrictEqual(characterSlots('sf1e', false), equipmentSlots('sf1e'));
	});

	it('names every slot and every place an item equips', () =>
	{
		for (const ruleset of ['pf1e', 'sf1e'] as const)
		{
			for (const slot of equipmentSlots(ruleset))
			{
				assert.ok(slotName(ruleset, slot), `${ruleset} slot ${slot} has no name`);
			}

			for (const equips of itemEquipsChoices(ruleset))
			{
				assert.ok(itemEquipsName(ruleset, equips), `${ruleset} ${equips} has no name`);
			}
		}

		assert.strictEqual(slotName('sf1e', 'tail'), undefined);
		assert.strictEqual(itemEquipsName('pf1e', 'toString'), undefined);
	});

	it('knows where items of each ruleset can equip', () =>
	{
		assert.ok(isItemEquips('pf1e', 'ring'));
		assert.ok(isItemEquips('pf1e', 'twoHands'));
		assert.ok(isItemEquips('sf1e', 'clothing'));
		assert.ok(!isItemEquips('sf1e', 'ring'));
		assert.ok(!isItemEquips('pf1e', 'ringLeft'));
		assert.ok(!isItemEquips('pf1e', 'constructor'));
	});

	it('gives every default item somewhere the ruleset has to equip', () =>
	{
		for (const ruleset of ['pf1e', 'sf1e'] as const)
		{
			assert.deepStrictEqual(Object.keys(DEFAULT_ITEM_EQUIPS[ruleset]).sort(), Object.keys(DEFAULT_ITEM_NAMES[ruleset]).sort(), `${ruleset} items without where they equip`);

			for (const [key, equips] of Object.entries(DEFAULT_ITEM_EQUIPS[ruleset]))
			{
				assert.ok(isItemEquips(ruleset, equips), `${ruleset} ${key} equips to ${equips}`);
			}
		}
	});

	it('fits items in their slots', () =>
	{
		assert.ok(fitsSlot('pf1e', 'ring', 'ringLeft'));
		assert.ok(fitsSlot('pf1e', 'ring', 'ringRight'));
		assert.ok(!fitsSlot('pf1e', 'ring', 'neck'));
		assert.ok(fitsSlot('pf1e', 'oneHand', 'offHand'));
		assert.ok(fitsSlot('pf1e', 'twoHands', 'mainHand'));
		assert.ok(!fitsSlot('pf1e', 'twoHands', 'offHand'));
		assert.ok(!fitsSlot('pf1e', 'none', 'mainHand'));
		assert.ok(!fitsSlot('sf1e', 'tail', 'tail'));
	});

	it('knows shields by their types', () =>
	{
		assert.ok(isShield('pf1e', ['shields']));
		assert.ok(!isShield('pf1e', ['light_armor']));
		assert.ok(!isShield('sf1e', ['shields']));
	});

	it('offers both hands only for weapons held in one hand', () =>
	{
		assert.deepStrictEqual(handChoices(longsword), ['main', 'off', 'both']);
		assert.deepStrictEqual(handChoices(torch), ['main', 'off']);
		assert.deepStrictEqual(handChoices(heavyShield), ['main', 'off']);
		assert.deepStrictEqual(handChoices(greatsword), ['both']);
		assert.deepStrictEqual(handChoices(ring), []);
	});

	it('refuses what can\'t be equipped as asked', () =>
	{
		assert.strictEqual(planEquip('pf1e', [], items, book, 1, null, true), 'notEquippable');
		assert.strictEqual(planEquip('pf1e', [], items, torch, 1, 'both', true), 'notEquippable');
		assert.strictEqual(planEquip('pf1e', [], items, torch, 1, null, true), 'notEquippable');
		assert.strictEqual(planEquip('pf1e', [], items, greatsword, 1, 'off', true), 'notEquippable');
		assert.strictEqual(planEquip('pf1e', [], items, chainShirt, 1, 'main', true), 'notEquippable');
		assert.strictEqual(planEquip('pf1e', [], items, tailblade, 1, null, false), 'noTail');
		assert.strictEqual(planEquip('sf1e', [], items, ring, 1, null, true), 'notEquippable');
		assert.strictEqual(planEquip('pf1e', [], items, dagger, 1, 'main', true, 'left'), 'notEquippable');
		assert.strictEqual(planEquip('pf1e', [], items, chainShirt, 1, null, true, 'right'), 'notEquippable');
		assert.strictEqual(planEquip('sf1e', [], items, chainShirt, 1, null, true, 'left'), 'notEquippable');
	});

	it('equips a longsword and a shield, then a greatsword unequips both', () =>
	{
		const withSword = plan([], longsword, 1, 'main');
		const withShield = plan(withSword.equipment, heavyShield, 1, 'off');

		assert.deepStrictEqual(sorted(withShield.equipment), [at('mainHand', longsword), at('offHand', heavyShield)]);

		const withGreatsword = plan(withShield.equipment, greatsword, 1, null);

		assert.deepStrictEqual(withGreatsword.equipment, [at('mainHand', greatsword, true)]);
		assert.deepStrictEqual(sorted(withGreatsword.removed), [at('mainHand', longsword), at('offHand', heavyShield)]);
	});

	it('holds a weapon in each hand, and a one-handed weapon in both', () =>
	{
		const first = plan([], dagger, 2, 'main');
		const second = plan(first.equipment, dagger, 2, 'off');

		assert.deepStrictEqual(sorted(second.equipment), [at('mainHand', dagger), at('offHand', dagger)]);

		const both = plan(second.equipment, longsword, 1, 'both');

		assert.deepStrictEqual(both.equipment, [at('mainHand', longsword, true)]);
	});

	it('unequips an item held in both hands for one in either', () =>
	{
		const both = plan([], longsword, 1, 'both');
		const torchInOffHand = plan(both.equipment, torch, 1, 'off');

		assert.deepStrictEqual(torchInOffHand.equipment, [at('offHand', torch)]);
		assert.deepStrictEqual(torchInOffHand.removed, [at('mainHand', longsword, true)]);
	});

	it('moves an item when every one carried is equipped', () =>
	{
		const moved = plan([at('mainHand', dagger)], dagger, 1, 'off');

		assert.deepStrictEqual(moved.equipment, [at('offHand', dagger)]);
		assert.deepStrictEqual(moved.removed, [at('mainHand', dagger)]);
	});

	it('changes nothing for an item already equipped as asked', () =>
	{
		const again = plan([at('mainHand', dagger), at('armor', chainShirt)], dagger, 1, 'main');

		assert.strictEqual(again.added, null);
		assert.deepStrictEqual(again.removed, []);
		assert.strictEqual(plan([at('ringRight', ring)], ring, 1, null).added, null);
	});

	it('changes nothing for an item already where it would go, with more carried', () =>
	{
		const equipment = [at('mainHand', dagger), at('ringLeft', ring), at('ringRight', ring), at('offArm', buckler)];

		for (const [item, quantity, hand, choice] of [[dagger, 2, 'main', null], [ring, 3, null, null], [ring, 3, null, 'left'], [ring, 3, null, 'right'], [buckler, 2, null, null]] as const)
		{
			const again = plan(equipment, item, quantity, hand, 'pf1e', choice);

			assert.strictEqual(again.added, null, `item ${item.id} ${choice}`);
			assert.deepStrictEqual(again.removed, [], `item ${item.id} ${choice}`);
			assert.strictEqual(equipChangesNothing('pf1e', equipment, item, quantity, hand, true, choice), true, `item ${item.id} ${choice}`);
		}

		assert.deepStrictEqual(plan(equipment, dagger, 2, 'both').removed, [at('mainHand', dagger)]);
		assert.strictEqual(equipChangesNothing('pf1e', equipment, dagger, 2, 'both', true, null), false);
		assert.strictEqual(equipChangesNothing('pf1e', equipment, dagger, 2, 'off', true, null), false);
		assert.strictEqual(equipChangesNothing('pf1e', [], tailblade, 1, null, false, null), false);
	});

	it('puts a ring in the first free ring slot', () =>
	{
		const first = plan([], ring, 3, null);
		const second = plan(first.equipment, ring, 3, null);

		assert.deepStrictEqual(first.added, at('ringLeft', ring));
		assert.deepStrictEqual(second.added, at('ringRight', ring));
		assert.deepStrictEqual(ringChoices('pf1e', [], ring), []);
		assert.deepStrictEqual(ringChoices('pf1e', first.equipment, ring), []);
		assert.strictEqual(equipChangesNothing('pf1e', first.equipment, ring, 1, null, true, null), true);
	});

	it('puts a ring in the ring slot chosen when both are full', () =>
	{
		const full = [at('ringLeft', silverRing), at('ringRight', ring)];
		const others = [at('ringLeft', silverRing), at('ringRight', silverRing)];
		const left = plan(full, ring, 2, null, 'pf1e', 'left');
		const moved = plan(full, ring, 1, null, 'pf1e', 'left');

		assert.deepStrictEqual(ringChoices('pf1e', full, ring), ['left', 'right']);
		assert.deepStrictEqual(ringChoices('pf1e', full, dagger), []);
		assert.strictEqual(planEquip('pf1e', others, items, ring, 1, null, true), 'ringSlotsFull');
		assert.strictEqual(equipChangesNothing('pf1e', others, ring, 1, null, true, null), false);
		assert.strictEqual(plan(full, ring, 2, null).added, null);
		assert.deepStrictEqual(left.added, at('ringLeft', ring));
		assert.deepStrictEqual(left.removed, [at('ringLeft', silverRing)]);
		assert.deepStrictEqual(moved.equipment, [at('ringLeft', ring)]);
		assert.strictEqual(plan(full, ring, 2, null, 'pf1e', 'right').added, null);
	});

	it('lets a character hold one shield, a buckler included', () =>
	{
		const two = plan([at('offHand', heavyShield)], lightShield, 1, 'main');

		assert.deepStrictEqual(two.equipment, [at('mainHand', lightShield)]);

		const strapped = plan([at('offHand', heavyShield), at('mainHand', longsword)], buckler, 1, null);

		assert.deepStrictEqual(sorted(strapped.equipment), [at('mainHand', longsword), at('offArm', buckler)]);

		const held = plan(strapped.equipment, heavyShield, 1, 'off');

		assert.deepStrictEqual(sorted(held.equipment), [at('mainHand', longsword), at('offHand', heavyShield)]);
	});

	it('wears a buckler with a two-handed weapon', () =>
	{
		const withBuckler = plan([at('mainHand', greatsword, true)], buckler, 1, null);

		assert.deepStrictEqual(sorted(withBuckler.equipment), [at('mainHand', greatsword, true), at('offArm', buckler)]);
	});

	it('unequips the off hand first, then the main hand, then worn slots, when some are taken', () =>
	{
		const equipment = [at('ringLeft', ring), at('mainHand', dagger), at('offHand', dagger), at('ringRight', ring)];

		assert.deepStrictEqual(unequippedByRemoval('pf1e', equipment, dagger.id, 2), []);
		assert.deepStrictEqual(unequippedByRemoval('pf1e', equipment, dagger.id, 1), [at('offHand', dagger)]);
		assert.deepStrictEqual(unequippedByRemoval('pf1e', equipment, dagger.id, 0), [at('offHand', dagger), at('mainHand', dagger)]);
		assert.deepStrictEqual(unequippedByRemoval('pf1e', equipment, ring.id, 1), [at('ringLeft', ring)]);
	});

	it('equips a new character\'s worn items, first weapon and a shield', () =>
	{
		const equipment = startingEquipment('pf1e', [
			{ item: chainShirt, quantity: 1 },
			{ item: heavyShield, quantity: 1 },
			{ item: dagger, quantity: 2 },
			{ item: longsword, quantity: 1 },
			{ item: torch, quantity: 1 },
			{ item: ring, quantity: 3 },
			{ item: tailblade, quantity: 1 }
		], false);

		assert.deepStrictEqual(sorted(equipment), sorted([at('armor', chainShirt), at('ringLeft', ring), at('ringRight', ring), at('mainHand', dagger), at('offHand', heavyShield)]));
	});

	it('leaves the off hand to a two-handed first weapon, and a buckler on the arm', () =>
	{
		const equipment = startingEquipment('pf1e', [
			{ item: greatsword, quantity: 1 },
			{ item: heavyShield, quantity: 1 },
			{ item: buckler, quantity: 1 },
			{ item: tailblade, quantity: 1 }
		], true);

		assert.deepStrictEqual(sorted(equipment), sorted([at('offArm', buckler), at('tail', tailblade), at('mainHand', greatsword, true)]));
	});
});
