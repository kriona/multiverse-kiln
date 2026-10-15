import assert from 'assert';

import { cellCenter, PLAYER_SPEED, spawnPosition, stepOnGrid, type Grid, type GridMover } from '../../src/logic/movement.js';

// Cell centers are at x = 5, 15, 25, 35, 45 and y = 5, 15, 25, 35
const grid: Grid = { cellSize: 10, columns: 5, rows: 4 };

const standingStill = { x: 0, y: 0 } as const;
const right = { x: 1, y: 0 } as const;

/**
 * A player standing on a position with no step in progress
 *
 * @param x X position
 * @param y Y position
 * @return The mover
 */
function standingAt(x: number, y: number): GridMover
{
	return({ x, y, target: undefined });
}

describe('stepOnGrid', () =>
{
	it('does not move when no direction is held', () =>
	{
		assert.deepStrictEqual(stepOnGrid(standingAt(25, 15), standingStill, 1, grid, 100), standingAt(25, 15));
	});

	it('starts a step toward the neighboring cell\'s center', () =>
	{
		assert.deepStrictEqual(stepOnGrid(standingAt(25, 15), right, 0.05, grid, 100), { x: 30, y: 15, target: { x: 35, y: 15 } });
		assert.deepStrictEqual(stepOnGrid(standingAt(25, 15), { x: 0, y: -1 }, 0.05, grid, 100), { x: 25, y: 10, target: { x: 25, y: 5 } });
	});

	it('finishes a step after the direction is released, stopping exactly on the cell center', () =>
	{
		const midStep: GridMover = { x: 30, y: 15, target: { x: 35, y: 15 } };

		assert.deepStrictEqual(stepOnGrid(midStep, standingStill, 0.02, grid, 100), { x: 32, y: 15, target: { x: 35, y: 15 } });
		assert.deepStrictEqual(stepOnGrid(midStep, standingStill, 1, grid, 100), standingAt(35, 15));
	});

	it('carries on into the next cell while the direction is held', () =>
	{
		assert.deepStrictEqual(stepOnGrid(standingAt(25, 15), right, 0.15, grid, 100), { x: 40, y: 15, target: { x: 45, y: 15 } });
	});

	it('finishes the current step before changing direction', () =>
	{
		const midStep: GridMover = { x: 30, y: 15, target: { x: 35, y: 15 } };

		assert.deepStrictEqual(stepOnGrid(midStep, { x: 0, y: 1 }, 0.1, grid, 100), { x: 35, y: 20, target: { x: 35, y: 25 } });
	});

	it('uses PLAYER_SPEED by default', () =>
	{
		const wideGrid: Grid = { cellSize: 1000, columns: 3, rows: 1 };

		assert.deepStrictEqual(stepOnGrid(standingAt(500, 500), right, 1, wideGrid), { x: 500 + PLAYER_SPEED, y: 500, target: { x: 1500, y: 500 } });
	});

	it('steps diagonally at the same speed', () =>
	{
		const mover = stepOnGrid(standingAt(15, 15), { x: 1, y: 1 }, 0.05, grid, 100);
		const distance = Math.hypot(mover.x - 15, mover.y - 15);

		assert.deepStrictEqual(mover.target, { x: 25, y: 25 });
		assert.ok(Math.abs(distance - 5) < 1e-9, `moved ${distance}`);
		assert.strictEqual(mover.x, mover.y);
	});

	it('does not step off the grid', () =>
	{
		assert.deepStrictEqual(stepOnGrid(standingAt(45, 15), right, 1, grid, 100), standingAt(45, 15));
		assert.deepStrictEqual(stepOnGrid(standingAt(5, 5), { x: -1, y: -1 }, 1, grid, 100), standingAt(5, 5));
	});

	it('drops the axis that would leave the grid from a diagonal step', () =>
	{
		assert.deepStrictEqual(stepOnGrid(standingAt(45, 15), { x: 1, y: 1 }, 0.05, grid, 100), { x: 45, y: 20, target: { x: 45, y: 25 } });
	});

	it('stops at the edge of the grid while the direction is still held', () =>
	{
		assert.deepStrictEqual(stepOnGrid(standingAt(25, 15), right, 10, grid, 100), standingAt(45, 15));
	});

	it('moves a player that is off a cell center back onto it', () =>
	{
		assert.deepStrictEqual(stepOnGrid(standingAt(22, 15), standingStill, 1, grid, 100), standingAt(25, 15));
	});

	it('does not move for a zero or negative time step', () =>
	{
		assert.deepStrictEqual(stepOnGrid(standingAt(25, 15), right, 0, grid, 100), standingAt(25, 15));
		assert.deepStrictEqual(stepOnGrid(standingAt(25, 15), right, -1, grid, 100), standingAt(25, 15));
	});

	it('does not change the mover it was given', () =>
	{
		const mover: GridMover = { x: 30, y: 15, target: { x: 35, y: 15 } };

		stepOnGrid(mover, right, 1, grid, 100);

		assert.deepStrictEqual(mover, { x: 30, y: 15, target: { x: 35, y: 15 } });
	});
});

describe('spawnPosition', () =>
{
	it('picks the cell the random values point to', () =>
	{
		const values = [0.5, 0.5];

		assert.deepStrictEqual(spawnPosition(grid, () => values.shift() ?? 0), { x: 25, y: 25 });
	});

	it('stays on the grid', () =>
	{
		assert.deepStrictEqual(spawnPosition(grid, () => 0), { x: 5, y: 5 });
		assert.deepStrictEqual(spawnPosition(grid, () => 0.999999), { x: 45, y: 35 });
	});
});

describe('cellCenter', () =>
{
	it('returns the middle of the cell', () =>
	{
		assert.deepStrictEqual(cellCenter(0, 0, grid), { x: 5, y: 5 });
		assert.deepStrictEqual(cellCenter(4, 3, grid), { x: 45, y: 35 });
	});
});
