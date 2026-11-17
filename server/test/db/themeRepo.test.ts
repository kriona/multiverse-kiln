import assert from 'assert';

import { createCustomTheme, findEditorTheme, loadEditorThemes, loadLiveThemeNames, restoreDefaultTheme, saveEditedDefaultTheme, updateCustomTheme, type CustomThemeSettings } from '../../src/db/themeRepo.js';
import { inTransaction } from '../../src/db/transactions.js';
import { startDraft } from '../../src/db/universeDraftRepo.js';
import { createUniverse } from '../../src/db/universeRepo.js';
import { draftVersion, liveVersion } from '../../src/db/universeVersions.js';
import { addUniverse } from './fixtures.js';

const smuggler: CustomThemeSettings = {
	name: 'Smuggler',
	description: null,
	enabled: true,
	rules: {
		ability: 'dexterity'
	}
};

describe('themeRepo', () =>
{
	it('finds one theme as it lists them', async () =>
	{
		const universeId = await createUniverse({
			name: 'Edited',
			ruleset: 'sf1e'
		});
		const otherId = await createUniverse({
			name: 'Other',
			ruleset: 'sf1e'
		});
		const mercenary = (await loadEditorThemes(liveVersion(universeId), 'sf1e')).find((theme) => (theme.key === 'mercenary'));

		assert.ok(mercenary);

		const otherSmugglerId = await inTransaction((transaction) => createCustomTheme(liveVersion(otherId), 'sf1e', smuggler, transaction));

		await inTransaction((transaction) => createCustomTheme(liveVersion(universeId), 'sf1e', smuggler, transaction));
		await inTransaction((transaction) => saveEditedDefaultTheme(liveVersion(universeId), 'sf1e', mercenary.id, { ...mercenary, enabled: false, rules: { ability: 'wisdom' } }, transaction));
		await inTransaction((transaction) => startDraft(universeId, transaction));
		await inTransaction((transaction) => saveEditedDefaultTheme(draftVersion(universeId), 'sf1e', mercenary.id, { ...mercenary, name: 'Draft Sword' }, transaction));

		for (const version of [liveVersion(universeId), draftVersion(universeId)])
		{
			for (const theme of await loadEditorThemes(version, 'sf1e'))
			{
				assert.deepStrictEqual(await findEditorTheme(version, 'sf1e', theme.id), theme);
			}
		}

		assert.strictEqual((await findEditorTheme(liveVersion(universeId), 'sf1e', mercenary.id))?.enabled, false);
		assert.strictEqual((await findEditorTheme(draftVersion(universeId), 'sf1e', mercenary.id))?.name, 'Draft Sword');
		assert.strictEqual(await findEditorTheme(liveVersion(universeId), 'sf1e', otherSmugglerId), undefined);
		assert.strictEqual(await findEditorTheme(liveVersion(universeId), 'pf1e', mercenary.id), undefined);
	});

	it('names the themes of several universes\' live versions at once, as the editor lists them', async () =>
	{
		const editedId = await createUniverse({
			name: 'Edited',
			ruleset: 'sf1e'
		});
		const plainId = await createUniverse({
			name: 'Plain',
			ruleset: 'sf1e'
		});
		const pathfinderId = await addUniverse('Pathfinder');
		const mercenary = (await loadEditorThemes(liveVersion(editedId), 'sf1e')).find((theme) => (theme.key === 'mercenary'));

		assert.ok(mercenary);

		const smugglerId = await inTransaction((transaction) => createCustomTheme(liveVersion(editedId), 'sf1e', smuggler, transaction));

		await inTransaction((transaction) => saveEditedDefaultTheme(liveVersion(editedId), 'sf1e', mercenary.id, { ...mercenary, name: 'Sellsword' }, transaction));
		await inTransaction((transaction) => startDraft(editedId, transaction));
		await inTransaction((transaction) => saveEditedDefaultTheme(draftVersion(editedId), 'sf1e', mercenary.id, { ...mercenary, name: 'Draft Sword' }, transaction));

		const universes = [
			{ id: editedId, ruleset: 'sf1e' as const },
			{ id: plainId, ruleset: 'sf1e' as const },
			{ id: pathfinderId, ruleset: 'pf1e' as const }
		];
		const names = await loadLiveThemeNames(universes);

		for (const { id, ruleset } of universes)
		{
			assert.deepStrictEqual(names.get(id), new Map((await loadEditorThemes(liveVersion(id), ruleset)).map((theme) => [theme.id, {
				key: theme.key,
				name: theme.name
			}])));
		}

		assert.deepStrictEqual(names.get(editedId)?.get(mercenary.id), { key: 'mercenary', name: 'Sellsword' });
		assert.deepStrictEqual(names.get(editedId)?.get(smugglerId), { key: null, name: 'Smuggler' });
		assert.deepStrictEqual(names.get(plainId)?.get(mercenary.id), { key: 'mercenary', name: null });
		assert.strictEqual(names.get(plainId)?.has(smugglerId), false);
		assert.strictEqual(names.get(pathfinderId)?.size, 0);
		assert.deepStrictEqual(await loadLiveThemeNames([]), new Map());
	});

	it('saves and loads a universe\'s own theme\'s description', async () =>
	{
		const universeId = await createUniverse({
			name: 'Described',
			ruleset: 'sf1e'
		});
		const themeId = await inTransaction((transaction) => createCustomTheme(liveVersion(universeId), 'sf1e', { ...smuggler, description: 'Runs cargo past the customs patrols.' }, transaction));

		assert.strictEqual((await findEditorTheme(liveVersion(universeId), 'sf1e', themeId))?.description, 'Runs cargo past the customs patrols.');

		await inTransaction((transaction) => updateCustomTheme(liveVersion(universeId), themeId, { ...smuggler, description: 'Knows every hidden compartment.' }, transaction));
		assert.strictEqual((await findEditorTheme(liveVersion(universeId), 'sf1e', themeId))?.description, 'Knows every hidden compartment.');

		await inTransaction((transaction) => updateCustomTheme(liveVersion(universeId), themeId, smuggler, transaction));
		assert.strictEqual((await findEditorTheme(liveVersion(universeId), 'sf1e', themeId))?.description, null);
	});

	it('keeps a default theme\'s description, gives it the universe\'s, and restores it', async () =>
	{
		const universeId = await createUniverse({
			name: 'Described',
			ruleset: 'sf1e'
		});
		const version = liveVersion(universeId);
		const original = (await loadEditorThemes(version, 'sf1e')).find((theme) => (theme.key === 'scholar'));

		assert.ok(original);
		assert.strictEqual(original.description, null);

		await inTransaction((transaction) => saveEditedDefaultTheme(version, 'sf1e', original.id, { ...original, enabled: false }, transaction));
		assert.deepStrictEqual(await findEditorTheme(version, 'sf1e', original.id), { ...original, enabled: false, edited: true, editedSettings: false });

		await inTransaction((transaction) => saveEditedDefaultTheme(version, 'sf1e', original.id, { ...original, description: 'Reads everything twice.' }, transaction));
		assert.deepStrictEqual(await findEditorTheme(version, 'sf1e', original.id), { ...original, description: 'Reads everything twice.', edited: true, editedSettings: true });

		await restoreDefaultTheme(version, original.id);
		assert.deepStrictEqual(await findEditorTheme(version, 'sf1e', original.id), original);
	});

	it('counts a default theme renamed to its own name as edited only by whether it is enabled', async () =>
	{
		const universeId = await createUniverse({
			name: 'Renamed',
			ruleset: 'sf1e'
		});
		const version = liveVersion(universeId);
		const original = (await loadEditorThemes(version, 'sf1e')).find((theme) => (theme.key === 'scholar'));

		assert.ok(original);

		await inTransaction((transaction) => saveEditedDefaultTheme(version, 'sf1e', original.id, { ...original, name: 'Scholar', enabled: false }, transaction));
		assert.strictEqual((await findEditorTheme(version, 'sf1e', original.id))?.editedSettings, false);

		await inTransaction((transaction) => saveEditedDefaultTheme(version, 'sf1e', original.id, { ...original, name: 'Bookworm' }, transaction));
		assert.strictEqual((await findEditorTheme(version, 'sf1e', original.id))?.editedSettings, true);
	});
});
