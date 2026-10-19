import assert from 'assert';
import { ancestorAreas, childAreas, descendantAreaIds, areasTabListing, type AreaTreeNode } from '@multiverse-kiln/shared';

/**
 * An area with no parent, or inside another
 *
 * @param id The area's ID
 * @param parentAreaId Its parent's ID, if any
 * @return The area
 */
function area(id: string, parentAreaId: string | null = null): AreaTreeNode
{
	return({ id, parentAreaId });
}

/**
 * The IDs of some areas
 *
 * @param areas The areas
 * @return Their IDs, in order
 */
function ids(areas: readonly AreaTreeNode[]): string[]
{
	return(areas.map((each) => each.id));
}

describe('area tree (shared)', () =>
{
	describe('areasTabListing', () =>
	{
		it('lists the top-level areas apart from the lobby', () =>
		{
			const listing = areasTabListing([area('lobby'), area('north'), area('south'), area('cave', 'north')], 'lobby');

			assert.deepStrictEqual(ids(listing.path), []);
			assert.deepStrictEqual(ids(listing.areas), ['north', 'south']);
		});

		it('passes through a lone area to the areas inside it, until a level has more than one', () =>
		{
			const areas = [
				area('lobby'),
				area('world'),
				area('continent', 'world'),
				area('city', 'continent'),
				area('harbor', 'continent'),
				area('inn', 'city')
			];
			const listing = areasTabListing(areas, 'lobby');

			assert.deepStrictEqual(ids(listing.path), ['world', 'continent']);
			assert.deepStrictEqual(ids(listing.areas), ['city', 'harbor']);
		});

		it('stops at a lone area with nothing inside it', () =>
		{
			const listing = areasTabListing([area('lobby'), area('start')], 'lobby');

			assert.deepStrictEqual(ids(listing.path), []);
			assert.deepStrictEqual(ids(listing.areas), ['start']);
		});

		it('lists nothing when the lobby is the only area', () =>
		{
			assert.deepStrictEqual(areasTabListing([area('lobby'), area('house', 'lobby')], 'lobby'), { path: [], areas: [] });
		});
	});

	describe('childAreas, ancestorAreas and descendantAreaIds', () =>
	{
		const areas = [
			area('world'),
			area('continent', 'world'),
			area('city', 'continent'),
			area('inn', 'city'),
			area('moon')
		];

		it('finds the areas directly inside an area', () =>
		{
			assert.deepStrictEqual(ids(childAreas(areas, 'world')), ['continent']);
			assert.deepStrictEqual(childAreas(areas, 'inn'), []);
		});

		it('finds the areas an area is inside, nearest first', () =>
		{
			assert.deepStrictEqual(ids(ancestorAreas(areas, 'inn')), ['city', 'continent', 'world']);
			assert.deepStrictEqual(ancestorAreas(areas, 'moon'), []);
		});

		it('finds every area inside an area, however deep', () =>
		{
			assert.deepStrictEqual([...descendantAreaIds(areas, 'continent')].sort(), ['city', 'inn']);
			assert.deepStrictEqual([...descendantAreaIds(areas, 'moon')], []);
		});

		it('stops at a parent loop in the data', () =>
		{
			const looped = [area('a', 'b'), area('b', 'a')];

			assert.deepStrictEqual(ids(ancestorAreas(looped, 'a')), ['b']);
			assert.deepStrictEqual([...descendantAreaIds(looped, 'a')], ['b']);
		});
	});
});
