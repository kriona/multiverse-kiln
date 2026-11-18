import { DEFAULT_ITEM_DESCRIPTIONS, DEFAULT_ITEM_NAMES, defineMessages, ITEM_KINDS, itemEquipsName, RULESETS, slotName, type EditorItem, type Ruleset } from '@multiverse-kiln/shared';
import armorIcon from 'virtual:icon/game-icons:breastplate';
import gearIcon from 'virtual:icon/game-icons:knapsack';
import weaponIcon from 'virtual:icon/game-icons:broadsword';

import { formatList, t } from '../localization';
import { describedBy } from './raceAndClassNames';

/**
 * The icon of each item category, by the category's key; categories without one use gearIcon
 */
const CATEGORY_ICONS: Record<string, string> = {
	weapon: weaponIcon,
	armor: armorIcon,
	gear: gearIcon
};

/**
 * The names of an item's settings that the item editor, the Inspect dialog and the Audit tab all show
 */
export const ITEM_SETTING_NAMES = defineMessages({
	category: {
		id: 'editor.items.category',
		defaultMessage: 'Kind',
		description: 'An item\'s broad kind, such as weapons or armor: the label of its field in the item editor, of the filter for it on the Items tab and in the dialog for choosing items, and of an item\'s kind in the Inspect dialog, which shows what an item is; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	types: {
		id: 'editor.item.types',
		defaultMessage: 'Types',
		description: 'Heading of the item editor\'s checkboxes for an item\'s types, such as light blades and thrown for a dagger, of which an item can have several or none, and the label of an item\'s types in the Inspect dialog, which shows what an item is; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	equips: {
		id: 'editor.item.equips',
		defaultMessage: 'Equips to',
		description: 'Label of the item editor\'s field for where an item equips: nowhere, one hand, two hands, or a place it is worn such as the head, and of where an item equips in the Inspect dialog, which shows what an item is; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	}
});

/**
 * An item's name as the player reads it: the universe's name for it, or a default item's name in the
 * player's language
 *
 * @param item The item
 * @param ruleset The universe's ruleset
 * @return The name
 */
export function itemName(item: Pick<EditorItem, 'key' | 'name'>, ruleset: Ruleset): string
{
	if (item.name !== null)
	{
		return(item.name);
	}

	const message = ((item.key === null) ? undefined : DEFAULT_ITEM_NAMES[ruleset][item.key]);

	return(((message === undefined) ? (item.key ?? '') : t(message)));
}

/**
 * An item's name as the player reads it, where its universe's ruleset may not be known, such as a toast
 * or a chat notice telling of a gift: the universe's name for it, or a default item's name in the
 * player's language, looked up in the ruleset given or else the first ruleset with that key
 *
 * @param item The item
 * @param ruleset The universe's ruleset, or undefined when it isn't known
 * @return The name
 */
export function optionItemName(item: Pick<EditorItem, 'key' | 'name'>, ruleset: Ruleset | undefined): string
{
	if ((ruleset !== undefined) || (item.name !== null) || (item.key === null))
	{
		return(itemName(item, (ruleset ?? 'pf1e')));
	}

	const key = item.key;
	const found = RULESETS.find((each) => Object.hasOwn(DEFAULT_ITEM_NAMES[each], key));

	return(itemName(item, (found ?? 'pf1e')));
}

/**
 * Where an item equips, in the player's language
 *
 * @param equips Where it equips (itemEquipsChoices())
 * @param ruleset The universe's ruleset
 * @return The name, or the key for a place the ruleset doesn't have
 */
export function itemEquipsText(equips: string, ruleset: Ruleset): string
{
	const message = itemEquipsName(ruleset, equips);

	return(((message === undefined) ? equips : t(message)));
}

/**
 * A slot's name, in the player's language
 *
 * @param slot The slot (equipmentSlots())
 * @param ruleset The universe's ruleset
 * @return The name, or the key for a slot the ruleset doesn't have
 */
export function slotText(slot: string, ruleset: Ruleset): string
{
	const message = slotName(ruleset, slot);

	return(((message === undefined) ? slot : t(message)));
}

/**
 * An item's description as the player reads it: the universe's description of it, or a default item's
 * in the player's language
 *
 * @param item The item
 * @param ruleset The universe's ruleset
 * @return The description, or an empty string for an item the universe added without one
 */
export function itemDescription(item: Pick<EditorItem, 'key' | 'description'>, ruleset: Ruleset): string
{
	return(describedBy(item, DEFAULT_ITEM_DESCRIPTIONS[ruleset]));
}

/**
 * An item type's name in the player's language
 *
 * @param type The type's key
 * @param ruleset The universe's ruleset
 * @return The name, or the key for a type the ruleset doesn't have
 */
export function itemTypeName(type: string, ruleset: Ruleset): string
{
	const message = ITEM_KINDS[ruleset].typeNames[type];

	return(((message === undefined) ? type : t(message)));
}

/**
 * An item category's name in the player's language
 *
 * @param category The category's key
 * @param ruleset The universe's ruleset
 * @return The name, or the key for a category the ruleset doesn't have
 */
export function itemCategoryName(category: string, ruleset: Ruleset): string
{
	const message = ITEM_KINDS[ruleset].categoryNames[category];

	return(((message === undefined) ? category : t(message)));
}

/**
 * An item's types' names in the player's language, as one list
 *
 * @param types The types' keys
 * @param ruleset The universe's ruleset
 * @return The list, or an empty string for an item of no type
 */
export function itemTypesText(types: readonly string[], ruleset: Ruleset): string
{
	return(formatList(types.map((type) => itemTypeName(type, ruleset))));
}

/**
 * The icon for an item, by its category, named for screen readers
 *
 * @param category The item's category
 * @param ruleset The universe's ruleset
 * @return The icon's element
 */
export function createItemIcon(category: string, ruleset: Ruleset): HTMLElement
{
	const icon = document.createElement('span');

	icon.className = 'item-icon';
	icon.setAttribute('role', 'img');
	icon.setAttribute('aria-label', itemCategoryName(category, ruleset));
	icon.innerHTML = (CATEGORY_ICONS[category] ?? gearIcon);

	return(icon);
}
