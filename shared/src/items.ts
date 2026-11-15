/**
 * Each ruleset's kinds of item and default items, which the migrations in server/drizzle add to the database
 */
import type { MessageDescriptor } from './localization.js';
import { PF1E_DEFAULT_ITEM_KINDS, PF1E_DEFAULT_ITEM_NAMES, PF1E_ITEM_CATEGORIES, PF1E_ITEM_CATEGORY_NAMES, PF1E_ITEM_TYPE_NAMES, PF1E_ITEM_TYPES } from './rulesets/pf1e/items.js';
import { SF1E_DEFAULT_ITEM_KINDS, SF1E_DEFAULT_ITEM_NAMES, SF1E_ITEM_CATEGORIES, SF1E_ITEM_CATEGORY_NAMES, SF1E_ITEM_TYPE_NAMES, SF1E_ITEM_TYPES } from './rulesets/sf1e/items.js';
import type { Ruleset } from './universes.js';

/**
 * A ruleset's kinds of item: broad categories, each holding types. Every item is in one category, and has
 * any number of that category's types, or none
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
 * An item's category and types
 */
export interface ItemKind
{
	/**
	 * One of the ruleset's item categories (ITEM_KINDS), e.g. weapon
	 */
	category: string;

	/**
	 * Some of the category's types (ITEM_KINDS), in the order the ruleset lists them, e.g. light blades
	 * and thrown for a dagger; none for an item of no type
	 */
	types: readonly string[];
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
 * Each default item's category and types, by ruleset and the item's key
 */
export const DEFAULT_ITEM_KINDS: Record<Ruleset, Record<string, ItemKind>> = {
	pf1e: PF1E_DEFAULT_ITEM_KINDS,
	sf1e: SF1E_DEFAULT_ITEM_KINDS
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
 * Whether a ruleset has an item category
 *
 * @param ruleset The ruleset
 * @param category The category's key
 * @return True when it does
 */
export function isItemCategory(ruleset: Ruleset, category: string): boolean
{
	return(ITEM_KINDS[ruleset].categories.includes(category));
}

/**
 * A category's item types, in the order the ruleset lists them
 *
 * @param ruleset The ruleset
 * @param category The category's key
 * @return The types' keys
 */
export function categoryItemTypes(ruleset: Ruleset, category: string): string[]
{
	return(Object.entries(ITEM_KINDS[ruleset].types)
		.filter(([, typeCategory]) => (typeCategory === category))
		.map(([type]) => type));
}

/**
 * Whether an item's category and types are the ruleset's: a category it has, and types of that category,
 * each once, in the order the ruleset lists them
 *
 * @param ruleset The ruleset
 * @param kind The item's category and types
 * @return True when they are
 */
export function isItemKind(ruleset: Ruleset, kind: ItemKind): boolean
{
	if (!isItemCategory(ruleset, kind.category))
	{
		return(false);
	}

	const types = categoryItemTypes(ruleset, kind.category);
	const positions = kind.types.map((type) => types.indexOf(type));

	return(positions.every((position, index) => ((position >= 0) && ((index === 0) || (position > positions[index - 1])))));
}

/**
 * Some item types in the order the ruleset lists them, each once
 *
 * @param ruleset The ruleset
 * @param types The types' keys
 * @return The types the ruleset has, sorted
 */
export function sortedItemTypes(ruleset: Ruleset, types: Iterable<string>): string[]
{
	const chosen = new Set(types);

	return(Object.keys(ITEM_KINDS[ruleset].types).filter((type) => chosen.has(type)));
}
