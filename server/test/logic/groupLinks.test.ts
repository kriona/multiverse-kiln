import assert from 'assert';

import { isGroupTogether, type MemberWhereabouts } from '../../src/logic/groupLinks.js';

/**
 * Looks members up in a table, as the room would
 *
 * @param table Each member's whereabouts; members left out aren't in the room
 * @return The lookup
 */
function lookUp(table: Record<string, MemberWhereabouts>): (memberId: string) => MemberWhereabouts
{
	return((memberId) => (table[memberId] ?? { areaId: undefined, travelling: false }));
}

describe('groupLinks', () =>
{
	describe('isGroupTogether', () =>
	{
		it('lets the group through when every member is in the taker\'s area', () =>
		{
			const whereabouts = lookUp({
				anchor: { areaId: 'city', travelling: false },
				friend: { areaId: 'city', travelling: false }
			});

			assert.strictEqual(isGroupTogether(['anchor', 'friend'], 'friend', whereabouts), true);
		});

		it('lets a group of one through', () =>
		{
			assert.strictEqual(isGroupTogether(['anchor'], 'anchor', lookUp({ anchor: { areaId: 'city', travelling: false } })), true);
		});

		it('refuses while a member, such as the anchor being, isn\'t in the room', () =>
		{
			const whereabouts = lookUp({
				friend: { areaId: 'city', travelling: false }
			});

			assert.strictEqual(isGroupTogether(['anchor', 'friend'], 'friend', whereabouts), false);
		});

		it('refuses while a member is in another area or on their way somewhere', () =>
		{
			const elsewhere = lookUp({
				anchor: { areaId: 'shop', travelling: false },
				friend: { areaId: 'city', travelling: false }
			});
			const travelling = lookUp({
				anchor: { areaId: 'city', travelling: true },
				friend: { areaId: 'city', travelling: false }
			});

			assert.strictEqual(isGroupTogether(['anchor', 'friend'], 'friend', elsewhere), false);
			assert.strictEqual(isGroupTogether(['anchor', 'friend'], 'friend', travelling), false);
		});

		it('refuses a taker who isn\'t a member', () =>
		{
			const whereabouts = lookUp({
				anchor: { areaId: 'city', travelling: false },
				stranger: { areaId: 'city', travelling: false }
			});

			assert.strictEqual(isGroupTogether(['anchor'], 'stranger', whereabouts), false);
		});
	});
});
