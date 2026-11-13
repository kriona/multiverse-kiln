import assert from 'assert';
import { MAX_COIN_NAME_LENGTH, sourceTextHash, universeTextFileKey, type DifficultyLevelListPayload, type ItemListPayload, type RaceListPayload, type SaveChangesPayload, type TileListPayload, type UniverseTextListPayload, type UniverseTextRow } from '@multiverse-kiln/shared';

import { findDefaultItemIds } from '../src/db/itemRepo.js';
import { listUniverseEdits } from '../src/db/universeEditRepo.js';
import { setUniverseAccess, setUniverseRole } from '../src/db/universeEditorRepo.js';
import { listTranslations } from '../src/db/universeTextRepo.js';
import { liveVersion } from '../src/db/universeVersions.js';
import { hashSourceText } from '../src/http/editorTranslations.js';
import { UniverseTextTranslator } from '../src/http/universeTextTranslator.js';
import { createArea, createUniverse, logIn, saveAll, saveChanges, send, worldRegionId, type Editor } from './editorRequests.js';
import { getTestServer } from './testServer.js';

/**
 * Lists a universe's text with its translations, as the Translations tab asks for it
 *
 * @param editor The browser asking
 * @param universeId The universe's ID
 * @param query The query string, without its ?
 * @return The status and the page
 */
async function listText(editor: Editor, universeId: string, query: string): Promise<{ status: number; body: UniverseTextListPayload }>
{
	return(send<UniverseTextListPayload>(editor, 'GET', `/${universeId}/translations?${query}`));
}

/**
 * Where each row of a page comes from, as kind, name and field
 *
 * @param rows The rows
 * @return The places
 */
function placesOf(rows: readonly UniverseTextRow[]): string[]
{
	return(rows.map((row) => `${row.kind}:${row.thingName}:${row.field}`));
}

/**
 * A universe translated into French and German, with a meadow area, and its creator
 *
 * @return The universe's ID, the area's ID and the creator's browser
 */
async function translatableUniverse(): Promise<{ universeId: string; areaId: string; ada: Editor }>
{
	const ada = await logIn('Ada');
	const universeId = await createUniverse(ada, 'Kilnhaven');
	const areaId = await createArea(ada, universeId, { name: 'Meadow' });
	const saved = await saveChanges(ada, universeId, [{ kind: 'universe', update: { translationLanguages: ['fr', 'de'] } }]);

	assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));

	return({ universeId, areaId, ada });
}

describe('Translations tab', () =>
{
	before(async () =>
	{
		await getTestServer();
	});

	it('lists the universe\'s text by where it comes from, leaving out engine text and empty descriptions', async () =>
	{
		const { universeId, ada } = await translatableUniverse();
		const { status, body } = await listText(ada, universeId, 'language=fr');

		assert.strictEqual(status, 200);
		assert.deepStrictEqual(placesOf(body.rows), [
			'universe:Kilnhaven:name',
			'universe:Kilnhaven:shortDescription',
			'area:Lobby:name',
			'area:Meadow:name',
			'area:Starting Area:name'
		]);
		assert.deepStrictEqual(body.rows[0], {
			kind: 'universe',
			thingId: universeId,
			liveThingId: universeId,
			field: 'name',
			thingName: 'Kilnhaven',
			source: 'Kilnhaven',
			sourceHash: sourceTextHash('Kilnhaven'),
			note: null,
			noTranslation: false,
			translation: null,
			outOfDate: false
		});
		assert.strictEqual(body.total, 5);
	});

	it('lists the names the universe gives the ruleset\'s defaults by the default\'s ID, and the names of things it adds', async () =>
	{
		const { universeId, ada } = await translatableUniverse();
		const races = (await send<RaceListPayload>(ada, 'GET', `/${universeId}/races`)).body.races;
		const items = (await send<ItemListPayload>(ada, 'GET', `/${universeId}/items`)).body.items;
		const tiles = (await send<TileListPayload>(ada, 'GET', `/${universeId}/tiles`)).body.tiles;
		const dwarf = races.find((race) => (race.key === 'dwarf'))!;
		const elf = races.find((race) => (race.key === 'elf'))!;
		const dagger = items.find((item) => (item.key === 'dagger'))!;
		const grass = tiles.find((tile) => (tile.key === 'grass'))!;
		const saved = await saveChanges(ada, universeId, [
			{ kind: 'saveRace', id: dwarf.id, settings: { ...dwarf, name: 'Stout' } },
			{ kind: 'saveRace', id: elf.id, settings: { ...elf, enabled: false } },
			{ kind: 'saveItem', id: dagger.id, settings: { ...dagger, name: 'Shiv' } },
			{ kind: 'saveTile', id: grass.id, settings: { ...grass, walkSeconds: 9 } },
			{ kind: 'createItem', ref: 'new:torch', settings: { name: 'Torch', type: 'torch', enabled: true } }
		]);

		assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));

		const { body } = await listText(ada, universeId, 'language=fr');
		const torchId = (await send<ItemListPayload>(ada, 'GET', `/${universeId}/items`)).body.items.find((item) => (item.name === 'Torch'))!.id;

		// The elf and the grass are changed but keep the engine's names, which aren't universe text
		assert.deepStrictEqual(body.rows
			.filter((row) => ((row.kind === 'race') || (row.kind === 'item') || (row.kind === 'tile')))
			.map(({ kind, thingId, source }) => [kind, thingId, source]), [
			['item', String(dagger.id), 'Shiv'],
			['item', String(torchId), 'Torch'],
			['race', String(dwarf.id), 'Stout']
		]);
	});

	it('hashes source text on the server as the client does', () =>
	{
		for (const text of ['', 'Kilnhaven', 'Forêt', '森の小道', '🐉 Dragon\'s lair', 'x'.repeat(200)])
		{
			assert.strictEqual(hashSourceText(text), sourceTextHash(text), text);
		}
	});

	it('lists the coin names and abbreviations the universe gives, and deletes their translations when a coin goes back to the engine\'s', async () =>
	{
		const { universeId, ada } = await translatableUniverse();
		const goldName = { kind: 'coin', thingId: 'gp', field: 'name' };
		const goldAbbreviation = { kind: 'coin', thingId: 'gp', field: 'abbreviation' };

		/**
		 * The coins' text the Translations tab lists in French, with each translation
		 *
		 * @return Each piece's coin, field, source text and translation
		 */
		const coinRows = async (): Promise<(string | null)[][]> => (await listText(ada, universeId, 'language=fr')).body.rows
			.filter((row) => (row.kind === 'coin'))
			.map(({ thingId, field, source, translation }) => [thingId, field, source, translation]);

		for (const update of [{ coinAbbreviations: { gp: 'two words' } }, { coinAbbreviations: { gp: 'g2' } }, { coinAbbreviations: { cp: 'gp' } }, { coinAbbreviations: { gp: 'sp' } }, { coinAbbreviations: { cr: 'cr' } }, { coinNames: { cr: 'Crowns' } }, { coinNames: { gp: 'x'.repeat(MAX_COIN_NAME_LENGTH + 1) } }, { coinNames: { gp: ' ' } }])
		{
			const refused = await saveChanges(ada, universeId, [{ kind: 'universe', update }]);

			assert.strictEqual(refused.status, 400, JSON.stringify(update));
		}

		// Silver may be shown as "gp" once gold isn't
		const renamed = await saveChanges(ada, universeId, [{ kind: 'universe', update: { coinNames: { gp: ' Royal crowns ' }, coinAbbreviations: { gp: ' cr ', sp: 'gp' } } }]);

		assert.strictEqual(renamed.status, 200, JSON.stringify(renamed.body));
		assert.deepStrictEqual(await coinRows(), [['gp', 'name', 'Royal crowns', null], ['gp', 'abbreviation', 'cr', null], ['sp', 'abbreviation', 'gp', null]]);

		const badAbbreviation = await saveChanges(ada, universeId, [{ kind: 'saveTranslation', text: goldAbbreviation, language: 'fr', translation: 'deux mots', sourceHash: sourceTextHash('cr') }]);

		assert.strictEqual(badAbbreviation.status, 400);

		const translated = await saveChanges(ada, universeId, [
			{ kind: 'saveTranslation', text: goldName, language: 'fr', translation: 'Couronnes royales', sourceHash: sourceTextHash('Royal crowns') },
			{ kind: 'saveTranslation', text: goldAbbreviation, language: 'fr', translation: 'co', sourceHash: sourceTextHash('cr') }
		]);

		assert.strictEqual(translated.status, 200, JSON.stringify(translated.body));
		assert.deepStrictEqual((await coinRows()).slice(0, 2), [['gp', 'name', 'Royal crowns', 'Couronnes royales'], ['gp', 'abbreviation', 'cr', 'co']]);

		// Gold is shown as "gp" again, so silver can't be
		assert.strictEqual((await saveChanges(ada, universeId, [{ kind: 'universe', update: { coinAbbreviations: { sp: 'gp' } } }])).status, 400);
		assert.strictEqual((await saveChanges(ada, universeId, [{ kind: 'universe', update: { coinAbbreviations: { sp: 'sh' } } }])).status, 200);
		assert.deepStrictEqual(await coinRows(), [['gp', 'name', 'Royal crowns', 'Couronnes royales'], ['sp', 'abbreviation', 'sh', null]]);
		assert.strictEqual((await saveChanges(ada, universeId, [{ kind: 'saveTranslation', text: goldAbbreviation, language: 'fr', translation: 'co', sourceHash: sourceTextHash('cr') }])).status, 404);

		assert.strictEqual((await saveChanges(ada, universeId, [{ kind: 'universe', update: { coinNames: {}, coinAbbreviations: { gp: 'cr', sp: 'sh' } } }])).status, 200);
		assert.deepStrictEqual(await coinRows(), [['gp', 'abbreviation', 'cr', null], ['sp', 'abbreviation', 'sh', null]]);
	});

	it('saves translations and notes, marks a translation out of date when its source changes, and confirms it', async () =>
	{
		const { universeId, areaId, ada } = await translatableUniverse();
		const meadow = { kind: 'area', thingId: areaId, field: 'name' };
		const saved = await saveChanges(ada, universeId, [
			{ kind: 'saveTranslation', text: meadow, language: 'fr', translation: '  Prairie ', sourceHash: sourceTextHash('Meadow') },
			{ kind: 'saveTranslatorNote', text: meadow, note: 'A field of flowers' }
		]);

		assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));

		const rowOf = async (): Promise<UniverseTextRow | undefined> => (await listText(ada, universeId, 'language=fr&search=prairie')).body.rows[0];

		assert.deepStrictEqual([(await rowOf())?.translation, (await rowOf())?.note, (await rowOf())?.outOfDate], ['Prairie', 'A field of flowers', false]);

		await saveChanges(ada, universeId, [{ kind: 'updateArea', areaId, update: { name: 'Meadows' } }]);

		const outOfDate = await rowOf();

		assert.deepStrictEqual([outOfDate?.outOfDate, outOfDate?.sourceHash], [true, sourceTextHash('Meadows')]);
		assert.deepStrictEqual(placesOf((await listText(ada, universeId, 'language=fr&outOfDate=true')).body.rows), ['area:Meadows:name']);

		await saveChanges(ada, universeId, [{ kind: 'saveTranslation', text: meadow, language: 'fr', translation: 'Prairie', sourceHash: outOfDate?.sourceHash ?? '' }]);
		assert.strictEqual((await rowOf())?.outOfDate, false);

		await saveChanges(ada, universeId, [
			{ kind: 'saveTranslation', text: meadow, language: 'fr', translation: null, sourceHash: sourceTextHash('Meadows') },
			{ kind: 'saveTranslatorNote', text: meadow, note: '' }
		]);
		assert.deepStrictEqual((await listText(ada, universeId, 'language=fr&search=meadows')).body.rows.map(({ translation, note }) => [translation, note]), [[null, null]]);

		const [edit] = (await listUniverseEdits(universeId, { offset: 0, limit: 1 })).edits;

		assert.deepStrictEqual(edit.changeDetails?.map(({ subject, target, count }) => [subject, target?.name ?? null, count]), [
			['translations', 'fr', 1],
			['translatorNotes', null, 1]
		]);
	});

	it('writes a save\'s translations together, as its changes leave them in order', async () =>
	{
		const { universeId, areaId, ada } = await translatableUniverse();
		const forestId = await createArea(ada, universeId, { name: 'Forest' });
		const meadow = { kind: 'area', thingId: areaId, field: 'name' };
		const forest = { kind: 'area', thingId: forestId, field: 'name' };
		const meadowHash = sourceTextHash('Meadow');

		// The last change to a translation wins, and one deleting what text belongs to deletes its
		// translations, those the save added before it too
		const saved = await saveChanges(ada, universeId, [
			{ kind: 'saveTranslation', text: meadow, language: 'fr', translation: 'Pré', sourceHash: meadowHash },
			{ kind: 'saveTranslation', text: meadow, language: 'de', translation: 'Wiese', sourceHash: meadowHash },
			{ kind: 'saveTranslation', text: meadow, language: 'fr', translation: 'Prairie', sourceHash: meadowHash },
			{ kind: 'saveTranslation', text: meadow, language: 'de', translation: null, sourceHash: meadowHash },
			{ kind: 'saveTranslation', text: forest, language: 'fr', translation: 'Forêt', sourceHash: sourceTextHash('Forest') },
			{ kind: 'deleteArea', areaId: forestId }
		]);

		assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
		assert.deepStrictEqual((await listTranslations(liveVersion(universeId), ['fr', 'de'])).map(({ thingId, language, text }) => [thingId, language, text]), [[areaId, 'fr', 'Prairie']]);

		// A translation saved earlier in the same save is what a later change to it is merged with
		const again = await saveChanges(ada, universeId, [
			{ kind: 'saveTranslation', text: meadow, language: 'de', translation: 'Wiese', sourceHash: meadowHash, loaded: null },
			{ kind: 'saveTranslation', text: meadow, language: 'de', translation: 'Weide', sourceHash: meadowHash, loaded: 'Wiese' }
		]);

		assert.strictEqual(again.status, 200, JSON.stringify(again.body));
		assert.deepStrictEqual((await listTranslations(liveVersion(universeId), ['de'])).map(({ text }) => text), ['Weide']);
	});

	it('filters by missing translations, searches, sorts and pages on the server', async () =>
	{
		const { universeId, areaId, ada } = await translatableUniverse();

		await saveChanges(ada, universeId, [{ kind: 'saveTranslation', text: { kind: 'area', thingId: areaId, field: 'name' }, language: 'de', translation: 'Wiese', sourceHash: sourceTextHash('Meadow') }]);

		const missing = await listText(ada, universeId, 'language=de&missing=true');
		const sorted = await listText(ada, universeId, 'language=de&sort=translation&limit=2');
		const second = await listText(ada, universeId, 'language=de&offset=2&limit=2');

		assert.strictEqual(missing.body.total, 4);
		assert.ok(!placesOf(missing.body.rows).includes('area:Meadow:name'));
		assert.deepStrictEqual(placesOf((await listText(ada, universeId, 'language=de&search=wiese')).body.rows), ['area:Meadow:name']);
		assert.deepStrictEqual(sorted.body.rows.map(({ translation }) => translation), ['Wiese', null]);
		assert.deepStrictEqual([second.body.total, placesOf(second.body.rows)], [5, ['area:Lobby:name', 'area:Meadow:name']]);
	});

	it('lists every piece of text at once for translation files, to those who may see the language', async () =>
	{
		const { universeId, ada } = await translatableUniverse();
		const grace = await logIn('Grace');

		await setUniverseAccess(universeId, grace.playerId, { role: 'translator', languages: ['de'] });

		const all = await send<UniverseTextListPayload>(ada, 'GET', `/${universeId}/translations/all?language=fr`);

		assert.strictEqual(all.status, 200);
		assert.deepStrictEqual([all.body.total, placesOf(all.body.rows)], [5, placesOf((await listText(ada, universeId, 'language=fr')).body.rows)]);
		assert.strictEqual((await send(grace, 'GET', `/${universeId}/translations/all?language=fr`)).status, 403);
		assert.strictEqual((await send(ada, 'GET', `/${universeId}/translations/all?language=es`)).status, 404);
	});

	it('names text in translation files by its live IDs, the same in the draft and once the draft is applied', async () =>
	{
		const { universeId, areaId, ada } = await translatableUniverse();

		/**
		 * Every piece of one version's text, as translation files list it
		 *
		 * @param version The version
		 * @return The rows
		 */
		const allText = async (version: 'live' | 'draft'): Promise<UniverseTextRow[]> =>
		{
			const answer = await send<UniverseTextListPayload>(ada, 'GET', `/${universeId}/translations/all?language=fr&version=${version}`);

			assert.strictEqual(answer.status, 200, JSON.stringify(answer.body));

			return(answer.body.rows);
		};

		await saveAll(ada, universeId, [{ kind: 'startDraft' }]);

		const added = await send<SaveChangesPayload>(ada, 'POST', `/${universeId}/changes?version=draft`, { body: { changes: [{ kind: 'createArea', ref: 'new:area', area: { name: 'Cave', parents: [{ kind: 'region', id: await worldRegionId(ada, universeId, 'draft') }] } }] } });

		assert.strictEqual(added.status, 200, JSON.stringify(added.body));

		const caveId = added.body.ids['new:area'];
		const draft = await allText('draft');
		const meadow = draft.find((row) => (row.thingName === 'Meadow'))!;
		const cave = draft.find((row) => (row.thingName === 'Cave'))!;

		// The draft's copy of the meadow has an ID of its own, and the cave keeps its ID when applied
		assert.notStrictEqual(meadow.thingId, areaId);
		assert.deepStrictEqual([meadow.liveThingId, cave.thingId, cave.liveThingId], [areaId, caveId, caveId]);
		assert.deepStrictEqual((await allText('live')).map(universeTextFileKey), draft
			.filter((row) => (row !== cave))
			.map(universeTextFileKey));

		await saveAll(ada, universeId, [{ kind: 'applyDraft', choices: { races: {}, classes: {}, items: {}, areas: {} } }]);

		const live = await allText('live');

		assert.deepStrictEqual(live.map(universeTextFileKey), draft.map(universeTextFileKey));
		assert.ok(live.every((row) => (row.thingId === row.liveThingId)));
	});

	it('names a default difficulty level the universe renames by its own live level, in the live version and the draft', async () =>
	{
		const { universeId, ada } = await translatableUniverse();
		const other = await createUniverse(ada, 'Other');

		/**
		 * Renames a universe's hard level
		 *
		 * @param id The universe's ID
		 * @param name The name to give it
		 * @return The level's ID, as text rows name it
		 */
		const renameHard = async (id: string, name: string): Promise<string> =>
		{
			const levels = (await send<DifficultyLevelListPayload>(ada, 'GET', `/${id}/difficulty-levels`)).body.difficultyLevels;
			const hard = levels.find((level) => (level.key === 'hard'))!;
			const saved = await saveChanges(ada, id, [{ kind: 'saveDifficultyLevel', id: hard.id, settings: { ...hard, name } }]);

			assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));

			return(String(hard.id));
		};

		const hardId = await renameHard(universeId, 'Brutal');

		// Another universe's level with the same key isn't the one this universe's level is written into
		await renameHard(other, 'Grim');

		const page = await listText(ada, universeId, 'language=fr');

		assert.strictEqual(page.status, 200, JSON.stringify(page.body));

		const live = page.body.rows.find((row) => (row.thingName === 'Brutal'))!;

		assert.deepStrictEqual([live.kind, live.thingId, live.liveThingId], ['difficultyLevel', hardId, hardId]);

		await saveAll(ada, universeId, [{ kind: 'startDraft' }]);

		const draft = await send<UniverseTextListPayload>(ada, 'GET', `/${universeId}/translations/all?language=fr&version=draft`);

		assert.strictEqual(draft.status, 200, JSON.stringify(draft.body));
		assert.strictEqual(draft.body.rows.find((row) => (row.thingName === 'Brutal'))?.liveThingId, hardId);
	});

	it('lets translators see and translate only their languages, and builders only write notes', async () =>
	{
		const { universeId, areaId, ada } = await translatableUniverse();
		const grace = await logIn('Grace');
		const bob = await logIn('Bob');
		const tess = await logIn('Tess');
		const meadow = { kind: 'area', thingId: areaId, field: 'name' };

		await setUniverseAccess(universeId, grace.playerId, { role: 'translator', languages: ['de'] });
		await setUniverseRole(universeId, bob.playerId, 'builder');
		await setUniverseRole(universeId, tess.playerId, 'beta_tester');

		assert.strictEqual((await listText(grace, universeId, 'language=de')).status, 200);
		assert.strictEqual((await listText(grace, universeId, 'language=fr')).status, 403);
		assert.strictEqual((await listText(bob, universeId, 'language=fr')).status, 200);
		assert.strictEqual((await listText(tess, universeId, 'language=fr')).status, 403);
		assert.strictEqual((await listText(ada, universeId, 'language=es')).status, 404);

		const translate = (editor: Editor, language: string): Promise<number> => saveChanges(editor, universeId, [{ kind: 'saveTranslation', text: meadow, language, translation: 'Wiese', sourceHash: sourceTextHash('Meadow') }]).then((answer) => answer.status);
		const note = (editor: Editor): Promise<number> => saveChanges(editor, universeId, [{ kind: 'saveTranslatorNote', text: meadow, note: 'Flowers' }]).then((answer) => answer.status);

		assert.deepStrictEqual([await translate(grace, 'de'), await translate(grace, 'fr'), await translate(bob, 'de')], [200, 403, 403]);
		assert.deepStrictEqual([await note(bob), await note(grace)], [200, 403]);
	});

	it('lets translators and builders mark text as needing no translation, which players then see as written', async () =>
	{
		const { universeId, ada } = await translatableUniverse();
		const grace = await logIn('Grace');
		const bob = await logIn('Bob');
		const tess = await logIn('Tess');
		const name = { kind: 'universe', thingId: universeId, field: 'name' };
		const mark = (editor: Editor, noTranslation: boolean): Promise<number> => saveChanges(editor, universeId, [{ kind: 'saveNoTranslation', text: name, noTranslation }]).then((answer) => answer.status);

		await setUniverseAccess(universeId, grace.playerId, { role: 'translator', languages: ['de'] });
		await setUniverseRole(universeId, bob.playerId, 'builder');
		await setUniverseRole(universeId, tess.playerId, 'beta_tester');
		await saveChanges(ada, universeId, [{ kind: 'saveTranslation', text: name, language: 'fr', translation: 'Fourneauville', sourceHash: sourceTextHash('Kilnhaven') }]);

		assert.deepStrictEqual([await mark(tess, true), await mark(bob, true), await mark(grace, false), await mark(grace, true)], [403, 200, 200, 200]);

		const row = (await listText(ada, universeId, 'language=fr&search=kilnhaven')).body.rows.find((each) => (each.field === 'name'));
		const missing = await listText(ada, universeId, 'language=de&missing=true');
		const shown = await UniverseTextTranslator.load({ id: universeId, sourceLanguage: 'en', translationLanguages: ['fr', 'de'] }, ['fr']);

		assert.deepStrictEqual([row?.noTranslation, row?.translation], [true, 'Fourneauville']);
		assert.ok(!placesOf(missing.body.rows).includes('universe:Kilnhaven:name'));
		assert.strictEqual(shown.text('universe', universeId, 'name', 'Kilnhaven'), 'Kilnhaven');

		const [edit] = (await listUniverseEdits(universeId, { offset: 0, limit: 1 })).edits;

		assert.deepStrictEqual(edit.changeDetails?.map(({ subject, action, count }) => [subject, action, count]), [['noTranslation', 'added', 1]]);
	});

	it('refuses text the universe doesn\'t have, a language it isn\'t translated into, and a translation too long', async () =>
	{
		const { universeId, areaId, ada } = await translatableUniverse();
		const daggerId = (await findDefaultItemIds('pf1e')).get('dagger');
		const save = (change: Record<string, unknown>): Promise<number> => saveChanges(ada, universeId, [{ kind: 'saveTranslation', language: 'fr', translation: 'Texte', sourceHash: sourceTextHash('x'), ...change }]).then((answer) => answer.status);

		assert.strictEqual(await save({ text: { kind: 'item', thingId: String(daggerId), field: 'name' } }), 404, 'an item that is engine text');
		assert.strictEqual(await save({ text: { kind: 'area', thingId: '00000000-0000-4000-8000-000000000000', field: 'name' } }), 404);
		assert.strictEqual(await save({ text: { kind: 'area', thingId: areaId, field: 'shortDescription' } }), 400, 'a field areas don\'t have');
		assert.strictEqual(await save({ text: { kind: 'area', thingId: areaId, field: 'name' }, language: 'es' }), 409);
		assert.strictEqual(await save({ text: { kind: 'area', thingId: areaId, field: 'name' }, translation: 'x'.repeat(61) }), 400);
	});
});
