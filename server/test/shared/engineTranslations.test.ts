import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { engineTranslationContents, importLanguageFile, isEngineTranslationLanguage, languageFileName, languageFileText, PIRATE_LOCALE, PSEUDO_LOCALE, readTranslationFile, SITE_NAME, SOURCE_LOCALE, TRANSLATION_FILE_FORMATS, writeTranslationFile, type EngineCatalog, type ReadTranslation, type TranslationFile } from '@multiverse-kiln/shared';

/**
 * Where the English catalog and the translations are
 */
const LOCALES_FOLDER = path.resolve(import.meta.dirname, '..', '..', '..', 'shared', 'locales');

/**
 * A small English catalog: a message with an argument, one with a plural and a tag, and one without
 */
const english: EngineCatalog = {
	'test.playingAs': {
		defaultMessage: 'Playing as {name}',
		description: 'A test message with an argument'
	},
	'test.areas': {
		defaultMessage: '{count, plural, one {# area} other {# areas}} in <b>{universe}</b>',
		description: 'A test message with a plural and a tag'
	},
	'test.saved': {
		defaultMessage: 'Saved',
		description: 'A test message without arguments'
	}
};

/**
 * A translation read from a file, as the readers give one
 *
 * @param id The message's ID
 * @param translation The translation
 * @param source The source text the file holds, or null for none
 * @param needsReview Whether the file marks it as needing review
 * @return The translation
 */
function read(id: string, translation: string | null, source: string | null = null, needsReview = false): ReadTranslation
{
	return({ id, source, translation, needsReview });
}

/**
 * A file's object, read from shared/locales
 *
 * @param name The file's name
 * @return Its contents
 */
function readLocale<T>(name: string): T
{
	return(JSON.parse(fs.readFileSync(path.join(LOCALES_FOLDER, name), 'utf8')) as T);
}

describe('engine translations (shared)', () =>
{
	describe('engineTranslationContents', () =>
	{
		it('writes every English message, sorted by ID, with its description and the language\'s translation, marking those made from other English out of date', () =>
		{
			const existing: TranslationFile = {
				'test.saved': { message: 'Enregistré', source: 'Saved' },
				'test.playingAs': { message: 'Joue {name}', source: 'Playing {name}' }
			};
			const contents = engineTranslationContents(english, 'fr', existing);

			assert.strictEqual(contents.title, SITE_NAME);
			assert.strictEqual(contents.sourceLanguage, SOURCE_LOCALE);
			assert.strictEqual(contents.language, 'fr');
			assert.deepStrictEqual(contents.entries, [
				{
					id: 'test.areas',
					place: null,
					note: 'A test message with a plural and a tag',
					source: '{count, plural, one {# area} other {# areas}} in <b>{universe}</b>',
					translation: null,
					outOfDate: false
				},
				{
					id: 'test.playingAs',
					place: null,
					note: 'A test message with an argument',
					source: 'Playing as {name}',
					translation: 'Joue {name}',
					outOfDate: true
				},
				{
					id: 'test.saved',
					place: null,
					note: 'A test message without arguments',
					source: 'Saved',
					translation: 'Enregistré',
					outOfDate: false
				}
			]);
		});

		it('writes no translations for a language without a file', () =>
		{
			assert.ok(engineTranslationContents(english, 'de', undefined).entries.every((entry) => (entry.translation === null)));
		});
	});

	describe('importLanguageFile', () =>
	{
		it('adds the file\'s translations to the language\'s, keeping the source text the file holds, or the English when it holds none', () =>
		{
			const existing: TranslationFile = {
				'test.saved': { message: 'Enregistré', source: 'Saved' }
			};
			const imported = importLanguageFile(english, {
				language: 'fr',
				translations: [
					read('test.playingAs', 'Vous jouez {name}', 'Playing {name}'),
					read('test.areas', '{count, plural, one {# zone} other {# zones}} dans <b>{universe}</b>')
				]
			}, existing);

			assert.deepStrictEqual(imported.file, {
				'test.areas': { message: '{count, plural, one {# zone} other {# zones}} dans <b>{universe}</b>', source: english['test.areas'].defaultMessage },
				'test.playingAs': { message: 'Vous jouez {name}', source: 'Playing {name}' },
				'test.saved': { message: 'Enregistré', source: 'Saved' }
			});
			assert.deepStrictEqual(Object.keys(imported.file), ['test.areas', 'test.playingAs', 'test.saved']);
			assert.strictEqual(imported.imported, 2);
			assert.deepStrictEqual(imported.skipped, []);
			assert.deepStrictEqual(imported.status, { missing: [], outdated: ['test.playingAs'] });
		});

		it('leaves a translation that comes back unchanged as it is, so one out of date stays out of date', () =>
		{
			const existing: TranslationFile = {
				'test.playingAs': { message: 'Joue {name}', source: 'Playing {name}' }
			};
			const imported = importLanguageFile(english, {
				language: 'fr',
				translations: [read('test.playingAs', 'Joue {name}', 'Playing as {name}')]
			}, existing);

			assert.deepStrictEqual(imported.file, existing);
			assert.strictEqual(imported.imported, 0);
			assert.deepStrictEqual(imported.status.outdated, ['test.playingAs']);
		});

		it('skips translations needing review, of messages the English doesn\'t have, that can\'t be read or whose arguments differ, keeping the language\'s own', () =>
		{
			const existing: TranslationFile = {
				'test.saved': { message: 'Enregistré', source: 'Saved' }
			};
			const imported = importLanguageFile(english, {
				language: 'fr',
				translations: [
					read('test.saved', 'Sauvé', 'Saved', true),
					read('test.gone', 'Parti'),
					read('constructor', 'Constructeur'),
					read('__proto__', 'Prototype'),
					read('test.playingAs', 'Vous jouez {name'),
					read('test.areas', '{count, plural, one {# zone} other {# zones}} dans {universe}'),
					read('test.playingAs', null)
				]
			}, existing);

			assert.deepStrictEqual(imported.file, existing);
			assert.strictEqual(imported.imported, 0);
			assert.deepStrictEqual(imported.skipped, [
				{ id: 'test.saved', reason: 'needsReview' },
				{ id: 'test.gone', reason: 'unknown' },
				{ id: 'constructor', reason: 'unknown' },
				{ id: '__proto__', reason: 'unknown' },
				{ id: 'test.playingAs', reason: 'unreadable' },
				{ id: 'test.areas', reason: 'arguments' }
			]);
		});

		it('leaves out the language\'s translations of messages the English no longer has', () =>
		{
			const imported = importLanguageFile(english, { language: 'fr', translations: [] }, {
				'test.gone': { message: 'Parti', source: 'Gone' },
				'test.saved': { message: 'Enregistré', source: 'Saved' }
			});

			assert.deepStrictEqual(imported.file, { 'test.saved': { message: 'Enregistré', source: 'Saved' } });
			assert.strictEqual(imported.removed, 1);
			assert.deepStrictEqual(imported.status.missing, ['test.areas', 'test.playingAs']);
		});
	});

	describe('the files in shared/locales', () =>
	{
		const catalog = readLocale<EngineCatalog>(`${SOURCE_LOCALE}.json`);
		const pirate = readLocale<TranslationFile>(`${PIRATE_LOCALE}.json`);

		for (const format of TRANSLATION_FILE_FORMATS)
		{
			it(`makes Pirate's file again from the ${format} file exported for it`, () =>
			{
				const written = writeTranslationFile(format, engineTranslationContents(catalog, PIRATE_LOCALE, pirate));
				const imported = importLanguageFile(catalog, readTranslationFile(format, written), undefined);
				const sorted = Object.fromEntries(Object.entries(pirate).sort(([first], [second]) => ((first < second) ? -1 : 1)));

				assert.deepStrictEqual(imported.skipped, []);
				assert.strictEqual(languageFileText(imported.file), languageFileText(sorted));
			});
		}

		it('writes a language\'s file the way the English catalog is written', () =>
		{
			const text = fs.readFileSync(path.join(LOCALES_FOLDER, `${SOURCE_LOCALE}.json`), 'utf8');

			assert.strictEqual(languageFileText(JSON.parse(text) as TranslationFile), text);
		});
	});

	it('translates into any language but English and the pseudo-language, in a file named by its tag', () =>
	{
		assert.strictEqual(isEngineTranslationLanguage('de'), true);
		assert.strictEqual(isEngineTranslationLanguage('en-GB'), true);
		assert.strictEqual(isEngineTranslationLanguage(PIRATE_LOCALE), true);
		assert.strictEqual(isEngineTranslationLanguage(SOURCE_LOCALE), false);
		assert.strictEqual(isEngineTranslationLanguage(PSEUDO_LOCALE), false);
		assert.strictEqual(languageFileName('pt-BR'), 'pt-BR.json');
	});
});
