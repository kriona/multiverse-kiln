import assert from 'assert';
import { CHUNK_SIZE, chunkKey, cellIndexInChunk, DEFAULT_INDOOR_WALK_SECONDS, DEFAULT_OUTDOOR_WALK_SECONDS, DEFAULT_TILE_CELL, IMPASSABLE_WALK_SECONDS, VOID_CELL } from '@multiverse-kiln/shared';

import { createAreaGrid, linkAt, type AreaLink, type AreaMap } from '../../src/logic/areaGrid.js';

const GRASS = 1;
const FOREST = 2;
const UNKNOWN_TILE = 99;

/**
 * A chunk of default cells with some cells set
 *
 * @param cells Cells to set, as [column, row, value]
 * @return The chunk's cell values
 */
function chunkWith(...cells: [number, number, number][]): number[]
{
	const values = new Array<number>(CHUNK_SIZE * CHUNK_SIZE).fill(DEFAULT_TILE_CELL);

	for (const [column, row, value] of cells)
	{
		values[cellIndexInChunk(column, row)] = value;
	}

	return(values);
}

/**
 * A link from a cell to the center of another area
 *
 * @param column The cell's column
 * @param row The cell's row
 * @param mode How the link is taken
 * @return The link
 */
function link(column: number, row: number, mode: AreaLink['mode']): AreaLink
{
	return({ column, row, targetAreaId: 'other-area', targetColumn: 0, targetRow: 0, mode, requiresWholeGroup: false });
}

// Five columns by three rows around the center, mostly grass: forest at (1, 0), void at (2, 0), and an
// unknown tile at (-1, -1), which is in a different chunk from the rest
const map: AreaMap = {
	tiles: {
		bounds: { minColumn: -2, minRow: -1, maxColumn: 2, maxRow: 1 },
		defaultTileId: GRASS,
		chunks: new Map([
			[chunkKey(0, 0), chunkWith([1, 0, FOREST], [2, 0, VOID_CELL])],
			[chunkKey(-1, -1), chunkWith([-1, -1, UNKNOWN_TILE])]
		])
	},
	indoors: true,
	loopsEastWest: true,
	loopsNorthSouth: false,
	tileWalkSeconds: new Map([[GRASS, 10], [FOREST, 20]]),
	links: [link(0, 1, 'automatic'), link(-2, 1, 'manual')]
};

describe('createAreaGrid', () =>
{
	const grid = createAreaGrid(map, 30);

	it('takes its bounds, edges and cell size from the area', () =>
	{
		assert.deepStrictEqual(grid.bounds, map.tiles.bounds);
		assert.strictEqual(grid.loopsEastWest, true);
		assert.strictEqual(grid.loopsNorthSouth, false);
		assert.strictEqual(grid.cellSize, 30);
	});

	it('crosses the default walk seconds of indoor or outdoor tiles at full speed', () =>
	{
		assert.strictEqual(grid.fullSpeedWalkSeconds, DEFAULT_INDOOR_WALK_SECONDS);
		assert.strictEqual(createAreaGrid({ ...map, indoors: false }, 30).fullSpeedWalkSeconds, DEFAULT_OUTDOOR_WALK_SECONDS);
	});

	it('gives each cell its tile\'s walk seconds', () =>
	{
		assert.strictEqual(grid.walkSeconds({ column: 0, row: 0 }), 10);
		assert.strictEqual(grid.walkSeconds({ column: 1, row: 0 }), 20);
	});

	it('makes void cells, unknown tiles and cells off the map impassable', () =>
	{
		assert.strictEqual(grid.walkSeconds({ column: 2, row: 0 }), IMPASSABLE_WALK_SECONDS);
		assert.strictEqual(grid.walkSeconds({ column: -1, row: -1 }), IMPASSABLE_WALK_SECONDS);
		assert.strictEqual(grid.walkSeconds({ column: 3, row: 0 }), IMPASSABLE_WALK_SECONDS);
	});

	it('makes cells whose chunk has not loaded impassable, when the map is loaded a piece at a time', () =>
	{
		const partial = createAreaGrid({ ...map, loadedChunks: new Set([chunkKey(0, 0)]) }, 30);

		assert.strictEqual(partial.walkSeconds({ column: 1, row: 0 }), 20);
		assert.strictEqual(partial.walkSeconds({ column: -2, row: 0 }), IMPASSABLE_WALK_SECONDS);
		assert.strictEqual(grid.walkSeconds({ column: -2, row: 0 }), 10);
	});

	it('ends movement on automatic links only', () =>
	{
		assert.strictEqual(grid.endsMovement({ column: 0, row: 1 }), true);
		assert.strictEqual(grid.endsMovement({ column: -2, row: 1 }), false);
		assert.strictEqual(grid.endsMovement({ column: 0, row: 0 }), false);
	});
});

describe('linkAt', () =>
{
	it('finds the link on a cell', () =>
	{
		assert.strictEqual(linkAt(map, { column: -2, row: 1 })?.mode, 'manual');
	});

	it('returns undefined for a cell with no link', () =>
	{
		assert.strictEqual(linkAt(map, { column: 1, row: 1 }), undefined);
	});
});
