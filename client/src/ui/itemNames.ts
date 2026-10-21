import { DEFAULT_ITEM_NAMES, ITEM_KINDS, itemCategory, type EditorItem, type Ruleset } from '@multiverse-kiln/shared';
import armorIcon from 'virtual:icon/game-icons:breastplate';
import gearIcon from 'virtual:icon/game-icons:knapsack';
import weaponIcon from 'virtual:icon/game-icons:broadsword';

import { t } from '../localization';

/**
 * The icon of each item category, by the category's key; categories without one use gearIcon
 */
const CATEGORY_ICONS: Record<string, string> = {
	weapon: weaponIcon,
	armor: armorIcon,
	gear: gearIcon
};

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
 * The icon for an item, by its category, named for screen readers
 *
 * @param type The item's type
 * @param ruleset The universe's ruleset
 * @return The icon's element
 */
export function createItemIcon(type: string, ruleset: Ruleset): HTMLElement
{
	const category = itemCategory(ruleset, type);
	const icon = document.createElement('span');

	icon.className = 'item-icon';
	icon.setAttribute('role', 'img');
	icon.setAttribute('aria-label', ((category === undefined) ? itemTypeName(type, ruleset) : itemCategoryName(category, ruleset)));
	icon.innerHTML = (((category === undefined) ? undefined : CATEGORY_ICONS[category]) ?? gearIcon);

	return(icon);
}
