/**
 * Player movement rules: players move on a grid, from cell center to cell center, and never share a cell
 *
 * Pure functions: no Colyseus, database, network or timers (CLAUDE.md architecture rule 4)
 */
import { IMPASSABLE_WALK_SECONDS, isInBounds, positiveModulo, type MapBounds, type MovePayload } from '@multiverse-kiln/shared';

/**
 * A point in world units
 */
export interface Position
{
	x: number;
	y: number;
}

/**
 * A cell of the grid. Column 0, row 0 is the map's center cell, and its top left corner is at world
 * position (0, 0), so cells left of or above it have negative columns or rows
 */
export interface Cell
{
	column: number;
	row: number;
}

/**
 * The grid players move on: an area's map
 */
export interface Grid
{
	/**
	 * Width and height of a cell in world units
	 */
	cellSize: number;

	/**
	 * The cells players can be in
	 */
	bounds: MapBounds;

	/**
	 * Whether stepping off the east or west edge comes back on at the other
	 */
	loopsEastWest: boolean;

	/**
	 * Whether stepping off the north or south edge comes back on at the other
	 */
	loopsNorthSouth: boolean;

	/**
	 * Seconds of game time walking into a cell inside the bounds takes; IMPASSABLE_WALK_SECONDS can't be
	 * entered
	 */
	walkSeconds: (cell: Cell) => number;

	/**
	 * Walk seconds a player crosses at full speed on screen; a cell slower to walk is crossed at a
	 * matching fraction of it (defaultWalkSeconds)
	 */
	fullSpeedWalkSeconds: number;

	/**
	 * Whether a player who steps onto a cell inside the bounds stops there, even with a direction still
	 * held, such as a cell that takes the player to another area
	 */
	endsMovement: (cell: Cell) => boolean;
}

/**
 * A move from one cell to a neighboring one
 *
 * At a looping edge, `to` is the cell just past the edge rather than the cell on the far side it stands
 * for, so the player moves smoothly off the edge; wrapCell() gives the cell they arrive in
 */
export interface GridStep
{
	from: Cell;
	to: Cell;
}

/**
 * The direction a player is holding, and for how long
 */
export interface DirectionPress
{
	direction: MovePayload;

	/**
	 * How long the direction has been held, in seconds
	 */
	heldSeconds: number;

	/**
	 * Steps started since the direction was pressed
	 */
	stepsStarted: number;
}

/**
 * A player's movement state: where it is, the step it is taking, and the direction it is holding
 */
export interface GridMover
{
	x: number;
	y: number;

	/**
	 * The step in progress; undefined when standing still
	 */
	step: GridStep | undefined;

	press: DirectionPress;
}

/**
 * A player's movement state after stepOnGrid
 */
export interface StepResult extends GridMover
{
	/**
	 * The cell the player stepped onto and stopped in because the grid's endsMovement() says so, or
	 * undefined when they didn't
	 */
	stoppedAt: Cell | undefined;

	/**
	 * The steps to another cell the player finished, in order
	 */
	finishedSteps: GridStep[];
}

/**
 * Whether a cell is free for a player to move into (not held by another player)
 */
export type IsCellFree = (cell: Cell) => boolean;

/**
 * Player movement speed in world units per second, into a cell that takes the grid's fullSpeedWalkSeconds or less
 * to walk
 */
export const PLAYER_SPEED = 200;

/**
 * How long a direction must be held, in seconds, before a second step starts
 *
 * A step across a GRID_CELL_SIZE cell takes 0.16 seconds at PLAYER_SPEED. Waiting as long as that before
 * repeating means a press held slightly too long moves one cell, not two, like a keyboard's key repeat delay
 */
export const STEP_REPEAT_DELAY = 0.16;

/**
 * Allowance for rounding when comparing times
 */
const TIME_EPSILON = 1e-9;

/**
 * A press of no direction, for a player that has never moved
 */
export const NO_PRESS: DirectionPress = {
	direction: {
		x: 0,
		y: 0
	},
	heldSeconds: 0,
	stepsStarted: 0
};

/**
 * Moves a player along the grid for a period of time
 *
 * A step to a neighboring cell always runs to that cell's center, even if the direction is released
 * partway, so a player that stops is exactly on a cell center. Pressing a direction starts a step
 * at once; the next starts only once the direction has been held for the repeat delay, and after
 * that each step that ends starts the next one with the remaining time, so held movement doesn't
 * stutter between cells. Holding two axes steps diagonally, at the same speed.
 *
 * A step only starts into a free cell the player can enter, and a diagonal step also needs both cells
 * beside it free and enterable, so players can't pass through each other or cut past a wall at a
 * corner. When the diagonal step can't be taken, the horizontal and then the vertical part is tried
 * instead; when nothing can, the player waits. A step into a cell slower to walk than the grid's fullSpeedWalkSeconds is slower, and
 * a step onto a cell that ends movement stops the player there
 *
 * @param mover The player's position, current step and press
 * @param direction Direction held on each axis; a change from the press's direction starts a new press
 * @param deltaSeconds Time to move for, in seconds
 * @param grid Grid to move on
 * @param isCellFree Whether another player holds a cell (see occupiedCells)
 * @param speed Speed in world units per second, into a cell that takes the grid's fullSpeedWalkSeconds or less to walk
 * @param repeatDelay How long a direction must be held, in seconds, before its second step starts
 * @return The new position, step and press, and where the player stopped if a cell ended their movement
 */
export function stepOnGrid(mover: GridMover, direction: MovePayload, deltaSeconds: number, grid: Grid, isCellFree: IsCellFree, speed: number = PLAYER_SPEED, repeatDelay: number = STEP_REPEAT_DELAY): StepResult
{
	const isSamePress = ((direction.x === mover.press.direction.x) && (direction.y === mover.press.direction.y));
	const press: DirectionPress = (isSamePress ? { ...mover.press } : { direction: { x: direction.x, y: direction.y }, heldSeconds: 0, stepsStarted: 0 });
	const totalSeconds = Math.max(deltaSeconds, 0);
	let x = mover.x;
	let y = mover.y;
	let step = mover.step;
	let stoppedAt: Cell | undefined;
	const finishedSteps: GridStep[] = [];
	let elapsed = 0;

	while (elapsed < totalSeconds)
	{
		if (!step)
		{
			const heldSeconds = press.heldSeconds + elapsed;

			// Waiting out the repeat delay before the second step of a press
			if ((press.stepsStarted > 0) && (heldSeconds < (repeatDelay - TIME_EPSILON)))
			{
				elapsed = Math.min(totalSeconds, elapsed + (repeatDelay - heldSeconds));
				continue;
			}

			step = nextStep({ x, y }, direction, grid, isCellFree);

			if (!step)
			{
				break;
			}

			if (!isSameCell(step.from, step.to))
			{
				press.stepsStarted++;
			}
		}

		const arrival = wrapCell(step.to, grid);
		const stepSpeed = speedInto(arrival, grid, speed);
		const target = cellCenter(step.to, grid);
		const distance = Math.hypot(target.x - x, target.y - y);
		const reach = stepSpeed * (totalSeconds - elapsed);

		if (distance > reach)
		{
			x += ((target.x - x) / distance) * reach;
			y += ((target.y - y) / distance) * reach;
			break;
		}

		// Arriving sets the position to the cell center exactly, so rounding never leaves a player off the
		// grid, and a player who stepped off a looping edge comes back on at the other
		const center = cellCenter(arrival, grid);

		x = center.x;
		y = center.y;
		elapsed += distance / stepSpeed;

		const steppedOnto = !isSameCell(step.from, step.to);

		if (steppedOnto)
		{
			finishedSteps.push(step);
		}

		step = undefined;

		if (steppedOnto && grid.endsMovement(arrival))
		{
			stoppedAt = arrival;
			break;
		}
	}

	press.heldSeconds += totalSeconds;

	return({ x, y, step, press, stoppedAt, finishedSteps });
}

/**
 * The cells a player holds, which other players can't move into
 *
 * A standing player holds the cell it is in. A moving player holds both the cell it is leaving and the
 * one it is entering, so no other player can be partway into either
 *
 * @param mover The player's position and current step
 * @param grid The grid
 * @return The held cells
 */
export function occupiedCells(mover: Pick<GridMover, 'x' | 'y' | 'step'>, grid: Grid): Cell[]
{
	if (mover.step)
	{
		return([mover.step.from, wrapCell(mover.step.to, grid)]);
	}

	return([cellAt(mover, grid)]);
}

/**
 * Finds the cell nearest to another that a player can stand in, for placing a player who arrives
 *
 * Looks at the cell itself, then at each ring of cells around it in turn
 *
 * @param near The cell to start from
 * @param grid The grid
 * @param isCellFree Whether another player holds a cell
 * @param maxDistance Most cells away from `near` to look
 * @return The center of the nearest cell that is on the map, enterable and free, or undefined when
 * there is none within maxDistance
 */
export function findFreeCell(near: Cell, grid: Grid, isCellFree: IsCellFree, maxDistance: number): Position | undefined
{
	for (let distance = 0; distance <= maxDistance; distance++)
	{
		for (let rowOffset = -distance; rowOffset <= distance; rowOffset++)
		{
			// Inside the ring only its first and last columns are on it
			const columnStep = (((rowOffset === -distance) || (rowOffset === distance)) ? 1 : Math.max(distance * 2, 1));

			for (let columnOffset = -distance; columnOffset <= distance; columnOffset += columnStep)
			{
				const cell = wrapCell({ column: near.column + columnOffset, row: near.row + rowOffset }, grid);

				if (canStandIn(cell, grid, isCellFree))
				{
					return(cellCenter(cell, grid));
				}
			}
		}
	}

	return(undefined);
}

/**
 * The center of a cell
 *
 * @param cell The cell
 * @param grid The grid
 * @return The cell's center in world units
 */
export function cellCenter(cell: Cell, grid: Pick<Grid, 'cellSize'>): Position
{
	return({
		x: (cell.column * grid.cellSize) + (grid.cellSize / 2),
		y: (cell.row * grid.cellSize) + (grid.cellSize / 2)
	});
}

/**
 * The cell a position is in
 *
 * @param position Position in world units
 * @param grid The grid
 * @return The cell, clamped to the map
 */
export function cellAt(position: Position, grid: Grid): Cell
{
	const cell = wrapCell({ column: Math.floor(position.x / grid.cellSize), row: Math.floor(position.y / grid.cellSize) }, grid);

	return({
		column: clamp(cell.column, grid.bounds.minColumn, grid.bounds.maxColumn),
		row: clamp(cell.row, grid.bounds.minRow, grid.bounds.maxRow)
	});
}

/**
 * The cell a cell past a looping edge stands for: on a map that loops east-west, the column after the
 * last is the first, and so on
 *
 * @param cell The cell, which may be off the map
 * @param grid The grid
 * @return The cell on the map along each looping axis; unchanged along an axis that doesn't loop
 */
export function wrapCell(cell: Cell, grid: Grid): Cell
{
	const { minColumn, minRow, maxColumn, maxRow } = grid.bounds;

	return({
		column: (grid.loopsEastWest ? minColumn + positiveModulo(cell.column - minColumn, (maxColumn - minColumn) + 1) : cell.column),
		row: (grid.loopsNorthSouth ? minRow + positiveModulo(cell.row - minRow, (maxRow - minRow) + 1) : cell.row)
	});
}

/**
 * Picks the next step for a player that isn't mid-step
 *
 * @param position Where the player is
 * @param direction Direction held on each axis
 * @param grid Grid to move on
 * @param isCellFree Whether another player holds a cell
 * @return The step to take; a step within the current cell when the player is off-center and can't
 * move on, or undefined when the player is on a center and can't move on
 */
function nextStep(position: Position, direction: MovePayload, grid: Grid, isCellFree: IsCellFree): GridStep | undefined
{
	const from = cellAt(position, grid);
	const center = cellCenter(from, grid);
	const candidates: MovePayload[] = [direction, { x: direction.x, y: 0 }, { x: 0, y: direction.y }];

	for (const candidate of candidates)
	{
		if ((candidate.x !== 0) || (candidate.y !== 0))
		{
			const to = {
				column: from.column + candidate.x,
				row: from.row + candidate.y
			};

			if (canEnter(from, to, grid, isCellFree))
			{
				return({ from, to });
			}
		}
	}

	if ((center.x === position.x) && (center.y === position.y))
	{
		return(undefined);
	}

	return({ from, to: from });
}

/**
 * Whether a player can step from a cell to a neighboring one
 *
 * @param from The cell the player is in
 * @param to The neighboring cell, which may be just past a looping edge
 * @param grid The grid
 * @param isCellFree Whether another player holds a cell
 * @return True when the cell is one the player can stand in, and for a diagonal step, both cells beside it are too
 */
function canEnter(from: Cell, to: Cell, grid: Grid, isCellFree: IsCellFree): boolean
{
	if (!canStandIn(wrapCell(to, grid), grid, isCellFree))
	{
		return(false);
	}

	const isDiagonal = ((to.column !== from.column) && (to.row !== from.row));

	return(!isDiagonal || (canStandIn(wrapCell({ column: to.column, row: from.row }, grid), grid, isCellFree) && canStandIn(wrapCell({ column: from.column, row: to.row }, grid), grid, isCellFree)));
}

/**
 * Whether a player can be in a cell
 *
 * @param cell The cell, already wrapped
 * @param grid The grid
 * @param isCellFree Whether another player holds a cell
 * @return True when the cell is on the map, can be entered, and nobody else holds it
 */
function canStandIn(cell: Cell, grid: Grid, isCellFree: IsCellFree): boolean
{
	return(isInBounds(grid.bounds, cell.column, cell.row) && (grid.walkSeconds(cell) !== IMPASSABLE_WALK_SECONDS) && isCellFree(cell));
}

/**
 * How fast a player moves into a cell: full speed when walking it takes the grid's fullSpeedWalkSeconds or less,
 * slowed in proportion when it takes longer
 *
 * @param cell The cell being entered, already wrapped
 * @param grid The grid
 * @param speed Full speed
 * @return The speed; full speed into a cell that can't be entered, which only happens when a player
 * steps back to the center of a cell that has stopped being enterable under them
 */
function speedInto(cell: Cell, grid: Grid, speed: number): number
{
	const seconds = (isInBounds(grid.bounds, cell.column, cell.row) ? grid.walkSeconds(cell) : IMPASSABLE_WALK_SECONDS);

	const fullSpeedSeconds = grid.fullSpeedWalkSeconds;

	return(((seconds > fullSpeedSeconds) ? (speed * fullSpeedSeconds) / seconds : speed));
}

/**
 * Whether two cells are the same
 *
 * @param a A cell
 * @param b Another cell
 * @return True when they have the same column and row
 */
function isSameCell(a: Cell, b: Cell): boolean
{
	return((a.column === b.column) && (a.row === b.row));
}

/**
 * Limits a value to a range
 *
 * @param value Value to limit
 * @param min Lowest allowed value
 * @param max Highest allowed value
 * @return The value, or the nearest end of the range
 */
function clamp(value: number, min: number, max: number): number
{
	return(Math.min(Math.max(value, min), max));
}
