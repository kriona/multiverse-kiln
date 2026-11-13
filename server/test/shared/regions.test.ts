import assert from 'assert';
import { canTakeParent, isWithinAssignments, MAX_PLACE_DEPTH, PlaceGraph, resolveAreaSettings, resolvePlace, type AreaNode, type PlaceNode, type PlaceRef, type PlaceSettings, type PlaceWorld, type TileUsedFor } from '@multiverse-kiln/shared';

const GRASS = 1;
const WOOD_FLOOR = 2;
const SAND = 3;

/**
 * The tiles every test can use: grass and sand outdoors, wood floor indoors
 */
const TILE_KINDS: ReadonlyMap<number, TileUsedFor> = new Map([
	[GRASS, { indoors: false, outdoors: true }],
	[WOOD_FLOOR, { indoors: true, outdoors: false }],
	[SAND, { indoors: false, outdoors: true }]
]);

/**
 * Settings that all inherit
 */
const BLANK: PlaceSettings = {
	enabled: null,
	indoors: null,
	lightLevel: null,
	defaultTileId: null,
	passageOfTime: null,
	faerieMorning: null,
	fogOfWar: null
};

/**
 * Settings that leave nothing to inherit: outdoors, lit, grass, flowing normally, with fog of war
 */
const FULL: PlaceSettings = {
	enabled: null,
	indoors: false,
	lightLevel: 'lit',
	defaultTileId: GRASS,
	passageOfTime: 'flows_normally',
	faerieMorning: null,
	fogOfWar: true
};

/**
 * A region
 *
 * @param id Its ID, also its name
 * @param parentIds The regions it is inside
 * @param settings Its own settings, over BLANK
 * @return The region
 */
function region(id: string, parentIds: string[] = [], settings: Partial<PlaceSettings> = {}): PlaceNode
{
	return({
		...BLANK,
		...settings,
		id,
		name: id,
		parents: parentIds.map((parentId): PlaceRef => ({ kind: 'region', id: parentId }))
	});
}

/**
 * An area
 *
 * @param id Its ID, also its name
 * @param parents Its parents, region IDs, and area IDs written as area:<ID>
 * @param settings Its own settings, over BLANK
 * @return The area
 */
function area(id: string, parents: string[], settings: Partial<PlaceSettings & Pick<AreaNode, 'loopsEastWest' | 'loopsNorthSouth'>> = {}): AreaNode
{
	return({
		...BLANK,
		loopsEastWest: false,
		loopsNorthSouth: false,
		...settings,
		id,
		name: id,
		parents: parents.map((parent): PlaceRef => (parent.startsWith('area:') ? { kind: 'area', id: parent.slice(5) } : { kind: 'region', id: parent }))
	});
}

/**
 * A world of regions and areas, with the test tiles
 *
 * @param regions The regions
 * @param areas The areas
 * @param lobbyAreaId The lobby's area
 * @return The world
 */
function world(regions: PlaceNode[], areas: AreaNode[], lobbyAreaId: string | null = null): PlaceWorld
{
	return({ regions, areas, tileKinds: TILE_KINDS, lobbyAreaId });
}

/**
 * Works out one area's settings
 *
 * @param places The world
 * @param areaId The area
 * @return Its settings
 */
function resolveArea(places: PlaceWorld, areaId: string): ReturnType<typeof resolvePlace>
{
	const graph = new PlaceGraph(places.regions, places.areas);

	return(resolvePlace(graph, { kind: 'area', id: areaId }, places.tileKinds, places.lobbyAreaId));
}

describe('Working out area settings', () =>
{
	it('takes the settings of the region an area is in', () =>
	{
		const places = world([region('Planet', [], FULL)], [area('Kingdom', ['Planet'])]);
		const result = resolveAreaSettings(places);

		assert.deepStrictEqual(result.problems, []);
		assert.deepStrictEqual(result.stored.get('Kingdom'), {
			enabled: true,
			indoors: false,
			lightLevel: null,
			defaultTileId: GRASS,
			passageOfTime: 'flows_normally',
			faerieMorning: null,
			fogOfWar: true
		});
		assert.deepStrictEqual(resolveArea(places, 'Kingdom').indoors, { kind: 'inherited', value: false, from: [{ kind: 'region', id: 'Planet' }] });
	});

	it('keeps an area\'s own settings over its parents\'', () =>
	{
		const places = world([region('Planet', [], FULL)], [area('Shop', ['Planet'], { indoors: true, defaultTileId: WOOD_FLOOR, passageOfTime: 'always_noon' })]);
		const result = resolveAreaSettings(places);

		assert.deepStrictEqual(result.problems, []);
		assert.deepStrictEqual(result.stored.get('Shop'), {
			enabled: true,
			indoors: true,
			lightLevel: 'lit',
			defaultTileId: WOOD_FLOOR,
			passageOfTime: 'always_noon',
			faerieMorning: null,
			fogOfWar: true
		});
	});

	it('works out fog of war like the other settings: its own, inherited, conflicting or missing', () =>
	{
		const regions = [
			region('Planet', [], FULL),
			region('Lobby', [], { ...FULL, fogOfWar: false }),
			region('Blank', [], { ...FULL, fogOfWar: null })
		];
		const places = world(regions, [
			area('Square', ['Lobby']),
			area('Kingdom', ['Planet']),
			area('Clearing', ['Planet'], { fogOfWar: false }),
			area('Border', ['Planet', 'Lobby']),
			area('Nowhere', ['Blank'])
		]);
		const result = resolveAreaSettings(places);

		assert.strictEqual(result.stored.get('Square')?.fogOfWar, false);
		assert.strictEqual(result.stored.get('Kingdom')?.fogOfWar, true);
		assert.deepStrictEqual(resolveArea(places, 'Clearing').fogOfWar, { kind: 'own', value: false });
		assert.deepStrictEqual(result.problems, [
			{
				kind: 'conflict',
				areaId: 'Border',
				setting: 'fogOfWar',
				values: [
					{ place: { kind: 'region', id: 'Planet' }, value: true },
					{ place: { kind: 'region', id: 'Lobby' }, value: false }
				]
			},
			{ kind: 'missing', areaId: 'Nowhere', setting: 'fogOfWar' }
		]);
	});

	it('finds a conflict between parents whatever their order', () =>
	{
		const regions = [
			region('Planet', [], FULL),
			region('Noon', [], { passageOfTime: 'always_noon' }),
			region('Dusk', [], { passageOfTime: 'always_dusk' })
		];

		for (const parents of [['Planet', 'Noon', 'Dusk'], ['Dusk', 'Planet', 'Noon']])
		{
			const result = resolveAreaSettings(world(regions, [area('Market', parents)]));
			const conflicts = result.problems.filter((problem) => (problem.kind === 'conflict'));

			assert.strictEqual(conflicts.length, 1);
			assert.strictEqual(conflicts[0].kind, 'conflict');
			assert.strictEqual((conflicts[0].kind === 'conflict') ? conflicts[0].setting : undefined, 'passageOfTime');
			assert.strictEqual(result.stored.has('Market'), false);
		}
	});

	it('takes the same value from two parents without a conflict', () =>
	{
		const places = world([region('Planet', [], FULL), region('Bea', [], { indoors: false })], [area('Kingdom', ['Planet', 'Bea'])]);
		const resolution = resolveArea(places, 'Kingdom');

		assert.deepStrictEqual(resolveAreaSettings(places).problems, []);
		assert.deepStrictEqual(resolution.indoors, { kind: 'inherited', value: false, from: [{ kind: 'region', id: 'Planet' }, { kind: 'region', id: 'Bea' }] });
	});

	it('passes over blank regions, causing neither a conflict nor a missing value', () =>
	{
		const places = world([region('Planet', [], FULL), region('Bea')], [area('Kingdom', ['Planet', 'Bea'])]);

		assert.deepStrictEqual(resolveAreaSettings(places).problems, []);
	});

	it('goes up a level when the parents set nothing', () =>
	{
		const places = world([region('Planet', [], FULL), region('Capitol', ['Planet']), region('Market', ['Capitol'])], [area('Stall', ['Market'])]);

		assert.deepStrictEqual(resolveAreaSettings(places).problems, []);
		assert.deepStrictEqual(resolveArea(places, 'Stall').defaultTileId, { kind: 'inherited', value: GRASS, from: [{ kind: 'region', id: 'Planet' }] });
	});

	it('takes the nearest level\'s value over one further up', () =>
	{
		const places = world([region('Planet', [], FULL), region('Capitol', ['Planet'], { passageOfTime: 'always_dusk' })], [area('Square', ['Capitol', 'Planet'])]);

		// Planet is reached at the first level, beside Capitol, and conflicts with it there
		assert.strictEqual(resolveArea(places, 'Square').passageOfTime.kind, 'conflict');

		const nested = world([region('Planet', [], FULL), region('Capitol', ['Planet'], { passageOfTime: 'always_dusk' })], [area('Square', ['Capitol'])]);

		assert.deepStrictEqual(resolveArea(nested, 'Square').passageOfTime, { kind: 'inherited', value: { passageOfTime: 'always_dusk', faerieMorning: null }, from: [{ kind: 'region', id: 'Capitol' }] });
	});

	it('counts a region reached twice once, at the nearest level', () =>
	{
		// Planet is reached through both West and East, and through Old at the next level
		const regions = [
			region('Planet', [], FULL),
			region('West', ['Planet']),
			region('East', ['Planet']),
			region('Old', ['West'])
		];
		const places = world(regions, [area('Ford', ['West', 'East', 'Old'])]);
		const graph = new PlaceGraph(places.regions, places.areas);

		assert.deepStrictEqual(graph.levelsAbove({ kind: 'area', id: 'Ford' }), [
			[{ kind: 'region', id: 'West' }, { kind: 'region', id: 'East' }, { kind: 'region', id: 'Old' }],
			[{ kind: 'region', id: 'Planet' }]
		]);
		assert.deepStrictEqual(resolveArea(places, 'Ford').indoors, { kind: 'inherited', value: false, from: [{ kind: 'region', id: 'Planet' }] });
	});

	it('goes up past a parent area to its regions', () =>
	{
		const places = world([region('Planet', [], FULL)], [
			area('Shop', ['Planet'], { indoors: true, defaultTileId: WOOD_FLOOR }),
			area('Cellar', ['area:Shop'], { lightLevel: 'dark' })
		]);
		const result = resolveAreaSettings(places);

		assert.deepStrictEqual(result.problems, []);
		assert.deepStrictEqual(result.stored.get('Cellar'), {
			enabled: true,
			indoors: true,
			lightLevel: 'dark',
			defaultTileId: WOOD_FLOOR,
			passageOfTime: 'flows_normally',
			faerieMorning: null,
			fogOfWar: true
		});
	});

	it('disables an area while anything above it is off, along any path', () =>
	{
		const places = world([region('Planet', [], FULL), region('Bea', [], { enabled: false })], [
			area('Kingdom', ['Planet', 'Bea'], { enabled: true }),
			area('Town', ['area:Kingdom']),
			area('Field', ['Planet'])
		]);
		const result = resolveAreaSettings(places);

		assert.strictEqual(result.stored.get('Kingdom')?.enabled, false);
		assert.strictEqual(result.stored.get('Town')?.enabled, false);
		assert.strictEqual(result.stored.get('Field')?.enabled, true);
		assert.deepStrictEqual(resolveArea(places, 'Town').enabled.disabledBy, [{ kind: 'region', id: 'Bea' }]);
	});

	it('reports a missing value when nothing above sets it', () =>
	{
		const places = world([region('Planet', [], { ...FULL, defaultTileId: null })], [area('Kingdom', ['Planet'])]);
		const result = resolveAreaSettings(places);

		assert.deepStrictEqual(result.problems, [{ kind: 'missing', areaId: 'Kingdom', setting: 'defaultTileId' }]);
		assert.strictEqual(result.stored.has('Kingdom'), false);
	});

	it('ignores the light level of an outdoor area', () =>
	{
		const places = world([region('Planet', [], { ...FULL, lightLevel: null })], [area('Kingdom', ['Planet'])]);

		assert.deepStrictEqual(resolveAreaSettings(places).problems, []);
		assert.deepStrictEqual(resolveArea(places, 'Kingdom').lightLevel, { kind: 'ignored' });
	});

	it('passes over a default tile not for the area\'s kind', () =>
	{
		const places = world([region('Planet', [], FULL)], [area('Shop', ['Planet'], { indoors: true })]);

		// Grass is only for outdoors, so the shop has no default tile
		assert.deepStrictEqual(resolveAreaSettings(places).problems, [{ kind: 'missing', areaId: 'Shop', setting: 'defaultTileId' }]);

		const nested = world([region('Planet', [], FULL), region('Inside', ['Planet'], { defaultTileId: WOOD_FLOOR })], [area('Hall', ['Inside'], { indoors: true })]);

		assert.deepStrictEqual(resolveArea(nested, 'Hall').defaultTileId, { kind: 'inherited', value: WOOD_FLOOR, from: [{ kind: 'region', id: 'Inside' }] });
	});

	it('finds two different faerie mornings conflicting', () =>
	{
		const places = world([
			region('Planet', [], FULL),
			region('East', [], { passageOfTime: 'faerie', faerieMorning: 'east' }),
			region('West', [], { passageOfTime: 'faerie', faerieMorning: 'west' })
		], [area('Glade', ['Planet', 'East', 'West'])]);

		assert.strictEqual(resolveArea(places, 'Glade').passageOfTime.kind, 'conflict');

		const same = world([region('Planet', [], FULL), region('East', [], { passageOfTime: 'faerie', faerieMorning: 'east' })], [area('Glade', ['East', 'East'])]);

		assert.deepStrictEqual(resolveArea(same, 'Glade').passageOfTime.kind, 'inherited');
	});

	it('refuses faerie time in an area that loops', () =>
	{
		const places = world([region('Planet', [], { ...FULL, passageOfTime: 'faerie', faerieMorning: 'north' })], [area('Glade', ['Planet'], { loopsEastWest: true })]);

		assert.deepStrictEqual(resolveAreaSettings(places).problems, [{ kind: 'faerieLoops', areaId: 'Glade' }]);
	});

	it('gives the lobby\'s area no passage of time', () =>
	{
		const places = world([region('Lobby', [], { ...FULL, passageOfTime: null })], [area('Square', ['Lobby'])], 'Square');
		const result = resolveAreaSettings(places);

		assert.deepStrictEqual(result.problems, []);
		assert.strictEqual(result.stored.get('Square')?.passageOfTime, null);
	});

	it('finds areas in no region', () =>
	{
		const places = world([region('Planet', [], FULL)], [area('Shop', ['Planet']), area('Cellar', ['area:Shop']), area('Lost', [])]);

		assert.deepStrictEqual(resolveAreaSettings(places).problems.filter((problem) => (problem.kind === 'noRegion')), [{ kind: 'noRegion', areaId: 'Lost' }]);
	});

	it('finds a region inside itself, directly or further down', () =>
	{
		const places = world([region('Planet', ['Moon'], FULL), region('Moon', ['Planet'])], []);

		assert.deepStrictEqual(resolveAreaSettings(places).problems, [
			{ kind: 'insideItself', place: { kind: 'region', id: 'Planet' } },
			{ kind: 'insideItself', place: { kind: 'region', id: 'Moon' } }
		]);
	});

	it('finds places nested more than ten levels deep along their longest path', () =>
	{
		const regions = [region('r1', [], FULL)];

		for (let depth = 2; depth <= MAX_PLACE_DEPTH; depth++)
		{
			regions.push(region(`r${depth}`, [`r${depth - 1}`]));
		}

		// Ten levels deep through r9, but eleven through r10
		const places = world(regions, [area('Deep', ['r1', 'r10'])]);

		assert.deepStrictEqual(resolveAreaSettings(places).problems, [{ kind: 'tooDeep', place: { kind: 'area', id: 'Deep' } }]);
		assert.deepStrictEqual(resolveAreaSettings(world(regions, [area('Deep', ['r9'])])).problems, []);
	});

	it('offers only parents that keep a place out of itself and within ten levels', () =>
	{
		const regions = [region('Planet', [], FULL), region('Capitol', ['Planet']), region('Bea')];
		const graph = new PlaceGraph(regions, [area('Shop', ['Capitol'])]);
		const planet: PlaceRef = { kind: 'region', id: 'Planet' };

		assert.strictEqual(canTakeParent(graph, planet, { kind: 'region', id: 'Capitol' }), false);
		assert.strictEqual(canTakeParent(graph, planet, planet), false);
		assert.strictEqual(canTakeParent(graph, planet, { kind: 'area', id: 'Shop' }), false);
		assert.strictEqual(canTakeParent(graph, planet, { kind: 'region', id: 'Bea' }), true);

		const chain = [region('r1')];

		for (let depth = 2; depth <= (MAX_PLACE_DEPTH - 1); depth++)
		{
			chain.push(region(`r${depth}`, [`r${depth - 1}`]));
		}

		const deep = new PlaceGraph([...chain, region('Top'), region('Middle', ['Top'])], [area('Leaf', ['Middle'])]);

		// Middle holds one level below it, so it can go under r8 (making it 9 deep and Leaf 10) but not r9
		assert.strictEqual(canTakeParent(deep, { kind: 'region', id: 'Middle' }, { kind: 'region', id: 'r8' }), true);
		assert.strictEqual(canTakeParent(deep, { kind: 'region', id: 'Middle' }, { kind: 'region', id: 'r9' }), false);
	});

	it('finds whether a place is within a builder\'s assignments', () =>
	{
		const graph = new PlaceGraph([region('Planet'), region('Bea'), region('Capitol', ['Planet', 'Bea'])], [area('Shop', ['Capitol']), area('Cellar', ['area:Shop']), area('Field', ['Planet'])]);
		const assigned = new Set(['Bea']);

		assert.strictEqual(isWithinAssignments(graph, { kind: 'region', id: 'Bea' }, assigned), true);
		assert.strictEqual(isWithinAssignments(graph, { kind: 'region', id: 'Capitol' }, assigned), true);
		assert.strictEqual(isWithinAssignments(graph, { kind: 'area', id: 'Cellar' }, assigned), true);
		assert.strictEqual(isWithinAssignments(graph, { kind: 'area', id: 'Field' }, assigned), false);
		assert.strictEqual(isWithinAssignments(graph, { kind: 'region', id: 'Planet' }, assigned), false);
	});
});
