import assert from 'assert';
import { DefaultTileLoss, placeKey, tileChanges, type AreaNode, type PlaceNode, type PlaceRef, type PlaceSettings, type PlaceWorld, type TileReplacementChoice, type TileUsedFor } from '@multiverse-kiln/shared';

const GRASS = 1;
const WOOD_FLOOR = 2;
const SAND = 3;
const STONE = 4;

/**
 * The tiles every test can use: grass and sand outdoors, wood floor indoors, stone for both
 */
const TILE_KINDS: ReadonlyMap<number, TileUsedFor> = new Map([
	[GRASS, { indoors: false, outdoors: true }],
	[WOOD_FLOOR, { indoors: true, outdoors: false }],
	[SAND, { indoors: false, outdoors: true }],
	[STONE, { indoors: true, outdoors: true }]
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
 * An area inside regions
 *
 * @param id Its ID, also its name
 * @param parentIds The regions it is inside
 * @param settings Its own settings, over BLANK
 * @return The area
 */
function area(id: string, parentIds: string[], settings: Partial<PlaceSettings> = {}): AreaNode
{
	return({
		...region(id, parentIds, settings),
		loopsEastWest: false,
		loopsNorthSouth: false
	});
}

/**
 * A world of regions and areas with the test tiles
 *
 * @param regions The regions
 * @param areas The areas
 * @return The world
 */
function world(regions: PlaceNode[], areas: AreaNode[]): PlaceWorld
{
	return({
		regions,
		areas,
		tileKinds: TILE_KINDS,
		lobbyRegionId: null
	});
}

/**
 * The top-level region every test world has: outdoors, lit and flowing normally, with no default tile
 */
const TOP = region('Top', [], {
	indoors: false,
	lightLevel: 'lit',
	passageOfTime: 'flows_normally',
	fogOfWar: true
});

describe('Replacing a default tile', function()
{
	it('lists every place setting a deleted tile, with the areas it gives it to', function()
	{
		const loss = new DefaultTileLoss(world([
			{ ...TOP, defaultTileId: SAND },
			region('Planet', ['Top'], { defaultTileId: GRASS }),
			region('Empty', ['Top'], { defaultTileId: GRASS })
		], [
			area('Field', ['Planet']),
			area('Meadow', ['Planet'], { defaultTileId: GRASS }),
			area('Beach', ['Top'])
		]), GRASS, { kind: 'delete' });

		assert.deepStrictEqual(loss.places, [
			{ place: { kind: 'region', id: 'Planet' }, areaIds: ['Field'], belowKeeper: false },
			{ place: { kind: 'region', id: 'Empty' }, areaIds: [], belowKeeper: false },
			{ place: { kind: 'area', id: 'Meadow' }, areaIds: ['Meadow'], belowKeeper: false }
		]);
	});

	it('offers Inherit only when every area gets a tile from above', function()
	{
		const covered = new DefaultTileLoss(world([
			{ ...TOP, defaultTileId: SAND },
			region('Kingdom', ['Top'], { defaultTileId: GRASS }),
			region('Planet', ['Kingdom'], { defaultTileId: GRASS })
		], [area('Field', ['Planet'])]), GRASS, { kind: 'delete' });
		const planet = covered.places.find((each) => (each.place.id === 'Planet'));

		assert.ok(planet);
		assert.deepStrictEqual(covered.inheritedTiles(planet), [
			{ areaId: 'Field', tileId: SAND, from: [{ kind: 'region', id: 'Top' }] }
		]);

		const uncovered = new DefaultTileLoss(world([
			TOP,
			region('Planet', ['Top'], { defaultTileId: GRASS })
		], [area('Field', ['Planet'])]), GRASS, { kind: 'delete' });
		const [alone] = uncovered.places;

		assert.strictEqual(uncovered.inheritedTiles(alone), undefined);
	});

	it('lets a place that also gives the tile to the other kind keep it, listing the areas of the unchecked kind', function()
	{
		const loss = new DefaultTileLoss(world([
			{ ...TOP, defaultTileId: STONE },
			region('Halls', ['Top'], { indoors: true, lightLevel: 'lit', defaultTileId: STONE })
		], [
			area('Courtyard', ['Top']),
			area('Cellar', ['Top'], { indoors: true, lightLevel: 'dark' }),
			area('Hall', ['Halls'])
		]), STONE, { kind: 'uncheck', indoors: true });

		assert.deepStrictEqual(loss.places, [
			{ place: { kind: 'region', id: 'Halls' }, areaIds: ['Hall'], belowKeeper: false },
			{ place: { kind: 'area', id: 'Cellar' }, areaIds: ['Cellar'], belowKeeper: true }
		]);
	});

	it('names the areas a replacement isn\'t for', function()
	{
		const loss = new DefaultTileLoss(world([{ ...TOP, defaultTileId: STONE }], [
			area('Courtyard', ['Top']),
			area('Cellar', ['Top'], { indoors: true, lightLevel: 'dark' })
		]), STONE, { kind: 'delete' });
		const [top] = loss.places;

		assert.deepStrictEqual(loss.unsuitedAreas(top, GRASS), ['Cellar']);
		assert.deepStrictEqual(loss.unsuitedAreas(top, STONE), ['Courtyard', 'Cellar']);
	});

	it('finds the areas the choices leave without a default tile', function()
	{
		const loss = new DefaultTileLoss(world([TOP, region('Planet', ['Top'], { defaultTileId: GRASS })], [area('Field', ['Planet'])]), GRASS, { kind: 'delete' });
		const inherit = new Map<string, TileReplacementChoice>([[placeKey({ kind: 'region', id: 'Planet' }), { kind: 'inherit' }]]);
		const sand = new Map<string, TileReplacementChoice>([[placeKey({ kind: 'region', id: 'Planet' }), { kind: 'tile', tileId: SAND }]]);

		assert.deepStrictEqual(loss.problems(tileChanges(loss.places, inherit)), [
			{ kind: 'missing', areaId: 'Field', setting: 'defaultTileId' }
		]);
		assert.deepStrictEqual(loss.problems(tileChanges(loss.places, sand)), []);
	});
});
