import assert from 'assert';
import { CHUNK_SIZE, chunkKey, DEFAULT_TILE_CELL, IMPASSABLE_COST, type ZoneChunk } from '@multiverse-kiln/shared';

import type { LoadedZone } from '../src/db/zoneRepo.js';
import { toZonePayload, ZoneCache } from '../src/rooms/zoneCache.js';

const ZONE_ID = 'zone';

const GRASS = 1;

const FOREST = 2;

/**
 * A zone 200 cells across, all grass
 *
 * @return The zone's settings
 */
function loadedZone(): LoadedZone
{
	return({
		zone: {
			id: ZONE_ID,
			universeId: 'universe',
			parentZoneId: undefined,
			name: 'Field',
			enabled: true,
			indoors: false,
			passageOfTime: 'inherit'
		},
		ruleset: 'pf1e',
		bounds: { minColumn: -100, minRow: -100, maxColumn: 99, maxRow: 99 },
		defaultTileId: GRASS,
		loopsEastWest: false,
		loopsNorthSouth: false,
		links: [],
		tiles: [
			{ id: GRASS, key: 'grass', name: 'Grass', indoors: false, color: 0x00ff00, visionCost: 0, movementCost: 0 },
			{ id: FOREST, key: 'forest', name: 'Forest', indoors: false, color: 0x008800, visionCost: 50, movementCost: 50 }
		]
	});
}

/**
 * A chunk whose first cell is forest and the rest the default tile
 *
 * @param chunkColumn The chunk's column
 * @param chunkRow The chunk's row
 * @return The chunk
 */
function forestChunk(chunkColumn: number, chunkRow: number): ZoneChunk
{
	const cells = new Array<number>(CHUNK_SIZE * CHUNK_SIZE).fill(DEFAULT_TILE_CELL);

	cells[0] = FOREST;

	return({ chunkColumn, chunkRow, cells });
}

/**
 * A ZoneCache over a fake database, whose stored chunks the test can change, and whose chunk reads
 * wait until the test lets them finish
 */
class FakeDatabase
{
	readonly stored = new Map<string, ZoneChunk>([[chunkKey(0, 0), forestChunk(0, 0)]]);
	readonly reads: { chunks: string[]; finish: () => void }[] = [];
	exists = true;

	readonly cache = new ZoneCache(
		() => Promise.resolve((this.exists ? loadedZone() : undefined)),
		(_zoneId, chunks) => new Promise((resolve) =>
		{
			const keys = chunks.map((chunk) => chunkKey(chunk.chunkColumn, chunk.chunkRow));

			this.reads.push({
				chunks: keys,
				finish: () =>
				{
					resolve(keys
						.map((key) => this.stored.get(key))
						.filter((chunk) => (chunk !== undefined)));
				}
			});
		})
	);

	/**
	 * Lets every chunk read waiting so far finish
	 */
	finishReads(): void
	{
		for (const read of this.reads.splice(0))
		{
			read.finish();
		}
	}
}

describe('ZoneCache', () =>
{
	it('loads a zone without its chunks, which can\'t be entered until they load', async () =>
	{
		const database = new FakeDatabase();
		const zone = await database.cache.load(ZONE_ID);

		assert.ok(zone);
		assert.strictEqual(zone.loadedChunks.size, 0);
		assert.strictEqual(zone.grid.movementCost({ column: 0, row: 0 }), IMPASSABLE_COST);

		const loading = database.cache.loadChunks(ZONE_ID, [chunkKey(0, 0), chunkKey(1, 0)]);

		database.finishReads();

		assert.deepStrictEqual((await loading).sort(), [chunkKey(0, 0), chunkKey(1, 0)]);
		assert.strictEqual(zone.grid.movementCost({ column: 0, row: 0 }), 50);
		assert.strictEqual(zone.grid.movementCost({ column: 32, row: 0 }), 0);
		assert.deepStrictEqual([...zone.chunks.keys()], [chunkKey(0, 0)]);
	});

	it('reads each chunk once, and makes a second caller wait for a chunk already on its way', async () =>
	{
		const database = new FakeDatabase();

		await database.cache.load(ZONE_ID);

		const first = database.cache.loadChunks(ZONE_ID, [chunkKey(0, 0)]);
		let secondDone = false;
		const second = database.cache.loadChunks(ZONE_ID, [chunkKey(0, 0)]).then((keys) =>
		{
			secondDone = true;
			return(keys);
		});

		await new Promise((resolve) => setImmediate(resolve));

		assert.strictEqual(database.reads.length, 1);
		assert.strictEqual(secondDone, false);

		database.finishReads();

		assert.deepStrictEqual(await first, [chunkKey(0, 0)]);
		assert.deepStrictEqual(await second, []);
		assert.ok(database.cache.get(ZONE_ID)?.loadedChunks.has(chunkKey(0, 0)));
	});

	it('drops the chunks it is not told to keep', async () =>
	{
		const database = new FakeDatabase();
		const zone = await database.cache.load(ZONE_ID);
		const loading = database.cache.loadChunks(ZONE_ID, [chunkKey(0, 0), chunkKey(1, 0)]);

		database.finishReads();
		await loading;
		database.cache.dropChunks(ZONE_ID, new Set([chunkKey(1, 0)]));

		assert.deepStrictEqual([...(zone?.loadedChunks ?? [])], [chunkKey(1, 0)]);
		assert.strictEqual(zone?.chunks.size, 0);
	});

	it('reads changed chunks again, leaving out the ones not loaded', async () =>
	{
		const database = new FakeDatabase();
		const zone = await database.cache.load(ZONE_ID);
		const loading = database.cache.loadChunks(ZONE_ID, [chunkKey(0, 0)]);

		database.finishReads();
		await loading;
		database.stored.delete(chunkKey(0, 0));

		const reloading = database.cache.reloadChunks(ZONE_ID, [chunkKey(0, 0), chunkKey(3, 3)]);

		database.finishReads();

		assert.deepStrictEqual(await reloading, [chunkKey(0, 0)]);
		assert.strictEqual(zone?.chunks.has(chunkKey(0, 0)), false);
		assert.strictEqual(zone.grid.movementCost({ column: 0, row: 0 }), 0);
	});

	it('reloads a zone, keeping its chunks only when asked to', async () =>
	{
		const database = new FakeDatabase();

		await database.cache.load(ZONE_ID);

		const loading = database.cache.loadChunks(ZONE_ID, [chunkKey(0, 0)]);

		database.finishReads();
		await loading;

		assert.strictEqual((await database.cache.reload(ZONE_ID, true))?.loadedChunks.size, 1);
		assert.strictEqual((await database.cache.reload(ZONE_ID, false))?.loadedChunks.size, 0);
	});

	it('throws away chunks that arrive after the zone was reloaded', async () =>
	{
		const database = new FakeDatabase();

		await database.cache.load(ZONE_ID);

		const loading = database.cache.loadChunks(ZONE_ID, [chunkKey(0, 0)]);
		const reloaded = await database.cache.reload(ZONE_ID, false);

		database.finishReads();

		assert.deepStrictEqual(await loading, []);
		assert.strictEqual(reloaded?.loadedChunks.size, 0);
	});

	it('forgets a zone that no longer exists when reloaded', async () =>
	{
		const database = new FakeDatabase();

		await database.cache.load(ZONE_ID);
		database.exists = false;

		assert.strictEqual(await database.cache.reload(ZONE_ID, false), undefined);
		assert.strictEqual(database.cache.get(ZONE_ID), undefined);
	});

	it('puts only the chunks asked for that are not all default in a zone\'s payload', async () =>
	{
		const database = new FakeDatabase();
		const zone = await database.cache.load(ZONE_ID);
		const loading = database.cache.loadChunks(ZONE_ID, [chunkKey(0, 0), chunkKey(1, 0)]);

		database.finishReads();
		await loading;

		assert.ok(zone);

		const payload = toZonePayload(zone, [chunkKey(0, 0), chunkKey(1, 0)]);

		assert.deepStrictEqual(payload.chunks.map((chunk) => chunkKey(chunk.chunkColumn, chunk.chunkRow)), [chunkKey(0, 0)]);
		assert.strictEqual(toZonePayload(zone, []).chunks.length, 0);
	});
});
