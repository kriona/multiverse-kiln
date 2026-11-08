import assert from 'assert';
import { chunkKey } from '@multiverse-kiln/shared';

import { chunksNear, type ChunkAreaShape } from '../../src/logic/chunkArea.js';

/**
 * An area 320 cells across (chunks -5 to 4 along each axis), centered on 0,0
 *
 * @param loops Whether it loops along both axes
 * @return The area's shape
 */
function wideArea(loops: boolean): ChunkAreaShape
{
	return({
		bounds: { minColumn: -160, minRow: -160, maxColumn: 159, maxRow: 159 },
		loopsEastWest: loops,
		loopsNorthSouth: loops
	});
}

/**
 * Chunk keys, sorted, for comparing
 *
 * @param chunks Each chunk's column and row
 * @return The keys
 */
function keys(chunks: [number, number][]): string[]
{
	return(chunks.map(([chunkColumn, chunkRow]) => chunkKey(chunkColumn, chunkRow)).sort());
}

describe('chunkArea', () =>
{
	describe('chunksNear', () =>
	{
		it('covers the chunks within the radius of a cell', () =>
		{
			const near = chunksNear([{ column: 0, row: 0 }], 10, wideArea(false));

			assert.deepStrictEqual([...near].sort(), keys([[-1, -1], [0, -1], [-1, 0], [0, 0]]));
		});

		it('stops at the edges of an area that does not loop', () =>
		{
			const near = chunksNear([{ column: 159, row: 0 }], 40, wideArea(false));

			assert.deepStrictEqual([...near].sort(), keys([[3, -2], [4, -2], [3, -1], [4, -1], [3, 0], [4, 0], [3, 1], [4, 1]]));
		});

		it('reaches around the edge onto the far side of an area that loops', () =>
		{
			const near = chunksNear([{ column: 159, row: 0 }], 10, wideArea(true));

			assert.deepStrictEqual([...near].sort(), keys([[4, -1], [-5, -1], [4, 0], [-5, 0]]));
		});

		it('covers the whole axis when the radius reaches all the way around', () =>
		{
			const shape: ChunkAreaShape = {
				bounds: { minColumn: -40, minRow: 0, maxColumn: 39, maxRow: 0 },
				loopsEastWest: true,
				loopsNorthSouth: false
			};
			const near = chunksNear([{ column: 0, row: 0 }], 50, shape);

			assert.deepStrictEqual([...near].sort(), keys([[-2, 0], [-1, 0], [0, 0], [1, 0]]));
		});

		it('joins the areas around several cells', () =>
		{
			const near = chunksNear([{ column: 0, row: 0 }, { column: 100, row: 100 }], 0, wideArea(false));

			assert.deepStrictEqual([...near].sort(), keys([[0, 0], [3, 3]]));
		});

		it('covers nothing for no cells', () =>
		{
			assert.strictEqual(chunksNear([], 10, wideArea(false)).size, 0);
		});
	});
});
