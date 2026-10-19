import assert from 'assert';
import { CHUNK_SIZE, cellIndexInChunk, chunkCoordinate, chunkKey, DEFAULT_TILE_CELL, nearestCopy, parseChunkKey, positiveModulo, tileIdAt, VOID_CELL, type AreaTiles } from '@multiverse-kiln/shared';

describe('map layout (shared)', () =>
{
	describe('chunkCoordinate and cellIndexInChunk', () =>
	{
		it('puts cells left of and above the center in negative chunks', () =>
		{
			assert.strictEqual(chunkCoordinate(0), 0);
			assert.strictEqual(chunkCoordinate(CHUNK_SIZE - 1), 0);
			assert.strictEqual(chunkCoordinate(CHUNK_SIZE), 1);
			assert.strictEqual(chunkCoordinate(-1), -1);
			assert.strictEqual(chunkCoordinate(-CHUNK_SIZE), -1);
			assert.strictEqual(chunkCoordinate(-CHUNK_SIZE - 1), -2);
		});

		it('counts cells row by row from each chunk\'s top left, including in negative chunks', () =>
		{
			assert.strictEqual(cellIndexInChunk(0, 0), 0);
			assert.strictEqual(cellIndexInChunk(1, 0), 1);
			assert.strictEqual(cellIndexInChunk(0, 1), CHUNK_SIZE);
			assert.strictEqual(cellIndexInChunk(-1, -1), (CHUNK_SIZE * CHUNK_SIZE) - 1);
			assert.strictEqual(cellIndexInChunk(-CHUNK_SIZE, -CHUNK_SIZE), 0);
		});
	});

	describe('chunkKey and parseChunkKey', () =>
	{
		it('turn a chunk into a key and back', () =>
		{
			assert.deepStrictEqual(parseChunkKey(chunkKey(-3, 7)), { chunkColumn: -3, chunkRow: 7 });
		});
	});

	describe('tileIdAt', () =>
	{
		const cells = new Array<number>(CHUNK_SIZE * CHUNK_SIZE).fill(DEFAULT_TILE_CELL);

		cells[cellIndexInChunk(1, 0)] = 7;
		cells[cellIndexInChunk(2, 0)] = VOID_CELL;

		const tiles: AreaTiles = {
			bounds: { minColumn: -2, minRow: -1, maxColumn: 2, maxRow: 1 },
			defaultTileId: 3,
			chunks: new Map([[chunkKey(0, 0), cells]])
		};

		it('gives the stored tile, or the default tile for a default cell or a chunk that isn\'t stored', () =>
		{
			assert.strictEqual(tileIdAt(tiles, 1, 0), 7);
			assert.strictEqual(tileIdAt(tiles, 0, 0), 3);
			assert.strictEqual(tileIdAt(tiles, -1, -1), 3);
		});

		it('gives undefined for a void cell or one off the map', () =>
		{
			assert.strictEqual(tileIdAt(tiles, 2, 0), undefined);
			assert.strictEqual(tileIdAt(tiles, 3, 0), undefined);
			assert.strictEqual(tileIdAt(tiles, 0, -2), undefined);
		});
	});

	describe('nearestCopy', () =>
	{
		it('leaves a value that is already nearest alone', () =>
		{
			assert.strictEqual(nearestCopy(50, 60, 100), 50);
		});

		it('moves a value a whole period toward the reference', () =>
		{
			assert.strictEqual(nearestCopy(95, 5, 100), -5);
			assert.strictEqual(nearestCopy(-5, 95, 100), 95);
			assert.strictEqual(nearestCopy(10, 1010, 100), 1010);
		});
	});

	describe('positiveModulo', () =>
	{
		it('is never negative', () =>
		{
			assert.strictEqual(positiveModulo(-1, 5), 4);
			assert.strictEqual(positiveModulo(-5, 5), 0);
			assert.strictEqual(positiveModulo(7, 5), 2);
		});
	});
});
