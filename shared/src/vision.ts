/**
 * What a character can see (see Vision in STRUCTURE-OVERVIEW.md)
 *
 * A character looks along straight lines from their cell. Each step along a line spends some of their
 * vision budget: its length in squares (a diagonal step counts as one and a half, as in movement), more
 * when it leaves a cell with a vision cost (50% doubles it). A cell with
 * OPAQUE_VISION_COST can be seen but not seen past, so a line of mountains blocks the view; it is also
 * seen when open ground on one of its sides is, or diagonally beside it at an inside corner, so the walls
 * lining a corridor show along its length. The budget
 * is shorter at night and in dark indoor areas unless the character has darkvision, and shorter in bright light when they
 * have light sensitivity. The server uses this to decide which players
 * each client is shown, and the client to draw fog over the cells out of sight
 */
import { defineMessages, type MessageDescriptor } from './localization.js';
import { isInBounds, nearestCopy, positiveModulo, tileIdAt, type AreaBounds, type AreaTiles } from './areaCells.js';

/**
 * How well a race sees in the dark: not at all, darkvision (60 feet) or superior darkvision (120 feet)
 */
export const DARKVISIONS = [
	'none',
	'normal',
	'superior'
] as const;

export type Darkvision = typeof DARKVISIONS[number];

/**
 * Each kind of darkvision's name, the race editor's choices for it and the character sheet's value
 */
export const DARKVISION_NAMES: Record<Darkvision, MessageDescriptor> = defineMessages({
	none: {
		id: 'darkvision.none',
		defaultMessage: 'None',
		description: 'A race that can\'t see in the dark: a choice in the race editor\'s Darkvision field, and the Darkvision value on a character\'s sheet'
	},
	normal: {
		id: 'darkvision.normal',
		defaultMessage: 'Darkvision (60 feet)',
		description: 'A race that sees 60 feet in the dark: a choice in the race editor\'s Darkvision field, and the Darkvision value on a character\'s sheet'
	},
	superior: {
		id: 'darkvision.superior',
		defaultMessage: 'Superior darkvision (120 feet)',
		description: 'A race that sees 120 feet in the dark, such as drow: a choice in the race editor\'s Darkvision field, and the Darkvision value on a character\'s sheet'
	}
});

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
 * How many squares superior darkvision sees in the dark: 120 feet, as in PF1E
 */
export const SUPERIOR_DARKVISION_SQUARES = 24;

/**
 * The share of their vision budget a character with light sensitivity keeps in full daylight, being
 * dazzled; less light takes less away
 */
export const LIGHT_SENSITIVE_VISION_SHARE = 0.5;

/**
 * Vision cost of a cell nobody can see past, in percent
 */
export const OPAQUE_VISION_COST = 100;

/**
 * Everything about an area that vision depends on
 */
export interface VisionArea
{
	bounds: AreaBounds;
	loopsEastWest: boolean;
	loopsNorthSouth: boolean;

	/**
	 * Whether every cell's vision cost is 0, as in an area whose tiles have none, so a cell is seen
	 * whenever it is near enough and no line to it needs walking
	 */
	clear: boolean;

	/**
	 * How much harder a cell of the area is to see past, in percent: 0 is clear, 50 spends twice as much
	 * of the budget, and OPAQUE_VISION_COST can't be seen past
	 *
	 * @param column The cell's column, inside the bounds
	 * @param row The cell's row, inside the bounds
	 * @return The vision cost
	 */
	visionCost: (column: number, row: number) => number;
}

/**
 * A cell of an area
 */
export interface VisionCell
{
	column: number;
	row: number;
}

/**
 * An area's tiles as vision sees them. A void cell is nothing at all, so it is seen past, as are a cell
 * holding a tile the area doesn't know and a cell the client hasn't been sent (UNSEEN_CELL)
 *
 * @param tiles The area's tiles
 * @param loopsEastWest Whether the area loops east-west
 * @param loopsNorthSouth Whether the area loops north-south
 * @param tileVisionCosts The vision cost of each tile the area can use, by tile ID
 * @return The area as vision sees it
 */
export function createVisionArea(tiles: AreaTiles, loopsEastWest: boolean, loopsNorthSouth: boolean, tileVisionCosts: ReadonlyMap<number, number>): VisionArea
{
	return({
		bounds: tiles.bounds,
		loopsEastWest,
		loopsNorthSouth,
		clear: [...tileVisionCosts.values()].every((cost) => (cost === 0)),
		visionCost: (column, row) =>
		{
			const tileId = tileIdAt(tiles, column, row);

			return(((tileId === undefined) ? 0 : (tileVisionCosts.get(tileId) ?? 0)));
		}
	});
}

/**
 * How many squares a kind of darkvision sees in the dark
 *
 * @param darkvision The darkvision
 * @return DARKVISION_SQUARES or SUPERIOR_DARKVISION_SQUARES; 0 without darkvision
 */
export function darkvisionSquares(darkvision: Darkvision): number
{
	switch (darkvision)
	{
		case 'none':
			return(0);

		case 'normal':
			return(DARKVISION_SQUARES);

		case 'superior':
			return(SUPERIOR_DARKVISION_SQUARES);
	}
}

/**
 * What a character's race changes about how far they see
 */
export interface Sight
{
	/**
	 * How many squares the character sees in the dark (darkvisionSquares); 0 without darkvision
	 */
	darkvision: number;

	/**
	 * Whether bright light dazzles the character
	 */
	lightSensitivity: boolean;
}

/**
 * The sight of a character with no darkvision or light sensitivity
 */
export const PLAIN_SIGHT: Readonly<Sight> = {
	darkvision: 0,
	lightSensitivity: false
};

/**
 * How many squares a character can see in the light around them
 *
 * @param light How light it is where the character is, from 0 in the dark to 1 in full daylight (see areaLight)
 * @param sight The character's darkvision and light sensitivity
 * @return The vision budget: NIGHT_VISION_SQUARES in the dark up to DAY_VISION_SQUARES in full
 * daylight, never under the darkvision's squares, and with light sensitivity down to
 * LIGHT_SENSITIVE_VISION_SHARE of that in full daylight
 */
export function visionBudget(light: number, sight: Sight): number
{
	const budget = Math.max(NIGHT_VISION_SQUARES + ((DAY_VISION_SQUARES - NIGHT_VISION_SQUARES) * light), sight.darkvision);

	return((sight.lightSensitivity ? budget * (1 - ((1 - LIGHT_SENSITIVE_VISION_SHARE) * light)) : budget));
}

/**
 * Whether a character can see a cell
 *
 * @param from The character's cell
 * @param to The cell to look at
 * @param budget The character's vision budget (visionBudget)
 * @param area The area
 * @return True when the cell is inside the area and seen (see isSeen); in an area that loops, along the
 * shorter way round
 */
export function canSee(from: VisionCell, to: VisionCell, budget: number, area: VisionArea): boolean
{
	if (!isInBounds(area.bounds, to.column, to.row))
	{
		return(false);
	}

	const { width, height } = sizeOf(area.bounds);
	const column = (area.loopsEastWest ? nearestCopy(to.column, from.column, width) : to.column);
	const row = (area.loopsNorthSouth ? nearestCopy(to.row, from.row, height) : to.row);
	const costAt = (area.clear ? undefined : (columns: number, rows: number): number => visionCostAt(from.column + columns, from.row + rows, area));

	return(isSeen(column - from.column, row - from.row, budget, costAt));
}

/**
 * Every cell a character can see
 *
 * @param from The character's cell
 * @param budget The character's vision budget (visionBudget)
 * @param area The area
 * @param skip Which cells to leave out without looking at them, such as those a group has already seen,
 * given the cell inside the area; none when undefined
 * @return The cells, as "column,row" (visionKey); in an area that loops, as the cells inside the area,
 * each seen or not along the shorter way round, as canSee() looks at it
 */
export function visibleCells(from: VisionCell, budget: number, area: VisionArea, skip?: (column: number, row: number) => boolean): Set<string>
{
	const visible = new Set<string>();
	const reach = Math.floor(budget);
	const { width, height } = sizeOf(area.bounds);

	// isSeen() reads the cells beside a wall at the edge of reach, a square further out, before finding them too far
	const costAt = (area.clear ? undefined : readCosts(from, reach + 1, area));

	for (let rows = -reach; rows <= reach; rows++)
	{
		const row = wrapRow(from.row + rows, area);

		// An area narrower than the reach across brings a cell into reach both ways round; only the shorter counts
		if (area.loopsNorthSouth && (nearestCopy(row, from.row, height) !== (from.row + rows)))
		{
			continue;
		}

		for (let columns = -reach; columns <= reach; columns++)
		{
			const column = wrapColumn(from.column + columns, area);

			if (area.loopsEastWest && (nearestCopy(column, from.column, width) !== (from.column + columns)))
			{
				continue;
			}

			// Looking is what costs, so a skipped cell is left out before it
			if (isInBounds(area.bounds, column, row) && !(skip?.(column, row) ?? false) && isSeen(columns, rows, budget, costAt))
			{
				visible.add(visionKey(column, row));
			}
		}
	}

	return(visible);
}

/**
 * The vision cost of the cell some columns and rows from the cell looked from, which may be past a
 * looping edge (see visionCostAt)
 */
type CostAt = (columns: number, rows: number) => number;

/**
 * Reads the vision cost of every cell around the cell looked from once, for the lines to every cell in
 * reach to look up
 *
 * @param from The cell looked from
 * @param radius How many columns and rows each way to read
 * @param area The area
 * @return The cost of a cell up to radius columns and rows from the cell looked from
 */
function readCosts(from: VisionCell, radius: number, area: VisionArea): CostAt
{
	const side = (2 * radius) + 1;
	const costs = new Float64Array(side * side);

	for (let rows = -radius; rows <= radius; rows++)
	{
		for (let columns = -radius; columns <= radius; columns++)
		{
			costs[((rows + radius) * side) + columns + radius] = visionCostAt(from.column + columns, from.row + rows, area);
		}
	}

	return((columns, rows) => costs[((rows + radius) * side) + columns + radius]);
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
 * @param columns How many columns from the cell looked from the other cell is, which may be past a looping edge
 * @param rows How many rows away the other cell is, likewise
 * @param budget The vision budget
 * @param costAt The vision cost of each cell, by its columns and rows from the cell looked from; undefined when the area is clear
 * @return True when the other cell can be seen
 */
function isSeen(columns: number, rows: number, budget: number, costAt: CostAt | undefined): boolean
{
	// Every line spends its length, and a line between two cells of the area stays inside it
	if (!costAt)
	{
		return(shortestDistance(columns, rows) <= budget);
	}

	if (isInSight(columns, rows, budget, costAt))
	{
		return(true);
	}

	if ((costAt(columns, rows) < OPAQUE_VISION_COST) || (shortestDistance(columns, rows) > budget))
	{
		return(false);
	}

	for (let rowStep = -1; rowStep <= 1; rowStep++)
	{
		for (let columnStep = -1; columnStep <= 1; columnStep++)
		{
			if (((columnStep !== 0) || (rowStep !== 0)) && isCornerOrSide(columns, rows, columnStep, rowStep, costAt) && (costAt(columns + columnStep, rows + rowStep) < OPAQUE_VISION_COST) && isInSight(columns + columnStep, rows + rowStep, budget, costAt))
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
 * @param columns How many columns the wall is from the cell looked from
 * @param rows How many rows the wall is from the cell looked from
 * @param columnStep How many columns the other cell is from the wall: -1, 0 or 1
 * @param rowStep How many rows the other cell is from the wall: -1, 0 or 1
 * @param costAt The vision cost of each cell, by its columns and rows from the cell looked from
 * @return True when the other cell is on the wall's side or at an inside corner
 */
function isCornerOrSide(columns: number, rows: number, columnStep: number, rowStep: number, costAt: CostAt): boolean
{
	if ((columnStep === 0) || (rowStep === 0))
	{
		return(true);
	}

	return((costAt(columns + columnStep, rows) >= OPAQUE_VISION_COST) && (costAt(columns, rows + rowStep) >= OPAQUE_VISION_COST));
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
 * @param columns How many columns from the cell looked from the other cell is, which may be past a looping edge
 * @param rows How many rows away the other cell is, likewise
 * @param budget The vision budget
 * @param costAt The vision cost of each cell, by its columns and rows from the cell looked from
 * @return True when the other cell can be seen
 */
function isInSight(columns: number, rows: number, budget: number, costAt: CostAt): boolean
{
	const steps = Math.max(Math.abs(columns), Math.abs(rows));

	// The shortest any line there could be, before walking it
	if (shortestDistance(columns, rows) > budget)
	{
		return(false);
	}

	let spent = 0;
	let previousColumn = 0;
	let previousRow = 0;

	for (let step = 1; step <= steps; step++)
	{
		const column = roundAwayFromZero((columns * step) / steps);
		const row = roundAwayFromZero((rows * step) / steps);
		const length = (((column !== previousColumn) && (row !== previousRow)) ? 1.5 : 1);

		// The character's own cell doesn't get in their way
		const cost = ((step === 1) ? 0 : costAt(previousColumn, previousRow));

		if (cost >= OPAQUE_VISION_COST)
		{
			return(false);
		}

		spent += length * (OPAQUE_VISION_COST / (OPAQUE_VISION_COST - cost));

		if (spent > budget)
		{
			return(false);
		}

		previousColumn = column;
		previousRow = row;
	}

	return(true);
}

/**
 * The vision cost of a cell, which may be past a looping edge
 *
 * @param column The cell's column
 * @param row The cell's row
 * @param area The area
 * @return Its vision cost; OPAQUE_VISION_COST outside the area
 */
function visionCostAt(column: number, row: number, area: VisionArea): number
{
	const wrappedColumn = wrapColumn(column, area);
	const wrappedRow = wrapRow(row, area);

	if (!isInBounds(area.bounds, wrappedColumn, wrappedRow))
	{
		return(OPAQUE_VISION_COST);
	}

	return(area.visionCost(wrappedColumn, wrappedRow));
}

/**
 * The column inside the area a column past a looping edge stands for
 *
 * @param column The column
 * @param area The area
 * @return The column, unchanged when the area doesn't loop east-west
 */
function wrapColumn(column: number, area: VisionArea): number
{
	const { minColumn, maxColumn } = area.bounds;

	return((area.loopsEastWest ? minColumn + positiveModulo(column - minColumn, (maxColumn - minColumn) + 1) : column));
}

/**
 * The row inside the area a row past a looping edge stands for
 *
 * @param row The row
 * @param area The area
 * @return The row, unchanged when the area doesn't loop north-south
 */
function wrapRow(row: number, area: VisionArea): number
{
	const { minRow, maxRow } = area.bounds;

	return((area.loopsNorthSouth ? minRow + positiveModulo(row - minRow, (maxRow - minRow) + 1) : row));
}

/**
 * How many cells across and down an area is
 *
 * @param bounds The area's bounds
 * @return Its width and height in cells
 */
function sizeOf(bounds: AreaBounds): { width: number; height: number }
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
