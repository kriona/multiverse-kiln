/**
 * Equipment: each ruleset's slots, where items equip, and the rules for equipping them (see Equipment in
 * STRUCTURE-OVERVIEW.md). These are pure functions the server enforces and the character sheet uses to
 * offer choices and say what a change unequips
 *
 * An item equips nowhere, in one hand, in two hands or in one of the ruleset's worn places (most a slot
 * of their own; PF1E's ring is either of two ring slots). Whether an item fits a slot is fitsSlot(), which
 * the social slots reuse (fitsSocialSlot()); the rules for hands and shields are only for the stats slots
 *
 * A character's slots come in two layers: the stats slots, whose items count as equipped and which rules
 * read, and the social slots, for items worn only for how they look on the avatar (see Social slots in
 * STRUCTURE-OVERVIEW.md)
 */
import { defineMessages, type MessageDescriptor } from './localization.js';
import { PF1E_DEFAULT_ITEM_EQUIPS, PF1E_NON_SOCIAL_LOCATIONS, PF1E_RING_LOCATION, PF1E_RING_SLOT_NAMES, PF1E_SHIELD_TYPES, PF1E_SLOT_DRAW_ORDER, PF1E_TAIL_LOCATION, PF1E_WORN_LOCATION_NAMES, PF1E_WORN_LOCATIONS, PF1E_WORN_SLOTS } from './rulesets/pf1e/equipment.js';
import { SF1E_DEFAULT_ITEM_EQUIPS, SF1E_SLOT_DRAW_ORDER, SF1E_WORN_LOCATION_NAMES, SF1E_WORN_LOCATIONS, SF1E_WORN_SLOTS } from './rulesets/sf1e/equipment.js';
import type { Ruleset } from './universes.js';

/**
 * The layers of a character's slots: stats, whose items count as equipped, and social, whose items are
 * only worn for how they look
 */
export const EQUIPMENT_LAYERS = ['stats', 'social'] as const;

export type EquipmentLayer = typeof EQUIPMENT_LAYERS[number];

/**
 * The hand slots, which every ruleset has after its worn slots
 */
export const HAND_SLOTS = ['mainHand', 'offHand'] as const;

export type HandSlot = typeof HAND_SLOTS[number];

/**
 * Where an item equips that isn't a worn place: nowhere, either hand, or both hands
 */
export const HELD_EQUIPS = ['none', 'oneHand', 'twoHands'] as const;

export type HeldEquips = typeof HELD_EQUIPS[number];

/**
 * Which hands an item is equipped in: the main hand, the off hand, or both. Only a weapon held in one
 * hand can be held in both; an item held in two hands is always in both
 */
export const EQUIP_HANDS = ['main', 'off', 'both'] as const;

export type EquipHand = typeof EQUIP_HANDS[number];

/**
 * Which ring slot a ring is equipped in when both are full: the first of the ruleset's ring slots (the
 * left ring) or the second (the right ring)
 */
export const EQUIP_RINGS = ['left', 'right'] as const;

export type EquipRing = typeof EQUIP_RINGS[number];

/**
 * A ruleset's equipment
 */
export interface RulesetEquipment
{
	/**
	 * The places items are worn, in the order the character sheet lists them
	 */
	wornLocations: readonly string[];

	/**
	 * The slots each worn place has, by the place's key
	 */
	wornSlots: Readonly<Record<string, readonly string[]>>;

	/**
	 * Each worn place's name
	 */
	locationNames: Readonly<Record<string, MessageDescriptor>>;

	/**
	 * The names of slots that aren't a worn place of their own, such as PF1E's two ring slots
	 */
	extraSlotNames: Readonly<Record<string, MessageDescriptor>>;

	/**
	 * The worn place only characters whose race has a tail have, or null for a ruleset without one
	 */
	tailLocation: string | null;

	/**
	 * The worn place whose two slots are the left and right ring (EQUIP_RINGS), or null for a ruleset
	 * without one
	 */
	ringLocation: string | null;

	/**
	 * The item types that make an item a shield; empty for a ruleset without shields
	 */
	shieldTypes: readonly string[];

	/**
	 * The order an avatar draws the slots' items in over the base, from the first drawn to the last
	 */
	drawOrder: readonly string[];

	/**
	 * The worn places that have no social slot, such as PF1E's tail and off arm
	 */
	nonSocialLocations: readonly string[];
}

/**
 * Each ruleset's equipment
 */
export const RULESET_EQUIPMENT: Record<Ruleset, RulesetEquipment> = {
	pf1e: {
		wornLocations: PF1E_WORN_LOCATIONS,
		wornSlots: PF1E_WORN_SLOTS,
		locationNames: PF1E_WORN_LOCATION_NAMES,
		extraSlotNames: PF1E_RING_SLOT_NAMES,
		tailLocation: PF1E_TAIL_LOCATION,
		ringLocation: PF1E_RING_LOCATION,
		shieldTypes: PF1E_SHIELD_TYPES,
		drawOrder: PF1E_SLOT_DRAW_ORDER,
		nonSocialLocations: PF1E_NON_SOCIAL_LOCATIONS
	},
	sf1e: {
		wornLocations: SF1E_WORN_LOCATIONS,
		wornSlots: SF1E_WORN_SLOTS,
		locationNames: SF1E_WORN_LOCATION_NAMES,
		extraSlotNames: {},
		tailLocation: null,
		ringLocation: null,
		shieldTypes: [],
		drawOrder: SF1E_SLOT_DRAW_ORDER,
		nonSocialLocations: []
	}
};

/**
 * Where each default item equips, by ruleset and the item's key
 */
export const DEFAULT_ITEM_EQUIPS: Record<Ruleset, Record<string, string>> = {
	pf1e: PF1E_DEFAULT_ITEM_EQUIPS,
	sf1e: SF1E_DEFAULT_ITEM_EQUIPS
};

/**
 * The names of the hand slots and the places items equip that aren't worn, which every ruleset shares
 */
export const HELD_EQUIPMENT_NAMES = defineMessages({
	mainHand: {
		id: 'equipment.slot.mainHand',
		defaultMessage: 'Main hand',
		description: 'Equipment slot: the hand a character holds their main weapon or other item in. A row of the Equipment list on a character\'s sheet. The "Equip in main hand" item in an item\'s menu there equips an item in this slot. In the Discard and Give dialogs, it can appear in "This unequips it from {slots}."'
	},
	offHand: {
		id: 'equipment.slot.offHand',
		defaultMessage: 'Off hand',
		description: 'Equipment slot: a character\'s other hand, for a second weapon, a shield or a torch. A row of the Equipment list on a character\'s sheet. The "Equip in off hand" item in an item\'s menu there equips an item in this slot. In the Discard and Give dialogs, it can appear in "This unequips it from {slots}."'
	},
	bothHands: {
		id: 'equipment.slot.bothHands',
		defaultMessage: 'Both hands',
		description: 'Where a weapon is held: in both of a character\'s hands, such as a greatsword, or a longsword gripped with two hands. It only appears in the Discard and Give dialogs, in "This unequips it from {slots}."'
	},
	none: {
		id: 'equipment.equips.none',
		defaultMessage: 'Nowhere',
		description: 'Where an item equips: it can\'t be equipped, such as a book or ammunition. A choice in the item editor\'s "Equips to" field and in the Items tab\'s filter for it. Also shows where an item equips in the Inspect dialog and on the Audit tab'
	},
	oneHand: {
		id: 'equipment.equips.oneHand',
		defaultMessage: 'One hand',
		description: 'Where an item equips: held in either hand, such as a dagger, a shield or a torch. A choice in the item editor\'s "Equips to" field and in the Items tab\'s filter for it. Also shows where an item equips in the Inspect dialog, in its summary on the editor\'s Items tab and on the Audit tab'
	},
	twoHands: {
		id: 'equipment.equips.twoHands',
		defaultMessage: 'Two hands',
		description: 'Where an item equips: held in both hands at once, such as a greatsword, a bow or a rifle. A choice in the item editor\'s "Equips to" field and in the Items tab\'s filter for it. Also shows where an item equips in the Inspect dialog, in its summary on the editor\'s Items tab and on the Audit tab'
	}
});

/**
 * An item equipped in one of a character's slots. A two-handed item, and a one-handed weapon held in both
 * hands, is one in the main hand with bothHands set, and takes the off hand too
 */
export interface EquippedItem
{
	/**
	 * One of the ruleset's slots (equipmentSlots())
	 */
	slot: string;

	/**
	 * An item the character carries, by the ID everything else uses for it
	 */
	itemId: number;

	/**
	 * Whether it is held in both hands; only ever set in the main hand
	 */
	bothHands: boolean;
}

/**
 * An item as far as equipping it goes
 */
export interface EquipmentItem
{
	id: number;

	/**
	 * One of the ruleset's item categories (ITEM_KINDS): only a weapon held in one hand can be held in both
	 */
	category: string;

	/**
	 * Its types, which make it a shield or not
	 */
	types: readonly string[];

	/**
	 * Where it equips: one of HELD_EQUIPS or the ruleset's worn places
	 */
	equips: string;
}

/**
 * Why an item can't be equipped as asked
 *
 * - notEquippable: it equips nowhere, or the hands asked for don't suit it (both hands for an item that
 *   isn't a weapon, a hand for a worn item)
 * - noTail: it is worn on the tail, and the character's race has none
 * - ringSlotsFull: it is a ring, both ring slots hold other items, and no ring slot was chosen
 */
export type EquipRefusal = 'notEquippable' | 'noTail' | 'ringSlotsFull';

/**
 * What equipping an item does: the character's equipment afterward, what it unequips and what it adds
 */
export interface EquipPlan
{
	equipment: EquippedItem[];
	removed: EquippedItem[];

	/**
	 * Null when the item is already equipped as asked, which changes nothing
	 */
	added: EquippedItem | null;
}

/**
 * Every slot of a ruleset, in the order the character sheet lists them: the worn slots, then the hands
 *
 * @param ruleset The ruleset
 * @return The slots' keys
 */
export function equipmentSlots(ruleset: Ruleset): string[]
{
	const { wornLocations, wornSlots } = RULESET_EQUIPMENT[ruleset];

	return([...wornLocations.flatMap((location) => wornSlots[location]), ...HAND_SLOTS]);
}

/**
 * The slots a character has: all of the ruleset's, but the tail for a character whose race has none
 *
 * @param ruleset The ruleset
 * @param hasTail Whether the character's race has a tail
 * @return The slots' keys, in the order the character sheet lists them
 */
export function characterSlots(ruleset: Ruleset, hasTail: boolean): string[]
{
	const { tailLocation, wornSlots } = RULESET_EQUIPMENT[ruleset];
	const tailSlots = new Set(((tailLocation !== null) && !hasTail) ? wornSlots[tailLocation] : []);

	return(equipmentSlots(ruleset).filter((slot) => !tailSlots.has(slot)));
}

/**
 * Where items of a ruleset can equip, in the order the item editor offers them: nowhere, one hand, two
 * hands, then the worn places
 *
 * @param ruleset The ruleset
 * @return The keys
 */
export function itemEquipsChoices(ruleset: Ruleset): string[]
{
	return([...HELD_EQUIPS, ...RULESET_EQUIPMENT[ruleset].wornLocations]);
}

/**
 * Whether a key is somewhere items of a ruleset can equip
 *
 * @param ruleset The ruleset
 * @param equips The key
 * @return True when it is
 */
export function isItemEquips(ruleset: Ruleset, equips: string): boolean
{
	return(itemEquipsChoices(ruleset).includes(equips));
}

/**
 * The name of where an item equips
 *
 * @param ruleset The ruleset
 * @param equips One of itemEquipsChoices()
 * @return Its name, or undefined for a key the ruleset doesn't have
 */
export function itemEquipsName(ruleset: Ruleset, equips: string): MessageDescriptor | undefined
{
	if ((HELD_EQUIPS as readonly string[]).includes(equips))
	{
		return(HELD_EQUIPMENT_NAMES[equips as HeldEquips]);
	}

	const names = RULESET_EQUIPMENT[ruleset].locationNames;

	return((Object.hasOwn(names, equips) ? names[equips] : undefined));
}

/**
 * The name of a slot
 *
 * @param ruleset The ruleset
 * @param slot One of equipmentSlots()
 * @return Its name, or undefined for a slot the ruleset doesn't have
 */
export function slotName(ruleset: Ruleset, slot: string): MessageDescriptor | undefined
{
	if ((HAND_SLOTS as readonly string[]).includes(slot))
	{
		return(HELD_EQUIPMENT_NAMES[slot as HandSlot]);
	}

	const { locationNames, extraSlotNames } = RULESET_EQUIPMENT[ruleset];

	if (Object.hasOwn(extraSlotNames, slot))
	{
		return(extraSlotNames[slot]);
	}

	return((Object.hasOwn(locationNames, slot) ? locationNames[slot] : undefined));
}

/**
 * Whether an item that equips somewhere fits a slot: a worn item in its place's slots, a one-handed item
 * in either hand and a two-handed one in the main hand. The hands and shield rules are planEquip()'s
 *
 * @param ruleset The ruleset
 * @param equips Where the item equips
 * @param slot The slot
 * @return True when it fits
 */
export function fitsSlot(ruleset: Ruleset, equips: string, slot: string): boolean
{
	switch (equips)
	{
		case 'none':
			return(false);

		case 'oneHand':
			return((slot === 'mainHand') || (slot === 'offHand'));

		case 'twoHands':
			return(slot === 'mainHand');
	}

	const { wornSlots } = RULESET_EQUIPMENT[ruleset];

	return(Object.hasOwn(wornSlots, equips) && wornSlots[equips].includes(slot));
}

/**
 * Whether an item is a shield, of which a character holds one at most
 *
 * @param ruleset The ruleset
 * @param types The item's types
 * @return True when it is
 */
export function isShield(ruleset: Ruleset, types: readonly string[]): boolean
{
	const { shieldTypes } = RULESET_EQUIPMENT[ruleset];

	return(types.some((type) => shieldTypes.includes(type)));
}

/**
 * A ruleset's social slots, in the order the character sheet lists them: its worn slots, but those of
 * the places without social slots (RulesetEquipment.nonSocialLocations). The hands have none
 *
 * @param ruleset The ruleset
 * @return The slots' keys
 */
export function socialSlots(ruleset: Ruleset): string[]
{
	const { wornLocations, wornSlots, nonSocialLocations } = RULESET_EQUIPMENT[ruleset];

	return(wornLocations
		.filter((location) => !nonSocialLocations.includes(location))
		.flatMap((location) => wornSlots[location]));
}

/**
 * Whether an item can be worn in a social slot: it fits the slot (fitsSlot()), and it is neither a
 * weapon nor a shield, even one worn rather than held, such as a dwarven boulder helmet
 *
 * @param ruleset The ruleset
 * @param item The item
 * @param slot The social slot
 * @return True when it can
 */
export function fitsSocialSlot(ruleset: Ruleset, item: Pick<EquipmentItem, 'category' | 'types' | 'equips'>, slot: string): boolean
{
	return(socialSlots(ruleset).includes(slot) && (item.category !== 'weapon') && !isShield(ruleset, item.types) && fitsSlot(ruleset, item.equips, slot));
}

/**
 * The social slot "Wear socially" puts an item in: the first of the slots it fits that is free, or one
 * already holding it, or the first
 *
 * @param ruleset The ruleset
 * @param social What the character wears in their social slots
 * @param item The item
 * @return The slot, or undefined for an item that fits no social slot
 */
export function socialSlotFor(ruleset: Ruleset, social: readonly EquippedItem[], item: Pick<EquipmentItem, 'id' | 'category' | 'types' | 'equips'>): string | undefined
{
	const slots = socialSlots(ruleset).filter((slot) => fitsSocialSlot(ruleset, item, slot));

	return(slots.find((slot) => !social.some((worn) => (worn.slot === slot))) ?? slots.find((slot) => social.some((worn) => ((worn.slot === slot) && (worn.itemId === item.id)))) ?? slots[0]);
}

/**
 * Which hands an item can be equipped in, as the item menu offers them
 *
 * @param item The item
 * @return The main or off hand for a one-handed item, and both for a one-handed weapon; both for a
 * two-handed item; none for an item not held
 */
export function handChoices(item: Pick<EquipmentItem, 'category' | 'equips'>): EquipHand[]
{
	switch (item.equips)
	{
		case 'oneHand':
			return(((item.category === 'weapon') ? ['main', 'off', 'both'] : ['main', 'off']));

		case 'twoHands':
			return(['both']);

		default:
			return([]);
	}
}

/**
 * Which ring slots an item can be equipped in, as the item menu offers them
 *
 * @param ruleset The ruleset
 * @param equipment The character's equipment
 * @param item The item
 * @return Both ring slots for a ring while both are full; none for a ring while one is free, which takes
 * it, and for an item that isn't a ring
 */
export function ringChoices(ruleset: Ruleset, equipment: readonly EquippedItem[], item: Pick<EquipmentItem, 'equips'>): EquipRing[]
{
	const { wornSlots, ringLocation } = RULESET_EQUIPMENT[ruleset];

	if ((ringLocation === null) || (item.equips !== ringLocation))
	{
		return([]);
	}

	const full = wornSlots[ringLocation].every((slot) => equipment.some((equipped) => (equipped.slot === slot)));

	return((full ? [...EQUIP_RINGS] : []));
}

/**
 * How many of an item are equipped
 *
 * @param equipment The character's equipment
 * @param itemId The item
 * @return How many slots hold it, a two-handed one counting once
 */
export function equippedCount(equipment: readonly EquippedItem[], itemId: number): number
{
	return(equipment.filter((equipped) => (equipped.itemId === itemId)).length);
}

/**
 * Where equipping an item goes
 */
interface EquipTarget
{
	slot: string;
	bothHands: boolean;

	/**
	 * Whether the item being in any slot of its worn place counts as being where it was asked to go: true
	 * for a worn item when no ring slot was chosen
	 */
	anySlotOfPlace: boolean;
}

/**
 * The slot equipping an item goes in: the ring slot chosen, a worn item's first free slot of its place,
 * or one holding the item when none are free, or the first when they hold other items (a ring then needs
 * a ring slot chosen), or the main or off hand
 *
 * @param ruleset The ruleset
 * @param equipment The character's equipment
 * @param item The item
 * @param hand The hands asked for, or null for a worn item
 * @param hasTail Whether the character's race has a tail
 * @param ring The ring slot chosen for a ring, or null to take a free one
 * @return Where it goes, or why it can't be equipped
 */
function targetOf(ruleset: Ruleset, equipment: readonly EquippedItem[], item: EquipmentItem, hand: EquipHand | null, hasTail: boolean, ring: EquipRing | null): EquipTarget | EquipRefusal
{
	const { wornSlots, tailLocation, ringLocation } = RULESET_EQUIPMENT[ruleset];

	if ((ring !== null) && (item.equips !== ringLocation))
	{
		return('notEquippable');
	}

	switch (item.equips)
	{
		case 'none':
			return('notEquippable');

		case 'oneHand':
			if ((hand === null) || !handChoices(item).includes(hand))
			{
				return('notEquippable');
			}

			return({
				slot: ((hand === 'off') ? 'offHand' : 'mainHand'),
				bothHands: (hand === 'both'),
				anySlotOfPlace: false
			});

		case 'twoHands':
			if ((hand !== null) && (hand !== 'both'))
			{
				return('notEquippable');
			}

			return({
				slot: 'mainHand',
				bothHands: true,
				anySlotOfPlace: false
			});
	}

	if ((hand !== null) || !Object.hasOwn(wornSlots, item.equips))
	{
		return('notEquippable');
	}

	if ((item.equips === tailLocation) && !hasTail)
	{
		return('noTail');
	}

	const slots = wornSlots[item.equips];

	if (ring !== null)
	{
		return({
			slot: slots[EQUIP_RINGS.indexOf(ring)],
			bothHands: false,
			anySlotOfPlace: false
		});
	}

	const slot = (slots.find((each) => !equipment.some((equipped) => (equipped.slot === each))) ?? slots.find((each) => equipment.some((equipped) => ((equipped.slot === each) && (equipped.itemId === item.id)))));

	if ((slot === undefined) && (item.equips === ringLocation))
	{
		return('ringSlotsFull');
	}

	return({
		slot: (slot ?? slots[0]),
		bothHands: false,
		anySlotOfPlace: true
	});
}

/**
 * The slots an item in a slot takes: both hands for one held in both, otherwise its own
 *
 * @param equipped The equipped item
 * @return The slots
 */
function takenSlots(equipped: Pick<EquippedItem, 'slot' | 'bothHands'>): string[]
{
	return((equipped.bothHands ? ['mainHand', 'offHand'] : [equipped.slot]));
}

/**
 * Whether an item is already equipped as asked: one of it is in the slot equipping it goes in, held the
 * same way, or every one the character carries is equipped and a worn one is in a slot of its place,
 * when no ring slot was chosen
 *
 * @param ruleset The ruleset
 * @param equipment The character's equipment
 * @param item The item
 * @param quantity How many of the item the character carries
 * @param target Where equipping it goes
 * @return Whether it is already equipped as asked
 */
function isEquippedAsAsked(ruleset: Ruleset, equipment: readonly EquippedItem[], item: EquipmentItem, quantity: number, target: EquipTarget): boolean
{
	const own = equipment.filter((equipped) => (equipped.itemId === item.id));
	const allEquipped = (own.length >= quantity);

	return(own.some((equipped) => ((equipped.bothHands === target.bothHands) && ((equipped.slot === target.slot) || (target.anySlotOfPlace && allEquipped && fitsSlot(ruleset, item.equips, equipped.slot))))));
}

/**
 * Whether equipping an item changes nothing because it is already equipped as asked, as planEquip()
 * decides. False when it can't be equipped as asked
 *
 * @param ruleset The ruleset
 * @param equipment The character's equipment
 * @param item The item
 * @param quantity How many of the item the character carries
 * @param hand The hands to hold it in, or null for a worn item
 * @param hasTail Whether the character's race has a tail
 * @param ring The ring slot to put a ring in, or null to take a free one
 * @return Whether equipping it changes nothing
 */
export function equipChangesNothing(ruleset: Ruleset, equipment: readonly EquippedItem[], item: EquipmentItem, quantity: number, hand: EquipHand | null, hasTail: boolean, ring: EquipRing | null): boolean
{
	const target = targetOf(ruleset, equipment, item, hand, hasTail, ring);

	return(((typeof target !== 'string') && isEquippedAsAsked(ruleset, equipment, item, quantity, target)));
}

/**
 * What equipping an item does. What is in the slots it takes is unequipped, without asking: a two-handed
 * item unequips both hands, a one-handed item unequips a two-handed one, and a shield unequips the
 * character's other shield, a buckler on the off arm included. A ring goes in the first free ring slot,
 * or the ring slot chosen, which is needed when both are full. When every one of the item the character
 * carries is already equipped, one moves: the one equipped first in unequipOrder()'s order. An item
 * already equipped as asked (equipChangesNothing()) stays where it is
 *
 * @param ruleset The ruleset
 * @param equipment The character's equipment
 * @param items The equipped items and the item to equip, by ID
 * @param item The item to equip
 * @param quantity How many of the item the character carries
 * @param hand The hands to hold it in, or null for a worn item (and allowed for a two-handed one)
 * @param hasTail Whether the character's race has a tail
 * @param ring The ring slot to put a ring in (ringChoices()), or null to take a free one
 * @return What it does, or why it can't be equipped
 */
export function planEquip(ruleset: Ruleset, equipment: readonly EquippedItem[], items: ReadonlyMap<number, EquipmentItem>, item: EquipmentItem, quantity: number, hand: EquipHand | null, hasTail: boolean, ring: EquipRing | null = null): EquipPlan | EquipRefusal
{
	const target = targetOf(ruleset, equipment, item, hand, hasTail, ring);

	if (typeof target === 'string')
	{
		return(target);
	}

	if (isEquippedAsAsked(ruleset, equipment, item, quantity, target))
	{
		return({
			equipment: [...equipment],
			removed: [],
			added: null
		});
	}

	const taken = new Set(takenSlots(target));
	const shield = isShield(ruleset, item.types);
	const removed = equipment.filter((equipped) =>
	{
		if (takenSlots(equipped).some((slot) => taken.has(slot)))
		{
			return(true);
		}

		const other = items.get(equipped.itemId);

		return(shield && (other !== undefined) && isShield(ruleset, other.types));
	});
	const left = equipment.filter((equipped) => !removed.includes(equipped));

	if (equippedCount(left, item.id) >= quantity)
	{
		const [moved] = unequipOrder(ruleset, left.filter((equipped) => (equipped.itemId === item.id)));

		if (moved)
		{
			removed.push(moved);
		}
	}

	const added: EquippedItem = {
		slot: target.slot,
		itemId: item.id,
		bothHands: target.bothHands
	};

	return({
		equipment: [...equipment.filter((equipped) => !removed.includes(equipped)), added],
		removed,
		added
	});
}

/**
 * Equipped items in the order they are unequipped when fewer are left than are equipped: the off hand
 * first, then the main hand, then the worn slots in the order the sheet lists them
 *
 * @param ruleset The ruleset
 * @param equipment Some equipped items
 * @return The same items, sorted
 */
export function unequipOrder(ruleset: Ruleset, equipment: readonly EquippedItem[]): EquippedItem[]
{
	const slots = equipmentSlots(ruleset);
	const rank = (slot: string): number =>
	{
		if (slot === 'offHand')
		{
			return(-2);
		}

		return(((slot === 'mainHand') ? -1 : slots.indexOf(slot)));
	};

	return([...equipment].sort((a, b) => (rank(a.slot) - rank(b.slot))));
}

/**
 * What discarding or giving away some of an item unequips: as many of its equipped ones as there are more
 * equipped than are left, in unequipOrder()'s order
 *
 * @param ruleset The ruleset
 * @param equipment The character's equipment
 * @param itemId The item
 * @param remaining How many of it the character still carries afterward
 * @return The equipped items to unequip
 */
export function unequippedByRemoval(ruleset: Ruleset, equipment: readonly EquippedItem[], itemId: number, remaining: number): EquippedItem[]
{
	const own = unequipOrder(ruleset, equipment.filter((equipped) => (equipped.itemId === itemId)));

	return(own.slice(0, Math.max(own.length - Math.max(remaining, 0), 0)));
}

/**
 * What a new character equips from their starting items: each worn item goes in its slot while the slot
 * is free (as many of it as there are free slots of its place), then the first weapon held in the hands
 * goes in the main hand (both hands for a two-handed one), so no character starts out holding two, and
 * then a shield goes in the off hand while it is free and the character has no shield. A buckler counts as
 * a worn item, and the character's one shield. Other held items, such as torches, stay unequipped
 *
 * @param ruleset The ruleset
 * @param items The starting items, in order: the class's, then the race's, then the universe's, each list
 * by name, and how many of each
 * @param hasTail Whether the character's race has a tail
 * @return The equipment
 */
export function startingEquipment(ruleset: Ruleset, items: readonly { item: EquipmentItem; quantity: number }[], hasTail: boolean): EquippedItem[]
{
	const equipment: EquippedItem[] = [];
	const { wornSlots, tailLocation } = RULESET_EQUIPMENT[ruleset];
	const isFree = (slot: string): boolean => !equipment.some((equipped) => takenSlots(equipped).includes(slot));
	let hasShield = false;

	for (const { item, quantity } of items)
	{
		if (!Object.hasOwn(wornSlots, item.equips) || ((item.equips === tailLocation) && !hasTail))
		{
			continue;
		}

		const shield = isShield(ruleset, item.types);

		if (shield && hasShield)
		{
			continue;
		}

		const free = wornSlots[item.equips]
			.filter(isFree)
			.slice(0, (shield ? 1 : quantity));

		for (const slot of free)
		{
			equipment.push({
				slot,
				itemId: item.id,
				bothHands: false
			});
			hasShield ||= shield;
		}
	}

	const weapon = items.find(({ item }) => ((item.category === 'weapon') && ((item.equips === 'oneHand') || (item.equips === 'twoHands')) && !isShield(ruleset, item.types)));

	if (weapon)
	{
		equipment.push({
			slot: 'mainHand',
			itemId: weapon.item.id,
			bothHands: (weapon.item.equips === 'twoHands')
		});
	}

	const heldShield = items.find(({ item }) => ((item.equips === 'oneHand') && isShield(ruleset, item.types)));

	if (heldShield && !hasShield && isFree('offHand'))
	{
		equipment.push({
			slot: 'offHand',
			itemId: heldShield.item.id,
			bothHands: false
		});
	}

	return(equipment);
}
