import assert from 'assert';

import { createUniverse, deleteUniverse, findUniverse, setUniverseAreas } from '../../src/db/universeRepo.js';
import { loadArea } from '../../src/db/areaRepo.js';
import { addUniverse, addArea } from './fixtures.js';

describe('universeRepo', () =>
{
	it('creates a universe still being built, with no areas yet', async () =>
	{
		const universeId = await createUniverse({ name: 'Kilnhaven', shortDescription: 'A small town.', ruleset: 'pf1e' });

		assert.deepStrictEqual(await findUniverse(universeId), {
			id: universeId,
			name: 'Kilnhaven',
			shortDescription: 'A small town.',
			stage: 'in_the_beginning',
			ruleset: 'pf1e',
			passageOfTime: 'flows_normally',
			lobbyAreaId: undefined,
			startingAreaId: undefined
		});
	});

	it('sets the lobby and starting areas', async () =>
	{
		const universeId = await addUniverse();
		const lobbyId = await addArea(universeId, 'Lobby');
		const startId = await addArea(universeId, 'Start');

		await setUniverseAreas(universeId, lobbyId, startId);

		const universe = await findUniverse(universeId);

		assert.strictEqual(universe?.lobbyAreaId, lobbyId);
		assert.strictEqual(universe?.startingAreaId, startId);
	});

	it('finds nothing for an unknown ID', async () =>
	{
		assert.strictEqual(await findUniverse('00000000-0000-4000-8000-000000000000'), undefined);
	});

	it('deletes a universe with its areas', async () =>
	{
		const universeId = await addUniverse();
		const areaId = await addArea(universeId);

		assert.strictEqual(await deleteUniverse(universeId), true);
		assert.strictEqual(await findUniverse(universeId), undefined);
		assert.strictEqual(await loadArea(areaId), undefined);
		assert.strictEqual(await deleteUniverse(universeId), false);
	});
});
