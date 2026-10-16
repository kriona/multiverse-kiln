import assert from 'assert';

import type { TileSettings } from '@multiverse-kiln/shared';

import { countCustomTiles, createCustomTile, createTile, deleteCustomTile, findDefaultTileIds, findTileKind, listEditorTiles, loadEditorTiles, loadUniverseTiles, restoreDefaultTile, saveEditedDefaultTile, updateCustomTile } from '../../src/db/tileRepo.js';
import { addUniverse, defaultTileId } from './fixtures.js';

const autumnGrass: TileSettings = {
	name: 'Autumn Grass',
	indoors: false,
	color: 0xc08030,
	visionCost: 10,
	movementCost: 0
};

const lava: TileSettings = {
	name: 'Lava',
	indoors: false,
	color: 0xff4400,
	visionCost: 0,
	movementCost: 100
};

describe('tileRepo', () =>
{
	describe('findDefaultTileIds', () =>
	{
		it('finds the Pathfinder 1E default tiles the migrations add', async () =>
		{
			const tileIds = await findDefaultTileIds('pf1e');

			assert.deepStrictEqual([...tileIds.keys()].sort(), ['desert', 'forest', 'grass', 'mountains', 'water', 'wood_floor']);
		});

		it('leaves out tiles that belong to a universe', async () =>
		{
			const universeId = await addUniverse();

			await createTile({ ruleset: 'pf1e', universeId, key: null, name: 'Stone Wall', indoors: true, color: 0x8a8a8a, visionCost: 100, movementCost: 100 });

			assert.strictEqual((await findDefaultTileIds('pf1e')).size, 6);
		});
	});

	describe('loadUniverseTiles', () =>
	{
		it('loads the default tiles and the universe\'s own, but no other universe\'s', async () =>
		{
			const universeId = await addUniverse('Mine');
			const otherId = await addUniverse('Theirs');
			const wallId = await createTile({ ruleset: 'pf1e', universeId, key: null, name: 'Stone Wall', indoors: true, color: 0x8a8a8a, visionCost: 100, movementCost: 100 });

			await createTile({ ruleset: 'pf1e', universeId: otherId, key: null, name: 'Lava', indoors: false, color: 0xff4400, visionCost: 0, movementCost: 100 });

			const tiles = await loadUniverseTiles(universeId, 'pf1e');

			assert.strictEqual(tiles.length, 7);
			assert.deepStrictEqual(tiles.find((tile) => (tile.id === wallId)), { id: wallId, name: 'Stone Wall', indoors: true, color: 0x8a8a8a, visionCost: 100, movementCost: 100 });
			assert.strictEqual(tiles.some((tile) => (tile.name === 'Lava')), false);
		});

		it('gives the default tiles the costs and colors from the structure overview', async () =>
		{
			const tiles = await loadUniverseTiles(await addUniverse(), 'pf1e');
			const forest = tiles.find((tile) => (tile.name === 'Forest'));

			assert.deepStrictEqual(forest, { id: forest?.id, name: 'Forest', indoors: false, color: 0x00aa11, visionCost: 50, movementCost: 50 });
		});

		it('gives an edited default tile the universe\'s settings under the default tile\'s ID, for that universe only', async () =>
		{
			const universeId = await addUniverse('Mine');
			const otherId = await addUniverse('Theirs');
			const grassId = await defaultTileId('grass');

			await saveEditedDefaultTile(universeId, 'pf1e', grassId, { ...autumnGrass });

			const mine = await loadUniverseTiles(universeId, 'pf1e');
			const theirs = await loadUniverseTiles(otherId, 'pf1e');

			assert.strictEqual(mine.length, 6);
			assert.deepStrictEqual(mine.find((tile) => (tile.id === grassId)), { id: grassId, ...autumnGrass });
			assert.strictEqual(theirs.find((tile) => (tile.id === grassId))?.name, 'Grass');
		});
	});

	describe('edited default tiles', () =>
	{
		it('replaces the universe\'s copy when edited again, and restores the default', async () =>
		{
			const universeId = await addUniverse();
			const grassId = await defaultTileId('grass');

			await saveEditedDefaultTile(universeId, 'pf1e', grassId, { ...autumnGrass });
			await saveEditedDefaultTile(universeId, 'pf1e', grassId, { ...autumnGrass, name: 'Winter Grass' });

			let grass = (await loadEditorTiles(universeId, 'pf1e')).find((tile) => (tile.id === grassId));

			assert.strictEqual(grass?.name, 'Winter Grass');
			assert.strictEqual(grass.edited, true);
			assert.strictEqual(grass.custom, false);

			await restoreDefaultTile(universeId, grassId);

			grass = (await loadEditorTiles(universeId, 'pf1e')).find((tile) => (tile.id === grassId));

			assert.strictEqual(grass?.name, 'Grass');
			assert.strictEqual(grass.edited, false);
		});
	});

	describe('custom tiles', () =>
	{
		it('creates, counts, changes and deletes a universe\'s own tiles', async () =>
		{
			const universeId = await addUniverse();
			const lavaId = await createCustomTile(universeId, 'pf1e', { ...lava });

			assert.strictEqual(await countCustomTiles(universeId), 1);

			await updateCustomTile(universeId, lavaId, { ...lava, name: 'Cooled Lava', movementCost: 50 });

			const tile = (await loadEditorTiles(universeId, 'pf1e')).find((candidate) => (candidate.id === lavaId));

			assert.deepStrictEqual(tile, { id: lavaId, ...lava, name: 'Cooled Lava', movementCost: 50, custom: true, edited: false });

			await deleteCustomTile(universeId, lavaId);

			assert.strictEqual(await countCustomTiles(universeId), 0);
		});

		it('does not count edited copies of default tiles', async () =>
		{
			const universeId = await addUniverse();

			await saveEditedDefaultTile(universeId, 'pf1e', await defaultTileId('grass'), { ...autumnGrass });

			assert.strictEqual(await countCustomTiles(universeId), 0);
		});
	});

	describe('findTileKind', () =>
	{
		it('tells default tiles from the universe\'s own, and knows nothing of other tiles', async () =>
		{
			const universeId = await addUniverse('Mine');
			const otherId = await addUniverse('Theirs');
			const grassId = await defaultTileId('grass');
			const lavaId = await createCustomTile(universeId, 'pf1e', { ...lava });
			const theirLavaId = await createCustomTile(otherId, 'pf1e', { ...lava });

			assert.strictEqual(await findTileKind(universeId, 'pf1e', grassId), 'default');
			assert.strictEqual(await findTileKind(universeId, 'pf1e', lavaId), 'custom');
			assert.strictEqual(await findTileKind(universeId, 'pf1e', theirLavaId), undefined);
			assert.strictEqual(await findTileKind(universeId, 'pf1e', 2147483647), undefined);
		});
	});

	describe('listEditorTiles', () =>
	{
		it('filters by name, passable, custom and edited, and pages through the matches', async () =>
		{
			const universeId = await addUniverse();

			await createCustomTile(universeId, 'pf1e', { ...lava });
			await createCustomTile(universeId, 'pf1e', { ...lava, name: 'Ash', movementCost: 0 });
			await saveEditedDefaultTile(universeId, 'pf1e', await defaultTileId('forest'), { ...autumnGrass, name: 'Dark Forest' });

			const names = async (query: Parameters<typeof listEditorTiles>[2]): Promise<string[]> => (await listEditorTiles(universeId, 'pf1e', query)).tiles.map((tile) => tile.name);

			assert.deepStrictEqual(await names({ name: 'FOREST' }), ['Dark Forest']);
			assert.deepStrictEqual(await names({ passable: false }), ['Mountains', 'Water', 'Lava']);
			assert.deepStrictEqual(await names({ custom: true }), ['Lava', 'Ash']);
			assert.deepStrictEqual(await names({ edited: true }), ['Dark Forest']);
			assert.deepStrictEqual(await names({ custom: false, passable: true, edited: false }), ['Grass', 'Desert', 'Wood Floor']);

			const page = await listEditorTiles(universeId, 'pf1e', { offset: 2, limit: 3 });

			assert.strictEqual(page.total, 8);
			assert.deepStrictEqual(page.tiles.map((tile) => tile.name), ['Desert', 'Mountains', 'Water']);
		});
	});
});
