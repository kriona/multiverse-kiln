import assert from 'assert';

import { createCustomItem, deleteCustomItem, findDefaultItemIds } from '../../src/db/itemRepo.js';
import { addDefaultStartingItems, isStartingItem, loadStartingItems, replaceStartingItems } from '../../src/db/startingItemRepo.js';
import { inTransaction } from '../../src/db/transactions.js';
import { deleteUniverse } from '../../src/db/universeRepo.js';
import { liveVersion } from '../../src/db/universeVersions.js';
import { addUniverse } from './fixtures.js';

describe('startingItemRepo', () =>
{
	it('gives a universe its ruleset\'s default starting equipment', async () =>
	{
		const universeId = await addUniverse();
		const daggerId = (await findDefaultItemIds('pf1e')).get('dagger');

		assert.deepStrictEqual(await loadStartingItems(liveVersion(universeId)), []);

		await inTransaction((transaction) => addDefaultStartingItems(universeId, 'pf1e', transaction));

		assert.deepStrictEqual(await loadStartingItems(liveVersion(universeId)), [{ itemId: daggerId, quantity: 1 }]);
	});

	it('replaces a universe\'s starting equipment, leaving other universes\' alone', async () =>
	{
		const universeId = await addUniverse('Mine');
		const otherId = await addUniverse('Theirs');
		const torchId = await createCustomItem(liveVersion(universeId), 'pf1e', { name: 'torch', type: 'torch', enabled: true });
		const daggerId = (await findDefaultItemIds('pf1e')).get('dagger') as number;

		await inTransaction(async (transaction) =>
		{
			await addDefaultStartingItems(universeId, 'pf1e', transaction);
			await addDefaultStartingItems(otherId, 'pf1e', transaction);
			await replaceStartingItems(liveVersion(universeId), [{ itemId: torchId, quantity: 20 }], transaction);
		});

		assert.deepStrictEqual(await loadStartingItems(liveVersion(universeId)), [{ itemId: torchId, quantity: 20 }]);
		assert.deepStrictEqual(await loadStartingItems(liveVersion(otherId)), [{ itemId: daggerId, quantity: 1 }]);
		assert.strictEqual(await isStartingItem(liveVersion(universeId), torchId), true);
		assert.strictEqual(await isStartingItem(liveVersion(universeId), daggerId), false);
	});

	it('loses an item when it is deleted, and everything when the universe is', async () =>
	{
		const universeId = await addUniverse();
		const torchId = await createCustomItem(liveVersion(universeId), 'pf1e', { name: 'torch', type: 'torch', enabled: true });

		await inTransaction((transaction) => replaceStartingItems(liveVersion(universeId), [{ itemId: torchId, quantity: 2 }], transaction));
		await deleteCustomItem(liveVersion(universeId), torchId);
		assert.deepStrictEqual(await loadStartingItems(liveVersion(universeId)), []);

		await inTransaction((transaction) => addDefaultStartingItems(universeId, 'pf1e', transaction));
		await deleteUniverse(universeId);
		assert.deepStrictEqual(await loadStartingItems(liveVersion(universeId)), []);
	});
});
