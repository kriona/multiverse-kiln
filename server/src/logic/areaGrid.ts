/**
 * Turns an area's layout into the grid players move on
 *
 * Pure functions: no Colyseus, database, network or timers (CLAUDE.md architecture rule 4)
 */
import { chunkCoordinate, chunkKey, defaultWalkSeconds, IMPASSABLE_WALK_SECONDS, isInBounds, tileIdAt, type AreaLinkMode, type AreaTiles } from '@multiverse-kiln/shared';

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
 * Everything about an area's layout that movement depends on
 */
export interface AreaLayout
{
	tiles: AreaTiles;

	/**
	 * Whether the area is indoors, which sets the walk seconds crossed at full speed (defaultWalkSeconds)
	 */
	indoors: boolean;

	loopsEastWest: boolean;
	loopsNorthSouth: boolean;

	/**
	 * Walk seconds of every tile the area can use, by tile ID
	 */
	tileWalkSeconds: ReadonlyMap<number, number>;

	links: readonly AreaLink[];

	/**
	 * The chunks loaded so far, by chunkKey(), when the area is loaded a piece at a time; undefined when
	 * all of it is. tiles.chunks holds the loaded chunks that aren't all the default tile
	 */
	loadedChunks?: ReadonlySet<string>;
}

/**
 * Builds the grid for an area
 *
 * A void cell, a cell holding a tile the area doesn't know, and a cell whose chunk hasn't loaded can't
 * be entered, so a player waits at the edge of a chunk until it arrives. Stepping onto an automatic
 * link ends the step there, so the room can take the player through it
 *
 * For an area with neighbors, a cell outside the bounds takes its walk seconds from the neighbor across
 * the seam, and stepping onto it ends the step there, so the room can move the player into the neighbor
 *
 * @param layout The area's layout
 * @param cellSize Width and height of a cell in world units
 * @param beyond For an area with neighbors, the walk seconds of a cell outside the bounds, in the
 * neighboring area across the seam, or undefined for one past an edge
 * @return The grid
 */
export function createAreaGrid(layout: AreaLayout, cellSize: number, beyond?: (cell: Cell) => number | undefined): Grid
{
	const automaticLinks = new Set(layout.links.filter((link) => (link.mode === 'automatic')).map((link) => linkKey(link)));
	const { bounds } = layout.tiles;

	return({
		cellSize,
		bounds,
		loopsEastWest: layout.loopsEastWest,
		loopsNorthSouth: layout.loopsNorthSouth,
		fullSpeedWalkSeconds: defaultWalkSeconds(layout.indoors),
		walkSeconds: (cell) =>
		{
			if (!isInBounds(bounds, cell.column, cell.row))
			{
				return(beyond?.(cell) ?? IMPASSABLE_WALK_SECONDS);
			}

			if (layout.loadedChunks && !layout.loadedChunks.has(chunkKey(chunkCoordinate(cell.column), chunkCoordinate(cell.row))))
			{
				return(IMPASSABLE_WALK_SECONDS);
			}

			const tileId = tileIdAt(layout.tiles, cell.column, cell.row);

			return(((tileId === undefined) ? IMPASSABLE_WALK_SECONDS : (layout.tileWalkSeconds.get(tileId) ?? IMPASSABLE_WALK_SECONDS)));
		},
		endsMovement: (cell) => (automaticLinks.has(linkKey(cell)) || !isInBounds(bounds, cell.column, cell.row)),
		...((beyond === undefined)
			? {}
			: {
				crossesSeam: (cell: Cell) => (!isInBounds(bounds, cell.column, cell.row) && (beyond(cell) !== undefined))
			})
	});
}

/**
 * The link on a cell
 *
 * @param layout The area's layout
 * @param cell The cell
 * @return The link, or undefined when the cell has none
 */
export function linkAt(layout: AreaLayout, cell: Cell): AreaLink | undefined
{
	return(layout.links.find((link) => ((link.column === cell.column) && (link.row === cell.row))));
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
