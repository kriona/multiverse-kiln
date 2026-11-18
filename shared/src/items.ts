/**
 * Each ruleset's kinds of item and default items, which the migrations in server/drizzle add to the database
 */
import type { MessageDescriptor } from './localization.js';
import { PF1E_DEFAULT_ITEM_DESCRIPTIONS, PF1E_DEFAULT_ITEM_KINDS, PF1E_DEFAULT_ITEM_NAMES, PF1E_ITEM_CATEGORIES, PF1E_ITEM_CATEGORY_NAMES, PF1E_ITEM_TYPE_NAMES, PF1E_ITEM_TYPES } from './rulesets/pf1e/items.js';
import { SF1E_DEFAULT_ITEM_DESCRIPTIONS, SF1E_DEFAULT_ITEM_KINDS, SF1E_DEFAULT_ITEM_NAMES } from './rulesets/sf1e/defaultItems.js';
import { SF1E_ITEM_CATEGORIES, SF1E_ITEM_CATEGORY_NAMES, SF1E_ITEM_TYPE_NAMES, SF1E_ITEM_TYPES } from './rulesets/sf1e/items.js';
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
 * Each default item's description, by ruleset and the item's key
 */
export const DEFAULT_ITEM_DESCRIPTIONS: Record<Ruleset, Record<string, MessageDescriptor>> = {
	pf1e: PF1E_DEFAULT_ITEM_DESCRIPTIONS,
	sf1e: SF1E_DEFAULT_ITEM_DESCRIPTIONS
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

/**
 * The types each ruleset renamed or dropped (server/drizzle/0131_item_types.sql), by the old type's key:
 * the type that replaced it, or null for one dropped. Pathfinder's torch became light source, and
 * Starfinder's types, which were each one item, became its weapon categories, ammunition, and the gear
 * types the rulesets share
 */
const RENAMED_ITEM_TYPES: Record<Ruleset, Readonly<Record<string, string | null>>> = {
	pf1e: {
		torch: 'light_source'
	},
	sf1e: {
		survival_knife: 'basic_melee',
		tactical_baton: 'basic_melee',
		laser_pistol: 'small_arms',
		semi_auto_pistol: 'small_arms',
		laser_rifle: 'longarms',
		frag_grenade: 'grenades',
		battery: 'ammunition',
		small_arm_rounds: 'ammunition',
		second_skin: 'light_armor',
		comm_unit: null,
		flashlight: 'light_source'
	}
};

/**
 * An item's types as the ruleset has them now, from types an item may have had before some were renamed
 * or dropped (RENAMED_ITEM_TYPES), as universe exports and the editor's saves made before then hold them:
 * each old type becomes the type that replaced it, or is left out when it was dropped, and the types come
 * in the ruleset's order, each once. A type the ruleset never had is kept, after the others, for a save
 * to refuse
 *
 * @param ruleset The ruleset
 * @param types The item's types
 * @return Its types now
 */
export function currentItemTypes(ruleset: Ruleset, types: readonly string[]): string[]
{
	const renamed = RENAMED_ITEM_TYPES[ruleset];
	const current = types
		.map((type) => (Object.hasOwn(renamed, type) ? renamed[type] : type))
		.filter((type) => (type !== null));
	const unknown = current.filter((type) => !Object.hasOwn(ITEM_KINDS[ruleset].types, type));

	return([...sortedItemTypes(ruleset, current), ...new Set(unknown)]);
}

/**
 * The category and types of each type an item had, by ruleset, when items had one type each
 * (server/drizzle/0125_item_categories_and_types.sql), with the types they had then, which
 * currentItemTypes() brings up to date. A Starfinder type kept its key as its one type
 */
const SINGLE_ITEM_TYPES: Record<Ruleset, Record<string, ItemKind>> = {
	pf1e: {
		dagger: { category: 'weapon', types: ['blades_light', 'thrown'] },
		club: { category: 'weapon', types: ['hammers', 'thrown'] },
		quarterstaff: { category: 'weapon', types: ['double', 'monk'] },
		spear: { category: 'weapon', types: ['spears', 'thrown'] },
		short_sword: { category: 'weapon', types: ['blades_light'] },
		longsword: { category: 'weapon', types: ['blades_heavy'] },
		shortbow: { category: 'weapon', types: ['bows'] },
		longbow: { category: 'weapon', types: ['bows'] },
		light_crossbow: { category: 'weapon', types: ['crossbows'] },
		arrows: { category: 'weapon', types: [] },
		crossbow_bolts: { category: 'weapon', types: [] },
		cestus: { category: 'weapon', types: ['close', 'monk'] },
		sword_cane: { category: 'weapon', types: ['blades_light'] },
		kobold_long_lash: { category: 'weapon', types: [] },
		kobold_spiked_tail: { category: 'weapon', types: [] },
		ratfolk_tailblade: { category: 'weapon', types: ['blades_light'] },
		padded_armor: { category: 'armor', types: ['light_armor'] },
		leather_armor: { category: 'armor', types: ['light_armor'] },
		chain_shirt: { category: 'armor', types: ['light_armor'] },
		wooden_armor: { category: 'armor', types: ['light_armor'] },
		quilted_cloth: { category: 'armor', types: ['light_armor'] },
		light_shield: { category: 'armor', types: ['shields'] },
		heavy_shield: { category: 'armor', types: ['shields'] },
		rope: { category: 'gear', types: ['rope'] },
		torch: { category: 'gear', types: ['torch'] },
		other_gear: { category: 'gear', types: [] }
	},
	sf1e: {
		survival_knife: { category: 'weapon', types: ['survival_knife'] },
		tactical_baton: { category: 'weapon', types: ['tactical_baton'] },
		laser_pistol: { category: 'weapon', types: ['laser_pistol'] },
		semi_auto_pistol: { category: 'weapon', types: ['semi_auto_pistol'] },
		laser_rifle: { category: 'weapon', types: ['laser_rifle'] },
		frag_grenade: { category: 'weapon', types: ['frag_grenade'] },
		battery: { category: 'weapon', types: ['battery'] },
		small_arm_rounds: { category: 'weapon', types: ['small_arm_rounds'] },
		second_skin: { category: 'armor', types: ['second_skin'] },
		light_armor: { category: 'armor', types: ['light_armor'] },
		heavy_armor: { category: 'armor', types: ['heavy_armor'] },
		comm_unit: { category: 'gear', types: ['comm_unit'] },
		flashlight: { category: 'gear', types: ['flashlight'] },
		other_gear: { category: 'gear', types: [] }
	}
};

/**
 * The category and types of an item that had one type, as universe exports and the editor's saves
 * recorded before items had several (SINGLE_ITEM_TYPES) hold it, with its types as the ruleset has
 * them now (currentItemTypes())
 *
 * @param ruleset The ruleset
 * @param type The item's one type
 * @return Its category and types, or undefined for a type the ruleset never had
 */
export function singleItemTypeKind(ruleset: Ruleset, type: string): ItemKind | undefined
{
	if (Object.hasOwn(SINGLE_ITEM_TYPES[ruleset], type))
	{
		const kind = SINGLE_ITEM_TYPES[ruleset][type];

		return({
			category: kind.category,
			types: currentItemTypes(ruleset, kind.types)
		});
	}

	if (!Object.hasOwn(ITEM_KINDS[ruleset].types, type))
	{
		return(undefined);
	}

	return({
		category: ITEM_KINDS[ruleset].types[type],
		types: [type]
	});
}
