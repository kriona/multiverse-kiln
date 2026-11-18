/**
 * Starfinder 1E's kinds of item. The default items a universe can edit, disable or add to are in
 * defaultItems.ts
 *
 * Open Game Content from the Starfinder Roleplaying Game Core Rulebook, used under the Open Game License
 * 1.0a (client/license.html)
 */
import { defineMessages, type MessageDescriptor } from '../../localization.js';

/**
 * The broad kinds of item, which the Items tab filters by
 */
export const SF1E_ITEM_CATEGORIES = ['weapon', 'armor', 'gear'] as const;

export type Sf1eItemCategory = typeof SF1E_ITEM_CATEGORIES[number];

/**
 * Each item category's name
 */
export const SF1E_ITEM_CATEGORY_NAMES: Record<Sf1eItemCategory, MessageDescriptor> = defineMessages({
	weapon: {
		id: 'sf1e.itemCategory.weapon',
		defaultMessage: 'Weapon',
		description: 'Kind of item in Starfinder, a filter on the editor\'s Items tab and a choice in the item editor: knives, guns, grenades, ammunition and the like'
	},
	armor: {
		id: 'sf1e.itemCategory.armor',
		defaultMessage: 'Armor',
		description: 'Kind of item in Starfinder, a filter on the editor\'s Items tab and a choice in the item editor: armor suits'
	},
	gear: {
		id: 'sf1e.itemCategory.gear',
		defaultMessage: 'Gear',
		description: 'Kind of item in Starfinder, a filter on the editor\'s Items tab and a choice in the item editor: equipment such as comm units and flashlights'
	}
});

/**
 * Each item type's category, by the type's key. An item has any number of types of its category, or none.
 * A weapon's types are the Core Rulebook's weapon categories, which proficiencies use, and ammunition;
 * armor's are light and heavy armor
 */
export const SF1E_ITEM_TYPES = {
	basic_melee: 'weapon',
	advanced_melee: 'weapon',
	small_arms: 'weapon',
	longarms: 'weapon',
	heavy_weapons: 'weapon',
	sniper_weapons: 'weapon',
	grenades: 'weapon',
	special_weapons: 'weapon',
	ammunition: 'weapon',
	light_armor: 'armor',
	heavy_armor: 'armor',
	alchemical: 'gear',
	clothing: 'gear',
	drug: 'gear',
	food_and_drink: 'gear',
	light_source: 'gear',
	medicinal: 'gear',
	poison: 'gear',
	tool: 'gear'
} as const satisfies Record<string, Sf1eItemCategory>;

export type Sf1eItemType = keyof typeof SF1E_ITEM_TYPES;

/**
 * Each item type's name
 */
export const SF1E_ITEM_TYPE_NAMES: Record<Sf1eItemType, MessageDescriptor> = defineMessages({
	basic_melee: {
		id: 'sf1e.itemType.basic_melee',
		defaultMessage: 'basic melee',
		description: 'Type of weapon in Starfinder, one of the Core Rulebook\'s weapon categories, shown beside an item\'s name: simple weapons for fighting up close, such as knives, batons and spears. Use the category\'s name in the official translation of the Core Rulebook where there is one'
	},
	advanced_melee: {
		id: 'sf1e.itemType.advanced_melee',
		defaultMessage: 'advanced melee',
		description: 'Type of weapon in Starfinder, one of the Core Rulebook\'s weapon categories, shown beside an item\'s name: weapons for fighting up close that take training, such as longswords, plasma swords and pikes. Use the category\'s name in the official translation of the Core Rulebook where there is one'
	},
	small_arms: {
		id: 'sf1e.itemType.small_arms',
		defaultMessage: 'small arms',
		description: 'Type of weapon in Starfinder, one of the Core Rulebook\'s weapon categories, shown beside an item\'s name: guns held in one hand, such as laser and semi-auto pistols. Use the category\'s name in the official translation of the Core Rulebook where there is one'
	},
	longarms: {
		id: 'sf1e.itemType.longarms',
		defaultMessage: 'longarms',
		description: 'Type of weapon in Starfinder, one of the Core Rulebook\'s weapon categories, shown beside an item\'s name: guns held in two hands, such as rifles and scatterguns. Use the category\'s name in the official translation of the Core Rulebook where there is one'
	},
	heavy_weapons: {
		id: 'sf1e.itemType.heavy_weapons',
		defaultMessage: 'heavy weapons',
		description: 'Type of weapon in Starfinder, one of the Core Rulebook\'s weapon categories, shown beside an item\'s name: large, powerful guns such as machine guns, flamethrowers and cannons. Use the category\'s name in the official translation of the Core Rulebook where there is one'
	},
	sniper_weapons: {
		id: 'sf1e.itemType.sniper_weapons',
		defaultMessage: 'sniper weapons',
		description: 'Type of weapon in Starfinder, one of the Core Rulebook\'s weapon categories, shown beside an item\'s name: rifles for hitting targets very far away. Use the category\'s name in the official translation of the Core Rulebook where there is one'
	},
	grenades: {
		id: 'sf1e.itemType.grenades',
		defaultMessage: 'grenades',
		description: 'Type of weapon in Starfinder, one of the Core Rulebook\'s weapon categories, shown beside an item\'s name: small bombs thrown by hand. Use the category\'s name in the official translation of the Core Rulebook where there is one'
	},
	special_weapons: {
		id: 'sf1e.itemType.special_weapons',
		defaultMessage: 'special weapons',
		description: 'Type of weapon in Starfinder, one of the Core Rulebook\'s weapon categories, shown beside an item\'s name: unusual weapons that each take their own training, such as bows, nets and shuriken. Use the category\'s name in the official translation of the Core Rulebook where there is one'
	},
	ammunition: {
		id: 'sf1e.itemType.ammunition',
		defaultMessage: 'ammunition',
		description: 'Type of weapon in Starfinder, shown beside an item\'s name: what a weapon fires or uses up, such as batteries, rounds, arrows and missiles'
	},
	light_armor: {
		id: 'sf1e.itemType.light_armor',
		defaultMessage: 'light armor',
		description: 'Type of armor in Starfinder, shown beside an item\'s name: armor light enough to move freely in, such as a second skin or a flight suit'
	},
	heavy_armor: {
		id: 'sf1e.itemType.heavy_armor',
		defaultMessage: 'heavy armor',
		description: 'Type of armor in Starfinder, shown beside an item\'s name: thick armor that slows its wearer'
	},
	alchemical: {
		id: 'sf1e.itemType.alchemical',
		defaultMessage: 'alchemical',
		description: 'Type of item in Starfinder, shown beside an item\'s name: mixtures and substances made by chemistry or alchemy'
	},
	clothing: {
		id: 'sf1e.itemType.clothing',
		defaultMessage: 'clothing',
		description: 'Type of item in Starfinder, shown beside an item\'s name: clothes, such as everyday wear or a space suit'
	},
	drug: {
		id: 'sf1e.itemType.drug',
		defaultMessage: 'drug',
		description: 'Type of item in Starfinder, shown beside an item\'s name: a substance taken for its effect on the body or mind, such as a painkiller or a sedative'
	},
	food_and_drink: {
		id: 'sf1e.itemType.food_and_drink',
		defaultMessage: 'food and drink',
		description: 'Type of item in Starfinder, shown beside an item\'s name: meals, rations and drinks'
	},
	light_source: {
		id: 'sf1e.itemType.light_source',
		defaultMessage: 'light source',
		description: 'Type of item in Starfinder, shown beside an item\'s name: something that gives light, such as a flashlight or a lantern'
	},
	medicinal: {
		id: 'sf1e.itemType.medicinal',
		defaultMessage: 'medicinal',
		description: 'Type of item in Starfinder, shown beside an item\'s name: medicine and supplies for healing, such as a medpatch'
	},
	poison: {
		id: 'sf1e.itemType.poison',
		defaultMessage: 'poison',
		description: 'Type of item in Starfinder, shown beside an item\'s name: a substance that harms whoever takes it in'
	},
	tool: {
		id: 'sf1e.itemType.tool',
		defaultMessage: 'tool',
		description: 'Type of item in Starfinder, shown beside an item\'s name: kits and tools used for a skill, such as an engineering kit'
	}
});
