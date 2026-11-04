import assert from 'assert';
import { eq } from 'drizzle-orm';
import { sourceTextHash, type EditableUniverse } from '@multiverse-kiln/shared';

import { db } from '../src/db/client.js';
import { players } from '../src/db/schema.js';
import { listUniverseEdits } from '../src/db/universeEditRepo.js';
import { setUniverseRole } from '../src/db/universeEditorRepo.js';
import { findUniverseDetails } from '../src/db/universeRepo.js';
import { countTranslations, listTranslations, listTranslatorNotes, saveTranslation, saveTranslatorNote } from '../src/db/universeTextRepo.js';
import { areaChanges, type AreaChange } from '../src/world/areaChanges.js';
import { createArea, createUniverse, logIn, saveChanges, send, type Editor } from './editorRequests.js';
import { getTestServer } from './testServer.js';

/**
 * The universe as the editor opens it
 *
 * @param editor The browser opening it
 * @param universeId The universe's ID
 * @return The universe
 */
async function openUniverse(editor: Editor, universeId: string): Promise<EditableUniverse>
{
	const response = await send<EditableUniverse>(editor, 'GET', `/${universeId}`);

	assert.strictEqual(response.status, 200, JSON.stringify(response.body));

	return(response.body);
}

/**
 * Adds a translation of a piece of a universe's text
 *
 * @param universeId The universe's ID
 * @param kind What the text belongs to
 * @param thingId Its ID
 * @param language The translation's language
 */
async function addTranslation(universeId: string, kind: 'universe' | 'area', thingId: string, language: string): Promise<void>
{
	await saveTranslation(universeId, {
		kind,
		thingId,
		field: 'name',
		language,
		text: `${language} name`,
		sourceHash: sourceTextHash('Name')
	});
}

describe('universe languages in the editor', () =>
{
	before(async () =>
	{
		await getTestServer();
	});

	it('writes a new universe in its creator\'s language: their profile\'s, then the page\'s', async () =>
	{
		const ada = await logIn('Ada');
		const grace = await logIn('Grace');
		const linus = await logIn('Linus');

		await db
			.update(players)
			.set({ locale: 'pt-BR' })
			.where(eq(players.id, ada.playerId));

		const fromProfile = (await send<{ id: string }>(ada, 'POST', '', { body: { name: 'Mundo', shortDescription: '', ruleset: 'pf1e', locale: 'de' } })).body.id;
		const fromPage = (await send<{ id: string }>(grace, 'POST', '', { body: { name: 'Welt', shortDescription: '', ruleset: 'pf1e', locale: 'de-AT' } })).body.id;
		const unknown = await createUniverse(linus, 'World');

		assert.strictEqual((await openUniverse(ada, fromProfile)).sourceLanguage, 'pt');
		assert.strictEqual((await openUniverse(grace, fromPage)).sourceLanguage, 'de');

		const opened = await openUniverse(linus, unknown);

		assert.strictEqual(opened.sourceLanguage, 'en');
		assert.deepStrictEqual(opened.translationLanguages, []);
		assert.deepStrictEqual(opened.translationCounts, {});
	});

	it('saves the source language and the languages it is translated into, which its page shows', async () =>
	{
		const ada = await logIn('Ada');
		const universeId = await createUniverse(ada);
		const saved = await saveChanges(ada, universeId, [{ kind: 'universe', update: { sourceLanguage: 'de', translationLanguages: ['fr', 'pt-br'] } }]);

		assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));

		const opened = await openUniverse(ada, universeId);
		const details = await findUniverseDetails(universeId);

		assert.strictEqual(opened.sourceLanguage, 'de');
		assert.deepStrictEqual(opened.translationLanguages, ['fr', 'pt-BR']);
		assert.deepStrictEqual([details?.sourceLanguage, details?.translationLanguages], ['de', ['fr', 'pt-BR']]);

		const [edit] = (await listUniverseEdits(universeId, { offset: 0, limit: 1 })).edits;

		assert.deepStrictEqual(edit.changeDetails?.[0].fields, [
			{ field: 'sourceLanguage', value: 'de' },
			{ field: 'translationLanguages', value: ['fr', 'pt-BR'] }
		]);
	});

	it('refuses a source language that is also a translation, and a language listed twice', async () =>
	{
		const ada = await logIn('Ada');
		const universeId = await createUniverse(ada);

		const both = await saveChanges(ada, universeId, [{ kind: 'universe', update: { sourceLanguage: 'fr', translationLanguages: ['de', 'FR'] } }]);
		const onlyTranslations = await saveChanges(ada, universeId, [{ kind: 'universe', update: { translationLanguages: ['en'] } }]);
		const twice = await saveChanges(ada, universeId, [{ kind: 'universe', update: { translationLanguages: ['de', 'DE'] } }]);

		assert.deepStrictEqual([both.status, both.body.changeIndex], [400, 0]);
		assert.strictEqual(onlyTranslations.status, 400);
		assert.strictEqual(twice.status, 400);
		assert.deepStrictEqual((await openUniverse(ada, universeId)).translationLanguages, []);
	});

	it('deletes the translations into a language taken off, and counts the rest', async () =>
	{
		const ada = await logIn('Ada');
		const universeId = await createUniverse(ada);

		await saveChanges(ada, universeId, [{ kind: 'universe', update: { translationLanguages: ['fr', 'de'] } }]);
		await addTranslation(universeId, 'universe', universeId, 'fr');
		await addTranslation(universeId, 'universe', universeId, 'de');

		assert.deepStrictEqual((await openUniverse(ada, universeId)).translationCounts, { fr: 1, de: 1 });

		const saved = await saveChanges(ada, universeId, [{ kind: 'universe', update: { translationLanguages: ['de'] } }]);

		assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
		assert.deepStrictEqual((await openUniverse(ada, universeId)).translationCounts, { de: 1 });
	});

	it('keeps the translations when a save that takes a language off is refused', async () =>
	{
		const ada = await logIn('Ada');
		const universeId = await createUniverse(ada);

		await saveChanges(ada, universeId, [{ kind: 'universe', update: { translationLanguages: ['fr'] } }]);
		await addTranslation(universeId, 'universe', universeId, 'fr');

		const refused = await saveChanges(ada, universeId, [
			{ kind: 'universe', update: { translationLanguages: [] } },
			{ kind: 'deleteArea', areaId: '00000000-0000-4000-8000-000000000000' }
		]);

		assert.notStrictEqual(refused.status, 200);
		assert.deepStrictEqual(Object.fromEntries(await countTranslations(universeId)), { fr: 1 });
	});

	it('lets only creators change the languages', async () =>
	{
		const ada = await logIn('Ada');
		const bob = await logIn('Bob');
		const universeId = await createUniverse(ada);

		await setUniverseRole(universeId, bob.playerId, 'builder');

		const refused = await saveChanges(bob, universeId, [{ kind: 'universe', update: { translationLanguages: ['fr'] } }]);

		assert.strictEqual(refused.status, 403);
	});

	it('tells the rooms when a save changes the names they leave to clients, and only then', async () =>
	{
		const ada = await logIn('Ada');
		const universeId = await createUniverse(ada);
		const areaId = await createArea(ada, universeId);
		const told: AreaChange[] = [];
		const stop = areaChanges.onChange((change) =>
		{
			if (change.kind === 'text')
			{
				told.push(change);
			}
		});

		try
		{
			await saveChanges(ada, universeId, [{ kind: 'universe', update: { shortDescription: 'Changed' } }]);
			await saveChanges(ada, universeId, [{ kind: 'updateArea', areaId, update: { name: 'Meadows' } }]);
		}
		finally
		{
			stop();
		}

		assert.deepStrictEqual(told, [{ kind: 'text', universeId }]);
	});

	it('deletes an area\'s translations and notes with it', async () =>
	{
		const ada = await logIn('Ada');
		const universeId = await createUniverse(ada);
		const areaId = await createArea(ada, universeId);

		await saveChanges(ada, universeId, [{ kind: 'universe', update: { translationLanguages: ['fr'] } }]);
		await addTranslation(universeId, 'area', areaId, 'fr');
		await addTranslation(universeId, 'universe', universeId, 'fr');
		await saveTranslatorNote(universeId, { kind: 'area', thingId: areaId, field: 'name', note: 'A field of flowers' });

		const deleted = await saveChanges(ada, universeId, [{ kind: 'deleteArea', areaId }]);

		assert.strictEqual(deleted.status, 200, JSON.stringify(deleted.body));
		assert.deepStrictEqual((await listTranslations(universeId, ['fr'])).map(({ kind }) => kind), ['universe']);
		assert.deepStrictEqual(await listTranslatorNotes(universeId), []);
	});
});
