import assert from 'assert';

import { isWithinAssignments, PlaceGraph, type AreaNode, type EditorChange, type PlaceNode, type PlaceRef, type PlaceWorld } from '@multiverse-kiln/shared';

import { applyPlaceChange, enabledAreaIds, findDisabledAreas, findLobbyEntries } from '../../src/logic/placeChanges.js';
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

	describe('enabledAreaIds', () =>
	{
		const regions = [
			region('Galaxy'),
			region('Planet', ['Galaxy']),
			{ ...region('Moon'), enabled: false },
			region('Border', ['Planet', 'Moon']),
			{ ...region('Empire', ['Planet']), enabled: true }
		];
		const areas = [
			area('Kingdom', ['Planet']),
			area('Frontier', ['Border']),
			area('Gate', ['Planet', 'Moon']),
			{ ...area('Palace', ['Empire']), enabled: true },
			{ ...area('Shop', ['Planet']), enabled: false },
			{ ...area('Cellar', []), parents: [{ kind: 'area', id: 'Shop' }, { kind: 'region', id: 'Planet' }] } as AreaNode,
			area('Crater', ['Moon']),
			area('Ghost', ['Nowhere'])
		];

		it('finds the areas on with everything above them on, along every path', () =>
		{
			assert.deepStrictEqual(enabledAreaIds(new PlaceGraph(regions, areas)), new Set(['Kingdom', 'Palace', 'Ghost']));
		});

		it('turns off everything below a region off far above, and nothing on another path', () =>
		{
			const graph = new PlaceGraph(regions, areas);

			graph.setRegion({ ...region('Galaxy'), enabled: false });

			assert.deepStrictEqual(enabledAreaIds(graph), new Set(['Ghost']));

			graph.setRegion({ ...region('Galaxy'), enabled: null });
			graph.setRegion(region('Moon'));

			assert.deepStrictEqual(enabledAreaIds(graph), new Set(['Kingdom', 'Frontier', 'Gate', 'Palace', 'Crater', 'Ghost']));
		});

		it('follows regions inside each other round the loop once', () =>
		{
			const loop = [region('First', ['Second']), region('Second', ['First'])];
			const spiral = [area('Spiral', ['First'])];

			assert.deepStrictEqual(enabledAreaIds(new PlaceGraph(loop, spiral)), new Set(['Spiral']));
			assert.deepStrictEqual(enabledAreaIds(new PlaceGraph([loop[0], { ...loop[1], enabled: false }], spiral)), new Set());
		});
	});

	describe('applyPlaceChange', () =>
	{
		const tiled = world([
			{ ...region('Lobby'), defaultTileId: 3 },
			region('Planet'),
			region('Moon')
		], [
			area('Kingdom', ['Planet']),
			area('Shop', ['Planet']),
			{ ...area('Cellar', []), parents: [{ kind: 'area', id: 'Shop' }, { kind: 'region', id: 'Moon' }] }
		], 'Lobby');

		it('makes a region by its ref, with the settings the change gives it', () =>
		{
			const model = new PlaceModel(tiled);
			const settings = {
				...BLANK,
				name: 'Ocean',
				parents: [{ kind: 'region', id: 'Planet' }] as PlaceRef[],
				enabled: false,
				passageOfTime: 'always_noon' as const,
				fogOfWar: true
			};

			applyPlaceChange(model, { kind: 'createRegion', ref: 'new:ocean', region: { ...settings, defaultTileId: 7 } });
			applyPlaceChange(model, { kind: 'createRegion', ref: 'new:sky', region: { ...settings, name: 'Sky', defaultTileId: 'new:tile' } });

			assert.deepStrictEqual(model.region('new:ocean'), { ...settings, id: 'new:ocean', defaultTileId: 7 });
			assert.deepStrictEqual(model.region('new:sky'), { ...settings, id: 'new:sky', name: 'Sky', defaultTileId: null });
			assert.deepStrictEqual(model.graph().childrenOf({ kind: 'region', id: 'Planet' }), [
				{ kind: 'region', id: 'new:ocean' },
				{ kind: 'region', id: 'new:sky' },
				{ kind: 'area', id: 'Kingdom' },
				{ kind: 'area', id: 'Shop' }
			]);
			assert.strictEqual(model.hasRegionNamed('ocean', undefined), true);
		});

		it('makes an area by its ref, not looping unless the change says so', () =>
		{
			const model = new PlaceModel(tiled);

			applyPlaceChange(model, { kind: 'createArea', ref: 'new:cave', area: { name: 'Cave', parents: [{ kind: 'region', id: 'Moon' }], loopsEastWest: true, defaultTileId: 'new:tile' } });
			applyPlaceChange(model, { kind: 'createArea', ref: 'new:pit', area: { name: 'Pit', parents: [{ kind: 'area', id: 'new:cave' }], indoors: true, defaultTileId: 4 } });

			assert.deepStrictEqual(model.area('new:cave'), {
				...area('new:cave', ['Moon']),
				name: 'Cave',
				loopsEastWest: true
			});
			assert.deepStrictEqual(model.area('new:pit'), {
				...area('new:pit', []),
				name: 'Pit',
				parents: [{ kind: 'area', id: 'new:cave' }],
				indoors: true,
				defaultTileId: 4
			});
			assert.deepStrictEqual(model.graph().ancestorsOf({ kind: 'area', id: 'new:pit' }), [{ kind: 'area', id: 'new:cave' }, { kind: 'region', id: 'Moon' }]);
		});

		it('changes a region\'s settings, leaving a default tile made in the save as it was', () =>
		{
			const model = new PlaceModel(tiled);

			applyPlaceChange(model, { kind: 'updateRegion', regionId: 'Lobby', update: { name: 'Hall', enabled: false, defaultTileId: 'new:tile' } });

			assert.deepStrictEqual(model.region('Lobby'), { ...region('Lobby'), name: 'Hall', enabled: false, defaultTileId: 3 });
			assert.strictEqual(model.hasRegionNamed('hall', undefined), true);
			assert.strictEqual(model.hasRegionNamed('lobby', undefined), false);

			applyPlaceChange(model, { kind: 'updateRegion', regionId: 'Lobby', update: { defaultTileId: null, parents: [{ kind: 'region', id: 'Moon' }] } });

			assert.deepStrictEqual(model.region('Lobby'), { ...region('Lobby', ['Moon']), name: 'Hall', enabled: false });
			assert.deepStrictEqual(model.graph().childrenOf({ kind: 'region', id: 'Moon' })[0], { kind: 'region', id: 'Lobby' });
		});

		it('changes an area\'s settings and parents', () =>
		{
			const model = new PlaceModel(tiled);

			applyPlaceChange(model, { kind: 'updateArea', areaId: 'Kingdom', update: { loopsNorthSouth: true, defaultTileId: 5, parents: [{ kind: 'region', id: 'Moon' }] } });

			assert.deepStrictEqual(model.area('Kingdom'), { ...area('Kingdom', ['Moon']), loopsNorthSouth: true, defaultTileId: 5 });
			assert.deepStrictEqual(model.graph().childrenOf({ kind: 'region', id: 'Planet' }), [{ kind: 'area', id: 'Shop' }]);
		});

		it('passes over an update to a region or area it doesn\'t have', () =>
		{
			const model = new PlaceModel(tiled);
			const before = model.world();

			applyPlaceChange(model, { kind: 'updateRegion', regionId: 'Nowhere', update: { enabled: false } });
			applyPlaceChange(model, { kind: 'updateArea', areaId: 'Nowhere', update: { enabled: false } });

			assert.deepStrictEqual(model.world(), before);
		});

		it('deletes a region, taking it from what it held', () =>
		{
			const model = new PlaceModel(tiled);

			applyPlaceChange(model, { kind: 'deleteRegion', regionId: 'Planet' });

			assert.strictEqual(model.region('Planet'), undefined);
			assert.deepStrictEqual(model.area('Kingdom')?.parents, []);
			assert.deepStrictEqual(model.area('Shop')?.parents, []);
		});

		it('deletes an area, giving what was inside it its parents', () =>
		{
			const model = new PlaceModel(tiled);

			applyPlaceChange(model, { kind: 'deleteArea', areaId: 'Shop' });

			assert.strictEqual(model.area('Shop'), undefined);
			assert.deepStrictEqual(model.area('Cellar')?.parents, [{ kind: 'region', id: 'Moon' }, { kind: 'region', id: 'Planet' }]);
		});

		it('leaves the places and the lobby region as they are for other changes', () =>
		{
			const model = new PlaceModel(tiled);
			const before = model.world();

			applyPlaceChange(model, { kind: 'universe', update: { lobbyRegionId: 'Moon' } });

			assert.deepStrictEqual(model.world(), before);
			assert.strictEqual(model.lobbyRegion(), 'Lobby');
		});
	});

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

		it('finds the areas below a region turned off far above, along any of their paths, at the change doing it', () =>
		{
			const deep = world([
				region('Galaxy'),
				region('Planet', ['Galaxy']),
				region('Moon'),
				region('Border', ['Planet', 'Moon'])
			], [
				area('Kingdom', ['Planet']),
				area('Frontier', ['Border']),
				area('Crater', ['Moon'])
			]);
			const changes: EditorChange[] = [
				{ kind: 'updateRegion', regionId: 'Moon', update: { name: 'Luna' } },
				{ kind: 'updateRegion', regionId: 'Galaxy', update: { enabled: false } }
			];

			assert.deepStrictEqual([...findDisabledAreas(new PlaceModel(deep), changes)], [['Kingdom', 1], ['Frontier', 1]]);
		});

		it('leaves out areas the save makes', () =>
		{
			const changes: EditorChange[] = [
				{ kind: 'createArea', ref: 'new:cave', area: { name: 'Cave', parents: [{ kind: 'region', id: 'Planet' }] } },
				{ kind: 'createArea', ref: 'new:pit', area: { name: 'Pit', parents: [{ kind: 'region', id: 'Moon' }], enabled: false } },
				{ kind: 'updateRegion', regionId: 'Planet', update: { enabled: false } }
			];

			assert.deepStrictEqual([...findDisabledAreas(new PlaceModel(places), changes)], [['Kingdom', 2], ['Shop', 2]]);
		});

		it('goes round regions moved inside each other once', () =>
		{
			const changes: EditorChange[] = [
				{ kind: 'updateRegion', regionId: 'Planet', update: { parents: [{ kind: 'region', id: 'Moon' }] } },
				{ kind: 'updateRegion', regionId: 'Moon', update: { parents: [{ kind: 'region', id: 'Planet' }] } },
				{ kind: 'updateRegion', regionId: 'Moon', update: { enabled: false } }
			];

			assert.deepStrictEqual([...findDisabledAreas(new PlaceModel(places), changes)], [['Kingdom', 2], ['Shop', 2], ['Crater', 2]]);
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

		it('finds an area at the last change putting it there, and leaves out those outside again, deleted, or there before', () =>
		{
			const hall = world([...places.regions, region('Hall', ['Lobby'])], [...places.areas], 'Lobby');
			const changes: EditorChange[] = [
				moveArea('Shop', 'Lobby'),
				moveArea('Shop', 'Moon'),
				moveArea('Shop', 'Hall'),
				moveArea('Crater', 'Lobby'),
				moveArea('Crater', 'Moon'),
				moveArea('Kingdom', 'Hall'),
				{ kind: 'deleteArea', areaId: 'Kingdom' },
				moveArea('Square', 'Hall')
			];

			assert.deepStrictEqual([...findLobbyEntries(new PlaceModel(hall), changes)], [['Shop', 2]]);
		});

		it('finds the areas of the lobby region set again after it was cleared, leaving out those there before', () =>
		{
			const changes: EditorChange[] = [
				{ kind: 'universe', update: { lobbyRegionId: null } },
				moveArea('Kingdom', 'Lobby'),
				{ kind: 'universe', update: { lobbyRegionId: 'Lobby' } },
				{ kind: 'universe', update: { lobbyRegionId: 'Lobby' } },
				moveArea('Shop', 'Lobby')
			];

			assert.deepStrictEqual([...findLobbyEntries(new PlaceModel(places), changes)], [['Kingdom', 2], ['Shop', 4]]);
		});

		it('goes round regions moved inside each other once', () =>
		{
			const changes: EditorChange[] = [
				{ kind: 'updateRegion', regionId: 'Planet', update: { parents: [{ kind: 'region', id: 'Lobby' }] } },
				{ kind: 'updateRegion', regionId: 'Lobby', update: { parents: [{ kind: 'region', id: 'Planet' }] } }
			];

			assert.deepStrictEqual([...findLobbyEntries(new PlaceModel(places), changes)], [['Kingdom', 0], ['Shop', 0]]);
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

	describe('region names', () =>
	{
		it('finds the regions with a name, not counting case, as the changes so far left them', () =>
		{
			const model = new PlaceModel(places);

			assert.strictEqual(model.hasRegionNamed('planet', undefined), true);
			assert.strictEqual(model.hasRegionNamed('PLANET', 'Planet'), false);
			assert.strictEqual(model.hasRegionNamed('Mars', undefined), false);

			model.setRegion({ ...region('Planet'), name: 'Mars' });
			model.setRegion(region('Ghost'));

			assert.strictEqual(model.hasRegionNamed('Planet', undefined), false);
			assert.strictEqual(model.hasRegionNamed('mars', 'Moon'), true);
			assert.strictEqual(model.hasRegionNamed('ghost', undefined), true);

			model.deleteRegion('Planet');

			assert.strictEqual(model.hasRegionNamed('Mars', undefined), false);
		});

		it('checks each name in time growing with the changes, not every region for every change', () =>
		{
			// Comparing the name with every region, this takes a few hundred milliseconds; looking it up, a
			// few, so the limit leaves room for a slow machine
			const model = new PlaceModel(world(Array.from({ length: 10000 }, (_, index) => region(`Region ${index}`)), []));
			let taken = 0;
			const start = performance.now();

			for (let index = 0; index < 3000; index++)
			{
				const regionId = `Region ${index}`;
				const name = `Renamed ${index}`;

				if (model.hasRegionNamed(name, regionId))
				{
					taken++;
				}

				model.setRegion({ ...(model.region(regionId) as PlaceNode), name });
			}

			const elapsedMs = (performance.now() - start);

			assert.strictEqual(taken, 0);
			assert.strictEqual(model.hasRegionNamed('renamed 0', 'Region 1'), true);
			assert.ok((elapsedMs < 100), `Checking the names took ${Math.round(elapsedMs)} ms`);
		});
	});
});
