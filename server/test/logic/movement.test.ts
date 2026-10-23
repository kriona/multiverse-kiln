import assert from 'assert';
import type { MovePayload } from '@multiverse-kiln/shared';

import { DEFAULT_INDOOR_WALK_SECONDS, DEFAULT_OUTDOOR_WALK_SECONDS, IMPASSABLE_WALK_SECONDS } from '@multiverse-kiln/shared';
import { cellAt, cellCenter, findFreeCell, NO_PRESS, occupiedCells, PLAYER_SPEED, STEP_REPEAT_DELAY, stepOnGrid, wrapCell, type Cell, type GridMover, type Grid, type GridStep, type IsCellFree } from '../../src/logic/movement.js';

// Cell centers are at x = 5, 15, 25, 35, 45 and y = 5, 15, 25, 35. At the speed of 100 these tests use,
// a step between neighboring cells takes 0.1 seconds
const grid: Grid = {
	cellSize: 10,
	bounds: { minColumn: 0, minRow: 0, maxColumn: 4, maxRow: 3 },
	loopsEastWest: false,
	loopsNorthSouth: false,
	walkSeconds: () => DEFAULT_INDOOR_WALK_SECONDS,
	fullSpeedWalkSeconds: DEFAULT_INDOOR_WALK_SECONDS,
	endsMovement: () => false
};

// The tests use their own speed and repeat delay rather than PLAYER_SPEED and STEP_REPEAT_DELAY, so
// those can be tuned without changing the timings here. A press must be held for 0.25 seconds, two
// and a half steps, before its second step starts
const repeatDelay = 0.25;

const standingStill = { x: 0, y: 0 } as const;
const right = { x: 1, y: 0 } as const;
const down = { x: 0, y: 1 } as const;
const downRight = { x: 1, y: 1 } as const;

const allFree: IsCellFree = () => true;

/**
 * A free-cell check where the given cells are held by other players
 *
 * @param held Cells other players hold, as [column, row]
 * @return The check
 */
function freeExcept(...held: [number, number][]): IsCellFree
{
	return((cell) => !held.some(([column, row]) => ((cell.column === column) && (cell.row === row))));
}

/**
 * The test grid with some of its settings changed
 *
 * @param changes The settings to change
 * @return The grid
 */
function gridWith(changes: Partial<Grid>): Grid
{
	return({ ...grid, ...changes });
}

/**
 * Walk seconds where the given cells have their own and every other cell takes DEFAULT_INDOOR_WALK_SECONDS
 *
 * @param cells Cells and their walk seconds, as [column, row, seconds]
 * @return The walk seconds function for a grid
 */
function walkSeconds(...cells: [number, number, number][]): Grid['walkSeconds']
{
	return((cell) => cells.find(([column, row]) => ((cell.column === column) && (cell.row === row)))?.[2] ?? DEFAULT_INDOOR_WALK_SECONDS);
}

/**
 * A player standing on a position with no step in progress and no direction held
 *
 * @param x X position
 * @param y Y position
 * @return The mover
 */
function standingAt(x: number, y: number): GridMover
{
	return({ x, y, step: undefined, press: NO_PRESS });
}

/**
 * A player that has held a direction for longer than the repeat delay, so steps follow one another
 *
 * @param x X position
 * @param y Y position
 * @param direction The held direction
 * @return The mover
 */
function holdingAt(x: number, y: number, direction: MovePayload): GridMover
{
	return({ x, y, step: undefined, press: { direction, heldSeconds: 1, stepsStarted: 1 } });
}

/**
 * A step between two cells
 *
 * @param from The cell left, as [column, row]
 * @param to The cell entered, as [column, row]
 * @return The step
 */
function step(from: [number, number], to: [number, number]): GridStep
{
	return({ from: { column: from[0], row: from[1] }, to: { column: to[0], row: to[1] } });
}

/**
 * A mover's position and step, leaving out its press
 *
 * @param mover The mover
 * @return Its position and step
 */
function placeOf(mover: GridMover): { x: number; y: number; step: GridStep | undefined }
{
	return({ x: mover.x, y: mover.y, step: mover.step });
}

/**
 * A position with no step in progress, to compare with placeOf
 *
 * @param x X position
 * @param y Y position
 * @return The place
 */
function at(x: number, y: number): { x: number; y: number; step: undefined }
{
	return({ x, y, step: undefined });
}

describe('stepOnGrid', () =>
{
	it('does not move when no direction is held', () =>
	{
		assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(25, 15), standingStill, 1, grid, allFree, 100, repeatDelay)), at(25, 15));
	});

	it('starts a step toward the neighboring cell\'s center', () =>
	{
		assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(25, 15), right, 0.05, grid, allFree, 100, repeatDelay)), { x: 30, y: 15, step: step([2, 1], [3, 1]) });
		assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(25, 15), { x: 0, y: -1 }, 0.05, grid, allFree, 100, repeatDelay)), { x: 25, y: 10, step: step([2, 1], [2, 0]) });
	});

	it('finishes a step after the direction is released, stopping exactly on the cell center', () =>
	{
		const midStep: GridMover = { x: 30, y: 15, step: step([2, 1], [3, 1]), press: NO_PRESS };

		assert.deepStrictEqual(placeOf(stepOnGrid(midStep, standingStill, 0.02, grid, allFree, 100, repeatDelay)), { x: 32, y: 15, step: step([2, 1], [3, 1]) });
		assert.deepStrictEqual(placeOf(stepOnGrid(midStep, standingStill, 1, grid, allFree, 100, repeatDelay)), at(35, 15));
	});

	it('carries on into the next cell without stopping once the direction has been held', () =>
	{
		assert.deepStrictEqual(placeOf(stepOnGrid(holdingAt(25, 15, right), right, 0.15, grid, allFree, 100, repeatDelay)), { x: 40, y: 15, step: step([3, 1], [4, 1]) });
	});

	it('finishes the current step before changing direction', () =>
	{
		const midStep: GridMover = { x: 30, y: 15, step: step([2, 1], [3, 1]), press: { direction: right, heldSeconds: 0.05, stepsStarted: 1 } };

		assert.deepStrictEqual(placeOf(stepOnGrid(midStep, down, 0.1, grid, allFree, 100, repeatDelay)), { x: 35, y: 20, step: step([3, 1], [3, 2]) });
	});

	it('uses PLAYER_SPEED by default', () =>
	{
		const wideGrid = gridWith({ cellSize: 1000, bounds: { minColumn: 0, minRow: 0, maxColumn: 2, maxRow: 0 } });

		assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(500, 500), right, 1, wideGrid, allFree)), { x: 500 + PLAYER_SPEED, y: 500, step: step([0, 0], [1, 0]) });
	});

	it('uses STEP_REPEAT_DELAY by default', () =>
	{
		// Fast enough that each step is over almost at once, so only the delay decides when the second starts
		const fastSpeed = 1000000;

		assert.strictEqual(stepOnGrid(standingAt(5, 15), right, STEP_REPEAT_DELAY / 2, grid, allFree, fastSpeed).press.stepsStarted, 1);
		assert.ok(stepOnGrid(standingAt(5, 15), right, STEP_REPEAT_DELAY + 0.001, grid, allFree, fastSpeed).press.stepsStarted > 1);
	});

	it('steps diagonally at the same speed', () =>
	{
		const mover = stepOnGrid(standingAt(15, 15), downRight, 0.05, grid, allFree, 100, repeatDelay);
		const distance = Math.hypot(mover.x - 15, mover.y - 15);

		assert.deepStrictEqual(mover.step, step([1, 1], [2, 2]));
		assert.ok(Math.abs(distance - 5) < 1e-9, `moved ${distance}`);
		assert.strictEqual(mover.x, mover.y);
	});

	it('does not step off the grid', () =>
	{
		assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(45, 15), right, 1, grid, allFree, 100, repeatDelay)), at(45, 15));
		assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(5, 5), { x: -1, y: -1 }, 1, grid, allFree, 100, repeatDelay)), at(5, 5));
	});

	it('drops the axis that would leave the grid from a diagonal step', () =>
	{
		assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(45, 15), downRight, 0.05, grid, allFree, 100, repeatDelay)), { x: 45, y: 20, step: step([4, 1], [4, 2]) });
	});

	it('stops at the edge of the grid while the direction is still held', () =>
	{
		assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(25, 15), right, 10, grid, allFree, 100, repeatDelay)), at(45, 15));
	});

	it('moves a player that is off a cell center back onto it', () =>
	{
		assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(22, 15), standingStill, 1, grid, allFree, 100, repeatDelay)), at(25, 15));
	});

	it('does not move for a zero or negative time step', () =>
	{
		assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(25, 15), right, 0, grid, allFree, 100, repeatDelay)), at(25, 15));
		assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(25, 15), right, -1, grid, allFree, 100, repeatDelay)), at(25, 15));
	});

	it('does not change the mover it was given', () =>
	{
		const mover: GridMover = { x: 30, y: 15, step: step([2, 1], [3, 1]), press: { direction: right, heldSeconds: 0.05, stepsStarted: 1 } };

		stepOnGrid(mover, right, 1, grid, allFree, 100, repeatDelay);

		assert.deepStrictEqual(mover, { x: 30, y: 15, step: step([2, 1], [3, 1]), press: { direction: right, heldSeconds: 0.05, stepsStarted: 1 } });
	});

	describe('repeat delay', () =>
	{
		it('moves one cell for a press held a little longer than a step but shorter than the delay', () =>
		{
			const mover = stepOnGrid(standingAt(5, 15), right, 0.2, grid, allFree, 100, repeatDelay);

			assert.deepStrictEqual(placeOf(mover), at(15, 15));
			assert.deepStrictEqual(mover.press, { direction: right, heldSeconds: 0.2, stepsStarted: 1 });
		});

		it('starts the second step once the direction has been held for the delay', () =>
		{
			// First step over at 0.1s; second starts at the delay and runs for the rest of the time
			const mover = stepOnGrid(standingAt(5, 15), right, repeatDelay + 0.05, grid, allFree, 100, repeatDelay);

			assert.deepStrictEqual(placeOf(mover), { x: 20, y: 15, step: step([1, 1], [2, 1]) });
		});

		it('measures the delay across ticks', () =>
		{
			const afterFirstTick = stepOnGrid(standingAt(5, 15), right, 0.2, grid, allFree, 100, repeatDelay);
			const afterSecondTick = stepOnGrid(afterFirstTick, right, (repeatDelay - 0.2) + 0.05, grid, allFree, 100, repeatDelay);

			assert.deepStrictEqual(placeOf(afterSecondTick), { x: 20, y: 15, step: step([1, 1], [2, 1]) });
		});

		it('steps at once in a newly pressed direction', () =>
		{
			const afterFirstStep = stepOnGrid(standingAt(5, 15), right, 0.15, grid, allFree, 100, repeatDelay);

			assert.deepStrictEqual(placeOf(stepOnGrid(afterFirstStep, down, 0.05, grid, allFree, 100, repeatDelay)), { x: 15, y: 20, step: step([1, 1], [1, 2]) });
		});

		it('steps at once when the same direction is released and pressed again', () =>
		{
			const afterFirstStep = stepOnGrid(standingAt(5, 15), right, 0.15, grid, allFree, 100, repeatDelay);
			const released = stepOnGrid(afterFirstStep, standingStill, 0.01, grid, allFree, 100, repeatDelay);

			assert.deepStrictEqual(placeOf(stepOnGrid(released, right, 0.05, grid, allFree, 100, repeatDelay)), { x: 20, y: 15, step: step([1, 1], [2, 1]) });
		});

		it('takes the first step at once when a blocked cell frees up', () =>
		{
			const blocked = stepOnGrid(standingAt(5, 15), right, 0.5, grid, freeExcept([1, 1]), 100, repeatDelay);

			assert.deepStrictEqual(placeOf(blocked), at(5, 15));
			assert.deepStrictEqual(placeOf(stepOnGrid(blocked, right, 0.05, grid, allFree, 100, repeatDelay)), { x: 10, y: 15, step: step([0, 1], [1, 1]) });
		});
	});

	describe('other players', () =>
	{
		it('does not step into a held cell', () =>
		{
			assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(25, 15), right, 1, grid, freeExcept([3, 1]), 100, repeatDelay)), at(25, 15));
		});

		it('stops on the cell before a held one while the direction is held', () =>
		{
			assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(5, 15), right, 1, grid, freeExcept([3, 1]), 100, repeatDelay)), at(25, 15));
		});

		it('does not cut a corner past a held cell', () =>
		{
			// The diagonal cell (2, 2) is free, but (2, 1) beside it is held, so only the vertical part is taken
			assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(15, 15), downRight, 0.05, grid, freeExcept([2, 1]), 100, repeatDelay)), { x: 15, y: 20, step: step([1, 1], [1, 2]) });
		});

		it('slides horizontally when the diagonal cell is held', () =>
		{
			assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(15, 15), downRight, 0.05, grid, freeExcept([2, 2]), 100, repeatDelay)), { x: 20, y: 15, step: step([1, 1], [2, 1]) });
		});

		it('waits when every way in the held direction is blocked', () =>
		{
			assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(15, 15), downRight, 1, grid, freeExcept([2, 1], [1, 2]), 100, repeatDelay)), at(15, 15));
		});

		it('finishes a step already started even if the cell is now held', () =>
		{
			const midStep: GridMover = { x: 30, y: 15, step: step([2, 1], [3, 1]), press: NO_PRESS };

			assert.deepStrictEqual(placeOf(stepOnGrid(midStep, standingStill, 1, grid, freeExcept([3, 1]), 100, repeatDelay)), at(35, 15));
		});
	});

	describe('terrain', () =>
	{
		it('moves at half speed into a cell that takes twice the default walk seconds', () =>
		{
			const forest = gridWith({ walkSeconds: walkSeconds([3, 1, DEFAULT_INDOOR_WALK_SECONDS * 2]) });

			assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(25, 15), right, 0.1, forest, allFree, 100, repeatDelay)), { x: 30, y: 15, step: step([2, 1], [3, 1]) });
			assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(25, 15), right, 0.2, forest, allFree, 100, repeatDelay)), at(35, 15));
		});

		it('moves no faster than full speed into a cell quicker to walk than the default', () =>
		{
			const road = gridWith({ walkSeconds: walkSeconds([3, 1, DEFAULT_INDOOR_WALK_SECONDS / 2]) });

			assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(25, 15), right, 0.05, road, allFree, 100, repeatDelay)), { x: 30, y: 15, step: step([2, 1], [3, 1]) });
		});

		it('moves at full speed out of a slow cell into a normal one', () =>
		{
			const forest = gridWith({ walkSeconds: walkSeconds([3, 1, DEFAULT_INDOOR_WALK_SECONDS * 2]) });

			assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(35, 15), right, 0.05, forest, allFree, 100, repeatDelay)), { x: 40, y: 15, step: step([3, 1], [4, 1]) });
		});

		it('moves at full speed outdoors into a cell that takes the outdoor default, and slower into a slower one', () =>
		{
			const meadow = gridWith({ fullSpeedWalkSeconds: DEFAULT_OUTDOOR_WALK_SECONDS, walkSeconds: walkSeconds([2, 1, DEFAULT_OUTDOOR_WALK_SECONDS], [3, 1, DEFAULT_OUTDOOR_WALK_SECONDS * 2]) });

			assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(15, 15), right, 0.1, meadow, allFree, 100, repeatDelay)), at(25, 15));
			assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(25, 15), right, 0.1, meadow, allFree, 100, repeatDelay)), { x: 30, y: 15, step: step([2, 1], [3, 1]) });
		});

		it('does not enter an impassable cell', () =>
		{
			const wall = gridWith({ walkSeconds: walkSeconds([3, 1, IMPASSABLE_WALK_SECONDS]) });

			assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(25, 15), right, 1, wall, allFree, 100, repeatDelay)), at(25, 15));
		});

		it('does not cut diagonally past an impassable corner, but takes the part of the step it can', () =>
		{
			const wall = gridWith({ walkSeconds: walkSeconds([2, 1, IMPASSABLE_WALK_SECONDS]) });

			assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(15, 15), downRight, 0.05, wall, allFree, 100, repeatDelay)), { x: 15, y: 20, step: step([1, 1], [1, 2]) });
		});
	});

	describe('cells that end movement', () =>
	{
		it('stops a player who steps onto one, even with the direction still held', () =>
		{
			const door = gridWith({ endsMovement: (cell) => ((cell.column === 3) && (cell.row === 1)) });
			const mover = stepOnGrid(holdingAt(15, 15, right), right, 1, door, allFree, 100, repeatDelay);

			assert.deepStrictEqual(placeOf(mover), at(35, 15));
			assert.deepStrictEqual(mover.stoppedAt, { column: 3, row: 1 });
		});

		it('lets a player standing on one walk off it', () =>
		{
			const door = gridWith({ endsMovement: (cell) => ((cell.column === 3) && (cell.row === 1)) });
			const mover = stepOnGrid(holdingAt(35, 15, right), right, 1, door, allFree, 100, repeatDelay);

			assert.deepStrictEqual(placeOf(mover), at(45, 15));
			assert.strictEqual(mover.stoppedAt, undefined);
		});

		it('says nothing when the player stopped for any other reason', () =>
		{
			assert.strictEqual(stepOnGrid(standingAt(25, 15), right, 1, grid, allFree, 100, repeatDelay).stoppedAt, undefined);
		});
	});

	describe('looping edges', () =>
	{
		it('steps off the east edge and comes back on at the west', () =>
		{
			const loops = gridWith({ loopsEastWest: true });

			assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(45, 15), right, 0.05, loops, allFree, 100, repeatDelay)), { x: 50, y: 15, step: step([4, 1], [5, 1]) });
			assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(45, 15), right, 0.1, loops, allFree, 100, repeatDelay)), at(5, 15));
		});

		it('steps off the north edge and comes back on at the south', () =>
		{
			const loops = gridWith({ loopsNorthSouth: true });

			assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(25, 5), { x: 0, y: -1 }, 0.1, loops, allFree, 100, repeatDelay)), at(25, 35));
		});

		it('does not step off an edge that does not loop', () =>
		{
			const loops = gridWith({ loopsNorthSouth: true });

			assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(45, 15), right, 1, loops, allFree, 100, repeatDelay)), at(45, 15));
		});

		it('does not step across a looping edge into a held cell', () =>
		{
			const loops = gridWith({ loopsEastWest: true });

			assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(45, 15), right, 1, loops, freeExcept([0, 1]), 100, repeatDelay)), at(45, 15));
		});
	});

	describe('cells left of and above the center', () =>
	{
		const centered = gridWith({ bounds: { minColumn: -2, minRow: -2, maxColumn: 2, maxRow: 2 } });

		it('moves through negative columns and rows', () =>
		{
			assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(-15, -15), right, 0.05, centered, allFree, 100, repeatDelay)), { x: -10, y: -15, step: step([-2, -2], [-1, -2]) });
		});

		it('stops at the map\'s west and north edges', () =>
		{
			assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(-15, -15), { x: -1, y: -1 }, 1, centered, allFree, 100, repeatDelay)), at(-15, -15));
		});
	});
});

describe('occupiedCells', () =>
{
	it('is the cell a standing player is in', () =>
	{
		assert.deepStrictEqual(occupiedCells(standingAt(25, 15), grid), [{ column: 2, row: 1 }]);
	});

	it('is both cells of a step in progress', () =>
	{
		const cells: Cell[] = occupiedCells({ x: 30, y: 15, step: step([2, 1], [3, 1]) }, grid);

		assert.deepStrictEqual(cells, [{ column: 2, row: 1 }, { column: 3, row: 1 }]);
	});

	it('is the cell on the far side for a step off a looping edge', () =>
	{
		const loops = gridWith({ loopsEastWest: true });

		assert.deepStrictEqual(occupiedCells({ x: 50, y: 15, step: step([4, 1], [5, 1]) }, loops), [{ column: 4, row: 1 }, { column: 0, row: 1 }]);
	});
});

describe('findFreeCell', () =>
{
	it('is the cell itself when it is free', () =>
	{
		assert.deepStrictEqual(findFreeCell({ column: 2, row: 1 }, grid, allFree, 3), { x: 25, y: 15 });
	});

	it('looks in rings around a held cell, from the top left', () =>
	{
		assert.deepStrictEqual(findFreeCell({ column: 2, row: 1 }, grid, freeExcept([2, 1]), 3), { x: 15, y: 5 });
	});

	it('skips cells that are off the map or impassable', () =>
	{
		const walls = gridWith({ walkSeconds: walkSeconds([0, 0, IMPASSABLE_WALK_SECONDS], [1, 0, IMPASSABLE_WALK_SECONDS]) });

		assert.deepStrictEqual(findFreeCell({ column: 0, row: 0 }, walls, allFree, 3), { x: 5, y: 15 });
	});

	it('looks across a looping edge', () =>
	{
		const loops = gridWith({ loopsEastWest: true });

		assert.deepStrictEqual(findFreeCell({ column: 0, row: 1 }, loops, freeExcept([0, 1]), 3), { x: 45, y: 5 });
	});

	it('returns undefined when no cell is free within the distance', () =>
	{
		assert.strictEqual(findFreeCell({ column: 0, row: 0 }, grid, () => false, 10), undefined);
		assert.strictEqual(findFreeCell({ column: 2, row: 1 }, grid, freeExcept([2, 1]), 0), undefined);
	});
});

describe('wrapCell', () =>
{
	it('brings a cell past a looping edge back onto the map', () =>
	{
		const loops = gridWith({ loopsEastWest: true, loopsNorthSouth: true });

		assert.deepStrictEqual(wrapCell({ column: 5, row: 1 }, loops), { column: 0, row: 1 });
		assert.deepStrictEqual(wrapCell({ column: -1, row: -1 }, loops), { column: 4, row: 3 });
	});

	it('leaves a cell alone along an axis that does not loop', () =>
	{
		assert.deepStrictEqual(wrapCell({ column: 5, row: -1 }, grid), { column: 5, row: -1 });
	});
});

describe('cellCenter', () =>
{
	it('returns the middle of the cell', () =>
	{
		assert.deepStrictEqual(cellCenter({ column: 0, row: 0 }, grid), { x: 5, y: 5 });
		assert.deepStrictEqual(cellCenter({ column: 4, row: 3 }, grid), { x: 45, y: 35 });
	});
});

describe('cellAt', () =>
{
	it('returns the cell a position is in, clamped to the grid', () =>
	{
		assert.deepStrictEqual(cellAt({ x: 25, y: 15 }, grid), { column: 2, row: 1 });
		assert.deepStrictEqual(cellAt({ x: 49.9, y: 0 }, grid), { column: 4, row: 0 });
		assert.deepStrictEqual(cellAt({ x: 999, y: -5 }, grid), { column: 4, row: 0 });
	});

	it('handles negative positions', () =>
	{
		const centered = gridWith({ bounds: { minColumn: -2, minRow: -2, maxColumn: 2, maxRow: 2 } });

		assert.deepStrictEqual(cellAt({ x: -15, y: -0.5 }, centered), { column: -2, row: -1 });
		assert.deepStrictEqual(cellAt({ x: -999, y: 999 }, centered), { column: -2, row: 2 });
	});
});
