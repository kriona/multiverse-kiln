import assert from 'assert';

import { deletePlayer } from '../../src/db/playerRepo.js';
import { addServerAdmin, isServerAdmin } from '../../src/db/serverAdminRepo.js';
import { addPlayer } from '../players.js';

describe('serverAdminRepo', () =>
{
	it('makes a player a server admin once', async () =>
	{
		const player = await addPlayer('Overseer');

		assert.strictEqual(await isServerAdmin(player.id), false);
		assert.strictEqual(await addServerAdmin(player.id), true);
		assert.strictEqual(await addServerAdmin(player.id), false);
		assert.strictEqual(await isServerAdmin(player.id), true);
	});

	it('forgets an admin whose account is deleted', async () =>
	{
		const player = await addPlayer('Departed');

		await addServerAdmin(player.id);
		await deletePlayer(player.id);

		assert.strictEqual(await isServerAdmin(player.id), false);
	});
});
