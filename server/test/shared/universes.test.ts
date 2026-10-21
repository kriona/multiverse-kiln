import assert from 'assert';
import { universeSlug } from '@multiverse-kiln/shared';

describe('universeSlug (shared)', () =>
{
	it('lowercases the name and joins its words with hyphens', () =>
	{
		assert.strictEqual(universeSlug('The Shattered Isles'), 'the-shattered-isles');
		assert.strictEqual(universeSlug('Kilnhaven'), 'kilnhaven');
		assert.strictEqual(universeSlug('Realm 42'), 'realm-42');
	});

	it('turns each run of spaces and punctuation into one hyphen, and drops it from the ends', () =>
	{
		assert.strictEqual(universeSlug('  "Dragons -- & Dungeons!"  '), 'dragons-dungeons');
		assert.strictEqual(universeSlug('Kiln_haven.v2'), 'kiln-haven-v2');
	});

	it('keeps letters of every alphabet, in one form however they were typed', () =>
	{
		assert.strictEqual(universeSlug('Café Mundo'), 'café-mundo');
		assert.strictEqual(universeSlug('Café Mundo'), 'café-mundo');
		assert.strictEqual(universeSlug('東京 夜'), '東京-夜');
		assert.strictEqual(universeSlug('Звёздный Мир'), 'звёздный-мир');
	});

	it('is empty for a name without letters or digits', () =>
	{
		assert.strictEqual(universeSlug('!?'), '');
		assert.strictEqual(universeSlug(''), '');
	});
});
