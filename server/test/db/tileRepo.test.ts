import assert from 'assert';

import { DEFAULT_TILE_NAMES, type EditorTile, type TileSettings } from '@multiverse-kiln/shared';

import { countCustomTiles, createCustomTile, createTile, deleteCustomTile, findDefaultTileIds, findTileKind, listEditorTiles, loadEditorTiles, loadUniverseTiles, restoreDefaultTile, saveEditedDefaultTile, updateCustomTile, type CustomTileSettings } from '../../src/db/tileRepo.js';
import { addUniverse, defaultTileId } from './fixtures.js';

const autumnGrass: TileSettings = {
	name: 'Autumn Grass',
	indoors: false,
	outdoors: true,
	color: 0xc08030,
	graphic: 'grass',
	visionCost: 10,
	walkSeconds: 10
};

const lava: CustomTileSettings = {
	name: 'Lava',
	indoors: false,
	outdoors: true,
	color: 0xff4400,
	graphic: null,
	visionCost: 0,
	walkSeconds: 0
};

/**
 * A tile's name as an English reader sees it: its own, or its default message's text
 *
 * @param tile The tile, as the editor lists it
 * @return The name
 */
function englishName(tile: EditorTile): string | undefined
{
	return((tile.name ?? ((tile.key === null) ? undefined : DEFAULT_TILE_NAMES.pf1e[tile.key]?.defaultMessage)));
}

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

			await createTile({ ruleset: 'pf1e', universeId, key: null, name: 'Stone Wall', indoors: true, outdoors: true, color: 0x8a8a8a, visionCost: 100, walkSeconds: 0 });

			assert.strictEqual((await findDefaultTileIds('pf1e')).size, 6);
		});
	});

	describe('loadUniverseTiles', () =>
	{
		it('loads the default tiles and the universe\'s own, but no other universe\'s', async () =>
		{
			const universeId = await addUniverse('Mine');
			const otherId = await addUniverse('Theirs');
			const wallId = await createTile({ ruleset: 'pf1e', universeId, key: null, name: 'Stone Wall', indoors: true, outdoors: true, color: 0x8a8a8a, visionCost: 100, walkSeconds: 0 });

			await createTile({ ruleset: 'pf1e', universeId: otherId, key: null, name: 'Lava', indoors: false, outdoors: true, color: 0xff4400, visionCost: 0, walkSeconds: 0 });

			const tiles = await loadUniverseTiles(universeId, 'pf1e');

			assert.strictEqual(tiles.length, 7);
			assert.deepStrictEqual(tiles.find((tile) => (tile.id === wallId)), { id: wallId, key: null, name: 'Stone Wall', indoors: true, outdoors: true, color: 0x8a8a8a, graphic: null, visionCost: 100, walkSeconds: 0 });
			assert.strictEqual(tiles.some((tile) => (tile.name === 'Lava')), false);
		});

		it('gives the default tiles the costs and colors from the structure overview', async () =>
		{
			const tiles = await loadUniverseTiles(await addUniverse(), 'pf1e');
			const forest = tiles.find((tile) => (tile.name === 'Forest'));

			assert.deepStrictEqual(forest, { id: forest?.id, key: 'forest', name: 'Forest', indoors: false, outdoors: true, color: 0x00aa11, graphic: 'forest', visionCost: 50, walkSeconds: 1200 });
		});

		it('draws each ruleset\'s default grass, forest and mountains with their graphics', async () =>
		{
			for (const ruleset of ['pf1e', 'sf1e'] as const)
			{
				const tiles = await loadUniverseTiles(await addUniverse(), ruleset);

				assert.strictEqual(tiles.find((tile) => (tile.key === 'grass'))?.graphic, 'grass', ruleset);
			}

			const pf1eTiles = await loadUniverseTiles(await addUniverse(), 'pf1e');

			assert.strictEqual(pf1eTiles.find((tile) => (tile.key === 'forest'))?.graphic, 'forest');
			assert.strictEqual(pf1eTiles.find((tile) => (tile.key === 'mountains'))?.graphic, 'mountains');
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
			assert.deepStrictEqual(mine.find((tile) => (tile.id === grassId)), { id: grassId, key: null, ...autumnGrass });
			assert.strictEqual(theirs.find((tile) => (tile.id === grassId))?.name, 'Grass');
		});

		it('gives an edited default tile that kept its name the default tile\'s English name', async () =>
		{
			const universeId = await addUniverse();
			const grassId = await defaultTileId('grass');

			await saveEditedDefaultTile(universeId, 'pf1e', grassId, { ...autumnGrass, name: null });

			const grass = (await loadUniverseTiles(universeId, 'pf1e')).find((tile) => (tile.id === grassId));

			assert.deepStrictEqual(grass, { id: grassId, key: 'grass', ...autumnGrass, name: 'Grass' });
		});
	});

	describe('loadEditorTiles', () =>
	{
		it('names each default tile by a message whose English matches the name the migrations store', async () =>
		{
			const universeId = await addUniverse();
			const englishNames = new Map((await loadUniverseTiles(universeId, 'pf1e')).map((tile) => [tile.id, tile.name]));
			const tiles = await loadEditorTiles(universeId, 'pf1e');

			assert.strictEqual(tiles.length, 6);

			for (const tile of tiles)
			{
				assert.strictEqual(tile.name, null);
				assert.strictEqual(englishName(tile), englishNames.get(tile.id), `the message for ${tile.key}`);
			}
		});

		it('gives an edited default tile a name only when it was renamed', async () =>
		{
			const universeId = await addUniverse();
			const grassId = await defaultTileId('grass');
			const forestId = await defaultTileId('forest');

			await saveEditedDefaultTile(universeId, 'pf1e', grassId, { ...autumnGrass, name: null });
			await saveEditedDefaultTile(universeId, 'pf1e', forestId, { ...autumnGrass, name: 'Dark Forest' });

			const tiles = await loadEditorTiles(universeId, 'pf1e');
			const grass = tiles.find((tile) => (tile.id === grassId));
			const forest = tiles.find((tile) => (tile.id === forestId));

			assert.deepStrictEqual(grass, { id: grassId, key: 'grass', ...autumnGrass, name: null, custom: false, edited: true });
			assert.strictEqual(forest?.name, 'Dark Forest');
			assert.strictEqual(forest.key, 'forest');
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

			assert.strictEqual(grass?.name, null);
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

			await updateCustomTile(universeId, lavaId, { ...lava, name: 'Cooled Lava', walkSeconds: 20 });

			const tile = (await loadEditorTiles(universeId, 'pf1e')).find((candidate) => (candidate.id === lavaId));

			assert.deepStrictEqual(tile, { id: lavaId, key: null, ...lava, name: 'Cooled Lava', walkSeconds: 20, custom: true, edited: false });

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
		it('filters by name, passable, where tiles are used, custom and edited, and pages through the matches', async () =>
		{
			const universeId = await addUniverse();

			await createCustomTile(universeId, 'pf1e', { ...lava });
			await createCustomTile(universeId, 'pf1e', { ...lava, name: 'Ash', walkSeconds: 10 });
			await saveEditedDefaultTile(universeId, 'pf1e', await defaultTileId('forest'), { ...autumnGrass, name: 'Dark Forest' });

			const names = async (query: Parameters<typeof listEditorTiles>[2]): Promise<(string | undefined)[]> => (await listEditorTiles(universeId, 'pf1e', query)).tiles.map((tile) => englishName(tile));

			assert.deepStrictEqual(await names({ name: 'FOREST' }), ['Dark Forest']);
			assert.deepStrictEqual(await names({ name: 'wood' }), ['Wood Floor']);
			assert.deepStrictEqual(await names({ passable: false }), ['Mountains', 'Water', 'Lava']);
			assert.deepStrictEqual(await names({ usedIn: 'indoors' }), ['Wood Floor']);
			assert.deepStrictEqual(await names({ usedIn: 'outdoors', passable: false }), ['Mountains', 'Water', 'Lava']);
			assert.deepStrictEqual(await names({ usedIn: 'both' }), []);
			assert.deepStrictEqual(await names({ custom: true }), ['Lava', 'Ash']);
			assert.deepStrictEqual(await names({ edited: true }), ['Dark Forest']);
			assert.deepStrictEqual(await names({ custom: false, passable: true, edited: false }), ['Grass', 'Desert', 'Wood Floor']);

			const page = await listEditorTiles(universeId, 'pf1e', { offset: 2, limit: 3 });

			assert.strictEqual(page.total, 8);
			assert.deepStrictEqual(page.tiles.map((tile) => englishName(tile)), ['Desert', 'Mountains', 'Water']);
		});
	});
});
