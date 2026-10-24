/**
 * What a character can see (see Vision in STRUCTURE-OVERVIEW.md)
 *
 * A character looks along straight lines from their cell. Each step along a line spends some of their
 * vision budget: its length in squares (a diagonal step counts as one and a half, as in movement), more
 * when it leaves a cell with a vision cost (50% doubles it). A cell with
 * OPAQUE_VISION_COST can be seen but not seen past, so a line of mountains blocks the view; it is also
 * seen when open ground on one of its sides is, or diagonally beside it at an inside corner, so the walls
 * lining a corridor show along its length. The budget
 * is shorter at night and in dark indoor areas unless the character has darkvision. The server uses this to decide which players
 * each client is shown, and the client to draw fog over the cells out of sight
 */
import { isInBounds, nearestCopy, positiveModulo, tileIdAt, type AreaTiles, type MapBounds } from './maps.js';

/**
 * How many squares a character can see in full daylight
 */
export const DAY_VISION_SQUARES = 20;

/**
 * How many squares a character without darkvision can see at night
 */
export const NIGHT_VISION_SQUARES = 4;

/**
 * How many squares darkvision sees in the dark: 60 feet, as in PF1E and SF1E
 */
export const DARKVISION_SQUARES = 12;

/**
 * Vision cost of a cell nobody can see past, in percent
 */
export const OPAQUE_VISION_COST = 100;

/**
 * Everything about an area's map that vision depends on
 */
export interface VisionMap
{
	bounds: MapBounds;
	loopsEastWest: boolean;
	loopsNorthSouth: boolean;

	/**
	 * How much harder a cell on the map is to see past, in percent: 0 is clear, 50 spends twice as much
	 * of the budget, and OPAQUE_VISION_COST can't be seen past
	 *
	 * @param column The cell's column, inside the bounds
	 * @param row The cell's row, inside the bounds
	 * @return The vision cost
	 */
	visionCost: (column: number, row: number) => number;
}

/**
 * A cell of a map
 */
export interface VisionCell
{
	column: number;
	row: number;
}

/**
 * An area's tiles as vision sees them. A void cell is nothing at all, so it is seen past, as are a cell
 * holding a tile the map doesn't know and a cell the client hasn't been sent (UNSEEN_CELL)
 *
 * @param tiles The area's tiles
 * @param loopsEastWest Whether the area loops east-west
 * @param loopsNorthSouth Whether the area loops north-south
 * @param tileVisionCosts The vision cost of each tile the map can use, by tile ID
 * @return The map
 */
export function createVisionMap(tiles: AreaTiles, loopsEastWest: boolean, loopsNorthSouth: boolean, tileVisionCosts: ReadonlyMap<number, number>): VisionMap
{
	return({
		bounds: tiles.bounds,
		loopsEastWest,
		loopsNorthSouth,
		visionCost: (column, row) =>
		{
			const tileId = tileIdAt(tiles, column, row);

			return(((tileId === undefined) ? 0 : (tileVisionCosts.get(tileId) ?? 0)));
		}
	});
}

/**
 * How many squares a character can see in the light around them
 *
 * @param light How light it is where the character is, from 0 in the dark to 1 in full daylight (see areaLight)
 * @param darkvision Whether the character has darkvision
 * @param fullVision Whether the area ignores the light (AreaPayload.fullVision)
 * @return The vision budget: NIGHT_VISION_SQUARES in the dark up to DAY_VISION_SQUARES in full
 * daylight, and never under DARKVISION_SQUARES with darkvision; always DAY_VISION_SQUARES with full vision
 */
export function visionBudget(light: number, darkvision: boolean, fullVision: boolean): number
{
	if (fullVision)
	{
		return(DAY_VISION_SQUARES);
	}

	const budget = NIGHT_VISION_SQUARES + ((DAY_VISION_SQUARES - NIGHT_VISION_SQUARES) * light);

	return((darkvision ? Math.max(budget, DARKVISION_SQUARES) : budget));
}

/**
 * Whether a character can see a cell
 *
 * @param from The character's cell
 * @param to The cell to look at
 * @param budget The character's vision budget (visionBudget)
 * @param map The map
 * @return True when the cell is on the map and seen (see isSeen); on a map that loops, along the
 * shorter way round
 */
export function canSee(from: VisionCell, to: VisionCell, budget: number, map: VisionMap): boolean
{
	if (!isInBounds(map.bounds, to.column, to.row))
	{
		return(false);
	}

	const { width, height } = sizeOf(map.bounds);
	const column = (map.loopsEastWest ? nearestCopy(to.column, from.column, width) : to.column);
	const row = (map.loopsNorthSouth ? nearestCopy(to.row, from.row, height) : to.row);

	return(isSeen(from, column - from.column, row - from.row, budget, map));
}

/**
 * Every cell a character can see
 *
 * @param from The character's cell
 * @param budget The character's vision budget (visionBudget)
 * @param map The map
 * @return The cells, as "column,row" (visionKey); on a map that loops, as the cells on the map
 */
export function visibleCells(from: VisionCell, budget: number, map: VisionMap): Set<string>
{
	const visible = new Set<string>();
	const reach = Math.floor(budget);

	for (let rows = -reach; rows <= reach; rows++)
	{
		for (let columns = -reach; columns <= reach; columns++)
		{
			const cell = wrap({ column: from.column + columns, row: from.row + rows }, map);

			if (isInBounds(map.bounds, cell.column, cell.row) && isSeen(from, columns, rows, budget, map))
			{
				visible.add(visionKey(cell.column, cell.row));
			}
		}
	}

	return(visible);
}

/**
 * The key visibleCells() gives a cell
 *
 * @param column The cell's column
 * @param row The cell's row
 * @return "column,row"
 */
export function visionKey(column: number, row: number): string
{
	return(`${column},${row}`);
}

/**
 * Whether a cell some columns and rows away can be seen: the line to it spends no more than the budget,
 * or it can't be seen past and open ground beside it is in sight
 *
 * A straight line to a wall further along a corridor passes through the nearer walls lining it, so
 * without the second rule the sides of a corridor would be hidden while its floor is in sight. The inside
 * of a thick wall stays hidden, since it touches only more wall, and so does the far side of one.
 * Open ground diagonally beside a wall only counts at an inside corner (isCornerOrSide), so a wall
 * doesn't show when the open ground on its sides is hidden
 *
 * @param from The cell looked from
 * @param columns How many columns away the other cell is, which may be past a looping edge
 * @param rows How many rows away the other cell is, likewise
 * @param budget The vision budget
 * @param map The map
 * @return True when the other cell can be seen
 */
function isSeen(from: VisionCell, columns: number, rows: number, budget: number, map: VisionMap): boolean
{
	if (isInSight(from, columns, rows, budget, map))
	{
		return(true);
	}

	const target = { column: from.column + columns, row: from.row + rows };

	if ((visionCostAt(target, map) < OPAQUE_VISION_COST) || (shortestDistance(columns, rows) > budget))
	{
		return(false);
	}

	for (let rowStep = -1; rowStep <= 1; rowStep++)
	{
		for (let columnStep = -1; columnStep <= 1; columnStep++)
		{
			const beside = { column: target.column + columnStep, row: target.row + rowStep };

			if (((columnStep !== 0) || (rowStep !== 0)) && isCornerOrSide(target, columnStep, rowStep, map) && (visionCostAt(beside, map) < OPAQUE_VISION_COST) && isInSight(from, columns + columnStep, rows + rowStep, budget, map))
			{
				return(true);
			}
		}
	}

	return(false);
}

/**
 * Whether the cell one step from a wall can show the wall: one on its side, or one diagonally beside it
 * at an inside corner, where both cells between them can't be seen past either, as in a room's corner
 *
 * @param wall The wall's cell
 * @param columnStep How many columns the other cell is from the wall: -1, 0 or 1
 * @param rowStep How many rows the other cell is from the wall: -1, 0 or 1
 * @param map The map
 * @return True when the other cell is on the wall's side or at an inside corner
 */
function isCornerOrSide(wall: VisionCell, columnStep: number, rowStep: number, map: VisionMap): boolean
{
	if ((columnStep === 0) || (rowStep === 0))
	{
		return(true);
	}

	return((visionCostAt({ column: wall.column + columnStep, row: wall.row }, map) >= OPAQUE_VISION_COST) && (visionCostAt({ column: wall.column, row: wall.row + rowStep }, map) >= OPAQUE_VISION_COST));
}

/**
 * The fewest squares a line some columns and rows long can spend: its length, with each diagonal step
 * counting as one and a half
 *
 * @param columns How many columns it crosses
 * @param rows How many rows it crosses
 * @return Its length in squares
 */
function shortestDistance(columns: number, rows: number): number
{
	return(Math.max(Math.abs(columns), Math.abs(rows)) + (Math.min(Math.abs(columns), Math.abs(rows)) / 2));
}

/**
 * Whether the line from a cell to another, some columns and rows away, spends no more than the budget
 *
 * The line steps one column or row at a time along its longer side, through the cells nearest it, the
 * same way in every direction, so a view mirrored east to west or north to south is mirrored too
 *
 * @param from The cell looked from
 * @param columns How many columns away the other cell is, which may be past a looping edge
 * @param rows How many rows away the other cell is, likewise
 * @param budget The vision budget
 * @param map The map
 * @return True when the other cell can be seen
 */
function isInSight(from: VisionCell, columns: number, rows: number, budget: number, map: VisionMap): boolean
{
	const steps = Math.max(Math.abs(columns), Math.abs(rows));

	// The shortest any line there could be, before walking it
	if (shortestDistance(columns, rows) > budget)
	{
		return(false);
	}

	let spent = 0;
	let previous = from;

	for (let step = 1; step <= steps; step++)
	{
		const cell = {
			column: from.column + roundAwayFromZero((columns * step) / steps),
			row: from.row + roundAwayFromZero((rows * step) / steps)
		};
		const length = (((cell.column !== previous.column) && (cell.row !== previous.row)) ? 1.5 : 1);

		// The character's own cell doesn't get in their way
		const cost = ((step === 1) ? 0 : visionCostAt(previous, map));

		if (cost >= OPAQUE_VISION_COST)
		{
			return(false);
		}

		spent += length * (OPAQUE_VISION_COST / (OPAQUE_VISION_COST - cost));

		if (spent > budget)
		{
			return(false);
		}

		previous = cell;
	}

	return(true);
}

/**
 * The vision cost of a cell, which may be past a looping edge
 *
 * @param cell The cell
 * @param map The map
 * @return Its vision cost; OPAQUE_VISION_COST off the map
 */
function visionCostAt(cell: VisionCell, map: VisionMap): number
{
	const wrapped = wrap(cell, map);

	if (!isInBounds(map.bounds, wrapped.column, wrapped.row))
	{
		return(OPAQUE_VISION_COST);
	}

	return(map.visionCost(wrapped.column, wrapped.row));
}

/**
 * The cell on the map a cell past a looping edge stands for
 *
 * @param cell The cell
 * @param map The map
 * @return The cell, unchanged along an axis that doesn't loop
 */
function wrap(cell: VisionCell, map: VisionMap): VisionCell
{
	const { minColumn, minRow } = map.bounds;
	const { width, height } = sizeOf(map.bounds);

	return({
		column: (map.loopsEastWest ? minColumn + positiveModulo(cell.column - minColumn, width) : cell.column),
		row: (map.loopsNorthSouth ? minRow + positiveModulo(cell.row - minRow, height) : cell.row)
	});
}

/**
 * How many cells across and down a map is
 *
 * @param bounds The map's bounds
 * @return Its width and height in cells
 */
function sizeOf(bounds: MapBounds): { width: number; height: number }
{
	return({
		width: (bounds.maxColumn - bounds.minColumn) + 1,
		height: (bounds.maxRow - bounds.minRow) + 1
	});
}

/**
 * Rounds to the nearest whole number, with halves away from zero, so a line rounds the same way in
 * every direction
 *
 * @param value The number
 * @return The whole number
 */
function roundAwayFromZero(value: number): number
{
	return(Math.sign(value) * Math.round(Math.abs(value)));
}
