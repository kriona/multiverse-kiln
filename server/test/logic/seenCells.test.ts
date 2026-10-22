import assert from 'assert';
import { chunkKey, decodeSeenChunk, emptySeenChunk, encodeSeenChunk, isCellSeen, markCellSeen, mergeSeenChunk, visionKey } from '@multiverse-kiln/shared';

import { SeenCells } from '../../src/logic/seenCells.js';

describe('seen cells', () =>
{
	describe('chunk bits (shared)', () =>
	{
		it('marks a cell once, by its place in its chunk', () =>
		{
			const bits = emptySeenChunk();

			assert.strictEqual(markCellSeen(bits, -1, 33), true);
			assert.strictEqual(markCellSeen(bits, -1, 33), false);
			assert.strictEqual(isCellSeen(bits, -1, 33), true);
			assert.strictEqual(isCellSeen(bits, 31, 1), true, 'the same place in another chunk');
			assert.strictEqual(isCellSeen(bits, 0, 1), false);
		});

		it('merges two copies and survives encoding', () =>
		{
			const first = emptySeenChunk();
			const second = emptySeenChunk();

			markCellSeen(first, 0, 0);
			markCellSeen(second, 31, 31);
			mergeSeenChunk(first, second);

			const decoded = decodeSeenChunk(encodeSeenChunk(first));

			assert.deepStrictEqual(decoded, first);
			assert.ok(isCellSeen(decoded, 0, 0) && isCellSeen(decoded, 31, 31));
		});
	});

	describe('SeenCells', () =>
	{
		it('marks cells into their chunks, and gives the chunks with any seen', () =>
		{
			const seen = new SeenCells();

			seen.mark('area', [visionKey(0, 0), visionKey(-1, 0)]);

			const chunks = seen.get('area', [chunkKey(0, 0), chunkKey(-1, 0), chunkKey(5, 5)]);

			assert.deepStrictEqual(chunks.map((chunk) => chunkKey(chunk.chunkColumn, chunk.chunkRow)), [chunkKey(0, 0), chunkKey(-1, 0)]);
			assert.ok(isCellSeen(chunks[1].cells, -1, 0));
			assert.deepStrictEqual(seen.get('other', [chunkKey(0, 0)]), []);
		});

		it('gives the chunks seen more of since the last save, once', () =>
		{
			const saved = emptySeenChunk();

			markCellSeen(saved, 0, 0);

			const seen = new SeenCells([{ areaId: 'area', chunkColumn: 0, chunkRow: 0, cells: saved }]);

			seen.mark('area', [visionKey(0, 0)]);
			assert.deepStrictEqual(seen.takeChanged(), [], 'nothing new was seen');

			seen.mark('area', [visionKey(1, 0), visionKey(40, 0)]);

			const changed = seen.takeChanged();

			assert.deepStrictEqual(changed.map((chunk) => chunkKey(chunk.chunkColumn, chunk.chunkRow)), [chunkKey(0, 0), chunkKey(1, 0)]);
			assert.deepStrictEqual(seen.takeChanged(), []);

			seen.putBack(changed);
			assert.strictEqual(seen.takeChanged().length, 2);
		});

		it('forgets an area', () =>
		{
			const seen = new SeenCells();

			seen.mark('area', [visionKey(0, 0)]);
			seen.forget('area');

			assert.deepStrictEqual(seen.get('area', [chunkKey(0, 0)]), []);
			assert.deepStrictEqual(seen.takeChanged(), []);
		});
	});
});
