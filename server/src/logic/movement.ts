/**
 * Player movement rules: players move on a grid, from cell center to cell center
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
 * A player's movement state: where it is, and the cell center it is stepping to
 */
export interface GridMover
{
	x: number;
	y: number;

	/**
	 * Center of the cell the current step ends on; undefined when standing still
	 */
	target: Position | undefined;
}

/**
 * Player movement speed in world units per second
 */
export const PLAYER_SPEED = 200;

/**
 * Moves a player along the grid for a period of time
 *
 * A step to a neighboring cell always runs to that cell's center, even if the direction is released
 * partway, so a player that stops is exactly on a cell center. While a direction is held, each step
 * that ends starts the next one with the remaining time, so movement doesn't stutter between cells.
 * Holding two axes steps diagonally, at the same speed. A step that would leave the grid on an
 * axis drops that axis
 *
 * @param mover The player's position and current step
 * @param direction Direction held on each axis
 * @param deltaSeconds Time to move for, in seconds
 * @param grid Grid to move on
 * @param speed Speed in world units per second
 * @return The new position and step
 */
export function stepOnGrid(mover: GridMover, direction: MovePayload, deltaSeconds: number, grid: Grid, speed: number = PLAYER_SPEED): GridMover
{
	let x = mover.x;
	let y = mover.y;
	let target = mover.target;
	let remaining = speed * Math.max(deltaSeconds, 0);

	while (remaining > 0)
	{
		target ??= nextStepTarget({ x, y }, direction, grid);

		if (!target)
		{
			break;
		}

		const distance = Math.hypot(target.x - x, target.y - y);

		if (distance > remaining)
		{
			x += ((target.x - x) / distance) * remaining;
			y += ((target.y - y) / distance) * remaining;
			break;
		}

		// Arriving sets the position to the cell center exactly, so rounding never leaves a player off the grid
		x = target.x;
		y = target.y;
		remaining -= distance;
		target = undefined;
	}

	return({ x, y, target });
}

/**
 * Picks the cell center the next step goes to
 *
 * @param position Where the player is
 * @param direction Direction held on each axis
 * @param grid Grid to move on
 * @return The neighboring cell's center in the held direction, the current cell's center when the player is
 * off-center and can't step, or undefined when the player is on a center and can't step
 */
function nextStepTarget(position: Position, direction: MovePayload, grid: Grid): Position | undefined
{
	const column = clamp(Math.floor(position.x / grid.cellSize), 0, grid.columns - 1);
	const row = clamp(Math.floor(position.y / grid.cellSize), 0, grid.rows - 1);
	const target = cellCenter(clamp(column + direction.x, 0, grid.columns - 1), clamp(row + direction.y, 0, grid.rows - 1), grid);

	if ((target.x === position.x) && (target.y === position.y))
	{
		return(undefined);
	}

	return(target);
}

/**
 * Picks a random cell for a player to spawn in
 *
 * @param grid Grid to spawn on
 * @param random Returns a number in [0, 1), like Math.random
 * @return The center of a cell in the grid
 */
export function spawnPosition(grid: Grid, random: () => number): Position
{
	return(cellCenter(Math.floor(random() * grid.columns), Math.floor(random() * grid.rows), grid));
}

/**
 * The center of a cell
 *
 * @param column Cell's column, from 0 on the left
 * @param row Cell's row, from 0 at the top
 * @param grid The grid
 * @return The cell's center in world units
 */
export function cellCenter(column: number, row: number, grid: Grid): Position
{
	return({
		x: (column * grid.cellSize) + (grid.cellSize / 2),
		y: (row * grid.cellSize) + (grid.cellSize / 2)
	});
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
