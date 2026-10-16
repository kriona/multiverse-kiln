import assert from 'assert';

import { loadOrCreatePlayerByName } from '../../src/db/playerRepo.js';

describe('playerRepo', () =>
{
	describe('loadOrCreatePlayerByName', () =>
	{
		it('creates a player for a new name', async () =>
		{
			const player = await loadOrCreatePlayerByName('Ada');

			assert.match(player.id, /^[0-9a-f-]{36}$/);
			assert.strictEqual(player.displayName, 'Ada');
		});

		it('loads the existing player for a name it has seen', async () =>
		{
			const first = await loadOrCreatePlayerByName('Ada');
			const second = await loadOrCreatePlayerByName('Ada');

			assert.deepStrictEqual(second, first);
		});

		it('ignores capitals, keeping the name as it was first typed', async () =>
		{
			const first = await loadOrCreatePlayerByName('Ada Lovelace');
			const second = await loadOrCreatePlayerByName('ada LOVELACE');

			assert.deepStrictEqual(second, first);
		});

		it('creates separate players for different names', async () =>
		{
			const ada = await loadOrCreatePlayerByName('Ada');
			const grace = await loadOrCreatePlayerByName('Grace');

			assert.notStrictEqual(ada.id, grace.id);
		});

		it('creates one player when the same new name logs in twice at once', async () =>
		{
			const players = await Promise.all([loadOrCreatePlayerByName('Ada'), loadOrCreatePlayerByName('ada'), loadOrCreatePlayerByName('ADA')]);

			assert.strictEqual(new Set(players.map((player) => player.id)).size, 1);
		});
	});
});
