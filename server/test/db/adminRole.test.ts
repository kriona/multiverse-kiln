import assert from 'assert';

import { adminDb } from '../../src/db/adminClient.js';
import { pool } from '../../src/db/client.js';
import { addServerAdmin, isServerAdmin } from '../../src/db/serverAdminRepo.js';
import { deleteUniverse, findDisabledReason, isUniverseDeletionPrevented, setUniverseDisabled } from '../../src/db/universeRepo.js';
import { addPlayer } from '../players.js';
import { addUniverse } from './fixtures.js';

/**
 * Postgres's error code for a statement the role isn't allowed to run
 */
const INSUFFICIENT_PRIVILEGE = '42501';

describe('admin role', () =>
{
	it('keeps the server\'s role from changing server admins, site settings and admin events', async () =>
	{
		const statements = [
			'INSERT INTO server_admins (player_id) VALUES (gen_random_uuid())',
			'DELETE FROM server_admins',
			'UPDATE server_admins SET created_at = now()',
			'INSERT INTO site_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING',
			'UPDATE site_settings SET universe_creation_enabled = false',
			'DELETE FROM site_settings',
			'INSERT INTO admin_events (kind) VALUES (\'adminAdded\')'
		];

		for (const statement of statements)
		{
			await assert.rejects(pool.query(statement), { code: INSUFFICIENT_PRIVILEGE }, statement);
		}
	});

	it('keeps the server\'s role from disabling a universe, enabling it, or deleting it while its deletion is prevented', async () =>
	{
		const universeId = await addUniverse();
		const prevented = await addUniverse();

		await setUniverseDisabled(prevented, {
			reason: 'Spam',
			preventDeletion: true
		}, adminDb);

		const statements: [string, string[]][] = [
			['INSERT INTO universes (slug, ruleset, disabled_at, disabled_reason) VALUES (\'disabled-from-the-start\', \'pf1e\', now(), \'Spam\')', []],
			['UPDATE universes SET disabled_at = now(), disabled_reason = \'Spam\' WHERE id = $1', [universeId]],
			['UPDATE universes SET disabled_at = NULL, disabled_reason = NULL, deletion_prevented = false WHERE id = $1', [prevented]],
			['UPDATE universes SET deletion_prevented = false WHERE id = $1', [prevented]],
			['UPDATE universes SET disabled_reason = \'Something else\' WHERE id = $1', [prevented]],
			['DELETE FROM universes WHERE id = $1', [prevented]]
		];

		for (const [statement, values] of statements)
		{
			await assert.rejects(pool.query(statement, values), { code: INSUFFICIENT_PRIVILEGE }, statement);
		}

		assert.strictEqual(await isUniverseDeletionPrevented(prevented), true);
		assert.strictEqual(await findDisabledReason(prevented), 'Spam');
	});

	it('lets the server\'s role change a disabled universe\'s other columns, and delete a universe whose deletion isn\'t prevented', async () =>
	{
		const disabled = await addUniverse();

		await setUniverseDisabled(disabled, {
			reason: 'Spam',
			preventDeletion: false
		}, adminDb);

		assert.strictEqual((await pool.query('UPDATE universes SET require_two_factor = true, deletion_prevented = false WHERE id = $1', [disabled])).rowCount, 1);
		assert.strictEqual(await deleteUniverse(disabled), true);
	});

	it('lets the admin role disable a universe, enable it again and delete it while its deletion is prevented', async () =>
	{
		const universeId = await addUniverse();
		const prevented = await addUniverse();
		const disabling = {
			reason: 'Spam',
			preventDeletion: true
		};

		assert.strictEqual(await setUniverseDisabled(universeId, disabling, adminDb), true);
		assert.strictEqual(await setUniverseDisabled(universeId, null, adminDb), true);
		assert.strictEqual(await setUniverseDisabled(prevented, disabling, adminDb), true);
		assert.strictEqual(await deleteUniverse(prevented, adminDb), true);
	});

	it('lets the admin role make a player a server admin, which the server\'s role can read', async () =>
	{
		const player = await addPlayer('Overseer');

		assert.strictEqual(await addServerAdmin(player.id, adminDb), true);
		assert.strictEqual(await isServerAdmin(player.id), true);
	});
});
