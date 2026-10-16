/**
 * Tiles: the only module that reads or writes the tiles table
 */
import { and, eq, isNull, or } from 'drizzle-orm';
import type { Ruleset } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { tiles } from './schema.js';

/**
 * A tile as the rest of the server sees it
 */
export interface TileRecord
{
	id: number;
	name: string;
	indoors: boolean;

	/**
	 * 0xRRGGBB
	 */
	color: number;

	visionCost: number;
	movementCost: number;
}

/**
 * What a new tile needs
 */
export type NewTile = Pick<typeof tiles.$inferInsert, 'ruleset' | 'universeId' | 'key' | 'name' | 'indoors' | 'color' | 'visionCost' | 'movementCost'>;

const recordColumns = {
	id: tiles.id,
	name: tiles.name,
	indoors: tiles.indoors,
	color: tiles.color,
	visionCost: tiles.visionCost,
	movementCost: tiles.movementCost
};

/**
 * The IDs of a ruleset's default tiles
 *
 * @param ruleset The ruleset
 * @param executor The database, or a transaction
 * @return Each default tile's ID, by its key (e.g. grass)
 */
export async function findDefaultTileIds(ruleset: Ruleset, executor: Executor = db): Promise<Map<string, number>>
{
	const rows = await executor
		.select({ id: tiles.id, key: tiles.key })
		.from(tiles)
		.where(and(eq(tiles.ruleset, ruleset), isNull(tiles.universeId)));

	return(new Map(rows.filter((row) => (row.key !== null)).map((row) => [row.key as string, row.id])));
}

/**
 * Every tile a universe can paint with: its ruleset's default tiles and its own
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param executor The database, or a transaction
 * @return The tiles, by ID
 */
export async function loadUniverseTiles(universeId: string, ruleset: Ruleset, executor: Executor = db): Promise<TileRecord[]>
{
	return(executor
		.select(recordColumns)
		.from(tiles)
		.where(and(eq(tiles.ruleset, ruleset), or(isNull(tiles.universeId), eq(tiles.universeId, universeId))))
		.orderBy(tiles.id));
}

/**
 * Adds a tile
 *
 * @param tile The tile
 * @param executor The database, or a transaction
 * @return The new tile's ID
 */
export async function createTile(tile: NewTile, executor: Executor = db): Promise<number>
{
	const [created] = await executor
		.insert(tiles)
		.values(tile)
		.returning({ id: tiles.id });

	return(created.id);
}
