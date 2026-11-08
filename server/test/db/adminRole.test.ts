import assert from 'assert';

import { adminDb } from '../../src/db/adminClient.js';
import { pool } from '../../src/db/client.js';
import { addServerAdmin, isServerAdmin } from '../../src/db/serverAdminRepo.js';
import { addPlayer } from '../players.js';

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

	it('lets the admin role make a player a server admin, which the server\'s role can read', async () =>
	{
		const player = await addPlayer('Overseer');

		assert.strictEqual(await addServerAdmin(player.id, adminDb), true);
		assert.strictEqual(await isServerAdmin(player.id), true);
	});
});
