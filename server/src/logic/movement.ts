/**
 * Player movement rules: players move on a grid, from cell center to cell center, and never share a cell
 *
 * Pure functions: no Colyseus, database, network or timers (CLAUDE.md architecture rule 4)
 */
import type { MovePayload } from '@multiverse-kiln/shared';

/**
 * A point in world units
 */
export interface Position
{
	x: number;
	y: number;
}

/**
 * A cell of the grid, counted from 0 at the top left
 */
export interface Cell
{
	column: number;
	row: number;
}

/**
 * The grid players move on, covering the world from (0, 0)
 */
export interface Grid
{
	/**
	 * Width and height of a cell in world units
	 */
	cellSize: number;

	columns: number;
	rows: number;
}

/**
 * A move from one cell to a neighboring one
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
 * Whether a cell is free for a player to move into (not held by another player)
 */
export type IsCellFree = (cell: Cell) => boolean;

/**
 * Player movement speed in world units per second
 */
export const PLAYER_SPEED = 200;

/**
 * How long a direction must be held, in seconds, before a second step starts
 *
 * A step takes 0.15 seconds at PLAYER_SPEED. Waiting a little longer than that before repeating means
 * a press held slightly too long moves one cell, not two, like a keyboard's key repeat delay
 */
export const STEP_REPEAT_DELAY = 0.15;

/**
 * Allowance for rounding when comparing times
 */
const TIME_EPSILON = 1e-9;

/**
 * A press of no direction, for a player that has never moved
 */
export const NO_PRESS: DirectionPress = { direction: { x: 0, y: 0 }, heldSeconds: 0, stepsStarted: 0 };

/**
 * Moves a player along the grid for a period of time
 *
 * A step to a neighboring cell always runs to that cell's center, even if the direction is released
 * partway, so a player that stops is exactly on a cell center. Pressing a direction starts a step
 * at once; the next starts only once the direction has been held for the repeat delay, and after
 * that each step that ends starts the next one with the remaining time, so held movement doesn't
 * stutter between cells. Holding two axes steps diagonally, at the same speed.
 *
 * A step only starts into a free cell, and a diagonal step also needs both cells beside it free, so
 * players can't pass through each other at a corner. When the diagonal step can't be taken, the
 * horizontal and then the vertical part is tried instead; when nothing can, the player waits
 *
 * @param mover The player's position, current step and press
 * @param direction Direction held on each axis; a change from the press's direction starts a new press
 * @param deltaSeconds Time to move for, in seconds
 * @param grid Grid to move on
 * @param isCellFree Whether another player holds a cell (see occupiedCells)
 * @param speed Speed in world units per second
 * @param repeatDelay How long a direction must be held, in seconds, before its second step starts
 * @return The new position, step and press
 */
export function stepOnGrid(mover: GridMover, direction: MovePayload, deltaSeconds: number, grid: Grid, isCellFree: IsCellFree, speed: number = PLAYER_SPEED, repeatDelay: number = STEP_REPEAT_DELAY): GridMover
{
	const isSamePress = ((direction.x === mover.press.direction.x) && (direction.y === mover.press.direction.y));
	const press: DirectionPress = (isSamePress ? { ...mover.press } : { direction: { x: direction.x, y: direction.y }, heldSeconds: 0, stepsStarted: 0 });
	const totalSeconds = Math.max(deltaSeconds, 0);
	let x = mover.x;
	let y = mover.y;
	let step = mover.step;
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

			// Moving back onto the current cell's center isn't a step to another cell
			if ((step.to.column !== step.from.column) || (step.to.row !== step.from.row))
			{
				press.stepsStarted++;
			}
		}

		const target = cellCenter(step.to, grid);
		const distance = Math.hypot(target.x - x, target.y - y);
		const reach = speed * (totalSeconds - elapsed);

		if (distance > reach)
		{
			x += ((target.x - x) / distance) * reach;
			y += ((target.y - y) / distance) * reach;
			break;
		}

		// Arriving sets the position to the cell center exactly, so rounding never leaves a player off the grid
		x = target.x;
		y = target.y;
		elapsed += distance / speed;
		step = undefined;
	}

	press.heldSeconds += totalSeconds;

	return({ x, y, step, press });
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
		return([mover.step.from, mover.step.to]);
	}

	return([cellAt(mover, grid)]);
}

/**
 * Picks a random free cell for a player to spawn in
 *
 * Starts from a random cell and, if that is held, takes the next free one along the rows
 *
 * @param grid Grid to spawn on
 * @param random Returns a number in [0, 1), like Math.random
 * @param isCellFree Whether another player holds a cell
 * @return The center of a free cell, or undefined when every cell is held
 */
export function spawnPosition(grid: Grid, random: () => number, isCellFree: IsCellFree): Position | undefined
{
	const cellCount = grid.columns * grid.rows;
	const start = (Math.floor(random() * grid.rows) * grid.columns) + Math.floor(random() * grid.columns);

	for (let i = 0; i < cellCount; i++)
	{
		const index = (start + i) % cellCount;
		const cell = { column: index % grid.columns, row: Math.floor(index / grid.columns) };

		if (isCellFree(cell))
		{
			return(cellCenter(cell, grid));
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
export function cellCenter(cell: Cell, grid: Grid): Position
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
 * @return The cell, clamped to the grid
 */
export function cellAt(position: Position, grid: Grid): Cell
{
	return({
		column: clamp(Math.floor(position.x / grid.cellSize), 0, grid.columns - 1),
		row: clamp(Math.floor(position.y / grid.cellSize), 0, grid.rows - 1)
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
			const to = { column: from.column + candidate.x, row: from.row + candidate.y };

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
 * @param to The neighboring cell
 * @param grid The grid
 * @param isCellFree Whether another player holds a cell
 * @return True when the cell is on the grid and free, and for a diagonal step, both cells beside it are free too
 */
function canEnter(from: Cell, to: Cell, grid: Grid, isCellFree: IsCellFree): boolean
{
	if ((to.column < 0) || (to.column >= grid.columns) || (to.row < 0) || (to.row >= grid.rows) || !isCellFree(to))
	{
		return(false);
	}

	const isDiagonal = ((to.column !== from.column) && (to.row !== from.row));

	return(!isDiagonal || (isCellFree({ column: to.column, row: from.row }) && isCellFree({ column: from.column, row: to.row })));
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
