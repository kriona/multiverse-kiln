/**
 * The admin role's database client: a small connection pool for ADMIN_DATABASE_URL, which connects as
 * kiln_admin, wrapped in Drizzle
 *
 * kiln_admin can do everything the server's own role (kiln_app, client.ts) can, and also write the tables
 * only server admins change: server_admins, site_settings and admin_events. Only the admin pages' routes
 * (server/src/http/admin.ts) and `npm run admin:add -w server` use it, which eslint.config.js enforces,
 * so a bug anywhere else in the server can't change who is an admin or what the site's settings are
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import type { Executor } from './client.js';
import * as schema from './schema.js';

/**
 * The most connections the pool opens. Only server admins use it, a few requests at a time
 */
const MAX_ADMIN_CONNECTIONS = 2;

/**
 * Reads the connection string the admin pages connect with
 *
 * @param value Value of ADMIN_DATABASE_URL
 * @return The connection string
 */
function requireAdminDatabaseUrl(value: string | undefined): string
{
	if (!value)
	{
		throw new Error('ADMIN_DATABASE_URL is not set. See server/.env.example');
	}

	return(value);
}

/**
 * The admin role's connection pool. In production ADMIN_DATABASE_URL is Neon's pooled connection string
 * for kiln_admin
 */
export const adminPool = new pg.Pool({
	connectionString: requireAdminDatabaseUrl(process.env.ADMIN_DATABASE_URL),
	max: MAX_ADMIN_CONNECTIONS
});

// An idle connection can fail (e.g. the database restarts); without a listener the error would crash the server
adminPool.on('error', (error) =>
{
	console.error('Admin database pool error:', error.message);
});

/**
 * Drizzle instance for the admin role
 */
const adminDrizzle = drizzle(adminPool, { schema });

/**
 * The admin role's database, passed to repository functions as their executor
 */
export const adminDb: Executor = adminDrizzle;

/**
 * Runs repository calls in one of the admin role's transactions, passing each the transaction as its
 * executor
 *
 * The transaction commits when work resolves and rolls back when it throws
 *
 * @param work The calls to make
 * @return What work resolves with
 */
export function inAdminTransaction<T>(work: (executor: Executor) => Promise<T>): Promise<T>
{
	return(adminDrizzle.transaction(work));
}
