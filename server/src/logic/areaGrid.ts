/**
 * Turns an area's map into the grid players move on
 *
 * Pure functions: no Colyseus, database, network or timers (CLAUDE.md architecture rule 4)
 */
import { chunkCoordinate, chunkKey, IMPASSABLE_COST, tileIdAt, type AreaLinkMode, type AreaTiles } from '@multiverse-kiln/shared';

import type { Cell, Grid } from './movement.js';

/**
 * A cell that takes a player to a cell in another area
 */
export interface AreaLink
{
	column: number;
	row: number;
	targetAreaId: string;
	targetColumn: number;
	targetRow: number;
	mode: AreaLinkMode;

	/**
	 * The link can only be used while every member of the group is present
	 */
	requiresWholeGroup: boolean;
}

/**
 * Everything about an area's map that movement depends on
 */
export interface AreaMap
{
	tiles: AreaTiles;
	loopsEastWest: boolean;
	loopsNorthSouth: boolean;

	/**
	 * Movement cost of every tile the map can use, by tile ID
	 */
	tileMovementCosts: ReadonlyMap<number, number>;

	links: readonly AreaLink[];

	/**
	 * The chunks loaded so far, by chunkKey(), when the map is loaded a piece at a time; undefined when
	 * all of it is. tiles.chunks holds the loaded chunks that aren't all the default tile
	 */
	loadedChunks?: ReadonlySet<string>;
}

/**
 * Builds the grid for an area's map
 *
 * A void cell, a cell holding a tile the map doesn't know, and a cell whose chunk hasn't loaded can't
 * be entered, so a player waits at the edge of a chunk until it arrives. Stepping onto an automatic
 * link ends the step there, so the room can take the player through it
 *
 * @param map The area's map
 * @param cellSize Width and height of a cell in world units
 * @return The grid
 */
export function createAreaGrid(map: AreaMap, cellSize: number): Grid
{
	const automaticLinks = new Set(map.links.filter((link) => (link.mode === 'automatic')).map((link) => linkKey(link)));

	return({
		cellSize,
		bounds: map.tiles.bounds,
		loopsEastWest: map.loopsEastWest,
		loopsNorthSouth: map.loopsNorthSouth,
		movementCost: (cell) =>
		{
			if (map.loadedChunks && !map.loadedChunks.has(chunkKey(chunkCoordinate(cell.column), chunkCoordinate(cell.row))))
			{
				return(IMPASSABLE_COST);
			}

			const tileId = tileIdAt(map.tiles, cell.column, cell.row);

			return(((tileId === undefined) ? IMPASSABLE_COST : (map.tileMovementCosts.get(tileId) ?? IMPASSABLE_COST)));
		},
		endsMovement: (cell) => automaticLinks.has(linkKey(cell))
	});
}

/**
 * The link on a cell
 *
 * @param map The area's map
 * @param cell The cell
 * @return The link, or undefined when the cell has none
 */
export function linkAt(map: AreaMap, cell: Cell): AreaLink | undefined
{
	return(map.links.find((link) => ((link.column === cell.column) && (link.row === cell.row))));
}

/**
 * A key identifying a cell, for looking links up
 *
 * @param cell The cell
 * @return The key
 */
function linkKey(cell: Cell): string
{
	return(`${cell.column},${cell.row}`);
}
