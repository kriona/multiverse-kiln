import assert from 'assert';

import { isDevToolsEnabled } from '../src/devTools.js';

describe('isDevToolsEnabled', () =>
{
	it('is off when ENABLE_DEV_TOOLS is unset', () =>
	{
		assert.strictEqual(isDevToolsEnabled({}), false);
		assert.strictEqual(isDevToolsEnabled({ NODE_ENV: 'development' }), false);
	});

	it('is on when ENABLE_DEV_TOOLS is "true" outside production', () =>
	{
		assert.strictEqual(isDevToolsEnabled({ ENABLE_DEV_TOOLS: 'true' }), true);
		assert.strictEqual(isDevToolsEnabled({ ENABLE_DEV_TOOLS: 'true', NODE_ENV: 'development' }), true);
	});

	it('is always off in production', () =>
	{
		assert.strictEqual(isDevToolsEnabled({ ENABLE_DEV_TOOLS: 'true', NODE_ENV: 'production' }), false);
	});

	it('only accepts exactly "true"', () =>
	{
		for (const value of ['TRUE', 'True', '1', 'yes', 'on', ' true', ''])
		{
			assert.strictEqual(isDevToolsEnabled({ ENABLE_DEV_TOOLS: value }), false, `ENABLE_DEV_TOOLS=${JSON.stringify(value)}`);
		}
	});
});
