import assert from 'assert';

import { isDevToolsEnabled } from '../src/devTools.js';

describe('isDevToolsEnabled', () =>
{
	it('is off when ENABLE_DEV_TOOLS is unset', () =>
	{
		assert.strictEqual(isDevToolsEnabled({}), false);
		assert.strictEqual(isDevToolsEnabled({ NODE_ENV: 'development' }), false);
	});

	it('is on when ENABLE_DEV_TOOLS is "true" and NODE_ENV is unset or development', () =>
	{
		assert.strictEqual(isDevToolsEnabled({ ENABLE_DEV_TOOLS: 'true' }), true);
		assert.strictEqual(isDevToolsEnabled({ ENABLE_DEV_TOOLS: 'true', NODE_ENV: 'development' }), true);
	});

	it('is always off when NODE_ENV is anything but development', () =>
	{
		for (const nodeEnv of ['production', 'Production', 'prod', 'staging', 'test', ''])
		{
			assert.strictEqual(isDevToolsEnabled({ ENABLE_DEV_TOOLS: 'true', NODE_ENV: nodeEnv }), false, `NODE_ENV=${JSON.stringify(nodeEnv)}`);
		}
	});

	it('is always off on Colyseus Cloud', () =>
	{
		const env = {
			ENABLE_DEV_TOOLS: 'true',
			COLYSEUS_CLOUD: '1'
		};

		assert.strictEqual(isDevToolsEnabled(env), false);
	});

	it('only accepts exactly "true"', () =>
	{
		for (const value of ['TRUE', 'True', '1', 'yes', 'on', ' true', ''])
		{
			assert.strictEqual(isDevToolsEnabled({ ENABLE_DEV_TOOLS: value }), false, `ENABLE_DEV_TOOLS=${JSON.stringify(value)}`);
		}
	});
});
