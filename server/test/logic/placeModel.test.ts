import assert from 'assert';

import type { AreaNode, PlaceNode, PlaceRef, PlaceWorld, TileUsedFor } from '@multiverse-kiln/shared';

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
 * @param parents The regions and area it is inside
 * @return The area
 */
function area(id: string, parents: PlaceRef[]): AreaNode
{
	return({
		...BLANK,
		id,
		name: id,
		parents,
		loopsEastWest: false,
		loopsNorthSouth: false
	});
}

/**
 * A region, as a parent
 *
 * @param id Its ID
 * @return The ref
 */
function inRegion(id: string): PlaceRef
{
	return({ kind: 'region', id });
}

/**
 * An area, as a parent
 *
 * @param id Its ID
 * @return The ref
 */
function inArea(id: string): PlaceRef
{
	return({ kind: 'area', id });
}

/**
 * A world of regions and areas
 *
 * @param regions The regions
 * @param areas The areas
 * @param tileKinds The tiles, by ID
 * @param lobbyRegionId The lobby region
 * @return The world
 */
function world(regions: PlaceNode[], areas: AreaNode[], tileKinds: Map<number, TileUsedFor> = new Map(), lobbyRegionId: string | null = null): PlaceWorld
{
	return({
		regions,
		areas,
		tileKinds,
		lobbyRegionId
	});
}

describe('PlaceModel', () =>
{
	const places = world([
		region('Planet'),
		region('Moon'),
		region('Coast', ['Planet'])
	], [
		area('Town', [inRegion('Planet'), inRegion('Moon')]),
		area('Inn', [inRegion('Coast'), inArea('Town'), inRegion('Moon')]),
		area('Cellar', [inArea('Town')]),
		area('Crater', [inRegion('Moon')])
	]);

	describe('looking places up', () =>
	{
		it('finds the regions and areas it was made with, and nothing for those it doesn\'t have', () =>
		{
			const model = new PlaceModel(places);

			assert.deepStrictEqual(model.region('Coast'), places.regions[2]);
			assert.deepStrictEqual(model.area('Inn'), places.areas[1]);
			assert.strictEqual(model.region('Town'), undefined);
			assert.strictEqual(model.area('Planet'), undefined);
			assert.deepStrictEqual(model.allRegions(), places.regions);
			assert.deepStrictEqual(model.allAreas(), places.areas);
		});

		it('gives the world as the changes so far left it, keeping the tiles it was made with apart', () =>
		{
			const tileKinds = new Map([[1, { indoors: false, outdoors: true }]]);
			const model = new PlaceModel(world([...places.regions], [...places.areas], tileKinds, 'Moon'));

			model.setRegion(region('Sun'));
			model.setTileKind(2, { indoors: true, outdoors: false });
			model.setTileKind(1, undefined);
			model.setLobbyRegion('Sun');

			const changed = model.world();

			assert.deepStrictEqual(changed.regions.map((each) => each.id), ['Planet', 'Moon', 'Coast', 'Sun']);
			assert.deepStrictEqual(changed.areas, places.areas);
			assert.deepStrictEqual([...changed.tileKinds], [[2, { indoors: true, outdoors: false }]]);
			assert.deepStrictEqual([...model.tiles()], [[2, { indoors: true, outdoors: false }]]);
			assert.strictEqual(changed.lobbyRegionId, 'Sun');
			assert.strictEqual(model.lobbyRegion(), 'Sun');
			assert.deepStrictEqual([...tileKinds], [[1, { indoors: false, outdoors: true }]]);

			model.setLobbyRegion(null);

			assert.strictEqual(model.lobbyRegion(), null);
		});
	});

	describe('setRegion and setArea', () =>
	{
		it('add places, and replace them, moving each to its new parents\' children', () =>
		{
			const model = new PlaceModel(places);
			const graph = model.graph();

			model.setRegion(region('Bay', ['Moon']));
			model.setRegion(region('Coast', ['Moon']));
			model.setArea(area('Dock', [inRegion('Bay')]));
			model.setArea({ ...area('Crater', [inRegion('Planet')]), loopsEastWest: true });

			assert.strictEqual(model.graph(), graph);
			assert.deepStrictEqual(model.region('Coast')?.parents, [inRegion('Moon')]);
			assert.strictEqual(model.area('Crater')?.loopsEastWest, true);
			assert.deepStrictEqual(graph.childrenOf(inRegion('Planet')), [inArea('Town'), inArea('Crater')]);
			assert.deepStrictEqual(graph.childrenOf(inRegion('Moon')), [inRegion('Coast'), inRegion('Bay'), inArea('Town'), inArea('Inn')]);
			assert.deepStrictEqual(graph.ancestorsOf(inArea('Dock')), [inRegion('Bay'), inRegion('Moon')]);
		});
	});

	describe('deleteRegion', () =>
	{
		it('takes the region from what it held, keeping their other parents, and gives them', () =>
		{
			const model = new PlaceModel(places);

			assert.deepStrictEqual(model.deleteRegion('Planet'), [inRegion('Coast'), inArea('Town')]);
			assert.strictEqual(model.region('Planet'), undefined);
			assert.deepStrictEqual(model.region('Coast')?.parents, []);
			assert.deepStrictEqual(model.area('Town')?.parents, [inRegion('Moon')]);
			assert.deepStrictEqual(model.graph().childrenOf(inRegion('Planet')), []);
			assert.strictEqual(model.hasRegionNamed('planet', undefined), false);
		});

		it('deletes a region inside itself without going round the loop', () =>
		{
			const model = new PlaceModel(world([region('First', ['Second']), region('Second', ['First'])], [area('Spiral', [inRegion('First')])]));

			assert.deepStrictEqual(model.deleteRegion('First'), [inRegion('Second'), inArea('Spiral')]);
			assert.deepStrictEqual(model.region('Second')?.parents, []);
			assert.deepStrictEqual(model.area('Spiral')?.parents, []);
			assert.deepStrictEqual(model.graph().childrenOf(inRegion('Second')), []);
			assert.strictEqual(model.graph().isInsideItself(inRegion('Second')), false);
		});

		it('gives nothing for a region it doesn\'t have', () =>
		{
			const model = new PlaceModel(places);

			assert.deepStrictEqual(model.deleteRegion('Nowhere'), []);
			assert.deepStrictEqual(model.world(), places);
		});
	});

	describe('deleteArea', () =>
	{
		it('gives the areas inside it its parents after their own, each once, and gives them', () =>
		{
			const model = new PlaceModel(places);
			const moved = model.deleteArea('Town');

			assert.deepStrictEqual(moved, [
				area('Inn', [inRegion('Coast'), inRegion('Moon'), inRegion('Planet')]),
				area('Cellar', [inRegion('Planet'), inRegion('Moon')])
			]);
			assert.deepStrictEqual(moved, [model.area('Inn'), model.area('Cellar')]);
			assert.strictEqual(model.area('Town'), undefined);
			assert.deepStrictEqual(model.graph().childrenOf(inArea('Town')), []);
			assert.deepStrictEqual(model.graph().childrenOf(inRegion('Planet')), [inRegion('Coast'), inArea('Inn'), inArea('Cellar')]);
			assert.deepStrictEqual(model.graph().childrenOf(inRegion('Moon')), [inArea('Inn'), inArea('Cellar'), inArea('Crater')]);
		});

		it('deletes an area with nothing inside it, and gives nothing for one it doesn\'t have', () =>
		{
			const model = new PlaceModel(places);

			assert.deepStrictEqual(model.deleteArea('Crater'), []);
			assert.strictEqual(model.area('Crater'), undefined);
			assert.deepStrictEqual(model.graph().childrenOf(inRegion('Moon')), [inArea('Town'), inArea('Inn')]);
			assert.deepStrictEqual(model.deleteArea('Nowhere'), []);
		});
	});

	describe('resolve', () =>
	{
		it('works out the areas\' settings as the changes so far left them', () =>
		{
			const model = new PlaceModel(world([
				{
					...region('World'),
					indoors: false,
					defaultTileId: 1,
					passageOfTime: 'flows_normally',
					fogOfWar: true
				}
			], [
				area('Field', [inRegion('World')]),
				area('Lost', [])
			], new Map([[1, { indoors: false, outdoors: true }]])));

			let resolution = model.resolve();

			assert.deepStrictEqual(resolution.stored.get('Field'), {
				enabled: true,
				indoors: false,
				lightLevel: null,
				defaultTileId: 1,
				passageOfTime: 'flows_normally',
				faerieMorning: null,
				fogOfWar: true,
				lobby: false
			});
			assert.strictEqual(resolution.stored.has('Lost'), false);
			assert.deepStrictEqual(resolution.problems.filter((problem) => (problem.kind === 'noRegion')), [{ kind: 'noRegion', areaId: 'Lost' }]);

			model.setArea(area('Lost', [inRegion('World')]));
			model.setLobbyRegion('World');
			resolution = model.resolve();

			assert.deepStrictEqual(resolution.problems, []);
			assert.strictEqual(resolution.stored.get('Lost')?.lobby, true);
			assert.strictEqual(resolution.stored.get('Field')?.passageOfTime, null);

			model.setTileKind(1, undefined);

			assert.deepStrictEqual(model.resolve().problems, [
				{ kind: 'missing', areaId: 'Field', setting: 'defaultTileId' },
				{ kind: 'missing', areaId: 'Lost', setting: 'defaultTileId' }
			]);
		});

		it('finds a region the changes put inside itself', () =>
		{
			const model = new PlaceModel(places);

			model.setRegion(region('Planet', ['Coast']));

			assert.deepStrictEqual(model.resolve().problems.filter((problem) => (problem.kind === 'insideItself')), [
				{ kind: 'insideItself', place: inRegion('Planet') },
				{ kind: 'insideItself', place: inRegion('Coast') }
			]);
		});
	});
});
