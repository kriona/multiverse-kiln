/**
 * Loaded by mocha before any test file
 *
 * The test harness connects over plain ws://, so mark this as a test run (the only case outside
 * Colyseus Cloud where the server allows plain HTTP) and clear the local certificate settings
 * before app.config.ts creates its transport. Empty values also stop .env from filling them in
 *
 * Dev tools are cleared too, so tests see the production routes whatever server/.env says, and
 * ALLOWED_ORIGINS and SITE_URL are set to fixed test origins
 *
 * The server connects to the test database (TEST_DATABASE_URL) instead of DATABASE_URL. This runs
 * before anything imports src/db/client.ts, which reads DATABASE_URL when it is first imported
 *
 * Keyed hashes and authenticator secrets use fixed test keys (AUTH_HMAC_KEY, TOTP_ENCRYPTION_KEY),
 * whatever server/.env says
 *
 * Uploads go to the test bucket (TEST_STORAGE_BUCKET) on the same storage as development, made if it
 * doesn't exist. Every upload has a key of its own, so it isn't emptied between tests
 */
import { existsSync } from 'fs';

import { buildTestDatabase, closeTestDatabase, emptyTestDatabase, requireTestDatabaseUrl } from './testDatabase.js';

/**
 * The only origin the test server allows
 */
export const allowedTestOrigin = 'https://allowed.example';

/**
 * The client's address in tests, which emails link to
 */
export const testSiteUrl = 'https://site.example';

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
process.env.SITE_URL = testSiteUrl;
process.env.DATABASE_URL = requireTestDatabaseUrl('TEST_DATABASE_URL');

// Fixed keys, so tests don't depend on the developer's own (32 bytes of 0x2a and of 0x2b in base64)
process.env.AUTH_HMAC_KEY = Buffer.alloc(32, 0x2a).toString('base64');
process.env.TOTP_ENCRYPTION_KEY = Buffer.alloc(32, 0x2b).toString('base64');

if (!process.env.TEST_STORAGE_BUCKET)
{
	throw new Error('TEST_STORAGE_BUCKET is not set. See server/.env.example');
}

process.env.STORAGE_BUCKET = process.env.TEST_STORAGE_BUCKET;

const migrationDatabaseUrl = requireTestDatabaseUrl('TEST_MIGRATION_DATABASE_URL');

/**
 * Root hooks for every test file: build the test database once, empty it before each test, and
 * close both connections at the end
 */
export const mochaHooks = {
	async beforeAll(): Promise<void>
	{
		const { ensureBucket } = await import('../src/storage/objectStorage.js');

		await buildTestDatabase(migrationDatabaseUrl);
		await ensureBucket();
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
