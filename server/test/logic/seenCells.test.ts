import assert from 'assert';
import { CHUNK_SIZE, cellIndexInChunk, chunkKey, DEFAULT_TILE_CELL, UNSEEN_CELL, visionKey } from '@multiverse-kiln/shared';

import { SEEN_CHUNK_BYTES, SeenCells } from '../../src/logic/seenCells.js';

describe('SeenCells', () =>
{
	it('marks cells once, and tells which are new', () =>
	{
		const seen = new SeenCells();

		assert.deepStrictEqual(seen.mark('area', [visionKey(0, 0), visionKey(-1, 33)]), [{ column: 0, row: 0 }, { column: -1, row: 33 }]);
		assert.deepStrictEqual(seen.mark('area', [visionKey(0, 0), visionKey(1, 0)]), [{ column: 1, row: 0 }]);
		assert.strictEqual(seen.has('area', -1, 33), true);
		assert.strictEqual(seen.has('area', 31, 1), false, 'the same place in another chunk');
		assert.strictEqual(seen.has('other', 0, 0), false);
		assert.strictEqual(seen.count('area'), 3);
	});

	it('loads what was saved, counting it', () =>
	{
		const cells = new Uint8Array(SEEN_CHUNK_BYTES);

		cells[0] = 0b101;

		const seen = new SeenCells();

		seen.load([{ areaId: 'area', chunkColumn: 0, chunkRow: 0, cells }]);

		assert.strictEqual(seen.count('area'), 2);
		assert.strictEqual(seen.has('area', 2, 0), true);
		assert.deepStrictEqual(seen.mark('area', [visionKey(2, 0)]), []);
	});

	it('hides the cells of a chunk the group hasn\'t seen', () =>
	{
		const seen = new SeenCells();
		const cells = new Array<number>(CHUNK_SIZE * CHUNK_SIZE).fill(DEFAULT_TILE_CELL);

		cells[cellIndexInChunk(1, 0)] = 7;
		seen.mark('area', [visionKey(1, 0), visionKey(2, 0)]);

		const masked = seen.mask('area', chunkKey(0, 0), cells);

		assert.ok(masked);
		assert.strictEqual(masked[cellIndexInChunk(1, 0)], 7);
		assert.strictEqual(masked[cellIndexInChunk(2, 0)], DEFAULT_TILE_CELL);
		assert.strictEqual(masked[cellIndexInChunk(3, 0)], UNSEEN_CELL);
		assert.ok((seen.mask('area', chunkKey(1, 0), null) ?? []).every((value) => (value === UNSEEN_CELL)), 'a chunk never seen');
	});

	it('sends a chunk seen in full as it is', () =>
	{
		const seen = new SeenCells();
		const all: string[] = [];

		for (let row = 0; row < CHUNK_SIZE; row++)
		{
			for (let column = 0; column < CHUNK_SIZE; column++)
			{
				all.push(visionKey(column, row));
			}
		}

		seen.mark('area', all);

		assert.strictEqual(seen.mask('area', chunkKey(0, 0), null), null);
	});

	it('gives the chunks seen more of since the last save, once', () =>
	{
		const seen = new SeenCells();

		seen.mark('area', [visionKey(1, 0), visionKey(40, 0)]);

		const changed = seen.takeChanged();

		assert.deepStrictEqual(changed.map((chunk) => chunkKey(chunk.chunkColumn, chunk.chunkRow)), [chunkKey(0, 0), chunkKey(1, 0)]);
		assert.deepStrictEqual(seen.takeChanged(), []);

		seen.mark('area', [visionKey(1, 0)]);
		assert.deepStrictEqual(seen.takeChanged(), [], 'nothing new was seen');

		seen.putBack(changed);
		assert.strictEqual(seen.takeChanged().length, 2);
	});

	it('forgets an area', () =>
	{
		const seen = new SeenCells();

		seen.mark('area', [visionKey(0, 0)]);
		seen.forget('area');

		assert.strictEqual(seen.has('area', 0, 0), false);
		assert.strictEqual(seen.count('area'), 0);
		assert.deepStrictEqual(seen.takeChanged(), []);
	});
});
