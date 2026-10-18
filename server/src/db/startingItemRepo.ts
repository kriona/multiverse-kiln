/**
 * Starting equipment: the only module that reads or writes the universe_starting_items table
 */
import { and, asc, eq } from 'drizzle-orm';
import { DEFAULT_STARTING_ITEMS, type ItemQuantity, type Ruleset } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { findDefaultItemIds } from './itemRepo.js';
import { universeStartingItems } from './schema.js';

/**
 * The items every character of a universe starts with
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The items and how many of each, by item ID
 */
export async function loadStartingItems(universeId: string, executor: Executor = db): Promise<ItemQuantity[]>
{
	return(executor
		.select({
			itemId: universeStartingItems.itemId,
			quantity: universeStartingItems.quantity
		})
		.from(universeStartingItems)
		.where(eq(universeStartingItems.universeId, universeId))
		.orderBy(asc(universeStartingItems.itemId)));
}

/**
 * Replaces the items every character of a universe starts with. Call it inside a transaction, so the
 * universe is never left with only some of them
 *
 * @param universeId The universe's ID
 * @param startingItems The items, each one the universe can use and listed once
 * @param executor A transaction
 */
export async function replaceStartingItems(universeId: string, startingItems: readonly ItemQuantity[], executor: Executor): Promise<void>
{
	await executor
		.delete(universeStartingItems)
		.where(eq(universeStartingItems.universeId, universeId));

	if (startingItems.length > 0)
	{
		await executor
			.insert(universeStartingItems)
			.values(startingItems.map(({ itemId, quantity }) => ({
				universeId,
				itemId,
				quantity
			})));
	}
}

/**
 * Gives a new universe its ruleset's default starting equipment (DEFAULT_STARTING_ITEMS)
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param executor A transaction
 */
export async function addDefaultStartingItems(universeId: string, ruleset: Ruleset, executor: Executor): Promise<void>
{
	const itemIds = await findDefaultItemIds(ruleset, executor);

	await replaceStartingItems(universeId, DEFAULT_STARTING_ITEMS[ruleset].map(({ key, quantity }) =>
	{
		const itemId = itemIds.get(key);

		if (itemId === undefined)
		{
			throw new Error(`The ${ruleset} default item "${key}" is missing`);
		}

		return({
			itemId,
			quantity
		});
	}), executor);
}

/**
 * Whether a universe's starting equipment holds an item
 *
 * @param universeId The universe's ID
 * @param itemId The item's ID
 * @param executor The database, or a transaction
 * @return True when it does
 */
export async function isStartingItem(universeId: string, itemId: number, executor: Executor = db): Promise<boolean>
{
	const rows = await executor
		.select({
			itemId: universeStartingItems.itemId
		})
		.from(universeStartingItems)
		.where(and(
			eq(universeStartingItems.universeId, universeId),
			eq(universeStartingItems.itemId, itemId)
		))
		.limit(1);

	return(rows.length > 0);
}
