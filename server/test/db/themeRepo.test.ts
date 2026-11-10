import assert from 'assert';

import { createCustomTheme, findEditorTheme, loadEditorThemes, loadLiveThemeNames, saveEditedDefaultTheme, type CustomThemeSettings } from '../../src/db/themeRepo.js';
import { inTransaction } from '../../src/db/transactions.js';
import { startDraft } from '../../src/db/universeDraftRepo.js';
import { createUniverse } from '../../src/db/universeRepo.js';
import { draftVersion, liveVersion } from '../../src/db/universeVersions.js';
import { addUniverse } from './fixtures.js';

const smuggler: CustomThemeSettings = {
	name: 'Smuggler',
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
});
