import assert from 'assert';
import { CHUNK_SIZE, chunkKey, DEFAULT_TILE_CELL, IMPASSABLE_WALK_SECONDS, UNSEEN_CELL, visionKey, type AreaChunk } from '@multiverse-kiln/shared';

import type { LoadedArea } from '../src/db/areaRepo.js';
import { SeenCells } from '../src/logic/seenCells.js';
import { toAreaPayload, AREA_IDLE_MS, AreaCache } from '../src/rooms/areaCache.js';

const AREA_ID = 'area';

const GRASS = 1;

const FOREST = 2;

/**
 * An area 200 cells across, all grass
 *
 * @return The area's settings
 */
function loadedArea(): LoadedArea
{
	return({
		area: {
			id: AREA_ID,
			universeId: 'universe',
			parentAreaId: undefined,
			name: 'Field',
			enabled: true,
			indoors: false,
			passageOfTime: 'flows_normally'
		},
		ruleset: 'pf1e',
		time: { passage: 'flows_normally' },
		displayTime: 'precise',
		lightLevel: null,
		fogOfWar: true,
		bounds: { minColumn: -100, minRow: -100, maxColumn: 99, maxRow: 99 },
		defaultTileId: GRASS,
		loopsEastWest: false,
		loopsNorthSouth: false,
		links: [],
		disabledTargetIds: new Set(),
		tiles: [
			{ id: GRASS, key: 'grass', name: 'Grass', indoors: false, outdoors: true, color: 0x00ff00, graphic: 'grass', uploadedGraphic: null, visionCost: 0, walkSeconds: 10 },
			{ id: FOREST, key: 'forest', name: 'Forest', indoors: false, outdoors: true, color: 0x008800, graphic: null, uploadedGraphic: null, visionCost: 50, walkSeconds: 20 }
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
function forestChunk(chunkColumn: number, chunkRow: number): AreaChunk
{
	const cells = new Array<number>(CHUNK_SIZE * CHUNK_SIZE).fill(DEFAULT_TILE_CELL);

	cells[0] = FOREST;

	return({ chunkColumn, chunkRow, cells });
}

/**
 * An AreaCache over a fake database, whose stored chunks the test can change, and whose chunk reads
 * see the chunks as they were when the read began (as a query begun before a save commits does) and
 * wait until the test lets them finish
 */
class FakeDatabase
{
	readonly stored = new Map<string, AreaChunk>([[chunkKey(0, 0), forestChunk(0, 0)]]);
	readonly reads: { chunks: string[]; finish: () => void }[] = [];
	exists = true;

	/**
	 * The cache's clock, in milliseconds
	 */
	time = 0;

	readonly cache = new AreaCache(
		() => Promise.resolve((this.exists ? loadedArea() : undefined)),
		(_areaId, chunks) => new Promise((resolve) =>
		{
			const keys = chunks.map((chunk) => chunkKey(chunk.chunkColumn, chunk.chunkRow));
			const found = keys
				.map((key) => this.stored.get(key))
				.filter((chunk) => (chunk !== undefined));

			this.reads.push({
				chunks: keys,
				finish: () =>
				{
					resolve(found);
				}
			});
		}),
		() => this.time
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

/**
 * An AreaCache over a fake database whose area reads take the area as it is when their query runs,
 * as a query begun before an editor's save commits does, and finish when the test lets them
 */
class SlowAreaDatabase
{
	/**
	 * Whether the stored area is enabled
	 */
	enabled = true;

	readonly reads: (() => void)[] = [];

	readonly cache = new AreaCache(
		() =>
		{
			const area = loadedArea();
			const read: LoadedArea = {
				...area,
				area: {
					...area.area,
					enabled: this.enabled
				}
			};

			return(new Promise((resolve) =>
			{
				this.reads.push(() => resolve(read));
			}));
		},
		() => Promise.resolve([])
	);

	/**
	 * Lets the oldest area read waiting finish, and waits for what follows from it
	 */
	async finishRead(): Promise<void>
	{
		this.reads.shift()?.();
		await new Promise((resolve) => setImmediate(resolve));
	}
}

describe('AreaCache', () =>
{
	it('loads an area without its chunks, which can\'t be entered until they load', async () =>
	{
		const database = new FakeDatabase();
		const area = await database.cache.load(AREA_ID);

		assert.ok(area);
		assert.strictEqual(area.loadedChunks.size, 0);
		assert.strictEqual(area.grid.walkSeconds({ column: 0, row: 0 }), IMPASSABLE_WALK_SECONDS);

		const loading = database.cache.loadChunks(AREA_ID, [chunkKey(0, 0), chunkKey(1, 0)]);

		database.finishReads();

		assert.deepStrictEqual((await loading).sort(), [chunkKey(0, 0), chunkKey(1, 0)]);
		assert.strictEqual(area.grid.walkSeconds({ column: 0, row: 0 }), 20);
		assert.strictEqual(area.grid.walkSeconds({ column: 32, row: 0 }), 10);
		assert.deepStrictEqual([...area.chunks.keys()], [chunkKey(0, 0)]);
	});

	it('reads each chunk once, and makes a second caller wait for a chunk already on its way', async () =>
	{
		const database = new FakeDatabase();

		await database.cache.load(AREA_ID);

		const first = database.cache.loadChunks(AREA_ID, [chunkKey(0, 0)]);
		let secondDone = false;
		const second = database.cache.loadChunks(AREA_ID, [chunkKey(0, 0)]).then((keys) =>
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
		assert.ok(database.cache.get(AREA_ID)?.loadedChunks.has(chunkKey(0, 0)));
	});

	it('drops the chunks it is not told to keep', async () =>
	{
		const database = new FakeDatabase();
		const area = await database.cache.load(AREA_ID);
		const loading = database.cache.loadChunks(AREA_ID, [chunkKey(0, 0), chunkKey(1, 0)]);

		database.finishReads();
		await loading;
		database.cache.dropChunks(AREA_ID, new Set([chunkKey(1, 0)]));

		assert.deepStrictEqual([...(area?.loadedChunks ?? [])], [chunkKey(1, 0)]);
		assert.strictEqual(area?.chunks.size, 0);
	});

	it('reads changed chunks again, leaving out the ones not loaded', async () =>
	{
		const database = new FakeDatabase();
		const area = await database.cache.load(AREA_ID);
		const loading = database.cache.loadChunks(AREA_ID, [chunkKey(0, 0)]);

		database.finishReads();
		await loading;
		database.stored.delete(chunkKey(0, 0));

		const reloading = database.cache.reloadChunks(AREA_ID, [chunkKey(0, 0), chunkKey(3, 3)]);

		database.finishReads();

		assert.deepStrictEqual(await reloading, [chunkKey(0, 0)]);
		assert.strictEqual(area?.chunks.has(chunkKey(0, 0)), false);
		assert.strictEqual(area.grid.walkSeconds({ column: 0, row: 0 }), 10);
	});

	it('reads changed chunks on their way again, keeping the cells read after the change', async () =>
	{
		const database = new FakeDatabase();
		const area = await database.cache.load(AREA_ID);

		// A read begun before the change was saved, which lands after the read made for the change
		const loading = database.cache.loadChunks(AREA_ID, [chunkKey(0, 0)]);

		database.stored.delete(chunkKey(0, 0));

		const reloading = database.cache.reloadChunks(AREA_ID, [chunkKey(0, 0)]);
		const [before, after] = database.reads.splice(0);

		assert.deepStrictEqual(after.chunks, [chunkKey(0, 0)]);

		after.finish();
		await new Promise((resolve) => setImmediate(resolve));
		before.finish();

		assert.deepStrictEqual(await loading, [chunkKey(0, 0)]);
		assert.deepStrictEqual(await reloading, [chunkKey(0, 0)]);
		assert.ok(area);
		assert.ok(area.loadedChunks.has(chunkKey(0, 0)));
		assert.strictEqual(area.chunks.has(chunkKey(0, 0)), false);
		assert.strictEqual(area.grid.walkSeconds({ column: 0, row: 0 }), 10);
	});

	it('reloads an area, keeping its chunks only when asked to', async () =>
	{
		const database = new FakeDatabase();

		await database.cache.load(AREA_ID);

		const loading = database.cache.loadChunks(AREA_ID, [chunkKey(0, 0)]);

		database.finishReads();
		await loading;

		assert.strictEqual((await database.cache.reload(AREA_ID, true))?.loadedChunks.size, 1);
		assert.strictEqual((await database.cache.reload(AREA_ID, false))?.loadedChunks.size, 0);
	});

	it('throws away chunks that arrive after the area was reloaded', async () =>
	{
		const database = new FakeDatabase();

		await database.cache.load(AREA_ID);

		const loading = database.cache.loadChunks(AREA_ID, [chunkKey(0, 0)]);
		const reloaded = await database.cache.reload(AREA_ID, false);

		database.finishReads();

		assert.deepStrictEqual(await loading, []);
		assert.strictEqual(reloaded?.loadedChunks.size, 0);
	});

	for (const keepChunks of [false, true])
	{
		it(`reads chunks for a reloaded area that were on their way for its previous copy (keepChunks ${keepChunks})`, async () =>
		{
			const database = new FakeDatabase();
			const key = chunkKey(0, 0);

			await database.cache.load(AREA_ID);

			const first = database.cache.loadChunks(AREA_ID, [key]);
			const reloaded = await database.cache.reload(AREA_ID, keepChunks);
			const second = database.cache.loadChunks(AREA_ID, [key]);

			assert.strictEqual(database.reads.length, 2);

			database.finishReads();

			assert.deepStrictEqual(await first, []);
			assert.deepStrictEqual(await second, [key]);
			assert.strictEqual(database.cache.get(AREA_ID), reloaded);
			assert.ok(reloaded?.loadedChunks.has(key));
		});
	}

	it('forgets an area that no longer exists when reloaded', async () =>
	{
		const database = new FakeDatabase();

		await database.cache.load(AREA_ID);
		database.exists = false;

		assert.strictEqual(await database.cache.reload(AREA_ID, false), undefined);
		assert.strictEqual(database.cache.get(AREA_ID), undefined);
	});

	for (const [changed, areaId] of [['the area', AREA_ID], ['every area', undefined]] as const)
	{
		it(`reads an area again when a change to ${changed} is heard while it loads`, async () =>
		{
			const database = new SlowAreaDatabase();
			const loading = database.cache.load(AREA_ID);

			database.enabled = false;
			database.cache.noteChange(areaId);
			await database.finishRead();

			assert.strictEqual(database.cache.get(AREA_ID), undefined);
			assert.strictEqual(database.reads.length, 1);

			await database.finishRead();

			assert.strictEqual((await loading)?.loaded.area.enabled, false);
			assert.strictEqual(database.cache.get(AREA_ID)?.loaded.area.enabled, false);
		});
	}

	it('keeps the area from after the later change when two reloads overlap', async () =>
	{
		const database = new SlowAreaDatabase();
		const loading = database.cache.load(AREA_ID);

		await database.finishRead();
		await loading;

		const first = database.cache.reload(AREA_ID, false);

		database.enabled = false;

		const second = database.cache.reload(AREA_ID, false);

		// The first reload's read, from before the second change, finishes first
		while (database.reads.length > 0)
		{
			await database.finishRead();
		}

		await Promise.all([first, second]);

		assert.strictEqual(database.cache.get(AREA_ID)?.loaded.area.enabled, false);
	});

	it('forgets an area once it has gone AREA_IDLE_MS without being asked for, unless it is in use', async () =>
	{
		const database = new FakeDatabase();

		await database.cache.load(AREA_ID);
		database.time = AREA_IDLE_MS - 1;
		database.cache.forgetIdle(() => false);

		assert.ok(database.cache.get(AREA_ID));

		// Asking for it again starts the wait over
		await database.cache.load(AREA_ID);
		database.time += AREA_IDLE_MS;
		database.cache.forgetIdle(() => true);

		assert.ok(database.cache.get(AREA_ID));

		database.cache.forgetIdle(() => false);

		assert.strictEqual(database.cache.get(AREA_ID), undefined);
	});

	it('puts only the chunks asked for that are not all default in an area\'s payload', async () =>
	{
		const database = new FakeDatabase();
		const area = await database.cache.load(AREA_ID);
		const loading = database.cache.loadChunks(AREA_ID, [chunkKey(0, 0), chunkKey(1, 0)]);

		database.finishReads();
		await loading;

		assert.ok(area);

		const payload = toAreaPayload(area, [chunkKey(0, 0), chunkKey(1, 0)]);

		assert.deepStrictEqual(payload.chunks.map((chunk) => chunkKey(chunk.chunkColumn, chunk.chunkRow)), [chunkKey(0, 0)]);
		assert.strictEqual(toAreaPayload(area, []).chunks.length, 0);
	});

	it('puts only the cells and links a group has seen in an area\'s payload', async () =>
	{
		const database = new FakeDatabase();
		const loadedArea = await database.cache.load(AREA_ID);
		const loading = database.cache.loadChunks(AREA_ID, [chunkKey(0, 0), chunkKey(1, 0)]);

		database.finishReads();
		await loading;

		assert.ok(loadedArea);

		const link = { targetAreaId: 'elsewhere', targetColumn: 0, targetRow: 0, mode: 'automatic' as const, requiresWholeGroup: false };
		const area = {
			...loadedArea,
			loaded: {
				...loadedArea.loaded,
				links: [{ ...link, column: 0, row: 0 }, { ...link, column: 5, row: 0 }]
			}
		};
		const seen = new SeenCells();

		seen.mark(AREA_ID, [visionKey(0, 0), visionKey(1, 0)]);

		const payload = toAreaPayload(area, [chunkKey(0, 0), chunkKey(1, 0)], seen);
		const [first, second] = payload.chunks;

		assert.deepStrictEqual(payload.chunks.map((chunk) => chunkKey(chunk.chunkColumn, chunk.chunkRow)), [chunkKey(0, 0), chunkKey(1, 0)], 'an unseen chunk of the default tile is still sent, as unseen');
		assert.deepStrictEqual(first.cells.slice(0, 3), [FOREST, DEFAULT_TILE_CELL, UNSEEN_CELL]);
		assert.ok(second.cells.every((value) => (value === UNSEEN_CELL)));
		assert.deepStrictEqual(payload.links, [{ column: 0, row: 0, mode: 'automatic' }]);
	});

	it('leaves links to disabled areas out of an area\'s payload', async () =>
	{
		const database = new FakeDatabase();
		const loadedArea = await database.cache.load(AREA_ID);

		database.finishReads();
		assert.ok(loadedArea);

		const link = { targetColumn: 0, targetRow: 0, mode: 'manual' as const, requiresWholeGroup: false };
		const area = {
			...loadedArea,
			loaded: {
				...loadedArea.loaded,
				links: [{ ...link, targetAreaId: 'open', column: 0, row: 0 }, { ...link, targetAreaId: 'closed', column: 1, row: 0 }],
				disabledTargetIds: new Set(['closed'])
			}
		};

		assert.deepStrictEqual(toAreaPayload(area, []).links, [{ column: 0, row: 0, mode: 'manual' }]);
	});
});
