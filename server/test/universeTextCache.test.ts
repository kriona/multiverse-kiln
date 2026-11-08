import assert from 'assert';
import type { UniverseTextPayload } from '@multiverse-kiln/shared';

import { UniverseTextCache } from '../src/http/universeTextCache.js';
import { AreaChanges } from '../src/world/areaChanges.js';

const universe = {
	id: 'universe-1',
	sourceLanguage: 'en',
	translationLanguages: ['fr']
};

/**
 * A build of a universe's text that counts how many times it runs
 *
 * @param name The name its one area has
 * @return The build, and how many times it has run
 */
function countedBuild(name: string): { build: () => Promise<UniverseTextPayload>; runs: () => number }
{
	let runs = 0;

	return({
		build: () =>
		{
			runs++;

			return(Promise.resolve({
				areas: { meadow: name },
				tiles: {}
			}));
		},
		runs: () => runs
	});
}

describe('universe text cache', () =>
{
	it('builds the text once for requests that ask for it together, and again in another language', async () =>
	{
		const cache = new UniverseTextCache(new AreaChanges());
		const { build, runs } = countedBuild('Meadow');
		const [first, second] = await Promise.all([
			cache.get(universe, ['fr'], build),
			cache.get(universe, ['fr-CA'], build)
		]);

		assert.strictEqual(runs(), 1);
		assert.deepStrictEqual(first, second);
		assert.strictEqual(first.body, JSON.stringify({ areas: { meadow: 'Meadow' }, tiles: {} }));
		assert.match(first.etag, /^"[\w-]+"$/);

		await cache.get(universe, ['de'], build);
		assert.strictEqual(runs(), 2);
	});

	it('builds the text again once its universe\'s text changes, with a new ETag', async () =>
	{
		const changes = new AreaChanges();
		const cache = new UniverseTextCache(changes);
		const before = await cache.get(universe, ['fr'], countedBuild('Meadow').build);

		changes.publish({ kind: 'text', universeId: 'another-universe' });
		assert.strictEqual(await cache.get(universe, ['fr'], countedBuild('Unused').build), before);

		changes.publish({ kind: 'text', universeId: universe.id });

		const after = await cache.get(universe, ['fr'], countedBuild('Prairie').build);

		assert.strictEqual(after.body, JSON.stringify({ areas: { meadow: 'Prairie' }, tiles: {} }));
		assert.notStrictEqual(after.etag, before.etag);
	});

	it('builds the text again for the next request after a build fails', async () =>
	{
		const cache = new UniverseTextCache(new AreaChanges());

		await assert.rejects(cache.get(universe, ['fr'], () => Promise.reject(new Error('The database is down'))));

		const { build, runs } = countedBuild('Meadow');

		await cache.get(universe, ['fr'], build);
		assert.strictEqual(runs(), 1);
	});
});
