import assert from 'assert';
import { BLOB_FRAME_MASKS, BLOB_SHEET_COLUMNS, BLOB_SHEET_MASKS, blobFrame, DUAL_GRID_FRAME_CORNERS, dualGridFrame, reduceBlobMask } from '@multiverse-kiln/shared';

describe('tile graphics (shared)', () =>
{
	describe('Dual-Grid frames', () =>
	{
		it('gives every set of corners its own frame', () =>
		{
			const frames = new Set(Array.from({ length: 16 }, (_, corners) => dualGridFrame(corners)));

			assert.strictEqual(frames.size, 16);
			assert.ok([...frames].every((frame) => ((frame >= 0) && (frame < 16))));
		});

		it('finds each frame of the sheet from the corners it fills', () =>
		{
			DUAL_GRID_FRAME_CORNERS.forEach((corners, frame) =>
			{
				assert.strictEqual(dualGridFrame(corners), frame);
			});
		});

		it('lays the frames out as the jess::codes template does', () =>
		{
			assert.strictEqual(dualGridFrame(0), 12);
			assert.strictEqual(dualGridFrame(15), 6);
			assert.strictEqual(dualGridFrame(4), 0);
			assert.strictEqual(dualGridFrame(1), 15);
			assert.strictEqual(dualGridFrame(1 | 8), 4);
			assert.strictEqual(dualGridFrame(4 | 8), 3);
		});
	});

	describe('blob frames', () =>
	{
		it('has 47 frames, which fit the sheet with 2 places to spare', () =>
		{
			assert.strictEqual(BLOB_FRAME_MASKS.length, 47);
			assert.strictEqual(BLOB_SHEET_MASKS.length, BLOB_SHEET_COLUMNS * BLOB_SHEET_COLUMNS);
			assert.strictEqual(BLOB_SHEET_MASKS.filter((mask) => (mask === null)).length, 2);
			assert.strictEqual(BLOB_FRAME_MASKS[0], 0);
			assert.strictEqual(BLOB_FRAME_MASKS[46], 255);
		});

		it('has a frame in the sheet for every mask', () =>
		{
			const sheetMasks = BLOB_SHEET_MASKS
				.filter((mask): mask is number => (mask !== null))
				.sort((a, b) => (a - b));

			assert.deepStrictEqual(sheetMasks, [...BLOB_FRAME_MASKS]);
		});

		it('ignores a diagonal unless both neighbors beside it hold the tile', () =>
		{
			// North-east alone, and north-east with only north
			assert.strictEqual(reduceBlobMask(2), 0);
			assert.strictEqual(reduceBlobMask(1 | 2), 1);
			assert.strictEqual(reduceBlobMask(1 | 2 | 4), 1 | 2 | 4);
			assert.strictEqual(blobFrame(255 & ~2), blobFrame(1 | 4 | 8 | 16 | 32 | 64 | 128));
		});

		it('finds a cell alone and a cell surrounded in the sheet', () =>
		{
			assert.strictEqual(blobFrame(0), 24);
			assert.strictEqual(blobFrame(255), 8);
		});

		it('finds each frame of the sheet from the mask it is drawn for', () =>
		{
			BLOB_SHEET_MASKS.forEach((mask, frame) =>
			{
				if (mask !== null)
				{
					assert.strictEqual(blobFrame(mask), frame);
				}
			});
		});

		it('gives every reduced mask its own frame', () =>
		{
			const frames = new Set(BLOB_FRAME_MASKS.map((mask) => blobFrame(mask)));

			assert.strictEqual(frames.size, 47);
		});
	});
});
