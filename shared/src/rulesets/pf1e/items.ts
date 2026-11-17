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
		description: 'Kind of item in Pathfinder, a filter on the editor\'s Items tab and a choice in the item editor: swords, bows, ammunition and the like'
	},
	armor: {
		id: 'pf1e.itemCategory.armor',
		defaultMessage: 'Armor',
		description: 'Kind of item in Pathfinder, a filter on the editor\'s Items tab and a choice in the item editor: armor and shields'
	},
	gear: {
		id: 'pf1e.itemCategory.gear',
		defaultMessage: 'Gear',
		description: 'Kind of item in Pathfinder, a filter on the editor\'s Items tab and a choice in the item editor: adventuring equipment such as rope and torches'
	}
});

/**
 * Each item type's category, by the type's key. An item has any number of types of its category, or none.
 * A weapon's types are the fighter's weapon groups it is in (the Core Rulebook's Weapon Training), and
 * armor's are the categories armor proficiency uses
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
	light_armor: 'armor',
	medium_armor: 'armor',
	heavy_armor: 'armor',
	shields: 'armor',
	rope: 'gear',
	torch: 'gear'
} as const satisfies Record<string, Pf1eItemCategory>;

export type Pf1eItemType = keyof typeof PF1E_ITEM_TYPES;

/**
 * Each item type's name
 */
export const PF1E_ITEM_TYPE_NAMES: Record<Pf1eItemType, MessageDescriptor> = defineMessages({
	axes: {
		id: 'pf1e.itemType.axes',
		defaultMessage: 'axes',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups, shown beside an item\'s name: battleaxes, handaxes, picks and the like. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	blades_heavy: {
		id: 'pf1e.itemType.blades_heavy',
		defaultMessage: 'heavy blades',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups, shown beside an item\'s name: longswords, scimitars, greatswords and the like. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	blades_light: {
		id: 'pf1e.itemType.blades_light',
		defaultMessage: 'light blades',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups, shown beside an item\'s name: daggers, short swords, rapiers and the like. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	bows: {
		id: 'pf1e.itemType.bows',
		defaultMessage: 'bows',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups, shown beside an item\'s name: shortbows and longbows. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	close: {
		id: 'pf1e.itemType.close',
		defaultMessage: 'close',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups, shown beside an item\'s name: weapons for fighting up close, such as gauntlets, a cestus or a shield used to bash. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	crossbows: {
		id: 'pf1e.itemType.crossbows',
		defaultMessage: 'crossbows',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups, shown beside an item\'s name: light, heavy and hand crossbows. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	double: {
		id: 'pf1e.itemType.double',
		defaultMessage: 'double',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups, shown beside an item\'s name: weapons with a striking end at each end, such as a quarterstaff. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	flails: {
		id: 'pf1e.itemType.flails',
		defaultMessage: 'flails',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups, shown beside an item\'s name: flails, chains and whips. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	hammers: {
		id: 'pf1e.itemType.hammers',
		defaultMessage: 'hammers',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups, shown beside an item\'s name: clubs, maces, warhammers and the like. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	monk: {
		id: 'pf1e.itemType.monk',
		defaultMessage: 'monk',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups, shown beside an item\'s name: the weapons monks train with, such as a kama or quarterstaff. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	natural: {
		id: 'pf1e.itemType.natural',
		defaultMessage: 'natural',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups, shown beside an item\'s name: unarmed strikes and natural weapons such as claws. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	polearms: {
		id: 'pf1e.itemType.polearms',
		defaultMessage: 'polearms',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups, shown beside an item\'s name: halberds, glaives and other blades on long poles. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	spears: {
		id: 'pf1e.itemType.spears',
		defaultMessage: 'spears',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups, shown beside an item\'s name: spears, javelins, lances and the like. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	thrown: {
		id: 'pf1e.itemType.thrown',
		defaultMessage: 'thrown',
		description: 'Type of weapon in Pathfinder, one of the fighter\'s weapon groups, shown beside an item\'s name: weapons made to be thrown, such as darts, or that can be, such as a dagger. Use the group\'s name in the official translation of the Core Rulebook where there is one'
	},
	light_armor: {
		id: 'pf1e.itemType.light_armor',
		defaultMessage: 'light armor',
		description: 'Type of armor in Pathfinder, shown beside an item\'s name: armor such as leather armor or a chain shirt, which barely slows its wearer'
	},
	medium_armor: {
		id: 'pf1e.itemType.medium_armor',
		defaultMessage: 'medium armor',
		description: 'Type of armor in Pathfinder, shown beside an item\'s name: armor such as hide or a breastplate, which slows its wearer'
	},
	heavy_armor: {
		id: 'pf1e.itemType.heavy_armor',
		defaultMessage: 'heavy armor',
		description: 'Type of armor in Pathfinder, shown beside an item\'s name: armor such as full plate, which slows its wearer the most'
	},
	shields: {
		id: 'pf1e.itemType.shields',
		defaultMessage: 'shields',
		description: 'Type of armor in Pathfinder, shown beside an item\'s name: shields of every size, from bucklers to tower shields'
	},
	rope: {
		id: 'pf1e.itemType.rope',
		defaultMessage: 'rope',
		description: 'Type of item in Pathfinder, shown beside an item\'s name: a length of rope'
	},
	torch: {
		id: 'pf1e.itemType.torch',
		defaultMessage: 'torch',
		description: 'Type of item in Pathfinder, shown beside an item\'s name: a burning stick that gives light'
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
	}
});

export type Pf1eDefaultItemKey = keyof typeof PF1E_DEFAULT_ITEM_NAMES;

/**
 * Each default item's description, by the item's key, shown in the item editor, when choosing items, on a character's sheet and on the Audit tab
 */
export const PF1E_DEFAULT_ITEM_DESCRIPTIONS: Record<Pf1eDefaultItemKey, MessageDescriptor> = defineMessages({
	dagger: {
		id: 'itemDescription.pf1e.dagger',
		defaultMessage: 'A short blade for stabbing up close or throwing.',
		description: 'Description of the dagger, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	cestus: {
		id: 'itemDescription.pf1e.cestus',
		defaultMessage: 'A leather glove reinforced with metal plates for punching. The wearer counts as armed, and the fingers stay free to hold things.',
		description: 'Description of the cestus, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	sword_cane: {
		id: 'itemDescription.pf1e.sword_cane',
		defaultMessage: 'A thin blade hidden inside a walking stick. It is hard to spot as a weapon and quick to draw.',
		description: 'Description of the sword cane, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	wooden_armor: {
		id: 'itemDescription.pf1e.wooden_armor',
		defaultMessage: 'Leather armor with plates of fire-treated wood over vital spots. It guards better than plain leather, and the wood floats, so it doesn\'t hinder swimming.',
		description: 'Description of the wooden armor, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	quilted_cloth: {
		id: 'itemDescription.pf1e.quilted_cloth',
		defaultMessage: 'Light, padded armor with inner layers that snag arrows, bolts, darts and thrown daggers. Against other attacks it guards no better than padding.',
		description: 'Description of the quilted cloth, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	kobold_long_lash: {
		id: 'itemDescription.pf1e.kobold_long_lash',
		defaultMessage: 'A whip-like lash a kobold slips over the tip of its tail, letting its tail slap reach farther. Only kobolds trained to fight with their tails can use it.',
		description: 'Description of the long lash tail attachment, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	kobold_spiked_tail: {
		id: 'itemDescription.pf1e.kobold_spiked_tail',
		defaultMessage: 'A spiked weight a kobold slips over the tip of its tail, turning its tail slap into a piercing blow with deadly critical hits. Only kobolds trained to fight with their tails can use it.',
		description: 'Description of the spiked tail attachment, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	ratfolk_tailblade: {
		id: 'itemDescription.pf1e.ratfolk_tailblade',
		defaultMessage: 'A small knife strapped to the tip of a ratfolk\'s tail, so the ratfolk can slash at foes with its tail.',
		description: 'Description of the ratfolk tailblade, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	book_of_puzzles: {
		id: 'itemDescription.pf1e.book_of_puzzles',
		defaultMessage: 'A book of ten brainteasers that sharpen the mind. Each puzzle solved gives a second roll on one check to disarm a device, recall knowledge or read someone that day.',
		description: 'Description of the book of puzzles, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	book_of_war_prayers: {
		id: 'itemDescription.pf1e.book_of_war_prayers',
		defaultMessage: 'A small leather-bound book of prayers read aloud before battle. Hearing them steels allies against fear for the next day.',
		description: 'Description of the book of war prayers, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	footprints_cast: {
		id: 'itemDescription.pf1e.footprints_cast',
		defaultMessage: 'A quick-drying plaster for taking a copy of footprints. The cast can be studied later or somewhere else, safe from time and weather.',
		description: 'Description of the footprints cast, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	light_fire_ink: {
		id: 'itemDescription.pf1e.light_fire_ink',
		defaultMessage: 'An alchemical ink for secret messages. Once dry, it bursts into a small flame soon after light falls on it, so a note burns up after it is read.',
		description: 'Description of the light fire ink, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	tome_of_epics: {
		id: 'itemDescription.pf1e.tome_of_epics',
		defaultMessage: 'A heavy, illustrated book of heroic tales. An hour spent reading it helps with speeches, songs and the lore of heroic bloodlines for the next day.',
		description: 'Description of the tome of epics, an item in Pathfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
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
	}
};
