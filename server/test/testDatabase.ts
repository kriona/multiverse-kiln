import { fileURLToPath } from 'url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/**
 * The test suite's own connection to its database, as the migration role: it applies the migrations
 * and empties the tables, which the server's role isn't allowed to do
 */
let migrationPool: pg.Pool | undefined;

/**
 * Reads a test database connection string from the environment, refusing anything that isn't a test
 * database, since the tests delete every row in it
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
 * Applies any migrations the test database doesn't have yet
 *
 * @param connectionString The test database, as the migration role
 */
export async function migrateTestDatabase(connectionString: string): Promise<void>
{
	migrationPool = new pg.Pool({ connectionString });

	await migrate(drizzle(migrationPool), { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
}

/**
 * Deletes every row in every table, so each test starts with an empty database
 */
export async function emptyTestDatabase(): Promise<void>
{
	if (!migrationPool)
	{
		throw new Error('The test database has not been migrated');
	}

	// Only the public schema: drizzle keeps its record of applied migrations in its own schema
	const result = await migrationPool.query<{ tables: string | null }>(`SELECT string_agg(format('%I.%I', schemaname, tablename), ', ') AS tables FROM pg_tables WHERE schemaname = 'public'`);
	const tables = result.rows[0]?.tables;

	if (tables)
	{
		await migrationPool.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
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
