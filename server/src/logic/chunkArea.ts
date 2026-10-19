/**
 * Which chunks of an area's map are near its players: the ones a room keeps loaded and sends to clients
 *
 * Pure functions: no Colyseus, database, network or timers (CLAUDE.md architecture rule 4)
 */
import { chunkCoordinate, chunkKey, positiveModulo, type MapBounds } from '@multiverse-kiln/shared';

import type { Cell } from './movement.js';

/**
 * The shape of an area's map, as chunkArea needs it
 */
export interface ChunkAreaMap
{
	bounds: MapBounds;
	loopsEastWest: boolean;
	loopsNorthSouth: boolean;
}

/**
 * The chunks holding the cells within a distance of any of some cells, along each axis. On a looping
 * axis the distance reaches around the edge onto the far side
 *
 * @param cells The cells, such as where each player is
 * @param radius How many cells either side of each cell to cover
 * @param map The map's bounds and whether it loops
 * @return The chunks' keys (see chunkKey)
 */
export function chunksNear(cells: readonly Cell[], radius: number, map: ChunkAreaMap): Set<string>
{
	const { bounds } = map;
	const keys = new Set<string>();

	for (const cell of cells)
	{
		const columns = chunksAlong(cell.column, radius, bounds.minColumn, bounds.maxColumn, map.loopsEastWest);
		const rows = chunksAlong(cell.row, radius, bounds.minRow, bounds.maxRow, map.loopsNorthSouth);

		for (const chunkRow of rows)
		{
			for (const chunkColumn of columns)
			{
				keys.add(chunkKey(chunkColumn, chunkRow));
			}
		}
	}

	return(keys);
}

/**
 * The chunk columns (or rows) holding the cells within a distance of a cell along one axis
 *
 * @param center The cell's column or row
 * @param radius How many cells either side to cover
 * @param min The map's first column or row
 * @param max The map's last column or row
 * @param loops Whether the map loops along this axis
 * @return The chunk coordinates, each once
 */
function chunksAlong(center: number, radius: number, min: number, max: number, loops: boolean): number[]
{
	const size = (max - min) + 1;

	if (!loops)
	{
		const from = Math.max(min, center - radius);
		const to = Math.min(max, center + radius);

		return(((from > to) ? [] : chunkRange(from, to)));
	}

	if (((radius * 2) + 1) >= size)
	{
		return(chunkRange(min, max));
	}

	// The stretch wraps into at most two pieces, one either side of the edge
	const start = min + positiveModulo((center - radius) - min, size);
	const end = min + positiveModulo((center + radius) - min, size);

	if (start <= end)
	{
		return(chunkRange(start, end));
	}

	return([...new Set([...chunkRange(start, max), ...chunkRange(min, end)])]);
}

/**
 * The chunk coordinates covering a stretch of cells
 *
 * @param first The first cell's column or row
 * @param last The last cell's column or row, at least first
 * @return Each chunk coordinate from the first cell's to the last cell's
 */
function chunkRange(first: number, last: number): number[]
{
	const chunks: number[] = [];

	for (let chunk = chunkCoordinate(first); chunk <= chunkCoordinate(last); chunk++)
	{
		chunks.push(chunk);
	}

	return(chunks);
}
