/**
 * Areas, their cells and their links: the only module that reads or writes the areas, area_chunks and
 * area_links tables
 */
import { and, asc, between, count, eq, gt, inArray, lt, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { chunkCoordinate, chunkKey, DEFAULT_TILE_CELL, isInBounds, lobbyAreaTime, type AreaTime, type DisplayTime, type CellChange, type ChunkRange, type EditorArea, type EditorAreaLink, type EditorAreaSummary, type AreaBounds, type Ruleset, type AreaChunk, type AreaLightLevel, type AreaLinkTarget, type AreaSettingsUpdate, type FaerieMorning, type PassageOfTime, type PlaceRef, type PlaceSettings, type PlaceWorld, type ResolvedAreaSettings } from '@multiverse-kiln/shared';

import { applyCellChanges, chunksOfChanges, clipChunk, isChunkInside, isDefaultChunk } from '../logic/areaEdits.js';
import type { AreaLink } from '../logic/areaGrid.js';
import { db, type Executor } from './client.js';
import { isRegionDefaultTile, listRegions, placeSettingsOf } from './regionRepo.js';
import { areaChunks, universes, universeDrafts, areaLinks, areas, areaRegions, races, classes, classRaceAreas } from './schema.js';
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
 * An area as the rest of the server sees it, with the settings worked out for it
 */
export interface AreaRecord
{
	id: string;
	universeId: string;
	parentAreaId: string | undefined;
	name: string;
	enabled: boolean;
	indoors: boolean;

	/**
	 * null for the lobby's area, which takes the Lobby tab's
	 */
	passageOfTime: PassageOfTime | null;
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
	 * How its time of day is worked out: its passage of time as worked out from its regions and areas,
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
 * What a new area needs: its own settings, each left out inheriting, the settings worked out for it, and
 * its bounds. Its parents are given with setAreaParents()
 */
export type NewArea = Pick<typeof areas.$inferInsert, 'universeId' | 'draft' | 'name' | 'loopsEastWest' | 'loopsNorthSouth'> & Partial<PlaceSettings> & { resolved: ResolvedAreaSettings; bounds: AreaBounds };

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
	const { bounds, resolved, ...values } = area;
	const [created] = await executor
		.insert(areas)
		.values({
			...values,
			...resolvedColumns(resolved),
			...bounds
		})
		.returning({ id: areas.id });

	return(created.id);
}

/**
 * The columns holding an area's worked-out settings
 *
 * @param resolved The settings
 * @return The column values
 */
function resolvedColumns(resolved: ResolvedAreaSettings): Pick<typeof areas.$inferInsert, 'resolvedEnabled' | 'resolvedIndoors' | 'resolvedLightLevel' | 'resolvedDefaultTileId' | 'resolvedPassageOfTime' | 'resolvedFaerieMorning'>
{
	return({
		resolvedEnabled: resolved.enabled,
		resolvedIndoors: resolved.indoors,
		resolvedLightLevel: resolved.lightLevel,
		resolvedDefaultTileId: resolved.defaultTileId,
		resolvedPassageOfTime: resolved.passageOfTime,
		resolvedFaerieMorning: resolved.faerieMorning
	});
}

/**
 * An area's worked-out settings from its row
 *
 * @param row The row
 * @return The settings
 */
function resolvedOf(row: typeof areas.$inferSelect): ResolvedAreaSettings
{
	return({
		enabled: row.resolvedEnabled,
		indoors: row.resolvedIndoors,
		lightLevel: row.resolvedLightLevel,
		defaultTileId: row.resolvedDefaultTileId,
		passageOfTime: row.resolvedPassageOfTime,
		faerieMorning: row.resolvedFaerieMorning
	});
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
			targetEnabled: areas.resolvedEnabled
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
			enabled: area.resolvedEnabled,
			indoors: area.resolvedIndoors,
			passageOfTime: area.resolvedPassageOfTime
		},
		ruleset,
		time: (isLobby
			? lobbyAreaTime({
				passageOfTime: universe.lobbyPassageOfTime,
				faerieMorning: universe.lobbyFaerieMorning,
				dayHours: universe.lobbyDayHours
			})
			: areaTimeOf(area.resolvedPassageOfTime, area.resolvedFaerieMorning)),
		displayTime: universe.displayTime,
		lightLevel: area.resolvedLightLevel,
		fullVision,
		bounds: boundsOf(area),
		defaultTileId: area.resolvedDefaultTileId,
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
 * How an area's time of day is worked out from its stored passage of time
 *
 * @param passageOfTime The passage of time worked out for it, null only for the lobby's area
 * @param faerieMorning Where morning is, for faerie
 * @return The time
 */
function areaTimeOf(passageOfTime: PassageOfTime | null, faerieMorning: FaerieMorning | null): AreaTime
{
	if ((passageOfTime === 'faerie') && (faerieMorning !== null))
	{
		return({ passage: 'faerie', morning: faerieMorning });
	}

	return({ passage: (((passageOfTime === null) || (passageOfTime === 'faerie')) ? 'flows_normally' : passageOfTime) });
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

	const parents = await loadAreaParents([row], executor);

	return({
		version: {
			universeId: row.universeId,
			draft: row.draft
		},
		area: editorAreaOf(row, (parents.get(row.id) ?? []))
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
	const parents = await loadAreaParents(rows, executor);

	return(rows.map((row) => editorAreaOf(row, (parents.get(row.id) ?? []))));
}

/**
 * The parents of areas, the regions they are in and the area they are inside, in the order they were added
 *
 * @param rows The areas' rows
 * @param executor The database, or a transaction
 * @return Each area's parents, by area ID
 */
async function loadAreaParents(rows: readonly Pick<typeof areas.$inferSelect, 'id' | 'parentAreaId' | 'parentAreaAddedAt'>[], executor: Executor): Promise<Map<string, PlaceRef[]>>
{
	if (rows.length === 0)
	{
		return(new Map());
	}

	const regionRows = await executor
		.select()
		.from(areaRegions)
		.where(inArray(areaRegions.areaId, rows.map((row) => row.id)));
	const parents = new Map<string, { place: PlaceRef; addedAt: number }[]>();
	const add = (areaId: string, place: PlaceRef, addedAt: Date | null): void =>
	{
		const list = (parents.get(areaId) ?? []);

		list.push({ place, addedAt: (addedAt?.getTime() ?? 0) });
		parents.set(areaId, list);
	};

	for (const row of regionRows)
	{
		add(row.areaId, { kind: 'region', id: row.regionId }, row.addedAt);
	}

	for (const row of rows)
	{
		if (row.parentAreaId !== null)
		{
			add(row.id, { kind: 'area', id: row.parentAreaId }, row.parentAreaAddedAt);
		}
	}

	return(new Map([...parents].map(([areaId, list]) => [areaId, list
		.sort((first, second) => ((first.addedAt - second.addedAt) || first.place.id.localeCompare(second.place.id)))
		.map(({ place }) => place)])));
}

/**
 * An area's row as the editor shows it
 *
 * @param row The row
 * @param parents Its parents, in order
 * @return The area
 */
function editorAreaOf(row: typeof areas.$inferSelect, parents: PlaceRef[]): EditorArea
{
	return({
		...summaryOf(row, parents),
		bounds: boundsOf(row)
	});
}

/**
 * An area's row as the Areas tab lists it
 *
 * @param row The row
 * @param parents Its parents, in order
 * @return The area
 */
function summaryOf(row: typeof areas.$inferSelect, parents: PlaceRef[]): EditorAreaSummary
{
	return({
		id: row.id,
		name: row.name,
		parents,
		...placeSettingsOf(row),
		loopsEastWest: row.loopsEastWest,
		loopsNorthSouth: row.loopsNorthSouth,
		resolved: resolvedOf(row)
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
	const rows = await executor
		.select()
		.from(areas)
		.where(inVersion(areas, version))
		.orderBy(areas.name, areas.id);
	const parents = await loadAreaParents(rows, executor);

	return(rows.map((row) => summaryOf(row, (parents.get(row.id) ?? []))));
}

/**
 * A version's regions and areas with their own settings and parents, the kinds of the tiles it can use
 * and its lobby's area, for working out the areas' settings, with the settings each area has stored
 *
 * @param version The universe's live version or draft
 * @param ruleset The universe's ruleset
 * @param lobbyAreaId The version's lobby area
 * @param executor The database, or a transaction
 * @return The world, and each area's stored settings by ID
 */
export async function loadPlaceWorld(version: UniverseVersion, ruleset: Ruleset, lobbyAreaId: string | null, executor: Executor = db): Promise<{ world: PlaceWorld; stored: Map<string, ResolvedAreaSettings> }>
{
	const regionList = await listRegions(version, executor);
	const areaList = await listAreas(version, executor);
	const tiles = await loadUniverseTiles(version, ruleset, executor);

	return({
		world: {
			regions: regionList.map(({ builderIds: _builderIds, ...region }) => region),
			areas: areaList.map(({ resolved: _resolved, ...area }) => area),
			tileKinds: new Map(tiles.map((tile) => [tile.id, { indoors: tile.indoors, outdoors: tile.outdoors }])),
			lobbyAreaId
		},
		stored: new Map(areaList.map((area) => [area.id, area.resolved]))
	});
}

/**
 * Stores the settings worked out for areas
 *
 * @param settings The settings, by area ID
 * @param executor The database, or a transaction
 */
export async function storeResolvedSettings(settings: ReadonlyMap<string, ResolvedAreaSettings>, executor: Executor = db): Promise<void>
{
	for (const [areaId, resolved] of settings)
	{
		await executor
			.update(areas)
			.set(resolvedColumns(resolved))
			.where(eq(areas.id, areaId));
	}
}

/**
 * Gives an area its parents: the area it is inside, if any, and the regions it is in. Those it has keep
 * when they were added, and new ones are added after them in the order given
 *
 * @param areaId The area's ID
 * @param parents Its parents, of its version, at most one of them an area
 * @param executor The database, or a transaction
 */
export async function setAreaParents(areaId: string, parents: readonly PlaceRef[], executor: Executor = db): Promise<void>
{
	const parentAreaId = (parents.find((parent) => (parent.kind === 'area'))?.id ?? null);
	const regionIds = parents
		.filter((parent) => (parent.kind === 'region'))
		.map((parent) => parent.id);

	await executor
		.update(areas)
		.set({
			parentAreaId,
			parentAreaAddedAt: ((parentAreaId === null) ? null : sql`CASE WHEN ${areas.parentAreaId} IS NOT DISTINCT FROM ${parentAreaId} THEN ${areas.parentAreaAddedAt} ELSE clock_timestamp() END`)
		})
		.where(eq(areas.id, areaId));
	await executor
		.delete(areaRegions)
		.where(and(
			eq(areaRegions.areaId, areaId),
			...((regionIds.length === 0) ? [] : [notInArray(areaRegions.regionId, regionIds)])
		));

	// One row at a time, so each new region's clock_timestamp() comes after the one before
	for (const regionId of regionIds)
	{
		await executor
			.insert(areaRegions)
			.values({ areaId, regionId })
			.onConflictDoNothing();
	}
}

/**
 * Which of some areas are in a universe's version, without loading its other areas
 *
 * @param version The universe's live version or draft
 * @param areaIds The areas' IDs
 * @param executor The database, or a transaction
 * @return The IDs of those areas the version has
 */
export async function findAreaIdsIn(version: UniverseVersion, areaIds: readonly string[], executor: Executor = db): Promise<Set<string>>
{
	if (areaIds.length === 0)
	{
		return(new Set());
	}

	const rows = await executor
		.select({
			id: areas.id
		})
		.from(areas)
		.where(and(
			inVersion(areas, version),
			inArray(areas.id, [...new Set(areaIds)])
		));

	return(new Set(rows.map((row) => row.id)));
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
 * Changes some of an area's own settings; its parents change with setAreaParents()
 *
 * The database refuses a faerie passage of time without a faerie morning, a faerie morning without
 * faerie time, and an area that loops whose worked-out passage of time is faerie
 *
 * @param areaId The area's ID
 * @param update The settings to change
 * @param executor The database, or a transaction
 */
export async function updateAreaSettings(areaId: string, update: Omit<AreaSettingsUpdate, 'parents'>, executor: Executor = db): Promise<void>
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
 * Deletes an area with its cells and its links, and the links into it from other areas. Give the areas
 * inside it other parents first (setAreaParents()), or they are left inside none
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

	/**
	 * The other areas whose links into those cells were deleted; empty when it wasn't resized
	 */
	linkingAreaIds: string[];
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
		return({ resized: false, discardedCells, discardedLinks, linkingAreaIds: [] });
	}

	await storeGroundChunks(areaId, clipped, executor);

	await executor
		.delete(areaChunks)
		.where(outsideChunkCondition);

	const deletedLinks = await executor
		.delete(areaLinks)
		.where(discardedLinkCondition)
		.returning({ areaId: areaLinks.areaId });

	await executor
		.update(areas)
		.set(bounds)
		.where(eq(areas.id, areaId));

	const linkingAreaIds = new Set(deletedLinks
		.map((link) => link.areaId)
		.filter((linkAreaId) => (linkAreaId !== areaId)));

	return({ resized: true, discardedCells, discardedLinks, linkingAreaIds: [...linkingAreaIds] });
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
 * The areas of a universe whose cells are painted with a tile
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
			sql`EXISTS (SELECT 1 FROM ${areaChunks} WHERE ${areaChunks.areaId} = ${areas.id} AND ${tileId} = ANY(${areaChunks.cells}))`
		))
		.orderBy(asc(areas.name)));
}

/**
 * Paints every cell of a universe's areas holding a tile with another tile. Lock the universe first, so
 * painting can't use the tile meanwhile. The regions and areas that set it as their default tile are
 * given another by the save's other changes
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

	return([...new Set(repainted.map((chunk) => chunk.areaId))]);
}

/**
 * Whether any region or area of a universe uses a tile: as its own default tile, an area's worked-out
 * default tile, or in a cell
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
			or(
				eq(areas.defaultTileId, tileId),
				eq(areas.resolvedDefaultTileId, tileId)
			)
		))
		.limit(1);

	if (asDefault || await isRegionDefaultTile(version, tileId, executor))
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
