import assert from 'assert';

import { adminDb, inAdminTransaction } from '../../src/db/adminClient.js';
import { findPlayerAdminEvents, recordAdminEvent } from '../../src/db/adminEventRepo.js';
import { deletePlayer } from '../../src/db/playerRepo.js';
import { addServerAdmin, isServerAdmin, listServerAdmins, removeServerAdmin, searchPlayersToMakeAdmin } from '../../src/db/serverAdminRepo.js';
import { addPlayer } from '../players.js';
import { turnOnTwoFactor } from '../twoFactorAccounts.js';

describe('serverAdminRepo', () =>
{
	it('makes a player a server admin once', async () =>
	{
		const player = await addPlayer('Overseer');

		assert.strictEqual(await isServerAdmin(player.id), false);
		assert.strictEqual(await addServerAdmin(player.id, adminDb), true);
		assert.strictEqual(await addServerAdmin(player.id, adminDb), false);
		assert.strictEqual(await isServerAdmin(player.id), true);
	});

	it('forgets an admin whose account is deleted', async () =>
	{
		const player = await addPlayer('Departed');

		await addServerAdmin(player.id, adminDb);
		await deletePlayer(player.id);

		assert.strictEqual(await isServerAdmin(player.id), false);
	});

	it('lists the admins by username ignoring case, with whether each has 2FA', async () =>
	{
		const zed = await addPlayer('zed');
		const ada = await addPlayer('Ada');

		await addPlayer('Not Admin');
		await addServerAdmin(zed.id, adminDb);
		await addServerAdmin(ada.id, adminDb);
		await turnOnTwoFactor(zed.id);

		assert.deepStrictEqual((await listServerAdmins()).map((admin) => [admin.username, admin.twoFactor]), [
			['Ada', false],
			['zed', true]
		]);
	});

	it('removes an admin, but never the last, nor a player who isn\'t one', async () =>
	{
		const ada = await addPlayer('Ada');
		const alan = await addPlayer('Alan');
		const grace = await addPlayer('Grace');

		await addServerAdmin(ada.id, adminDb);
		await addServerAdmin(alan.id, adminDb);

		assert.strictEqual(await inAdminTransaction((transaction) => removeServerAdmin(grace.id, transaction)), 'notAdmin');
		assert.strictEqual(await inAdminTransaction((transaction) => removeServerAdmin(ada.id, transaction)), 'removed');
		assert.strictEqual(await inAdminTransaction((transaction) => removeServerAdmin(alan.id, transaction)), 'lastAdmin');
		assert.strictEqual(await isServerAdmin(ada.id), false);
		assert.strictEqual(await isServerAdmin(alan.id), true);
	});

	it('finds players to make admins, leaving out those who are', async () =>
	{
		const admin = await addPlayer('Grace Admin');

		await addPlayer('Grace Hopper');
		await addServerAdmin(admin.id, adminDb);

		assert.deepStrictEqual((await searchPlayersToMakeAdmin({ text: 'grace', usernameOnly: false }, 10)).map((player) => player.username), ['Grace_Hopper']);
	});

	it('keeps an admin event when its accounts are deleted, emptying their columns', async () =>
	{
		const admin = await addPlayer('Overseer');
		const player = await addPlayer('Departed');

		await recordAdminEvent({
			kind: 'adminAdded',
			adminId: admin.id,
			playerId: player.id,
			occurredAt: new Date()
		}, adminDb);
		await deletePlayer(player.id);

		assert.deepStrictEqual((await findPlayerAdminEvents(admin.id)).map((event) => [event.kind, event.adminId, event.playerId]), [
			['adminAdded', admin.id, null]
		]);
	});
});
