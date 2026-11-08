import assert from 'assert';

import { localOnlyRefusal } from '../scripts/localDatabase.js';

/**
 * Settings with dev tools on and DATABASE_URL set
 *
 * @param databaseUrl The DATABASE_URL
 * @return The settings
 */
function devSettings(databaseUrl: string): NodeJS.ProcessEnv
{
	return({
		ENABLE_DEV_TOOLS: 'true',
		DATABASE_URL: databaseUrl
	});
}

describe('localOnlyRefusal', () =>
{
	it('allows a database on this computer', () =>
	{
		for (const host of ['localhost', '127.0.0.1', '[::1]', 'LOCALHOST'])
		{
			assert.strictEqual(localOnlyRefusal(devSettings(`postgres://kiln_app:secret@${host}:5432/kiln`)), undefined, host);
		}
	});

	it('refuses a database on another computer', () =>
	{
		for (const host of ['ep-cool-name-123456-pooler.us-east-2.aws.neon.tech', '10.0.0.5', 'localhost.example.com', '127.0.0.2', '[::2]'])
		{
			assert.notStrictEqual(localOnlyRefusal(devSettings(`postgres://kiln_app:secret@${host}:5432/kiln`)), undefined, host);
		}
	});

	it('refuses a host parameter, which replaces the URL\'s host', () =>
	{
		assert.notStrictEqual(localOnlyRefusal(devSettings('postgres://kiln_app:secret@localhost:5432/kiln?host=db.example.com')), undefined);
		assert.notStrictEqual(localOnlyRefusal(devSettings('postgres://kiln_app:secret@localhost:5432/kiln?host=/var/run/postgresql')), undefined);
	});

	it('refuses a DATABASE_URL that is unset or isn\'t a URL', () =>
	{
		assert.notStrictEqual(localOnlyRefusal({ ENABLE_DEV_TOOLS: 'true' }), undefined);
		assert.notStrictEqual(localOnlyRefusal(devSettings('host=localhost dbname=kiln')), undefined);
	});

	it('refuses to run without dev tools', () =>
	{
		const local = 'postgres://kiln_app:secret@127.0.0.1:5432/kiln';

		assert.notStrictEqual(localOnlyRefusal({ DATABASE_URL: local }), undefined);
		assert.notStrictEqual(localOnlyRefusal({ ENABLE_DEV_TOOLS: 'false', DATABASE_URL: local }), undefined);
		assert.notStrictEqual(localOnlyRefusal({ ENABLE_DEV_TOOLS: 'true', NODE_ENV: 'production', DATABASE_URL: local }), undefined);
	});
});
