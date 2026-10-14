/**
 * Database client: a connection pool for DATABASE_URL, wrapped in Drizzle
 *
 * Only repository modules in this folder import it; rooms call the repositories
 * (eslint.config.js enforces this), and never from inside the simulation tick
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema.js';

/**
 * Reads the connection string the server connects with
 *
 * @param value Value of DATABASE_URL
 * @return The connection string
 */
function requireDatabaseUrl(value: string | undefined): string
{
	if (!value)
	{
		throw new Error('DATABASE_URL is not set. See server/.env.example');
	}

	return(value);
}

/**
 * Shared connection pool. In production DATABASE_URL is Neon's pooled connection string
 */
export const pool = new pg.Pool({ connectionString: requireDatabaseUrl(process.env.DATABASE_URL) });

// An idle connection can fail (e.g. the database restarts); without a listener the error would crash the server
pool.on('error', (error) =>
{
	console.error('Database pool error:', error.message);
});

/**
 * Drizzle instance for repository modules
 */
export const db = drizzle(pool, { schema });
