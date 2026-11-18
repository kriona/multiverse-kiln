/**
 * Database client: the connection pools for DATABASE_URL, wrapped in Drizzle
 *
 * Only repository modules in this folder import it; rooms call the repositories
 * (eslint.config.js enforces this), and never from inside the simulation tick
 *
 * There are two pools. The shared pool runs every query outside a bulk transaction: logins, room joins,
 * pages and sweeps. The bulk pool runs the transactions that can hold a connection for seconds (editor
 * saves and imports, exports and deleting universes, transactions.ts), so however many run at once,
 * they can't take every connection the short queries need
 */
import { drizzle, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import { PgTransaction, type PgDatabase } from 'drizzle-orm/pg-core';
import pg from 'pg';

import { parsePoolSizes } from './poolSettings.js';
import * as schema from './schema.js';

/**
 * How long a query waits for a connection from the shared pool, opening one included, before it fails,
 * so a request that finds every connection busy fails rather than waiting with no end
 */
const SHARED_CONNECTION_WAIT_MS = 10_000;

/**
 * How long a bulk transaction waits for a connection from the bulk pool. Bulk transactions queue behind
 * each other's, which can each take seconds, so they wait longer
 */
const BULK_CONNECTION_WAIT_MS = 60_000;

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

const databaseUrl = requireDatabaseUrl(process.env.DATABASE_URL);
const poolSizes = parsePoolSizes(process.env);

/**
 * Shared connection pool. In production DATABASE_URL is Neon's pooled connection string
 */
export const pool = new pg.Pool({
	connectionString: databaseUrl,
	max: poolSizes.shared,
	connectionTimeoutMillis: SHARED_CONNECTION_WAIT_MS
});

/**
 * Connection pool for bulk transactions, on the same database as the shared pool
 */
export const bulkPool = new pg.Pool({
	connectionString: databaseUrl,
	max: poolSizes.bulk,
	connectionTimeoutMillis: BULK_CONNECTION_WAIT_MS
});

// An idle connection can fail (e.g. the database restarts); without a listener the error would crash the server
pool.on('error', (error) =>
{
	console.error('Database pool error:', error.message);
});

bulkPool.on('error', (error) =>
{
	console.error('Bulk database pool error:', error.message);
});

/**
 * Drizzle instance for repository modules
 */
export const db = drizzle(pool, { schema });

/**
 * Drizzle instance for bulk transactions (transactions.ts)
 */
export const bulkDb = drizzle(bulkPool, { schema });

/**
 * What a repository function runs its queries on: the database itself, or a transaction from
 * db.transaction() when several calls must succeed or fail together
 */
export type Executor = PgDatabase<NodePgQueryResultHKT, typeof schema>;

/**
 * Runs queries that don't depend on each other's results. On a pool they all run at once, each on a
 * connection of its own, so they take one round trip to the database; in a transaction they run one
 * after another, since its one connection runs one query at a time
 *
 * @param executor The database, or a transaction
 * @param queries Starts each query
 * @return What each query resolves with, in the same order
 */
export async function runIndependent<T extends readonly unknown[]>(executor: Executor, queries: { readonly [K in keyof T]: () => Promise<T[K]> }): Promise<T>
{
	const starts = queries as readonly (() => Promise<unknown>)[];

	if (executor instanceof PgTransaction)
	{
		const results: unknown[] = [];

		for (const start of starts)
		{
			results.push(await start());
		}

		return(results as unknown as T);
	}

	return((await Promise.all(starts.map((start) => start()))) as unknown as T);
}
