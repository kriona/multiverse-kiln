/**
 * Pathfinder 1E's equipment slots, and where each default item equips (see Equipment in
 * STRUCTURE-OVERVIEW.md)
 *
 * The worn slots are the Core Rulebook's magic item slots, so magic items fit them later, with a tail for
 * the Advanced Race Guide's tail weapons and the off arm for a buckler, which is strapped to the arm and
 * takes no hand
 */
import { defineMessages, type MessageDescriptor } from '../../localization.js';
import type { Pf1eDefaultItemKey } from './items.js';

/**
 * The places an item is worn, in the order the character sheet lists them. Each is one slot but ring,
 * which is two (PF1E_WORN_SLOTS)
 */
export const PF1E_WORN_LOCATIONS = ['head', 'headband', 'eyes', 'shoulders', 'neck', 'chest', 'body', 'armor', 'belt', 'wrists', 'hands', 'ring', 'feet', 'tail', 'offArm'] as const;

export type Pf1eWornLocation = typeof PF1E_WORN_LOCATIONS[number];

/**
 * The slots each worn place has
 */
export const PF1E_WORN_SLOTS: Record<Pf1eWornLocation, readonly string[]> = {
	head: ['head'],
	headband: ['headband'],
	eyes: ['eyes'],
	shoulders: ['shoulders'],
	neck: ['neck'],
	chest: ['chest'],
	body: ['body'],
	armor: ['armor'],
	belt: ['belt'],
	wrists: ['wrists'],
	hands: ['hands'],
	ring: ['ringLeft', 'ringRight'],
	feet: ['feet'],
	tail: ['tail'],
	offArm: ['offArm']
};

/**
 * Each worn place's name: in the item editor's choice of where an item equips, and in Inspect
 */
export const PF1E_WORN_LOCATION_NAMES: Record<Pf1eWornLocation, MessageDescriptor> = defineMessages({
	head: {
		id: 'pf1e.slot.head',
		defaultMessage: 'Head',
		description: 'Equipment slot in Pathfinder, where a helmet or hat is worn: a row of the Equipment section of a character\'s sheet, a choice in the item editor\'s "Equips to" field, and where an item equips in the Inspect dialog'
	},
	headband: {
		id: 'pf1e.slot.headband',
		defaultMessage: 'Headband',
		description: 'Equipment slot in Pathfinder, where a headband or circlet is worn around the forehead: a row of the Equipment section of a character\'s sheet, a choice in the item editor\'s "Equips to" field, and where an item equips in the Inspect dialog'
	},
	eyes: {
		id: 'pf1e.slot.eyes',
		defaultMessage: 'Eyes',
		description: 'Equipment slot in Pathfinder, where goggles or lenses are worn: a row of the Equipment section of a character\'s sheet, a choice in the item editor\'s "Equips to" field, and where an item equips in the Inspect dialog'
	},
	shoulders: {
		id: 'pf1e.slot.shoulders',
		defaultMessage: 'Shoulders',
		description: 'Equipment slot in Pathfinder, where a cloak or cape is worn: a row of the Equipment section of a character\'s sheet, a choice in the item editor\'s "Equips to" field, and where an item equips in the Inspect dialog'
	},
	neck: {
		id: 'pf1e.slot.neck',
		defaultMessage: 'Neck',
		description: 'Equipment slot in Pathfinder, where an amulet or holy symbol is worn: a row of the Equipment section of a character\'s sheet, a choice in the item editor\'s "Equips to" field, and where an item equips in the Inspect dialog'
	},
	chest: {
		id: 'pf1e.slot.chest',
		defaultMessage: 'Chest',
		description: 'Equipment slot in Pathfinder, where a vest or shirt is worn: a row of the Equipment section of a character\'s sheet, a choice in the item editor\'s "Equips to" field, and where an item equips in the Inspect dialog'
	},
	body: {
		id: 'pf1e.slot.body',
		defaultMessage: 'Body',
		description: 'Equipment slot in Pathfinder, where a robe or outfit of clothes is worn: a row of the Equipment section of a character\'s sheet, a choice in the item editor\'s "Equips to" field, and where an item equips in the Inspect dialog'
	},
	armor: {
		id: 'pf1e.slot.armor',
		defaultMessage: 'Armor',
		description: 'Equipment slot in Pathfinder, where a suit of armor is worn: a row of the Equipment section of a character\'s sheet, a choice in the item editor\'s "Equips to" field, and where an item equips in the Inspect dialog'
	},
	belt: {
		id: 'pf1e.slot.belt',
		defaultMessage: 'Belt',
		description: 'Equipment slot in Pathfinder, where a belt is worn around the waist: a row of the Equipment section of a character\'s sheet, a choice in the item editor\'s "Equips to" field, and where an item equips in the Inspect dialog'
	},
	wrists: {
		id: 'pf1e.slot.wrists',
		defaultMessage: 'Wrists',
		description: 'Equipment slot in Pathfinder, where bracers or bracelets are worn: a row of the Equipment section of a character\'s sheet, a choice in the item editor\'s "Equips to" field, and where an item equips in the Inspect dialog'
	},
	hands: {
		id: 'pf1e.slot.hands',
		defaultMessage: 'Hands',
		description: 'Equipment slot in Pathfinder, where gloves or gauntlets are worn (not what is held in the hands): a row of the Equipment section of a character\'s sheet, a choice in the item editor\'s "Equips to" field, and where an item equips in the Inspect dialog'
	},
	ring: {
		id: 'pf1e.slot.ring',
		defaultMessage: 'Ring',
		description: 'Where an item equips in Pathfinder: on a finger, in either of a character\'s two ring slots. A choice in the item editor\'s "Equips to" field, and where an item equips in the Inspect dialog'
	},
	feet: {
		id: 'pf1e.slot.feet',
		defaultMessage: 'Feet',
		description: 'Equipment slot in Pathfinder, where boots or shoes are worn: a row of the Equipment section of a character\'s sheet, a choice in the item editor\'s "Equips to" field, and where an item equips in the Inspect dialog'
	},
	tail: {
		id: 'pf1e.slot.tail',
		defaultMessage: 'Tail',
		description: 'Equipment slot in Pathfinder, only for characters whose race has a tail, where a blade or weight is strapped to the tail as a weapon: a row of the Equipment section of a character\'s sheet, a choice in the item editor\'s "Equips to" field, and where an item equips in the Inspect dialog'
	},
	offArm: {
		id: 'pf1e.slot.offArm',
		defaultMessage: 'Off arm',
		description: 'Equipment slot in Pathfinder, where a buckler (a small shield) is strapped to the forearm of the arm that doesn\'t hold the main weapon, leaving that hand free: a row of the Equipment section of a character\'s sheet, a choice in the item editor\'s "Equips to" field, and where an item equips in the Inspect dialog'
	}
});

/**
 * The names of the slots that aren't a worn place of their own: the two ring slots
 */
export const PF1E_RING_SLOT_NAMES: Record<string, MessageDescriptor> = defineMessages({
	ringLeft: {
		id: 'pf1e.slot.ringLeft',
		defaultMessage: 'Left ring',
		description: 'Equipment slot in Pathfinder, the first of a character\'s two ring slots: a row of the Equipment section of a character\'s sheet'
	},
	ringRight: {
		id: 'pf1e.slot.ringRight',
		defaultMessage: 'Right ring',
		description: 'Equipment slot in Pathfinder, the second of a character\'s two ring slots: a row of the Equipment section of a character\'s sheet'
	}
});

/**
 * The worn place that only characters whose race has a tail have
 */
export const PF1E_TAIL_LOCATION: Pf1eWornLocation = 'tail';

/**
 * The worn place with a left and a right slot, which the player chooses between when both are full
 */
export const PF1E_RING_LOCATION: Pf1eWornLocation = 'ring';

/**
 * The item types that make an item a shield, of which a character holds one at most
 */
export const PF1E_SHIELD_TYPES: readonly string[] = ['shields'];

/**
 * Where each default item equips: nowhere, one hand, two hands or a worn place (PF1E_WORN_LOCATIONS).
 * This is apart from the item's kind: a dwarven boulder helmet is a weapon worn on the head, and a torch
 * is gear held in a hand
 */
export const PF1E_DEFAULT_ITEM_EQUIPS: Record<Pf1eDefaultItemKey, string> = {
	dagger: 'oneHand',
	cestus: 'hands',
	sword_cane: 'oneHand',
	wooden_armor: 'armor',
	quilted_cloth: 'armor',
	kobold_long_lash: 'tail',
	kobold_spiked_tail: 'tail',
	ratfolk_tailblade: 'tail',
	book_of_puzzles: 'none',
	book_of_war_prayers: 'none',
	footprints_cast: 'none',
	light_fire_ink: 'none',
	tome_of_epics: 'none',
	gauntlet: 'hands',
	punching_dagger: 'oneHand',
	spiked_gauntlet: 'hands',
	light_mace: 'oneHand',
	sickle: 'oneHand',
	club: 'oneHand',
	heavy_mace: 'oneHand',
	morningstar: 'oneHand',
	shortspear: 'oneHand',
	longspear: 'twoHands',
	quarterstaff: 'twoHands',
	spear: 'twoHands',
	blowgun: 'twoHands',
	light_crossbow: 'twoHands',
	heavy_crossbow: 'twoHands',
	dart: 'oneHand',
	javelin: 'oneHand',
	sling: 'oneHand',
	throwing_axe: 'oneHand',
	light_hammer: 'oneHand',
	handaxe: 'oneHand',
	kukri: 'oneHand',
	light_pick: 'oneHand',
	sap: 'oneHand',
	starknife: 'oneHand',
	short_sword: 'oneHand',
	battleaxe: 'oneHand',
	flail: 'oneHand',
	longsword: 'oneHand',
	heavy_pick: 'oneHand',
	rapier: 'oneHand',
	scimitar: 'oneHand',
	trident: 'oneHand',
	warhammer: 'oneHand',
	falchion: 'twoHands',
	glaive: 'twoHands',
	greataxe: 'twoHands',
	greatclub: 'twoHands',
	heavy_flail: 'twoHands',
	greatsword: 'twoHands',
	guisarme: 'twoHands',
	halberd: 'twoHands',
	lance: 'twoHands',
	ranseur: 'twoHands',
	scythe: 'twoHands',
	shortbow: 'twoHands',
	composite_shortbow: 'twoHands',
	longbow: 'twoHands',
	composite_longbow: 'twoHands',
	kama: 'oneHand',
	nunchaku: 'oneHand',
	sai: 'oneHand',
	siangham: 'oneHand',
	bastard_sword: 'oneHand',
	dwarven_waraxe: 'oneHand',
	whip: 'oneHand',
	orc_double_axe: 'twoHands',
	spiked_chain: 'twoHands',
	elven_curve_blade: 'twoHands',
	dire_flail: 'twoHands',
	gnome_hooked_hammer: 'twoHands',
	two_bladed_sword: 'twoHands',
	dwarven_urgrosh: 'twoHands',
	bolas: 'oneHand',
	hand_crossbow: 'oneHand',
	light_repeating_crossbow: 'twoHands',
	heavy_repeating_crossbow: 'twoHands',
	net: 'oneHand',
	shuriken: 'oneHand',
	halfling_sling_staff: 'twoHands',
	arrows: 'none',
	crossbow_bolts: 'none',
	repeating_crossbow_bolts: 'none',
	blowgun_darts: 'none',
	sling_bullets: 'none',
	padded_armor: 'armor',
	leather_armor: 'armor',
	studded_leather: 'armor',
	chain_shirt: 'armor',
	hide_armor: 'armor',
	scale_mail: 'armor',
	chainmail: 'armor',
	breastplate: 'armor',
	splint_mail: 'armor',
	banded_mail: 'armor',
	half_plate: 'armor',
	full_plate: 'armor',
	locked_gauntlet: 'hands',
	buckler: 'offArm',
	light_wooden_shield: 'oneHand',
	light_steel_shield: 'oneHand',
	heavy_wooden_shield: 'oneHand',
	heavy_steel_shield: 'oneHand',
	tower_shield: 'oneHand',
	artisans_tools: 'none',
	climbers_kit: 'none',
	disguise_kit: 'none',
	healers_kit: 'none',
	holly_and_mistletoe: 'none',
	wooden_holy_symbol: 'neck',
	silver_holy_symbol: 'neck',
	thieves_tools: 'none',
	bells: 'oneHand',
	chimes: 'twoHands',
	drum: 'twoHands',
	fiddle: 'twoHands',
	harp: 'twoHands',
	lute: 'twoHands',
	mandolin: 'twoHands',
	flute: 'twoHands',
	pan_pipes: 'twoHands',
	recorder: 'twoHands',
	shawm: 'twoHands',
	trumpet: 'twoHands',
	lasso: 'oneHand',
	armored_coat: 'armor',
	agile_breastplate: 'armor',
	agile_half_plate: 'armor',
	quickdraw_light_wooden_shield: 'oneHand',
	quickdraw_light_steel_shield: 'oneHand',
	kobold_pounder_tail: 'tail',
	kobold_razored_tail: 'tail',
	kobold_sweeper_tail: 'tail',
	claw_blades: 'hands',
	dwarven_boulder_helmet: 'head',
	dwarven_double_waraxe: 'twoHands',
	dwarven_longaxe: 'twoHands',
	dwarven_longhammer: 'twoHands',
	sea_knife: 'oneHand',
	jolting_dart: 'oneHand',
	snag_net: 'oneHand',
	heartstake_bolt: 'none'
};
