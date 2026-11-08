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
 * The server connects to the test database (TEST_DATABASE_URL and TEST_ADMIN_DATABASE_URL) instead of
 * DATABASE_URL and ADMIN_DATABASE_URL. This runs before anything imports src/db/client.ts or
 * src/db/adminClient.ts, which read them when they are first imported. When
 * the tests run in parallel, each worker process loads this file and uses a test database of its own
 * (workerDatabaseUrl(), testWorker.ts). The kiln-review skill's repro tests run in a review slot, with a
 * database of the slot's own (reviewDatabaseUrl(), reviewSlot.ts)
 *
 * Keyed hashes and authenticator secrets use fixed test keys (AUTH_HMAC_KEY, TOTP_ENCRYPTION_KEY),
 * whatever server/.env says
 *
 * Uploads go to the test bucket (TEST_STORAGE_BUCKET) on the same storage as development, made if it
 * doesn't exist. Every upload has a key of its own, so it isn't emptied between tests
 *
 * Email is discarded unless a test replaces the sender, and test files go back to discardEmail when
 * they finish. Routes send some emails after answering, so one can be sent after its test is done,
 * and it must never reach SMTP_URL
 */
import { existsSync } from 'fs';

import type { EmailSender } from '../src/email/mailer.js';
import type { TestServerHooks } from './testServerHooks.js';
import { reviewSlot } from './reviewSlot.js';
import { buildTestDatabase, closeTestDatabase, emptyTestDatabase, requireTestDatabaseUrl, reviewDatabaseUrl, workerDatabaseUrl } from './testDatabase.js';
import { testWorker } from './testWorker.js';

/**
 * Reads a test database connection string from the environment and gives this process's own copy of
 * it: its review slot's database when it has one, or else its worker's
 *
 * @param name Name of the environment variable
 * @return The connection string
 */
function processDatabaseUrl(name: string): string
{
	const connectionString = requireTestDatabaseUrl(name);

	return(((reviewSlot > 0) ? reviewDatabaseUrl(connectionString, reviewSlot) : workerDatabaseUrl(connectionString, testWorker)));
}

/**
 * The booted test server's hooks. Imported when used rather than above: this file is loaded with mocha's
 * --require, and only a dynamic import reaches the same module the tests' testServer.ts registers with
 *
 * @return The hooks, or undefined when no test has booted the server
 */
async function testServerHooks(): Promise<TestServerHooks | undefined>
{
	return((await import('./testServerHooks.js')).testServerHooks());
}

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
process.env.ENABLE_DEV_CODES = '';
process.env.ALLOWED_ORIGINS = allowedTestOrigin;
process.env.SITE_URL = testSiteUrl;
process.env.DATABASE_URL = processDatabaseUrl('TEST_DATABASE_URL');
process.env.ADMIN_DATABASE_URL = processDatabaseUrl('TEST_ADMIN_DATABASE_URL');

// Fixed keys, so tests don't depend on the developer's own (32 bytes of 0x2a and of 0x2b in base64)
process.env.AUTH_HMAC_KEY = Buffer.alloc(32, 0x2a).toString('base64');
process.env.TOTP_ENCRYPTION_KEY = Buffer.alloc(32, 0x2b).toString('base64');

if (!process.env.TEST_STORAGE_BUCKET)
{
	throw new Error('TEST_STORAGE_BUCKET is not set. See server/.env.example');
}

process.env.STORAGE_BUCKET = process.env.TEST_STORAGE_BUCKET;

const migrationDatabaseUrl = processDatabaseUrl('TEST_MIGRATION_DATABASE_URL');

/**
 * Preparing this process for its tests, once it has started (see prepareProcess())
 */
let prepared: Promise<void> | undefined;

/**
 * Sends email nowhere, the sender for every test that doesn't watch the emails it sends
 *
 * @return A promise that resolves at once
 */
export const discardEmail: EmailSender = () =>
{
	return(Promise.resolve());
};

/**
 * Prepares this process for its tests: discards email, builds the test database and makes sure the
 * test bucket exists
 */
async function prepareProcess(): Promise<void>
{
	const { ensureBucket } = await import('../src/storage/objectStorage.js');
	const { setEmailSender } = await import('../src/email/mailer.js');

	setEmailSender(discardEmail);
	await buildTestDatabase(migrationDatabaseUrl);
	await ensureBucket();
}

/**
 * Root hooks for every test file: prepare the process once, empty the test database before each
 * test, and at the end shut the test server down and close both connections
 *
 * Without --parallel, mocha runs beforeAll and afterAll once, around every file. A parallel worker
 * runs them around each file it is given, and runs several files one after another
 */
export const mochaHooks = {
	async beforeAll(): Promise<void>
	{
		prepared ??= prepareProcess();
		await prepared;
	},

	async beforeEach(): Promise<void>
	{
		// Rooms write to the database as they close and every few seconds while open, so the last
		// test's rooms close before the database is emptied, never during it or the next test
		await (await testServerHooks())?.closeRooms();
		await emptyTestDatabase();
	},

	async afterAll(): Promise<void>
	{
		// A parallel worker may be given another file after this one, so it keeps its server and
		// connections. Mocha ends the worker's process once every file has run
		if (testWorker !== 0)
		{
			return;
		}

		const { pool } = await import('../src/db/client.js');
		const { adminPool } = await import('../src/db/adminClient.js');

		await (await testServerHooks())?.shutDown();
		await closeTestDatabase();
		await Promise.all([pool.end(), adminPool.end()]);
	}
};
