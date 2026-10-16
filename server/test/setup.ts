/**
 * Loaded by mocha before any test file
 *
 * The test harness connects over plain ws://, so mark this as a test run (the only case outside
 * Colyseus Cloud where the server allows plain HTTP) and clear the local certificate settings
 * before app.config.ts creates its transport. Empty values also stop .env from filling them in
 *
 * Dev tools are cleared too, so tests see the production routes whatever server/.env says, and
 * ALLOWED_ORIGINS is set to a fixed test origin
 *
 * The server connects to the test database (TEST_DATABASE_URL) instead of DATABASE_URL. This runs
 * before anything imports src/db/client.ts, which reads DATABASE_URL when it is first imported
 */
import { existsSync } from 'fs';

import { buildTestDatabase, closeTestDatabase, emptyTestDatabase, requireTestDatabaseUrl } from './testDatabase.js';

/**
 * The only origin the test server allows
 */
export const allowedTestOrigin = 'https://allowed.example';

// Colyseus loads .env too, but only once the server is imported, which is too late for the test
// database settings. Neither load replaces a variable that is already set
if (existsSync('.env'))
{
	process.loadEnvFile('.env');
}

process.env.NODE_ENV = 'test';
process.env.SSL_KEY_FILE = '';
process.env.SSL_CERT_FILE = '';
process.env.ENABLE_DEV_TOOLS = '';
process.env.ALLOWED_ORIGINS = allowedTestOrigin;
process.env.DATABASE_URL = requireTestDatabaseUrl('TEST_DATABASE_URL');

const migrationDatabaseUrl = requireTestDatabaseUrl('TEST_MIGRATION_DATABASE_URL');

/**
 * Root hooks for every test file: build the test database once, empty it before each test, and
 * close both connections at the end
 */
export const mochaHooks = {
	async beforeAll(): Promise<void>
	{
		await buildTestDatabase(migrationDatabaseUrl);
	},

	async beforeEach(): Promise<void>
	{
		await emptyTestDatabase();
	},

	async afterAll(): Promise<void>
	{
		const { pool } = await import('../src/db/client.js');

		await closeTestDatabase();
		await pool.end();
	}
};
