/**
 * Starfinder 1E's equipment slots, and where each default item equips (see Equipment in
 * STRUCTURE-OVERVIEW.md). Worn magic items, armor upgrades and augmentations will add slots
 */
import { defineMessages, type MessageDescriptor } from '../../localization.js';
import { SF1E_DEFAULT_ITEMS } from './defaultItems.js';

/**
 * The places an item is worn, in the order the character sheet lists them; each is one slot
 */
export const SF1E_WORN_LOCATIONS = ['armor', 'clothing'] as const;

export type Sf1eWornLocation = typeof SF1E_WORN_LOCATIONS[number];

/**
 * The slots each worn place has
 */
export const SF1E_WORN_SLOTS: Record<Sf1eWornLocation, readonly string[]> = {
	armor: ['armor'],
	clothing: ['clothing']
};

/**
 * Each worn place's name: the name of its slot on a character's sheet, and where an item equips in the item
 * editor, Inspect, the Items tab and the Audit tab
 */
export const SF1E_WORN_LOCATION_NAMES: Record<Sf1eWornLocation, MessageDescriptor> = defineMessages({
	armor: {
		id: 'sf1e.slot.armor',
		defaultMessage: 'Armor',
		description: 'Equipment slot in Starfinder, where a suit of armor is worn. A row of the Equipped list on a character\'s sheet, and a choice in the item editor\'s "Equips to" field and in the Items tab\'s filter for it. Also shows where an item equips in the Inspect dialog, in its summary on the editor\'s Items tab and on the Audit tab. In the Discard and Give dialogs, it can appear in "This unequips it from {slots}."'
	},
	clothing: {
		id: 'sf1e.slot.clothing',
		defaultMessage: 'Clothing',
		description: 'Equipment slot in Starfinder, where everyday clothes or a space suit are worn. A row of the Equipped list on a character\'s sheet, and a choice in the item editor\'s "Equips to" field and in the Items tab\'s filter for it. Also shows where an item equips in the Inspect dialog, in its summary on the editor\'s Items tab and on the Audit tab. In the Discard and Give dialogs, it can appear in "This unequips it from {slots}."'
	}
});

/**
 * Where each default item equips: nowhere, one hand, two hands or a worn place (SF1E_WORN_LOCATIONS)
 */
export const SF1E_DEFAULT_ITEM_EQUIPS: Record<string, string> = Object.fromEntries(Object.entries(SF1E_DEFAULT_ITEMS)
	.map(([key, item]) => [key, item.equips]));
