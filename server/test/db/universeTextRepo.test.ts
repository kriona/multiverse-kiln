import assert from 'assert';
import { sql } from 'drizzle-orm';
import { sourceTextHash } from '@multiverse-kiln/shared';

import { db } from '../../src/db/client.js';
import { deleteUniverse } from '../../src/db/universeRepo.js';
import { countTranslations, deleteTranslationsOutside, deleteTranslatorNote, deleteUniverseTextOf, listTranslations, listTranslationsIn, listTranslatorNotes, saveTranslation, saveTranslatorNote, setNoTranslation, type UniverseTranslationRecord } from '../../src/db/universeTextRepo.js';
import { liveVersion } from '../../src/db/universeVersions.js';
import { addUniverse } from './fixtures.js';

/**
 * A translation of an area's name
 *
 * @param areaId The area's ID
 * @param language The language
 * @param text The translation
 * @return The translation, made from the name "Forest"
 */
function areaName(areaId: string, language: string, text: string): UniverseTranslationRecord
{
	return({
		kind: 'area',
		thingId: areaId,
		field: 'name',
		language,
		text,
		sourceHash: sourceTextHash('Forest')
	});
}

/**
 * Sorts translations by language, to compare lists that come in no particular order
 *
 * @param translations The translations
 * @return The languages and texts, by language
 */
function byLanguage(translations: UniverseTranslationRecord[]): [string, string][]
{
	return(translations
		.map((translation): [string, string] => [translation.language, translation.text])
		.sort(([first], [second]) => first.localeCompare(second)));
}

describe('universeTextRepo', () =>
{
	it('saves a translation, replaces it in the same language, and lists the languages asked for', async () =>
	{
		const universeId = await addUniverse();
		const otherId = await addUniverse('Elsewhere');
		const areaId = '7d1c1f8e-4c38-4f3b-9a58-4c7a1d7a0b11';

		await saveTranslation(liveVersion(universeId), areaName(areaId, 'fr', 'Bois'));
		await saveTranslation(liveVersion(universeId), areaName(areaId, 'fr', 'Forêt'));
		await saveTranslation(liveVersion(universeId), areaName(areaId, 'de', 'Wald'));
		await saveTranslation(liveVersion(universeId), areaName(areaId, 'es', 'Bosque'));
		await saveTranslation(liveVersion(otherId), areaName(areaId, 'fr', 'Ailleurs'));

		assert.deepStrictEqual(byLanguage(await listTranslations(liveVersion(universeId), ['fr', 'de'])), [['de', 'Wald'], ['fr', 'Forêt']]);
		assert.deepStrictEqual(await listTranslations(liveVersion(universeId), []), []);
		assert.deepStrictEqual(Object.fromEntries(await countTranslations(liveVersion(universeId))), { fr: 1, de: 1, es: 1 });
	});

	it('deletes the translations into languages taken off, and every one when none are left', async () =>
	{
		const universeId = await addUniverse();
		const areaId = '7d1c1f8e-4c38-4f3b-9a58-4c7a1d7a0b11';

		for (const [language, text] of [['fr', 'Forêt'], ['de', 'Wald'], ['es', 'Bosque']])
		{
			await saveTranslation(liveVersion(universeId), areaName(areaId, language, text));
		}

		assert.strictEqual(await deleteTranslationsOutside(liveVersion(universeId), ['fr', 'es']), 1);
		assert.deepStrictEqual(byLanguage(await listTranslations(liveVersion(universeId), ['fr', 'de', 'es'])), [['es', 'Bosque'], ['fr', 'Forêt']]);
		assert.strictEqual(await deleteTranslationsOutside(liveVersion(universeId), []), 2);
		assert.deepStrictEqual(await countTranslations(liveVersion(universeId)), new Map());
	});

	it('keeps one note for translators per piece of text, and deletes it', async () =>
	{
		const universeId = await addUniverse();
		const ref = { kind: 'universe', thingId: universeId, field: 'name' } as const;

		await saveTranslatorNote(liveVersion(universeId), { ...ref, note: 'A pun' });
		await saveTranslatorNote(liveVersion(universeId), { ...ref, note: 'A pun on the founder\'s name' });
		await saveTranslatorNote(liveVersion(universeId), { kind: 'item', thingId: '12', field: 'name', note: 'A short sword' });

		assert.deepStrictEqual((await listTranslatorNotes(liveVersion(universeId))).map(({ kind, note }) => [kind, note]).sort(), [['item', 'A short sword'], ['universe', 'A pun on the founder\'s name']]);

		await deleteTranslatorNote(liveVersion(universeId), ref);

		assert.deepStrictEqual((await listTranslatorNotes(liveVersion(universeId))).map(({ kind }) => kind), ['item']);
	});

	it('keeps a note and the mark that text needs no translation apart, until neither is left', async () =>
	{
		const universeId = await addUniverse();
		const ref = { kind: 'universe', thingId: universeId, field: 'name' } as const;
		const notesOf = async (): Promise<unknown[]> => (await listTranslatorNotes(liveVersion(universeId))).map(({ note, noTranslation }) => [note, noTranslation]);

		await setNoTranslation(liveVersion(universeId), ref, true);
		await saveTranslatorNote(liveVersion(universeId), { ...ref, note: 'The founder\'s name' });
		assert.deepStrictEqual(await notesOf(), [['The founder\'s name', true]]);

		await deleteTranslatorNote(liveVersion(universeId), ref);
		assert.deepStrictEqual(await notesOf(), [[null, true]]);

		await setNoTranslation(liveVersion(universeId), ref, false);
		assert.deepStrictEqual(await notesOf(), []);
	});

	it('leaves the translations of text that needs none out of what players see, and keeps them', async () =>
	{
		const universeId = await addUniverse();
		const areaId = '7d1c1f8e-4c38-4f3b-9a58-4c7a1d7a0b11';
		const ref = { kind: 'area', thingId: areaId, field: 'name' } as const;
		const shown = async (): Promise<string[]> => (await listTranslationsIn([{ universeId, languages: ['fr'] }], undefined)).map(({ text }) => text);

		await saveTranslation(liveVersion(universeId), areaName(areaId, 'fr', 'Forêt'));
		await setNoTranslation(liveVersion(universeId), ref, true);
		assert.deepStrictEqual(await shown(), []);
		assert.deepStrictEqual(Object.fromEntries(await countTranslations(liveVersion(universeId))), { fr: 1 });

		await setNoTranslation(liveVersion(universeId), ref, false);
		assert.deepStrictEqual(await shown(), ['Forêt']);
	});

	it('lists the translations of whole kinds of text, or of only some things of a kind', async () =>
	{
		const universeId = await addUniverse();
		const translated = [['item', '12', 'Épée'], ['item', '13', 'Hache'], ['item', '14', 'Arc'], ['race', '12', 'Nain'], ['coin', 'gp', 'Écus']] as const;

		for (const [kind, thingId, text] of translated)
		{
			await saveTranslation(liveVersion(universeId), { kind, thingId, field: 'name', language: 'fr', text, sourceHash: sourceTextHash(text) });
		}

		const shown = async (kinds: Parameters<typeof listTranslationsIn>[1]): Promise<string[]> => (await listTranslationsIn([{ universeId, languages: ['fr'] }], kinds))
			.map(({ text }) => text)
			.sort();

		assert.deepStrictEqual(await shown([{ kind: 'item', thingIds: [12, 14, 12] }, 'coin']), ['Arc', 'Écus', 'Épée']);
		assert.deepStrictEqual(await shown([{ kind: 'item', thingIds: [] }, { kind: 'race', thingIds: ['12'] }]), ['Nain']);
		assert.deepStrictEqual(await shown(['item']), ['Arc', 'Hache', 'Épée']);
	});

	it('deletes a thing\'s translations and notes, leaving others\' alone', async () =>
	{
		const universeId = await addUniverse();

		await saveTranslation(liveVersion(universeId), { kind: 'item', thingId: '12', field: 'name', language: 'fr', text: 'Épée', sourceHash: sourceTextHash('Sword') });
		await saveTranslation(liveVersion(universeId), { kind: 'race', thingId: '12', field: 'name', language: 'fr', text: 'Nain', sourceHash: sourceTextHash('Dwarf') });
		await saveTranslatorNote(liveVersion(universeId), { kind: 'item', thingId: '12', field: 'name', note: 'A weapon' });

		await deleteUniverseTextOf(liveVersion(universeId), 'item', 12);

		assert.deepStrictEqual((await listTranslations(liveVersion(universeId), ['fr'])).map(({ kind }) => kind), ['race']);
		assert.deepStrictEqual(await listTranslatorNotes(liveVersion(universeId)), []);
	});

	it('hashes source text the way Postgres does, so the database can find out-of-date translations', async () =>
	{
		const text = 'Café 東京 🐉 '.repeat(10);
		const result = await db.execute<{ hash: string }>(sql`SELECT encode(sha256(convert_to(${text}, 'UTF8')), 'hex') AS hash`);

		assert.strictEqual(result.rows[0].hash, sourceTextHash(text));
	});

	it('deletes everything with the universe', async () =>
	{
		const universeId = await addUniverse();

		await saveTranslation(liveVersion(universeId), areaName('7d1c1f8e-4c38-4f3b-9a58-4c7a1d7a0b11', 'fr', 'Forêt'));
		await saveTranslatorNote(liveVersion(universeId), { kind: 'universe', thingId: universeId, field: 'name', note: 'A pun' });
		await deleteUniverse(universeId);

		assert.deepStrictEqual(await countTranslations(liveVersion(universeId)), new Map());
		assert.deepStrictEqual(await listTranslatorNotes(liveVersion(universeId)), []);
	});
});
