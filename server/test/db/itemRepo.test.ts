import assert from 'assert';

import { DEFAULT_ITEM_KINDS, DEFAULT_ITEM_NAMES, isItemKind, PF1E_DEFAULT_ITEM_NAMES, PF1E_ITEM_RULEBOOKS, type EditorItem, type ItemListQuery, type ItemSettings } from '@multiverse-kiln/shared';

import { countCustomItems, createCustomItem, deleteCustomItem, findDefaultItemIds, findItem, listEditorItems, loadEditorItems, loadEditorItemsIn, loadLiveItemNames, restoreDefaultItem, saveEditedDefaultItem, updateCustomItem, type CustomItemSettings } from '../../src/db/itemRepo.js';
import { liveVersion } from '../../src/db/universeVersions.js';
import { addUniverse } from './fixtures.js';

const rustyDagger: ItemSettings = {
	name: 'rusty dagger',
	category: 'weapon',
	types: ['blades_light', 'thrown'],
	enabled: true
};

const torch: CustomItemSettings = {
	name: 'torch',
	category: 'gear',
	types: ['torch'],
	enabled: true
};

/**
 * The default dagger's category and types
 */
const daggerKind = {
	category: 'weapon',
	types: ['blades_light', 'thrown']
};

/**
 * A longsword's category and types
 */
const longswordKind = {
	category: 'weapon',
	types: ['blades_heavy']
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
 * The IDs of the items a filter lists, of the core rulebook and the universe's own unless the filter
 * names other books, as the editor of a universe with only the core rulebook asks for them
 *
 * @param universeId The universe's ID
 * @param query The filters
 * @return The items' IDs, in the order listed
 */
async function listedIds(universeId: string, query: ItemListQuery): Promise<number[]>
{
	return((await listEditorItems(liveVersion(universeId), 'pf1e', { rulebooks: [], ...query })).items.map((item) => item.id));
}

/**
 * The items of the core rulebook and the universe's own, leaving out those of the optional books
 *
 * @param items The items
 * @return Those items
 */
function coreAndOwn(items: readonly EditorItem[]): EditorItem[]
{
	return(items.filter((item) => ((item.rulebook === null) || (item.rulebook === 'core'))));
}

describe('itemRepo', () =>
{
	describe('findDefaultItemIds', () =>
	{
		it('finds the Pathfinder 1E default items the migrations add', async () =>
		{
			assert.deepStrictEqual([...(await findDefaultItemIds('pf1e')).keys()].sort(), Object.keys(PF1E_DEFAULT_ITEM_NAMES).sort());
		});

		it('gives every Pathfinder 1E default item a name message, its category and types, and its book', async () =>
		{
			const universeId = await addUniverse();

			for (const item of await loadEditorItems(liveVersion(universeId), 'pf1e'))
			{
				const key = item.key as keyof typeof PF1E_ITEM_RULEBOOKS;

				assert.ok(item.key && DEFAULT_ITEM_NAMES.pf1e[item.key], `${item.key} has no name message`);
				assert.ok(isItemKind('pf1e', item), `${item.key} has an unknown category or type`);
				assert.deepStrictEqual({ category: item.category, types: item.types }, { ...DEFAULT_ITEM_KINDS.pf1e[key], types: [...DEFAULT_ITEM_KINDS.pf1e[key].types] }, `${item.key} has another category or types than DEFAULT_ITEM_KINDS`);
				assert.strictEqual(item.rulebook, PF1E_ITEM_RULEBOOKS[key], `${item.key} has another book than PF1E_ITEM_RULEBOOKS`);
			}
		});

		it('gives every Starfinder 1E default item a name message and its category and types', async () =>
		{
			const universeId = await addUniverse();
			const found = await loadEditorItems(liveVersion(universeId), 'sf1e');

			assert.deepStrictEqual(found.map((item) => item.key).sort(), Object.keys(DEFAULT_ITEM_NAMES.sf1e).sort());

			for (const item of found)
			{
				const key = item.key as string;

				assert.ok(DEFAULT_ITEM_NAMES.sf1e[key], `${key} has no name message`);
				assert.ok(isItemKind('sf1e', item), `${key} has an unknown category or type`);
				assert.deepStrictEqual({ category: item.category, types: item.types }, { ...DEFAULT_ITEM_KINDS.sf1e[key], types: [...DEFAULT_ITEM_KINDS.sf1e[key].types] }, `${key} has another category or types than DEFAULT_ITEM_KINDS`);
			}
		});
	});

	describe('loadEditorItems', () =>
	{
		it('loads the default items and the universe\'s own, but no other universe\'s', async () =>
		{
			const universeId = await addUniverse('Mine');
			const otherId = await addUniverse('Theirs');

			await createCustomItem(liveVersion(universeId), 'pf1e', torch);
			await createCustomItem(liveVersion(otherId), 'pf1e', { ...torch, name: 'Lantern' });

			assert.deepStrictEqual(coreAndOwn(await loadEditorItems(liveVersion(universeId), 'pf1e')).map(englishName), ['dagger', 'torch']);
		});

		it('gives an edited default item the universe\'s settings under the default item\'s ID, for that universe only', async () =>
		{
			const universeId = await addUniverse('Mine');
			const otherId = await addUniverse('Theirs');
			const id = await daggerId();

			await saveEditedDefaultItem(liveVersion(universeId), 'pf1e', id, rustyDagger);

			const [mine] = await loadEditorItems(liveVersion(universeId), 'pf1e');
			const [theirs] = await loadEditorItems(liveVersion(otherId), 'pf1e');

			assert.deepStrictEqual(mine, { id, key: 'dagger', ...rustyDagger, rulebook: 'core', custom: false, edited: true, editedSettings: true });
			assert.deepStrictEqual(theirs, { id, key: 'dagger', name: null, ...daggerKind, enabled: true, rulebook: 'core', custom: false, edited: false, editedSettings: false });
		});
	});

	describe('loadEditorItemsIn', () =>
	{
		it('loads only the items asked for, as loadEditorItems() gives them', async () =>
		{
			const universeId = await addUniverse('Mine');
			const otherId = await addUniverse('Theirs');
			const id = await daggerId();
			const torchId = await createCustomItem(liveVersion(universeId), 'pf1e', torch);
			const theirsId = await createCustomItem(liveVersion(otherId), 'pf1e', { ...torch, name: 'Lantern' });

			await createCustomItem(liveVersion(universeId), 'pf1e', { ...torch, name: 'Rope' });
			await saveEditedDefaultItem(liveVersion(universeId), 'pf1e', id, rustyDagger);

			const all = await loadEditorItems(liveVersion(universeId), 'pf1e');

			assert.deepStrictEqual(await loadEditorItemsIn(liveVersion(universeId), 'pf1e', [torchId, id, theirsId, id]), all.filter((item) => [id, torchId].includes(item.id)));
			assert.deepStrictEqual((await loadEditorItemsIn(liveVersion(otherId), 'pf1e', [id]))[0].name, null);
			assert.deepStrictEqual(await loadEditorItemsIn(liveVersion(universeId), 'pf1e', []), []);
		});
	});

	describe('loadLiveItemNames', () =>
	{
		it('names only the items asked for, as each universe\'s live version calls them', async () =>
		{
			const editedId = await addUniverse('Edited');
			const plainId = await addUniverse('Plain');
			const id = await daggerId();
			const torchId = await createCustomItem(liveVersion(editedId), 'pf1e', torch);
			const lanternId = await createCustomItem(liveVersion(editedId), 'pf1e', { ...torch, name: 'Lantern' });

			await saveEditedDefaultItem(liveVersion(editedId), 'pf1e', id, rustyDagger);

			const names = await loadLiveItemNames([
				{ id: editedId, ruleset: 'pf1e' },
				{ id: plainId, ruleset: 'pf1e' }
			], [id, torchId, id]);

			assert.deepStrictEqual(names.get(editedId), new Map([
				[id, { key: 'dagger', name: 'rusty dagger' }],
				[torchId, { key: null, name: 'torch' }]
			]));
			assert.strictEqual(names.get(editedId)?.has(lanternId), false);
			assert.deepStrictEqual(names.get(plainId), new Map([[id, { key: 'dagger', name: null }]]));
			assert.deepStrictEqual(await loadLiveItemNames([{ id: plainId, ruleset: 'pf1e' }], []), new Map([[plainId, new Map()]]));
		});
	});

	describe('listEditorItems', () =>
	{
		it('filters by name, enabled, custom, edited, category and type, and pages', async () =>
		{
			const universeId = await addUniverse();
			const torchId = await createCustomItem(liveVersion(universeId), 'pf1e', torch);
			const swordId = await createCustomItem(liveVersion(universeId), 'pf1e', { name: 'Old Sword', ...longswordKind, enabled: false });

			await saveEditedDefaultItem(liveVersion(universeId), 'pf1e', await daggerId(), { name: null, ...daggerKind, enabled: false });

			// A default item that kept its name matches by its English name
			assert.deepStrictEqual(await listedIds(universeId, { name: 'DAG' }), [await daggerId()]);
			assert.deepStrictEqual(await listedIds(universeId, { enabled: true }), [torchId]);
			assert.deepStrictEqual(await listedIds(universeId, { custom: true }), [torchId, swordId]);

			// Disabling a default item alone isn't an edit; renaming it is
			assert.deepStrictEqual(await listedIds(universeId, { edited: true }), []);
			await saveEditedDefaultItem(liveVersion(universeId), 'pf1e', await daggerId(), { name: 'rusty dagger', ...daggerKind, enabled: false });
			assert.deepStrictEqual(await listedIds(universeId, { edited: true }), [await daggerId()]);
			assert.deepStrictEqual(await listedIds(universeId, { category: 'weapon' }), [await daggerId(), swordId]);
			assert.deepStrictEqual(await listedIds(universeId, { type: 'torch' }), [torchId]);

			// An item of several types matches each of them
			assert.deepStrictEqual(await listedIds(universeId, { type: 'thrown' }), [await daggerId()]);
			assert.deepStrictEqual(await listedIds(universeId, { type: 'blades_light' }), [await daggerId()]);
			assert.deepStrictEqual(await listedIds(universeId, { type: 'blades_heavy' }), [swordId]);
			assert.deepStrictEqual(await listedIds(universeId, { category: 'armor' }), []);

			const page = await listEditorItems(liveVersion(universeId), 'pf1e', { rulebooks: [], offset: 1, limit: 1 });

			assert.strictEqual(page.total, 3);
			assert.deepStrictEqual(page.items.map((item) => item.id), [torchId]);

			// Changing a default item's types alone is an edit
			await saveEditedDefaultItem(liveVersion(universeId), 'pf1e', await daggerId(), { name: null, category: 'weapon', types: ['blades_light'], enabled: false });
			assert.deepStrictEqual(await listedIds(universeId, { edited: true }), [await daggerId()]);
			assert.deepStrictEqual(await listedIds(universeId, { type: 'thrown' }), []);
		});

		it('lists the items of the core rulebook, the books asked for and the universe\'s own', async () =>
		{
			const universeId = await addUniverse();
			const torchId = await createCustomItem(liveVersion(universeId), 'pf1e', torch);
			const ids = await findDefaultItemIds('pf1e');
			const keysOf = async (rulebooks: string[] | undefined): Promise<(string | number)[]> => (await listEditorItems(liveVersion(universeId), 'pf1e', { rulebooks })).items.map((item) => (item.key ?? item.id));

			assert.deepStrictEqual(await keysOf([]), ['dagger', torchId]);
			assert.deepStrictEqual(await keysOf(['apg']), ['dagger', 'cestus', 'sword_cane', 'wooden_armor', 'quilted_cloth', torchId]);
			assert.strictEqual((await keysOf(undefined)).length, (ids.size + 1));
		});

		it('sorts by name, enabled or notes before paging, breaking ties by name', async () =>
		{
			const universeId = await addUniverse();
			const torchId = await createCustomItem(liveVersion(universeId), 'pf1e', torch);
			const swordId = await createCustomItem(liveVersion(universeId), 'pf1e', { name: 'Old Sword', ...longswordKind, enabled: false });
			const axeId = await createCustomItem(liveVersion(universeId), 'pf1e', { name: 'axe', ...longswordKind, enabled: true });
			const dagger = await daggerId();

			await saveEditedDefaultItem(liveVersion(universeId), 'pf1e', dagger, { name: null, ...daggerKind, enabled: false });

			assert.deepStrictEqual(await listedIds(universeId, { sort: 'name' }), [axeId, dagger, swordId, torchId]);
			assert.deepStrictEqual(await listedIds(universeId, { sort: 'name', direction: 'descending' }), [torchId, swordId, dagger, axeId]);
			assert.deepStrictEqual(await listedIds(universeId, { sort: 'name', offset: 1, limit: 2 }), [dagger, swordId]);

			// Notes don't say an item is disabled, so the dagger, only disabled, has none, and custom items
			// with the same notes go by name
			assert.deepStrictEqual(await listedIds(universeId, { sort: 'notes' }), [dagger, axeId, swordId, torchId]);
			assert.deepStrictEqual(await listedIds(universeId, { sort: 'notes', direction: 'descending' }), [axeId, swordId, torchId, dagger]);

			// Enabled items first, each group by name
			assert.deepStrictEqual(await listedIds(universeId, { sort: 'enabled' }), [axeId, torchId, dagger, swordId]);
			assert.deepStrictEqual(await listedIds(universeId, { sort: 'enabled', direction: 'descending' }), [dagger, swordId, axeId, torchId]);
		});
	});

	describe('findItem', () =>
	{
		it('tells default items from the universe\'s own, and knows nothing of other items', async () =>
		{
			const universeId = await addUniverse('Mine');
			const otherId = await addUniverse('Theirs');
			const torchId = await createCustomItem(liveVersion(universeId), 'pf1e', torch);
			const theirsId = await createCustomItem(liveVersion(otherId), 'pf1e', torch);

			assert.deepStrictEqual(await findItem(liveVersion(universeId), 'pf1e', await daggerId()), { kind: 'default', enabled: true, rulebook: 'core' });
			assert.deepStrictEqual(await findItem(liveVersion(universeId), 'pf1e', torchId), { kind: 'custom', enabled: true, rulebook: null });
			assert.strictEqual(await findItem(liveVersion(universeId), 'pf1e', theirsId), undefined);
			assert.strictEqual(await findItem(liveVersion(universeId), 'pf1e', 2147483647), undefined);
		});

		it('finds whether the universe has an item enabled, from its own edited copy of a default item', async () =>
		{
			const universeId = await addUniverse('Mine');
			const otherId = await addUniverse('Theirs');
			const swordId = await createCustomItem(liveVersion(universeId), 'pf1e', { name: 'Old Sword', ...longswordKind, enabled: false });
			const dagger = await daggerId();

			await saveEditedDefaultItem(liveVersion(otherId), 'pf1e', dagger, { name: null, ...daggerKind, enabled: false });
			assert.deepStrictEqual(await findItem(liveVersion(universeId), 'pf1e', dagger), { kind: 'default', enabled: true, rulebook: 'core' });

			await saveEditedDefaultItem(liveVersion(universeId), 'pf1e', dagger, { name: null, ...daggerKind, enabled: false });
			assert.deepStrictEqual(await findItem(liveVersion(universeId), 'pf1e', dagger), { kind: 'default', enabled: false, rulebook: 'core' });
			assert.deepStrictEqual(await findItem(liveVersion(universeId), 'pf1e', swordId), { kind: 'custom', enabled: false, rulebook: null });
		});
	});

	describe('changing items', () =>
	{
		it('counts, updates and deletes the universe\'s own items', async () =>
		{
			const universeId = await addUniverse();
			const torchId = await createCustomItem(liveVersion(universeId), 'pf1e', torch);

			await saveEditedDefaultItem(liveVersion(universeId), 'pf1e', await daggerId(), rustyDagger);
			assert.strictEqual(await countCustomItems(liveVersion(universeId)), 1);

			await updateCustomItem(liveVersion(universeId), torchId, { ...torch, name: 'everburning torch' });
			assert.deepStrictEqual(coreAndOwn(await loadEditorItems(liveVersion(universeId), 'pf1e')).map(englishName), ['rusty dagger', 'everburning torch']);

			await deleteCustomItem(liveVersion(universeId), torchId);
			assert.strictEqual(await countCustomItems(liveVersion(universeId)), 0);
		});

		it('replaces an edited copy when saved again, and restores the default', async () =>
		{
			const universeId = await addUniverse();
			const id = await daggerId();

			await saveEditedDefaultItem(liveVersion(universeId), 'pf1e', id, rustyDagger);
			await saveEditedDefaultItem(liveVersion(universeId), 'pf1e', id, { ...rustyDagger, enabled: false });
			assert.strictEqual((await loadEditorItems(liveVersion(universeId), 'pf1e'))[0].enabled, false);

			await restoreDefaultItem(liveVersion(universeId), id);
			assert.deepStrictEqual((await loadEditorItems(liveVersion(universeId), 'pf1e'))[0], { id, key: 'dagger', name: null, ...daggerKind, enabled: true, rulebook: 'core', custom: false, edited: false, editedSettings: false });
		});
	});
});
