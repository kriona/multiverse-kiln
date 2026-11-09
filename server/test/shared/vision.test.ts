import assert from 'assert';
import { areaLight, canSee, chunkKey, createVisionArea, CHUNK_SIZE, DARKVISION_SQUARES, darkvisionSquares, DAY_VISION_SQUARES, LIGHT_SENSITIVE_VISION_SHARE, MIDNIGHT_SECONDS, NIGHT_VISION_SQUARES, NOON_SECONDS, PLAIN_SIGHT, SUPERIOR_DARKVISION_SQUARES, VOID_CELL, visibleCells, visionBudget, visionKey, type AreaBounds, type VisionArea } from '@multiverse-kiln/shared';

const bounds: AreaBounds = {
	minColumn: -50,
	minRow: -25,
	maxColumn: 50,
	maxRow: 25
};

const origin = { column: 0, row: 0 };

/**
 * An area with a vision cost on some cells and none on the rest
 *
 * @param costs Each cell's vision cost, by visionKey()
 * @param loops Whether the area loops both ways
 * @return The area
 */
function areaWith(costs: Record<string, number> = {}, loops: boolean = false): VisionArea
{
	return({
		bounds,
		loopsEastWest: loops,
		loopsNorthSouth: loops,
		clear: false,
		visionCost: (column, row) => (costs[visionKey(column, row)] ?? 0)
	});
}

describe('vision (shared)', () =>
{
	describe('visionBudget', () =>
	{
		const darkvision = {
			darkvision: darkvisionSquares('normal'),
			lightSensitivity: false
		};
		const drow = {
			darkvision: darkvisionSquares('superior'),
			lightSensitivity: true
		};

		it('sees furthest by day and least at night', () =>
		{
			assert.strictEqual(visionBudget(areaLight(null, NOON_SECONDS), PLAIN_SIGHT, false), DAY_VISION_SQUARES);
			assert.strictEqual(visionBudget(areaLight(null, MIDNIGHT_SECONDS), PLAIN_SIGHT, false), NIGHT_VISION_SQUARES);
		});

		it('sees as far as darkvision does in the dark, and no less by day', () =>
		{
			assert.strictEqual(visionBudget(areaLight(null, MIDNIGHT_SECONDS), darkvision, false), DARKVISION_SQUARES);
			assert.strictEqual(visionBudget(areaLight(null, NOON_SECONDS), darkvision, false), DAY_VISION_SQUARES);
		});

		it('sees as far as superior darkvision does in the dark', () =>
		{
			assert.strictEqual(darkvisionSquares('none'), 0);
			assert.strictEqual(visionBudget(areaLight(null, MIDNIGHT_SECONDS), { ...drow, lightSensitivity: false }, false), SUPERIOR_DARKVISION_SQUARES);
			assert.strictEqual(visionBudget(areaLight(null, NOON_SECONDS), { ...drow, lightSensitivity: false }, false), SUPERIOR_DARKVISION_SQUARES);
		});

		it('sees less in bright light with light sensitivity, and no less in the dark', () =>
		{
			assert.strictEqual(visionBudget(areaLight(null, MIDNIGHT_SECONDS), drow, false), SUPERIOR_DARKVISION_SQUARES);
			assert.strictEqual(visionBudget(areaLight(null, NOON_SECONDS), drow, false), SUPERIOR_DARKVISION_SQUARES * LIGHT_SENSITIVE_VISION_SHARE);
			assert.strictEqual(visionBudget(areaLight('lit', MIDNIGHT_SECONDS), drow, false), SUPERIOR_DARKVISION_SQUARES * LIGHT_SENSITIVE_VISION_SHARE);
			assert.strictEqual(visionBudget(areaLight(null, NOON_SECONDS), { ...PLAIN_SIGHT, lightSensitivity: true }, false), DAY_VISION_SQUARES * LIGHT_SENSITIVE_VISION_SHARE);
		});

		it('sees as far at night as by day with full vision', () =>
		{
			assert.strictEqual(visionBudget(areaLight(null, MIDNIGHT_SECONDS), PLAIN_SIGHT, true), DAY_VISION_SQUARES);
			assert.strictEqual(visionBudget(areaLight(null, MIDNIGHT_SECONDS), darkvision, true), DAY_VISION_SQUARES);
			assert.strictEqual(visionBudget(areaLight(null, NOON_SECONDS), drow, true), DAY_VISION_SQUARES);
		});

		it('sees as far as by day in a lit indoor area and as at night in a dark one, whatever the time', () =>
		{
			assert.strictEqual(visionBudget(areaLight('lit', MIDNIGHT_SECONDS), PLAIN_SIGHT, false), DAY_VISION_SQUARES);
			assert.strictEqual(visionBudget(areaLight('dark', NOON_SECONDS), PLAIN_SIGHT, false), NIGHT_VISION_SQUARES);
			assert.strictEqual(visionBudget(areaLight('dark', NOON_SECONDS), darkvision, false), DARKVISION_SQUARES);
		});
	});

	describe('canSee', () =>
	{
		it('sees as many squares as the budget, with a diagonal counting as one and a half', () =>
		{
			const area = areaWith();

			assert.strictEqual(canSee(origin, { column: 20, row: 0 }, 20, area), true);
			assert.strictEqual(canSee(origin, { column: 21, row: 0 }, 20, area), false);
			assert.strictEqual(canSee(origin, { column: -10, row: 10 }, 15, area), true);
			assert.strictEqual(canSee(origin, { column: -10, row: 10 }, 14, area), false);
			assert.strictEqual(canSee(origin, origin, 0, area), true);
		});

		it('sees a cell that can\'t be seen past, but nothing behind it', () =>
		{
			const area = areaWith({ [visionKey(3, 0)]: 100 });

			assert.strictEqual(canSee(origin, { column: 3, row: 0 }, 20, area), true);
			assert.strictEqual(canSee(origin, { column: 4, row: 0 }, 20, area), false);
			assert.strictEqual(canSee(origin, { column: 3, row: 5 }, 20, area), true);
		});

		it('spends more of the budget looking past cells with a vision cost', () =>
		{
			const area = areaWith({
				[visionKey(1, 0)]: 50,
				[visionKey(2, 0)]: 50,
				[visionKey(3, 0)]: 50
			});

			// 1 out of the character's own cell, 2 out of each forest cell, then 1 each for the last six
			assert.strictEqual(canSee(origin, { column: 10, row: 0 }, 13, area), true);
			assert.strictEqual(canSee(origin, { column: 10, row: 0 }, 12, area), false);
		});

		it('leaves out the character\'s own cell', () =>
		{
			const area = areaWith({ [visionKey(0, 0)]: 100 });

			assert.strictEqual(canSee(origin, { column: 5, row: 0 }, 20, area), true);
		});

		it('sees nothing outside the area', () =>
		{
			assert.strictEqual(canSee({ column: 50, row: 0 }, { column: 51, row: 0 }, 20, areaWith()), false);
		});

		it('looks the shorter way round an area that loops', () =>
		{
			assert.strictEqual(canSee({ column: 50, row: 25 }, { column: -50, row: -25 }, 2, areaWith({}, true)), true);
			assert.strictEqual(canSee({ column: 50, row: 25 }, { column: -50, row: -25 }, 2, areaWith()), false);
		});
	});

	describe('visibleCells', () =>
	{
		it('holds every cell in sight and none behind a wall', () =>
		{
			const area = areaWith({ [visionKey(0, -2)]: 100 });
			const visible = visibleCells(origin, 4, area);

			assert.ok(visible.has(visionKey(0, 0)));
			assert.ok(visible.has(visionKey(4, 0)));
			assert.ok(visible.has(visionKey(0, -2)));
			assert.ok(!visible.has(visionKey(0, -3)));
			assert.ok(!visible.has(visionKey(5, 0)));
			assert.ok(!visible.has(visionKey(3, 3)));
		});

		it('sees the walls lining a corridor, but not the wall behind them', () =>
		{
			const costs: Record<string, number> = {};

			// A corridor two cells wide along rows 0 and 1, with walls two thick either side
			for (let column = -20; column <= 20; column++)
			{
				for (const row of [-2, -1, 2, 3])
				{
					costs[visionKey(column, row)] = 100;
				}
			}

			const visible = visibleCells(origin, 20, areaWith(costs));

			assert.ok(visible.has(visionKey(15, 1)));
			assert.ok(visible.has(visionKey(15, 2)));
			assert.ok(visible.has(visionKey(-15, -1)));
			assert.ok(!visible.has(visionKey(15, 3)));
			assert.ok(!visible.has(visionKey(-15, -2)));
			assert.strictEqual(canSee(origin, { column: 15, row: 2 }, 20, areaWith(costs)), true);
		});

		it('doesn\'t see a wall only open ground diagonally beside it shows', () =>
		{
			const costs: Record<string, number> = {};

			// A mountain range whose eastern tip has open ground on every side and hidden from the origin
			for (const [column, row] of [[0, 1], [1, 1], [-1, 2], [0, 2], [1, 2], [2, 2], [0, 3], [1, 3]])
			{
				costs[visionKey(column, row)] = 100;
			}

			const visible = visibleCells(origin, 20, areaWith(costs));

			assert.ok(visible.has(visionKey(3, 1)));
			assert.ok(!visible.has(visionKey(2, 1)));
			assert.ok(!visible.has(visionKey(2, 2)));
		});

		it('sees the corners of a room', () =>
		{
			const costs: Record<string, number> = {};

			// A room from column 1 to 5 and row 1 to 3, walled all round
			for (let column = 0; column <= 6; column++)
			{
				for (let row = 0; row <= 4; row++)
				{
					if ((column === 0) || (column === 6) || (row === 0) || (row === 4))
					{
						costs[visionKey(column, row)] = 100;
					}
				}
			}

			const area = areaWith(costs);
			const from = { column: 5, row: 1 };

			assert.strictEqual(canSee(from, { column: 0, row: 0 }, 20, area), true);
			assert.strictEqual(canSee(from, { column: 0, row: 4 }, 20, area), true);
			assert.strictEqual(canSee(from, { column: -1, row: 0 }, 20, area), false);
		});

		it('sees the same mirrored east to west', () =>
		{
			const area = areaWith({
				[visionKey(2, 1)]: 100,
				[visionKey(-2, 1)]: 100
			});
			const visible = visibleCells(origin, 8, area);

			for (let row = -8; row <= 8; row++)
			{
				for (let column = 1; column <= 8; column++)
				{
					assert.strictEqual(visible.has(visionKey(column, row)), visible.has(visionKey(-column, row)), visionKey(column, row));
				}
			}
		});

		it('gives cells past a looping edge as the cells inside the area', () =>
		{
			const visible = visibleCells({ column: 50, row: 0 }, 2, areaWith({}, true));

			assert.ok(visible.has(visionKey(-50, 0)));
			assert.ok(!visible.has(visionKey(51, 0)));
		});
	});

	describe('createVisionArea', () =>
	{
		it('reads each cell\'s tile, and sees past void and unknown tiles', () =>
		{
			const cells = new Array<number>(CHUNK_SIZE * CHUNK_SIZE).fill(0);

			cells[1] = 2;
			cells[2] = VOID_CELL;
			cells[3] = 99;

			const area = createVisionArea({ bounds, defaultTileId: 1, chunks: new Map([[chunkKey(0, 0), cells]]) }, false, false, new Map([[1, 0], [2, 50]]));

			assert.strictEqual(area.visionCost(0, 0), 0);
			assert.strictEqual(area.visionCost(1, 0), 50);
			assert.strictEqual(area.visionCost(2, 0), 0);
			assert.strictEqual(area.visionCost(3, 0), 0);
		});

		it('is clear only when none of its tiles has a vision cost', () =>
		{
			const tiles = { bounds, defaultTileId: 1, chunks: new Map() };

			assert.strictEqual(createVisionArea(tiles, false, false, new Map([[1, 0], [2, 0]])).clear, true);
			assert.strictEqual(createVisionArea(tiles, false, false, new Map([[1, 0], [2, 50]])).clear, false);
		});

		it('sees in a clear area just what walking every line sees', () =>
		{
			for (const loops of [false, true])
			{
				const walked = areaWith({}, loops);
				const clear = { ...walked, clear: true };

				for (const from of [origin, { column: 48, row: -23 }])
				{
					for (const budget of [NIGHT_VISION_SQUARES, DARKVISION_SQUARES + 0.5, DAY_VISION_SQUARES])
					{
						assert.deepStrictEqual(visibleCells(from, budget, clear), visibleCells(from, budget, walked));
					}
				}
			}
		});
	});
});
