import assert from 'assert';
import { CHUNK_SIZE, cellIndexInChunk, chunkKey, DEFAULT_TILE_CELL, VOID_CELL } from '@multiverse-kiln/shared';

import { applyCellChanges, chunksOfChanges, clipChunk, isChunkInside, isDefaultChunk, wouldCreateCycle } from '../../src/logic/mapEdits.js';

/**
 * A chunk whose cells are all the default tile
 *
 * @return The cells
 */
function defaultChunk(): number[]
{
	return(new Array<number>(CHUNK_SIZE * CHUNK_SIZE).fill(DEFAULT_TILE_CELL));
}

describe('mapEdits', () =>
{
	describe('chunksOfChanges', () =>
	{
		it('lists each chunk the changes fall in once', () =>
		{
			const chunks = chunksOfChanges([[0, 0, 5], [31, 31, 5], [32, 0, 5], [-1, -1, 5]]);

			assert.deepStrictEqual([...chunks.keys()].sort(), [chunkKey(-1, -1), chunkKey(0, 0), chunkKey(1, 0)].sort());
			assert.deepStrictEqual(chunks.get(chunkKey(-1, -1)), { chunkColumn: -1, chunkRow: -1 });
		});
	});

	describe('applyCellChanges', () =>
	{
		it('changes stored chunks and starts unstored ones from the default tile', () =>
		{
			const stored = defaultChunk();

			stored[cellIndexInChunk(1, 1)] = 7;

			const changed = applyCellChanges(new Map([[chunkKey(0, 0), stored]]), [[0, 0, 5], [-1, 0, VOID_CELL]]);
			const own = changed.get(chunkKey(0, 0));
			const west = changed.get(chunkKey(-1, 0));

			assert.ok(own && west);
			assert.strictEqual(own[cellIndexInChunk(0, 0)], 5);
			assert.strictEqual(own[cellIndexInChunk(1, 1)], 7);
			assert.strictEqual(west[cellIndexInChunk(-1, 0)], VOID_CELL);
			assert.strictEqual(west.filter((cell) => (cell !== DEFAULT_TILE_CELL)).length, 1);
		});

		it('leaves the stored chunks as they were', () =>
		{
			const stored = defaultChunk();

			applyCellChanges(new Map([[chunkKey(0, 0), stored]]), [[0, 0, 5]]);

			assert.strictEqual(stored[0], DEFAULT_TILE_CELL);
		});

		it('gives a cell listed twice its later value', () =>
		{
			const changed = applyCellChanges(new Map(), [[3, 3, 5], [3, 3, 6]]);

			assert.strictEqual(changed.get(chunkKey(0, 0))?.[cellIndexInChunk(3, 3)], 6);
		});
	});

	describe('isDefaultChunk', () =>
	{
		it('is true only when every cell is the default tile', () =>
		{
			const cells = defaultChunk();

			assert.strictEqual(isDefaultChunk(cells), true);
			cells[10] = VOID_CELL;
			assert.strictEqual(isDefaultChunk(cells), false);
		});
	});

	describe('isChunkInside', () =>
	{
		const bounds = { minColumn: -32, minRow: -32, maxColumn: 31, maxRow: 40 };

		it('is true for a chunk wholly on the map', () =>
		{
			assert.strictEqual(isChunkInside(-1, -1, bounds), true);
			assert.strictEqual(isChunkInside(0, 0, bounds), true);
		});

		it('is false for a chunk partly or wholly off the map', () =>
		{
			assert.strictEqual(isChunkInside(0, 1, bounds), false);
			assert.strictEqual(isChunkInside(1, 0, bounds), false);
			assert.strictEqual(isChunkInside(-2, 0, bounds), false);
		});
	});

	describe('clipChunk', () =>
	{
		it('resets cells outside the bounds and counts the ones that were not default', () =>
		{
			const cells = defaultChunk();

			cells[cellIndexInChunk(2, 2)] = 5;
			cells[cellIndexInChunk(10, 2)] = 5;
			cells[cellIndexInChunk(2, 10)] = VOID_CELL;

			const clipped = clipChunk(0, 0, cells, { minColumn: -5, minRow: -5, maxColumn: 5, maxRow: 5 });

			assert.strictEqual(clipped.discarded, 2);
			assert.strictEqual(clipped.cells[cellIndexInChunk(2, 2)], 5);
			assert.strictEqual(clipped.cells[cellIndexInChunk(10, 2)], DEFAULT_TILE_CELL);
			assert.strictEqual(clipped.cells[cellIndexInChunk(2, 10)], DEFAULT_TILE_CELL);
			assert.strictEqual(cells[cellIndexInChunk(10, 2)], 5);
		});

		it('clears a chunk entirely off the map', () =>
		{
			const cells = new Array<number>(CHUNK_SIZE * CHUNK_SIZE).fill(5);
			const clipped = clipChunk(3, 0, cells, { minColumn: -5, minRow: -5, maxColumn: 5, maxRow: 5 });

			assert.strictEqual(clipped.discarded, CHUNK_SIZE * CHUNK_SIZE);
			assert.strictEqual(isDefaultChunk(clipped.cells), true);
		});
	});

	describe('wouldCreateCycle', () =>
	{
		// world > continent > city
		const parents = new Map<string, string | null>([
			['world', null],
			['continent', 'world'],
			['city', 'continent'],
			['moon', null]
		]);

		it('refuses an area as its own parent', () =>
		{
			assert.strictEqual(wouldCreateCycle(parents, 'city', 'city'), true);
		});

		it('refuses one of the area\'s descendants as its parent', () =>
		{
			assert.strictEqual(wouldCreateCycle(parents, 'world', 'city'), true);
		});

		it('allows any other area', () =>
		{
			assert.strictEqual(wouldCreateCycle(parents, 'city', 'moon'), false);
			assert.strictEqual(wouldCreateCycle(parents, 'moon', 'city'), false);
			assert.strictEqual(wouldCreateCycle(parents, 'city', 'world'), false);
		});

		it('stops on a cycle already in the data', () =>
		{
			const looped = new Map<string, string | null>([['a', 'b'], ['b', 'a']]);

			assert.strictEqual(wouldCreateCycle(looped, 'c', 'a'), false);
		});
	});
});
