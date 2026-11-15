import assert from 'assert';
import { arrivalSquare, blockedArrivals, DEFAULT_TILE_CELL, IMPASSABLE_WALK_SECONDS, universeArrivals, VOID_CELL, type Arrival, type ArrivalArea } from '@multiverse-kiln/shared';

const GRASS = 1;
const WATER = 2;

/**
 * Walk seconds of the tiles every test can use: grass, and water nobody can walk on
 */
const WALK_SECONDS: ReadonlyMap<number, number> = new Map([
	[GRASS, 600],
	[WATER, IMPASSABLE_WALK_SECONDS]
]);

/**
 * An area of 10 x 10 cells from column 0, row 0, of grass
 */
const FIELD: ArrivalArea = {
	bounds: { minColumn: 0, minRow: 0, maxColumn: 9, maxRow: 9 },
	defaultTileId: GRASS
};

/**
 * Looks cells up in a list of painted ones
 *
 * @param painted Each painted cell's value, by "column,row"; the rest hold the default tile
 * @return The value of a cell of the field
 */
function cellsOf(painted: Record<string, number | undefined>): (areaId: string, column: number, row: number) => number | undefined
{
	return((_areaId, column, row) => ((`${column},${row}` in painted) ? painted[`${column},${row}`] : DEFAULT_TILE_CELL));
}

describe('Squares characters are sent to', () =>
{
	const universe: Arrival = { source: { kind: 'universe' }, areaId: 'field', column: 3, row: 4 };

	it('takes a starting square outside its area as the nearest cell inside it, but not the lobby\'s or a link\'s', () =>
	{
		assert.deepStrictEqual(arrivalSquare({ ...universe, column: 12, row: -3 }, FIELD.bounds), { column: 9, row: 0 });
		assert.deepStrictEqual(arrivalSquare({ ...universe, source: { kind: 'lobby' }, column: 12 }, FIELD.bounds), undefined);
		assert.deepStrictEqual(arrivalSquare({ ...universe, source: { kind: 'link', areaId: 'house', column: 1, row: 1 }, row: 10 }, FIELD.bounds), undefined);
		assert.deepStrictEqual(arrivalSquare(universe, FIELD.bounds), { column: 3, row: 4 });
	});

	it('finds squares on a tile nobody can walk on, an Unexplored cell, a tile the universe can\'t use or a default tile nobody can walk on', () =>
	{
		const areas = new Map([['field', FIELD]]);
		const link: Arrival = { source: { kind: 'link', areaId: 'house', column: 1, row: 2 }, areaId: 'field', column: 5, row: 5 };
		const race: Arrival = { source: { kind: 'race', race: { id: 7, key: 'dwarf', name: null } }, areaId: 'field', column: 20, row: 1 };
		const problems = blockedArrivals([universe, link, race], areas, cellsOf({ '3,4': WATER, '5,5': VOID_CELL, '9,1': 99 }), WALK_SECONDS);

		assert.deepStrictEqual(problems, [
			{ kind: 'arrivalBlocked', source: universe.source, areaId: 'field', column: 3, row: 4, tileId: WATER },
			{ kind: 'arrivalBlocked', source: link.source, areaId: 'field', column: 5, row: 5, tileId: null },
			{ kind: 'arrivalBlocked', source: race.source, areaId: 'field', column: 9, row: 1, tileId: 99 }
		]);
		assert.deepStrictEqual(blockedArrivals([universe], new Map([['field', { ...FIELD, defaultTileId: WATER }]]), cellsOf({}), WALK_SECONDS).map((problem) => problem.tileId), [WATER]);
	});

	it('passes squares that can be walked on, cells not known yet and areas not given', () =>
	{
		const areas = new Map([['field', FIELD]]);
		const elsewhere: Arrival = { ...universe, areaId: 'house' };

		assert.deepStrictEqual(blockedArrivals([universe, elsewhere], areas, cellsOf({ '3,4': GRASS }), WALK_SECONDS), []);
		assert.deepStrictEqual(blockedArrivals([universe], areas, cellsOf({ '3,4': undefined }), WALK_SECONDS), []);
	});

	it('lists the universe\'s starting square and the lobby\'s, when they have areas', () =>
	{
		const settings = { startingAreaId: 'field', startingColumn: 1, startingRow: 2, lobbyAreaId: 'square', lobbyColumn: 3, lobbyRow: 4 };

		assert.deepStrictEqual(universeArrivals(settings), [
			{ source: { kind: 'universe' }, areaId: 'field', column: 1, row: 2 },
			{ source: { kind: 'lobby' }, areaId: 'square', column: 3, row: 4 }
		]);
		assert.deepStrictEqual(universeArrivals({ ...settings, startingAreaId: null, lobbyAreaId: null }), []);
	});
});
