/**
 * Starting equipment: the only module that reads or writes the universe_starting_items table
 */
import { and, asc, eq } from 'drizzle-orm';
import { DEFAULT_STARTING_ITEMS, type ItemQuantity, type Ruleset } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { findDefaultItemIds } from './itemRepo.js';
import { universeStartingItems } from './schema.js';
import { inVersion, liveVersion, type UniverseVersion } from './universeVersions.js';

/**
 * The items every character of a universe starts with
 *
 * @param version The universe's live version or draft
 * @param executor The database, or a transaction
 * @return The items and how many of each, by item ID
 */
export async function loadStartingItems(version: UniverseVersion, executor: Executor = db): Promise<ItemQuantity[]>
{
	return(executor
		.select({
			itemId: universeStartingItems.itemId,
			quantity: universeStartingItems.quantity
		})
		.from(universeStartingItems)
		.where(inVersion(universeStartingItems, version))
		.orderBy(asc(universeStartingItems.itemId)));
}

/**
 * Replaces the items every character of a universe starts with. Call it inside a transaction, so the
 * universe is never left with only some of them
 *
 * @param version The universe's live version or draft
 * @param startingItems The items, each one the universe can use and listed once
 * @param executor A transaction
 */
export async function replaceStartingItems(version: UniverseVersion, startingItems: readonly ItemQuantity[], executor: Executor): Promise<void>
{
	await executor
		.delete(universeStartingItems)
		.where(inVersion(universeStartingItems, version));

	if (startingItems.length > 0)
	{
		await executor
			.insert(universeStartingItems)
			.values(startingItems.map(({ itemId, quantity }) => ({
				universeId: version.universeId,
				draft: version.draft,
				itemId,
				quantity
			})));
	}
}

/**
 * Gives a new universe's live version its ruleset's default starting equipment (DEFAULT_STARTING_ITEMS)
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param executor A transaction
 */
export async function addDefaultStartingItems(universeId: string, ruleset: Ruleset, executor: Executor): Promise<void>
{
	const itemIds = await findDefaultItemIds(ruleset, executor);

	await replaceStartingItems(liveVersion(universeId), DEFAULT_STARTING_ITEMS[ruleset].map(({ key, quantity }) =>
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
 * @param version The universe's live version or draft
 * @param itemId The item's ID
 * @param executor The database, or a transaction
 * @return True when it does
 */
export async function isStartingItem(version: UniverseVersion, itemId: number, executor: Executor = db): Promise<boolean>
{
	const rows = await executor
		.select({
			itemId: universeStartingItems.itemId
		})
		.from(universeStartingItems)
		.where(and(
			inVersion(universeStartingItems, version),
			eq(universeStartingItems.itemId, itemId)
		))
		.limit(1);

	return(rows.length > 0);
}
