/**
 * Items: the only module that reads or writes the items table
 */
import { and, count, eq, isNull, or } from 'drizzle-orm';
import { itemCategory, type EditorItem, type ItemListPayload, type ItemListQuery, type ItemSettings, type Ruleset } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { items } from './schema.js';

/**
 * What a new item needs
 */
export type NewItem = Pick<typeof items.$inferInsert, 'ruleset' | 'universeId' | 'key' | 'name' | 'type' | 'enabled'>;

/**
 * The settings of an item a universe added, which always has a name of its own
 */
export type CustomItemSettings = ItemSettings & { name: string };

/**
 * Whether an item ID names one of a ruleset's default items or one a universe added
 */
export type ItemKind = 'default' | 'custom';

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
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param executor The database, or a transaction
 * @return The items, by ID
 */
export async function loadEditorItems(universeId: string, ruleset: Ruleset, executor: Executor = db): Promise<EditorItem[]>
{
	return((await loadNamedItems(universeId, ruleset, executor)).map(({ item }) => item));
}

/**
 * Every item a universe can use, as the editor lists them, each with a name in English: the
 * universe's name for it, or a default item's own
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param executor The database, or a transaction
 * @return The items, by ID
 */
async function loadNamedItems(universeId: string, ruleset: Ruleset, executor: Executor): Promise<{ item: EditorItem; englishName: string }[]>
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
				eq(items.universeId, universeId)
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
 * A page of a universe's items, as the Items tab lists them
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param query The filters, and which page
 * @param executor The database, or a transaction
 * @return The page, and how many items match in all
 */
export async function listEditorItems(universeId: string, ruleset: Ruleset, query: ItemListQuery, executor: Executor = db): Promise<ItemListPayload>
{
	const name = query.name?.toLowerCase();
	const ids = ((query.ids === undefined) ? undefined : new Set(query.ids));

	// A default item that kept its name matches by its English name, since the server doesn't have the translations
	const matching = (await loadNamedItems(universeId, ruleset, executor)).filter(({ item, englishName }) =>
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

	return({
		items: matching
			.slice(offset, offset + (query.limit ?? matching.length))
			.map(({ item }) => item),
		total: matching.length
	});
}

/**
 * Whether an item ID is one of a ruleset's default items or one of a universe's own items
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param itemId The item's ID
 * @param executor The database, or a transaction
 * @return The kind of item, or undefined when the universe can't use an item with that ID (an edited
 * copy's own ID included)
 */
export async function findItemKind(universeId: string, ruleset: Ruleset, itemId: number, executor: Executor = db): Promise<ItemKind | undefined>
{
	const [row] = await executor
		.select({ universeId: items.universeId })
		.from(items)
		.where(and(
			eq(items.id, itemId),
			eq(items.ruleset, ruleset),
			isNull(items.overridesItemId),
			or(
				isNull(items.universeId),
				eq(items.universeId, universeId)
			)
		))
		.limit(1);

	if (!row)
	{
		return(undefined);
	}

	return(((row.universeId === null) ? 'default' : 'custom'));
}

/**
 * How many items a universe has added, not counting its edited copies of default items
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The number of items
 */
export async function countCustomItems(universeId: string, executor: Executor = db): Promise<number>
{
	const [row] = await executor
		.select({ total: count() })
		.from(items)
		.where(and(
			eq(items.universeId, universeId),
			isNull(items.overridesItemId)
		));

	return(row.total);
}

/**
 * Adds an item to a universe
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param settings The item's settings
 * @param executor The database, or a transaction
 * @return The new item's ID
 */
export async function createCustomItem(universeId: string, ruleset: Ruleset, settings: CustomItemSettings, executor: Executor = db): Promise<number>
{
	return(createItem({
		ruleset,
		universeId,
		key: null,
		...settings
	}, executor));
}

/**
 * Changes one of a universe's own items
 *
 * @param universeId The universe's ID
 * @param itemId The item's ID, from findItemKind() as custom
 * @param settings The item's new settings
 * @param executor The database, or a transaction
 */
export async function updateCustomItem(universeId: string, itemId: number, settings: CustomItemSettings, executor: Executor = db): Promise<void>
{
	await executor
		.update(items)
		.set(settings)
		.where(and(
			eq(items.id, itemId),
			eq(items.universeId, universeId)
		));
}

/**
 * Stores a universe's edited copy of a default item, replacing any copy it had
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param defaultItemId The default item's ID, from findItemKind() as default
 * @param settings The copy's settings; a null name keeps the default item's
 * @param executor The database, or a transaction
 */
export async function saveEditedDefaultItem(universeId: string, ruleset: Ruleset, defaultItemId: number, settings: ItemSettings, executor: Executor = db): Promise<void>
{
	await executor
		.insert(items)
		.values({
			ruleset,
			universeId,
			overridesItemId: defaultItemId,
			...settings
		})
		.onConflictDoUpdate({
			target: [items.universeId, items.overridesItemId],
			set: settings
		});
}

/**
 * Discards a universe's edited copy of a default item, so the universe sees the default again
 *
 * @param universeId The universe's ID
 * @param defaultItemId The default item's ID
 * @param executor The database, or a transaction
 */
export async function restoreDefaultItem(universeId: string, defaultItemId: number, executor: Executor = db): Promise<void>
{
	await executor
		.delete(items)
		.where(and(
			eq(items.universeId, universeId),
			eq(items.overridesItemId, defaultItemId)
		));
}

/**
 * Deletes one of a universe's own items
 *
 * @param universeId The universe's ID
 * @param itemId The item's ID, from findItemKind() as custom
 * @param executor The database, or a transaction
 */
export async function deleteCustomItem(universeId: string, itemId: number, executor: Executor = db): Promise<void>
{
	await executor
		.delete(items)
		.where(and(
			eq(items.id, itemId),
			eq(items.universeId, universeId)
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
