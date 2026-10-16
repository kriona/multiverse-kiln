import assert from 'assert';

import { createTile, findDefaultTileIds, loadUniverseTiles } from '../../src/db/tileRepo.js';
import { addUniverse } from './fixtures.js';

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
	});
});
