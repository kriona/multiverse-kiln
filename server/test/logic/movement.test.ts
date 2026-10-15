import assert from 'assert';
import type { MovePayload } from '@multiverse-kiln/shared';

import { cellAt, cellCenter, NO_PRESS, occupiedCells, PLAYER_SPEED, spawnPosition, STEP_REPEAT_DELAY, stepOnGrid, type Cell, type GridMover, type Grid, type GridStep, type IsCellFree } from '../../src/logic/movement.js';

// Cell centers are at x = 5, 15, 25, 35, 45 and y = 5, 15, 25, 35. At the speed of 100 these tests use,
// a step between neighboring cells takes 0.1 seconds
const grid: Grid = { cellSize: 10, columns: 5, rows: 4 };

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
		assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(25, 15), standingStill, 1, grid, allFree, 100)), at(25, 15));
	});

	it('starts a step toward the neighboring cell\'s center', () =>
	{
		assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(25, 15), right, 0.05, grid, allFree, 100)), { x: 30, y: 15, step: step([2, 1], [3, 1]) });
		assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(25, 15), { x: 0, y: -1 }, 0.05, grid, allFree, 100)), { x: 25, y: 10, step: step([2, 1], [2, 0]) });
	});

	it('finishes a step after the direction is released, stopping exactly on the cell center', () =>
	{
		const midStep: GridMover = { x: 30, y: 15, step: step([2, 1], [3, 1]), press: NO_PRESS };

		assert.deepStrictEqual(placeOf(stepOnGrid(midStep, standingStill, 0.02, grid, allFree, 100)), { x: 32, y: 15, step: step([2, 1], [3, 1]) });
		assert.deepStrictEqual(placeOf(stepOnGrid(midStep, standingStill, 1, grid, allFree, 100)), at(35, 15));
	});

	it('carries on into the next cell without stopping once the direction has been held', () =>
	{
		assert.deepStrictEqual(placeOf(stepOnGrid(holdingAt(25, 15, right), right, 0.15, grid, allFree, 100)), { x: 40, y: 15, step: step([3, 1], [4, 1]) });
	});

	it('finishes the current step before changing direction', () =>
	{
		const midStep: GridMover = { x: 30, y: 15, step: step([2, 1], [3, 1]), press: { direction: right, heldSeconds: 0.05, stepsStarted: 1 } };

		assert.deepStrictEqual(placeOf(stepOnGrid(midStep, down, 0.1, grid, allFree, 100)), { x: 35, y: 20, step: step([3, 1], [3, 2]) });
	});

	it('uses PLAYER_SPEED by default', () =>
	{
		const wideGrid: Grid = { cellSize: 1000, columns: 3, rows: 1 };

		assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(500, 500), right, 1, wideGrid, allFree)), { x: 500 + PLAYER_SPEED, y: 500, step: step([0, 0], [1, 0]) });
	});

	it('steps diagonally at the same speed', () =>
	{
		const mover = stepOnGrid(standingAt(15, 15), downRight, 0.05, grid, allFree, 100);
		const distance = Math.hypot(mover.x - 15, mover.y - 15);

		assert.deepStrictEqual(mover.step, step([1, 1], [2, 2]));
		assert.ok(Math.abs(distance - 5) < 1e-9, `moved ${distance}`);
		assert.strictEqual(mover.x, mover.y);
	});

	it('does not step off the grid', () =>
	{
		assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(45, 15), right, 1, grid, allFree, 100)), at(45, 15));
		assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(5, 5), { x: -1, y: -1 }, 1, grid, allFree, 100)), at(5, 5));
	});

	it('drops the axis that would leave the grid from a diagonal step', () =>
	{
		assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(45, 15), downRight, 0.05, grid, allFree, 100)), { x: 45, y: 20, step: step([4, 1], [4, 2]) });
	});

	it('stops at the edge of the grid while the direction is still held', () =>
	{
		assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(25, 15), right, 10, grid, allFree, 100)), at(45, 15));
	});

	it('moves a player that is off a cell center back onto it', () =>
	{
		assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(22, 15), standingStill, 1, grid, allFree, 100)), at(25, 15));
	});

	it('does not move for a zero or negative time step', () =>
	{
		assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(25, 15), right, 0, grid, allFree, 100)), at(25, 15));
		assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(25, 15), right, -1, grid, allFree, 100)), at(25, 15));
	});

	it('does not change the mover it was given', () =>
	{
		const mover: GridMover = { x: 30, y: 15, step: step([2, 1], [3, 1]), press: { direction: right, heldSeconds: 0.05, stepsStarted: 1 } };

		stepOnGrid(mover, right, 1, grid, allFree, 100);

		assert.deepStrictEqual(mover, { x: 30, y: 15, step: step([2, 1], [3, 1]), press: { direction: right, heldSeconds: 0.05, stepsStarted: 1 } });
	});

	describe('repeat delay', () =>
	{
		it('moves one cell for a press held a little longer than a step but shorter than the delay', () =>
		{
			const mover = stepOnGrid(standingAt(5, 15), right, 0.2, grid, allFree, 100);

			assert.deepStrictEqual(placeOf(mover), at(15, 15));
			assert.deepStrictEqual(mover.press, { direction: right, heldSeconds: 0.2, stepsStarted: 1 });
		});

		it('starts the second step once the direction has been held for the delay', () =>
		{
			// First step over at 0.1s; second starts at the delay and runs for the rest of the time
			const mover = stepOnGrid(standingAt(5, 15), right, STEP_REPEAT_DELAY + 0.05, grid, allFree, 100);

			assert.deepStrictEqual(placeOf(mover), { x: 20, y: 15, step: step([1, 1], [2, 1]) });
		});

		it('measures the delay across ticks', () =>
		{
			const afterFirstTick = stepOnGrid(standingAt(5, 15), right, 0.2, grid, allFree, 100);
			const afterSecondTick = stepOnGrid(afterFirstTick, right, (STEP_REPEAT_DELAY - 0.2) + 0.05, grid, allFree, 100);

			assert.deepStrictEqual(placeOf(afterSecondTick), { x: 20, y: 15, step: step([1, 1], [2, 1]) });
		});

		it('steps at once in a newly pressed direction', () =>
		{
			const afterFirstStep = stepOnGrid(standingAt(5, 15), right, 0.15, grid, allFree, 100);

			assert.deepStrictEqual(placeOf(stepOnGrid(afterFirstStep, down, 0.05, grid, allFree, 100)), { x: 15, y: 20, step: step([1, 1], [1, 2]) });
		});

		it('steps at once when the same direction is released and pressed again', () =>
		{
			const afterFirstStep = stepOnGrid(standingAt(5, 15), right, 0.15, grid, allFree, 100);
			const released = stepOnGrid(afterFirstStep, standingStill, 0.01, grid, allFree, 100);

			assert.deepStrictEqual(placeOf(stepOnGrid(released, right, 0.05, grid, allFree, 100)), { x: 20, y: 15, step: step([1, 1], [2, 1]) });
		});

		it('takes the first step at once when a blocked cell frees up', () =>
		{
			const blocked = stepOnGrid(standingAt(5, 15), right, 0.5, grid, freeExcept([1, 1]), 100);

			assert.deepStrictEqual(placeOf(blocked), at(5, 15));
			assert.deepStrictEqual(placeOf(stepOnGrid(blocked, right, 0.05, grid, allFree, 100)), { x: 10, y: 15, step: step([0, 1], [1, 1]) });
		});
	});

	describe('other players', () =>
	{
		it('does not step into a held cell', () =>
		{
			assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(25, 15), right, 1, grid, freeExcept([3, 1]), 100)), at(25, 15));
		});

		it('stops on the cell before a held one while the direction is held', () =>
		{
			assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(5, 15), right, 1, grid, freeExcept([3, 1]), 100)), at(25, 15));
		});

		it('does not cut a corner past a held cell', () =>
		{
			// The diagonal cell (2, 2) is free, but (2, 1) beside it is held, so only the vertical part is taken
			assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(15, 15), downRight, 0.05, grid, freeExcept([2, 1]), 100)), { x: 15, y: 20, step: step([1, 1], [1, 2]) });
		});

		it('slides horizontally when the diagonal cell is held', () =>
		{
			assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(15, 15), downRight, 0.05, grid, freeExcept([2, 2]), 100)), { x: 20, y: 15, step: step([1, 1], [2, 1]) });
		});

		it('waits when every way in the held direction is blocked', () =>
		{
			assert.deepStrictEqual(placeOf(stepOnGrid(standingAt(15, 15), downRight, 1, grid, freeExcept([2, 1], [1, 2]), 100)), at(15, 15));
		});

		it('finishes a step already started even if the cell is now held', () =>
		{
			const midStep: GridMover = { x: 30, y: 15, step: step([2, 1], [3, 1]), press: NO_PRESS };

			assert.deepStrictEqual(placeOf(stepOnGrid(midStep, standingStill, 1, grid, freeExcept([3, 1]), 100)), at(35, 15));
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
});

describe('spawnPosition', () =>
{
	it('picks the cell the random values point to', () =>
	{
		const values = [0.5, 0.5];

		assert.deepStrictEqual(spawnPosition(grid, () => values.shift() ?? 0, allFree), { x: 25, y: 25 });
	});

	it('stays on the grid', () =>
	{
		assert.deepStrictEqual(spawnPosition(grid, () => 0, allFree), { x: 5, y: 5 });
		assert.deepStrictEqual(spawnPosition(grid, () => 0.999999, allFree), { x: 45, y: 35 });
	});

	it('takes the next free cell when the random one is held', () =>
	{
		assert.deepStrictEqual(spawnPosition(grid, () => 0, freeExcept([0, 0], [1, 0])), { x: 25, y: 5 });
	});

	it('wraps around to the start of the grid', () =>
	{
		assert.deepStrictEqual(spawnPosition(grid, () => 0.999999, freeExcept([4, 3])), { x: 5, y: 5 });
	});

	it('returns undefined when every cell is held', () =>
	{
		assert.strictEqual(spawnPosition(grid, () => 0, () => false), undefined);
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
});
