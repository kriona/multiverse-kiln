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
 * Postgres's error code for connecting to a database that doesn't exist
 */
const INVALID_CATALOG_NAME = '3D000';

/**
 * How many times emptying the database is tried before its error is passed on
 */
const MAX_EMPTY_ATTEMPTS = 5;

/**
 * Postgres's codes (pg_constraint.confdeltype) for SET NULL and SET DEFAULT, the foreign key actions
 * that only clear the reference when the row referred to is deleted
 */
const CLEARING_DELETE_ACTIONS = ['n', 'd'];

/**
 * The test suite's own connection to its database, as the migration role: it builds the tables and
 * empties them, which the server's role isn't allowed to do
 */
let migrationPool: pg.Pool | undefined;

/**
 * The statements that empty the database and put back the rows the migrations inserted, made once
 * the database is built (see buildResetStatements())
 */
let resetStatements: string | undefined;

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
 * The connection string for a test worker's own database: the test database's name followed by the
 * worker's number, such as kiln_test_3 for worker 3. Worker 0, the one process that runs every test
 * file when the tests don't run in parallel, uses the test database itself
 *
 * @param connectionString The test database's connection string
 * @param worker The worker (testWorker in testWorker.ts)
 * @return The worker's connection string
 */
export function workerDatabaseUrl(connectionString: string, worker: number): string
{
	if (worker === 0)
	{
		return(connectionString);
	}

	const url = new URL(connectionString);

	url.pathname = `${url.pathname}_${worker}`;

	return(url.toString());
}

/**
 * The connection string for a review slot's database (reviewSlot.ts): the test database's name with
 * review and the slot's number before its _test, such as kiln_review_2_test for kiln_test's slot 2
 *
 * @param connectionString The test database's connection string, whose name ends in _test
 * (requireTestDatabaseUrl())
 * @param slot The slot, from 1
 * @return The slot's connection string
 */
export function reviewDatabaseUrl(connectionString: string, slot: number): string
{
	const url = new URL(connectionString);
	const database = decodeURIComponent(url.pathname.slice(1));

	url.pathname = `/${encodeURIComponent(`${database.slice(0, -'_test'.length)}_review_${slot}_test`)}`;

	return(url.toString());
}

/**
 * Builds the test database from nothing: drops every table, extension, type and function, applies every migration, and
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

	try
	{
		await migrationPool.query(`DROP SCHEMA IF EXISTS drizzle CASCADE`);
	}
	catch (error)
	{
		if ((error as { code?: string }).code === INVALID_CATALOG_NAME)
		{
			const database = decodeURIComponent(new URL(connectionString).pathname.slice(1));

			throw new Error(`The test database "${database}" doesn't exist. Create it with docker/postgres/init/02-databases.sh (see README "Start the database")`, { cause: error });
		}

		throw error;
	}

	await migrationPool.query(`DROP SCHEMA IF EXISTS ${BASELINE_SCHEMA} CASCADE`);
	await migrationPool.query(`DROP SCHEMA IF EXISTS ${BASELINE_SCHEMA} CASCADE`);
	await dropAll(migrationPool, `SELECT format('%I.%I', schemaname, tablename) FROM pg_tables WHERE schemaname = 'public'`, 'TABLE');

	// An extension's functions can only be dropped with the extension, such as pg_trgm's
	await dropAll(migrationPool, `SELECT format('%I', e.extname) FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE n.nspname = 'public'`, 'EXTENSION');
	await dropAll(migrationPool, `SELECT format('%I.%I', n.nspname, t.typname) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype = 'e'`, 'TYPE');
	await dropAll(migrationPool, `SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prokind = 'f'`, 'FUNCTION');

	await migrate(drizzle(migrationPool), { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });

	await migrationPool.query(`CREATE SCHEMA ${BASELINE_SCHEMA}`);

	const tables = await migrationPool.query<{ name: string }>(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.oid`);
	const references = await migrationPool.query<{ child: string; parent: string; onDelete: string }>(`SELECT child.relname AS child, parent.relname AS parent, k.confdeltype AS "onDelete" FROM pg_constraint k JOIN pg_class child ON child.oid = k.conrelid JOIN pg_class parent ON parent.oid = k.confrelid JOIN pg_namespace n ON n.oid = child.relnamespace WHERE k.contype = 'f' AND n.nspname = 'public'`);
	const filled: string[] = [];

	for (const { name } of tables.rows)
	{
		const copied = await migrationPool.query(`CREATE TABLE ${BASELINE_SCHEMA}.${pg.escapeIdentifier(name)} AS TABLE public.${pg.escapeIdentifier(name)}`);

		if ((copied.rowCount ?? 0) > 0)
		{
			filled.push(name);
		}
	}

	// Deleting a row that SET NULL or SET DEFAULT foreign keys refer to only clears those references,
	// so those keys don't order the deletes. Leaving them out breaks the cycles between universes,
	// areas and tiles. Every other key does: deleting a parent first would fail (NO ACTION, RESTRICT)
	// or cascade into rows other tables still refer to (CASCADE)
	const names = tables.rows.map(({ name }) => name);
	const ordering = references.rows.filter(({ onDelete }) => !CLEARING_DELETE_ACTIONS.includes(onDelete));

	resetStatements = buildResetStatements(orderByReferences(names, ordering).reverse(), orderByReferences(filled, references.rows));
}

/**
 * Builds the transaction emptyTestDatabase() runs: it locks every table, deletes every row, and puts
 * back the rows the migrations inserted
 *
 * Every table is locked first, as TRUNCATE would lock it, so a save from the test before either
 * finishes before the rows are deleted or waits until the database has been emptied. DELETE is used
 * rather than TRUNCATE because truncating replaces each table's files, which costs far more than
 * deleting the few rows a test leaves
 *
 * @param deleteOrder Every table, children first
 * @param baselineOrder The tables the migrations put rows in, parents first
 * @return The statements, as one string
 */
function buildResetStatements(deleteOrder: readonly string[], baselineOrder: readonly string[]): string
{
	const qualified = deleteOrder.map((name) => `public.${pg.escapeIdentifier(name)}`);

	return([
		'BEGIN',
		`LOCK TABLE ${qualified.join(', ')} IN ACCESS EXCLUSIVE MODE`,
		...qualified.map((table) => `DELETE FROM ${table}`),
		...baselineOrder.map((name) => `INSERT INTO public.${pg.escapeIdentifier(name)} OVERRIDING SYSTEM VALUE SELECT * FROM ${BASELINE_SCHEMA}.${pg.escapeIdentifier(name)}`),
		'COMMIT'
	]
		.join(';\n'));
}

/**
 * Orders tables so each comes after the tables its foreign keys refer to. A table that refers to
 * itself only needs its own rows in order, which a copy of them keeps, or deleting them all in one
 * statement handles
 *
 * @param tables The tables' names
 * @param references Each foreign key, as the referring (child) and referred-to (parent) table
 * @return The tables, parents first
 * @throws Error when the foreign keys between the tables form a cycle, which no order satisfies
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
		if (ordered.includes(table))
		{
			return;
		}

		if (visiting.has(table))
		{
			throw new Error(`The test database's foreign keys form a cycle through ${table}, so its tables can't be ordered`);
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
	if (!migrationPool || !resetStatements)
	{
		throw new Error('The test database has not been built');
	}

	// Identity sequences carry on from where they were, so new rows never reuse a baseline row's ID.
	// A room from the test before may still be saving as it closes; locking every table can deadlock
	// with that save, and Postgres may choose the reset to fail, so it is tried again
	for (let attempt = 1; ; attempt++)
	{
		const client = await migrationPool.connect();

		try
		{
			await client.query(resetStatements);
			break;
		}
		catch (error)
		{
			await client.query('ROLLBACK');

			if (((error as { code?: string }).code !== DEADLOCK_DETECTED) || (attempt >= MAX_EMPTY_ATTEMPTS))
			{
				throw error;
			}
		}
		finally
		{
			client.release();
		}
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
 * @param kind TABLE, EXTENSION, TYPE or FUNCTION
 */
async function dropAll(pool: pg.Pool, namesQuery: string, kind: 'TABLE' | 'EXTENSION' | 'TYPE' | 'FUNCTION'): Promise<void>
{
	const result = await pool.query<{ names: string | null }>(`SELECT string_agg(name, ', ') AS names FROM (${namesQuery}) AS objects(name)`);
	const names = result.rows[0]?.names;

	if (names)
	{
		await pool.query(`DROP ${kind} ${names} CASCADE`);
	}
}
