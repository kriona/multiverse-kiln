import assert from 'assert';

import { isDevCode } from '../../src/auth/devCodes.js';

describe('isDevCode', () =>
{
	const development = { ENABLE_DEV_TOOLS: 'true' };

	it('takes all 1s of the code\'s length on a local development server', () =>
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

	it('takes nothing while dev tools are off', () =>
	{
		assert.strictEqual(isDevCode('111111', 6, {}), false);
		assert.strictEqual(isDevCode('111111', 6, { NODE_ENV: 'development' }), false);
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
