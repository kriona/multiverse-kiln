import assert from 'assert';
import { randomUUID } from 'crypto';
import { CHUNK_SIZE, cellIndexInChunk, chunkKey, DEFAULT_LOBBY_DAY_HOURS, DEFAULT_TILE_CELL, tileIdAt, VOID_CELL } from '@multiverse-kiln/shared';

import { findDefaultTileIds } from '../../src/db/tileRepo.js';
import { setUniverseAreas, updateUniverseSettings } from '../../src/db/universeRepo.js';
import { inTransaction } from '../../src/db/transactions.js';
import { countAreas, createAreaLink, deleteArea, deleteAreaLink, editCells, findEditorArea, isTileInUse, listAreaLinks, listAreas, loadChunks, loadChunksAt, loadArea, resizeArea, saveGroundChunk, saveAreaLink, updateAreaSettings } from '../../src/db/areaRepo.js';
import { addUniverse, addArea, defaultTileId, loadWholeMap } from './fixtures.js';

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

describe('areaRepo', () =>
{
	describe('loadArea', () =>
	{
		it('loads an area\'s settings, bounds and tiles', async () =>
		{
			const universeId = await addUniverse();
			const areaId = await addArea(universeId, 'Meadow');
			const tileIds = await findDefaultTileIds('pf1e');
			const loaded = await loadArea(areaId);

			assert.ok(loaded);
			assert.deepStrictEqual(loaded.area, { id: areaId, universeId, parentAreaId: undefined, name: 'Meadow', enabled: true, indoors: false, passageOfTime: 'inherit' });
			assert.deepStrictEqual(loaded.bounds, { minColumn: -2, minRow: -1, maxColumn: 2, maxRow: 1 });
			assert.strictEqual(loaded.defaultTileId, tileIds.get('grass'));
			assert.strictEqual(loaded.loopsEastWest, false);
			assert.strictEqual(loaded.tiles.length, 6);
			assert.strictEqual(loaded.tiles.find((tile) => (tile.id === tileIds.get('forest')))?.movementCost, 50);
			assert.deepStrictEqual(loaded.links, []);
		});

		it('loads the area\'s links', async () =>
		{
			const universeId = await addUniverse();
			const areaId = await addArea(universeId, 'Outside');
			const insideId = await addArea(universeId, 'Inside');

			await createAreaLink({ areaId, column: 1, row: 0, targetAreaId: insideId, targetColumn: -1, targetRow: 1, mode: 'automatic', requiresWholeGroup: true });

			const loaded = await loadArea(areaId);

			assert.deepStrictEqual(loaded?.links, [{ column: 1, row: 0, targetAreaId: insideId, targetColumn: -1, targetRow: 1, mode: 'automatic', requiresWholeGroup: true }]);
			assert.deepStrictEqual((await loadArea(insideId))?.links, []);
		});

		it('follows inherit through the parent areas to the universe\'s passage of time', async () =>
		{
			const universeId = await addUniverse();
			const worldId = await addArea(universeId, 'World');
			const regionId = await addArea(universeId, 'Region');
			const townId = await addArea(universeId, 'Town');

			await updateAreaSettings(regionId, { parentAreaId: worldId });
			await updateAreaSettings(townId, { parentAreaId: regionId });

			assert.deepStrictEqual((await loadArea(townId))?.time, { passage: 'flows_normally' });

			await updateAreaSettings(worldId, { passageOfTime: 'faerie', faerieMorning: 'north' });

			assert.deepStrictEqual((await loadArea(townId))?.time, { passage: 'faerie', morning: 'north' });

			await updateAreaSettings(regionId, { passageOfTime: 'always_dusk' });

			assert.deepStrictEqual((await loadArea(townId))?.time, { passage: 'always_dusk' });
		});

		it('gives the lobby\'s area the universe\'s lobby time', async () =>
		{
			const universeId = await addUniverse();
			const lobbyId = await addArea(universeId, 'Lobby');
			const startId = await addArea(universeId, 'Start');

			await setUniverseAreas(universeId, lobbyId, startId);
			await updateAreaSettings(lobbyId, { passageOfTime: 'always_noon' });

			assert.deepStrictEqual((await loadArea(lobbyId))?.time, { passage: 'real_time', dayHours: DEFAULT_LOBBY_DAY_HOURS });

			await updateUniverseSettings(universeId, { lobbyPassageOfTime: 'faerie', lobbyFaerieMorning: 'horizon' });

			assert.deepStrictEqual((await loadArea(lobbyId))?.time, { passage: 'faerie', morning: 'horizon' });
		});

		it('finds nothing for an unknown ID', async () =>
		{
			assert.strictEqual(await loadArea('00000000-0000-4000-8000-000000000000'), undefined);
		});
	});

	describe('saveGroundChunk', () =>
	{
		it('replaces a chunk that is already stored', async () =>
		{
			const universeId = await addUniverse();
			const areaId = await addArea(universeId);
			const tileIds = await findDefaultTileIds('pf1e');

			await saveGroundChunk(areaId, 0, 0, chunkStartingWith(tileIds.get('forest') as number));
			await saveGroundChunk(areaId, 0, 0, chunkStartingWith(tileIds.get('water') as number));

			const map = await loadWholeMap(areaId);

			assert.strictEqual(map?.tiles.chunks.size, 1);
			assert.strictEqual(tileIdAt(map.tiles, 0, 0), tileIds.get('water'));
		});

		it('refuses a chunk with the wrong number of cells', async () =>
		{
			const areaId = await addArea(await addUniverse());

			await assert.rejects(saveGroundChunk(areaId, 0, 0, [DEFAULT_TILE_CELL]));
		});
	});

	describe('findEditorArea and listAreas', () =>
	{
		it('finds an area\'s settings and lists the universe\'s areas by name', async () =>
		{
			const universeId = await addUniverse();
			const areaId = await addArea(universeId, 'Village');
			const grass = await defaultTileId('grass');

			await addArea(universeId, 'Abbey');
			await addArea(await addUniverse('Other'), 'Elsewhere');

			assert.deepStrictEqual(await findEditorArea(areaId), {
				universeId,
				area: {
					id: areaId,
					name: 'Village',
					parentAreaId: null,
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
			assert.deepStrictEqual((await listAreas(universeId)).map((area) => area.name), ['Abbey', 'Village']);
			assert.strictEqual(await countAreas(universeId), 2);
		});
	});

	describe('editCells', () =>
	{
		it('paints cells, and stops storing a chunk painted back to the default tile', async () =>
		{
			const areaId = await addArea(await addUniverse(), 'Field', { bounds: { minColumn: -40, minRow: -40, maxColumn: 40, maxRow: 40 } });
			const forest = await defaultTileId('forest');

			assert.strictEqual(await inTransaction((transaction) => editCells(areaId, [[0, 0, forest], [-1, 5, VOID_CELL]], transaction)), 'edited');

			let map = await loadWholeMap(areaId);

			assert.strictEqual(map?.tiles.chunks.size, 2);
			assert.strictEqual(tileIdAt(map.tiles, 0, 0), forest);
			assert.strictEqual(tileIdAt(map.tiles, -1, 5), undefined);

			await inTransaction((transaction) => editCells(areaId, [[0, 0, DEFAULT_TILE_CELL]], transaction));

			map = await loadWholeMap(areaId);

			assert.deepStrictEqual([...(map?.tiles.chunks.keys() ?? [])], [chunkKey(-1, 0)]);
		});

		it('changes nothing when a cell is outside the bounds', async () =>
		{
			const areaId = await addArea(await addUniverse());
			const forest = await defaultTileId('forest');

			assert.strictEqual(await inTransaction((transaction) => editCells(areaId, [[0, 0, forest], [3, 0, forest]], transaction)), 'out_of_bounds');
			assert.strictEqual((await loadWholeMap(areaId))?.tiles.chunks.size, 0);
		});

		it('reports an area that does not exist', async () =>
		{
			assert.strictEqual(await inTransaction((transaction) => editCells(randomUUID(), [[0, 0, 1]], transaction)), 'not_found');
		});
	});

	describe('loadChunks', () =>
	{
		it('loads the stored chunks in a range', async () =>
		{
			const areaId = await addArea(await addUniverse(), 'Field', { bounds: { minColumn: -100, minRow: -100, maxColumn: 100, maxRow: 100 } });
			const forest = await defaultTileId('forest');

			await inTransaction((transaction) => editCells(areaId, [[0, 0, forest], [40, 0, forest], [-80, -80, forest]], transaction));

			const chunks = await loadChunks(areaId, { minChunkColumn: 0, minChunkRow: 0, maxChunkColumn: 1, maxChunkRow: 1 });

			assert.deepStrictEqual(chunks.map((chunk) => [chunk.chunkColumn, chunk.chunkRow]), [[0, 0], [1, 0]]);
			assert.strictEqual(chunks[0].cells[cellIndexInChunk(0, 0)], forest);
		});
	});

	describe('loadChunksAt', () =>
	{
		it('loads the stored chunks among those asked for', async () =>
		{
			const areaId = await addArea(await addUniverse(), 'Field', { bounds: { minColumn: -100, minRow: -100, maxColumn: 100, maxRow: 100 } });
			const forest = await defaultTileId('forest');

			await inTransaction((transaction) => editCells(areaId, [[0, 0, forest], [40, 0, forest], [-80, -80, forest]], transaction));

			const chunks = await loadChunksAt(areaId, [{ chunkColumn: -3, chunkRow: -3 }, { chunkColumn: 1, chunkRow: 0 }, { chunkColumn: 2, chunkRow: 2 }]);

			assert.deepStrictEqual(chunks.map((chunk) => [chunk.chunkColumn, chunk.chunkRow]).sort(), [[-3, -3], [1, 0]]);
			assert.deepStrictEqual(await loadChunksAt(areaId, []), []);
		});
	});

	describe('resizeArea', () =>
	{
		it('grows a map without discarding anything', async () =>
		{
			const areaId = await addArea(await addUniverse());
			const bounds = { minColumn: -10, minRow: -10, maxColumn: 10, maxRow: 10 };

			assert.deepStrictEqual(await inTransaction((transaction) => resizeArea(areaId, bounds, false, transaction)), { resized: true, discardedCells: 0, discardedLinks: 0 });
			assert.deepStrictEqual((await findEditorArea(areaId))?.area.bounds, bounds);
		});

		it('refuses to discard painted cells and links unless allowed, then discards them', async () =>
		{
			const universeId = await addUniverse();
			const wide = { minColumn: -50, minRow: -5, maxColumn: 50, maxRow: 5 };
			const areaId = await addArea(universeId, 'Road', { bounds: wide });
			const otherId = await addArea(universeId, 'Inn');
			const forest = await defaultTileId('forest');
			const narrow = { minColumn: -5, minRow: -5, maxColumn: 5, maxRow: 5 };

			await inTransaction((transaction) => editCells(areaId, [[0, 0, forest], [40, 0, forest], [-40, 0, VOID_CELL]], transaction));
			await createAreaLink({ areaId, column: 40, row: 1, targetAreaId: otherId, targetColumn: 0, targetRow: 0, mode: 'automatic', requiresWholeGroup: false });
			await createAreaLink({ areaId: otherId, column: 1, row: 0, targetAreaId: areaId, targetColumn: -40, targetRow: 0, mode: 'manual', requiresWholeGroup: false });
			await createAreaLink({ areaId: otherId, column: -1, row: 0, targetAreaId: areaId, targetColumn: 0, targetRow: 0, mode: 'manual', requiresWholeGroup: false });

			const refused = await inTransaction((transaction) => resizeArea(areaId, narrow, false, transaction));

			assert.deepStrictEqual(refused, { resized: false, discardedCells: 2, discardedLinks: 2 });
			assert.deepStrictEqual((await findEditorArea(areaId))?.area.bounds, wide);

			assert.deepStrictEqual(await inTransaction((transaction) => resizeArea(areaId, narrow, true, transaction)), { resized: true, discardedCells: 2, discardedLinks: 2 });
			assert.deepStrictEqual(await listAreaLinks(areaId), []);
			assert.deepStrictEqual((await listAreaLinks(otherId)).map((link) => link.column), [-1]);

			// Growing back shows the default tile where the discarded cells were
			await inTransaction((transaction) => resizeArea(areaId, wide, false, transaction));

			const map = await loadWholeMap(areaId);

			assert.ok(map);
			assert.strictEqual(tileIdAt(map.tiles, 40, 0), map.tiles.defaultTileId);
			assert.strictEqual(tileIdAt(map.tiles, 0, 0), forest);
		});
	});

	describe('area links', () =>
	{
		it('adds, replaces, lists and deletes the link on a cell', async () =>
		{
			const universeId = await addUniverse();
			const areaId = await addArea(universeId, 'Outside');
			const insideId = await addArea(universeId, 'Inside');
			const target = { targetAreaId: insideId, targetColumn: 0, targetRow: 0, mode: 'automatic', requiresWholeGroup: false } as const;

			await saveAreaLink(areaId, 1, 1, target);
			await saveAreaLink(areaId, 1, 1, { ...target, mode: 'manual', requiresWholeGroup: true });
			await saveAreaLink(areaId, -1, 0, target);

			assert.deepStrictEqual(await listAreaLinks(areaId), [
				{ column: -1, row: 0, ...target },
				{ column: 1, row: 1, ...target, mode: 'manual', requiresWholeGroup: true }
			]);
			assert.strictEqual(await deleteAreaLink(areaId, 1, 1), true);
			assert.strictEqual(await deleteAreaLink(areaId, 1, 1), false);
			assert.strictEqual((await listAreaLinks(areaId)).length, 1);
		});
	});

	describe('updateAreaSettings and deleteArea', () =>
	{
		it('changes settings, and deleting an area leaves its children at the top level', async () =>
		{
			const universeId = await addUniverse();
			const parentId = await addArea(universeId, 'Kingdom');
			const childId = await addArea(universeId, 'Castle');

			await updateAreaSettings(childId, { parentAreaId: parentId, name: 'Royal Castle', passageOfTime: 'faerie', faerieMorning: 'east' });

			let child = (await findEditorArea(childId))?.area;

			assert.strictEqual(child?.parentAreaId, parentId);
			assert.strictEqual(child.name, 'Royal Castle');
			assert.strictEqual(child.faerieMorning, 'east');

			await deleteArea(parentId);

			child = (await findEditorArea(childId))?.area;

			assert.strictEqual(await findEditorArea(parentId), undefined);
			assert.strictEqual(child?.parentAreaId, null);
		});

		it('is refused by the database for a faerie area that loops', async () =>
		{
			const areaId = await addArea(await addUniverse());

			await assert.rejects(updateAreaSettings(areaId, { passageOfTime: 'faerie', faerieMorning: 'east', loopsEastWest: true }));
		});
	});

	describe('isTileInUse', () =>
	{
		it('finds a tile used as an area\'s default tile or painted in a cell of the universe', async () =>
		{
			const universeId = await addUniverse();
			const otherId = await addUniverse('Other');
			const areaId = await addArea(universeId);
			const forest = await defaultTileId('forest');
			const water = await defaultTileId('water');

			await addArea(otherId, 'Lake', { tile: 'water' });

			assert.strictEqual(await isTileInUse(universeId, await defaultTileId('grass')), true);
			assert.strictEqual(await isTileInUse(universeId, forest), false);
			assert.strictEqual(await isTileInUse(universeId, water), false);

			await inTransaction((transaction) => editCells(areaId, [[1, 1, forest]], transaction));

			assert.strictEqual(await isTileInUse(universeId, forest), true);
		});
	});
});
