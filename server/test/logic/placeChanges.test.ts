import assert from 'assert';

import { isWithinAssignments, type AreaNode, type EditorChange, type PlaceNode, type PlaceRef, type PlaceWorld } from '@multiverse-kiln/shared';

import { findDisabledAreas, findLobbyEntries } from '../../src/logic/placeChanges.js';
import { PlaceModel } from '../../src/logic/placeModel.js';

const BLANK = {
	enabled: null,
	indoors: null,
	lightLevel: null,
	defaultTileId: null,
	passageOfTime: null,
	faerieMorning: null,
	fogOfWar: null
} as const;

/**
 * A region
 *
 * @param id Its ID, also its name
 * @param parentIds The regions it is inside
 * @return The region
 */
function region(id: string, parentIds: string[] = []): PlaceNode
{
	return({
		...BLANK,
		id,
		name: id,
		parents: parentIds.map((parentId): PlaceRef => ({ kind: 'region', id: parentId }))
	});
}

/**
 * An area
 *
 * @param id Its ID, also its name
 * @param parentIds The regions it is inside
 * @return The area
 */
function area(id: string, parentIds: string[]): AreaNode
{
	return({
		...region(id, parentIds),
		loopsEastWest: false,
		loopsNorthSouth: false
	});
}

/**
 * A world of regions and areas
 *
 * @param regions The regions
 * @param areas The areas
 * @param lobbyRegionId The lobby region
 * @return The world
 */
function world(regions: PlaceNode[], areas: AreaNode[], lobbyRegionId: string | null = null): PlaceWorld
{
	return({
		regions,
		areas,
		tileKinds: new Map(),
		lobbyRegionId
	});
}

/**
 * A change moving an area into a region
 *
 * @param areaId The area
 * @param regionId The region
 * @return The change
 */
function moveArea(areaId: string, regionId: string): EditorChange
{
	return({
		kind: 'updateArea',
		areaId,
		update: { parents: [{ kind: 'region', id: regionId }] }
	});
}

describe('placeChanges', () =>
{
	const places = world([
		region('Lobby'),
		region('Planet'),
		region('Moon')
	], [
		area('Square', ['Lobby']),
		area('Kingdom', ['Planet']),
		area('Shop', ['Planet']),
		area('Crater', ['Moon'])
	], 'Lobby');

	describe('findDisabledAreas', () =>
	{
		it('finds the areas a region turned off disables, in the order of the areas', () =>
		{
			const changes: EditorChange[] = [
				moveArea('Crater', 'Planet'),
				{ kind: 'updateRegion', regionId: 'Planet', update: { enabled: false } }
			];

			assert.deepStrictEqual([...findDisabledAreas(new PlaceModel(places), changes)], [['Kingdom', 1], ['Shop', 1], ['Crater', 1]]);
		});

		it('finds an area at the last change disabling it, and leaves out one enabled again', () =>
		{
			const changes: EditorChange[] = [
				{ kind: 'updateArea', areaId: 'Shop', update: { enabled: false } },
				{ kind: 'updateRegion', regionId: 'Moon', update: { enabled: false } },
				{ kind: 'updateRegion', regionId: 'Planet', update: { enabled: false } },
				{ kind: 'updateRegion', regionId: 'Moon', update: { enabled: null } }
			];

			assert.deepStrictEqual([...findDisabledAreas(new PlaceModel(places), changes)], [['Shop', 2], ['Kingdom', 2]]);
		});

		it('leaves out areas deleted, and areas disabled before the save', () =>
		{
			const nested = world(places.regions.map((each) => ((each.id === 'Moon') ? { ...each, enabled: false } : each)), [
				...places.areas,
				{ ...area('Cellar', []), parents: [{ kind: 'area', id: 'Shop' }, { kind: 'region', id: 'Moon' }] }
			]);

			assert.deepStrictEqual([...findDisabledAreas(new PlaceModel(nested), [{ kind: 'deleteArea', areaId: 'Shop' }])], []);
			assert.deepStrictEqual([...findDisabledAreas(new PlaceModel(nested), [moveArea('Shop', 'Moon')])], [['Shop', 0]]);
		});

		it('takes time growing with the areas each change reaches, not every area for every change', () =>
		{
			// Looking at every area again after each change, this takes about a second; looking only at
			// the areas each change reaches, a few milliseconds, so the limit leaves room for a slow machine
			const regionIds = Array.from({ length: 20 }, (_, index) => `Region ${index}`);
			const large = world(regionIds.map((id) => region(id)), Array.from({ length: 1000 }, (_, index) => area(`Area ${index}`, [regionIds[index % 20]])), 'Region 0');
			const changes = Array.from({ length: 600 }, (_, index) => moveArea(`Area ${index}`, regionIds[(index + 1) % 20]));
			const start = performance.now();

			findDisabledAreas(new PlaceModel(large), changes);
			findLobbyEntries(new PlaceModel(large), changes);

			const elapsedMs = (performance.now() - start);

			assert.ok((elapsedMs < 200), `Finding the areas took ${Math.round(elapsedMs)} ms`);
		});
	});

	describe('findLobbyEntries', () =>
	{
		it('finds the areas moved below the lobby region, in the order they are found there', () =>
		{
			const changes: EditorChange[] = [
				{ kind: 'updateRegion', regionId: 'Planet', update: { parents: [{ kind: 'region', id: 'Lobby' }] } },
				moveArea('Crater', 'Lobby')
			];

			assert.deepStrictEqual([...findLobbyEntries(new PlaceModel(places), changes)], [['Kingdom', 0], ['Shop', 0], ['Crater', 1]]);
		});

		it('finds the areas of a region made the lobby region, and leaves out those moved out again', () =>
		{
			const changes: EditorChange[] = [
				{ kind: 'universe', update: { lobbyRegionId: 'Planet' } },
				moveArea('Shop', 'Moon')
			];

			assert.deepStrictEqual([...findLobbyEntries(new PlaceModel(places), changes)], [['Kingdom', 0]]);
		});
	});

	describe('a builder\'s save', () =>
	{
		it('checks each change against the places as the changes before it left them, in time growing with the changes', () =>
		{
			// A builder's save sets each area on the model, then checks it against their assignments. Building
			// the graph again for every change, this takes most of a second; with the graph changed in place,
			// a few milliseconds, so the limit leaves room for a slow machine
			const regionIds = Array.from({ length: 20 }, (_, index) => `Region ${index}`);
			const model = new PlaceModel(world([
				region('North'),
				region('South'),
				...regionIds.map((id, index) => region(id, [(((index % 2) === 0) ? 'North' : 'South')]))
			], Array.from({ length: 2000 }, (_, index) => area(`Area ${index}`, [regionIds[index % 20]]))));
			const assigned = new Set(['North']);
			let outside = 0;
			const start = performance.now();

			for (let index = 0; index < 2000; index++)
			{
				const areaId = `Area ${index}`;
				const node = model.area(areaId) as AreaNode;

				model.setArea({ ...node, parents: [{ kind: 'region', id: regionIds[(index * 2) % 20] }] });

				if (!isWithinAssignments(model.graph(), { kind: 'area', id: areaId }, assigned))
				{
					outside++;
				}
			}

			const elapsedMs = (performance.now() - start);

			model.setArea({ ...(model.area('Area 0') as AreaNode), parents: [{ kind: 'region', id: 'Region 1' }] });

			assert.strictEqual(outside, 0);
			assert.strictEqual(isWithinAssignments(model.graph(), { kind: 'area', id: 'Area 0' }, assigned), false);
			assert.ok((elapsedMs < 100), `Checking the changes took ${Math.round(elapsedMs)} ms`);
		});
	});
});
