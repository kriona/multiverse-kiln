import assert from 'assert';

import { isDevCode } from '../../src/auth/devCodes.js';

describe('isDevCode', () =>
{
	const development = { ENABLE_DEV_CODES: 'true' };

	it('takes all 1s of the code\'s length when dev codes are on', () =>
	{
		assert.strictEqual(isDevCode('111111', 6, development), true);
		assert.strictEqual(isDevCode('111111', 6, {
			...development,
			NODE_ENV: 'development'
		}), true);
		assert.strictEqual(isDevCode('11111', 6, development), false);
		assert.strictEqual(isDevCode('1111111', 6, development), false);
		assert.strictEqual(isDevCode('111112', 6, development), false);
	});

	it('takes nothing while ENABLE_DEV_CODES is unset, even with dev tools on', () =>
	{
		assert.strictEqual(isDevCode('111111', 6, {}), false);
		assert.strictEqual(isDevCode('111111', 6, { NODE_ENV: 'development' }), false);
		assert.strictEqual(isDevCode('111111', 6, { ENABLE_DEV_TOOLS: 'true' }), false);
	});

	it('takes nothing when ENABLE_DEV_CODES is anything but "true"', () =>
	{
		for (const value of ['', 'false', '1', 'yes', 'TRUE', 'True', ' true'])
		{
			assert.strictEqual(isDevCode('111111', 6, { ENABLE_DEV_CODES: value }), false, `ENABLE_DEV_CODES=${JSON.stringify(value)}`);
		}
	});

	it('takes nothing when NODE_ENV is set to anything but development', () =>
	{
		for (const nodeEnv of ['', 'production', 'test', 'staging', 'Development'])
		{
			assert.strictEqual(isDevCode('111111', 6, {
				...development,
				NODE_ENV: nodeEnv
			}), false, `NODE_ENV=${JSON.stringify(nodeEnv)}`);
		}
	});

	it('takes nothing on Colyseus Cloud', () =>
	{
		for (const cloud of ['', 'true', '1'])
		{
			assert.strictEqual(isDevCode('111111', 6, {
				...development,
				COLYSEUS_CLOUD: cloud
			}), false, `COLYSEUS_CLOUD=${JSON.stringify(cloud)}`);
		}
	});
});
