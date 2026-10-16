import assert from 'assert';
import { CHUNK_SIZE, chunkKey, DEFAULT_TILE_CELL, tileIdAt, VOID_CELL } from '@multiverse-kiln/shared';

import { findDefaultTileIds } from '../../src/db/tileRepo.js';
import { createZoneLink, loadZone, saveGroundChunk } from '../../src/db/zoneRepo.js';
import { addUniverse, addZone } from './fixtures.js';

/**
 * A chunk of default cells with its first cell set
 *
 * @param value The first cell's value
 * @return The chunk's cell values
 */
function chunkStartingWith(value: number): number[]
{
	const cells = new Array<number>(CHUNK_SIZE * CHUNK_SIZE).fill(DEFAULT_TILE_CELL);

	cells[0] = value;

	return(cells);
}

describe('zoneRepo', () =>
{
	describe('loadZone', () =>
	{
		it('loads a zone with no stored chunks as all its default tile', async () =>
		{
			const universeId = await addUniverse();
			const zoneId = await addZone(universeId, 'Meadow');
			const grass = (await findDefaultTileIds('pf1e')).get('grass');
			const loaded = await loadZone(zoneId);

			assert.ok(loaded);
			assert.deepStrictEqual(loaded.zone, { id: zoneId, universeId, parentZoneId: undefined, name: 'Meadow', enabled: true, indoors: false, passageOfTime: 'inherit' });
			assert.deepStrictEqual(loaded.map.tiles.bounds, { minColumn: -2, minRow: -1, maxColumn: 2, maxRow: 1 });
			assert.strictEqual(loaded.map.tiles.chunks.size, 0);
			assert.strictEqual(tileIdAt(loaded.map.tiles, 2, 1), grass);
			assert.deepStrictEqual(loaded.map.links, []);
		});

		it('loads the stored chunks, with the movement cost of every tile the map can use', async () =>
		{
			const universeId = await addUniverse();
			const zoneId = await addZone(universeId);
			const tileIds = await findDefaultTileIds('pf1e');
			const forest = tileIds.get('forest') as number;

			await saveGroundChunk(zoneId, 0, 0, chunkStartingWith(forest));
			await saveGroundChunk(zoneId, -1, -1, chunkStartingWith(VOID_CELL));

			const loaded = await loadZone(zoneId);

			assert.ok(loaded);
			assert.deepStrictEqual([...loaded.map.tiles.chunks.keys()].sort(), [chunkKey(-1, -1), chunkKey(0, 0)]);
			assert.strictEqual(tileIdAt(loaded.map.tiles, 0, 0), forest);
			assert.strictEqual(loaded.map.tileMovementCosts.get(forest), 50);
			assert.strictEqual(loaded.map.tileMovementCosts.get(tileIds.get('mountains') as number), 100);
			assert.strictEqual(loaded.tiles.length, 6);
		});

		it('loads the zone\'s links', async () =>
		{
			const universeId = await addUniverse();
			const zoneId = await addZone(universeId, 'Outside');
			const insideId = await addZone(universeId, 'Inside');

			await createZoneLink({ zoneId, column: 1, row: 0, targetZoneId: insideId, targetColumn: -1, targetRow: 1, mode: 'automatic', requiresWholeGroup: true });

			const loaded = await loadZone(zoneId);

			assert.deepStrictEqual(loaded?.map.links, [{ column: 1, row: 0, targetZoneId: insideId, targetColumn: -1, targetRow: 1, mode: 'automatic', requiresWholeGroup: true }]);
			assert.deepStrictEqual((await loadZone(insideId))?.map.links, []);
		});

		it('finds nothing for an unknown ID', async () =>
		{
			assert.strictEqual(await loadZone('00000000-0000-4000-8000-000000000000'), undefined);
		});
	});

	describe('saveGroundChunk', () =>
	{
		it('replaces a chunk that is already stored', async () =>
		{
			const universeId = await addUniverse();
			const zoneId = await addZone(universeId);
			const tileIds = await findDefaultTileIds('pf1e');

			await saveGroundChunk(zoneId, 0, 0, chunkStartingWith(tileIds.get('forest') as number));
			await saveGroundChunk(zoneId, 0, 0, chunkStartingWith(tileIds.get('water') as number));

			const loaded = await loadZone(zoneId);

			assert.strictEqual(loaded?.map.tiles.chunks.size, 1);
			assert.strictEqual(tileIdAt(loaded.map.tiles, 0, 0), tileIds.get('water'));
		});

		it('refuses a chunk with the wrong number of cells', async () =>
		{
			const zoneId = await addZone(await addUniverse());

			await assert.rejects(saveGroundChunk(zoneId, 0, 0, [DEFAULT_TILE_CELL]));
		});
	});
});
