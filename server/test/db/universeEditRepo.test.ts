import assert from 'assert';

import { deletePlayer } from '../../src/db/playerRepo.js';
import { deleteUniverseEditsBefore, listUniverseEdits, recordUniverseEdit } from '../../src/db/universeEditRepo.js';
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

	it('deletes up to a batch of the saves made before a time, in every universe', async () =>
	{
		const universeId = await addUniverse();
		const otherId = await addUniverse('Elsewhere');
		const ada = await addPlayer('Ada');
		const cutoff = new Date(Date.UTC(2025, 10, 1, 12, 0));

		for (const [minute, universe] of [[-3, universeId], [-2, otherId], [-1, universeId], [0, universeId], [1, otherId]] as const)
		{
			await recordUniverseEdit({
				universeId: universe,
				playerId: ada.id,
				role: 'creator',
				changeDetails: [{ subject: 'difficultyLevel', action: 'changed', target: { key: 'hard', name: null }, fields: [{ field: 'mobScale', value: minute }], count: 1 }],
				savedAt: new Date(cutoff.getTime() + (minute * 60 * 1000))
			});
		}

		assert.strictEqual(await deleteUniverseEditsBefore(cutoff, 2), 2);
		assert.strictEqual(await deleteUniverseEditsBefore(cutoff, 2), 1);
		assert.strictEqual(await deleteUniverseEditsBefore(cutoff, 2), 0);
		assert.strictEqual((await listUniverseEdits(universeId, { offset: 0, limit: 10 })).total, 1);
		assert.strictEqual((await listUniverseEdits(otherId, { offset: 0, limit: 10 })).total, 1);
	});

	it('never deletes saves from the last 90 days, however late the time given', async () =>
	{
		const universeId = await addUniverse();
		const ada = await addPlayer('Ada');
		const now = Date.now();
		const dayMs = (24 * 60 * 60 * 1000);

		for (const days of [91, 89])
		{
			await recordUniverseEdit({
				universeId,
				playerId: ada.id,
				role: 'creator',
				changeDetails: [{ subject: 'difficultyLevel', action: 'changed', target: { key: 'hard', name: null }, fields: [{ field: 'mobScale', value: days }], count: 1 }],
				savedAt: new Date(now - (days * dayMs))
			});
		}

		assert.strictEqual(await deleteUniverseEditsBefore(new Date(now + dayMs), 10), 1);
		assert.strictEqual((await listUniverseEdits(universeId, { offset: 0, limit: 10 })).total, 1);
	});
});
