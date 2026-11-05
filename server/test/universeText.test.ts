import assert from 'assert';
import { eq } from 'drizzle-orm';
import { charactersPath, sourceTextHash, UNIVERSES_PATH, type NewCharacterOptions, type UniverseDetails, type UniverseListPayload, type UniverseTextPayload } from '@multiverse-kiln/shared';

import { db } from '../src/db/client.js';
import { players } from '../src/db/schema.js';
import { saveTranslation } from '../src/db/universeTextRepo.js';
import { liveVersion } from '../src/db/universeVersions.js';
import { createArea, createUniverse, logIn, saveChanges, type Editor } from './editorRequests.js';
import { testServerUrl, getTestServer } from './testServer.js';

/**
 * Fetches one of the universe routes players read
 *
 * @param path The path under UNIVERSES_PATH, starting with /, or empty for the list
 * @param headers The request's headers, such as Accept-Language
 * @param editor A logged-in browser to send the request from, or undefined for none
 * @return The response, with its JSON body (undefined for none)
 */
async function fetchUniverse<T>(path: string, headers: Record<string, string> = {}, editor?: Editor): Promise<{ response: Response; body: T }>
{
	const response = await fetch(`${testServerUrl}${UNIVERSES_PATH}${path}`, {
		headers: {
			...headers,
			...((editor === undefined) ? {} : { Cookie: editor.cookie })
		}
	});
	const text = await response.text();

	return({ response, body: ((text === '') ? undefined : JSON.parse(text)) as T });
}

/**
 * Translates a piece of a universe's text
 *
 * @param universeId The universe's ID
 * @param kind What it belongs to
 * @param thingId Its ID
 * @param field Which of its text it is
 * @param language The translation's language
 * @param text The translation
 */
async function translate(universeId: string, kind: 'universe' | 'area' | 'tile' | 'race', thingId: string, field: 'name' | 'shortDescription', language: string, text: string): Promise<void>
{
	await saveTranslation(liveVersion(universeId), { kind, thingId, field, language, text, sourceHash: sourceTextHash('source') });
}

/**
 * A universe ready for everyone, written in English and translated into French and Brazilian Portuguese,
 * with its name translated into both and its short description into French
 *
 * @return The universe's ID, and its creator's browser
 */
async function translatedUniverse(): Promise<{ universeId: string; ada: Editor }>
{
	const ada = await logIn('Ada');
	const universeId = await createUniverse(ada, 'Kilnhaven');
	const saved = await saveChanges(ada, universeId, [{ kind: 'universe', update: { stage: 'let_there_be_light', translationLanguages: ['fr', 'pt-BR'] } }]);

	assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
	await translate(universeId, 'universe', universeId, 'name', 'fr', 'Fourneauville');
	await translate(universeId, 'universe', universeId, 'shortDescription', 'fr', 'Une petite ville.');
	await translate(universeId, 'universe', universeId, 'name', 'pt-BR', 'Fornalha');

	return({ universeId, ada });
}

describe('universe text in the player\'s language', () =>
{
	before(async () =>
	{
		await getTestServer();
	});

	it('shows a universe\'s page in the closest of its languages to the request\'s, falling back to the source', async () =>
	{
		const { universeId } = await translatedUniverse();
		const nameIn = async (acceptLanguage: string): Promise<[string, string]> =>
		{
			const { body } = await fetchUniverse<UniverseDetails>(`/${universeId}`, { 'Accept-Language': acceptLanguage });

			return([body.name, body.shortDescription]);
		};

		assert.deepStrictEqual(await nameIn('fr'), ['Fourneauville', 'Une petite ville.']);
		assert.deepStrictEqual(await nameIn('fr-CA'), ['Fourneauville', 'Une petite ville.']);
		assert.deepStrictEqual(await nameIn('pt-BR'), ['Fornalha', 'A small town.']);
		assert.deepStrictEqual(await nameIn('de, fr;q=0.5'), ['Fourneauville', 'Une petite ville.']);
		assert.deepStrictEqual(await nameIn('de'), ['Kilnhaven', 'A small town.']);
		assert.deepStrictEqual(await nameIn('en, fr'), ['Kilnhaven', 'A small town.']);
	});

	it('lists universes in the request\'s language on Home', async () =>
	{
		const { universeId } = await translatedUniverse();
		const { body } = await fetchUniverse<UniverseListPayload>('', { 'Accept-Language': 'fr' });

		assert.deepStrictEqual(body.universes.filter((universe) => (universe.id === universeId)).map(({ name, shortDescription }) => [name, shortDescription]), [['Fourneauville', 'Une petite ville.']]);
	});

	it('puts the language on the player\'s profile ahead of the request\'s', async () =>
	{
		const { universeId, ada } = await translatedUniverse();

		await db
			.update(players)
			.set({ locale: 'pt-BR' })
			.where(eq(players.id, ada.playerId));

		const { body } = await fetchUniverse<UniverseDetails>(`/${universeId}`, { 'Accept-Language': 'fr' }, ada);
		const options = await fetchUniverse<NewCharacterOptions>(charactersPath(universeId).replace(UNIVERSES_PATH, '') + '/new', { 'Accept-Language': 'fr' }, ada);

		assert.strictEqual(body.name, 'Fornalha');
		assert.strictEqual(options.body.universeName, 'Fornalha');
	});

	it('names areas and tiles by ID, with an ETag that changes with the text and the language', async () =>
	{
		const { universeId, ada } = await translatedUniverse();
		const areaId = await createArea(ada, universeId, { name: 'Meadow', enabled: true });
		// fetch adds Cache-Control: no-cache to a request with If-None-Match unless it has a Cache-Control of
		// its own, which asks for the whole response; a browser revalidating what it keeps sends max-age=0
		const textIn = (acceptLanguage: string, etag?: string): Promise<{ response: Response; body: UniverseTextPayload }> => fetchUniverse<UniverseTextPayload>(`/${universeId}/text`, {
			'Accept-Language': acceptLanguage,
			...((etag === undefined) ? {} : { 'If-None-Match': etag, 'Cache-Control': 'max-age=0' })
		});

		const before = await textIn('fr');
		const etag = (before.response.headers.get('etag') ?? '');

		assert.strictEqual(before.response.status, 200);
		assert.strictEqual(before.body.areas[areaId], 'Meadow');
		assert.match(before.response.headers.get('cache-control') ?? '', /no-cache/);
		assert.strictEqual((await textIn('fr', etag)).response.status, 304);

		await translate(universeId, 'area', areaId, 'name', 'fr', 'Prairie');

		const translated = await textIn('fr', etag);
		const english = await textIn('de');

		assert.strictEqual(translated.response.status, 200);
		assert.strictEqual(translated.body.areas[areaId], 'Prairie');
		assert.notStrictEqual(translated.response.headers.get('etag'), etag);
		assert.strictEqual(english.body.areas[areaId], 'Meadow');
		assert.notStrictEqual(english.response.headers.get('etag'), translated.response.headers.get('etag'));

		const renamed = await saveChanges(ada, universeId, [{ kind: 'updateArea', areaId, update: { name: 'Meadows' } }]);
		const afterRename = await textIn('de', (english.response.headers.get('etag') ?? ''));

		assert.strictEqual(renamed.status, 200, JSON.stringify(renamed.body));
		assert.strictEqual(afterRename.response.status, 200);
		assert.strictEqual(afterRename.body.areas[areaId], 'Meadows');
	});

	it('answers 404 for the text of a universe the player may not see', async () =>
	{
		const ada = await logIn('Ada');
		const universeId = await createUniverse(ada, 'Unfinished');

		assert.strictEqual((await fetchUniverse(`/${universeId}/text`)).response.status, 404);
		assert.strictEqual((await fetchUniverse(`/${universeId}/text`, {}, ada)).response.status, 200);
	});
});
