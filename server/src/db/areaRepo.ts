/**
 * Areas, their cells and their links: the only module that reads or writes the areas, area_chunks and
 * area_links tables
 */
import { and, asc, between, count, eq, gt, inArray, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { ancestorAreas, chunkCoordinate, chunkKey, DEFAULT_TILE_CELL, isInBounds, lobbyAreaTime, resolveAreaTime, type AreaTime, type DisplayTime,type PassageOfTimeSetting, type CellChange, type ChunkRange, type EditorArea, type EditorAreaLink, type EditorAreaSummary, type AreaBounds, type Ruleset, type AreaChunk, type AreaLightLevel, type AreaLinkTarget, type AreaPassageOfTime, type AreaSettingsUpdate } from '@multiverse-kiln/shared';

import { applyCellChanges, chunksOfChanges, clipChunk, isChunkInside, isDefaultChunk } from '../logic/areaEdits.js';
import type { AreaLink } from '../logic/areaGrid.js';
import { db, type Executor } from './client.js';
import { areaChunks, universes, universeDrafts, areaLinks, areas, races, classes, classRaceAreas } from './schema.js';
import { loadUniverseTiles, type TileRecord } from './tileRepo.js';
import { inVersion, liveVersion, type UniverseVersion } from './universeVersions.js';

/**
 * Layer of an area's cells holding the ground
 */
export const GROUND_LAYER = 0;

/**
 * Most chunks stored or deleted in one statement, keeping each upsert's thousand-cell arrays to under a
 * megabyte; the largest area (MAX_AREA_SIDE square) takes two
 */
const CHUNK_BATCH_SIZE = 128;

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

	bounds: AreaBounds;

	/**
	 * Tile of every cell holding DEFAULT_TILE_CELL, including every cell of a chunk that isn't stored
	 */
	defaultTileId: number;

	loopsEastWest: boolean;
	loopsNorthSouth: boolean;
	links: AreaLink[];

	/**
	 * The disabled areas the links lead to, as they were when the area was loaded. Nobody can go through
	 * those links, so clients aren't told about them
	 */
	disabledTargetIds: ReadonlySet<string>;

	/**
	 * Every tile the area can use, for drawing it and for its walk seconds
	 */
	tiles: TileRecord[];
}

/**
 * What a new area needs
 */
export type NewArea = Pick<typeof areas.$inferInsert, 'universeId' | 'draft' | 'parentAreaId' | 'name' | 'enabled' | 'indoors' | 'lightLevel' | 'defaultTileId' | 'loopsEastWest' | 'loopsNorthSouth' | 'passageOfTime' | 'faerieMorning'> & { bounds: AreaBounds };

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
		.insert(areaChunks)
		.values({
			areaId,
			layer: GROUND_LAYER,
			chunkColumn,
			chunkRow,
			cells
		})
		.onConflictDoUpdate({
			target: [
				areaChunks.areaId,
				areaChunks.layer,
				areaChunks.chunkColumn,
				areaChunks.chunkRow
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
 * Loads one of a universe's live areas with everything needed to play in it except its cells, which
 * an area up to MAX_AREA_SIDE across has too many of to load at once: load them a piece at a time with
 * loadChunks. A lobby has full vision and its tiles no vision cost when its universe's lobbyNoVisionCost
 * is set
 *
 * @param areaId The area's ID
 * @param executor The database, or a transaction
 * @return The area, or undefined when there is no live area with that ID
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
		.where(and(
			eq(areas.id, areaId),
			eq(areas.draft, false)
		))
		.limit(1);

	if (!row)
	{
		return(undefined);
	}

	const { area, ruleset, universe } = row;
	const linkRows = await executor
		.select({
			link: areaLinks,
			targetEnabled: areas.enabled
		})
		.from(areaLinks)
		.innerJoin(areas, eq(areas.id, areaLinks.targetAreaId))
		.where(eq(areaLinks.areaId, areaId));
	const disabledTargetIds = new Set(linkRows
		.filter(({ targetEnabled }) => !targetEnabled)
		.map(({ link }) => link.targetAreaId));

	const isLobby = (area.id === universe.lobbyAreaId);
	const fullVision = (isLobby && universe.lobbyNoVisionCost);
	const universeTiles = await loadUniverseTiles(liveVersion(area.universeId), ruleset, executor);
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
		links: linkRows.map(({ link }) => ({
			column: link.column,
			row: link.row,
			targetAreaId: link.targetAreaId,
			targetColumn: link.targetColumn,
			targetRow: link.targetRow,
			mode: link.mode,
			requiresWholeGroup: link.requiresWholeGroup
		})),
		disabledTargetIds,
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
		.where(inVersion(areas, {
			universeId: area.universeId,
			draft: area.draft
		}));

	return([area, ...ancestorAreas(rows, area.id)]);
}

/**
 * An area with every setting the editor shows, and the version of the universe it belongs to
 *
 * @param areaId The area's ID
 * @param executor The database, or a transaction
 * @return The area and its version, or undefined when there is no area with that ID
 */
export async function findEditorArea(areaId: string, executor: Executor = db): Promise<{ version: UniverseVersion; area: EditorArea } | undefined>
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
		version: {
			universeId: row.universeId,
			draft: row.draft
		},
		area: editorAreaOf(row)
	});
}

/**
 * Every area of a universe with every setting the editor shows, by name
 *
 * @param version The universe's live version or draft
 * @param executor The database, or a transaction
 * @return The areas
 */
export async function listEditorAreas(version: UniverseVersion, executor: Executor = db): Promise<EditorArea[]>
{
	const rows = await executor
		.select()
		.from(areas)
		.where(inVersion(areas, version))
		.orderBy(areas.name, areas.id);

	return(rows.map(editorAreaOf));
}

/**
 * An area's row as the editor shows it
 *
 * @param row The row
 * @return The area
 */
function editorAreaOf(row: typeof areas.$inferSelect): EditorArea
{
	return({
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
	});
}

/**
 * Every area of a universe, by name
 *
 * @param version The universe's live version or draft
 * @param executor The database, or a transaction
 * @return The areas
 */
export async function listAreas(version: UniverseVersion, executor: Executor = db): Promise<EditorAreaSummary[]>
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
		.where(inVersion(areas, version))
		.orderBy(areas.name, areas.id));
}

/**
 * How many areas a universe has
 *
 * @param version The universe's live version or draft
 * @param executor The database, or a transaction
 * @return The number of areas
 */
export async function countAreas(version: UniverseVersion, executor: Executor = db): Promise<number>
{
	const [row] = await executor
		.select({
			total: count()
		})
		.from(areas)
		.where(inVersion(areas, version));

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
 * Deletes an area with its cells and its links, and the links into it from other areas. Its child areas
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
 * Locks areas' rows until the transaction ends, so changes to their cells and links happen one
 * transaction at a time, even for chunks that aren't stored yet
 *
 * @param areaIds The areas' IDs
 * @param executor A transaction
 * @return Each area that exists, with the version of the universe it belongs to and its bounds, by ID
 */
export async function lockAreas(areaIds: readonly string[], executor: Executor): Promise<Map<string, { version: UniverseVersion; bounds: AreaBounds }>>
{
	// Locking in ID order keeps two transactions that lock the same areas from waiting on each other.
	// FOR NO KEY UPDATE doesn't block foreign key checks, so rows that refer to the areas (such as
	// groups' positions) can still be saved while a long editor save holds them
	const rows = await executor
		.select()
		.from(areas)
		.where(inArray(areas.id, [...areaIds]))
		.orderBy(asc(areas.id))
		.for('no key update');

	return(new Map(rows.map((row) => [row.id, {
		version: {
			universeId: row.universeId,
			draft: row.draft
		},
		bounds: boundsOf(row)
	}])));
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
			chunkColumn: areaChunks.chunkColumn,
			chunkRow: areaChunks.chunkRow,
			cells: areaChunks.cells
		})
		.from(areaChunks)
		.where(and(
			eq(areaChunks.areaId, areaId),
			eq(areaChunks.layer, GROUND_LAYER),
			between(areaChunks.chunkColumn, range.minChunkColumn, range.maxChunkColumn),
			between(areaChunks.chunkRow, range.minChunkRow, range.maxChunkRow)
		))
		.orderBy(areaChunks.chunkRow, areaChunks.chunkColumn));
}

/**
 * A page of the stored chunks of an area's ground, by column then row (the order of the table's key),
 * for going through all of them a page at a time
 *
 * @param areaId The area's ID
 * @param after The last chunk of the page before, or undefined for the first page
 * @param limit The most chunks the page holds
 * @param executor The database, or a transaction
 * @return The chunks; fewer than limit on the last page
 */
export async function loadChunkPage(areaId: string, after: { chunkColumn: number; chunkRow: number } | undefined, limit: number, executor: Executor = db): Promise<AreaChunk[]>
{
	return(executor
		.select({
			chunkColumn: areaChunks.chunkColumn,
			chunkRow: areaChunks.chunkRow,
			cells: areaChunks.cells
		})
		.from(areaChunks)
		.where(and(
			eq(areaChunks.areaId, areaId),
			eq(areaChunks.layer, GROUND_LAYER),
			((after === undefined) ? undefined : sql`(${areaChunks.chunkColumn}, ${areaChunks.chunkRow}) > (${after.chunkColumn}, ${after.chunkRow})`)
		))
		.orderBy(areaChunks.chunkColumn, areaChunks.chunkRow)
		.limit(limit));
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
			chunkColumn: areaChunks.chunkColumn,
			chunkRow: areaChunks.chunkRow,
			cells: areaChunks.cells
		})
		.from(areaChunks)
		.where(and(
			eq(areaChunks.areaId, areaId),
			eq(areaChunks.layer, GROUND_LAYER),
			sql`(${areaChunks.chunkColumn}, ${areaChunks.chunkRow}) IN (${sql.join(chunks.map((chunk) => sql`(${chunk.chunkColumn}, ${chunk.chunkRow})`), sql`, `)})`
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
			chunkColumn: areaChunks.chunkColumn,
			chunkRow: areaChunks.chunkRow,
			cells: areaChunks.cells
		})
		.from(areaChunks)
		.where(and(
			eq(areaChunks.areaId, areaId),
			eq(areaChunks.layer, GROUND_LAYER),
			sql`(${areaChunks.chunkColumn}, ${areaChunks.chunkRow}) IN (${sql.join(touched.map((chunk) => sql`(${chunk.chunkColumn}, ${chunk.chunkRow})`), sql`, `)})`
		));
	const stored = new Map(storedRows.map((chunk) => [chunkKey(chunk.chunkColumn, chunk.chunkRow), chunk.cells]));
	const changed = applyCellChanges(stored, changes);
	const toStore: AreaChunk[] = [];

	for (const chunk of touched)
	{
		const cells = changed.get(chunkKey(chunk.chunkColumn, chunk.chunkRow));

		if (cells)
		{
			toStore.push({
				chunkColumn: chunk.chunkColumn,
				chunkRow: chunk.chunkRow,
				cells
			});
		}
	}

	await storeGroundChunks(areaId, toStore, executor);

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
 * Gives an area new bounds. Cells outside them are reset to the default tile, and links on or
 * into those cells are deleted
 *
 * @param areaId The area's ID
 * @param bounds The new bounds, already checked
 * @param discard Whether to go ahead when that discards cells or links
 * @param executor A transaction
 * @return What was or would be discarded, or undefined when there is no such area
 */
export async function resizeArea(areaId: string, bounds: AreaBounds, discard: boolean, executor: Executor): Promise<ResizeResult | undefined>
{
	if (!(await lockAreas([areaId], executor)).has(areaId))
	{
		return(undefined);
	}

	const firstChunkColumn = chunkCoordinate(bounds.minColumn);
	const lastChunkColumn = chunkCoordinate(bounds.maxColumn);
	const firstChunkRow = chunkCoordinate(bounds.minRow);
	const lastChunkRow = chunkCoordinate(bounds.maxRow);
	const outsideChunkCondition = and(
		eq(areaChunks.areaId, areaId),
		eq(areaChunks.layer, GROUND_LAYER),
		or(
			lt(areaChunks.chunkColumn, firstChunkColumn),
			gt(areaChunks.chunkColumn, lastChunkColumn),
			lt(areaChunks.chunkRow, firstChunkRow),
			gt(areaChunks.chunkRow, lastChunkRow)
		)
	);

	// Chunks on an edge of the new bounds are clipped here; those wholly outside are counted and deleted
	// in the database without loading their cells
	const edgeChunks = await executor
		.select({
			chunkColumn: areaChunks.chunkColumn,
			chunkRow: areaChunks.chunkRow,
			cells: areaChunks.cells
		})
		.from(areaChunks)
		.where(and(
			eq(areaChunks.areaId, areaId),
			eq(areaChunks.layer, GROUND_LAYER),
			between(areaChunks.chunkColumn, firstChunkColumn, lastChunkColumn),
			between(areaChunks.chunkRow, firstChunkRow, lastChunkRow),
			or(
				eq(areaChunks.chunkColumn, firstChunkColumn),
				eq(areaChunks.chunkColumn, lastChunkColumn),
				eq(areaChunks.chunkRow, firstChunkRow),
				eq(areaChunks.chunkRow, lastChunkRow)
			)
		));
	const clipped = edgeChunks
		.filter((chunk) => !isChunkInside(chunk.chunkColumn, chunk.chunkRow, bounds))
		.map((chunk) => ({
			...chunk,
			...clipChunk(chunk.chunkColumn, chunk.chunkRow, chunk.cells, bounds)
		}))
		.filter((chunk) => (chunk.discarded > 0));
	const [{ total: outsideCells }] = await executor
		.select({
			total: sql<number>`coalesce(sum(cardinality(array_remove(${areaChunks.cells}, ${DEFAULT_TILE_CELL}::integer))), 0)`.mapWith(Number)
		})
		.from(areaChunks)
		.where(outsideChunkCondition);
	const discardedCells = clipped.reduce((total, chunk) => (total + chunk.discarded), outsideCells);
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

	await storeGroundChunks(areaId, clipped, executor);

	await executor
		.delete(areaChunks)
		.where(outsideChunkCondition);

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
 * The links on the cells of every area of a universe
 *
 * @param version The universe's live version or draft
 * @param executor The database, or a transaction
 * @return The links with their areas, by area, then row, then column
 */
export async function listVersionAreaLinks(version: UniverseVersion, executor: Executor = db): Promise<(EditorAreaLink & { areaId: string })[]>
{
	return(executor
		.select({
			areaId: areaLinks.areaId,
			column: areaLinks.column,
			row: areaLinks.row,
			targetAreaId: areaLinks.targetAreaId,
			targetColumn: areaLinks.targetColumn,
			targetRow: areaLinks.targetRow,
			mode: areaLinks.mode,
			requiresWholeGroup: areaLinks.requiresWholeGroup
		})
		.from(areaLinks)
		.innerJoin(areas, eq(areas.id, areaLinks.areaId))
		.where(inVersion(areas, version))
		.orderBy(areaLinks.areaId, areaLinks.row, areaLinks.column));
}

/**
 * Every area of a universe that is a starting area: the universe's, its races' and classes', and its
 * classes' for each race. None of them may be the lobby's area
 *
 * @param version The universe's live version or draft
 * @param executor The database, or a transaction
 * @return The areas' IDs
 */
export async function listStartingAreaIds(version: UniverseVersion, executor: Executor = db): Promise<string[]>
{
	const universeAreas = executor
		.select({ id: areas.id })
		.from(areas)
		.where(inVersion(areas, version));
	const ids = new Set<string | null>();
	const queries = [
		(version.draft
			? executor
				.select({ areaId: universeDrafts.startingAreaId })
				.from(universeDrafts)
				.where(eq(universeDrafts.universeId, version.universeId))
			: executor
				.select({ areaId: universes.startingAreaId })
				.from(universes)
				.where(eq(universes.id, version.universeId))),
		executor
			.select({ areaId: races.startingAreaId })
			.from(races)
			.where(inArray(races.startingAreaId, universeAreas)),
		executor
			.select({ areaId: classes.startingAreaId })
			.from(classes)
			.where(inArray(classes.startingAreaId, universeAreas)),
		executor
			.select({ areaId: classRaceAreas.areaId })
			.from(classRaceAreas)
			.where(inArray(classRaceAreas.areaId, universeAreas))
	];

	// One after another, since they may share a transaction
	for (const query of queries)
	{
		for (const { areaId } of await query)
		{
			ids.add(areaId);
		}
	}

	return([...ids].filter((id): id is string => (id !== null)));
}

/**
 * The areas with links leading to an area, other than the area itself
 *
 * @param areaId The area's ID
 * @param executor The database, or a transaction
 * @return The areas' IDs
 */
export async function listAreasLinkingTo(areaId: string, executor: Executor = db): Promise<string[]>
{
	const rows = await executor
		.selectDistinct({ areaId: areaLinks.areaId })
		.from(areaLinks)
		.where(and(eq(areaLinks.targetAreaId, areaId), ne(areaLinks.areaId, areaId)));

	return(rows.map((row) => row.areaId));
}

/**
 * How many links an area has on its cells other than one
 *
 * @param areaId The area's ID
 * @param column The cell's column
 * @param row The cell's row
 * @param executor The database, or a transaction
 * @return The number of links on its other cells
 */
export async function countAreaLinksBesides(areaId: string, column: number, row: number, executor: Executor = db): Promise<number>
{
	const [result] = await executor
		.select({
			total: count()
		})
		.from(areaLinks)
		.where(and(eq(areaLinks.areaId, areaId), or(ne(areaLinks.column, column), ne(areaLinks.row, row))));

	return(result.total);
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
 * The areas of a universe that use a tile, as their default tile or in a cell
 *
 * @param version The universe's live version or draft
 * @param tileId The tile's ID
 * @param executor The database, or a transaction
 * @return The areas, by name
 */
export async function findAreasUsingTile(version: UniverseVersion, tileId: number, executor: Executor = db): Promise<{ id: string; name: string }[]>
{
	return(executor
		.select({
			id: areas.id,
			name: areas.name
		})
		.from(areas)
		.where(and(
			inVersion(areas, version),
			or(
				eq(areas.defaultTileId, tileId),
				sql`EXISTS (SELECT 1 FROM ${areaChunks} WHERE ${areaChunks.areaId} = ${areas.id} AND ${tileId} = ANY(${areaChunks.cells}))`
			)
		))
		.orderBy(asc(areas.name)));
}

/**
 * Paints every use of a tile in a universe's areas with another tile: the cells holding it, and the areas
 * whose default tile it is. Lock the universe first, so painting can't use the tile meanwhile
 *
 * @param version The universe's live version or draft
 * @param tileId The tile to replace
 * @param replacementId The tile to paint in its place
 * @param executor The database, or a transaction
 * @return The IDs of the areas that changed
 */
export async function replaceTileInAreas(version: UniverseVersion, tileId: number, replacementId: number, executor: Executor = db): Promise<string[]>
{
	const universeAreas = executor
		.select({
			id: areas.id
		})
		.from(areas)
		.where(inVersion(areas, version));
	const repainted = await executor
		.update(areaChunks)
		.set({
			cells: sql`array_replace(${areaChunks.cells}, ${tileId}, ${replacementId})`
		})
		.where(and(
			inArray(areaChunks.areaId, universeAreas),
			sql`${tileId} = ANY(${areaChunks.cells})`
		))
		.returning({
			areaId: areaChunks.areaId
		});
	const redefaulted = await executor
		.update(areas)
		.set({
			defaultTileId: replacementId
		})
		.where(and(
			inVersion(areas, version),
			eq(areas.defaultTileId, tileId)
		))
		.returning({
			id: areas.id
		});

	return([...new Set([...repainted.map((chunk) => chunk.areaId), ...redefaulted.map((area) => area.id)])]);
}

/**
 * Whether any area of a universe uses a tile, as its default tile or in a cell
 *
 * @param version The universe's live version or draft
 * @param tileId The tile's ID
 * @param executor The database, or a transaction
 * @return True when the tile is used
 */
export async function isTileInUse(version: UniverseVersion, tileId: number, executor: Executor = db): Promise<boolean>
{
	const [asDefault] = await executor
		.select({
			id: areas.id
		})
		.from(areas)
		.where(and(
			inVersion(areas, version),
			eq(areas.defaultTileId, tileId)
		))
		.limit(1);

	if (asDefault)
	{
		return(true);
	}

	const [painted] = await executor
		.select({
			areaId: areaChunks.areaId
		})
		.from(areaChunks)
		.innerJoin(areas, eq(areas.id, areaChunks.areaId))
		.where(and(
			inVersion(areas, version),
			sql`${tileId} = ANY(${areaChunks.cells})`
		))
		.limit(1);

	return(painted !== undefined);
}

/**
 * Stores chunks of an area's ground, deleting those whose every cell is the default tile, a batch of
 * chunks to a statement
 *
 * @param areaId The area's ID
 * @param chunks The chunks, each at most once
 * @param executor The database, or a transaction
 */
async function storeGroundChunks(areaId: string, chunks: readonly AreaChunk[], executor: Executor): Promise<void>
{
	const toSave = chunks.filter((chunk) => !isDefaultChunk(chunk.cells));
	const toDelete = chunks.filter((chunk) => isDefaultChunk(chunk.cells));

	for (let start = 0; start < toSave.length; start += CHUNK_BATCH_SIZE)
	{
		const batch = toSave.slice(start, start + CHUNK_BATCH_SIZE);

		await executor
			.insert(areaChunks)
			.values(batch.map((chunk) => ({
				areaId,
				layer: GROUND_LAYER,
				chunkColumn: chunk.chunkColumn,
				chunkRow: chunk.chunkRow,
				cells: chunk.cells
			})))
			.onConflictDoUpdate({
				target: [
					areaChunks.areaId,
					areaChunks.layer,
					areaChunks.chunkColumn,
					areaChunks.chunkRow
				],
				set: { cells: sql`excluded.cells` }
			});
	}

	for (let start = 0; start < toDelete.length; start += CHUNK_BATCH_SIZE)
	{
		const batch = toDelete.slice(start, start + CHUNK_BATCH_SIZE);

		await executor
			.delete(areaChunks)
			.where(and(
				eq(areaChunks.areaId, areaId),
				eq(areaChunks.layer, GROUND_LAYER),
				sql`(${areaChunks.chunkColumn}, ${areaChunks.chunkRow}) IN (${sql.join(batch.map((chunk) => sql`(${chunk.chunkColumn}, ${chunk.chunkRow})`), sql`, `)})`
			));
	}
}

/**
 * A condition matching rows whose cell is outside an area's bounds
 *
 * @param column The column holding the cell's column
 * @param row The column holding the cell's row
 * @param bounds The area's bounds
 * @return The condition
 */
function outsideBounds(column: PgColumn, row: PgColumn, bounds: AreaBounds): SQL | undefined
{
	return(or(
		lt(column, bounds.minColumn),
		gt(column, bounds.maxColumn),
		lt(row, bounds.minRow),
		gt(row, bounds.maxRow)
	));
}

/**
 * An area row's bounds
 *
 * @param row The area's row
 * @return The bounds
 */
function boundsOf(row: Pick<typeof areas.$inferSelect, 'minColumn' | 'minRow' | 'maxColumn' | 'maxRow'>): AreaBounds
{
	return({
		minColumn: row.minColumn,
		minRow: row.minRow,
		maxColumn: row.maxColumn,
		maxRow: row.maxRow
	});
}
