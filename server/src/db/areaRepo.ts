/**
 * Areas, their maps and their links: the only module that reads or writes the areas, map_chunks and
 * area_links tables
 */
import { and, asc, between, count, eq, gt, gte, inArray, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { ancestorAreas, chunkCoordinate, chunkKey, isInBounds, lobbyAreaTime, resolveAreaTime, type AreaTime, type DisplayTime,type PassageOfTimeSetting, type CellChange, type ChunkRange, type EditorArea, type EditorAreaLink, type EditorAreaSummary, type MapBounds, type Ruleset, type AreaChunk, type AreaLightLevel, type AreaLinkTarget, type AreaPassageOfTime, type AreaSettingsUpdate } from '@multiverse-kiln/shared';

import { applyCellChanges, chunksOfChanges, clipChunk, isChunkInside, isDefaultChunk } from '../logic/mapEdits.js';
import type { AreaLink } from '../logic/areaGrid.js';
import { db, type Executor } from './client.js';
import { mapChunks, universes, areaLinks, areas } from './schema.js';
import { loadUniverseTiles, type TileRecord } from './tileRepo.js';

/**
 * Map layer holding the ground
 */
export const GROUND_LAYER = 0;

/**
 * An area as the rest of the server sees it
 */
export interface AreaRecord
{
	id: string;
	universeId: string;
	parentAreaId: string | undefined;
	name: string;
	enabled: boolean;
	indoors: boolean;
	passageOfTime: AreaPassageOfTime;
}

/**
 * An area with everything needed to play in it
 */
export interface LoadedArea
{
	area: AreaRecord;

	/**
	 * The universe's ruleset, which names its default tiles
	 */
	ruleset: Ruleset;

	/**
	 * How its time of day is worked out: its passage of time with inherit followed up to the universe's,
	 * or the universe's lobby time for the lobby's area
	 */
	time: AreaTime;

	/**
	 * How the universe shows players the time of day
	 */
	displayTime: DisplayTime;

	/**
	 * How light the area is at any time of day while it is indoors, or null outdoors, where it follows the time of day
	 */
	lightLevel: AreaLightLevel | null;

	/**
	 * Whether everyone sees DAY_VISION_SQUARES whatever the time of day: the lobby's area while its
	 * universe gives it no vision cost, when its tiles have none either
	 */
	fullVision: boolean;

	bounds: MapBounds;

	/**
	 * Tile of every cell holding DEFAULT_TILE_CELL, including every cell of a chunk that isn't stored
	 */
	defaultTileId: number;

	loopsEastWest: boolean;
	loopsNorthSouth: boolean;
	links: AreaLink[];

	/**
	 * Every tile the map can use, for drawing it and for its walk seconds
	 */
	tiles: TileRecord[];
}

/**
 * What a new area needs
 */
export type NewArea = Pick<typeof areas.$inferInsert, 'universeId' | 'parentAreaId' | 'name' | 'enabled' | 'indoors' | 'lightLevel' | 'defaultTileId' | 'loopsEastWest' | 'loopsNorthSouth' | 'passageOfTime' | 'faerieMorning'> & { bounds: MapBounds };

/**
 * What a new area link needs
 */
export type NewAreaLink = AreaLink & { areaId: string };

/**
 * Adds an area
 *
 * @param area The area
 * @param executor The database, or a transaction
 * @return The new area's ID
 */
export async function createArea(area: NewArea, executor: Executor = db): Promise<string>
{
	const { bounds, ...values } = area;
	const [created] = await executor
		.insert(areas)
		.values({ ...values, ...bounds })
		.returning({ id: areas.id });

	return(created.id);
}

/**
 * Stores one chunk of an area's ground, replacing whatever was there
 *
 * @param areaId The area's ID
 * @param chunkColumn The chunk's column (see chunkCoordinate)
 * @param chunkRow The chunk's row
 * @param cells CHUNK_SIZE * CHUNK_SIZE cell values, row by row
 * @param executor The database, or a transaction
 */
export async function saveGroundChunk(areaId: string, chunkColumn: number, chunkRow: number, cells: number[], executor: Executor = db): Promise<void>
{
	await executor
		.insert(mapChunks)
		.values({
			areaId,
			layer: GROUND_LAYER,
			chunkColumn,
			chunkRow,
			cells
		})
		.onConflictDoUpdate({
			target: [
				mapChunks.areaId,
				mapChunks.layer,
				mapChunks.chunkColumn,
				mapChunks.chunkRow
			],
			set: { cells }
		});
}

/**
 * Adds a link from a cell of one area to a cell of another
 *
 * @param link The link
 * @param executor The database, or a transaction
 */
export async function createAreaLink(link: NewAreaLink, executor: Executor = db): Promise<void>
{
	await executor.insert(areaLinks).values(link);
}

/**
 * Loads an area with everything needed to play in it except its map's cells, which a map up to
 * MAX_MAP_SIDE across has too many of to load at once: load them a piece at a time with loadChunks.
 * A lobby has full vision and its tiles no vision cost when its universe's lobbyNoVisionCost is set
 *
 * @param areaId The area's ID
 * @param executor The database, or a transaction
 * @return The area, or undefined when there is none with that ID
 */
export async function loadArea(areaId: string, executor: Executor = db): Promise<LoadedArea | undefined>
{
	const [row] = await executor
		.select({
			area: areas,
			ruleset: universes.ruleset,
			universe: {
				passageOfTime: universes.passageOfTime,
				faerieMorning: universes.faerieMorning,
				displayTime: universes.displayTime,
				lobbyAreaId: universes.lobbyAreaId,
				lobbyPassageOfTime: universes.lobbyPassageOfTime,
				lobbyDayHours: universes.lobbyDayHours,
				lobbyFaerieMorning: universes.lobbyFaerieMorning,
				lobbyNoVisionCost: universes.lobbyNoVisionCost
			}
		})
		.from(areas)
		.innerJoin(universes, eq(universes.id, areas.universeId))
		.where(eq(areas.id, areaId))
		.limit(1);

	if (!row)
	{
		return(undefined);
	}

	const { area, ruleset, universe } = row;
	const linkRows = await executor
		.select()
		.from(areaLinks)
		.where(eq(areaLinks.areaId, areaId));

	const isLobby = (area.id === universe.lobbyAreaId);
	const fullVision = (isLobby && universe.lobbyNoVisionCost);
	const universeTiles = await loadUniverseTiles(area.universeId, ruleset, executor);
	const tiles = (fullVision
		? universeTiles.map((tile) => ({ ...tile, visionCost: 0 }))
		: universeTiles);

	return({
		area: {
			id: area.id,
			universeId: area.universeId,
			parentAreaId: area.parentAreaId ?? undefined,
			name: area.name,
			enabled: area.enabled,
			indoors: area.indoors,
			passageOfTime: area.passageOfTime
		},
		ruleset,
		time: (isLobby
			? lobbyAreaTime({
				passageOfTime: universe.lobbyPassageOfTime,
				faerieMorning: universe.lobbyFaerieMorning,
				dayHours: universe.lobbyDayHours
			})
			: resolveAreaTime(await loadTimeChain(area, executor), universe)),
		displayTime: universe.displayTime,
		lightLevel: (area.indoors ? area.lightLevel : null),
		fullVision,
		bounds: boundsOf(area),
		defaultTileId: area.defaultTileId,
		loopsEastWest: area.loopsEastWest,
		loopsNorthSouth: area.loopsNorthSouth,
		links: linkRows.map((link) => ({
			column: link.column,
			row: link.row,
			targetAreaId: link.targetAreaId,
			targetColumn: link.targetColumn,
			targetRow: link.targetRow,
			mode: link.mode,
			requiresWholeGroup: link.requiresWholeGroup
		})),
		tiles
	});
}

/**
 * The passage of time settings resolveAreaTime() follows for an area: its own, then its parent's, and
 * so on up to its top-level area, stopping at the first that doesn't inherit
 *
 * @param area The area's row
 * @param executor The database, or a transaction
 * @return The settings, the area's first
 */
async function loadTimeChain(area: typeof areas.$inferSelect, executor: Executor): Promise<PassageOfTimeSetting<AreaPassageOfTime>[]>
{
	if ((area.passageOfTime !== 'inherit') || (area.parentAreaId === null))
	{
		return([area]);
	}

	const rows = await executor
		.select({
			id: areas.id,
			parentAreaId: areas.parentAreaId,
			passageOfTime: areas.passageOfTime,
			faerieMorning: areas.faerieMorning
		})
		.from(areas)
		.where(eq(areas.universeId, area.universeId));

	return([area, ...ancestorAreas(rows, area.id)]);
}

/**
 * An area with every setting the editor shows, and the universe it belongs to
 *
 * @param areaId The area's ID
 * @param executor The database, or a transaction
 * @return The area and its universe's ID, or undefined when there is no area with that ID
 */
export async function findEditorArea(areaId: string, executor: Executor = db): Promise<{ universeId: string; area: EditorArea } | undefined>
{
	const [row] = await executor
		.select()
		.from(areas)
		.where(eq(areas.id, areaId))
		.limit(1);

	if (!row)
	{
		return(undefined);
	}

	return({
		universeId: row.universeId,
		area: {
			id: row.id,
			name: row.name,
			parentAreaId: row.parentAreaId,
			enabled: row.enabled,
			indoors: row.indoors,
			lightLevel: row.lightLevel,
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
 * Every area of a universe, by name
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The areas
 */
export async function listAreas(universeId: string, executor: Executor = db): Promise<EditorAreaSummary[]>
{
	return(executor
		.select({
			id: areas.id,
			name: areas.name,
			parentAreaId: areas.parentAreaId,
			enabled: areas.enabled,
			indoors: areas.indoors
		})
		.from(areas)
		.where(eq(areas.universeId, universeId))
		.orderBy(areas.name, areas.id));
}

/**
 * How many areas a universe has
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The number of areas
 */
export async function countAreas(universeId: string, executor: Executor = db): Promise<number>
{
	const [row] = await executor
		.select({
			total: count()
		})
		.from(areas)
		.where(eq(areas.universeId, universeId));

	return(row.total);
}

/**
 * Changes some of an area's settings
 *
 * The database refuses a faerie passage of time without a faerie morning, a faerie morning without
 * faerie time, and a faerie area that loops
 *
 * @param areaId The area's ID
 * @param update The settings to change
 * @param executor The database, or a transaction
 */
export async function updateAreaSettings(areaId: string, update: AreaSettingsUpdate, executor: Executor = db): Promise<void>
{
	if (Object.keys(update).length === 0)
	{
		return;
	}

	await executor
		.update(areas)
		.set(update)
		.where(eq(areas.id, areaId));
}

/**
 * Deletes an area with its map and its links, and the links into it from other areas. Its child areas
 * become top-level areas
 *
 * @param areaId The area's ID
 * @param executor The database, or a transaction
 */
export async function deleteArea(areaId: string, executor: Executor = db): Promise<void>
{
	await executor
		.delete(areas)
		.where(eq(areas.id, areaId));
}

/**
 * Locks areas' rows until the transaction ends, so changes to their maps and links happen one
 * transaction at a time, even for chunks that aren't stored yet
 *
 * @param areaIds The areas' IDs
 * @param executor A transaction
 * @return Each area that exists, with its universe and bounds, by ID
 */
export async function lockAreas(areaIds: readonly string[], executor: Executor): Promise<Map<string, { universeId: string; bounds: MapBounds }>>
{
	// Locking in ID order keeps two transactions that lock the same areas from waiting on each other
	const rows = await executor
		.select()
		.from(areas)
		.where(inArray(areas.id, [...areaIds]))
		.orderBy(asc(areas.id))
		.for('update');

	return(new Map(rows.map((row) => [row.id, { universeId: row.universeId, bounds: boundsOf(row) }])));
}

/**
 * The stored chunks of an area's ground in a rectangle of chunks
 *
 * @param areaId The area's ID
 * @param range The chunks, inclusive at both ends
 * @param executor The database, or a transaction
 * @return The stored chunks, by row then column
 */
export async function loadChunks(areaId: string, range: ChunkRange, executor: Executor = db): Promise<AreaChunk[]>
{
	return(executor
		.select({
			chunkColumn: mapChunks.chunkColumn,
			chunkRow: mapChunks.chunkRow,
			cells: mapChunks.cells
		})
		.from(mapChunks)
		.where(and(
			eq(mapChunks.areaId, areaId),
			eq(mapChunks.layer, GROUND_LAYER),
			between(mapChunks.chunkColumn, range.minChunkColumn, range.maxChunkColumn),
			between(mapChunks.chunkRow, range.minChunkRow, range.maxChunkRow)
		))
		.orderBy(mapChunks.chunkRow, mapChunks.chunkColumn));
}

/**
 * Some of the stored chunks of an area's ground
 *
 * @param areaId The area's ID
 * @param chunks The chunks wanted; a chunk that isn't stored is all the default tile and isn't returned
 * @param executor The database, or a transaction
 * @return The stored chunks among them
 */
export async function loadChunksAt(areaId: string, chunks: readonly { chunkColumn: number; chunkRow: number }[], executor: Executor = db): Promise<AreaChunk[]>
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
			eq(mapChunks.areaId, areaId),
			eq(mapChunks.layer, GROUND_LAYER),
			sql`(${mapChunks.chunkColumn}, ${mapChunks.chunkRow}) IN (${sql.join(chunks.map((chunk) => sql`(${chunk.chunkColumn}, ${chunk.chunkRow})`), sql`, `)})`
		)));
}

/**
 * Changes cells of an area's ground. Chunks left all the default tile are no longer stored
 *
 * @param areaId The area's ID
 * @param changes The cells to change; their values must already be checked
 * @param executor A transaction
 * @return edited, not_found when there is no such area, or out_of_bounds (changing nothing) when a cell
 * is outside the area's bounds
 */
export async function editCells(areaId: string, changes: readonly CellChange[], executor: Executor): Promise<'edited' | 'not_found' | 'out_of_bounds'>
{
	const area = (await lockAreas([areaId], executor)).get(areaId);

	if (!area)
	{
		return('not_found');
	}

	if (changes.some(([column, row]) => !isInBounds(area.bounds, column, row)))
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
			eq(mapChunks.areaId, areaId),
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
			await storeGroundChunk(areaId, chunk.chunkColumn, chunk.chunkRow, cells, executor);
		}
	}

	return('edited');
}

/**
 * What resizeArea found, and whether it went ahead
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
	 * Links on cells outside the new bounds, and links from other areas into them
	 */
	discardedLinks: number;
}

/**
 * Gives an area's map new bounds. Cells outside them are reset to the default tile, and links on or
 * into those cells are deleted
 *
 * @param areaId The area's ID
 * @param bounds The new bounds, already checked
 * @param discard Whether to go ahead when that discards cells or links
 * @param executor A transaction
 * @return What was or would be discarded, or undefined when there is no such area
 */
export async function resizeArea(areaId: string, bounds: MapBounds, discard: boolean, executor: Executor): Promise<ResizeResult | undefined>
{
	if (!(await lockAreas([areaId], executor)).has(areaId))
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
			eq(mapChunks.areaId, areaId),
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
			eq(areaLinks.areaId, areaId),
			outsideBounds(areaLinks.column, areaLinks.row, bounds)
		),
		and(
			eq(areaLinks.targetAreaId, areaId),
			outsideBounds(areaLinks.targetColumn, areaLinks.targetRow, bounds)
		)
	);
	const [{ total: discardedLinks }] = await executor
		.select({
			total: count()
		})
		.from(areaLinks)
		.where(discardedLinkCondition);

	if (!discard && ((discardedCells > 0) || (discardedLinks > 0)))
	{
		return({ resized: false, discardedCells, discardedLinks });
	}

	for (const chunk of clipped)
	{
		await storeGroundChunk(areaId, chunk.chunkColumn, chunk.chunkRow, chunk.cells, executor);
	}

	await executor
		.delete(areaLinks)
		.where(discardedLinkCondition);

	await executor
		.update(areas)
		.set(bounds)
		.where(eq(areas.id, areaId));

	return({ resized: true, discardedCells, discardedLinks });
}

/**
 * The links on an area's cells
 *
 * @param areaId The area's ID
 * @param executor The database, or a transaction
 * @return The links, by row then column
 */
export async function listAreaLinks(areaId: string, executor: Executor = db): Promise<EditorAreaLink[]>
{
	return(executor
		.select({
			column: areaLinks.column,
			row: areaLinks.row,
			targetAreaId: areaLinks.targetAreaId,
			targetColumn: areaLinks.targetColumn,
			targetRow: areaLinks.targetRow,
			mode: areaLinks.mode,
			requiresWholeGroup: areaLinks.requiresWholeGroup
		})
		.from(areaLinks)
		.where(eq(areaLinks.areaId, areaId))
		.orderBy(areaLinks.row, areaLinks.column));
}

/**
 * Adds a link to an area's cell, replacing the link the cell had
 *
 * @param areaId The area's ID
 * @param column The cell's column
 * @param row The cell's row
 * @param target Where the link goes, already checked
 * @param executor The database, or a transaction
 */
export async function saveAreaLink(areaId: string, column: number, row: number, target: AreaLinkTarget, executor: Executor = db): Promise<void>
{
	await executor
		.insert(areaLinks)
		.values({
			areaId,
			column,
			row,
			...target
		})
		.onConflictDoUpdate({
			target: [areaLinks.areaId, areaLinks.column, areaLinks.row],
			set: target
		});
}

/**
 * Deletes the link on an area's cell
 *
 * @param areaId The area's ID
 * @param column The cell's column
 * @param row The cell's row
 * @param executor The database, or a transaction
 * @return Whether the cell had a link
 */
export async function deleteAreaLink(areaId: string, column: number, row: number, executor: Executor = db): Promise<boolean>
{
	const deleted = await executor
		.delete(areaLinks)
		.where(and(
			eq(areaLinks.areaId, areaId),
			eq(areaLinks.column, column),
			eq(areaLinks.row, row)
		))
		.returning({ id: areaLinks.id });

	return(deleted.length > 0);
}

/**
 * Whether any area of a universe uses a tile, as its default tile or in a cell
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
			id: areas.id
		})
		.from(areas)
		.where(and(
			eq(areas.universeId, universeId),
			eq(areas.defaultTileId, tileId)
		))
		.limit(1);

	if (asDefault)
	{
		return(true);
	}

	const [painted] = await executor
		.select({
			areaId: mapChunks.areaId
		})
		.from(mapChunks)
		.innerJoin(areas, eq(areas.id, mapChunks.areaId))
		.where(and(
			eq(areas.universeId, universeId),
			sql`${tileId} = ANY(${mapChunks.cells})`
		))
		.limit(1);

	return(painted !== undefined);
}

/**
 * Stores a chunk of an area's ground, or deletes it when every cell is the default tile
 *
 * @param areaId The area's ID
 * @param chunkColumn The chunk's column
 * @param chunkRow The chunk's row
 * @param cells The chunk's cells
 * @param executor The database, or a transaction
 */
async function storeGroundChunk(areaId: string, chunkColumn: number, chunkRow: number, cells: number[], executor: Executor): Promise<void>
{
	if (!isDefaultChunk(cells))
	{
		await saveGroundChunk(areaId, chunkColumn, chunkRow, cells, executor);
		return;
	}

	await executor
		.delete(mapChunks)
		.where(and(
			eq(mapChunks.areaId, areaId),
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
 * An area row's map bounds
 *
 * @param row The area's row
 * @return The bounds
 */
function boundsOf(row: Pick<typeof areas.$inferSelect, 'minColumn' | 'minRow' | 'maxColumn' | 'maxRow'>): MapBounds
{
	return({
		minColumn: row.minColumn,
		minRow: row.minRow,
		maxColumn: row.maxColumn,
		maxRow: row.maxRow
	});
}
