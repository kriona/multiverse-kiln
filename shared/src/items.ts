/**
 * Each ruleset's kinds of item and default items, which the migrations in server/drizzle add to the database
 */
import type { MessageDescriptor } from './localization.js';
import { PF1E_DEFAULT_ITEM_NAMES, PF1E_ITEM_CATEGORIES, PF1E_ITEM_CATEGORY_NAMES, PF1E_ITEM_TYPE_NAMES, PF1E_ITEM_TYPES } from './rulesets/pf1e/items.js';
import { SF1E_DEFAULT_ITEM_NAMES, SF1E_ITEM_CATEGORIES, SF1E_ITEM_CATEGORY_NAMES, SF1E_ITEM_TYPE_NAMES, SF1E_ITEM_TYPES } from './rulesets/sf1e/items.js';
import type { Ruleset } from './universes.js';

/**
 * A ruleset's kinds of item: broad categories, each holding types, and every item has one type
 */
export interface ItemKinds
{
	/**
	 * The categories' keys, in the order the editor lists them
	 */
	categories: readonly string[];

	categoryNames: Record<string, MessageDescriptor>;

	/**
	 * Each type's category, by the type's key
	 */
	types: Readonly<Record<string, string>>;

	typeNames: Record<string, MessageDescriptor>;
}

/**
 * Each ruleset's kinds of item
 */
export const ITEM_KINDS: Record<Ruleset, ItemKinds> = {
	pf1e: {
		categories: PF1E_ITEM_CATEGORIES,
		categoryNames: PF1E_ITEM_CATEGORY_NAMES,
		types: PF1E_ITEM_TYPES,
		typeNames: PF1E_ITEM_TYPE_NAMES
	},
	sf1e: {
		categories: SF1E_ITEM_CATEGORIES,
		categoryNames: SF1E_ITEM_CATEGORY_NAMES,
		types: SF1E_ITEM_TYPES,
		typeNames: SF1E_ITEM_TYPE_NAMES
	}
};

/**
 * Each default item's name, by ruleset and the item's key. The database stores each name's English text
 */
export const DEFAULT_ITEM_NAMES: Record<Ruleset, Record<string, MessageDescriptor>> = {
	pf1e: PF1E_DEFAULT_ITEM_NAMES,
	sf1e: SF1E_DEFAULT_ITEM_NAMES
};

/**
 * What every character of a new universe starts with, by ruleset: each default item's key, and how many
 */
export const DEFAULT_STARTING_ITEMS: Record<Ruleset, readonly { key: string; quantity: number }[]> = {
	pf1e: [
		{
			key: 'dagger',
			quantity: 1
		}
	],
	sf1e: [
		{
			key: 'survival_knife',
			quantity: 1
		}
	]
};

/**
 * Whether a ruleset has an item type
 *
 * @param ruleset The ruleset
 * @param type The type's key
 * @return True when it does
 */
export function isItemType(ruleset: Ruleset, type: string): boolean
{
	return(Object.hasOwn(ITEM_KINDS[ruleset].types, type));
}

/**
 * The category an item type is in
 *
 * @param ruleset The ruleset
 * @param type The type's key
 * @return The category's key, or undefined when the ruleset has no such type
 */
export function itemCategory(ruleset: Ruleset, type: string): string | undefined
{
	return((isItemType(ruleset, type) ? ITEM_KINDS[ruleset].types[type] : undefined));
}
