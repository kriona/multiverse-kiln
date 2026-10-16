import assert from 'assert';
import { ancestorZones, childZones, descendantZoneIds, zonesTabListing, type ZoneTreeNode } from '@multiverse-kiln/shared';

/**
 * A zone with no parent, or inside another
 *
 * @param id The zone's ID
 * @param parentZoneId Its parent's ID, if any
 * @return The zone
 */
function zone(id: string, parentZoneId: string | null = null): ZoneTreeNode
{
	return({ id, parentZoneId });
}

/**
 * The IDs of some zones
 *
 * @param zones The zones
 * @return Their IDs, in order
 */
function ids(zones: readonly ZoneTreeNode[]): string[]
{
	return(zones.map((each) => each.id));
}

describe('zone tree (shared)', () =>
{
	describe('zonesTabListing', () =>
	{
		it('lists the top-level zones apart from the lobby', () =>
		{
			const listing = zonesTabListing([zone('lobby'), zone('north'), zone('south'), zone('cave', 'north')], 'lobby');

			assert.deepStrictEqual(ids(listing.path), []);
			assert.deepStrictEqual(ids(listing.zones), ['north', 'south']);
		});

		it('passes through a lone zone to the zones inside it, until a level has more than one', () =>
		{
			const zones = [
				zone('lobby'),
				zone('world'),
				zone('continent', 'world'),
				zone('city', 'continent'),
				zone('harbor', 'continent'),
				zone('inn', 'city')
			];
			const listing = zonesTabListing(zones, 'lobby');

			assert.deepStrictEqual(ids(listing.path), ['world', 'continent']);
			assert.deepStrictEqual(ids(listing.zones), ['city', 'harbor']);
		});

		it('stops at a lone zone with nothing inside it', () =>
		{
			const listing = zonesTabListing([zone('lobby'), zone('start')], 'lobby');

			assert.deepStrictEqual(ids(listing.path), []);
			assert.deepStrictEqual(ids(listing.zones), ['start']);
		});

		it('lists nothing when the lobby is the only zone', () =>
		{
			assert.deepStrictEqual(zonesTabListing([zone('lobby'), zone('house', 'lobby')], 'lobby'), { path: [], zones: [] });
		});
	});

	describe('childZones, ancestorZones and descendantZoneIds', () =>
	{
		const zones = [
			zone('world'),
			zone('continent', 'world'),
			zone('city', 'continent'),
			zone('inn', 'city'),
			zone('moon')
		];

		it('finds the zones directly inside a zone', () =>
		{
			assert.deepStrictEqual(ids(childZones(zones, 'world')), ['continent']);
			assert.deepStrictEqual(childZones(zones, 'inn'), []);
		});

		it('finds the zones a zone is inside, nearest first', () =>
		{
			assert.deepStrictEqual(ids(ancestorZones(zones, 'inn')), ['city', 'continent', 'world']);
			assert.deepStrictEqual(ancestorZones(zones, 'moon'), []);
		});

		it('finds every zone inside a zone, however deep', () =>
		{
			assert.deepStrictEqual([...descendantZoneIds(zones, 'continent')].sort(), ['city', 'inn']);
			assert.deepStrictEqual([...descendantZoneIds(zones, 'moon')], []);
		});

		it('stops at a parent loop in the data', () =>
		{
			const looped = [zone('a', 'b'), zone('b', 'a')];

			assert.deepStrictEqual(ids(ancestorZones(looped, 'a')), ['b']);
			assert.deepStrictEqual([...descendantZoneIds(looped, 'a')], ['b']);
		});
	});
});
