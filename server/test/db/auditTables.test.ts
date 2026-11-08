import assert from 'assert';

import { pool } from '../../src/db/client.js';

/**
 * Postgres's error code for a statement the role isn't allowed to run
 */
const INSUFFICIENT_PRIVILEGE = '42501';

/**
 * The audit records, which the server's role may add to and read but not change, each with its time column
 */
const AUDIT_TABLES = [
	{ table: 'admin_events', timeColumn: 'occurred_at' },
	{ table: 'auth_events', timeColumn: 'occurred_at' },
	{ table: 'universe_edits', timeColumn: 'saved_at' }
];

describe('audit tables', () =>
{
	for (const { table, timeColumn } of AUDIT_TABLES)
	{
		it(`keeps the server's role from changing or deleting rows in ${table}`, async () =>
		{
			await assert.rejects(pool.query(`UPDATE ${table} SET ${timeColumn} = now()`), { code: INSUFFICIENT_PRIVILEGE });
			await assert.rejects(pool.query(`DELETE FROM ${table}`), { code: INSUFFICIENT_PRIVILEGE });
		});
	}
});
