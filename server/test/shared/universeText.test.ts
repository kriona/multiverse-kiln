import assert from 'assert';
import { createHash } from 'crypto';
import { findTranslation, isTranslationOutOfDate, sourceTextHash, universeLanguageOf, universeText } from '@multiverse-kiln/shared';

describe('universe text (shared)', () =>
{
	describe('findTranslation', () =>
	{
		const translations = {
			'pt-BR': 'Floresta',
			pt: 'Bosque',
			de: 'Wald'
		};

		it('takes the translation in the player\'s language', () =>
		{
			assert.strictEqual(findTranslation(translations, 'pt-BR'), 'Floresta');
			assert.strictEqual(findTranslation(translations, 'de'), 'Wald');
		});

		it('ignores capitals in language tags', () =>
		{
			assert.strictEqual(findTranslation(translations, 'PT-br'), 'Floresta');
			assert.strictEqual(findTranslation({ 'zh-Hant': '森林' }, 'zh-hant'), '森林');
		});

		it('falls back to the language without its region', () =>
		{
			assert.strictEqual(findTranslation(translations, 'pt-PT'), 'Bosque');
			assert.strictEqual(findTranslation(translations, 'de-AT'), 'Wald');
		});

		it('finds nothing for a language the text isn\'t translated into, or only another region of', () =>
		{
			assert.strictEqual(findTranslation(translations, 'fr'), undefined);
			assert.strictEqual(findTranslation({ 'pt-BR': 'Floresta' }, 'pt-PT'), undefined);
			assert.strictEqual(findTranslation({}, 'en'), undefined);
		});
	});

	describe('universeText', () =>
	{
		it('shows the translation, or the source text when there is none', () =>
		{
			assert.strictEqual(universeText('Forest', { fr: 'Forêt' }, 'fr-CA'), 'Forêt');
			assert.strictEqual(universeText('Forest', { fr: 'Forêt' }, 'es'), 'Forest');
		});
	});

	describe('sourceTextHash', () =>
	{
		it('is the SHA-256 of the text\'s UTF-8 in hex, as Node and Postgres work it out', () =>
		{
			// 55 and 56 bytes straddle the end of a block, where the length no longer fits after the text
			const texts = ['', 'Forest', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'Café 東京 🐉 '.repeat(40)];

			for (const text of texts)
			{
				assert.strictEqual(sourceTextHash(text), createHash('sha256').update(text, 'utf8').digest('hex'), `for ${text.length} characters`);
			}
		});
	});

	describe('isTranslationOutOfDate', () =>
	{
		it('is out of date once the source text differs from what it was made from', () =>
		{
			const madeFrom = sourceTextHash('The Old Mill');

			assert.strictEqual(isTranslationOutOfDate(madeFrom, 'The Old Mill'), false);
			assert.strictEqual(isTranslationOutOfDate(madeFrom, 'The Old Mill '), true);
			assert.strictEqual(isTranslationOutOfDate(madeFrom, 'The Burned Mill'), true);
		});
	});

	describe('universeLanguageOf', () =>
	{
		it('takes the language without its region', () =>
		{
			assert.strictEqual(universeLanguageOf('pt-BR'), 'pt');
			assert.strictEqual(universeLanguageOf('FR'), 'fr');
		});

		it('is English for test languages, unknown languages and none', () =>
		{
			assert.strictEqual(universeLanguageOf('en-x-pirate'), 'en');
			assert.strictEqual(universeLanguageOf('en-XA'), 'en');
			assert.strictEqual(universeLanguageOf('tlh'), 'en');
			assert.strictEqual(universeLanguageOf(undefined), 'en');
		});
	});
});
