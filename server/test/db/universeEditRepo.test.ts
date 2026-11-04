import assert from 'assert';

import { deletePlayer } from '../../src/db/playerRepo.js';
import { listUniverseEdits, recordUniverseEdit } from '../../src/db/universeEditRepo.js';
import { deleteUniverse } from '../../src/db/universeRepo.js';
import { addPlayer } from '../players.js';
import { addUniverse } from './fixtures.js';

describe('universeEditRepo', () =>
{
	it('lists a universe\'s saves newest first, a page at a time', async () =>
	{
		const universeId = await addUniverse();
		const otherId = await addUniverse('Elsewhere');
		const ada = await addPlayer('Ada');

		for (const [minute, universe] of [[1, universeId], [2, universeId], [3, universeId], [4, otherId]] as const)
		{
			await recordUniverseEdit({
				universeId: universe,
				playerId: ada.id,
				role: ((minute === 2) ? 'admin' : 'creator'),
				changeDetails: [{ subject: 'difficultyLevel', action: 'changed', target: { key: 'hard', name: null }, fields: [{ field: 'mobScale', value: minute }], count: 1 }],
				savedAt: new Date(Date.UTC(2026, 10, 1, 12, minute))
			});
		}

		const first = await listUniverseEdits(universeId, { offset: 0, limit: 2 });
		const second = await listUniverseEdits(universeId, { offset: 2, limit: 2 });
		const valuesOf = (page: typeof first): unknown[] => page.edits.map(({ changeDetails }) => changeDetails?.[0].fields[0].value);

		assert.strictEqual(first.total, 3);
		assert.deepStrictEqual(first.edits.map(({ role, player }) => [role, player]), [
			['creator', { username: 'Ada', displayName: 'Ada' }],
			['admin', { username: 'Ada', displayName: 'Ada' }]
		]);
		assert.deepStrictEqual(valuesOf(first), [3, 2]);
		assert.deepStrictEqual(valuesOf(second), [1]);
		assert.deepStrictEqual(second.edits[0].changeDetails, [{ subject: 'difficultyLevel', action: 'changed', target: { key: 'hard', name: null }, fields: [{ field: 'mobScale', value: 1 }], count: 1 }]);
	});

	it('keeps a save after the account that made it is deleted, and deletes it with the universe', async () =>
	{
		const universeId = await addUniverse();
		const grace = await addPlayer('Grace');

		await recordUniverseEdit({
			universeId,
			playerId: grace.id,
			role: 'builder',
			changeDetails: [{ subject: 'cells', action: 'changed', target: { key: null, name: 'Cave' }, fields: [], count: 12 }],
			savedAt: new Date()
		});
		await deletePlayer(grace.id);

		const kept = await listUniverseEdits(universeId, { offset: 0, limit: 10 });

		assert.deepStrictEqual(kept.edits.map(({ player, role }) => [player, role]), [[null, 'builder']]);

		await deleteUniverse(universeId);

		assert.strictEqual((await listUniverseEdits(universeId, { offset: 0, limit: 10 })).total, 0);
	});
});
