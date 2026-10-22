import { fileURLToPath } from 'url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/**
 * Schema holding a copy of the rows the migrations insert (such as default tiles), put back after each wipe
 */
const BASELINE_SCHEMA = 'test_baseline';

/**
 * Postgres's error code for a deadlock it broke by failing one of the statements in it
 */
const DEADLOCK_DETECTED = '40P01';

/**
 * How many times emptying the database is tried before its error is passed on
 */
const MAX_TRUNCATE_ATTEMPTS = 5;

/**
 * The test suite's own connection to its database, as the migration role: it builds the tables and
 * empties them, which the server's role isn't allowed to do
 */
let migrationPool: pg.Pool | undefined;

/**
 * Tables the migrations put rows in, each after the tables its foreign keys refer to, so rows that
 * refer to other tables' rows are put back after them
 */
let baselineTables: string[] = [];

/**
 * Reads a test database connection string from the environment, refusing anything that isn't a test
 * database, since the tests delete everything in it
 *
 * @param name Name of the environment variable
 * @return The connection string
 */
export function requireTestDatabaseUrl(name: string): string
{
	const value = process.env[name];

	if (!value)
	{
		throw new Error(`${name} is not set. See server/.env.example`);
	}

	const database = decodeURIComponent(new URL(value).pathname.slice(1));

	if (!database.endsWith('_test'))
	{
		throw new Error(`${name} names the database "${database}". The tests empty their database, so its name must end in _test`);
	}

	return(value);
}

/**
 * Builds the test database from nothing: drops every table and type, applies every migration, and
 * keeps a copy of the rows the migrations inserted
 *
 * Starting from nothing means rows left by an earlier run never count as migration data, and every
 * run checks that the migrations apply to an empty database
 *
 * @param connectionString The test database, as the migration role
 */
export async function buildTestDatabase(connectionString: string): Promise<void>
{
	migrationPool = new pg.Pool({ connectionString });

	await migrationPool.query(`DROP SCHEMA IF EXISTS drizzle CASCADE`);
	await migrationPool.query(`DROP SCHEMA IF EXISTS ${BASELINE_SCHEMA} CASCADE`);
	await dropAll(migrationPool, `SELECT format('%I.%I', schemaname, tablename) FROM pg_tables WHERE schemaname = 'public'`, 'TABLE');
	await dropAll(migrationPool, `SELECT format('%I.%I', n.nspname, t.typname) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype = 'e'`, 'TYPE');

	await migrate(drizzle(migrationPool), { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });

	await migrationPool.query(`CREATE SCHEMA ${BASELINE_SCHEMA}`);

	const tables = await migrationPool.query<{ name: string }>(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.oid`);
	const references = await migrationPool.query<{ child: string; parent: string }>(`SELECT child.relname AS child, parent.relname AS parent FROM pg_constraint k JOIN pg_class child ON child.oid = k.conrelid JOIN pg_class parent ON parent.oid = k.confrelid JOIN pg_namespace n ON n.oid = child.relnamespace WHERE k.contype = 'f' AND n.nspname = 'public'`);
	const filled: string[] = [];

	for (const { name } of tables.rows)
	{
		const copied = await migrationPool.query(`CREATE TABLE ${BASELINE_SCHEMA}.${pg.escapeIdentifier(name)} AS TABLE public.${pg.escapeIdentifier(name)}`);

		if ((copied.rowCount ?? 0) > 0)
		{
			filled.push(name);
		}
	}

	baselineTables = orderByReferences(filled, references.rows);
}

/**
 * Orders tables so each comes after the tables its foreign keys refer to. A table that refers to
 * itself only needs its own rows in order, which a copy of them keeps
 *
 * @param tables The tables' names
 * @param references Each foreign key, as the referring (child) and referred-to (parent) table
 * @return The tables, parents first
 */
function orderByReferences(tables: readonly string[], references: readonly { child: string; parent: string }[]): string[]
{
	const ordered: string[] = [];
	const visiting = new Set<string>();

	/**
	 * Adds a table after the tables it refers to
	 *
	 * @param table The table's name
	 */
	const visit = (table: string): void =>
	{
		if (ordered.includes(table) || visiting.has(table))
		{
			return;
		}

		visiting.add(table);

		for (const { child, parent } of references)
		{
			if ((child === table) && (parent !== table) && tables.includes(parent))
			{
				visit(parent);
			}
		}

		ordered.push(table);
	};

	for (const table of tables)
	{
		visit(table);
	}

	return(ordered);
}

/**
 * Deletes every row the tests could have added, leaving only what the migrations inserted, so each
 * test starts from the same database
 */
export async function emptyTestDatabase(): Promise<void>
{
	if (!migrationPool)
	{
		throw new Error('The test database has not been built');
	}

	const result = await migrationPool.query<{ tables: string | null }>(`SELECT string_agg(format('%I.%I', schemaname, tablename), ', ') AS tables FROM pg_tables WHERE schemaname = 'public'`);
	const tables = result.rows[0]?.tables;

	if (!tables)
	{
		return;
	}

	// Identity sequences carry on from where they were, so new rows never reuse a baseline row's ID.
	// A room from the test before may still be saving as it closes; truncating every table can deadlock
	// with that save, and Postgres may choose the truncate to fail, so it is tried again
	for (let attempt = 1; ; attempt++)
	{
		try
		{
			await migrationPool.query(`TRUNCATE ${tables} CASCADE`);
			break;
		}
		catch (error)
		{
			if (((error as { code?: string }).code !== DEADLOCK_DETECTED) || (attempt >= MAX_TRUNCATE_ATTEMPTS))
			{
				throw error;
			}
		}
	}

	for (const name of baselineTables)
	{
		await migrationPool.query(`INSERT INTO public.${pg.escapeIdentifier(name)} OVERRIDING SYSTEM VALUE SELECT * FROM ${BASELINE_SCHEMA}.${pg.escapeIdentifier(name)}`);
	}
}

/**
 * Closes the test suite's own connection
 */
export async function closeTestDatabase(): Promise<void>
{
	await migrationPool?.end();
	migrationPool = undefined;
}

/**
 * Drops every object a query names
 *
 * @param pool The connection
 * @param namesQuery A query returning one column of qualified, quoted names
 * @param kind TABLE or TYPE
 */
async function dropAll(pool: pg.Pool, namesQuery: string, kind: 'TABLE' | 'TYPE'): Promise<void>
{
	const result = await pool.query<{ names: string | null }>(`SELECT string_agg(name, ', ') AS names FROM (${namesQuery}) AS objects(name)`);
	const names = result.rows[0]?.names;

	if (names)
	{
		await pool.query(`DROP ${kind} ${names} CASCADE`);
	}
}
