/**
 * Items: the only module that reads or writes the items table
 */
import { and, count, eq, isNull, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { compareNumbers, itemCategory, sortRows, type EditorItem, type ItemListPayload, type ItemListQuery, type ItemSettings, type ItemSortColumn, type RowComparers, type Ruleset } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { items } from './schema.js';
import { inVersion, type UniverseVersion } from './universeVersions.js';

/**
 * What a new item needs
 */
export type NewItem = Pick<typeof items.$inferInsert, 'ruleset' | 'universeId' | 'draft' | 'key' | 'name' | 'type' | 'enabled'>;

/**
 * The settings of an item a universe added, which always has a name of its own
 */
export type CustomItemSettings = ItemSettings & { name: string };

/**
 * Whether an item ID names one of a ruleset's default items or one a universe added
 */
export type ItemKind = 'default' | 'custom';

/**
 * An item a universe can use, as findItem() finds it
 */
export interface FoundItem
{
	kind: ItemKind;

	/**
	 * Whether the universe has it enabled
	 */
	enabled: boolean;
}

/**
 * The IDs of a ruleset's default items
 *
 * @param ruleset The ruleset
 * @param executor The database, or a transaction
 * @return Each default item's ID, by its key (e.g. dagger)
 */
export async function findDefaultItemIds(ruleset: Ruleset, executor: Executor = db): Promise<Map<string, number>>
{
	const rows = await executor
		.select({
			id: items.id,
			key: items.key
		})
		.from(items)
		.where(and(
			eq(items.ruleset, ruleset),
			isNull(items.universeId)
		));

	return(new Map(rows
		.filter((row) => (row.key !== null))
		.map((row) => [row.key as string, row.id])));
}

/**
 * Every item a universe can use, as the editor lists them: with whether each item is custom or
 * edited, and a default item's key in place of a name it kept
 *
 * @param version The universe's live version or draft
 * @param ruleset The universe's ruleset
 * @param executor The database, or a transaction
 * @return The items, by ID
 */
export async function loadEditorItems(version: UniverseVersion, ruleset: Ruleset, executor: Executor = db): Promise<EditorItem[]>
{
	return((await loadNamedItems(version, ruleset, executor)).map(({ item }) => item));
}

/**
 * Every item a universe can use, as the editor lists them, each with a name in English: the
 * universe's name for it, or a default item's own
 *
 * @param version The universe's live version or draft
 * @param ruleset The universe's ruleset
 * @param executor The database, or a transaction
 * @return The items, by ID
 */
async function loadNamedItems(version: UniverseVersion, ruleset: Ruleset, executor: Executor): Promise<{ item: EditorItem; englishName: string }[]>
{
	const rows = await executor
		.select({
			id: items.id,
			universeId: items.universeId,
			overridesItemId: items.overridesItemId,
			key: items.key,
			name: items.name,
			type: items.type,
			enabled: items.enabled
		})
		.from(items)
		.where(and(
			eq(items.ruleset, ruleset),
			or(
				isNull(items.universeId),
				inVersion(items, version)
			)
		))
		.orderBy(items.id);
	const copies = new Map(rows
		.filter((row) => (row.overridesItemId !== null))
		.map((row) => [row.overridesItemId, row]));

	return(rows
		.filter((row) => (row.overridesItemId === null))
		.map((row) =>
		{
			const copy = ((row.universeId === null) ? copies.get(row.id) : undefined);
			const settings = (copy ?? row);
			const custom = (row.universeId !== null);
			const item: EditorItem = {
				id: row.id,
				key: (custom ? null : row.key),
				name: (custom ? row.name : (copy?.name ?? null)),
				type: settings.type,
				enabled: settings.enabled,
				custom,
				edited: (copy !== undefined)
			};

			return({
				item,
				englishName: (copy?.name ?? row.name ?? '')
			});
		}));
}

/**
 * Compares English item names, ignoring capitals and accents
 */
const nameCollator = new Intl.Collator('en', { sensitivity: 'base' });

/**
 * How the Items tab's columns compare items (ItemListQuery.sort)
 */
const itemComparers: RowComparers<{ item: EditorItem; englishName: string }, ItemSortColumn> = {
	name: (first, second) => nameCollator.compare(first.englishName, second.englishName),
	notes: (first, second) => compareNumbers(notesSortKey(first.item), notesSortKey(second.item))
};

/**
 * Where an item's notes put it when the Items tab sorts by them: those with none first, then disabled,
 * edited and custom ones
 *
 * @param item The item
 * @return The sort key, from 0 to 7
 */
function notesSortKey(item: EditorItem): number
{
	return((item.custom ? 4 : 0) + (item.edited ? 2 : 0) + (item.enabled ? 0 : 1));
}

/**
 * A page of a universe's items, as the Items tab lists them
 *
 * @param version The universe's live version or draft
 * @param ruleset The universe's ruleset
 * @param query The filters, the order, and which page
 * @param executor The database, or a transaction
 * @return The page, and how many items match in all
 */
export async function listEditorItems(version: UniverseVersion, ruleset: Ruleset, query: ItemListQuery, executor: Executor = db): Promise<ItemListPayload>
{
	const name = query.name?.toLowerCase();
	const ids = ((query.ids === undefined) ? undefined : new Set(query.ids));

	// A default item that kept its name matches by its English name, since the server doesn't have the translations
	const matching = (await loadNamedItems(version, ruleset, executor)).filter(({ item, englishName }) =>
	{
		return(
			((name === undefined) || englishName.toLowerCase().includes(name))
			&& ((query.enabled === undefined) || (item.enabled === query.enabled))
			&& ((query.custom === undefined) || (item.custom === query.custom))
			&& ((query.edited === undefined) || (item.edited === query.edited))
			&& ((query.category === undefined) || (itemCategory(ruleset, item.type) === query.category))
			&& ((query.type === undefined) || (item.type === query.type))
			&& ((ids === undefined) || ids.has(item.id))
		);
	});
	const offset = (query.offset ?? 0);
	const sorted = ((query.sort === undefined)
		? matching
		: sortRows(sortRows(matching, itemComparers, { column: 'name', direction: 'ascending' }), itemComparers, {
			column: query.sort,
			direction: (query.direction ?? 'ascending')
		}));

	return({
		items: sorted
			.slice(offset, offset + (query.limit ?? matching.length))
			.map(({ item }) => item),
		total: matching.length
	});
}

/**
 * Whether an item ID is one of a ruleset's default items or one of a universe's own items, and whether
 * the universe has it enabled
 *
 * @param version The universe's live version or draft
 * @param ruleset The universe's ruleset
 * @param itemId The item's ID
 * @param executor The database, or a transaction
 * @return The kind of item and whether it is enabled (a default item's from the universe's edited copy,
 * when it has one), or undefined when the universe can't use an item with that ID (an edited copy's own
 * ID included)
 */
export async function findItem(version: UniverseVersion, ruleset: Ruleset, itemId: number, executor: Executor = db): Promise<FoundItem | undefined>
{
	const copies = alias(items, 'copies');
	const [row] = await executor
		.select({
			universeId: items.universeId,
			enabled: items.enabled,
			copyEnabled: copies.enabled
		})
		.from(items)
		.leftJoin(copies, and(
			eq(copies.overridesItemId, items.id),
			inVersion(copies, version)
		))
		.where(and(
			eq(items.id, itemId),
			eq(items.ruleset, ruleset),
			isNull(items.overridesItemId),
			or(
				isNull(items.universeId),
				inVersion(items, version)
			)
		))
		.limit(1);

	if (!row)
	{
		return(undefined);
	}

	return({
		kind: ((row.universeId === null) ? 'default' : 'custom'),
		enabled: (row.copyEnabled ?? row.enabled)
	});
}

/**
 * How many items a universe has added, not counting its edited copies of default items
 *
 * @param version The universe's live version or draft
 * @param executor The database, or a transaction
 * @return The number of items
 */
export async function countCustomItems(version: UniverseVersion, executor: Executor = db): Promise<number>
{
	const [row] = await executor
		.select({
			total: count()
		})
		.from(items)
		.where(and(
			inVersion(items, version),
			isNull(items.overridesItemId)
		));

	return(row.total);
}

/**
 * Adds an item to a universe
 *
 * @param version The universe's live version or draft
 * @param ruleset The universe's ruleset
 * @param settings The item's settings
 * @param executor The database, or a transaction
 * @return The new item's ID
 */
export async function createCustomItem(version: UniverseVersion, ruleset: Ruleset, settings: CustomItemSettings, executor: Executor = db): Promise<number>
{
	return(createItem({
		ruleset,
		universeId: version.universeId,
		draft: version.draft,
		key: null,
		...settings
	}, executor));
}

/**
 * Changes one of a universe's own items
 *
 * @param version The universe's live version or draft
 * @param itemId The item's ID, from findItem() as custom
 * @param settings The item's new settings
 * @param executor The database, or a transaction
 */
export async function updateCustomItem(version: UniverseVersion, itemId: number, settings: CustomItemSettings, executor: Executor = db): Promise<void>
{
	await executor
		.update(items)
		.set(settings)
		.where(and(
			eq(items.id, itemId),
			inVersion(items, version)
		));
}

/**
 * Stores a universe's edited copy of a default item, replacing any copy it had
 *
 * @param version The universe's live version or draft
 * @param ruleset The universe's ruleset
 * @param defaultItemId The default item's ID, from findItem() as default
 * @param settings The copy's settings; a null name keeps the default item's
 * @param executor The database, or a transaction
 */
export async function saveEditedDefaultItem(version: UniverseVersion, ruleset: Ruleset, defaultItemId: number, settings: ItemSettings, executor: Executor = db): Promise<void>
{
	await executor
		.insert(items)
		.values({
			ruleset,
			universeId: version.universeId,
			draft: version.draft,
			overridesItemId: defaultItemId,
			...settings
		})
		.onConflictDoUpdate({
			target: [items.universeId, items.draft, items.overridesItemId],
			set: settings
		});
}

/**
 * Discards a universe's edited copy of a default item, so the universe sees the default again
 *
 * @param version The universe's live version or draft
 * @param defaultItemId The default item's ID
 * @param executor The database, or a transaction
 */
export async function restoreDefaultItem(version: UniverseVersion, defaultItemId: number, executor: Executor = db): Promise<void>
{
	await executor
		.delete(items)
		.where(and(
			inVersion(items, version),
			eq(items.overridesItemId, defaultItemId)
		));
}

/**
 * Deletes one of a universe's own items
 *
 * @param version The universe's live version or draft
 * @param itemId The item's ID, from findItem() as custom
 * @param executor The database, or a transaction
 */
export async function deleteCustomItem(version: UniverseVersion, itemId: number, executor: Executor = db): Promise<void>
{
	await executor
		.delete(items)
		.where(and(
			eq(items.id, itemId),
			inVersion(items, version)
		));
}

/**
 * Adds an item
 *
 * @param item The item
 * @param executor The database, or a transaction
 * @return The new item's ID
 */
export async function createItem(item: NewItem, executor: Executor = db): Promise<number>
{
	const [created] = await executor
		.insert(items)
		.values(item)
		.returning({ id: items.id });

	return(created.id);
}
