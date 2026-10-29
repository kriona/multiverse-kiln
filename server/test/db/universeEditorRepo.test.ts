import assert from 'assert';

import { addPlayer } from '../players.js';
import { countUniversesWithRole, findUniverseRole, listEditableUniverses, setUniverseRole } from '../../src/db/universeEditorRepo.js';
import { addUniverse } from './fixtures.js';

describe('universeEditorRepo', () =>
{
	it('gives a player a role, and replaces it', async () =>
	{
		const universeId = await addUniverse();
		const { id: playerId } = await addPlayer('Ada');

		assert.strictEqual(await findUniverseRole(universeId, playerId), undefined);

		await setUniverseRole(universeId, playerId, 'builder');
		assert.strictEqual(await findUniverseRole(universeId, playerId), 'builder');

		await setUniverseRole(universeId, playerId, 'creator');
		assert.strictEqual(await findUniverseRole(universeId, playerId), 'creator');
	});

	it('counts and lists the universes a player has a role in, by name', async () =>
	{
		const { id: playerId } = await addPlayer('Ada');
		const { id: otherId } = await addPlayer('Grace');
		const zebraId = await addUniverse('Zebra');
		const appleId = await addUniverse('Apple');
		const theirsId = await addUniverse('Theirs');

		await setUniverseRole(zebraId, playerId, 'creator');
		await setUniverseRole(appleId, playerId, 'builder');
		await setUniverseRole(theirsId, otherId, 'creator');

		assert.strictEqual(await countUniversesWithRole(playerId, 'creator'), 1);
		assert.deepStrictEqual((await listEditableUniverses(playerId)).map((universe) => [universe.name, universe.role, universe.stage]), [
			['Apple', 'builder', 'in_the_beginning'],
			['Zebra', 'creator', 'in_the_beginning']
		]);
	});
});
