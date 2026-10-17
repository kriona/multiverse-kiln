/**
 * Pathfinder 1E's kinds of item, and the default items a universe can edit, disable or add to
 *
 * Open Game Content from the Pathfinder Roleplaying Game Core Rulebook, used under the Open Game License
 * 1.0a (client/license.html)
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
		defaultMessage: 'Weapons',
		description: 'Kind of item in Pathfinder, a filter on the editor\'s Items tab: swords, bows, ammunition and the like'
	},
	armor: {
		id: 'pf1e.itemCategory.armor',
		defaultMessage: 'Armor',
		description: 'Kind of item in Pathfinder, a filter on the editor\'s Items tab: armor and shields'
	},
	gear: {
		id: 'pf1e.itemCategory.gear',
		defaultMessage: 'Gear',
		description: 'Kind of item in Pathfinder, a filter on the editor\'s Items tab: adventuring equipment such as rope and torches'
	}
});

/**
 * Each item type's category, by the type's key: every item is one of these
 */
export const PF1E_ITEM_TYPES = {
	dagger: 'weapon',
	club: 'weapon',
	quarterstaff: 'weapon',
	spear: 'weapon',
	short_sword: 'weapon',
	longsword: 'weapon',
	shortbow: 'weapon',
	longbow: 'weapon',
	light_crossbow: 'weapon',
	arrows: 'weapon',
	crossbow_bolts: 'weapon',
	padded_armor: 'armor',
	leather_armor: 'armor',
	chain_shirt: 'armor',
	light_shield: 'armor',
	heavy_shield: 'armor',
	rope: 'gear',
	torch: 'gear',
	other_gear: 'gear'
} as const satisfies Record<string, Pf1eItemCategory>;

export type Pf1eItemType = keyof typeof PF1E_ITEM_TYPES;

/**
 * Each item type's name
 */
export const PF1E_ITEM_TYPE_NAMES: Record<Pf1eItemType, MessageDescriptor> = defineMessages({
	dagger: {
		id: 'pf1e.itemType.dagger',
		defaultMessage: 'dagger',
		description: 'Type of item in Pathfinder, shown beside an item\'s name: a short blade for stabbing or throwing'
	},
	club: {
		id: 'pf1e.itemType.club',
		defaultMessage: 'club',
		description: 'Type of item in Pathfinder, shown beside an item\'s name: a wooden cudgel'
	},
	quarterstaff: {
		id: 'pf1e.itemType.quarterstaff',
		defaultMessage: 'quarterstaff',
		description: 'Type of item in Pathfinder, shown beside an item\'s name: a long wooden staff used as a weapon'
	},
	spear: {
		id: 'pf1e.itemType.spear',
		defaultMessage: 'spear',
		description: 'Type of item in Pathfinder, shown beside an item\'s name: a pole with a pointed head'
	},
	short_sword: {
		id: 'pf1e.itemType.short_sword',
		defaultMessage: 'short sword',
		description: 'Type of item in Pathfinder, shown beside an item\'s name: a light one-handed sword'
	},
	longsword: {
		id: 'pf1e.itemType.longsword',
		defaultMessage: 'longsword',
		description: 'Type of item in Pathfinder, shown beside an item\'s name: a straight one-handed sword'
	},
	shortbow: {
		id: 'pf1e.itemType.shortbow',
		defaultMessage: 'shortbow',
		description: 'Type of item in Pathfinder, shown beside an item\'s name: a small bow'
	},
	longbow: {
		id: 'pf1e.itemType.longbow',
		defaultMessage: 'longbow',
		description: 'Type of item in Pathfinder, shown beside an item\'s name: a bow about as tall as its archer'
	},
	light_crossbow: {
		id: 'pf1e.itemType.light_crossbow',
		defaultMessage: 'light crossbow',
		description: 'Type of item in Pathfinder, shown beside an item\'s name: a crossbow drawn back by hand'
	},
	arrows: {
		id: 'pf1e.itemType.arrows',
		defaultMessage: 'arrows',
		description: 'Type of item in Pathfinder, shown beside an item\'s name: ammunition for a bow'
	},
	crossbow_bolts: {
		id: 'pf1e.itemType.crossbow_bolts',
		defaultMessage: 'crossbow bolts',
		description: 'Type of item in Pathfinder, shown beside an item\'s name: ammunition for a crossbow'
	},
	padded_armor: {
		id: 'pf1e.itemType.padded_armor',
		defaultMessage: 'padded armor',
		description: 'Type of item in Pathfinder, shown beside an item\'s name: light armor of quilted cloth'
	},
	leather_armor: {
		id: 'pf1e.itemType.leather_armor',
		defaultMessage: 'leather armor',
		description: 'Type of item in Pathfinder, shown beside an item\'s name: light armor of stiffened leather'
	},
	chain_shirt: {
		id: 'pf1e.itemType.chain_shirt',
		defaultMessage: 'chain shirt',
		description: 'Type of item in Pathfinder, shown beside an item\'s name: light armor, a shirt of metal rings'
	},
	light_shield: {
		id: 'pf1e.itemType.light_shield',
		defaultMessage: 'light shield',
		description: 'Type of item in Pathfinder, shown beside an item\'s name: a small shield strapped to the forearm'
	},
	heavy_shield: {
		id: 'pf1e.itemType.heavy_shield',
		defaultMessage: 'heavy shield',
		description: 'Type of item in Pathfinder, shown beside an item\'s name: a large shield held with the whole arm'
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
	},
	other_gear: {
		id: 'pf1e.itemType.other_gear',
		defaultMessage: 'other gear',
		description: 'Type of item in Pathfinder, shown beside an item\'s name: equipment that is none of the other types'
	}
});

/**
 * Each default item's name, by the item's key. The database stores each name's English text
 */
export const PF1E_DEFAULT_ITEM_NAMES: Record<string, MessageDescriptor> = defineMessages({
	dagger: {
		id: 'item.pf1e.dagger',
		defaultMessage: 'Dagger',
		description: 'Name of an item in Pathfinder: a short blade for stabbing or throwing'
	}
});
