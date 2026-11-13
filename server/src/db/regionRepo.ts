/**
 * Regions, the regions they are inside and the builders assigned to them: the only module that reads or
 * writes the regions, region_parents and region_assignments tables (see Regions in STRUCTURE-OVERVIEW.md)
 */
import { and, asc, count, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { EditorRegion, PlaceRef, PlaceSettings, RegionSettings } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { regionAssignments, regionParents, regions } from './schema.js';
import { inVersion, type UniverseVersion } from './universeVersions.js';

/**
 * A region's settings without its parents, as its row holds them
 */
export type RegionRowSettings = Omit<RegionSettings, 'parents'>;

/**
 * The settings regions and areas share, from a row of either
 *
 * @param row The row
 * @return The settings
 */
export function placeSettingsOf(row: PlaceSettings): PlaceSettings
{
	return({
		enabled: row.enabled,
		indoors: row.indoors,
		lightLevel: row.lightLevel,
		defaultTileId: row.defaultTileId,
		passageOfTime: row.passageOfTime,
		faerieMorning: row.faerieMorning
	});
}

/**
 * Every region of a version, by name, with its parents in the order they were added and the builders
 * assigned to it (its live region's, for a region the draft copied)
 *
 * @param version The universe's live version or draft
 * @param executor The database, or a transaction
 * @return The regions
 */
export async function listRegions(version: UniverseVersion, executor: Executor = db): Promise<EditorRegion[]>
{
	const rows = await executor
		.select()
		.from(regions)
		.where(inVersion(regions, version))
		.orderBy(asc(regions.name), asc(regions.id));

	if (rows.length === 0)
	{
		return([]);
	}

	const ids = rows.map((row) => row.id);
	const parentRows = await executor
		.select({
			regionId: regionParents.regionId,
			parentRegionId: regionParents.parentRegionId
		})
		.from(regionParents)
		.where(inArray(regionParents.regionId, ids))
		.orderBy(asc(regionParents.addedAt), asc(regionParents.parentRegionId));
	const liveIds = rows.map((row) => (row.originId ?? row.id));
	const assignmentRows = await executor
		.select({
			regionId: regionAssignments.regionId,
			playerId: regionAssignments.playerId
		})
		.from(regionAssignments)
		.where(inArray(regionAssignments.regionId, liveIds))
		.orderBy(asc(regionAssignments.createdAt), asc(regionAssignments.playerId));
	const parents = groupBy(parentRows, (row) => row.regionId, (row): PlaceRef => ({ kind: 'region', id: row.parentRegionId }));
	const builders = groupBy(assignmentRows, (row) => row.regionId, (row) => row.playerId);

	return(rows.map((row) => ({
		id: row.id,
		name: row.name,
		...placeSettingsOf(row),
		parents: (parents.get(row.id) ?? []),
		builderIds: (builders.get(row.originId ?? row.id) ?? [])
	})));
}

/**
 * Lists of values grouped by a key, keeping their order
 *
 * @param rows The rows
 * @param keyOf Each row's key
 * @param valueOf Each row's value
 * @return The values, by key
 */
export function groupBy<Row, Value>(rows: readonly Row[], keyOf: (row: Row) => string, valueOf: (row: Row) => Value): Map<string, Value[]>
{
	const grouped = new Map<string, Value[]>();

	for (const row of rows)
	{
		const key = keyOf(row);
		const list = (grouped.get(key) ?? []);

		list.push(valueOf(row));
		grouped.set(key, list);
	}

	return(grouped);
}

/**
 * The version a region belongs to
 *
 * @param regionId The region's ID
 * @param executor The database, or a transaction
 * @return Its version, or undefined when there is no such region
 */
export async function findRegionVersion(regionId: string, executor: Executor = db): Promise<UniverseVersion | undefined>
{
	const [row] = await executor
		.select({
			universeId: regions.universeId,
			draft: regions.draft
		})
		.from(regions)
		.where(eq(regions.id, regionId))
		.limit(1);

	return(row);
}

/**
 * The live region a region is, or was copied from
 *
 * @param regionId The region's ID
 * @param executor The database, or a transaction
 * @return The live region's ID, or null for a region the draft added
 */
export async function findLiveRegionId(regionId: string, executor: Executor = db): Promise<string | null>
{
	const [row] = await executor
		.select({
			draft: regions.draft,
			originId: regions.originId
		})
		.from(regions)
		.where(eq(regions.id, regionId))
		.limit(1);

	if (!row)
	{
		return(null);
	}

	return((row.draft ? row.originId : regionId));
}

/**
 * How many regions a version has
 *
 * @param version The universe's live version or draft
 * @param executor The database, or a transaction
 * @return The number of regions
 */
export async function countRegions(version: UniverseVersion, executor: Executor = db): Promise<number>
{
	const [row] = await executor
		.select({
			total: count()
		})
		.from(regions)
		.where(inVersion(regions, version));

	return(row.total);
}

/**
 * Adds a region, with no parents
 *
 * @param version The universe's live version or draft
 * @param settings Its settings
 * @param executor The database, or a transaction
 * @return The new region's ID
 */
export async function createRegion(version: UniverseVersion, settings: RegionRowSettings, executor: Executor = db): Promise<string>
{
	const [created] = await executor
		.insert(regions)
		.values({
			...settings,
			universeId: version.universeId,
			draft: version.draft
		})
		.returning({ id: regions.id });

	return(created.id);
}

/**
 * Changes some of a region's settings
 *
 * @param regionId The region's ID
 * @param update The settings to change
 * @param executor The database, or a transaction
 */
export async function updateRegionSettings(regionId: string, update: Partial<RegionRowSettings>, executor: Executor = db): Promise<void>
{
	if (Object.keys(update).length === 0)
	{
		return;
	}

	await executor
		.update(regions)
		.set(update)
		.where(eq(regions.id, regionId));
}

/**
 * Gives a region its parents: those it has keep when they were added, and the new ones are added after
 * them in the order given
 *
 * @param regionId The region's ID
 * @param parentIds Its parents' IDs, regions of its version
 * @param executor The database, or a transaction
 */
export async function setRegionParents(regionId: string, parentIds: readonly string[], executor: Executor = db): Promise<void>
{
	await executor
		.delete(regionParents)
		.where(and(
			eq(regionParents.regionId, regionId),
			...((parentIds.length === 0) ? [] : [notInArray(regionParents.parentRegionId, [...parentIds])])
		));

	// One row at a time, so each new parent's clock_timestamp() comes after the one before
	for (const parentRegionId of parentIds)
	{
		await executor
			.insert(regionParents)
			.values({ regionId, parentRegionId })
			.onConflictDoNothing();
	}
}

/**
 * Deletes a region, with its parents and the places it is a parent of losing it, and its assignments
 *
 * @param regionId The region's ID
 * @param executor The database, or a transaction
 */
export async function deleteRegion(regionId: string, executor: Executor = db): Promise<void>
{
	await executor
		.delete(regions)
		.where(eq(regions.id, regionId));
}

/**
 * Whether any region of a version sets a tile as its default tile
 *
 * @param version The universe's live version or draft
 * @param tileId The tile's ID
 * @param executor The database, or a transaction
 * @return True when one does
 */
export async function isRegionDefaultTile(version: UniverseVersion, tileId: number, executor: Executor = db): Promise<boolean>
{
	const [row] = await executor
		.select({
			id: regions.id
		})
		.from(regions)
		.where(and(
			inVersion(regions, version),
			eq(regions.defaultTileId, tileId)
		))
		.limit(1);

	return(row !== undefined);
}

/**
 * Assigns builders to a live region, replacing those assigned to it
 *
 * @param universeId The universe's ID
 * @param regionId The live region's ID
 * @param playerIds The builders' IDs, each one of the universe's editors
 * @param executor The database, or a transaction
 */
export async function setRegionAssignments(universeId: string, regionId: string, playerIds: readonly string[], executor: Executor = db): Promise<void>
{
	await executor
		.delete(regionAssignments)
		.where(and(
			eq(regionAssignments.regionId, regionId),
			...((playerIds.length === 0) ? [] : [notInArray(regionAssignments.playerId, [...playerIds])])
		));

	if (playerIds.length > 0)
	{
		await executor
			.insert(regionAssignments)
			.values(playerIds.map((playerId) => ({ regionId, universeId, playerId })))
			.onConflictDoNothing();
	}
}

/**
 * Takes every region assignment of a universe from one of its editors, as they stop being a builder
 *
 * @param universeId The universe's ID
 * @param playerId The editor's ID
 * @param executor The database, or a transaction
 */
export async function deleteBuilderAssignments(universeId: string, playerId: string, executor: Executor = db): Promise<void>
{
	await executor
		.delete(regionAssignments)
		.where(and(
			eq(regionAssignments.universeId, universeId),
			eq(regionAssignments.playerId, playerId)
		));
}

/**
 * The regions of a version a builder is assigned to: the live regions, or the draft's copies of them
 *
 * @param version The universe's live version or draft
 * @param playerId The builder's ID
 * @param executor The database, or a transaction
 * @return The regions' IDs in that version
 */
export async function listAssignedRegionIds(version: UniverseVersion, playerId: string, executor: Executor = db): Promise<string[]>
{
	const rows = await executor
		.select({
			id: regions.id
		})
		.from(regions)
		.innerJoin(regionAssignments, eq(regionAssignments.regionId, sql`coalesce(${regions.originId}, ${regions.id})`))
		.where(and(
			inVersion(regions, version),
			eq(regionAssignments.playerId, playerId)
		));

	return(rows.map((row) => row.id));
}

/**
 * The live regions each of a universe's builders is assigned to
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The regions' IDs, by player ID, in the order they were assigned
 */
export async function listAssignmentsByBuilder(universeId: string, executor: Executor = db): Promise<Map<string, string[]>>
{
	const rows = await executor
		.select({
			regionId: regionAssignments.regionId,
			playerId: regionAssignments.playerId
		})
		.from(regionAssignments)
		.where(eq(regionAssignments.universeId, universeId))
		.orderBy(asc(regionAssignments.createdAt), asc(regionAssignments.regionId));

	return(groupBy(rows, (row) => row.playerId, (row) => row.regionId));
}
