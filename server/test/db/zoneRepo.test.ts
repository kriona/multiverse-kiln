import assert from 'assert';
import { randomUUID } from 'crypto';
import { CHUNK_SIZE, cellIndexInChunk, chunkKey, DEFAULT_TILE_CELL, tileIdAt, VOID_CELL } from '@multiverse-kiln/shared';

import { findDefaultTileIds } from '../../src/db/tileRepo.js';
import { inTransaction } from '../../src/db/transactions.js';
import { countZones, createZoneLink, deleteZone, deleteZoneLink, editCells, findEditorZone, isTileInUse, listZoneLinks, listZones, loadChunks, loadZone, resizeZone, saveGroundChunk, saveZoneLink, updateZoneSettings } from '../../src/db/zoneRepo.js';
import { addUniverse, addZone, defaultTileId } from './fixtures.js';

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

	describe('findEditorZone and listZones', () =>
	{
		it('finds a zone\'s settings and lists the universe\'s zones by name', async () =>
		{
			const universeId = await addUniverse();
			const zoneId = await addZone(universeId, 'Village');
			const grass = await defaultTileId('grass');

			await addZone(universeId, 'Abbey');
			await addZone(await addUniverse('Other'), 'Elsewhere');

			assert.deepStrictEqual(await findEditorZone(zoneId), {
				universeId,
				zone: {
					id: zoneId,
					name: 'Village',
					parentZoneId: null,
					enabled: true,
					indoors: false,
					defaultTileId: grass,
					passageOfTime: 'inherit',
					faerieMorning: null,
					loopsEastWest: false,
					loopsNorthSouth: false,
					bounds: { minColumn: -2, minRow: -1, maxColumn: 2, maxRow: 1 }
				}
			});
			assert.deepStrictEqual((await listZones(universeId)).map((zone) => zone.name), ['Abbey', 'Village']);
			assert.strictEqual(await countZones(universeId), 2);
		});
	});

	describe('editCells', () =>
	{
		it('paints cells, and stops storing a chunk painted back to the default tile', async () =>
		{
			const zoneId = await addZone(await addUniverse(), 'Field', { bounds: { minColumn: -40, minRow: -40, maxColumn: 40, maxRow: 40 } });
			const forest = await defaultTileId('forest');

			assert.strictEqual(await inTransaction((transaction) => editCells(zoneId, [[0, 0, forest], [-1, 5, VOID_CELL]], transaction)), 'edited');

			let loaded = await loadZone(zoneId);

			assert.strictEqual(loaded?.map.tiles.chunks.size, 2);
			assert.strictEqual(tileIdAt(loaded.map.tiles, 0, 0), forest);
			assert.strictEqual(tileIdAt(loaded.map.tiles, -1, 5), undefined);

			await inTransaction((transaction) => editCells(zoneId, [[0, 0, DEFAULT_TILE_CELL]], transaction));

			loaded = await loadZone(zoneId);

			assert.deepStrictEqual([...(loaded?.map.tiles.chunks.keys() ?? [])], [chunkKey(-1, 0)]);
		});

		it('changes nothing when a cell is outside the bounds', async () =>
		{
			const zoneId = await addZone(await addUniverse());
			const forest = await defaultTileId('forest');

			assert.strictEqual(await inTransaction((transaction) => editCells(zoneId, [[0, 0, forest], [3, 0, forest]], transaction)), 'out_of_bounds');
			assert.strictEqual((await loadZone(zoneId))?.map.tiles.chunks.size, 0);
		});

		it('reports a zone that does not exist', async () =>
		{
			assert.strictEqual(await inTransaction((transaction) => editCells(randomUUID(), [[0, 0, 1]], transaction)), 'not_found');
		});
	});

	describe('loadChunks', () =>
	{
		it('loads the stored chunks in a range', async () =>
		{
			const zoneId = await addZone(await addUniverse(), 'Field', { bounds: { minColumn: -100, minRow: -100, maxColumn: 100, maxRow: 100 } });
			const forest = await defaultTileId('forest');

			await inTransaction((transaction) => editCells(zoneId, [[0, 0, forest], [40, 0, forest], [-80, -80, forest]], transaction));

			const chunks = await loadChunks(zoneId, { minChunkColumn: 0, minChunkRow: 0, maxChunkColumn: 1, maxChunkRow: 1 });

			assert.deepStrictEqual(chunks.map((chunk) => [chunk.chunkColumn, chunk.chunkRow]), [[0, 0], [1, 0]]);
			assert.strictEqual(chunks[0].cells[cellIndexInChunk(0, 0)], forest);
		});
	});

	describe('resizeZone', () =>
	{
		it('grows a map without discarding anything', async () =>
		{
			const zoneId = await addZone(await addUniverse());
			const bounds = { minColumn: -10, minRow: -10, maxColumn: 10, maxRow: 10 };

			assert.deepStrictEqual(await inTransaction((transaction) => resizeZone(zoneId, bounds, false, transaction)), { resized: true, discardedCells: 0, discardedLinks: 0 });
			assert.deepStrictEqual((await findEditorZone(zoneId))?.zone.bounds, bounds);
		});

		it('refuses to discard painted cells and links unless allowed, then discards them', async () =>
		{
			const universeId = await addUniverse();
			const wide = { minColumn: -50, minRow: -5, maxColumn: 50, maxRow: 5 };
			const zoneId = await addZone(universeId, 'Road', { bounds: wide });
			const otherId = await addZone(universeId, 'Inn');
			const forest = await defaultTileId('forest');
			const narrow = { minColumn: -5, minRow: -5, maxColumn: 5, maxRow: 5 };

			await inTransaction((transaction) => editCells(zoneId, [[0, 0, forest], [40, 0, forest], [-40, 0, VOID_CELL]], transaction));
			await createZoneLink({ zoneId, column: 40, row: 1, targetZoneId: otherId, targetColumn: 0, targetRow: 0, mode: 'automatic', requiresWholeGroup: false });
			await createZoneLink({ zoneId: otherId, column: 1, row: 0, targetZoneId: zoneId, targetColumn: -40, targetRow: 0, mode: 'manual', requiresWholeGroup: false });
			await createZoneLink({ zoneId: otherId, column: -1, row: 0, targetZoneId: zoneId, targetColumn: 0, targetRow: 0, mode: 'manual', requiresWholeGroup: false });

			const refused = await inTransaction((transaction) => resizeZone(zoneId, narrow, false, transaction));

			assert.deepStrictEqual(refused, { resized: false, discardedCells: 2, discardedLinks: 2 });
			assert.deepStrictEqual((await findEditorZone(zoneId))?.zone.bounds, wide);

			assert.deepStrictEqual(await inTransaction((transaction) => resizeZone(zoneId, narrow, true, transaction)), { resized: true, discardedCells: 2, discardedLinks: 2 });
			assert.deepStrictEqual(await listZoneLinks(zoneId), []);
			assert.deepStrictEqual((await listZoneLinks(otherId)).map((link) => link.column), [-1]);

			// Growing back shows the default tile where the discarded cells were
			await inTransaction((transaction) => resizeZone(zoneId, wide, false, transaction));

			const loaded = await loadZone(zoneId);

			assert.ok(loaded);
			assert.strictEqual(tileIdAt(loaded.map.tiles, 40, 0), loaded.map.tiles.defaultTileId);
			assert.strictEqual(tileIdAt(loaded.map.tiles, 0, 0), forest);
		});
	});

	describe('zone links', () =>
	{
		it('adds, replaces, lists and deletes the link on a cell', async () =>
		{
			const universeId = await addUniverse();
			const zoneId = await addZone(universeId, 'Outside');
			const insideId = await addZone(universeId, 'Inside');
			const target = { targetZoneId: insideId, targetColumn: 0, targetRow: 0, mode: 'automatic', requiresWholeGroup: false } as const;

			await saveZoneLink(zoneId, 1, 1, target);
			await saveZoneLink(zoneId, 1, 1, { ...target, mode: 'manual', requiresWholeGroup: true });
			await saveZoneLink(zoneId, -1, 0, target);

			assert.deepStrictEqual(await listZoneLinks(zoneId), [
				{ column: -1, row: 0, ...target },
				{ column: 1, row: 1, ...target, mode: 'manual', requiresWholeGroup: true }
			]);
			assert.strictEqual(await deleteZoneLink(zoneId, 1, 1), true);
			assert.strictEqual(await deleteZoneLink(zoneId, 1, 1), false);
			assert.strictEqual((await listZoneLinks(zoneId)).length, 1);
		});
	});

	describe('updateZoneSettings and deleteZone', () =>
	{
		it('changes settings, and deleting a zone leaves its children at the top level', async () =>
		{
			const universeId = await addUniverse();
			const parentId = await addZone(universeId, 'Kingdom');
			const childId = await addZone(universeId, 'Castle');

			await updateZoneSettings(childId, { parentZoneId: parentId, name: 'Royal Castle', passageOfTime: 'faerie', faerieMorning: 'east' });

			let child = (await findEditorZone(childId))?.zone;

			assert.strictEqual(child?.parentZoneId, parentId);
			assert.strictEqual(child.name, 'Royal Castle');
			assert.strictEqual(child.faerieMorning, 'east');

			await deleteZone(parentId);

			child = (await findEditorZone(childId))?.zone;

			assert.strictEqual(await findEditorZone(parentId), undefined);
			assert.strictEqual(child?.parentZoneId, null);
		});

		it('is refused by the database for a faerie zone that loops', async () =>
		{
			const zoneId = await addZone(await addUniverse());

			await assert.rejects(updateZoneSettings(zoneId, { passageOfTime: 'faerie', faerieMorning: 'east', loopsEastWest: true }));
		});
	});

	describe('isTileInUse', () =>
	{
		it('finds a tile used as a zone\'s default tile or painted in a cell of the universe', async () =>
		{
			const universeId = await addUniverse();
			const otherId = await addUniverse('Other');
			const zoneId = await addZone(universeId);
			const forest = await defaultTileId('forest');
			const water = await defaultTileId('water');

			await addZone(otherId, 'Lake', { tile: 'water' });

			assert.strictEqual(await isTileInUse(universeId, await defaultTileId('grass')), true);
			assert.strictEqual(await isTileInUse(universeId, forest), false);
			assert.strictEqual(await isTileInUse(universeId, water), false);

			await inTransaction((transaction) => editCells(zoneId, [[1, 1, forest]], transaction));

			assert.strictEqual(await isTileInUse(universeId, forest), true);
		});
	});
});
