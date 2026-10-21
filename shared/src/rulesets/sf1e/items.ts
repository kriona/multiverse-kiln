/**
 * Starfinder 1E's kinds of item, and the default items a universe can edit, disable or add to
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
		defaultMessage: 'Weapons',
		description: 'Kind of item in Starfinder, a filter on the editor\'s Items tab: knives, guns, grenades, ammunition and the like'
	},
	armor: {
		id: 'sf1e.itemCategory.armor',
		defaultMessage: 'Armor',
		description: 'Kind of item in Starfinder, a filter on the editor\'s Items tab: armor suits'
	},
	gear: {
		id: 'sf1e.itemCategory.gear',
		defaultMessage: 'Gear',
		description: 'Kind of item in Starfinder, a filter on the editor\'s Items tab: equipment such as comm units and flashlights'
	}
});

/**
 * Each item type's category, by the type's key: every item is one of these
 */
export const SF1E_ITEM_TYPES = {
	survival_knife: 'weapon',
	tactical_baton: 'weapon',
	laser_pistol: 'weapon',
	semi_auto_pistol: 'weapon',
	laser_rifle: 'weapon',
	frag_grenade: 'weapon',
	battery: 'weapon',
	small_arm_rounds: 'weapon',
	second_skin: 'armor',
	light_armor: 'armor',
	heavy_armor: 'armor',
	comm_unit: 'gear',
	flashlight: 'gear',
	other_gear: 'gear'
} as const satisfies Record<string, Sf1eItemCategory>;

export type Sf1eItemType = keyof typeof SF1E_ITEM_TYPES;

/**
 * Each item type's name
 */
export const SF1E_ITEM_TYPE_NAMES: Record<Sf1eItemType, MessageDescriptor> = defineMessages({
	survival_knife: {
		id: 'sf1e.itemType.survival_knife',
		defaultMessage: 'survival knife',
		description: 'Type of item in Starfinder, shown beside an item\'s name: a sturdy knife for fighting and for use in the wild'
	},
	tactical_baton: {
		id: 'sf1e.itemType.tactical_baton',
		defaultMessage: 'tactical baton',
		description: 'Type of item in Starfinder, shown beside an item\'s name: a club carried by guards and police'
	},
	laser_pistol: {
		id: 'sf1e.itemType.laser_pistol',
		defaultMessage: 'laser pistol',
		description: 'Type of item in Starfinder, shown beside an item\'s name: a handgun that fires beams of light'
	},
	semi_auto_pistol: {
		id: 'sf1e.itemType.semi_auto_pistol',
		defaultMessage: 'semi-auto pistol',
		description: 'Type of item in Starfinder, shown beside an item\'s name: a handgun that fires bullets, one for each pull of the trigger'
	},
	laser_rifle: {
		id: 'sf1e.itemType.laser_rifle',
		defaultMessage: 'laser rifle',
		description: 'Type of item in Starfinder, shown beside an item\'s name: a long gun held in two hands that fires beams of light'
	},
	frag_grenade: {
		id: 'sf1e.itemType.frag_grenade',
		defaultMessage: 'frag grenade',
		description: 'Type of item in Starfinder, shown beside an item\'s name: a thrown bomb that bursts into shrapnel'
	},
	battery: {
		id: 'sf1e.itemType.battery',
		defaultMessage: 'battery',
		description: 'Type of item in Starfinder, shown beside an item\'s name: stored power, the ammunition of laser weapons'
	},
	small_arm_rounds: {
		id: 'sf1e.itemType.small_arm_rounds',
		defaultMessage: 'small arm rounds',
		description: 'Type of item in Starfinder, shown beside an item\'s name: bullets for pistols'
	},
	second_skin: {
		id: 'sf1e.itemType.second_skin',
		defaultMessage: 'second skin',
		description: 'Type of item in Starfinder, shown beside an item\'s name: light armor, a thin protective bodysuit'
	},
	light_armor: {
		id: 'sf1e.itemType.light_armor',
		defaultMessage: 'light armor',
		description: 'Type of item in Starfinder, shown beside an item\'s name: armor that is light enough to move freely in, other than a second skin'
	},
	heavy_armor: {
		id: 'sf1e.itemType.heavy_armor',
		defaultMessage: 'heavy armor',
		description: 'Type of item in Starfinder, shown beside an item\'s name: thick armor that slows its wearer'
	},
	comm_unit: {
		id: 'sf1e.itemType.comm_unit',
		defaultMessage: 'comm unit',
		description: 'Type of item in Starfinder, shown beside an item\'s name: a handheld device for calling and messaging, like a phone'
	},
	flashlight: {
		id: 'sf1e.itemType.flashlight',
		defaultMessage: 'flashlight',
		description: 'Type of item in Starfinder, shown beside an item\'s name: a handheld electric light'
	},
	other_gear: {
		id: 'sf1e.itemType.other_gear',
		defaultMessage: 'other gear',
		description: 'Type of item in Starfinder, shown beside an item\'s name: equipment that is none of the other types'
	}
});

/**
 * Each default item's name, by the item's key. The database stores each name's English text
 */
export const SF1E_DEFAULT_ITEM_NAMES: Record<string, MessageDescriptor> = defineMessages({
	survival_knife: {
		id: 'item.sf1e.survival_knife',
		defaultMessage: 'survival knife',
		description: 'Name of an item in Starfinder: a sturdy knife for fighting and for use in the wild'
	}
});
