import assert from 'assert';

import { DEFAULT_BULK_POOL_SIZE, DEFAULT_POOL_SIZE, parsePoolSizes } from '../../src/db/poolSettings.js';

describe('parsePoolSizes', () =>
{
	it('uses the defaults when the settings are unset or empty', () =>
	{
		const expected = {
			shared: DEFAULT_POOL_SIZE,
			bulk: DEFAULT_BULK_POOL_SIZE
		};

		assert.deepStrictEqual(parsePoolSizes({}), expected);
		assert.deepStrictEqual(parsePoolSizes({
			DATABASE_POOL_SIZE: '',
			DATABASE_BULK_POOL_SIZE: ' '
		}), expected);
	});

	it('reads each pool\'s size', () =>
	{
		assert.deepStrictEqual(parsePoolSizes({
			DATABASE_POOL_SIZE: '40',
			DATABASE_BULK_POOL_SIZE: ' 8 '
		}), {
			shared: 40,
			bulk: 8
		});
	});

	it('refuses a size that isn\'t a whole number from 1 to 500', () =>
	{
		for (const value of ['0', '-3', '2.5', 'ten', '501', '1e9'])
		{
			assert.throws(() => parsePoolSizes({ DATABASE_POOL_SIZE: value }), /DATABASE_POOL_SIZE must be a whole number/, value);
			assert.throws(() => parsePoolSizes({ DATABASE_BULK_POOL_SIZE: value }), /DATABASE_BULK_POOL_SIZE must be a whole number/, value);
		}
	});
});
