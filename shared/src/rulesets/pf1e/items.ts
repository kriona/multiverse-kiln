/**
 * Pathfinder 1E's kinds of item, and the default items a universe can edit, disable or add to
 *
 * Open Game Content from the Pathfinder Roleplaying Game Core Rulebook, Advanced Player's Guide, Advanced
 * Race Guide and Advanced Class Guide, used under the Open Game License 1.0a (client/license.html). Each
 * item's book is in rulebooks.ts
 */
import { defineMessages, type MessageDescriptor } from '../../localization.js';

/**
 * The broad kinds of item, which the Items tab filters by
 */
export const PF1E_ITEM_CATEGORIES = ['weapon', 'armor', 'gear'] as const;

export type Pf1eItemCategory = typeof PF1E_ITEM_CATEGORIES[number];

/**
 * Each item category's name
 */
export const PF1E_ITEM_CATEGORY_NAMES: Record<Pf1eItemCategory, MessageDescriptor> = defineMessages({
	weapon: {
		id: 'pf1e.itemCategory.weapon',
		defaultMessage: 'Weapon',
		description: 'Kind of item in Pathfinder: swords, bows, ammunition and the like. A choice of the Kind filter on the editor\'s Items tab and in the dialog for choosing items, and in the item editor; shown as an item\'s kind in the Inspect dialog and on the Audit tab, and as the name of an item\'s icon for screen readers'
	},
	armor: {
		id: 'pf1e.itemCategory.armor',
		defaultMessage: 'Armor',
		description: 'Kind of item in Pathfinder: armor and shields. A choice of the Kind filter on the editor\'s Items tab and in the dialog for choosing items, and in the item editor; shown as an item\'s kind in the Inspect dialog and on the Audit tab, and as the name of an item\'s icon for screen readers'
	},
	gear: {
		id: 'pf1e.itemCategory.gear',
		defaultMessage: 'Gear',
		description: 'Kind of item in Pathfinder: adventuring equipment such as rope, torches, tools and musical instruments. A choice of the Kind filter on the editor\'s Items tab and in the dialog for choosing items, and in the item editor; shown as an item\'s kind in the Inspect dialog and on the Audit tab, and as the name of an item\'s icon for screen readers'
	}
});

/**
 * Each item type's category, by the type's key. An item has any number of types of its category, or none.
 * A weapon's types are the fighter's weapon groups it is in (the Core Rulebook's Weapon Training), and
 * ammunition for the weapons that shoot it; armor's are the categories armor proficiency uses, and
 * gear's what the gear is for
 */
export const PF1E_ITEM_TYPES = {
	axes: 'weapon',
	blades_heavy: 'weapon',
	blades_light: 'weapon',
	bows: 'weapon',
	close: 'weapon',
	crossbows: 'weapon',
	double: 'weapon',
	flails: 'weapon',
	hammers: 'weapon',
	monk: 'weapon',
	natural: 'weapon',
	polearms: 'weapon',
	spears: 'weapon',
	thrown: 'weapon',
	ammunition: 'weapon',
	light_armor: 'armor',
	medium_armor: 'armor',
	heavy_armor: 'armor',
	shields: 'armor',
	alchemical: 'gear',
	clothing: 'gear',
	food_and_drink: 'gear',
	light_source: 'gear',
	poison: 'gear',
	rope: 'gear',
	tool: 'gear'
} as const satisfies Record<string, Pf1eItemCategory>;

export type Pf1eItemType = keyof typeof PF1E_ITEM_TYPES;

/**
 * Each item type's name
 */
export const PF1E_ITEM_TYPE_NAMES: Record<Pf1eItemType, MessageDescriptor> = defineMessages({
	axes: {
		id: 'pf1e.itemType.axes',
		defaultMessage: 'axes',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups. A choice of the Type filter on the editor\'s Items tab and in the dialog for choosing items, and a checkbox in the item editor; shown in an item\'s list of types in the Items tab\'s Summary column, under its name in the dialog for choosing items, in the Inspect dialog and on the Audit tab. It covers battleaxes, handaxes, picks and the like. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	blades_heavy: {
		id: 'pf1e.itemType.blades_heavy',
		defaultMessage: 'heavy blades',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups. A choice of the Type filter on the editor\'s Items tab and in the dialog for choosing items, and a checkbox in the item editor; shown in an item\'s list of types in the Items tab\'s Summary column, under its name in the dialog for choosing items, in the Inspect dialog and on the Audit tab. It covers longswords, scimitars, greatswords and the like. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	blades_light: {
		id: 'pf1e.itemType.blades_light',
		defaultMessage: 'light blades',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups. A choice of the Type filter on the editor\'s Items tab and in the dialog for choosing items, and a checkbox in the item editor; shown in an item\'s list of types in the Items tab\'s Summary column, under its name in the dialog for choosing items, in the Inspect dialog and on the Audit tab. It covers daggers, short swords, rapiers and the like. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	bows: {
		id: 'pf1e.itemType.bows',
		defaultMessage: 'bows',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups. A choice of the Type filter on the editor\'s Items tab and in the dialog for choosing items, and a checkbox in the item editor; shown in an item\'s list of types in the Items tab\'s Summary column, under its name in the dialog for choosing items, in the Inspect dialog and on the Audit tab. It covers shortbows and longbows. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	close: {
		id: 'pf1e.itemType.close',
		defaultMessage: 'close',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups. A choice of the Type filter on the editor\'s Items tab and in the dialog for choosing items, and a checkbox in the item editor; shown in an item\'s list of types in the Items tab\'s Summary column, under its name in the dialog for choosing items, in the Inspect dialog and on the Audit tab. It covers weapons for fighting up close, such as gauntlets, a cestus or a shield used to bash. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	crossbows: {
		id: 'pf1e.itemType.crossbows',
		defaultMessage: 'crossbows',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups. A choice of the Type filter on the editor\'s Items tab and in the dialog for choosing items, and a checkbox in the item editor; shown in an item\'s list of types in the Items tab\'s Summary column, under its name in the dialog for choosing items, in the Inspect dialog and on the Audit tab. It covers light, heavy and hand crossbows. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	double: {
		id: 'pf1e.itemType.double',
		defaultMessage: 'double',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups. A choice of the Type filter on the editor\'s Items tab and in the dialog for choosing items, and a checkbox in the item editor; shown in an item\'s list of types in the Items tab\'s Summary column, under its name in the dialog for choosing items, in the Inspect dialog and on the Audit tab. It covers weapons with a striking end at each end, such as a quarterstaff. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	flails: {
		id: 'pf1e.itemType.flails',
		defaultMessage: 'flails',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups. A choice of the Type filter on the editor\'s Items tab and in the dialog for choosing items, and a checkbox in the item editor; shown in an item\'s list of types in the Items tab\'s Summary column, under its name in the dialog for choosing items, in the Inspect dialog and on the Audit tab. It covers flails, chains and whips. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	hammers: {
		id: 'pf1e.itemType.hammers',
		defaultMessage: 'hammers',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups. A choice of the Type filter on the editor\'s Items tab and in the dialog for choosing items, and a checkbox in the item editor; shown in an item\'s list of types in the Items tab\'s Summary column, under its name in the dialog for choosing items, in the Inspect dialog and on the Audit tab. It covers clubs, maces, warhammers and the like. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	monk: {
		id: 'pf1e.itemType.monk',
		defaultMessage: 'monk',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups. A choice of the Type filter on the editor\'s Items tab and in the dialog for choosing items, and a checkbox in the item editor; shown in an item\'s list of types in the Items tab\'s Summary column, under its name in the dialog for choosing items, in the Inspect dialog and on the Audit tab. It covers the weapons monks train with, such as a kama or quarterstaff. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	natural: {
		id: 'pf1e.itemType.natural',
		defaultMessage: 'natural',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups. A choice of the Type filter on the editor\'s Items tab and in the dialog for choosing items, and a checkbox in the item editor; shown in an item\'s list of types in the Items tab\'s Summary column, under its name in the dialog for choosing items, in the Inspect dialog and on the Audit tab. It covers unarmed strikes and natural weapons such as claws. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	polearms: {
		id: 'pf1e.itemType.polearms',
		defaultMessage: 'polearms',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups. A choice of the Type filter on the editor\'s Items tab and in the dialog for choosing items, and a checkbox in the item editor; shown in an item\'s list of types in the Items tab\'s Summary column, under its name in the dialog for choosing items, in the Inspect dialog and on the Audit tab. It covers halberds, glaives and other blades on long poles. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	spears: {
		id: 'pf1e.itemType.spears',
		defaultMessage: 'spears',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups. A choice of the Type filter on the editor\'s Items tab and in the dialog for choosing items, and a checkbox in the item editor; shown in an item\'s list of types in the Items tab\'s Summary column, under its name in the dialog for choosing items, in the Inspect dialog and on the Audit tab. It covers spears, javelins, lances and the like. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	thrown: {
		id: 'pf1e.itemType.thrown',
		defaultMessage: 'thrown',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups. A choice of the Type filter on the editor\'s Items tab and in the dialog for choosing items, and a checkbox in the item editor; shown in an item\'s list of types in the Items tab\'s Summary column, under its name in the dialog for choosing items, in the Inspect dialog and on the Audit tab. It covers weapons made to be thrown, such as darts, or that can be, such as a dagger. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	ammunition: {
		id: 'pf1e.itemType.ammunition',
		defaultMessage: 'ammunition',
		description: 'Type of weapon in Pathfinder. A choice of the Type filter on the editor\'s Items tab and in the dialog for choosing items, and a checkbox in the item editor; shown in an item\'s list of types in the Items tab\'s Summary column, under its name in the dialog for choosing items, in the Inspect dialog and on the Audit tab. It covers what bows, crossbows, slings and blowguns shoot, such as arrows, bolts and sling bullets'
	},
	light_armor: {
		id: 'pf1e.itemType.light_armor',
		defaultMessage: 'light armor',
		description: 'Type of armor in Pathfinder. A choice of the Type filter on the editor\'s Items tab and in the dialog for choosing items, and a checkbox in the item editor; shown in an item\'s list of types in the Items tab\'s Summary column, under its name in the dialog for choosing items, in the Inspect dialog and on the Audit tab. It covers armor such as leather armor or a chain shirt, which barely slows its wearer'
	},
	medium_armor: {
		id: 'pf1e.itemType.medium_armor',
		defaultMessage: 'medium armor',
		description: 'Type of armor in Pathfinder. A choice of the Type filter on the editor\'s Items tab and in the dialog for choosing items, and a checkbox in the item editor; shown in an item\'s list of types in the Items tab\'s Summary column, under its name in the dialog for choosing items, in the Inspect dialog and on the Audit tab. It covers armor such as hide or a breastplate, which slows its wearer'
	},
	heavy_armor: {
		id: 'pf1e.itemType.heavy_armor',
		defaultMessage: 'heavy armor',
		description: 'Type of armor in Pathfinder. A choice of the Type filter on the editor\'s Items tab and in the dialog for choosing items, and a checkbox in the item editor; shown in an item\'s list of types in the Items tab\'s Summary column, under its name in the dialog for choosing items, in the Inspect dialog and on the Audit tab. It covers armor such as full plate, which slows its wearer the most'
	},
	shields: {
		id: 'pf1e.itemType.shields',
		defaultMessage: 'shields',
		description: 'Type of armor in Pathfinder. A choice of the Type filter on the editor\'s Items tab and in the dialog for choosing items, and a checkbox in the item editor; shown in an item\'s list of types in the Items tab\'s Summary column, under its name in the dialog for choosing items, in the Inspect dialog and on the Audit tab. It covers shields of every size, from bucklers to tower shields'
	},
	alchemical: {
		id: 'pf1e.itemType.alchemical',
		defaultMessage: 'alchemical',
		description: 'Type of item in Pathfinder. A choice of the Type filter on the editor\'s Items tab and in the dialog for choosing items, and a checkbox in the item editor; shown in an item\'s list of types in the Items tab\'s Summary column, under its name in the dialog for choosing items, in the Inspect dialog and on the Audit tab. It covers a substance made by alchemy, such as alchemist\'s fire, acid or a sunrod'
	},
	clothing: {
		id: 'pf1e.itemType.clothing',
		defaultMessage: 'clothing',
		description: 'Type of item in Pathfinder. A choice of the Type filter on the editor\'s Items tab and in the dialog for choosing items, and a checkbox in the item editor; shown in an item\'s list of types in the Items tab\'s Summary column, under its name in the dialog for choosing items, in the Inspect dialog and on the Audit tab. It covers clothes, such as a traveler\'s outfit or a cloak'
	},
	food_and_drink: {
		id: 'pf1e.itemType.food_and_drink',
		defaultMessage: 'food and drink',
		description: 'Type of item in Pathfinder. A choice of the Type filter on the editor\'s Items tab and in the dialog for choosing items, and a checkbox in the item editor; shown in an item\'s list of types in the Items tab\'s Summary column, under its name in the dialog for choosing items, in the Inspect dialog and on the Audit tab. It covers something to eat or drink, such as trail rations'
	},
	light_source: {
		id: 'pf1e.itemType.light_source',
		defaultMessage: 'light source',
		description: 'Type of item in Pathfinder. A choice of the Type filter on the editor\'s Items tab and in the dialog for choosing items, and a checkbox in the item editor; shown in an item\'s list of types in the Items tab\'s Summary column, under its name in the dialog for choosing items, in the Inspect dialog and on the Audit tab. It covers something that gives light, such as a torch, candle or lantern'
	},
	poison: {
		id: 'pf1e.itemType.poison',
		defaultMessage: 'poison',
		description: 'Type of item in Pathfinder. A choice of the Type filter on the editor\'s Items tab and in the dialog for choosing items, and a checkbox in the item editor; shown in an item\'s list of types in the Items tab\'s Summary column, under its name in the dialog for choosing items, in the Inspect dialog and on the Audit tab. It covers a poison, such as a venom applied to a blade'
	},
	rope: {
		id: 'pf1e.itemType.rope',
		defaultMessage: 'rope',
		description: 'Type of item in Pathfinder. A choice of the Type filter on the editor\'s Items tab and in the dialog for choosing items, and a checkbox in the item editor; shown in an item\'s list of types in the Items tab\'s Summary column, under its name in the dialog for choosing items, in the Inspect dialog and on the Audit tab. It covers a length of rope'
	},
	tool: {
		id: 'pf1e.itemType.tool',
		defaultMessage: 'tool',
		description: 'Type of item in Pathfinder. A choice of the Type filter on the editor\'s Items tab and in the dialog for choosing items, and a checkbox in the item editor; shown in an item\'s list of types in the Items tab\'s Summary column, under its name in the dialog for choosing items, in the Inspect dialog and on the Audit tab. It covers tools and kits that help with a skill, such as thieves\' tools, a healer\'s kit or a musical instrument'
	}
});

/**
 * Each default item's name, by the item's key. The database stores each name's English text
 */
export const PF1E_DEFAULT_ITEM_NAMES = defineMessages({
	dagger: {
		id: 'item.pf1e.dagger',
		defaultMessage: 'dagger',
		description: 'Name of an item in Pathfinder: a short blade for stabbing or throwing'
	},
	cestus: {
		id: 'item.pf1e.cestus',
		defaultMessage: 'cestus',
		description: 'Name of an item in Pathfinder: a studded leather glove for punching'
	},
	sword_cane: {
		id: 'item.pf1e.sword_cane',
		defaultMessage: 'sword cane',
		description: 'Name of an item in Pathfinder: a thin blade hidden in a walking stick'
	},
	wooden_armor: {
		id: 'item.pf1e.wooden_armor',
		defaultMessage: 'wooden armor',
		description: 'Name of an item in Pathfinder: light armor of wooden plates bound together'
	},
	quilted_cloth: {
		id: 'item.pf1e.quilted_cloth',
		defaultMessage: 'quilted cloth',
		description: 'Name of an item in Pathfinder: light armor of layered, padded cloth worn as clothing'
	},
	kobold_long_lash: {
		id: 'item.pf1e.kobold_long_lash',
		defaultMessage: 'long lash tail attachment',
		description: 'Name of an item in Pathfinder: a whip-like blade a kobold straps to the end of its tail'
	},
	kobold_spiked_tail: {
		id: 'item.pf1e.kobold_spiked_tail',
		defaultMessage: 'spiked tail attachment',
		description: 'Name of an item in Pathfinder: a spiked weight a kobold straps to the end of its tail'
	},
	ratfolk_tailblade: {
		id: 'item.pf1e.ratfolk_tailblade',
		defaultMessage: 'ratfolk tailblade',
		description: 'Name of an item in Pathfinder: a small blade a ratfolk straps to its tail'
	},
	book_of_puzzles: {
		id: 'item.pf1e.book_of_puzzles',
		defaultMessage: 'book of puzzles',
		description: 'Name of an item in Pathfinder: a book of brainteasers that train the mind of whoever solves them'
	},
	book_of_war_prayers: {
		id: 'item.pf1e.book_of_war_prayers',
		defaultMessage: 'book of war prayers',
		description: 'Name of an item in Pathfinder: a small book of prayers read aloud before a battle to hearten allies'
	},
	footprints_cast: {
		id: 'item.pf1e.footprints_cast',
		defaultMessage: 'footprints cast',
		description: 'Name of an item in Pathfinder: a quick-drying plaster for taking a copy of footprints to study later'
	},
	light_fire_ink: {
		id: 'item.pf1e.light_fire_ink',
		defaultMessage: 'light fire ink',
		description: 'Name of an item in Pathfinder: an ink for secret messages that bursts into flame once light falls on it'
	},
	tome_of_epics: {
		id: 'item.pf1e.tome_of_epics',
		defaultMessage: 'tome of epics',
		description: 'Name of an item in Pathfinder: a heavy illustrated book of heroic tales that inspires its reader'
	},
	gauntlet: {
		id: 'item.pf1e.gauntlet',
		defaultMessage: 'gauntlet',
		description: 'Name of an item in Pathfinder: a metal glove that makes a punch a lethal blow'
	},
	punching_dagger: {
		id: 'item.pf1e.punching_dagger',
		defaultMessage: 'punching dagger',
		description: 'Name of an item in Pathfinder: a short, wide blade with a grip across the fist, thrust forward like a punch'
	},
	spiked_gauntlet: {
		id: 'item.pf1e.spiked_gauntlet',
		defaultMessage: 'spiked gauntlet',
		description: 'Name of an item in Pathfinder: a metal glove studded with spikes, for punching'
	},
	light_mace: {
		id: 'item.pf1e.light_mace',
		defaultMessage: 'light mace',
		description: 'Name of an item in Pathfinder: a short club with a heavy metal head'
	},
	sickle: {
		id: 'item.pf1e.sickle',
		defaultMessage: 'sickle',
		description: 'Name of an item in Pathfinder: a farmer\'s short, curved blade for cutting crops, used as a weapon'
	},
	club: {
		id: 'item.pf1e.club',
		defaultMessage: 'club',
		description: 'Name of an item in Pathfinder: a heavy stick of wood used as a weapon'
	},
	heavy_mace: {
		id: 'item.pf1e.heavy_mace',
		defaultMessage: 'heavy mace',
		description: 'Name of an item in Pathfinder: a long club with a heavy metal head'
	},
	morningstar: {
		id: 'item.pf1e.morningstar',
		defaultMessage: 'morningstar',
		description: 'Name of an item in Pathfinder: a club topped with a spiked metal ball'
	},
	shortspear: {
		id: 'item.pf1e.shortspear',
		defaultMessage: 'shortspear',
		description: 'Name of an item in Pathfinder: a short spear for stabbing with one hand or throwing'
	},
	longspear: {
		id: 'item.pf1e.longspear',
		defaultMessage: 'longspear',
		description: 'Name of an item in Pathfinder: a very long spear for keeping foes at a distance'
	},
	quarterstaff: {
		id: 'item.pf1e.quarterstaff',
		defaultMessage: 'quarterstaff',
		description: 'Name of an item in Pathfinder: a long wooden staff held in both hands'
	},
	spear: {
		id: 'item.pf1e.spear',
		defaultMessage: 'spear',
		description: 'Name of an item in Pathfinder: a spear held in both hands, which can also be thrown'
	},
	blowgun: {
		id: 'item.pf1e.blowgun',
		defaultMessage: 'blowgun',
		description: 'Name of an item in Pathfinder: a hollow tube that shoots small darts with a breath'
	},
	light_crossbow: {
		id: 'item.pf1e.light_crossbow',
		defaultMessage: 'light crossbow',
		description: 'Name of an item in Pathfinder: a small crossbow drawn back with a lever'
	},
	heavy_crossbow: {
		id: 'item.pf1e.heavy_crossbow',
		defaultMessage: 'heavy crossbow',
		description: 'Name of an item in Pathfinder: a large crossbow drawn back with a small winch'
	},
	dart: {
		id: 'item.pf1e.dart',
		defaultMessage: 'dart',
		description: 'Name of an item in Pathfinder: a small weighted spike thrown by hand'
	},
	javelin: {
		id: 'item.pf1e.javelin',
		defaultMessage: 'javelin',
		description: 'Name of an item in Pathfinder: a light spear made for throwing'
	},
	sling: {
		id: 'item.pf1e.sling',
		defaultMessage: 'sling',
		description: 'Name of an item in Pathfinder: a leather strap for hurling stones or lead bullets'
	},
	throwing_axe: {
		id: 'item.pf1e.throwing_axe',
		defaultMessage: 'throwing axe',
		description: 'Name of an item in Pathfinder: a small axe balanced for throwing'
	},
	light_hammer: {
		id: 'item.pf1e.light_hammer',
		defaultMessage: 'light hammer',
		description: 'Name of an item in Pathfinder: a small hammer for fighting or throwing'
	},
	handaxe: {
		id: 'item.pf1e.handaxe',
		defaultMessage: 'handaxe',
		description: 'Name of an item in Pathfinder: a small axe swung in one hand'
	},
	kukri: {
		id: 'item.pf1e.kukri',
		defaultMessage: 'kukri',
		description: 'Name of an item in Pathfinder: a heavy knife with an inward-curving blade'
	},
	light_pick: {
		id: 'item.pf1e.light_pick',
		defaultMessage: 'light pick',
		description: 'Name of an item in Pathfinder: a small war pick with a pointed head'
	},
	sap: {
		id: 'item.pf1e.sap',
		defaultMessage: 'sap',
		description: 'Name of an item in Pathfinder: a small leather bag filled with lead, for knocking people out'
	},
	starknife: {
		id: 'item.pf1e.starknife',
		defaultMessage: 'starknife',
		description: 'Name of an item in Pathfinder: a metal ring with four blades pointing outward like a star, swung or thrown'
	},
	short_sword: {
		id: 'item.pf1e.short_sword',
		defaultMessage: 'short sword',
		description: 'Name of an item in Pathfinder: a short, straight sword'
	},
	battleaxe: {
		id: 'item.pf1e.battleaxe',
		defaultMessage: 'battleaxe',
		description: 'Name of an item in Pathfinder: an axe with a broad blade made for battle'
	},
	flail: {
		id: 'item.pf1e.flail',
		defaultMessage: 'flail',
		description: 'Name of an item in Pathfinder: a spiked metal ball swung on a chain from a handle'
	},
	longsword: {
		id: 'item.pf1e.longsword',
		defaultMessage: 'longsword',
		description: 'Name of an item in Pathfinder: a straight, double-edged sword about three and a half feet long'
	},
	heavy_pick: {
		id: 'item.pf1e.heavy_pick',
		defaultMessage: 'heavy pick',
		description: 'Name of an item in Pathfinder: a large war pick with a long spike'
	},
	rapier: {
		id: 'item.pf1e.rapier',
		defaultMessage: 'rapier',
		description: 'Name of an item in Pathfinder: a slender sword for quick thrusts'
	},
	scimitar: {
		id: 'item.pf1e.scimitar',
		defaultMessage: 'scimitar',
		description: 'Name of an item in Pathfinder: a sword with a curved blade'
	},
	trident: {
		id: 'item.pf1e.trident',
		defaultMessage: 'trident',
		description: 'Name of an item in Pathfinder: a spear with three prongs'
	},
	warhammer: {
		id: 'item.pf1e.warhammer',
		defaultMessage: 'warhammer',
		description: 'Name of an item in Pathfinder: a hammer made for war, with a heavy metal head'
	},
	falchion: {
		id: 'item.pf1e.falchion',
		defaultMessage: 'falchion',
		description: 'Name of an item in Pathfinder: a heavy, curved sword held in both hands'
	},
	glaive: {
		id: 'item.pf1e.glaive',
		defaultMessage: 'glaive',
		description: 'Name of an item in Pathfinder: a blade on the end of a long pole'
	},
	greataxe: {
		id: 'item.pf1e.greataxe',
		defaultMessage: 'greataxe',
		description: 'Name of an item in Pathfinder: a huge axe held in both hands'
	},
	greatclub: {
		id: 'item.pf1e.greatclub',
		defaultMessage: 'greatclub',
		description: 'Name of an item in Pathfinder: a large, heavy club held in both hands'
	},
	heavy_flail: {
		id: 'item.pf1e.heavy_flail',
		defaultMessage: 'heavy flail',
		description: 'Name of an item in Pathfinder: a large flail held in both hands'
	},
	greatsword: {
		id: 'item.pf1e.greatsword',
		defaultMessage: 'greatsword',
		description: 'Name of an item in Pathfinder: a huge sword held in both hands'
	},
	guisarme: {
		id: 'item.pf1e.guisarme',
		defaultMessage: 'guisarme',
		description: 'Name of an item in Pathfinder: a polearm whose curved blade has a hook for pulling foes down'
	},
	halberd: {
		id: 'item.pf1e.halberd',
		defaultMessage: 'halberd',
		description: 'Name of an item in Pathfinder: a long pole topped with an axe blade and a spike'
	},
	lance: {
		id: 'item.pf1e.lance',
		defaultMessage: 'lance',
		description: 'Name of an item in Pathfinder: a long, heavy spear for charging on horseback'
	},
	ranseur: {
		id: 'item.pf1e.ranseur',
		defaultMessage: 'ranseur',
		description: 'Name of an item in Pathfinder: a polearm with a spearhead flanked by two side blades'
	},
	scythe: {
		id: 'item.pf1e.scythe',
		defaultMessage: 'scythe',
		description: 'Name of an item in Pathfinder: a farmer\'s long, curved blade on a pole for reaping grain, used as a weapon'
	},
	shortbow: {
		id: 'item.pf1e.shortbow',
		defaultMessage: 'shortbow',
		description: 'Name of an item in Pathfinder: a small bow'
	},
	composite_shortbow: {
		id: 'item.pf1e.composite_shortbow',
		defaultMessage: 'composite shortbow',
		description: 'Name of an item in Pathfinder: a small bow made of layered horn, wood and sinew'
	},
	longbow: {
		id: 'item.pf1e.longbow',
		defaultMessage: 'longbow',
		description: 'Name of an item in Pathfinder: a bow about as tall as its archer'
	},
	composite_longbow: {
		id: 'item.pf1e.composite_longbow',
		defaultMessage: 'composite longbow',
		description: 'Name of an item in Pathfinder: a tall bow made of layered horn, wood and sinew'
	},
	kama: {
		id: 'item.pf1e.kama',
		defaultMessage: 'kama',
		description: 'Name of an item in Pathfinder: a short sickle used by monks as a weapon'
	},
	nunchaku: {
		id: 'item.pf1e.nunchaku',
		defaultMessage: 'nunchaku',
		description: 'Name of an item in Pathfinder: two short wooden sticks joined by a chain or cord, used by monks'
	},
	sai: {
		id: 'item.pf1e.sai',
		defaultMessage: 'sai',
		description: 'Name of an item in Pathfinder: a blunt metal spike with two curved side prongs, used by monks'
	},
	siangham: {
		id: 'item.pf1e.siangham',
		defaultMessage: 'siangham',
		description: 'Name of an item in Pathfinder: a thin metal shaft sharpened to a point, used by monks'
	},
	bastard_sword: {
		id: 'item.pf1e.bastard_sword',
		defaultMessage: 'bastard sword',
		description: 'Name of an item in Pathfinder: a long, heavy sword for one hand or both'
	},
	dwarven_waraxe: {
		id: 'item.pf1e.dwarven_waraxe',
		defaultMessage: 'dwarven waraxe',
		description: 'Name of an item in Pathfinder: a heavy axe dwarves swing in one hand'
	},
	whip: {
		id: 'item.pf1e.whip',
		defaultMessage: 'whip',
		description: 'Name of an item in Pathfinder: a long leather lash'
	},
	orc_double_axe: {
		id: 'item.pf1e.orc_double_axe',
		defaultMessage: 'orc double axe',
		description: 'Name of an item in Pathfinder: a shaft with an axe head at each end, made by orcs'
	},
	spiked_chain: {
		id: 'item.pf1e.spiked_chain',
		defaultMessage: 'spiked chain',
		description: 'Name of an item in Pathfinder: a long chain covered in spikes, swung in both hands'
	},
	elven_curve_blade: {
		id: 'item.pf1e.elven_curve_blade',
		defaultMessage: 'elven curve blade',
		description: 'Name of an item in Pathfinder: a long, slender, curved sword made by elves'
	},
	dire_flail: {
		id: 'item.pf1e.dire_flail',
		defaultMessage: 'dire flail',
		description: 'Name of an item in Pathfinder: a shaft with a spiked ball on a chain at each end'
	},
	gnome_hooked_hammer: {
		id: 'item.pf1e.gnome_hooked_hammer',
		defaultMessage: 'gnome hooked hammer',
		description: 'Name of an item in Pathfinder: a shaft with a hammer head at one end and a curved pick at the other, made by gnomes'
	},
	two_bladed_sword: {
		id: 'item.pf1e.two_bladed_sword',
		defaultMessage: 'two-bladed sword',
		description: 'Name of an item in Pathfinder: a grip with a sword blade at each end'
	},
	dwarven_urgrosh: {
		id: 'item.pf1e.dwarven_urgrosh',
		defaultMessage: 'dwarven urgrosh',
		description: 'Name of an item in Pathfinder: a shaft with an axe head at one end and a spearhead at the other, made by dwarves'
	},
	bolas: {
		id: 'item.pf1e.bolas',
		defaultMessage: 'bolas',
		description: 'Name of an item in Pathfinder: weights joined by cords, thrown to tangle a foe\'s legs'
	},
	hand_crossbow: {
		id: 'item.pf1e.hand_crossbow',
		defaultMessage: 'hand crossbow',
		description: 'Name of an item in Pathfinder: a crossbow small enough to shoot with one hand'
	},
	light_repeating_crossbow: {
		id: 'item.pf1e.light_repeating_crossbow',
		defaultMessage: 'light repeating crossbow',
		description: 'Name of an item in Pathfinder: a light crossbow with a case of bolts that reloads it'
	},
	heavy_repeating_crossbow: {
		id: 'item.pf1e.heavy_repeating_crossbow',
		defaultMessage: 'heavy repeating crossbow',
		description: 'Name of an item in Pathfinder: a heavy crossbow with a case of bolts that reloads it'
	},
	net: {
		id: 'item.pf1e.net',
		defaultMessage: 'net',
		description: 'Name of an item in Pathfinder: a weighted net thrown to entangle a foe'
	},
	shuriken: {
		id: 'item.pf1e.shuriken',
		defaultMessage: 'shuriken',
		description: 'Name of an item in Pathfinder: a small, flat metal star with sharp points, thrown by hand'
	},
	halfling_sling_staff: {
		id: 'item.pf1e.halfling_sling_staff',
		defaultMessage: 'halfling sling staff',
		description: 'Name of an item in Pathfinder: a short staff with a sling at one end, made by halflings'
	},
	arrows: {
		id: 'item.pf1e.arrows',
		defaultMessage: 'arrows',
		description: 'Name of an item in Pathfinder: arrows for bows'
	},
	crossbow_bolts: {
		id: 'item.pf1e.crossbow_bolts',
		defaultMessage: 'crossbow bolts',
		description: 'Name of an item in Pathfinder: short, heavy bolts for crossbows'
	},
	repeating_crossbow_bolts: {
		id: 'item.pf1e.repeating_crossbow_bolts',
		defaultMessage: 'repeating crossbow bolts',
		description: 'Name of an item in Pathfinder: bolts in a case of five, for repeating crossbows'
	},
	blowgun_darts: {
		id: 'item.pf1e.blowgun_darts',
		defaultMessage: 'blowgun darts',
		description: 'Name of an item in Pathfinder: small, light darts shot from a blowgun'
	},
	sling_bullets: {
		id: 'item.pf1e.sling_bullets',
		defaultMessage: 'sling bullets',
		description: 'Name of an item in Pathfinder: small lead balls hurled from a sling'
	},
	padded_armor: {
		id: 'item.pf1e.padded_armor',
		defaultMessage: 'padded armor',
		description: 'Name of an item in Pathfinder: light armor of quilted layers of cloth'
	},
	leather_armor: {
		id: 'item.pf1e.leather_armor',
		defaultMessage: 'leather armor',
		description: 'Name of an item in Pathfinder: light armor of hardened leather'
	},
	studded_leather: {
		id: 'item.pf1e.studded_leather',
		defaultMessage: 'studded leather',
		description: 'Name of an item in Pathfinder: light armor of leather reinforced with metal rivets'
	},
	chain_shirt: {
		id: 'item.pf1e.chain_shirt',
		defaultMessage: 'chain shirt',
		description: 'Name of an item in Pathfinder: light armor, a shirt of interlocking metal rings'
	},
	hide_armor: {
		id: 'item.pf1e.hide_armor',
		defaultMessage: 'hide armor',
		description: 'Name of an item in Pathfinder: medium armor of thick animal hides and furs'
	},
	scale_mail: {
		id: 'item.pf1e.scale_mail',
		defaultMessage: 'scale mail',
		description: 'Name of an item in Pathfinder: medium armor of overlapping metal scales'
	},
	chainmail: {
		id: 'item.pf1e.chainmail',
		defaultMessage: 'chainmail',
		description: 'Name of an item in Pathfinder: medium armor of interlocking metal rings covering the body, arms and legs'
	},
	breastplate: {
		id: 'item.pf1e.breastplate',
		defaultMessage: 'breastplate',
		description: 'Name of an item in Pathfinder: medium armor, a metal plate covering the chest and back'
	},
	splint_mail: {
		id: 'item.pf1e.splint_mail',
		defaultMessage: 'splint mail',
		description: 'Name of an item in Pathfinder: heavy armor of narrow upright metal strips riveted to leather'
	},
	banded_mail: {
		id: 'item.pf1e.banded_mail',
		defaultMessage: 'banded mail',
		description: 'Name of an item in Pathfinder: heavy armor of overlapping horizontal metal bands'
	},
	half_plate: {
		id: 'item.pf1e.half_plate',
		defaultMessage: 'half-plate',
		description: 'Name of an item in Pathfinder: heavy armor of chainmail with metal plates over the vital areas'
	},
	full_plate: {
		id: 'item.pf1e.full_plate',
		defaultMessage: 'full plate',
		description: 'Name of an item in Pathfinder: heavy armor, a full suit of interlocking metal plates'
	},
	locked_gauntlet: {
		id: 'item.pf1e.locked_gauntlet',
		defaultMessage: 'locked gauntlet',
		description: 'Name of an item in Pathfinder: an armored glove that locks a weapon in its grip'
	},
	buckler: {
		id: 'item.pf1e.buckler',
		defaultMessage: 'buckler',
		description: 'Name of an item in Pathfinder: a small shield strapped to the forearm, leaving the hand free'
	},
	light_wooden_shield: {
		id: 'item.pf1e.light_wooden_shield',
		defaultMessage: 'light wooden shield',
		description: 'Name of an item in Pathfinder: a small wooden shield held in one hand'
	},
	light_steel_shield: {
		id: 'item.pf1e.light_steel_shield',
		defaultMessage: 'light steel shield',
		description: 'Name of an item in Pathfinder: a small steel shield held in one hand'
	},
	heavy_wooden_shield: {
		id: 'item.pf1e.heavy_wooden_shield',
		defaultMessage: 'heavy wooden shield',
		description: 'Name of an item in Pathfinder: a large wooden shield held in one hand'
	},
	heavy_steel_shield: {
		id: 'item.pf1e.heavy_steel_shield',
		defaultMessage: 'heavy steel shield',
		description: 'Name of an item in Pathfinder: a large steel shield held in one hand'
	},
	tower_shield: {
		id: 'item.pf1e.tower_shield',
		defaultMessage: 'tower shield',
		description: 'Name of an item in Pathfinder: a huge wooden shield nearly as tall as its bearer'
	},
	artisans_tools: {
		id: 'item.pf1e.artisans_tools',
		defaultMessage: 'artisan\'s tools',
		description: 'Name of an item in Pathfinder: the tools of one craft, such as smithing or woodworking'
	},
	climbers_kit: {
		id: 'item.pf1e.climbers_kit',
		defaultMessage: 'climber\'s kit',
		description: 'Name of an item in Pathfinder: pitons, boot tips, gloves and a harness that help with climbing'
	},
	disguise_kit: {
		id: 'item.pf1e.disguise_kit',
		defaultMessage: 'disguise kit',
		description: 'Name of an item in Pathfinder: makeup, hair dye and small props for disguises'
	},
	healers_kit: {
		id: 'item.pf1e.healers_kit',
		defaultMessage: 'healer\'s kit',
		description: 'Name of an item in Pathfinder: herbs, salves and bandages for treating wounds and illness'
	},
	holly_and_mistletoe: {
		id: 'item.pf1e.holly_and_mistletoe',
		defaultMessage: 'holly and mistletoe',
		description: 'Name of an item in Pathfinder: sprigs of holly and mistletoe that druids hold to cast their spells'
	},
	wooden_holy_symbol: {
		id: 'item.pf1e.wooden_holy_symbol',
		defaultMessage: 'wooden holy symbol',
		description: 'Name of an item in Pathfinder: a carved wooden emblem of a god, worn around the neck'
	},
	silver_holy_symbol: {
		id: 'item.pf1e.silver_holy_symbol',
		defaultMessage: 'silver holy symbol',
		description: 'Name of an item in Pathfinder: a silver emblem of a god, worn around the neck'
	},
	thieves_tools: {
		id: 'item.pf1e.thieves_tools',
		defaultMessage: 'thieves\' tools',
		description: 'Name of an item in Pathfinder: picks and probes for opening locks and disarming traps'
	},
	bells: {
		id: 'item.pf1e.bells',
		defaultMessage: 'bells',
		description: 'Name of an item in Pathfinder: a set of small hand bells, a musical instrument'
	},
	chimes: {
		id: 'item.pf1e.chimes',
		defaultMessage: 'chimes',
		description: 'Name of an item in Pathfinder: tuned metal tubes struck to ring out notes, a musical instrument'
	},
	drum: {
		id: 'item.pf1e.drum',
		defaultMessage: 'drum',
		description: 'Name of an item in Pathfinder: a drum, a musical instrument'
	},
	fiddle: {
		id: 'item.pf1e.fiddle',
		defaultMessage: 'fiddle',
		description: 'Name of an item in Pathfinder: a fiddle or violin, a stringed musical instrument played with a bow'
	},
	harp: {
		id: 'item.pf1e.harp',
		defaultMessage: 'harp',
		description: 'Name of an item in Pathfinder: a harp, a stringed musical instrument'
	},
	lute: {
		id: 'item.pf1e.lute',
		defaultMessage: 'lute',
		description: 'Name of an item in Pathfinder: a lute, a stringed musical instrument with a round back'
	},
	mandolin: {
		id: 'item.pf1e.mandolin',
		defaultMessage: 'mandolin',
		description: 'Name of an item in Pathfinder: a mandolin, a small stringed musical instrument'
	},
	flute: {
		id: 'item.pf1e.flute',
		defaultMessage: 'flute',
		description: 'Name of an item in Pathfinder: a flute, a wind instrument'
	},
	pan_pipes: {
		id: 'item.pf1e.pan_pipes',
		defaultMessage: 'pan pipes',
		description: 'Name of an item in Pathfinder: pipes of different lengths bound together, a wind instrument'
	},
	recorder: {
		id: 'item.pf1e.recorder',
		defaultMessage: 'recorder',
		description: 'Name of an item in Pathfinder: a recorder, a simple wooden wind instrument with finger holes'
	},
	shawm: {
		id: 'item.pf1e.shawm',
		defaultMessage: 'shawm',
		description: 'Name of an item in Pathfinder: a shawm, a loud medieval wind instrument with a double reed'
	},
	trumpet: {
		id: 'item.pf1e.trumpet',
		defaultMessage: 'trumpet',
		description: 'Name of an item in Pathfinder: a trumpet, a brass wind instrument'
	},
	lasso: {
		id: 'item.pf1e.lasso',
		defaultMessage: 'lasso',
		description: 'Name of an item in Pathfinder: a rope with a sliding loop, thrown to catch a foe'
	},
	armored_coat: {
		id: 'item.pf1e.armored_coat',
		defaultMessage: 'armored coat',
		description: 'Name of an item in Pathfinder: medium armor, a leather coat with metal plates sewn into its lining'
	},
	agile_breastplate: {
		id: 'item.pf1e.agile_breastplate',
		defaultMessage: 'agile breastplate',
		description: 'Name of an item in Pathfinder: medium armor, a breastplate made to move freely in'
	},
	agile_half_plate: {
		id: 'item.pf1e.agile_half_plate',
		defaultMessage: 'agile half-plate',
		description: 'Name of an item in Pathfinder: heavy armor, half-plate made to move freely in'
	},
	quickdraw_light_wooden_shield: {
		id: 'item.pf1e.quickdraw_light_wooden_shield',
		defaultMessage: 'quickdraw light wooden shield',
		description: 'Name of an item in Pathfinder: a small wooden shield with straps for readying it quickly'
	},
	quickdraw_light_steel_shield: {
		id: 'item.pf1e.quickdraw_light_steel_shield',
		defaultMessage: 'quickdraw light steel shield',
		description: 'Name of an item in Pathfinder: a small steel shield with straps for readying it quickly'
	},
	kobold_pounder_tail: {
		id: 'item.pf1e.kobold_pounder_tail',
		defaultMessage: 'pounder tail attachment',
		description: 'Name of an item in Pathfinder: a squat metal ball a kobold straps to the end of its tail'
	},
	kobold_razored_tail: {
		id: 'item.pf1e.kobold_razored_tail',
		defaultMessage: 'razored tail attachment',
		description: 'Name of an item in Pathfinder: a sharp blade a kobold straps to the end of its tail'
	},
	kobold_sweeper_tail: {
		id: 'item.pf1e.kobold_sweeper_tail',
		defaultMessage: 'sweeper tail attachment',
		description: 'Name of an item in Pathfinder: a curved piece of metal a kobold straps to the end of its tail to knock foes over'
	},
	claw_blades: {
		id: 'item.pf1e.claw_blades',
		defaultMessage: 'claw blades',
		description: 'Name of an item in Pathfinder: thin blades a catfolk fits over its claws'
	},
	dwarven_boulder_helmet: {
		id: 'item.pf1e.dwarven_boulder_helmet',
		defaultMessage: 'dwarven boulder helmet',
		description: 'Name of an item in Pathfinder: a heavy helmet dwarves use to head-butt foes'
	},
	dwarven_double_waraxe: {
		id: 'item.pf1e.dwarven_double_waraxe',
		defaultMessage: 'dwarven double waraxe',
		description: 'Name of an item in Pathfinder: a shaft with a broad axe head at each end, made by dwarves'
	},
	dwarven_longaxe: {
		id: 'item.pf1e.dwarven_longaxe',
		defaultMessage: 'dwarven longaxe',
		description: 'Name of an item in Pathfinder: an axe on a long haft, made by dwarves'
	},
	dwarven_longhammer: {
		id: 'item.pf1e.dwarven_longhammer',
		defaultMessage: 'dwarven longhammer',
		description: 'Name of an item in Pathfinder: a heavy hammer on a long haft, made by dwarves'
	},
	sea_knife: {
		id: 'item.pf1e.sea_knife',
		defaultMessage: 'sea-knife',
		description: 'Name of an item in Pathfinder: a short blade on a long handle, for fighting while swimming'
	},
	jolting_dart: {
		id: 'item.pf1e.jolting_dart',
		defaultMessage: 'jolting dart',
		description: 'Name of an item in Pathfinder: a crystal dart that gives a jolt of electricity to whoever it hits'
	},
	snag_net: {
		id: 'item.pf1e.snag_net',
		defaultMessage: 'snag net',
		description: 'Name of an item in Pathfinder: a net covered in barbed loops, thrown to entangle and trip a foe'
	},
	heartstake_bolt: {
		id: 'item.pf1e.heartstake_bolt',
		defaultMessage: 'heartstake bolt',
		description: 'Name of an item in Pathfinder: a crossbow bolt of solid wood made for slaying vampires'
	}
});

export type Pf1eDefaultItemKey = keyof typeof PF1E_DEFAULT_ITEM_NAMES;

/**
 * Each default item's description, by the item's key, shown in the item editor, when choosing items, on a character's sheet, in the Inspect dialog and on the Audit tab
 */
export const PF1E_DEFAULT_ITEM_DESCRIPTIONS: Record<Pf1eDefaultItemKey, MessageDescriptor> = defineMessages({
	dagger: {
		id: 'itemDescription.pf1e.dagger',
		defaultMessage: 'A short blade for stabbing up close or throwing.',
		description: 'Description of the dagger, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	cestus: {
		id: 'itemDescription.pf1e.cestus',
		defaultMessage: 'A leather glove reinforced with metal plates for punching. The wearer counts as armed, and the fingers stay free to hold things.',
		description: 'Description of the cestus, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	sword_cane: {
		id: 'itemDescription.pf1e.sword_cane',
		defaultMessage: 'A thin blade hidden inside a walking stick. It is hard to spot as a weapon and quick to draw.',
		description: 'Description of the sword cane, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	wooden_armor: {
		id: 'itemDescription.pf1e.wooden_armor',
		defaultMessage: 'Leather armor with plates of fire-treated wood over vital spots. It guards better than plain leather, and the wood floats, so it doesn\'t hinder swimming.',
		description: 'Description of the wooden armor, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	quilted_cloth: {
		id: 'itemDescription.pf1e.quilted_cloth',
		defaultMessage: 'Light, padded armor with inner layers that snag arrows, bolts, darts and thrown daggers. Against other attacks it guards no better than padding.',
		description: 'Description of the quilted cloth, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	kobold_long_lash: {
		id: 'itemDescription.pf1e.kobold_long_lash',
		defaultMessage: 'A whip-like lash a kobold slips over the tip of its tail, letting its tail slap reach farther. Only kobolds trained to fight with their tails can use it.',
		description: 'Description of the long lash tail attachment, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	kobold_spiked_tail: {
		id: 'itemDescription.pf1e.kobold_spiked_tail',
		defaultMessage: 'A spiked weight a kobold slips over the tip of its tail, turning its tail slap into a piercing blow with deadly critical hits. Only kobolds trained to fight with their tails can use it.',
		description: 'Description of the spiked tail attachment, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	ratfolk_tailblade: {
		id: 'itemDescription.pf1e.ratfolk_tailblade',
		defaultMessage: 'A small knife strapped to the tip of a ratfolk\'s tail, so the ratfolk can slash at foes with its tail.',
		description: 'Description of the ratfolk tailblade, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	book_of_puzzles: {
		id: 'itemDescription.pf1e.book_of_puzzles',
		defaultMessage: 'A book of ten brainteasers that sharpen the mind. Each puzzle solved gives a second roll on one check to disarm a device, recall knowledge or read someone that day.',
		description: 'Description of the book of puzzles, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	book_of_war_prayers: {
		id: 'itemDescription.pf1e.book_of_war_prayers',
		defaultMessage: 'A small leather-bound book of prayers read aloud before battle. Hearing them steels allies against fear for the next day.',
		description: 'Description of the book of war prayers, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	footprints_cast: {
		id: 'itemDescription.pf1e.footprints_cast',
		defaultMessage: 'A quick-drying plaster for taking a copy of footprints. The cast can be studied later or somewhere else, safe from time and weather.',
		description: 'Description of the footprints cast, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	light_fire_ink: {
		id: 'itemDescription.pf1e.light_fire_ink',
		defaultMessage: 'An alchemical ink for secret messages. Once dry, it bursts into a small flame soon after light falls on it, so a note burns up after it is read.',
		description: 'Description of the light fire ink, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	tome_of_epics: {
		id: 'itemDescription.pf1e.tome_of_epics',
		defaultMessage: 'A heavy, illustrated book of heroic tales. An hour spent reading it helps with speeches, songs and the lore of heroic bloodlines for the next day.',
		description: 'Description of the tome of epics, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	gauntlet: {
		id: 'itemDescription.pf1e.gauntlet',
		defaultMessage: 'A metal glove that protects the hand and turns a punch into a lethal blow.',
		description: 'Description of the gauntlet, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	punching_dagger: {
		id: 'itemDescription.pf1e.punching_dagger',
		defaultMessage: 'A short, wide blade with a grip across the fist, driven forward like a punch. The weight behind the thrust makes for deadly critical hits.',
		description: 'Description of the punching dagger, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	spiked_gauntlet: {
		id: 'itemDescription.pf1e.spiked_gauntlet',
		defaultMessage: 'A metal glove covered in spikes, so a punch pierces as well as bruises.',
		description: 'Description of the spiked gauntlet, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	light_mace: {
		id: 'itemDescription.pf1e.light_mace',
		defaultMessage: 'A short club with a heavy metal head, easy to swing in one hand.',
		description: 'Description of the light mace, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	sickle: {
		id: 'itemDescription.pf1e.sickle',
		defaultMessage: 'A farming tool with a curved blade on a short handle. Its hooked edge can trip a foe.',
		description: 'Description of the sickle, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	club: {
		id: 'itemDescription.pf1e.club',
		defaultMessage: 'A sturdy piece of wood, easy to find and easy to use. It can be thrown in a pinch.',
		description: 'Description of the club, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	heavy_mace: {
		id: 'itemDescription.pf1e.heavy_mace',
		defaultMessage: 'A long club with a heavy metal head that crushes armor and bone, still light enough to swing in one hand.',
		description: 'Description of the heavy mace, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	morningstar: {
		id: 'itemDescription.pf1e.morningstar',
		defaultMessage: 'A heavy club topped with a spiked metal ball, so each blow both crushes and pierces.',
		description: 'Description of the morningstar, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	shortspear: {
		id: 'itemDescription.pf1e.shortspear',
		defaultMessage: 'A spear about three feet long, light enough to wield in one hand or to throw.',
		description: 'Description of the shortspear, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	longspear: {
		id: 'itemDescription.pf1e.longspear',
		defaultMessage: 'A spear over eight feet long that strikes foes beyond arm\'s reach. Braced against a charge, it deals double damage.',
		description: 'Description of the longspear, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	quarterstaff: {
		id: 'itemDescription.pf1e.quarterstaff',
		defaultMessage: 'A simple wooden staff about five feet long. Either end can strike, so it can be fought with as two weapons.',
		description: 'Description of the quarterstaff, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	spear: {
		id: 'itemDescription.pf1e.spear',
		defaultMessage: 'A spear about five feet long, held in both hands or thrown. Braced against a charge, it deals double damage.',
		description: 'Description of the spear, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	blowgun: {
		id: 'itemDescription.pf1e.blowgun',
		defaultMessage: 'A long, hollow tube that shoots small darts with a breath. The darts do little harm alone, so they are often poisoned.',
		description: 'Description of the blowgun, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	light_crossbow: {
		id: 'itemDescription.pf1e.light_crossbow',
		defaultMessage: 'A crossbow drawn back with a lever and loaded with one bolt at a time. Anyone can use it without much training.',
		description: 'Description of the light crossbow, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	heavy_crossbow: {
		id: 'itemDescription.pf1e.heavy_crossbow',
		defaultMessage: 'A powerful crossbow drawn back with a small winch. It hits hard, but takes a while to load.',
		description: 'Description of the heavy crossbow, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	dart: {
		id: 'itemDescription.pf1e.dart',
		defaultMessage: 'A small, weighted spike thrown by hand.',
		description: 'Description of the dart, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	javelin: {
		id: 'itemDescription.pf1e.javelin',
		defaultMessage: 'A thin spear balanced for throwing. It is clumsy to fight with in hand.',
		description: 'Description of the javelin, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	sling: {
		id: 'itemDescription.pf1e.sling',
		defaultMessage: 'A leather strap that hurls stones or lead bullets with a whirl of the arm.',
		description: 'Description of the sling, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	throwing_axe: {
		id: 'itemDescription.pf1e.throwing_axe',
		defaultMessage: 'A small axe weighted to fly true when thrown.',
		description: 'Description of the throwing axe, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	light_hammer: {
		id: 'itemDescription.pf1e.light_hammer',
		defaultMessage: 'A small hammer, handy up close and balanced for throwing.',
		description: 'Description of the light hammer, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	handaxe: {
		id: 'itemDescription.pf1e.handaxe',
		defaultMessage: 'A small axe light enough to swing in one hand, as useful for chopping wood as for fighting.',
		description: 'Description of the handaxe, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	kukri: {
		id: 'itemDescription.pf1e.kukri',
		defaultMessage: 'A heavy knife whose inward-curving blade bites deep, landing critical hits often.',
		description: 'Description of the kukri, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	light_pick: {
		id: 'itemDescription.pf1e.light_pick',
		defaultMessage: 'A small war pick whose pointed head punches through armor, dealing deadly critical hits.',
		description: 'Description of the light pick, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	sap: {
		id: 'itemDescription.pf1e.sap',
		defaultMessage: 'A small leather bag filled with lead. It knocks foes out rather than killing them.',
		description: 'Description of the sap, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	starknife: {
		id: 'itemDescription.pf1e.starknife',
		defaultMessage: 'A metal ring with four tapered blades pointing outward like a star. It can be swung up close or thrown.',
		description: 'Description of the starknife, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	short_sword: {
		id: 'itemDescription.pf1e.short_sword',
		defaultMessage: 'A short, straight blade, quick and easy to handle.',
		description: 'Description of the short sword, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	battleaxe: {
		id: 'itemDescription.pf1e.battleaxe',
		defaultMessage: 'A broad-bladed axe made for battle, heavy enough to split a shield.',
		description: 'Description of the battleaxe, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	flail: {
		id: 'itemDescription.pf1e.flail',
		defaultMessage: 'A spiked metal ball swung on a chain from a handle. The chain can wrap around a foe\'s legs or weapon to trip or disarm them.',
		description: 'Description of the flail, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	longsword: {
		id: 'itemDescription.pf1e.longsword',
		defaultMessage: 'A straight, double-edged sword about three and a half feet long, the favorite of many warriors.',
		description: 'Description of the longsword, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	heavy_pick: {
		id: 'itemDescription.pf1e.heavy_pick',
		defaultMessage: 'A war pick with a long spike that punches through armor, dealing terrible critical hits.',
		description: 'Description of the heavy pick, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	rapier: {
		id: 'itemDescription.pf1e.rapier',
		defaultMessage: 'A slender sword built for quick thrusts. A nimble fighter can wield it with finesse rather than strength.',
		description: 'Description of the rapier, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	scimitar: {
		id: 'itemDescription.pf1e.scimitar',
		defaultMessage: 'A curved sword whose long edge makes its cuts land critical hits often.',
		description: 'Description of the scimitar, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	trident: {
		id: 'itemDescription.pf1e.trident',
		defaultMessage: 'A three-pronged spear, thrust with one hand or thrown. Braced against a charge, it deals double damage.',
		description: 'Description of the trident, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	warhammer: {
		id: 'itemDescription.pf1e.warhammer',
		defaultMessage: 'A heavy hammer whose blows crush armor and deal deadly critical hits.',
		description: 'Description of the warhammer, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	falchion: {
		id: 'itemDescription.pf1e.falchion',
		defaultMessage: 'A heavy sword with a curved blade that widens toward the tip, swung in both hands. Its cuts land critical hits often.',
		description: 'Description of the falchion, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	glaive: {
		id: 'itemDescription.pf1e.glaive',
		defaultMessage: 'A single-edged blade on a pole about seven feet long, which strikes foes beyond arm\'s reach.',
		description: 'Description of the glaive, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	greataxe: {
		id: 'itemDescription.pf1e.greataxe',
		defaultMessage: 'A massive axe swung in both hands, whose blows can cleave a foe in two.',
		description: 'Description of the greataxe, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	greatclub: {
		id: 'itemDescription.pf1e.greatclub',
		defaultMessage: 'A great length of wood, often banded with iron, swung in both hands.',
		description: 'Description of the greatclub, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	heavy_flail: {
		id: 'itemDescription.pf1e.heavy_flail',
		defaultMessage: 'A large flail with spiked balls on chains, swung in both hands. It can trip or disarm a foe.',
		description: 'Description of the heavy flail, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	greatsword: {
		id: 'itemDescription.pf1e.greatsword',
		defaultMessage: 'A massive sword over five feet long, swung in both hands in great sweeping strokes.',
		description: 'Description of the greatsword, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	guisarme: {
		id: 'itemDescription.pf1e.guisarme',
		defaultMessage: 'A long pole topped with a curved blade and a hook for pulling foes off their feet. It strikes foes beyond arm\'s reach.',
		description: 'Description of the guisarme, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	halberd: {
		id: 'itemDescription.pf1e.halberd',
		defaultMessage: 'A long pole topped with an axe blade, a spike and a hook. It can trip foes, and braced against a charge it deals double damage.',
		description: 'Description of the halberd, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	lance: {
		id: 'itemDescription.pf1e.lance',
		defaultMessage: 'A long, heavy spear for charging on horseback, where it deals double damage. It strikes foes beyond arm\'s reach.',
		description: 'Description of the lance, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	ranseur: {
		id: 'itemDescription.pf1e.ranseur',
		defaultMessage: 'A pole with a spearhead flanked by two curved blades, good for disarming foes beyond arm\'s reach.',
		description: 'Description of the ranseur, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	scythe: {
		id: 'itemDescription.pf1e.scythe',
		defaultMessage: 'A long, curved blade on a pole, made for reaping grain. Its deep cuts deal terrible critical hits and can trip a foe.',
		description: 'Description of the scythe, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	shortbow: {
		id: 'itemDescription.pf1e.shortbow',
		defaultMessage: 'A small bow that shoots arrows, easy to use on horseback.',
		description: 'Description of the shortbow, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	composite_shortbow: {
		id: 'itemDescription.pf1e.composite_shortbow',
		defaultMessage: 'A shortbow of layered horn, wood and sinew. One made for a strong archer adds their strength to its damage.',
		description: 'Description of the composite shortbow, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	longbow: {
		id: 'itemDescription.pf1e.longbow',
		defaultMessage: 'A bow about as tall as its archer, which shoots arrows far. It can\'t be shot on horseback.',
		description: 'Description of the longbow, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	composite_longbow: {
		id: 'itemDescription.pf1e.composite_longbow',
		defaultMessage: 'A longbow of layered horn, wood and sinew. One made for a strong archer adds their strength to its damage.',
		description: 'Description of the composite longbow, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	kama: {
		id: 'itemDescription.pf1e.kama',
		defaultMessage: 'A short sickle with a hooked blade, used by monks. It can trip a foe.',
		description: 'Description of the kama, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	nunchaku: {
		id: 'itemDescription.pf1e.nunchaku',
		defaultMessage: 'Two short sticks joined by a chain or cord, whirled by monks to strike and to disarm.',
		description: 'Description of the nunchaku, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	sai: {
		id: 'itemDescription.pf1e.sai',
		defaultMessage: 'A blunt metal spike with two curved prongs that catch an enemy\'s blade. Monks use it to disarm foes and to strike.',
		description: 'Description of the sai, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	siangham: {
		id: 'itemDescription.pf1e.siangham',
		defaultMessage: 'A thin, arrow-like shaft of metal that monks use to stab.',
		description: 'Description of the siangham, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	bastard_sword: {
		id: 'itemDescription.pf1e.bastard_sword',
		defaultMessage: 'A long, heavy sword that takes special training to wield in one hand. In both hands, any trained warrior can use it.',
		description: 'Description of the bastard sword, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	dwarven_waraxe: {
		id: 'itemDescription.pf1e.dwarven_waraxe',
		defaultMessage: 'A heavy axe that takes special training to swing in one hand. In both hands, any trained warrior can use it.',
		description: 'Description of the dwarven waraxe, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	whip: {
		id: 'itemDescription.pf1e.whip',
		defaultMessage: 'A long leather lash that reaches foes up to 15 feet away to trip or disarm them. Its sting hurts but doesn\'t kill.',
		description: 'Description of the whip, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	orc_double_axe: {
		id: 'itemDescription.pf1e.orc_double_axe',
		defaultMessage: 'A cruel weapon with an axe head at each end of its shaft, so it can be fought with as two weapons.',
		description: 'Description of the orc double axe, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	spiked_chain: {
		id: 'itemDescription.pf1e.spiked_chain',
		defaultMessage: 'A chain about four feet long, covered in spikes and swung in both hands. It can trip or disarm a foe.',
		description: 'Description of the spiked chain, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	elven_curve_blade: {
		id: 'itemDescription.pf1e.elven_curve_blade',
		defaultMessage: 'A long, slightly curved elven sword held in both hands. A nimble fighter can wield it with finesse rather than strength.',
		description: 'Description of the elven curve blade, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	dire_flail: {
		id: 'itemDescription.pf1e.dire_flail',
		defaultMessage: 'A shaft with a spiked ball on a chain at each end, so it can be fought with as two weapons. It can trip or disarm a foe.',
		description: 'Description of the dire flail, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	gnome_hooked_hammer: {
		id: 'itemDescription.pf1e.gnome_hooked_hammer',
		defaultMessage: 'A gnome weapon with a hammer head at one end and a long, curved pick at the other, so it can be fought with as two weapons. It can trip a foe.',
		description: 'Description of the gnome hooked hammer, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	two_bladed_sword: {
		id: 'itemDescription.pf1e.two_bladed_sword',
		defaultMessage: 'A sword blade at each end of a central grip, so it can be fought with as two weapons.',
		description: 'Description of the two-bladed sword, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	dwarven_urgrosh: {
		id: 'itemDescription.pf1e.dwarven_urgrosh',
		defaultMessage: 'A dwarven weapon with an axe head at one end and a spearhead at the other, so it can be fought with as two weapons. The spear end can be braced against a charge.',
		description: 'Description of the dwarven urgrosh, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	bolas: {
		id: 'itemDescription.pf1e.bolas',
		defaultMessage: 'Two or three weights joined by cords, thrown to wrap around a foe\'s legs and trip them.',
		description: 'Description of the bolas, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	hand_crossbow: {
		id: 'itemDescription.pf1e.hand_crossbow',
		defaultMessage: 'A tiny crossbow, drawn back by hand and shot with one hand.',
		description: 'Description of the hand crossbow, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	light_repeating_crossbow: {
		id: 'itemDescription.pf1e.light_repeating_crossbow',
		defaultMessage: 'A light crossbow with a case holding five bolts, so it shoots again without reloading until the case is empty.',
		description: 'Description of the light repeating crossbow, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	heavy_repeating_crossbow: {
		id: 'itemDescription.pf1e.heavy_repeating_crossbow',
		defaultMessage: 'A heavy crossbow with a case holding five bolts, so it shoots again without reloading until the case is empty.',
		description: 'Description of the heavy repeating crossbow, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	net: {
		id: 'itemDescription.pf1e.net',
		defaultMessage: 'A weighted net thrown over a foe to entangle them, held by a trailing rope.',
		description: 'Description of the net, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	shuriken: {
		id: 'itemDescription.pf1e.shuriken',
		defaultMessage: 'A small, flat metal star with sharp points, thrown by hand. Monks train with it.',
		description: 'Description of the shuriken, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	halfling_sling_staff: {
		id: 'itemDescription.pf1e.halfling_sling_staff',
		defaultMessage: 'A short staff with a sling at one end, which hurls stones harder than a sling. It can also be swung as a club.',
		description: 'Description of the halfling sling staff, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	arrows: {
		id: 'itemDescription.pf1e.arrows',
		defaultMessage: 'Arrows for shortbows and longbows. An arrow that hits is destroyed, while one that misses may be found again.',
		description: 'Description of the arrows, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	crossbow_bolts: {
		id: 'itemDescription.pf1e.crossbow_bolts',
		defaultMessage: 'Short, heavy bolts for crossbows.',
		description: 'Description of the crossbow bolts, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	repeating_crossbow_bolts: {
		id: 'itemDescription.pf1e.repeating_crossbow_bolts',
		defaultMessage: 'Bolts in a case of five, which loads a repeating crossbow all at once.',
		description: 'Description of the repeating crossbow bolts, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	blowgun_darts: {
		id: 'itemDescription.pf1e.blowgun_darts',
		defaultMessage: 'Small, light darts for a blowgun, often coated with poison.',
		description: 'Description of the blowgun darts, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	sling_bullets: {
		id: 'itemDescription.pf1e.sling_bullets',
		defaultMessage: 'Small lead balls for slings and sling staffs. Stones can be slung too, but do less harm.',
		description: 'Description of the sling bullets, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	padded_armor: {
		id: 'itemDescription.pf1e.padded_armor',
		defaultMessage: 'Quilted layers of cloth and batting. It guards little, but barely hinders its wearer.',
		description: 'Description of the padded armor, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	leather_armor: {
		id: 'itemDescription.pf1e.leather_armor',
		defaultMessage: 'A breastplate and shoulder guards of leather hardened by boiling in oil, with softer, more flexible leather elsewhere.',
		description: 'Description of the leather armor, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	studded_leather: {
		id: 'itemDescription.pf1e.studded_leather',
		defaultMessage: 'Tough but flexible leather reinforced with close-set metal rivets.',
		description: 'Description of the studded leather, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	chain_shirt: {
		id: 'itemDescription.pf1e.chain_shirt',
		defaultMessage: 'A shirt of interlocking metal rings that covers the torso, worn over padding.',
		description: 'Description of the chain shirt, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	hide_armor: {
		id: 'itemDescription.pf1e.hide_armor',
		defaultMessage: 'Several layers of thick animal hide and fur. It is warm and sturdy, but stiff.',
		description: 'Description of the hide armor, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	scale_mail: {
		id: 'itemDescription.pf1e.scale_mail',
		defaultMessage: 'A coat and leggings of leather covered with overlapping pieces of metal, like the scales of a fish.',
		description: 'Description of the scale mail, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	chainmail: {
		id: 'itemDescription.pf1e.chainmail',
		defaultMessage: 'A suit of interlocking metal rings over quilted fabric, covering the arms and legs as well as the torso.',
		description: 'Description of the chainmail, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	breastplate: {
		id: 'itemDescription.pf1e.breastplate',
		defaultMessage: 'A fitted metal plate covering the front and back of the torso, worn with a skirt of hardened leather.',
		description: 'Description of the breastplate, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	splint_mail: {
		id: 'itemDescription.pf1e.splint_mail',
		defaultMessage: 'Narrow upright strips of metal riveted to a leather backing, worn over padding.',
		description: 'Description of the splint mail, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	banded_mail: {
		id: 'itemDescription.pf1e.banded_mail',
		defaultMessage: 'Overlapping horizontal bands of metal sewn to a backing of leather and chainmail.',
		description: 'Description of the banded mail, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	half_plate: {
		id: 'itemDescription.pf1e.half_plate',
		defaultMessage: 'Chainmail with shaped metal plates over the vital areas, worn with gauntlets and a helmet.',
		description: 'Description of the half-plate, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	full_plate: {
		id: 'itemDescription.pf1e.full_plate',
		defaultMessage: 'A suit of shaped, interlocking metal plates covering the whole body, fitted to its wearer. It guards best of all armor, but slows its wearer the most.',
		description: 'Description of the full plate, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	locked_gauntlet: {
		id: 'itemDescription.pf1e.locked_gauntlet',
		defaultMessage: 'An armored glove with straps and small chains that lock a weapon in its grip, so it is hard to knock away. It can punch as a gauntlet does.',
		description: 'Description of the locked gauntlet, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	buckler: {
		id: 'itemDescription.pf1e.buckler',
		defaultMessage: 'A small metal shield strapped to the forearm, which leaves the hand free to wield a weapon.',
		description: 'Description of the buckler, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	light_wooden_shield: {
		id: 'itemDescription.pf1e.light_wooden_shield',
		defaultMessage: 'A small wooden shield strapped to the forearm and gripped in one hand. That hand can still carry things, but not wield a weapon.',
		description: 'Description of the light wooden shield, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	light_steel_shield: {
		id: 'itemDescription.pf1e.light_steel_shield',
		defaultMessage: 'A small steel shield strapped to the forearm and gripped in one hand, sturdier than a wooden one.',
		description: 'Description of the light steel shield, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	heavy_wooden_shield: {
		id: 'itemDescription.pf1e.heavy_wooden_shield',
		defaultMessage: 'A large wooden shield strapped to the forearm and gripped in one hand, too big to hold anything else in that hand.',
		description: 'Description of the heavy wooden shield, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	heavy_steel_shield: {
		id: 'itemDescription.pf1e.heavy_steel_shield',
		defaultMessage: 'A large steel shield strapped to the forearm and gripped in one hand, too big to hold anything else in that hand.',
		description: 'Description of the heavy steel shield, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	tower_shield: {
		id: 'itemDescription.pf1e.tower_shield',
		defaultMessage: 'A massive wooden shield almost as tall as its bearer. It can be planted to hide behind completely, but it hinders its bearer\'s attacks.',
		description: 'Description of the tower shield, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	artisans_tools: {
		id: 'itemDescription.pf1e.artisans_tools',
		defaultMessage: 'The special tools of one craft, such as smithing or woodworking. Without them, crafting is much harder.',
		description: 'Description of the artisan\'s tools, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	climbers_kit: {
		id: 'itemDescription.pf1e.climbers_kit',
		defaultMessage: 'Special pitons, boot tips, gloves and a harness that make climbing easier.',
		description: 'Description of the climber\'s kit, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	disguise_kit: {
		id: 'itemDescription.pf1e.disguise_kit',
		defaultMessage: 'Makeup, hair coloring and small props that make a disguise more convincing. It is used up after ten disguises.',
		description: 'Description of the disguise kit, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	healers_kit: {
		id: 'itemDescription.pf1e.healers_kit',
		defaultMessage: 'Herbs, salves, bandages and splints that help treat wounds and illness. It is used up after ten uses.',
		description: 'Description of the healer\'s kit, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	holly_and_mistletoe: {
		id: 'itemDescription.pf1e.holly_and_mistletoe',
		defaultMessage: 'Sprigs of holly and mistletoe that druids and other priests of nature hold as the divine focus of their spells.',
		description: 'Description of the holly and mistletoe, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	wooden_holy_symbol: {
		id: 'itemDescription.pf1e.wooden_holy_symbol',
		defaultMessage: 'A carved wooden emblem of a god, worn on a cord. Clerics present it to cast their spells and channel their god\'s energy.',
		description: 'Description of the wooden holy symbol, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	silver_holy_symbol: {
		id: 'itemDescription.pf1e.silver_holy_symbol',
		defaultMessage: 'A silver emblem of a god, worn on a chain. Clerics present it to cast their spells and channel their god\'s energy.',
		description: 'Description of the silver holy symbol, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	thieves_tools: {
		id: 'itemDescription.pf1e.thieves_tools',
		defaultMessage: 'Picks, probes, a small mirror and pliers for opening locks and disarming traps. Without them, both are much harder.',
		description: 'Description of the thieves\' tools, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	bells: {
		id: 'itemDescription.pf1e.bells',
		defaultMessage: 'A set of small bells rung by shaking or striking them, for performing.',
		description: 'Description of the bells, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	chimes: {
		id: 'itemDescription.pf1e.chimes',
		defaultMessage: 'Tuned metal tubes hung from a frame and struck to ring out notes, for performing.',
		description: 'Description of the chimes, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	drum: {
		id: 'itemDescription.pf1e.drum',
		defaultMessage: 'A drum beaten with the hands or with sticks, for performing or keeping a marching beat.',
		description: 'Description of the drum, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	fiddle: {
		id: 'itemDescription.pf1e.fiddle',
		defaultMessage: 'A stringed instrument held under the chin and played with a bow, for performing.',
		description: 'Description of the fiddle, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	harp: {
		id: 'itemDescription.pf1e.harp',
		defaultMessage: 'A frame of strings plucked with the fingers, for performing.',
		description: 'Description of the harp, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	lute: {
		id: 'itemDescription.pf1e.lute',
		defaultMessage: 'A stringed instrument with a rounded back, plucked or strummed, for performing.',
		description: 'Description of the lute, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	mandolin: {
		id: 'itemDescription.pf1e.mandolin',
		defaultMessage: 'A small, bright-sounding stringed instrument plucked with a pick, for performing.',
		description: 'Description of the mandolin, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	flute: {
		id: 'itemDescription.pf1e.flute',
		defaultMessage: 'A wind instrument played by blowing across a hole near one end, for performing.',
		description: 'Description of the flute, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	pan_pipes: {
		id: 'itemDescription.pf1e.pan_pipes',
		defaultMessage: 'Reed or wooden pipes of different lengths bound side by side and blown across, for performing.',
		description: 'Description of the pan pipes, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	recorder: {
		id: 'itemDescription.pf1e.recorder',
		defaultMessage: 'A simple wooden pipe with finger holes, blown at one end, for performing.',
		description: 'Description of the recorder, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	shawm: {
		id: 'itemDescription.pf1e.shawm',
		defaultMessage: 'A loud, piercing wind instrument with a double reed, for performing outdoors.',
		description: 'Description of the shawm, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	trumpet: {
		id: 'itemDescription.pf1e.trumpet',
		defaultMessage: 'A brass horn whose notes carry far, for performing and for signals.',
		description: 'Description of the trumpet, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	lasso: {
		id: 'itemDescription.pf1e.lasso',
		defaultMessage: 'A rope with a sliding loop, thrown to snare and entangle a foe.',
		description: 'Description of the lasso, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	armored_coat: {
		id: 'itemDescription.pf1e.armored_coat',
		defaultMessage: 'A sturdy leather coat with metal plates sewn into its lining. It guards less than most medium armor, but goes on and off in moments.',
		description: 'Description of the armored coat, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	agile_breastplate: {
		id: 'itemDescription.pf1e.agile_breastplate',
		defaultMessage: 'A breastplate with a jointed plate over the belly, so its wearer can climb and jump more freely.',
		description: 'Description of the agile breastplate, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	agile_half_plate: {
		id: 'itemDescription.pf1e.agile_half_plate',
		defaultMessage: 'Half-plate with jointed plates that let its wearer climb and jump more freely.',
		description: 'Description of the agile half-plate, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	quickdraw_light_wooden_shield: {
		id: 'itemDescription.pf1e.quickdraw_light_wooden_shield',
		defaultMessage: 'A light wooden shield with special straps, so it can be readied as quickly as drawing a weapon.',
		description: 'Description of the quickdraw light wooden shield, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	quickdraw_light_steel_shield: {
		id: 'itemDescription.pf1e.quickdraw_light_steel_shield',
		defaultMessage: 'A light steel shield with special straps, so it can be readied as quickly as drawing a weapon.',
		description: 'Description of the quickdraw light steel shield, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	kobold_pounder_tail: {
		id: 'itemDescription.pf1e.kobold_pounder_tail',
		defaultMessage: 'A squat ball of dull metal a kobold slips over the tip of its tail, turning its tail slap into a crushing blow. Only kobolds trained to fight with their tails can use it.',
		description: 'Description of the pounder tail attachment, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	kobold_razored_tail: {
		id: 'itemDescription.pf1e.kobold_razored_tail',
		defaultMessage: 'A sharp blade a kobold slips over the tip of its tail, turning its tail slap into a slashing blow. Only kobolds trained to fight with their tails can use it.',
		description: 'Description of the razored tail attachment, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	kobold_sweeper_tail: {
		id: 'itemDescription.pf1e.kobold_sweeper_tail',
		defaultMessage: 'A sharply curved piece of metal a kobold slips over the tip of its tail to knock foes off their feet. Only kobolds trained to fight with their tails can use it.',
		description: 'Description of the sweeper tail attachment, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	claw_blades: {
		id: 'itemDescription.pf1e.claw_blades',
		defaultMessage: 'A set of thin blades that fit over a catfolk\'s claws, making them sharper and harder to stop. Only catfolk with claws can use them.',
		description: 'Description of the claw blades, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	dwarven_boulder_helmet: {
		id: 'itemDescription.pf1e.dwarven_boulder_helmet',
		defaultMessage: 'A heavy, reinforced helmet for head-butting foes and shoving them back.',
		description: 'Description of the dwarven boulder helmet, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	dwarven_double_waraxe: {
		id: 'itemDescription.pf1e.dwarven_double_waraxe',
		defaultMessage: 'A heavy shaft with a broad axe head at each end, so it can be fought with as two weapons.',
		description: 'Description of the dwarven double waraxe, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	dwarven_longaxe: {
		id: 'itemDescription.pf1e.dwarven_longaxe',
		defaultMessage: 'A dwarven axe on a long haft that strikes foes beyond arm\'s reach.',
		description: 'Description of the dwarven longaxe, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	dwarven_longhammer: {
		id: 'itemDescription.pf1e.dwarven_longhammer',
		defaultMessage: 'A heavy dwarven hammer on a long haft that strikes foes beyond arm\'s reach.',
		description: 'Description of the dwarven longhammer, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	sea_knife: {
		id: 'itemDescription.pf1e.sea_knife',
		defaultMessage: 'A short blade on a long handle, made for fighting while swimming. Its wielder takes a penalty to hit with it.',
		description: 'Description of the sea-knife, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	jolting_dart: {
		id: 'itemDescription.pf1e.jolting_dart',
		defaultMessage: 'A crystal dart grown by alchemy that builds up a charge in flight, shocking whoever it hits. It shatters once thrown.',
		description: 'Description of the jolting dart, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	snag_net: {
		id: 'itemDescription.pf1e.snag_net',
		defaultMessage: 'A short, wide net covered in barbed loops. It entangles like a net, and a tug on its rope can trip the foe caught in it.',
		description: 'Description of the snag net, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	},
	heartstake_bolt: {
		id: 'itemDescription.pf1e.heartstake_bolt',
		defaultMessage: 'A crossbow bolt of solid darkwood made to slay vampires, which can pierce one\'s heart.',
		description: 'Description of the heartstake bolt, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet, in the Inspect dialog and on the Audit tab'
	}
});

/**
 * Each default item's category and types, which the migrations in server/drizzle give it. A weapon in no
 * weapon group, such as a kobold's tail attachment, has no type
 */
export const PF1E_DEFAULT_ITEM_KINDS: Record<Pf1eDefaultItemKey, { category: Pf1eItemCategory; types: readonly Pf1eItemType[] }> = {
	dagger: {
		category: 'weapon',
		types: ['blades_light', 'thrown']
	},
	cestus: {
		category: 'weapon',
		types: ['close', 'monk']
	},
	sword_cane: {
		category: 'weapon',
		types: ['blades_light']
	},
	wooden_armor: {
		category: 'armor',
		types: ['light_armor']
	},
	quilted_cloth: {
		category: 'armor',
		types: ['light_armor']
	},
	kobold_long_lash: {
		category: 'weapon',
		types: []
	},
	kobold_spiked_tail: {
		category: 'weapon',
		types: []
	},
	ratfolk_tailblade: {
		category: 'weapon',
		types: ['blades_light']
	},
	book_of_puzzles: {
		category: 'gear',
		types: []
	},
	book_of_war_prayers: {
		category: 'gear',
		types: []
	},
	footprints_cast: {
		category: 'gear',
		types: []
	},
	light_fire_ink: {
		category: 'gear',
		types: []
	},
	tome_of_epics: {
		category: 'gear',
		types: []
	},
	gauntlet: {
		category: 'weapon',
		types: ['close']
	},
	punching_dagger: {
		category: 'weapon',
		types: ['close']
	},
	spiked_gauntlet: {
		category: 'weapon',
		types: ['close']
	},
	light_mace: {
		category: 'weapon',
		types: ['hammers']
	},
	sickle: {
		category: 'weapon',
		types: ['blades_light']
	},
	club: {
		category: 'weapon',
		types: ['hammers', 'thrown']
	},
	heavy_mace: {
		category: 'weapon',
		types: ['hammers']
	},
	morningstar: {
		category: 'weapon',
		types: ['flails']
	},
	shortspear: {
		category: 'weapon',
		types: ['spears', 'thrown']
	},
	longspear: {
		category: 'weapon',
		types: ['polearms', 'spears']
	},
	quarterstaff: {
		category: 'weapon',
		types: ['double', 'monk']
	},
	spear: {
		category: 'weapon',
		types: ['spears', 'thrown']
	},
	blowgun: {
		category: 'weapon',
		types: ['thrown']
	},
	light_crossbow: {
		category: 'weapon',
		types: ['crossbows']
	},
	heavy_crossbow: {
		category: 'weapon',
		types: ['crossbows']
	},
	dart: {
		category: 'weapon',
		types: ['thrown']
	},
	javelin: {
		category: 'weapon',
		types: ['spears', 'thrown']
	},
	sling: {
		category: 'weapon',
		types: ['thrown']
	},
	throwing_axe: {
		category: 'weapon',
		types: ['axes', 'thrown']
	},
	light_hammer: {
		category: 'weapon',
		types: ['hammers', 'thrown']
	},
	handaxe: {
		category: 'weapon',
		types: ['axes']
	},
	kukri: {
		category: 'weapon',
		types: ['blades_light']
	},
	light_pick: {
		category: 'weapon',
		types: ['axes']
	},
	sap: {
		category: 'weapon',
		types: ['close']
	},
	starknife: {
		category: 'weapon',
		types: ['blades_light', 'thrown']
	},
	short_sword: {
		category: 'weapon',
		types: ['blades_light']
	},
	battleaxe: {
		category: 'weapon',
		types: ['axes']
	},
	flail: {
		category: 'weapon',
		types: ['flails']
	},
	longsword: {
		category: 'weapon',
		types: ['blades_heavy']
	},
	heavy_pick: {
		category: 'weapon',
		types: ['axes']
	},
	rapier: {
		category: 'weapon',
		types: ['blades_light']
	},
	scimitar: {
		category: 'weapon',
		types: ['blades_heavy']
	},
	trident: {
		category: 'weapon',
		types: ['spears', 'thrown']
	},
	warhammer: {
		category: 'weapon',
		types: ['hammers']
	},
	falchion: {
		category: 'weapon',
		types: ['blades_heavy']
	},
	glaive: {
		category: 'weapon',
		types: ['polearms']
	},
	greataxe: {
		category: 'weapon',
		types: ['axes']
	},
	greatclub: {
		category: 'weapon',
		types: ['hammers']
	},
	heavy_flail: {
		category: 'weapon',
		types: ['flails']
	},
	greatsword: {
		category: 'weapon',
		types: ['blades_heavy']
	},
	guisarme: {
		category: 'weapon',
		types: ['polearms']
	},
	halberd: {
		category: 'weapon',
		types: ['polearms']
	},
	lance: {
		category: 'weapon',
		types: ['spears']
	},
	ranseur: {
		category: 'weapon',
		types: ['polearms']
	},
	scythe: {
		category: 'weapon',
		types: ['blades_heavy']
	},
	shortbow: {
		category: 'weapon',
		types: ['bows']
	},
	composite_shortbow: {
		category: 'weapon',
		types: ['bows']
	},
	longbow: {
		category: 'weapon',
		types: ['bows']
	},
	composite_longbow: {
		category: 'weapon',
		types: ['bows']
	},
	kama: {
		category: 'weapon',
		types: ['blades_light', 'monk']
	},
	nunchaku: {
		category: 'weapon',
		types: ['flails', 'monk']
	},
	sai: {
		category: 'weapon',
		types: ['monk']
	},
	siangham: {
		category: 'weapon',
		types: ['monk']
	},
	bastard_sword: {
		category: 'weapon',
		types: ['blades_heavy']
	},
	dwarven_waraxe: {
		category: 'weapon',
		types: ['axes']
	},
	whip: {
		category: 'weapon',
		types: ['flails']
	},
	orc_double_axe: {
		category: 'weapon',
		types: ['axes', 'double']
	},
	spiked_chain: {
		category: 'weapon',
		types: ['flails']
	},
	elven_curve_blade: {
		category: 'weapon',
		types: ['blades_heavy']
	},
	dire_flail: {
		category: 'weapon',
		types: ['double', 'flails']
	},
	gnome_hooked_hammer: {
		category: 'weapon',
		types: ['double', 'hammers']
	},
	two_bladed_sword: {
		category: 'weapon',
		types: ['blades_heavy', 'double']
	},
	dwarven_urgrosh: {
		category: 'weapon',
		types: ['axes', 'double', 'spears']
	},
	bolas: {
		category: 'weapon',
		types: ['thrown']
	},
	hand_crossbow: {
		category: 'weapon',
		types: ['crossbows']
	},
	light_repeating_crossbow: {
		category: 'weapon',
		types: ['crossbows']
	},
	heavy_repeating_crossbow: {
		category: 'weapon',
		types: ['crossbows']
	},
	net: {
		category: 'weapon',
		types: ['thrown']
	},
	shuriken: {
		category: 'weapon',
		types: ['monk', 'thrown']
	},
	halfling_sling_staff: {
		category: 'weapon',
		types: ['thrown']
	},
	arrows: {
		category: 'weapon',
		types: ['ammunition']
	},
	crossbow_bolts: {
		category: 'weapon',
		types: ['ammunition']
	},
	repeating_crossbow_bolts: {
		category: 'weapon',
		types: ['ammunition']
	},
	blowgun_darts: {
		category: 'weapon',
		types: ['ammunition']
	},
	sling_bullets: {
		category: 'weapon',
		types: ['ammunition']
	},
	padded_armor: {
		category: 'armor',
		types: ['light_armor']
	},
	leather_armor: {
		category: 'armor',
		types: ['light_armor']
	},
	studded_leather: {
		category: 'armor',
		types: ['light_armor']
	},
	chain_shirt: {
		category: 'armor',
		types: ['light_armor']
	},
	hide_armor: {
		category: 'armor',
		types: ['medium_armor']
	},
	scale_mail: {
		category: 'armor',
		types: ['medium_armor']
	},
	chainmail: {
		category: 'armor',
		types: ['medium_armor']
	},
	breastplate: {
		category: 'armor',
		types: ['medium_armor']
	},
	splint_mail: {
		category: 'armor',
		types: ['heavy_armor']
	},
	banded_mail: {
		category: 'armor',
		types: ['heavy_armor']
	},
	half_plate: {
		category: 'armor',
		types: ['heavy_armor']
	},
	full_plate: {
		category: 'armor',
		types: ['heavy_armor']
	},
	locked_gauntlet: {
		category: 'weapon',
		types: ['close']
	},
	buckler: {
		category: 'armor',
		types: ['shields']
	},
	light_wooden_shield: {
		category: 'armor',
		types: ['shields']
	},
	light_steel_shield: {
		category: 'armor',
		types: ['shields']
	},
	heavy_wooden_shield: {
		category: 'armor',
		types: ['shields']
	},
	heavy_steel_shield: {
		category: 'armor',
		types: ['shields']
	},
	tower_shield: {
		category: 'armor',
		types: ['shields']
	},
	artisans_tools: {
		category: 'gear',
		types: ['tool']
	},
	climbers_kit: {
		category: 'gear',
		types: ['tool']
	},
	disguise_kit: {
		category: 'gear',
		types: ['tool']
	},
	healers_kit: {
		category: 'gear',
		types: ['tool']
	},
	holly_and_mistletoe: {
		category: 'gear',
		types: []
	},
	wooden_holy_symbol: {
		category: 'gear',
		types: []
	},
	silver_holy_symbol: {
		category: 'gear',
		types: []
	},
	thieves_tools: {
		category: 'gear',
		types: ['tool']
	},
	bells: {
		category: 'gear',
		types: ['tool']
	},
	chimes: {
		category: 'gear',
		types: ['tool']
	},
	drum: {
		category: 'gear',
		types: ['tool']
	},
	fiddle: {
		category: 'gear',
		types: ['tool']
	},
	harp: {
		category: 'gear',
		types: ['tool']
	},
	lute: {
		category: 'gear',
		types: ['tool']
	},
	mandolin: {
		category: 'gear',
		types: ['tool']
	},
	flute: {
		category: 'gear',
		types: ['tool']
	},
	pan_pipes: {
		category: 'gear',
		types: ['tool']
	},
	recorder: {
		category: 'gear',
		types: ['tool']
	},
	shawm: {
		category: 'gear',
		types: ['tool']
	},
	trumpet: {
		category: 'gear',
		types: ['tool']
	},
	lasso: {
		category: 'weapon',
		types: ['thrown']
	},
	armored_coat: {
		category: 'armor',
		types: ['medium_armor']
	},
	agile_breastplate: {
		category: 'armor',
		types: ['medium_armor']
	},
	agile_half_plate: {
		category: 'armor',
		types: ['heavy_armor']
	},
	quickdraw_light_wooden_shield: {
		category: 'armor',
		types: ['shields']
	},
	quickdraw_light_steel_shield: {
		category: 'armor',
		types: ['shields']
	},
	kobold_pounder_tail: {
		category: 'weapon',
		types: []
	},
	kobold_razored_tail: {
		category: 'weapon',
		types: []
	},
	kobold_sweeper_tail: {
		category: 'weapon',
		types: []
	},
	claw_blades: {
		category: 'weapon',
		types: ['blades_light']
	},
	dwarven_boulder_helmet: {
		category: 'weapon',
		types: ['close']
	},
	dwarven_double_waraxe: {
		category: 'weapon',
		types: ['axes', 'double']
	},
	dwarven_longaxe: {
		category: 'weapon',
		types: ['axes']
	},
	dwarven_longhammer: {
		category: 'weapon',
		types: ['hammers']
	},
	sea_knife: {
		category: 'weapon',
		types: ['blades_light']
	},
	jolting_dart: {
		category: 'weapon',
		types: ['thrown']
	},
	snag_net: {
		category: 'weapon',
		types: ['thrown']
	},
	heartstake_bolt: {
		category: 'weapon',
		types: ['ammunition']
	}
};
