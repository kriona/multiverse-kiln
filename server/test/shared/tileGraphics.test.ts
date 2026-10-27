import assert from 'assert';
import { BLOB_FRAME_MASKS, BLOB_SHEET_COLUMNS, blobFrame, reduceBlobMask } from '@multiverse-kiln/shared';

describe('tile graphics (shared)', () =>
{
	describe('blob frames', () =>
	{
		it('has 47 frames, which fit the sheet with one place to spare', () =>
		{
			assert.strictEqual(BLOB_FRAME_MASKS.length, 47);
			assert.strictEqual(BLOB_SHEET_COLUMNS * 6, 48);
			assert.strictEqual(BLOB_FRAME_MASKS[0], 0);
			assert.strictEqual(BLOB_FRAME_MASKS[46], 255);
		});

		it('ignores a diagonal unless both neighbors beside it hold the tile', () =>
		{
			// North-east alone, and north-east with only north
			assert.strictEqual(reduceBlobMask(2), 0);
			assert.strictEqual(reduceBlobMask(1 | 2), 1);
			assert.strictEqual(reduceBlobMask(1 | 2 | 4), 1 | 2 | 4);
			assert.strictEqual(blobFrame(255 & ~2), blobFrame(1 | 4 | 8 | 16 | 32 | 64 | 128));
		});

		it('gives a cell alone the first frame and a cell surrounded the last', () =>
		{
			assert.strictEqual(blobFrame(0), 0);
			assert.strictEqual(blobFrame(255), 46);
		});

		it('gives every reduced mask its own frame', () =>
		{
			const frames = new Set(BLOB_FRAME_MASKS.map((mask) => blobFrame(mask)));

			assert.strictEqual(frames.size, 47);
		});
	});
});
