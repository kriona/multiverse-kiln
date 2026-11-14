import assert from 'assert';
import { areasWithMisalignedLoops, canSee, carriedResizes, chainLoops, chainOf, createVisionArea, halfLoopingEnd, locateCell, loopPlace, misalignedLoops, neighborProblems, neighborRefusal, newNeighbor, NO_NEIGHBORS, overallMapLayout, seamSides, seamSlots, visibleCells, windowsAcrossSeams, withNeighbors, type AreaBounds, type AreaNeighbors, type GridArea, type NeighborGrid, type SeamLookup } from '@multiverse-kiln/shared';

/**
 * A square area of 32 x 32 cells, the smallest that can have neighbors, centered on column 0, row 0
 */
const SQUARE: AreaBounds = { minColumn: -16, minRow: -16, maxColumn: 15, maxRow: 15 };

/**
 * An area for a grid
 *
 * @param id Its ID
 * @param neighbors Its neighbors, none on the sides left out
 * @param settings Its bounds and whether it loops, a square that doesn't by default
 * @return The area
 */
function area(id: string, neighbors: Partial<AreaNeighbors> = {}, settings: Partial<GridArea> = {}): GridArea
{
	return({
		id,
		bounds: SQUARE,
		neighbors: { ...NO_NEIGHBORS, ...neighbors },
		loopsEastWest: false,
		loopsNorthSouth: false,
		...settings
	});
}

/**
 * A grid of areas
 *
 * @param areas The areas
 * @return The grid, by ID
 */
function gridOf(...areas: GridArea[]): NeighborGrid
{
	return(new Map(areas.map((each) => [each.id, each])));
}

/**
 * Finds areas of a grid as the seams see them
 *
 * @param grid The grid
 * @return The lookup
 */
function lookupOf(grid: NeighborGrid): SeamLookup
{
	return((areaId) =>
	{
		const found = grid.get(areaId);

		return(found && { id: areaId, bounds: found.bounds, sides: seamSides(grid, areaId) });
	});
}

/**
 * A 2 x 2 grid: Town and Forest on top, Fields and Marsh below, the top row looping when asked
 *
 * @param topLoops Whether Town and Forest loop east-west
 * @return The grid
 */
function twoByTwo(topLoops = false): NeighborGrid
{
	return(gridOf(
		area('Town', { east: 'Forest', south: 'Fields' }, { loopsEastWest: topLoops }),
		area('Forest', { west: 'Town', south: 'Marsh' }, { loopsEastWest: topLoops }),
		area('Fields', { north: 'Town', east: 'Marsh' }),
		area('Marsh', { north: 'Forest', west: 'Fields' })
	));
}

describe('neighboring areas', () =>
{
	describe('neighborProblems', () =>
	{
		it('finds nothing wrong with a consistent grid, a ring, or two grids joined', () =>
		{
			assert.deepStrictEqual(neighborProblems(twoByTwo()), []);
			assert.deepStrictEqual(neighborProblems(gridOf(
				area('Town', { east: 'Forest', west: 'Plains' }),
				area('Forest', { west: 'Town', east: 'Plains' }),
				area('Plains', { west: 'Forest', east: 'Town' })
			)), []);
		});

		it('finds a neighbor that isn\'t one both ways', () =>
		{
			assert.deepStrictEqual(neighborProblems(gridOf(area('Town', { east: 'Forest' }), area('Forest'))), [
				{ kind: 'neighborOneWay', areaId: 'Town', side: 'east', neighborAreaId: 'Forest' }
			]);
		});

		it('finds touching sides of different lengths, once for each seam', () =>
		{
			const tall: AreaBounds = { ...SQUARE, maxRow: 20 };

			assert.deepStrictEqual(neighborProblems(gridOf(area('Town', { east: 'Forest' }), area('Forest', { west: 'Town' }, { bounds: tall }))), [
				{ kind: 'neighborSides', areaId: 'Town', side: 'east', neighborAreaId: 'Forest' }
			]);
		});

		it('finds an area with neighbors under 32 cells either way', () =>
		{
			const small: AreaBounds = { minColumn: -10, minRow: -16, maxColumn: 10, maxRow: 15 };

			assert.deepStrictEqual(neighborProblems(gridOf(area('Town', { east: 'Forest' }, { bounds: small }), area('Forest', { west: 'Town' }))), [
				{ kind: 'neighborTooSmall', areaId: 'Town' }
			]);
		});

		it('finds going north then west reaching another area than going west then north', () =>
		{
			const grid = gridOf(
				area('Town', { north: 'Hills', west: 'Fields' }),
				area('Hills', { south: 'Town', west: 'Peaks' }),
				area('Fields', { east: 'Town', north: 'Woods' }),
				area('Peaks', { east: 'Hills' }),
				area('Woods', { south: 'Fields' })
			);

			assert.deepStrictEqual(neighborProblems(grid), [
				{ kind: 'neighborGrid', areaId: 'Town', first: 'north', second: 'west', firstReached: 'Peaks', secondReached: 'Woods' }
			]);
		});
	});

	describe('chains', () =>
	{
		it('finds a row from its west end, and a ring from the area asked about', () =>
		{
			assert.deepStrictEqual(chainOf(twoByTwo(), 'Forest', 'eastWest'), { areaIds: ['Town', 'Forest'], ring: false });
			assert.deepStrictEqual(chainOf(twoByTwo(), 'Fields', 'northSouth'), { areaIds: ['Town', 'Fields'], ring: false });
			assert.deepStrictEqual(chainOf(gridOf(
				area('Town', { east: 'Forest', west: 'Plains' }),
				area('Forest', { west: 'Town', east: 'Plains' }),
				area('Plains', { west: 'Forest', east: 'Town' })
			), 'Forest', 'eastWest'), { areaIds: ['Forest', 'Plains', 'Town'], ring: true });
		});

		it('loops only when both ends of a chain are checked, and a ring always', () =>
		{
			assert.strictEqual(chainLoops(twoByTwo(true), 'Town', 'eastWest'), true);
			assert.strictEqual(chainLoops(twoByTwo(false), 'Town', 'eastWest'), false);

			const oneEnd = gridOf(area('Town', { east: 'Forest' }, { loopsEastWest: true }), area('Forest', { west: 'Town' }));

			assert.strictEqual(chainLoops(oneEnd, 'Forest', 'eastWest'), false);
			assert.strictEqual(halfLoopingEnd(oneEnd, 'Town', 'eastWest'), 'Forest');
			assert.strictEqual(halfLoopingEnd(oneEnd, 'Forest', 'eastWest'), 'Town');
			assert.strictEqual(halfLoopingEnd(twoByTwo(true), 'Town', 'eastWest'), undefined);
			assert.strictEqual(chainLoops(gridOf(
				area('Town', { east: 'Forest', west: 'Forest' }),
				area('Forest', { west: 'Town', east: 'Town' })
			), 'Town', 'eastWest'), true);
		});

		it('finds rows side by side that don\'t loop alike', () =>
		{
			// The top row loops and the bottom doesn't
			const topOnly = twoByTwo(true);

			assert.deepStrictEqual(misalignedLoops(topOnly, 'Town', 'eastWest'), ['Fields']);
			assert.deepStrictEqual(misalignedLoops(topOnly, 'Marsh', 'eastWest'), ['Forest']);
			assert.deepStrictEqual(areasWithMisalignedLoops(topOnly).toSorted(), ['Fields', 'Forest', 'Marsh', 'Town']);

			// Both rows loop, or neither
			const bothLoop = gridOf(
				area('Town', { east: 'Forest', south: 'Fields' }, { loopsEastWest: true }),
				area('Forest', { west: 'Town', south: 'Marsh' }, { loopsEastWest: true }),
				area('Fields', { north: 'Town', east: 'Marsh' }, { loopsEastWest: true }),
				area('Marsh', { north: 'Forest', west: 'Fields' }, { loopsEastWest: true })
			);

			assert.deepStrictEqual(areasWithMisalignedLoops(bothLoop), []);
			assert.deepStrictEqual(areasWithMisalignedLoops(twoByTwo(false)), []);

			// A ring beside a row that doesn't loop
			const ringOverRow = gridOf(
				area('Town', { east: 'Forest', west: 'Forest', south: 'Fields' }),
				area('Forest', { west: 'Town', east: 'Town', south: 'Marsh' }),
				area('Fields', { north: 'Town', east: 'Marsh' }),
				area('Marsh', { north: 'Forest', west: 'Fields' })
			);

			assert.deepStrictEqual(misalignedLoops(ringOverRow, 'Fields', 'eastWest'), ['Town']);

			// An L-shaped grid that doesn't loop, and a row that loops over an area that stands alone
			const lShape = gridOf(
				area('Town', { east: 'Forest' }),
				area('Forest', { west: 'Town', south: 'Marsh' }),
				area('Marsh', { north: 'Forest' })
			);
			const loopOverOne = gridOf(
				area('Town', { east: 'Forest' }, { loopsEastWest: true }),
				area('Forest', { west: 'Town', south: 'Marsh' }, { loopsEastWest: true }),
				area('Marsh', { north: 'Forest' })
			);

			assert.deepStrictEqual(areasWithMisalignedLoops(lShape), []);
			assert.deepStrictEqual(areasWithMisalignedLoops(loopOverOne), []);
		});

		it('says whether an area\'s own checkbox counts', () =>
		{
			const row = gridOf(
				area('West', { east: 'Middle' }),
				area('Middle', { west: 'West', east: 'East' }),
				area('East', { west: 'Middle' })
			);

			assert.strictEqual(loopPlace(row, 'West', 'eastWest'), 'end');
			assert.strictEqual(loopPlace(row, 'Middle', 'eastWest'), 'middle');
			assert.strictEqual(loopPlace(row, 'Middle', 'northSouth'), 'end');
			assert.strictEqual(loopPlace(gridOf(
				area('Town', { east: 'Forest', west: 'Forest' }),
				area('Forest', { west: 'Town', east: 'Town' })
			), 'Town', 'eastWest'), 'ring');
		});

		it('leads off the end of a looping chain to its other end, and nowhere off one that doesn\'t loop', () =>
		{
			assert.deepStrictEqual(seamSides(twoByTwo(true), 'Town'), { north: null, east: 'Forest', south: 'Fields', west: 'Forest' });
			assert.deepStrictEqual(seamSides(twoByTwo(false), 'Town'), { north: null, east: 'Forest', south: 'Fields', west: null });

			// An area alone that loops leads back onto itself
			assert.deepStrictEqual(seamSides(gridOf(area('Town', { south: 'Fields' }, { loopsEastWest: true }), area('Fields', { north: 'Town' })), 'Town'), { north: null, east: 'Town', south: 'Fields', west: 'Town' });
		});
	});

	describe('carriedResizes', () =>
	{
		it('makes the rest of the row taller and the rest of the column wider on the same side', () =>
		{
			const taller: AreaBounds = { ...SQUARE, minRow: SQUARE.minRow - 4 };
			const wider: AreaBounds = { ...SQUARE, maxColumn: SQUARE.maxColumn + 3 };

			assert.deepStrictEqual(carriedResizes(twoByTwo(), 'Town', SQUARE, taller), new Map([['Forest', taller]]));
			assert.deepStrictEqual(carriedResizes(twoByTwo(), 'Town', SQUARE, wider), new Map([['Fields', wider]]));
			assert.deepStrictEqual(carriedResizes(twoByTwo(), 'Town', SQUARE, SQUARE), new Map());
		});
	});

	describe('choosing and adding neighbors', () =>
	{
		it('offers an area that fits a place, and says why others don\'t', () =>
		{
			const grid = gridOf(
				area('Town', { south: 'Fields' }),
				area('Fields', { north: 'Town' }),
				area('Forest'),
				area('Tiny', {}, { bounds: { minColumn: 0, minRow: 0, maxColumn: 9, maxRow: 9 } }),
				area('Tall', {}, { bounds: { ...SQUARE, maxRow: 40 } }),
				area('Taken', { west: 'Elsewhere' }),
				area('Elsewhere', { east: 'Taken' })
			);

			assert.strictEqual(neighborRefusal(grid, 'Town', 'east', 'Forest'), undefined);
			assert.strictEqual(neighborRefusal(grid, 'Town', 'east', 'Town'), 'itself');
			assert.strictEqual(neighborRefusal(grid, 'Town', 'east', 'Tiny'), 'tooSmall');
			assert.strictEqual(neighborRefusal(grid, 'Town', 'east', 'Tall'), 'size');
			assert.strictEqual(neighborRefusal(grid, 'Town', 'east', 'Taken'), 'taken');
		});

		it('joins a chosen area to every area next to its place', () =>
		{
			const grid = gridOf(
				area('Town', { east: 'Forest', south: 'Fields' }),
				area('Forest', { west: 'Town' }),
				area('Fields', { north: 'Town' }),
				area('Marsh')
			);
			const joined = withNeighbors(grid, 'Marsh', new Map([['north', 'Forest'], ['west', 'Fields']]));

			assert.deepStrictEqual(joined.get('Marsh')?.neighbors, { north: 'Forest', east: null, south: null, west: 'Fields' });
			assert.deepStrictEqual(neighborProblems(joined), []);
		});

		it('gives a new neighbor its row\'s height and its column\'s width', () =>
		{
			const wide: AreaBounds = { minColumn: -30, minRow: -16, maxColumn: 29, maxRow: 15 };
			const grid = gridOf(
				area('Town', { east: 'Forest', south: 'Fields' }),
				area('Forest', { west: 'Town' }, { bounds: wide }),
				area('Fields', { north: 'Town' }, { bounds: { ...SQUARE, maxRow: 30 } })
			);
			const added = newNeighbor(grid, 'Fields', 'east');

			assert.ok(typeof added !== 'string');
			assert.deepStrictEqual(added.bounds, { minColumn: wide.minColumn, maxColumn: wide.maxColumn, minRow: SQUARE.minRow, maxRow: 30 });
			assert.deepStrictEqual(added.joins, new Map([['west', 'Fields'], ['north', 'Forest']]));
			assert.strictEqual(newNeighbor(grid, 'Town', 'east'), 'taken');
		});
	});

	describe('locateCell', () =>
	{
		it('finds a cell past an edge in the neighbor across the seam, row by row from the north', () =>
		{
			const lookup = lookupOf(twoByTwo());

			assert.deepStrictEqual(locateCell(lookup, 'Town', 16, -3), { areaId: 'Forest', column: -16, row: -3 });
			assert.deepStrictEqual(locateCell(lookup, 'Town', 3, 17), { areaId: 'Fields', column: 3, row: -15 });
			assert.deepStrictEqual(locateCell(lookup, 'Town', 17, 16), { areaId: 'Marsh', column: -15, row: -16 });
			assert.strictEqual(locateCell(lookup, 'Town', -17, 0), undefined);
		});

		it('walks west off the west end of a looping chain onto the east end', () =>
		{
			assert.deepStrictEqual(locateCell(lookupOf(twoByTwo(true)), 'Town', -17, 4), { areaId: 'Forest', column: 15, row: 4 });
		});

		it('finds nothing at a corner with no area diagonally across it', () =>
		{
			const grid = gridOf(
				area('Town', { east: 'Forest', south: 'Fields' }),
				area('Forest', { west: 'Town' }),
				area('Fields', { north: 'Town' })
			);

			assert.strictEqual(locateCell(lookupOf(grid), 'Town', 16, 16), undefined);
		});

		it('lays out the places around an area, and the cells of them near one of its own', () =>
		{
			const lookup = lookupOf(twoByTwo());
			const slots = seamSlots(lookup, 'Town');

			assert.deepStrictEqual(slots.map((slot) => [slot.areaId, slot.columnOffset, slot.rowOffset]), [
				['Forest', 32, 0],
				['Fields', 0, 32],
				['Marsh', 32, 32]
			]);
			assert.deepStrictEqual(windowsAcrossSeams(lookup, slots, 'Town', 14, 0, 4), [
				{ areaId: 'Forest', bounds: { minColumn: -16, minRow: -4, maxColumn: -14, maxRow: 4 } }
			]);
		});
	});

	describe('vision across seams', () =>
	{
		it('sees into a neighbor and is blocked by its walls', () =>
		{
			const tiles = (wall: boolean) => ({ bounds: SQUARE, defaultTileId: (wall ? 2 : 1), chunks: new Map() });
			const costs = new Map([[1, 0], [2, 100]]);
			const forest = createVisionArea(tiles(false), false, false, costs);
			const walled = createVisionArea(tiles(true), false, false, costs);
			const lookup = lookupOf(twoByTwo());
			const across = (inner: typeof forest) => ({
				...createVisionArea(tiles(false), false, false, costs),
				clear: false,
				beyond: (column: number, row: number) =>
				{
					const found = locateCell(lookup, 'Town', column, row);

					return(((found?.areaId === 'Forest') ? inner.visionCost(found.column, found.row) : undefined));
				}
			});

			assert.strictEqual(canSee({ column: 14, row: 0 }, { column: 18, row: 0 }, 20, across(forest)), true);
			assert.strictEqual(canSee({ column: 14, row: 0 }, { column: 18, row: 0 }, 20, across(walled)), false);
			assert.ok(visibleCells({ column: 14, row: 0 }, 6, across(forest)).has('18,0'));
		});
	});

	describe('overallMapLayout', () =>
	{
		it('lays a grid out from an area, and marks where a ring joins back', () =>
		{
			const map = overallMapLayout(twoByTwo(), 'Marsh');

			assert.deepStrictEqual(map.placements.map((placement) => [placement.areaId, placement.x, placement.y, placement.gridColumn, placement.gridRow]), [
				['Marsh', 32, 32, 0, 0],
				['Forest', 32, 0, 0, -1],
				['Fields', 0, 32, -1, 0],
				['Town', 0, 0, -1, -1]
			]);
			assert.deepStrictEqual([map.width, map.height], [64, 64]);

			const ring = overallMapLayout(gridOf(
				area('Town', { east: 'Forest', west: 'Plains' }),
				area('Forest', { west: 'Town', east: 'Plains' }),
				area('Plains', { west: 'Forest', east: 'Town' })
			), 'Town');

			assert.deepStrictEqual(ring.placements.map((placement) => placement.gridColumn), [0, 1, -1]);
			assert.deepStrictEqual(ring.seams, [{ areaId: 'Forest', side: 'east', neighborAreaId: 'Plains' }]);
		});
	});
});
