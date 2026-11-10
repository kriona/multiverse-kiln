import assert from 'assert';

import { areasById, arrivalCell, countCharactersInAreas, enabledAncestor, evacuatedPlaces, membersOverSize, type AreaInTree } from '../../src/logic/disabling.js';

describe('disabling', () =>
{
	describe('enabledAncestor', () =>
	{
		const areas = areasById<AreaInTree>([
			{ id: 'world', parentAreaId: null, enabled: true },
			{ id: 'town', parentAreaId: 'world', enabled: false },
			{ id: 'inn', parentAreaId: 'town', enabled: true },
			{ id: 'island', parentAreaId: null, enabled: true }
		]);

		it('finds the parent when it is enabled', () =>
		{
			assert.deepStrictEqual(enabledAncestor(areas, 'town'), { ancestorId: 'world', passed: ['town'] });
		});

		it('passes over disabled areas on the way up', () =>
		{
			assert.deepStrictEqual(enabledAncestor(areas, 'inn'), { ancestorId: 'world', passed: ['inn', 'town'] });
		});

		it('finds nothing for an area inside no enabled area', () =>
		{
			assert.strictEqual(enabledAncestor(areas, 'island'), undefined);
			assert.strictEqual(enabledAncestor(areasById([{ id: 'cave', parentAreaId: 'gone', enabled: true }]), 'cave'), undefined);
		});

		it('stops at a loop rather than going round it', () =>
		{
			const loop = areasById<AreaInTree>([
				{ id: 'a', parentAreaId: 'b', enabled: false },
				{ id: 'b', parentAreaId: 'a', enabled: false }
			]);

			assert.strictEqual(enabledAncestor(loop, 'a'), undefined);
		});
	});

	describe('arrivalCell', () =>
	{
		const links = [
			{ column: 1, row: 1, targetAreaId: 'cellar' },
			{ column: 4, row: 2, targetAreaId: 'inn' },
			{ column: 6, row: 2, targetAreaId: 'town' }
		];

		it('arrives on the first link leading back toward where they were', () =>
		{
			assert.deepStrictEqual(arrivalCell(links, ['inn', 'town']), { column: 4, row: 2 });
			assert.deepStrictEqual(arrivalCell(links, ['town']), { column: 6, row: 2 });
		});

		it('arrives at the center when no link leads back', () =>
		{
			assert.deepStrictEqual(arrivalCell(links, ['stable']), { column: 0, row: 0 });
		});
	});

	describe('evacuatedPlaces', () =>
	{
		const members = [
			{ characterId: 'ada', groupStart: { areaId: 'field', column: 3, row: 4 } },
			{ characterId: 'grace', groupStart: { areaId: null, column: 9, row: 9 } }
		];

		it('sends everyone to the destination', () =>
		{
			const destination = { areaId: 'town', column: 5, row: 5 };

			assert.deepStrictEqual(evacuatedPlaces(members, destination, null), [
				{ characterId: 'ada', ...destination },
				{ characterId: 'grace', ...destination }
			]);
		});

		it('sends each to their group\'s start, or the universe\'s when the group\'s area is gone', () =>
		{
			assert.deepStrictEqual(evacuatedPlaces(members, null, { areaId: 'meadow', column: 1, row: 2 }), [
				{ characterId: 'ada', areaId: 'field', column: 3, row: 4 },
				{ characterId: 'grace', areaId: 'meadow', column: 1, row: 2 }
			]);
		});

		it('leaves out members with nowhere to go', () =>
		{
			assert.deepStrictEqual(evacuatedPlaces(members, null, null).map((place) => place.characterId), ['ada']);
		});
	});

	describe('membersOverSize', () =>
	{
		const members = [
			{ characterId: 'anchor', joinedAt: new Date(1000) },
			{ characterId: 'first', joinedAt: new Date(2000) },
			{ characterId: 'second', joinedAt: new Date(3000) },
			{ characterId: 'third', joinedAt: new Date(4000) }
		];

		it('takes out those who joined most recently first', () =>
		{
			assert.deepStrictEqual(membersOverSize(members, 'anchor', 2), ['third', 'second']);
		});

		it('never takes out the anchor being, even when they joined last', () =>
		{
			assert.deepStrictEqual(membersOverSize(members, 'third', 1), ['second', 'first', 'anchor']);
		});

		it('takes out nobody from a group that fits', () =>
		{
			assert.deepStrictEqual(membersOverSize(members, 'anchor', 4), []);
			assert.deepStrictEqual(membersOverSize(members, 'anchor', 6), []);
		});

		it('takes out the later of members who joined at the same moment', () =>
		{
			const together = [
				{ characterId: 'anchor', joinedAt: new Date(1000) },
				{ characterId: 'early', joinedAt: new Date(2000) },
				{ characterId: 'late', joinedAt: new Date(2000) }
			];

			assert.deepStrictEqual(membersOverSize(together, 'anchor', 2), ['late']);
		});
	});

	describe('countCharactersInAreas', () =>
	{
		it('counts saved and playing characters, where a room has them counting over where they were saved', () =>
		{
			const saved = [
				{ characterId: 'ada', areaId: 'cave' },
				{ characterId: 'grace', areaId: 'cave' },
				{ characterId: 'linus', areaId: 'town' }
			];
			const playing = [
				{ characterId: 'grace', areaId: 'town' },
				{ characterId: 'ken', areaId: 'cave' }
			];
			const counts = countCharactersInAreas(saved, playing, ['cave', 'town']);

			assert.deepStrictEqual(Object.fromEntries(counts), { cave: 2, town: 2 });
		});

		it('leaves out areas not asked about, and areas nobody is in', () =>
		{
			const counts = countCharactersInAreas([{ characterId: 'ada', areaId: 'cave' }], [], ['town']);

			assert.strictEqual(counts.size, 0);
		});
	});
});
