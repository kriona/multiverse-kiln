import assert from 'assert';

import { createUniverse, deleteUniverse, findUniverse, setUniverseZones } from '../../src/db/universeRepo.js';
import { loadZone } from '../../src/db/zoneRepo.js';
import { addUniverse, addZone } from './fixtures.js';

describe('universeRepo', () =>
{
	it('creates a universe still being built, with no zones yet', async () =>
	{
		const universeId = await createUniverse({ name: 'Kilnhaven', shortDescription: 'A small town.', ruleset: 'pf1e' });

		assert.deepStrictEqual(await findUniverse(universeId), {
			id: universeId,
			name: 'Kilnhaven',
			shortDescription: 'A small town.',
			stage: 'in_the_beginning',
			ruleset: 'pf1e',
			passageOfTime: 'flows_normally',
			lobbyZoneId: undefined,
			startingZoneId: undefined
		});
	});

	it('sets the lobby and starting zones', async () =>
	{
		const universeId = await addUniverse();
		const lobbyId = await addZone(universeId, 'Lobby');
		const startId = await addZone(universeId, 'Start');

		await setUniverseZones(universeId, lobbyId, startId);

		const universe = await findUniverse(universeId);

		assert.strictEqual(universe?.lobbyZoneId, lobbyId);
		assert.strictEqual(universe?.startingZoneId, startId);
	});

	it('finds nothing for an unknown ID', async () =>
	{
		assert.strictEqual(await findUniverse('00000000-0000-4000-8000-000000000000'), undefined);
	});

	it('deletes a universe with its zones', async () =>
	{
		const universeId = await addUniverse();
		const zoneId = await addZone(universeId);

		assert.strictEqual(await deleteUniverse(universeId), true);
		assert.strictEqual(await findUniverse(universeId), undefined);
		assert.strictEqual(await loadZone(zoneId), undefined);
		assert.strictEqual(await deleteUniverse(universeId), false);
	});
});
