import assert from 'assert';
import { parseUniverseTextKey, readTranslationFile, TRANSLATION_FILE_FORMATS, TranslationFileError, translationFileFormatOf, universeTextKey, writeTranslationFile, type TranslationFileContents } from '@multiverse-kiln/shared';

/**
 * A file's contents with text that is hard to write in every format: quotes, commas, line breaks,
 * markup characters, tabs, a backslash and letters outside ASCII
 */
const contents: TranslationFileContents = {
	title: 'Kilnhaven & "Friends"',
	sourceLanguage: 'en',
	language: 'fr',
	entries: [
		{
			id: 'area:7d1c1f8e-4c38-4f3b-9a58-4c7a1d7a0b11:name',
			place: 'Area: Waterdeep, name',
			note: 'A pun on the founder\'s name\nKeep the joke',
			source: 'Waterdeep',
			translation: 'Eauprofonde',
			outOfDate: false
		},
		{
			id: 'universe:6b0f8a52-3c1e-4d7a-9f20-5e8b1c4d2a07:longDescription',
			place: 'Universe: Kilnhaven, long description',
			note: null,
			source: 'A *small* town, "quiet" <and> calm,\n\n\tpath\\to: café 🐉',
			translation: 'Un *petit* village, « calme » <et> paisible,\n\n\tchemin\\vers: café 🐉',
			outOfDate: true
		},
		{
			id: 'item:12:name',
			place: 'Item: Shiv, name',
			note: null,
			source: 'Shiv',
			translation: null,
			outOfDate: false
		}
	]
};

describe('translation files (shared)', () =>
{
	for (const format of TRANSLATION_FILE_FORMATS)
	{
		it(`reads back what it writes as ${format}`, () =>
		{
			const read = readTranslationFile(format, writeTranslationFile(format, contents));

			assert.strictEqual(read.language, ((format === 'csv') ? null : 'fr'));
			assert.deepStrictEqual(read.translations.map(({ id, source, translation }) => ({ id, source, translation })), contents.entries.map(({ id, source, translation }) => ({ id, source, translation })));
		});
	}

	it('marks out-of-date translations fuzzy in a PO file, and reads fuzzy entries as needing review', () =>
	{
		const written = writeTranslationFile('po', contents);
		const read = readTranslationFile('po', written);

		assert.match(written, /#\. Area: Waterdeep, name\n#\. A pun on the founder's name\n#\. Keep the joke\n/);
		assert.deepStrictEqual(read.translations.map(({ needsReview }) => needsReview), [false, true, false]);
	});

	it('reads PO files as tools write them: entries without blank lines, plurals and obsolete entries left out', () =>
	{
		const file = [
			'# A translator comment',
			'msgid ""',
			'msgstr "Language: de\\n"',
			'msgctxt "area:a:name"',
			'msgid "Forest"',
			'msgstr ""',
			'"Wa"',
			'"ld"',
			'msgctxt "item:3:name"',
			'msgid "Arrow"',
			'msgid_plural "Arrows"',
			'msgstr[0] "Pfeil"',
			'#~ msgctxt "item:4:name"',
			'#~ msgid "Old"',
			'#~ msgstr "Alt"'
		].join('\r\n');

		assert.deepStrictEqual(readTranslationFile('po', file), {
			language: 'de',
			translations: [{ id: 'area:a:name', source: 'Forest', translation: 'Wald', needsReview: false }]
		});
	});

	it('reads a PO header\'s POSIX language name, such as pt_BR, as a language tag', () =>
	{
		const header = (language: string): string => ['msgid ""', `msgstr "Language: ${language}\\n"`].join('\n');

		assert.strictEqual(readTranslationFile('po', header('pt_BR')).language, 'pt-BR');
		assert.strictEqual(readTranslationFile('po', header('de_DE.UTF-8')).language, 'de-DE');
		assert.strictEqual(readTranslationFile('po', header('pt-br')).language, 'pt-BR');
		assert.strictEqual(readTranslationFile('po', header('sr_RS@latin')).language, 'sr-RS@latin');
	});

	it('reads XLIFF with entities, CDATA and several segments, and refuses a document type declaration', () =>
	{
		const file = [
			'<?xml version="1.0"?>',
			'<x:xliff xmlns:x="urn:oasis:names:tc:xliff:document:2.0" version="2.0" srcLang="en" trgLang="pt-BR">',
			'<x:file id="f"><x:unit id="area:a:name"><!-- a comment -->',
			'<x:segment><x:source>Fish &amp; </x:source><x:target>Peixe &#x26; </x:target></x:segment>',
			'<x:segment><x:source>Chips</x:source><x:target><![CDATA[<Batatas>]]></x:target></x:segment>',
			'</x:unit><x:unit id="area:b:name"><x:segment><x:source>Lake</x:source></x:segment></x:unit></x:file></x:xliff>'
		].join('\n');

		assert.deepStrictEqual(readTranslationFile('xliff', file), {
			language: 'pt-BR',
			translations: [
				{ id: 'area:a:name', source: 'Fish & Chips', translation: 'Peixe & <Batatas>', needsReview: false },
				{ id: 'area:b:name', source: 'Lake', translation: null, needsReview: false }
			]
		});
		assert.throws(() => readTranslationFile('xliff', '<!DOCTYPE x [<!ENTITY a "b">]><xliff/>'), TranslationFileError);
		assert.throws(() => readTranslationFile('xliff', '<xliff><unit></xliff>'), TranslationFileError);
	});

	it('says which line of an XLIFF file has an entity it can\'t read, in text and in attributes', () =>
	{
		const inText = '<xliff>\n<file>\n<unit id="a">&nope;</unit>\n</file>\n</xliff>';
		const inAttribute = '<xliff>\n<file>\n\n<unit id="&nope;"/>\n</file>\n</xliff>';

		assert.throws(() => readTranslationFile('xliff', inText), (error: unknown) => ((error instanceof TranslationFileError) && (error.line === 3)));
		assert.throws(() => readTranslationFile('xliff', inAttribute), (error: unknown) => ((error instanceof TranslationFileError) && (error.line === 4)));
	});

	it('reads a large XLIFF file in time growing with its length, not its square', () =>
	{
		// Read in time growing with the square of its length, this file takes several seconds; read in a
		// single pass, a few milliseconds, so the limit leaves room for a slow machine
		const large: TranslationFileContents = {
			...contents,
			entries: Array.from({ length: 2000 }, (_, index) => ({
				id: `area:${index}:name`,
				place: `Area: Area ${index}, name`,
				note: `Note ${index}`,
				source: `Area ${index}`,
				translation: `Zone ${index}`,
				outOfDate: false
			}))
		};
		const written = writeTranslationFile('xliff', large);
		const start = performance.now();
		const read = readTranslationFile('xliff', written);
		const elapsedMs = (performance.now() - start);

		assert.strictEqual(read.translations.length, 2000);
		assert.ok((elapsedMs < 1000), `Reading took ${Math.round(elapsedMs)} ms`);
	});

	it('reads CSV by its column names, in any order, with a byte order mark and line breaks in quotes', () =>
	{
		const file = String.fromCharCode(0xfeff) + 'Translation,ID\n"Zwei\nZeilen",area:a:name\n,item:3:name\n';

		assert.deepStrictEqual(readTranslationFile('csv', file).translations, [
			{ id: 'area:a:name', source: null, translation: 'Zwei\nZeilen', needsReview: false },
			{ id: 'item:3:name', source: null, translation: null, needsReview: false }
		]);
		assert.throws(() => readTranslationFile('csv', 'name,text\nx,y\n'), TranslationFileError);
		assert.throws(() => readTranslationFile('csv', 'id,translation\n"unclosed,x\n'), TranslationFileError);
	});

	it('writes CSV text a spreadsheet would run as a formula after an apostrophe, and reads it back as it was', () =>
	{
		const texts = ['=HYPERLINK("https://evil.example")', '+1', '-2', '@SUM(A1)', '\tTabbed', '\rReturned', '\'=Quoted', 'Plain', '\'Apostrophe'];
		const formulas: TranslationFileContents = {
			...contents,
			entries: texts.map((text, index) => ({
				id: `item:${index}:name`,
				place: 'Item',
				note: null,
				source: text,
				translation: text,
				outOfDate: false
			}))
		};
		const written = writeTranslationFile('csv', formulas);
		const cells = written.split('\r\n')
			.slice(1, -1)
			.map((row) => row.split('","')[4]);

		assert.deepStrictEqual(cells, ['\'=HYPERLINK(""https://evil.example"")', '\'+1', '\'-2', '\'@SUM(A1)', '\'\tTabbed', '\'\rReturned', '\'\'=Quoted', 'Plain', '\'Apostrophe']);
		assert.deepStrictEqual(readTranslationFile('csv', written).translations.map(({ source, translation }) => [source, translation]), texts.map((text) => [text, text]));
	});

	it('refuses a file that isn\'t in its format, saying where when it can', () =>
	{
		assert.throws(() => readTranslationFile('po', 'msgid "x"\nthis is not po\n'), (error: unknown) => ((error instanceof TranslationFileError) && (error.line === 2)));
		assert.throws(() => readTranslationFile('json', '{"text": []}'), TranslationFileError);
		assert.throws(() => readTranslationFile('json', 'not json'), TranslationFileError);
	});

	it('names pieces of text by their keys, and formats by their files\' extensions', () =>
	{
		const ref = { kind: 'area', thingId: '7d1c', field: 'name' } as const;

		assert.deepStrictEqual(parseUniverseTextKey(universeTextKey(ref)), ref);
		assert.strictEqual(parseUniverseTextKey('planet:1:name'), undefined);
		assert.strictEqual(parseUniverseTextKey('area::name'), undefined);
		assert.deepStrictEqual(['a.PO', 'b.pot', 'c.xlf', 'd.xliff', 'e.csv', 'f.json', 'g.txt'].map(translationFileFormatOf), ['po', 'po', 'xliff', 'xliff', 'csv', 'json', undefined]);
	});
});
