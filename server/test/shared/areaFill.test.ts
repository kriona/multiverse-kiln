import assert from 'assert';
import { areaFill, DEFAULT_TILE_CELL, MAX_AREA_SIDE, type AreaBounds } from '@multiverse-kiln/shared';

/**
 * Cells of an area drawn as rows of characters: '.' is the default tile, '?' a cell not known yet and
 * any other character a tile, by its character code
 *
 * @param rows The rows, top first, starting at column 0, row 0
 * @return The area's bounds and each cell's value
 */
function drawnArea(rows: string[]): { bounds: AreaBounds; valueAt: (column: number, row: number) => number | undefined }
{
	return({
		bounds: {
			minColumn: 0,
			minRow: 0,
			maxColumn: rows[0].length - 1,
			maxRow: rows.length - 1
		},
		valueAt: (column, row) =>
		{
			const cell = rows[row][column];

			if (cell === '?')
			{
				return(undefined);
			}

			return(((cell === '.') ? DEFAULT_TILE_CELL : cell.charCodeAt(0)));
		}
	});
}

/**
 * Whether two values are the same, for areas that store each tile one way only
 *
 * @param first One value
 * @param second The other
 * @return True when they match
 */
function sameValue(first: number, second: number): boolean
{
	return(first === second);
}

/**
 * A fill's cells as sorted "column,row" strings, to compare without depending on the order they were found in
 *
 * @param cells The cells
 * @return The sorted strings
 */
function sortedCells(cells: Array<[number, number]>): string[]
{
	return(cells
		.map(([column, row]) => `${column},${row}`)
		.sort());
}

describe('areaFill (shared)', () =>
{
	it('fills the cells joined north, east, south and west holding the same tile, not those joined only at a corner', () =>
	{
		const { bounds, valueAt } = drawnArea([
			'..#.',
			'.##.',
			'#...'
		]);
		const filled = areaFill(bounds, 0, 0, valueAt, sameValue);

		assert.strictEqual(filled.complete, true);
		assert.deepStrictEqual(filled.cells[0], [0, 0]);
		assert.deepStrictEqual(sortedCells(filled.cells), ['0,0', '0,1', '1,0']);
	});

	it('goes around other tiles to reach every joined cell', () =>
	{
		const { bounds, valueAt } = drawnArea([
			'.#..',
			'.#.#',
			'....'
		]);
		const filled = areaFill(bounds, 0, 0, valueAt, sameValue);

		assert.deepStrictEqual(sortedCells(filled.cells), ['0,0', '0,1', '0,2', '1,2', '2,0', '2,1', '2,2', '3,0', '3,2']);
	});

	it('stops at the area\'s edges without wrapping around them', () =>
	{
		const { bounds, valueAt } = drawnArea([
			'.#.',
			'.#.'
		]);
		const filled = areaFill(bounds, 0, 0, valueAt, sameValue);

		assert.deepStrictEqual(sortedCells(filled.cells), ['0,0', '0,1']);
	});

	it('counts values sameTile matches as the same tile, such as the default tile stored by its ID', () =>
	{
		const { bounds, valueAt } = drawnArea([
			'.G.',
			'###'
		]);
		const grass = 'G'.charCodeAt(0);
		const filled = areaFill(bounds, 0, 0, valueAt, (first, second) => (((first === grass) ? DEFAULT_TILE_CELL : first) === ((second === grass) ? DEFAULT_TILE_CELL : second)));

		assert.deepStrictEqual(sortedCells(filled.cells), ['0,0', '1,0', '2,0']);
	});

	it('says the fill is incomplete when it reaches a cell not known yet', () =>
	{
		const { bounds, valueAt } = drawnArea([
			'..?',
			'#..'
		]);
		const filled = areaFill(bounds, 0, 0, valueAt, sameValue);

		assert.strictEqual(filled.complete, false);
		assert.deepStrictEqual(sortedCells(filled.cells), ['0,0', '1,0', '1,1', '2,1']);
	});

	it('is complete when the unknown cells are past other tiles', () =>
	{
		const { bounds, valueAt } = drawnArea([
			'.#?',
			'.#?'
		]);

		assert.strictEqual(areaFill(bounds, 0, 0, valueAt, sameValue).complete, true);
	});

	it('fills nothing from a cell outside the area, and is incomplete from one not known yet', () =>
	{
		const { bounds, valueAt } = drawnArea([
			'.?'
		]);
		const outside = areaFill(bounds, 5, 0, valueAt, sameValue);
		const unknown = areaFill(bounds, 1, 0, valueAt, sameValue);

		assert.deepStrictEqual(outside, { cells: [], complete: true });
		assert.deepStrictEqual(unknown, { cells: [], complete: false });
	});

	it('works in negative columns and rows', () =>
	{
		const bounds = {
			minColumn: -2,
			minRow: -2,
			maxColumn: 1,
			maxRow: 1
		};
		const filled = areaFill(bounds, -2, -2, (column) => ((column < 0) ? DEFAULT_TILE_CELL : 5), sameValue);

		assert.deepStrictEqual(sortedCells(filled.cells), ['-1,-1', '-1,-2', '-1,0', '-1,1', '-2,-1', '-2,-2', '-2,0', '-2,1']);
	});

	it('fills the largest area allowed', () =>
	{
		const half = MAX_AREA_SIDE / 2;
		const bounds = {
			minColumn: -half,
			minRow: -half,
			maxColumn: half - 1,
			maxRow: half - 1
		};
		const filled = areaFill(bounds, 0, 0, () => DEFAULT_TILE_CELL, sameValue);

		assert.strictEqual(filled.cells.length, MAX_AREA_SIDE * MAX_AREA_SIDE);
	});
});
