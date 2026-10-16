/**
 * Tiles: the only module that reads or writes the tiles table
 */
import { and, count, eq, isNull, or } from 'drizzle-orm';
import { IMPASSABLE_COST, type EditorTile, type Ruleset, type TileListPayload, type TileListQuery, type TileSettings } from '@multiverse-kiln/shared';

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

/**
 * Whether a tile ID names one of a ruleset's default tiles or one a universe added
 */
export type TileKind = 'default' | 'custom';

const settingsColumns = {
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
		.where(and(
			eq(tiles.ruleset, ruleset),
			isNull(tiles.universeId)
		));

	return(new Map(rows.filter((row) => (row.key !== null)).map((row) => [row.key as string, row.id])));
}

/**
 * Every tile a universe can paint with: its ruleset's default tiles and its own
 *
 * A default tile the universe has edited has the edited copy's settings, under the default tile's ID
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param executor The database, or a transaction
 * @return The tiles, by ID
 */
export async function loadUniverseTiles(universeId: string, ruleset: Ruleset, executor: Executor = db): Promise<TileRecord[]>
{
	const editorTiles = await loadEditorTiles(universeId, ruleset, executor);

	return(editorTiles.map(({ id, name, indoors, color, visionCost, movementCost }) => ({ id, name, indoors, color, visionCost, movementCost })));
}

/**
 * Every tile a universe can paint with, as the editor lists them: loadUniverseTiles() with whether
 * each tile is custom or edited
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param executor The database, or a transaction
 * @return The tiles, by ID
 */
export async function loadEditorTiles(universeId: string, ruleset: Ruleset, executor: Executor = db): Promise<EditorTile[]>
{
	const rows = await executor
		.select({
			id: tiles.id,
			universeId: tiles.universeId,
			overridesTileId: tiles.overridesTileId,
			...settingsColumns
		})
		.from(tiles)
		.where(and(
			eq(tiles.ruleset, ruleset),
			or(
				isNull(tiles.universeId),
				eq(tiles.universeId, universeId)
			)
		))
		.orderBy(tiles.id);
	const copies = new Map(rows
		.filter((row) => (row.overridesTileId !== null))
		.map((row) => [row.overridesTileId, row]));

	return(rows
		.filter((row) => (row.overridesTileId === null))
		.map((row) =>
		{
			const copy = ((row.universeId === null) ? copies.get(row.id) : undefined);
			const settings = (copy ?? row);

			return({
				id: row.id,
				name: settings.name,
				indoors: settings.indoors,
				color: settings.color,
				visionCost: settings.visionCost,
				movementCost: settings.movementCost,
				custom: (row.universeId !== null),
				edited: (copy !== undefined)
			});
		}));
}

/**
 * A page of a universe's tiles, as the Tilesets tab lists them
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param query The filters, and which page
 * @param executor The database, or a transaction
 * @return The page, and how many tiles match in all
 */
export async function listEditorTiles(universeId: string, ruleset: Ruleset, query: TileListQuery, executor: Executor = db): Promise<TileListPayload>
{
	const name = query.name?.toLowerCase();
	const matching = (await loadEditorTiles(universeId, ruleset, executor)).filter((tile) =>
	{
		return(
			((name === undefined) || tile.name.toLowerCase().includes(name))
			&& ((query.passable === undefined) || ((tile.movementCost < IMPASSABLE_COST) === query.passable))
			&& ((query.custom === undefined) || (tile.custom === query.custom))
			&& ((query.edited === undefined) || (tile.edited === query.edited))
		);
	});
	const offset = (query.offset ?? 0);

	return({
		tiles: matching.slice(offset, offset + (query.limit ?? matching.length)),
		total: matching.length
	});
}

/**
 * Whether a tile ID is one of a ruleset's default tiles or one of a universe's own tiles
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param tileId The tile's ID
 * @param executor The database, or a transaction
 * @return The kind of tile, or undefined when the universe can't use a tile with that ID (an edited
 * copy's own ID included)
 */
export async function findTileKind(universeId: string, ruleset: Ruleset, tileId: number, executor: Executor = db): Promise<TileKind | undefined>
{
	const [row] = await executor
		.select({ universeId: tiles.universeId })
		.from(tiles)
		.where(and(
			eq(tiles.id, tileId),
			eq(tiles.ruleset, ruleset),
			isNull(tiles.overridesTileId),
			or(isNull(tiles.universeId), eq(tiles.universeId, universeId))
		))
		.limit(1);

	if (!row)
	{
		return(undefined);
	}

	return(((row.universeId === null) ? 'default' : 'custom'));
}

/**
 * How many tiles a universe has added, not counting its edited copies of default tiles
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The number of tiles
 */
export async function countCustomTiles(universeId: string, executor: Executor = db): Promise<number>
{
	const [row] = await executor
		.select({ total: count() })
		.from(tiles)
		.where(and(
			eq(tiles.universeId, universeId),
			isNull(tiles.overridesTileId)
		));

	return(row.total);
}

/**
 * Adds a tile to a universe
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param settings The tile's settings
 * @param executor The database, or a transaction
 * @return The new tile's ID
 */
export async function createCustomTile(universeId: string, ruleset: Ruleset, settings: TileSettings, executor: Executor = db): Promise<number>
{
	return(createTile({ ruleset, universeId, key: null, ...settings }, executor));
}

/**
 * Changes one of a universe's own tiles
 *
 * @param universeId The universe's ID
 * @param tileId The tile's ID, from findTileKind() as custom
 * @param settings The tile's new settings
 * @param executor The database, or a transaction
 */
export async function updateCustomTile(universeId: string, tileId: number, settings: TileSettings, executor: Executor = db): Promise<void>
{
	await executor
		.update(tiles)
		.set(settings)
		.where(and(
			eq(tiles.id, tileId),
			eq(tiles.universeId, universeId)
		));
}

/**
 * Stores a universe's edited copy of a default tile, replacing any copy it had
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param defaultTileId The default tile's ID, from findTileKind() as default
 * @param settings The copy's settings
 * @param executor The database, or a transaction
 */
export async function saveEditedDefaultTile(universeId: string, ruleset: Ruleset, defaultTileId: number, settings: TileSettings, executor: Executor = db): Promise<void>
{
	await executor
		.insert(tiles)
		.values({
			ruleset,
			universeId,
			overridesTileId: defaultTileId,
			...settings
		})
		.onConflictDoUpdate({
			target: [tiles.universeId, tiles.overridesTileId],
			set: settings
		});
}

/**
 * Discards a universe's edited copy of a default tile, so the universe sees the default again
 *
 * @param universeId The universe's ID
 * @param defaultTileId The default tile's ID
 * @param executor The database, or a transaction
 */
export async function restoreDefaultTile(universeId: string, defaultTileId: number, executor: Executor = db): Promise<void>
{
	await executor
		.delete(tiles)
		.where(and(
			eq(tiles.universeId, universeId),
			eq(tiles.overridesTileId, defaultTileId)
		));
}

/**
 * Deletes one of a universe's own tiles. Check that no map uses it first (isTileInUse in zoneRepo)
 *
 * @param universeId The universe's ID
 * @param tileId The tile's ID, from findTileKind() as custom
 * @param executor The database, or a transaction
 */
export async function deleteCustomTile(universeId: string, tileId: number, executor: Executor = db): Promise<void>
{
	await executor
		.delete(tiles)
		.where(and(
			eq(tiles.id, tileId),
			eq(tiles.universeId, universeId)
		));
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
