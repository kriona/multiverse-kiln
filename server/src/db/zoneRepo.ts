/**
 * Zones, their maps and their links: the only module that reads or writes the zones, map_chunks and
 * zone_links tables
 */
import { and, eq } from 'drizzle-orm';
import { chunkKey, type MapBounds, type ZonePassageOfTime } from '@multiverse-kiln/shared';

import type { ZoneLink, ZoneMap } from '../logic/zoneGrid.js';
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
	map: ZoneMap;

	/**
	 * Every tile the map can use, for drawing it
	 */
	tiles: TileRecord[];
}

/**
 * What a new zone needs
 */
export type NewZone = Pick<typeof zones.$inferInsert, 'universeId' | 'parentZoneId' | 'name' | 'enabled' | 'indoors' | 'defaultTileId' | 'loopsEastWest' | 'loopsNorthSouth' | 'passageOfTime'> & { bounds: MapBounds };

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
 * Loads a zone and its whole ground layer
 *
 * Every stored chunk is loaded. That suits the small maps made so far; a map that fills a large part of
 * MAX_MAP_SIDE would need its chunks loaded as players approach them instead
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
	const chunkRows = await executor
		.select({
			chunkColumn: mapChunks.chunkColumn,
			chunkRow: mapChunks.chunkRow,
			cells: mapChunks.cells
		})
		.from(mapChunks)
		.where(and(eq(mapChunks.zoneId, zoneId), eq(mapChunks.layer, GROUND_LAYER)));

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
		map: {
			tiles: {
				bounds: { minColumn: zone.minColumn, minRow: zone.minRow, maxColumn: zone.maxColumn, maxRow: zone.maxRow },
				defaultTileId: zone.defaultTileId,
				chunks: new Map(chunkRows.map((chunk) => [chunkKey(chunk.chunkColumn, chunk.chunkRow), chunk.cells]))
			},
			loopsEastWest: zone.loopsEastWest,
			loopsNorthSouth: zone.loopsNorthSouth,
			tileMovementCosts: new Map(tiles.map((tile) => [tile.id, tile.movementCost])),
			links: linkRows.map((link) => ({
				column: link.column,
				row: link.row,
				targetZoneId: link.targetZoneId,
				targetColumn: link.targetColumn,
				targetRow: link.targetRow,
				mode: link.mode,
				requiresWholeGroup: link.requiresWholeGroup
			}))
		},
		tiles
	});
}
