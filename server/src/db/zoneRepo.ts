/**
 * Zones, their maps and their links: the only module that reads or writes the zones, map_chunks and
 * zone_links tables
 */
import { and, asc, between, count, eq, gt, gte, inArray, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { chunkCoordinate, chunkKey, isInBounds, type CellChange, type ChunkRange, type EditorZone, type EditorZoneLink, type EditorZoneSummary, type MapBounds, type Ruleset, type ZoneChunk, type ZoneLinkTarget, type ZonePassageOfTime, type ZoneSettingsUpdate } from '@multiverse-kiln/shared';

import { applyCellChanges, chunksOfChanges, clipChunk, isChunkInside, isDefaultChunk } from '../logic/mapEdits.js';
import type { ZoneLink } from '../logic/zoneGrid.js';
import { db, type Executor } from './client.js';
import { mapChunks, universes, zoneLinks, zones } from './schema.js';
import { loadUniverseTiles, type TileRecord } from './tileRepo.js';

/**
 * Map layer holding the ground
 */
export const GROUND_LAYER = 0;

/**
 * A zone as the rest of the server sees it
 */
export interface ZoneRecord
{
	id: string;
	universeId: string;
	parentZoneId: string | undefined;
	name: string;
	enabled: boolean;
	indoors: boolean;
	passageOfTime: ZonePassageOfTime;
}

/**
 * A zone with everything needed to play in it
 */
export interface LoadedZone
{
	zone: ZoneRecord;

	/**
	 * The universe's ruleset, which names its default tiles
	 */
	ruleset: Ruleset;

	bounds: MapBounds;

	/**
	 * Tile of every cell holding DEFAULT_TILE_CELL, including every cell of a chunk that isn't stored
	 */
	defaultTileId: number;

	loopsEastWest: boolean;
	loopsNorthSouth: boolean;
	links: ZoneLink[];

	/**
	 * Every tile the map can use, for drawing it and for its movement costs
	 */
	tiles: TileRecord[];
}

/**
 * What a new zone needs
 */
export type NewZone = Pick<typeof zones.$inferInsert, 'universeId' | 'parentZoneId' | 'name' | 'enabled' | 'indoors' | 'defaultTileId' | 'loopsEastWest' | 'loopsNorthSouth' | 'passageOfTime' | 'faerieMorning'> & { bounds: MapBounds };

/**
 * What a new zone link needs
 */
export type NewZoneLink = ZoneLink & { zoneId: string };

/**
 * Adds a zone
 *
 * @param zone The zone
 * @param executor The database, or a transaction
 * @return The new zone's ID
 */
export async function createZone(zone: NewZone, executor: Executor = db): Promise<string>
{
	const { bounds, ...values } = zone;
	const [created] = await executor
		.insert(zones)
		.values({ ...values, ...bounds })
		.returning({ id: zones.id });

	return(created.id);
}

/**
 * Stores one chunk of a zone's ground, replacing whatever was there
 *
 * @param zoneId The zone's ID
 * @param chunkColumn The chunk's column (see chunkCoordinate)
 * @param chunkRow The chunk's row
 * @param cells CHUNK_SIZE * CHUNK_SIZE cell values, row by row
 * @param executor The database, or a transaction
 */
export async function saveGroundChunk(zoneId: string, chunkColumn: number, chunkRow: number, cells: number[], executor: Executor = db): Promise<void>
{
	await executor
		.insert(mapChunks)
		.values({
			zoneId,
			layer: GROUND_LAYER,
			chunkColumn,
			chunkRow,
			cells
		})
		.onConflictDoUpdate({
			target: [
				mapChunks.zoneId,
				mapChunks.layer,
				mapChunks.chunkColumn,
				mapChunks.chunkRow
			],
			set: { cells }
		});
}

/**
 * Adds a link from a cell of one zone to a cell of another
 *
 * @param link The link
 * @param executor The database, or a transaction
 */
export async function createZoneLink(link: NewZoneLink, executor: Executor = db): Promise<void>
{
	await executor.insert(zoneLinks).values(link);
}

/**
 * Loads a zone with everything needed to play in it except its map's cells, which a map up to
 * MAX_MAP_SIDE across has too many of to load at once: load them a piece at a time with loadChunks
 *
 * @param zoneId The zone's ID
 * @param executor The database, or a transaction
 * @return The zone, or undefined when there is none with that ID
 */
export async function loadZone(zoneId: string, executor: Executor = db): Promise<LoadedZone | undefined>
{
	const [row] = await executor
		.select({
			zone: zones,
			ruleset: universes.ruleset
		})
		.from(zones)
		.innerJoin(universes, eq(universes.id, zones.universeId))
		.where(eq(zones.id, zoneId))
		.limit(1);

	if (!row)
	{
		return(undefined);
	}

	const { zone, ruleset } = row;
	const linkRows = await executor
		.select()
		.from(zoneLinks)
		.where(eq(zoneLinks.zoneId, zoneId));

	const tiles = await loadUniverseTiles(zone.universeId, ruleset, executor);

	return({
		zone: {
			id: zone.id,
			universeId: zone.universeId,
			parentZoneId: zone.parentZoneId ?? undefined,
			name: zone.name,
			enabled: zone.enabled,
			indoors: zone.indoors,
			passageOfTime: zone.passageOfTime
		},
		ruleset,
		bounds: boundsOf(zone),
		defaultTileId: zone.defaultTileId,
		loopsEastWest: zone.loopsEastWest,
		loopsNorthSouth: zone.loopsNorthSouth,
		links: linkRows.map((link) => ({
			column: link.column,
			row: link.row,
			targetZoneId: link.targetZoneId,
			targetColumn: link.targetColumn,
			targetRow: link.targetRow,
			mode: link.mode,
			requiresWholeGroup: link.requiresWholeGroup
		})),
		tiles
	});
}

/**
 * A zone with every setting the editor shows, and the universe it belongs to
 *
 * @param zoneId The zone's ID
 * @param executor The database, or a transaction
 * @return The zone and its universe's ID, or undefined when there is no zone with that ID
 */
export async function findEditorZone(zoneId: string, executor: Executor = db): Promise<{ universeId: string; zone: EditorZone } | undefined>
{
	const [row] = await executor
		.select()
		.from(zones)
		.where(eq(zones.id, zoneId))
		.limit(1);

	if (!row)
	{
		return(undefined);
	}

	return({
		universeId: row.universeId,
		zone: {
			id: row.id,
			name: row.name,
			parentZoneId: row.parentZoneId,
			enabled: row.enabled,
			indoors: row.indoors,
			defaultTileId: row.defaultTileId,
			passageOfTime: row.passageOfTime,
			faerieMorning: row.faerieMorning,
			loopsEastWest: row.loopsEastWest,
			loopsNorthSouth: row.loopsNorthSouth,
			bounds: boundsOf(row)
		}
	});
}

/**
 * Every zone of a universe, by name
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The zones
 */
export async function listZones(universeId: string, executor: Executor = db): Promise<EditorZoneSummary[]>
{
	return(executor
		.select({
			id: zones.id,
			name: zones.name,
			parentZoneId: zones.parentZoneId,
			enabled: zones.enabled,
			indoors: zones.indoors
		})
		.from(zones)
		.where(eq(zones.universeId, universeId))
		.orderBy(zones.name, zones.id));
}

/**
 * How many zones a universe has
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The number of zones
 */
export async function countZones(universeId: string, executor: Executor = db): Promise<number>
{
	const [row] = await executor
		.select({
			total: count()
		})
		.from(zones)
		.where(eq(zones.universeId, universeId));

	return(row.total);
}

/**
 * Changes some of a zone's settings
 *
 * The database refuses a faerie passage of time without a faerie morning, a faerie morning without
 * faerie time, and a faerie zone that loops
 *
 * @param zoneId The zone's ID
 * @param update The settings to change
 * @param executor The database, or a transaction
 */
export async function updateZoneSettings(zoneId: string, update: ZoneSettingsUpdate, executor: Executor = db): Promise<void>
{
	if (Object.keys(update).length === 0)
	{
		return;
	}

	await executor
		.update(zones)
		.set(update)
		.where(eq(zones.id, zoneId));
}

/**
 * Deletes a zone with its map and its links, and the links into it from other zones. Its child zones
 * become top-level zones
 *
 * @param zoneId The zone's ID
 * @param executor The database, or a transaction
 */
export async function deleteZone(zoneId: string, executor: Executor = db): Promise<void>
{
	await executor
		.delete(zones)
		.where(eq(zones.id, zoneId));
}

/**
 * Locks zones' rows until the transaction ends, so changes to their maps and links happen one
 * transaction at a time, even for chunks that aren't stored yet
 *
 * @param zoneIds The zones' IDs
 * @param executor A transaction
 * @return Each zone that exists, with its universe and bounds, by ID
 */
export async function lockZones(zoneIds: readonly string[], executor: Executor): Promise<Map<string, { universeId: string; bounds: MapBounds }>>
{
	// Locking in ID order keeps two transactions that lock the same zones from waiting on each other
	const rows = await executor
		.select()
		.from(zones)
		.where(inArray(zones.id, [...zoneIds]))
		.orderBy(asc(zones.id))
		.for('update');

	return(new Map(rows.map((row) => [row.id, { universeId: row.universeId, bounds: boundsOf(row) }])));
}

/**
 * The stored chunks of a zone's ground in a rectangle of chunks
 *
 * @param zoneId The zone's ID
 * @param range The chunks, inclusive at both ends
 * @param executor The database, or a transaction
 * @return The stored chunks, by row then column
 */
export async function loadChunks(zoneId: string, range: ChunkRange, executor: Executor = db): Promise<ZoneChunk[]>
{
	return(executor
		.select({
			chunkColumn: mapChunks.chunkColumn,
			chunkRow: mapChunks.chunkRow,
			cells: mapChunks.cells
		})
		.from(mapChunks)
		.where(and(
			eq(mapChunks.zoneId, zoneId),
			eq(mapChunks.layer, GROUND_LAYER),
			between(mapChunks.chunkColumn, range.minChunkColumn, range.maxChunkColumn),
			between(mapChunks.chunkRow, range.minChunkRow, range.maxChunkRow)
		))
		.orderBy(mapChunks.chunkRow, mapChunks.chunkColumn));
}

/**
 * Some of the stored chunks of a zone's ground
 *
 * @param zoneId The zone's ID
 * @param chunks The chunks wanted; a chunk that isn't stored is all the default tile and isn't returned
 * @param executor The database, or a transaction
 * @return The stored chunks among them
 */
export async function loadChunksAt(zoneId: string, chunks: readonly { chunkColumn: number; chunkRow: number }[], executor: Executor = db): Promise<ZoneChunk[]>
{
	if (chunks.length === 0)
	{
		return([]);
	}

	return(executor
		.select({
			chunkColumn: mapChunks.chunkColumn,
			chunkRow: mapChunks.chunkRow,
			cells: mapChunks.cells
		})
		.from(mapChunks)
		.where(and(
			eq(mapChunks.zoneId, zoneId),
			eq(mapChunks.layer, GROUND_LAYER),
			sql`(${mapChunks.chunkColumn}, ${mapChunks.chunkRow}) IN (${sql.join(chunks.map((chunk) => sql`(${chunk.chunkColumn}, ${chunk.chunkRow})`), sql`, `)})`
		)));
}

/**
 * Changes cells of a zone's ground. Chunks left all the default tile are no longer stored
 *
 * @param zoneId The zone's ID
 * @param changes The cells to change; their values must already be checked
 * @param executor A transaction
 * @return edited, not_found when there is no such zone, or out_of_bounds (changing nothing) when a cell
 * is outside the zone's bounds
 */
export async function editCells(zoneId: string, changes: readonly CellChange[], executor: Executor): Promise<'edited' | 'not_found' | 'out_of_bounds'>
{
	const zone = (await lockZones([zoneId], executor)).get(zoneId);

	if (!zone)
	{
		return('not_found');
	}

	if (changes.some(([column, row]) => !isInBounds(zone.bounds, column, row)))
	{
		return('out_of_bounds');
	}

	const touched = [...chunksOfChanges(changes).values()];

	if (touched.length === 0)
	{
		return('edited');
	}

	const storedRows = await executor
		.select({
			chunkColumn: mapChunks.chunkColumn,
			chunkRow: mapChunks.chunkRow,
			cells: mapChunks.cells
		})
		.from(mapChunks)
		.where(and(
			eq(mapChunks.zoneId, zoneId),
			eq(mapChunks.layer, GROUND_LAYER),
			sql`(${mapChunks.chunkColumn}, ${mapChunks.chunkRow}) IN (${sql.join(touched.map((chunk) => sql`(${chunk.chunkColumn}, ${chunk.chunkRow})`), sql`, `)})`
		));
	const stored = new Map(storedRows.map((chunk) => [chunkKey(chunk.chunkColumn, chunk.chunkRow), chunk.cells]));
	const changed = applyCellChanges(stored, changes);

	for (const chunk of touched)
	{
		const cells = changed.get(chunkKey(chunk.chunkColumn, chunk.chunkRow));

		if (cells)
		{
			await storeGroundChunk(zoneId, chunk.chunkColumn, chunk.chunkRow, cells, executor);
		}
	}

	return('edited');
}

/**
 * What resizeZone found, and whether it went ahead
 */
export interface ResizeResult
{
	/**
	 * False when the resize would have discarded something and that wasn't allowed
	 */
	resized: boolean;

	/**
	 * Cells outside the new bounds that weren't the default tile
	 */
	discardedCells: number;

	/**
	 * Links on cells outside the new bounds, and links from other zones into them
	 */
	discardedLinks: number;
}

/**
 * Gives a zone's map new bounds. Cells outside them are reset to the default tile, and links on or
 * into those cells are deleted
 *
 * @param zoneId The zone's ID
 * @param bounds The new bounds, already checked
 * @param discard Whether to go ahead when that discards cells or links
 * @param executor A transaction
 * @return What was or would be discarded, or undefined when there is no such zone
 */
export async function resizeZone(zoneId: string, bounds: MapBounds, discard: boolean, executor: Executor): Promise<ResizeResult | undefined>
{
	if (!(await lockZones([zoneId], executor)).has(zoneId))
	{
		return(undefined);
	}

	// Chunks touching an edge of the new bounds, or beyond it; every other chunk lies inside
	const edgeChunks = await executor
		.select({
			chunkColumn: mapChunks.chunkColumn,
			chunkRow: mapChunks.chunkRow,
			cells: mapChunks.cells
		})
		.from(mapChunks)
		.where(and(
			eq(mapChunks.zoneId, zoneId),
			eq(mapChunks.layer, GROUND_LAYER),
			or(
				lte(mapChunks.chunkColumn, chunkCoordinate(bounds.minColumn)),
				gte(mapChunks.chunkColumn, chunkCoordinate(bounds.maxColumn)),
				lte(mapChunks.chunkRow, chunkCoordinate(bounds.minRow)),
				gte(mapChunks.chunkRow, chunkCoordinate(bounds.maxRow))
			)
		));
	const clipped = edgeChunks
		.filter((chunk) => !isChunkInside(chunk.chunkColumn, chunk.chunkRow, bounds))
		.map((chunk) => ({
			...chunk,
			...clipChunk(chunk.chunkColumn, chunk.chunkRow, chunk.cells, bounds)
		}))
		.filter((chunk) => (chunk.discarded > 0));
	const discardedCells = clipped.reduce((total, chunk) => (total + chunk.discarded), 0);
	const discardedLinkCondition = or(
		and(
			eq(zoneLinks.zoneId, zoneId),
			outsideBounds(zoneLinks.column, zoneLinks.row, bounds)
		),
		and(
			eq(zoneLinks.targetZoneId, zoneId),
			outsideBounds(zoneLinks.targetColumn, zoneLinks.targetRow, bounds)
		)
	);
	const [{ total: discardedLinks }] = await executor
		.select({
			total: count()
		})
		.from(zoneLinks)
		.where(discardedLinkCondition);

	if (!discard && ((discardedCells > 0) || (discardedLinks > 0)))
	{
		return({ resized: false, discardedCells, discardedLinks });
	}

	for (const chunk of clipped)
	{
		await storeGroundChunk(zoneId, chunk.chunkColumn, chunk.chunkRow, chunk.cells, executor);
	}

	await executor
		.delete(zoneLinks)
		.where(discardedLinkCondition);

	await executor
		.update(zones)
		.set(bounds)
		.where(eq(zones.id, zoneId));

	return({ resized: true, discardedCells, discardedLinks });
}

/**
 * The links on a zone's cells
 *
 * @param zoneId The zone's ID
 * @param executor The database, or a transaction
 * @return The links, by row then column
 */
export async function listZoneLinks(zoneId: string, executor: Executor = db): Promise<EditorZoneLink[]>
{
	return(executor
		.select({
			column: zoneLinks.column,
			row: zoneLinks.row,
			targetZoneId: zoneLinks.targetZoneId,
			targetColumn: zoneLinks.targetColumn,
			targetRow: zoneLinks.targetRow,
			mode: zoneLinks.mode,
			requiresWholeGroup: zoneLinks.requiresWholeGroup
		})
		.from(zoneLinks)
		.where(eq(zoneLinks.zoneId, zoneId))
		.orderBy(zoneLinks.row, zoneLinks.column));
}

/**
 * Adds a link to a zone's cell, replacing the link the cell had
 *
 * @param zoneId The zone's ID
 * @param column The cell's column
 * @param row The cell's row
 * @param target Where the link goes, already checked
 * @param executor The database, or a transaction
 */
export async function saveZoneLink(zoneId: string, column: number, row: number, target: ZoneLinkTarget, executor: Executor = db): Promise<void>
{
	await executor
		.insert(zoneLinks)
		.values({
			zoneId,
			column,
			row,
			...target
		})
		.onConflictDoUpdate({
			target: [zoneLinks.zoneId, zoneLinks.column, zoneLinks.row],
			set: target
		});
}

/**
 * Deletes the link on a zone's cell
 *
 * @param zoneId The zone's ID
 * @param column The cell's column
 * @param row The cell's row
 * @param executor The database, or a transaction
 * @return Whether the cell had a link
 */
export async function deleteZoneLink(zoneId: string, column: number, row: number, executor: Executor = db): Promise<boolean>
{
	const deleted = await executor
		.delete(zoneLinks)
		.where(and(
			eq(zoneLinks.zoneId, zoneId),
			eq(zoneLinks.column, column),
			eq(zoneLinks.row, row)
		))
		.returning({ id: zoneLinks.id });

	return(deleted.length > 0);
}

/**
 * Whether any zone of a universe uses a tile, as its default tile or in a cell
 *
 * @param universeId The universe's ID
 * @param tileId The tile's ID
 * @param executor The database, or a transaction
 * @return True when the tile is used
 */
export async function isTileInUse(universeId: string, tileId: number, executor: Executor = db): Promise<boolean>
{
	const [asDefault] = await executor
		.select({
			id: zones.id
		})
		.from(zones)
		.where(and(
			eq(zones.universeId, universeId),
			eq(zones.defaultTileId, tileId)
		))
		.limit(1);

	if (asDefault)
	{
		return(true);
	}

	const [painted] = await executor
		.select({
			zoneId: mapChunks.zoneId
		})
		.from(mapChunks)
		.innerJoin(zones, eq(zones.id, mapChunks.zoneId))
		.where(and(
			eq(zones.universeId, universeId),
			sql`${tileId} = ANY(${mapChunks.cells})`
		))
		.limit(1);

	return(painted !== undefined);
}

/**
 * Stores a chunk of a zone's ground, or deletes it when every cell is the default tile
 *
 * @param zoneId The zone's ID
 * @param chunkColumn The chunk's column
 * @param chunkRow The chunk's row
 * @param cells The chunk's cells
 * @param executor The database, or a transaction
 */
async function storeGroundChunk(zoneId: string, chunkColumn: number, chunkRow: number, cells: number[], executor: Executor): Promise<void>
{
	if (!isDefaultChunk(cells))
	{
		await saveGroundChunk(zoneId, chunkColumn, chunkRow, cells, executor);
		return;
	}

	await executor
		.delete(mapChunks)
		.where(and(
			eq(mapChunks.zoneId, zoneId),
			eq(mapChunks.layer, GROUND_LAYER),
			eq(mapChunks.chunkColumn, chunkColumn),
			eq(mapChunks.chunkRow, chunkRow)
		));
}

/**
 * A condition matching rows whose cell is outside a map's bounds
 *
 * @param column The column holding the cell's column
 * @param row The column holding the cell's row
 * @param bounds The map's bounds
 * @return The condition
 */
function outsideBounds(column: PgColumn, row: PgColumn, bounds: MapBounds): SQL | undefined
{
	return(or(
		lt(column, bounds.minColumn),
		gt(column, bounds.maxColumn),
		lt(row, bounds.minRow),
		gt(row, bounds.maxRow)
	));
}

/**
 * A zone row's map bounds
 *
 * @param row The zone's row
 * @return The bounds
 */
function boundsOf(row: Pick<typeof zones.$inferSelect, 'minColumn' | 'minRow' | 'maxColumn' | 'maxRow'>): MapBounds
{
	return({
		minColumn: row.minColumn,
		minRow: row.minRow,
		maxColumn: row.maxColumn,
		maxRow: row.maxRow
	});
}
