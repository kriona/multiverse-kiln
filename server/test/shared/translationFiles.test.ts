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
