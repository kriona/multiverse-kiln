import assert from 'assert';
import { sourceTextHash, type UniverseTextListPayload, type UniverseTextRow } from '@multiverse-kiln/shared';

import { findDefaultItemIds } from '../src/db/itemRepo.js';
import { listUniverseEdits } from '../src/db/universeEditRepo.js';
import { setUniverseAccess, setUniverseRole } from '../src/db/universeEditorRepo.js';
import { UniverseTextTranslator } from '../src/http/universeTextTranslator.js';
import { createArea, createUniverse, logIn, saveChanges, send, type Editor } from './editorRequests.js';
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
