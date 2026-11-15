import assert from 'assert';
import { randomUUID } from 'node:crypto';
import { blockedArrivals, cellIndexInChunk, chunkCoordinate, chunkKey, DEFAULT_TILE_CELL, type Arrival, type ArrivalArea } from '@multiverse-kiln/shared';

import { loadUniverseTiles } from '../src/db/tileRepo.js';
import { liveVersion } from '../src/db/universeVersions.js';
import { parseArea, requireMarker, requireTile, sampleAreas, sampleLinks, sampleRegions, sampleTiles, sampleUniverse, type ParsedArea, type SampleArea } from '../scripts/sampleUniverse.js';

/**
 * The key of the default tile an area of the sample universe has: its own, or the one it inherits from
 * the area it is inside, or else from its regions
 *
 * @param area The area
 * @return The tile's key
 */
function defaultTileOf(area: SampleArea): string
{
	if (area.defaultTile !== undefined)
	{
		return(area.defaultTile);
	}

	const parent = sampleAreas.find((each) => (each.key === area.parentArea));

	if (parent)
	{
		return(defaultTileOf(parent));
	}

	let regionKeys = area.regions;

	while (regionKeys.length > 0)
	{
		const regions = sampleRegions.filter((region) => regionKeys.includes(region.key));
		const tile = regions.find((region) => (region.defaultTile !== undefined))?.defaultTile;

		if (tile !== undefined)
		{
			return(tile);
		}

		regionKeys = regions.flatMap((region) => region.parents);
	}

	throw new Error(`${area.key} has no default tile`);
}

describe('The sample universe', () =>
{
	it('sends characters only to squares they can walk on', async () =>
	{
		const defaultTiles = await loadUniverseTiles(liveVersion(randomUUID()), 'pf1e');
		const tileIds = new Map(defaultTiles.flatMap((tile) => ((tile.key === null) ? [] : [[tile.key, tile.id] as const])));
		const walkSeconds = new Map(defaultTiles.map((tile) => [tile.id, tile.walkSeconds]));

		// The universe's own tiles get IDs past the default tiles'
		Object.values(sampleTiles).forEach((tile, index) =>
		{
			const id = 1000000 + index;

			tileIds.set(tile.key, id);
			walkSeconds.set(id, tile.walkSeconds);
		});

		const parsed = new Map<string, ParsedArea>(sampleAreas.map((area) => [area.key, parseArea(area, tileIds)]));
		const areas = new Map<string, ArrivalArea>(sampleAreas.map((area) => [area.key, {
			bounds: parsed.get(area.key)!.bounds,
			defaultTileId: requireTile(tileIds, defaultTileOf(area))
		}]));
		const square = (source: Arrival['source'], areaKey: string, marker: string): Arrival => ({ source, areaId: areaKey, ...requireMarker(parsed, areaKey, marker) });
		const arrivals: Arrival[] = [
			square({ kind: 'universe' }, sampleUniverse.startingArea, sampleUniverse.startingSquare),
			square({ kind: 'lobby' }, sampleUniverse.lobbyArea, sampleUniverse.lobbySquare),
			...sampleLinks.map((link) => square({ kind: 'link', areaId: link.from[0], ...requireMarker(parsed, ...link.from) }, ...link.to))
		];
		const cellAt = (areaKey: string, column: number, row: number): number => (parsed.get(areaKey)?.chunks.get(chunkKey(chunkCoordinate(column), chunkCoordinate(row)))?.cells[cellIndexInChunk(column, row)] ?? DEFAULT_TILE_CELL);

		assert.deepStrictEqual(blockedArrivals(arrivals, areas, cellAt, walkSeconds), []);

		// The middle of the kingdom is in its river, and of the lobby on its hedge
		assert.deepStrictEqual(blockedArrivals([
			{ source: { kind: 'universe' }, areaId: 'kingdom', column: 0, row: 0 },
			{ source: { kind: 'lobby' }, areaId: 'lobby', column: 0, row: 0 }
		], areas, cellAt, walkSeconds).map((problem) => problem.tileId), [requireTile(tileIds, 'water'), requireTile(tileIds, 'hedge')]);
	});
});
