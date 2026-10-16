/**
 * Turns a zone's map into the grid players move on
 *
 * Pure functions: no Colyseus, database, network or timers (CLAUDE.md architecture rule 4)
 */
import { IMPASSABLE_COST, tileIdAt, type ZoneLinkMode, type ZoneTiles } from '@multiverse-kiln/shared';

import type { Cell, Grid } from './movement.js';

/**
 * A cell that takes a player to a cell in another zone
 */
export interface ZoneLink
{
	column: number;
	row: number;
	targetZoneId: string;
	targetColumn: number;
	targetRow: number;
	mode: ZoneLinkMode;

	/**
	 * The link can only be used while every member of the group is present
	 */
	requiresWholeGroup: boolean;
}

/**
 * Everything about a zone's map that movement depends on
 */
export interface ZoneMap
{
	tiles: ZoneTiles;
	loopsEastWest: boolean;
	loopsNorthSouth: boolean;

	/**
	 * Movement cost of every tile the map can use, by tile ID
	 */
	tileMovementCosts: ReadonlyMap<number, number>;

	links: readonly ZoneLink[];
}

/**
 * Builds the grid for a zone's map
 *
 * A void cell, and a cell holding a tile the map doesn't know, can't be entered. Stepping onto an
 * automatic link ends the step there, so the room can take the player through it
 *
 * @param map The zone's map
 * @param cellSize Width and height of a cell in world units
 * @return The grid
 */
export function createZoneGrid(map: ZoneMap, cellSize: number): Grid
{
	const automaticLinks = new Set(map.links.filter((link) => (link.mode === 'automatic')).map((link) => linkKey(link)));

	return({
		cellSize,
		bounds: map.tiles.bounds,
		loopsEastWest: map.loopsEastWest,
		loopsNorthSouth: map.loopsNorthSouth,
		movementCost: (cell) =>
		{
			const tileId = tileIdAt(map.tiles, cell.column, cell.row);

			return(((tileId === undefined) ? IMPASSABLE_COST : (map.tileMovementCosts.get(tileId) ?? IMPASSABLE_COST)));
		},
		endsMovement: (cell) => automaticLinks.has(linkKey(cell))
	});
}

/**
 * The link on a cell
 *
 * @param map The zone's map
 * @param cell The cell
 * @return The link, or undefined when the cell has none
 */
export function linkAt(map: ZoneMap, cell: Cell): ZoneLink | undefined
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
