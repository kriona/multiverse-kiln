import assert from 'assert';

import { DEFAULT_ITEM_NAMES, ITEM_KINDS, type EditorItem, type ItemListQuery, type ItemSettings } from '@multiverse-kiln/shared';

import { countCustomItems, createCustomItem, deleteCustomItem, findDefaultItemIds, findItemKind, listEditorItems, loadEditorItems, restoreDefaultItem, saveEditedDefaultItem, updateCustomItem, type CustomItemSettings } from '../../src/db/itemRepo.js';
import { addUniverse } from './fixtures.js';

const rustyDagger: ItemSettings = {
	name: 'rusty dagger',
	type: 'dagger',
	enabled: true
};

const torch: CustomItemSettings = {
	name: 'torch',
	type: 'torch',
	enabled: true
};

/**
 * The ID of the Pathfinder 1E default dagger
 *
 * @return Its ID
 */
async function daggerId(): Promise<number>
{
	const id = (await findDefaultItemIds('pf1e')).get('dagger');

	if (id === undefined)
	{
		throw new Error('The default dagger is missing from the test database');
	}

	return(id);
}

/**
 * An item's name as an English reader sees it: its own, or its default message's text
 *
 * @param item The item, as the editor lists it
 * @return The name
 */
function englishName(item: EditorItem): string | undefined
{
	return((item.name ?? ((item.key === null) ? undefined : DEFAULT_ITEM_NAMES.pf1e[item.key]?.defaultMessage)));
}

/**
 * The IDs of the items a filter lists
 *
 * @param universeId The universe's ID
 * @param query The filters
 * @return The items' IDs, in the order listed
 */
async function listedIds(universeId: string, query: ItemListQuery): Promise<number[]>
{
	return((await listEditorItems(universeId, 'pf1e', query)).items.map((item) => item.id));
}

describe('itemRepo', () =>
{
	describe('findDefaultItemIds', () =>
	{
		it('finds the Pathfinder 1E default items the migrations add', async () =>
		{
			assert.deepStrictEqual([...(await findDefaultItemIds('pf1e')).keys()], ['dagger']);
		});

		it('gives every default item a name message and a type of the ruleset', async () =>
		{
			const universeId = await addUniverse();

			for (const item of await loadEditorItems(universeId, 'pf1e'))
			{
				assert.ok(item.key && DEFAULT_ITEM_NAMES.pf1e[item.key], `${item.key} has no name message`);
				assert.ok(Object.hasOwn(ITEM_KINDS.pf1e.types, item.type), `${item.key} has an unknown type`);
			}
		});
	});

	describe('loadEditorItems', () =>
	{
		it('loads the default items and the universe\'s own, but no other universe\'s', async () =>
		{
			const universeId = await addUniverse('Mine');
			const otherId = await addUniverse('Theirs');

			await createCustomItem(universeId, 'pf1e', torch);
			await createCustomItem(otherId, 'pf1e', { ...torch, name: 'Lantern' });

			assert.deepStrictEqual((await loadEditorItems(universeId, 'pf1e')).map(englishName), ['dagger', 'torch']);
		});

		it('gives an edited default item the universe\'s settings under the default item\'s ID, for that universe only', async () =>
		{
			const universeId = await addUniverse('Mine');
			const otherId = await addUniverse('Theirs');
			const id = await daggerId();

			await saveEditedDefaultItem(universeId, 'pf1e', id, rustyDagger);

			const [mine] = await loadEditorItems(universeId, 'pf1e');
			const [theirs] = await loadEditorItems(otherId, 'pf1e');

			assert.deepStrictEqual(mine, { id, key: 'dagger', ...rustyDagger, custom: false, edited: true });
			assert.deepStrictEqual(theirs, { id, key: 'dagger', name: null, type: 'dagger', enabled: true, custom: false, edited: false });
		});
	});

	describe('listEditorItems', () =>
	{
		it('filters by name, enabled, custom, edited, category and type, and pages', async () =>
		{
			const universeId = await addUniverse();
			const torchId = await createCustomItem(universeId, 'pf1e', torch);
			const swordId = await createCustomItem(universeId, 'pf1e', { name: 'Old Sword', type: 'longsword', enabled: false });

			await saveEditedDefaultItem(universeId, 'pf1e', await daggerId(), { name: null, type: 'dagger', enabled: false });

			// A default item that kept its name matches by its English name
			assert.deepStrictEqual(await listedIds(universeId, { name: 'DAG' }), [await daggerId()]);
			assert.deepStrictEqual(await listedIds(universeId, { enabled: true }), [torchId]);
			assert.deepStrictEqual(await listedIds(universeId, { custom: true }), [torchId, swordId]);
			assert.deepStrictEqual(await listedIds(universeId, { edited: true }), [await daggerId()]);
			assert.deepStrictEqual(await listedIds(universeId, { category: 'weapon' }), [await daggerId(), swordId]);
			assert.deepStrictEqual(await listedIds(universeId, { type: 'torch' }), [torchId]);
			assert.deepStrictEqual(await listedIds(universeId, { category: 'armor' }), []);

			const page = await listEditorItems(universeId, 'pf1e', { offset: 1, limit: 1 });

			assert.strictEqual(page.total, 3);
			assert.deepStrictEqual(page.items.map((item) => item.id), [torchId]);
		});
	});

	describe('findItemKind', () =>
	{
		it('tells default items from the universe\'s own, and knows nothing of other items', async () =>
		{
			const universeId = await addUniverse('Mine');
			const otherId = await addUniverse('Theirs');
			const torchId = await createCustomItem(universeId, 'pf1e', torch);
			const theirsId = await createCustomItem(otherId, 'pf1e', torch);

			assert.strictEqual(await findItemKind(universeId, 'pf1e', await daggerId()), 'default');
			assert.strictEqual(await findItemKind(universeId, 'pf1e', torchId), 'custom');
			assert.strictEqual(await findItemKind(universeId, 'pf1e', theirsId), undefined);
			assert.strictEqual(await findItemKind(universeId, 'pf1e', 2147483647), undefined);
		});
	});

	describe('changing items', () =>
	{
		it('counts, updates and deletes the universe\'s own items', async () =>
		{
			const universeId = await addUniverse();
			const torchId = await createCustomItem(universeId, 'pf1e', torch);

			await saveEditedDefaultItem(universeId, 'pf1e', await daggerId(), rustyDagger);
			assert.strictEqual(await countCustomItems(universeId), 1);

			await updateCustomItem(universeId, torchId, { ...torch, name: 'everburning torch' });
			assert.deepStrictEqual((await loadEditorItems(universeId, 'pf1e')).map(englishName), ['rusty dagger', 'everburning torch']);

			await deleteCustomItem(universeId, torchId);
			assert.strictEqual(await countCustomItems(universeId), 0);
		});

		it('replaces an edited copy when saved again, and restores the default', async () =>
		{
			const universeId = await addUniverse();
			const id = await daggerId();

			await saveEditedDefaultItem(universeId, 'pf1e', id, rustyDagger);
			await saveEditedDefaultItem(universeId, 'pf1e', id, { ...rustyDagger, enabled: false });
			assert.strictEqual((await loadEditorItems(universeId, 'pf1e'))[0].enabled, false);

			await restoreDefaultItem(universeId, id);
			assert.deepStrictEqual((await loadEditorItems(universeId, 'pf1e'))[0], { id, key: 'dagger', name: null, type: 'dagger', enabled: true, custom: false, edited: false });
		});
	});
});
