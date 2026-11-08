import assert from 'assert';

import { CachedList } from '../src/http/editorSaveAudit.js';

/**
 * A cached list whose loads are counted, holding what `contents` holds when each load runs
 *
 * @param contents The list's entries, by ID
 * @return The list, and how many times it has loaded
 */
function countedList(contents: Map<number, string>): { list: CachedList<number, string>; loads: () => number }
{
	let loads = 0;
	const list = new CachedList(() =>
	{
		loads++;

		return(Promise.resolve(new Map(contents)));
	});

	return({
		list,
		loads: () => loads
	});
}

describe('The save audit\'s cached lists', () =>
{
	it('load once for lookups made at the same time', async () =>
	{
		const { list, loads } = countedList(new Map([[1, 'dagger'], [2, 'rope']]));
		const found = await Promise.all([1, 2, 1, 3, 2].map((id) => list.find(id)));

		assert.deepStrictEqual(found, ['dagger', 'rope', 'dagger', undefined, 'rope']);
		assert.strictEqual(loads(), 1);
	});

	it('load again for an entry they lack, and keep the entries changes set', async () =>
	{
		const contents = new Map([[1, 'dagger']]);
		const { list, loads } = countedList(contents);

		assert.strictEqual(await list.find(1), 'dagger');
		list.set(1, 'sword');
		assert.strictEqual(await list.find(1), 'sword');
		assert.strictEqual(loads(), 1);

		contents.set(2, 'rope');
		assert.strictEqual(await list.find(2), 'rope');
		assert.strictEqual(loads(), 2);
	});

	it('load again after a load fails', async () =>
	{
		let fail = true;
		const list = new CachedList(() =>
		{
			if (fail)
			{
				return(Promise.reject(new Error('Load failed')));
			}

			return(Promise.resolve(new Map([[1, 'dagger']])));
		});

		await assert.rejects(Promise.all([list.find(1), list.find(1)]), /Load failed/);
		fail = false;
		assert.strictEqual(await list.find(1), 'dagger');
	});
});
