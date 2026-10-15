import assert from 'assert';

import { PLAYER_SPEED, spawnPosition, stepPosition, type Bounds } from '../../src/logic/movement.js';

const bounds: Bounds = { minX: 10, minY: 20, maxX: 950, maxY: 520 };

describe('stepPosition', () =>
{
	it('does not move when no direction is held', () =>
	{
		assert.deepStrictEqual(stepPosition({ x: 100, y: 100 }, { x: 0, y: 0 }, 1, bounds), { x: 100, y: 100 });
	});

	it('moves along one axis at the given speed', () =>
	{
		assert.deepStrictEqual(stepPosition({ x: 100, y: 100 }, { x: 1, y: 0 }, 0.5, bounds, 100), { x: 150, y: 100 });
		assert.deepStrictEqual(stepPosition({ x: 100, y: 100 }, { x: 0, y: -1 }, 0.5, bounds, 100), { x: 100, y: 50 });
	});

	it('uses PLAYER_SPEED by default', () =>
	{
		assert.deepStrictEqual(stepPosition({ x: 100, y: 100 }, { x: 1, y: 0 }, 1, bounds), { x: 100 + PLAYER_SPEED, y: 100 });
	});

	it('does not move faster diagonally', () =>
	{
		const position = stepPosition({ x: 100, y: 100 }, { x: 1, y: 1 }, 1, bounds, 100);
		const distance = Math.hypot(position.x - 100, position.y - 100);

		assert.ok(Math.abs(distance - 100) < 1e-9, `moved ${distance}`);
		assert.ok(Math.abs(position.x - position.y) < 1e-9);
	});

	it('stays inside the bounds', () =>
	{
		assert.deepStrictEqual(stepPosition({ x: 15, y: 25 }, { x: -1, y: -1 }, 10, bounds), { x: 10, y: 20 });
		assert.deepStrictEqual(stepPosition({ x: 940, y: 510 }, { x: 1, y: 1 }, 10, bounds), { x: 950, y: 520 });
	});

	it('does not move for a zero or negative time step', () =>
	{
		assert.deepStrictEqual(stepPosition({ x: 100, y: 100 }, { x: 1, y: 0 }, 0, bounds), { x: 100, y: 100 });
		assert.deepStrictEqual(stepPosition({ x: 100, y: 100 }, { x: 1, y: 0 }, -1, bounds), { x: 100, y: 100 });
	});

	it('does not change the position it was given', () =>
	{
		const position = { x: 100, y: 100 };

		stepPosition(position, { x: 1, y: 1 }, 1, bounds);

		assert.deepStrictEqual(position, { x: 100, y: 100 });
	});
});

describe('spawnPosition', () =>
{
	it('scales the random values to the bounds', () =>
	{
		const values = [0.25, 0.5];

		assert.deepStrictEqual(spawnPosition(bounds, () => values.shift() ?? 0), { x: 245, y: 270 });
	});

	it('stays inside the bounds', () =>
	{
		assert.deepStrictEqual(spawnPosition(bounds, () => 0), { x: 10, y: 20 });

		const position = spawnPosition(bounds, () => 0.999999);

		assert.ok((position.x < bounds.maxX) && (position.y < bounds.maxY));
	});
});
