/**
 * Neighboring areas (see Neighboring areas in STRUCTURE-OVERVIEW.md): areas laid side by side and walked
 * across without links, each storing its neighbor on every side
 *
 * Neighbors are always both ways, form a grid (going north then west reaches the same area as going west
 * then north, when both reach one), and touching sides are the same length, so every area in a row is the
 * same height and every area in a column the same width. A chain of areas along a row or column loops
 * when both its ends loop that way, and a ring loops by itself. The editor, every save and the rooms run
 * the same functions
 */
import { CHUNK_SIZE, isInBounds, type AreaBounds } from './areaCells.js';
import type { PlaceProblem } from './regions.js';

export const NEIGHBOR_SIDES = ['north', 'east', 'south', 'west'] as const;

export type NeighborSide = typeof NEIGHBOR_SIDES[number];

/**
 * An area's neighbor on each side, by area ID, or null for none
 */
export type AreaNeighbors = Record<NeighborSide, string | null>;

/**
 * The neighbors of an area with none
 */
export const NO_NEIGHBORS: Readonly<AreaNeighbors> = {
	north: null,
	east: null,
	south: null,
	west: null
};

/**
 * The fewest cells along each side of an area with neighbors: a chunk, so few areas are ever near a player
 */
export const MIN_NEIGHBOR_AREA_SIDE = CHUNK_SIZE;

/**
 * How many rows or columns of each neighbor the area editor shows past an edge
 */
export const NEIGHBOR_PREVIEW_CELLS = 16;

/**
 * A row of areas runs east-west, a column north-south
 */
export type NeighborAxis = 'eastWest' | 'northSouth';

/**
 * How far one step toward each side goes
 */
export const SIDE_STEPS: Readonly<Record<NeighborSide, { columns: number; rows: number }>> = {
	north: {
		columns: 0,
		rows: -1
	},
	east: {
		columns: 1,
		rows: 0
	},
	south: {
		columns: 0,
		rows: 1
	},
	west: {
		columns: -1,
		rows: 0
	}
};

/**
 * An area as the grid of neighbors sees it
 */
export interface GridArea
{
	id: string;
	bounds: AreaBounds;
	neighbors: AreaNeighbors;
	loopsEastWest: boolean;
	loopsNorthSouth: boolean;
}

/**
 * A version's areas as the grid of neighbors sees them, by ID
 */
export type NeighborGrid = ReadonlyMap<string, GridArea>;

/**
 * The side across from another
 *
 * @param side The side
 * @return The opposite side
 */
export function oppositeSide(side: NeighborSide): NeighborSide
{
	switch (side)
	{
		case 'north':
			return('south');
		case 'east':
			return('west');
		case 'south':
			return('north');
		default:
			return('east');
	}
}

/**
 * The axis a side is on
 *
 * @param side The side
 * @return eastWest for east and west, northSouth for north and south
 */
export function axisOf(side: NeighborSide): NeighborAxis
{
	return((((side === 'east') || (side === 'west')) ? 'eastWest' : 'northSouth'));
}

/**
 * The two sides along an axis, the one a chain starts from first
 *
 * @param axis The axis
 * @return West and east, or north and south
 */
export function sidesOf(axis: NeighborAxis): [NeighborSide, NeighborSide]
{
	return(((axis === 'eastWest') ? ['west', 'east'] : ['north', 'south']));
}

/**
 * Whether an area has any neighbor
 *
 * @param neighbors Its neighbors
 * @return True when it has one on any side
 */
export function hasNeighbors(neighbors: AreaNeighbors): boolean
{
	return(NEIGHBOR_SIDES.some((side) => (neighbors[side] !== null)));
}

/**
 * How many cells wide an area is
 *
 * @param bounds The area's bounds
 * @return Its width
 */
export function boundsWidth(bounds: AreaBounds): number
{
	return((bounds.maxColumn - bounds.minColumn) + 1);
}

/**
 * How many cells tall an area is
 *
 * @param bounds The area's bounds
 * @return Its height
 */
export function boundsHeight(bounds: AreaBounds): number
{
	return((bounds.maxRow - bounds.minRow) + 1);
}

/**
 * How many cells long one side of an area is: its height for east and west, its width for north and south
 *
 * @param bounds The area's bounds
 * @param side The side
 * @return The side's length
 */
export function sideLength(bounds: AreaBounds, side: NeighborSide): number
{
	return(((axisOf(side) === 'eastWest') ? boundsHeight(bounds) : boundsWidth(bounds)));
}

/**
 * Whether an area is large enough to have neighbors
 *
 * @param bounds The area's bounds
 * @return True when it is at least MIN_NEIGHBOR_AREA_SIDE cells each way
 */
export function canHaveNeighbors(bounds: AreaBounds): boolean
{
	return((boundsWidth(bounds) >= MIN_NEIGHBOR_AREA_SIDE) && (boundsHeight(bounds) >= MIN_NEIGHBOR_AREA_SIDE));
}

/**
 * Whether an area loops along an axis, by its own checkbox
 *
 * @param area The area
 * @param axis The axis
 * @return Its loopsEastWest or loopsNorthSouth
 */
function loopsAlong(area: Pick<GridArea, 'loopsEastWest' | 'loopsNorthSouth'>, axis: NeighborAxis): boolean
{
	return(((axis === 'eastWest') ? area.loopsEastWest : area.loopsNorthSouth));
}

/**
 * The area next to another on one side, when it is in the grid
 *
 * @param grid The areas
 * @param areaId The area's ID
 * @param side The side
 * @return The neighbor's ID, or undefined for none
 */
function stepTo(grid: NeighborGrid, areaId: string | undefined, side: NeighborSide): string | undefined
{
	const next = ((areaId === undefined) ? null : (grid.get(areaId)?.neighbors[side] ?? null));

	return((((next !== null) && grid.has(next)) ? next : undefined));
}

/**
 * What keeps a version's neighbors from being saved: an area with neighbors under MIN_NEIGHBOR_AREA_SIDE,
 * a neighbor that isn't one both ways, touching sides of different lengths, and places where going one
 * way then the other reaches a different area than the other way round. Each pair of touching sides is
 * named once, by the area west or north of the seam
 *
 * @param grid The version's areas
 * @return The problems, area by area in the grid's order
 */
export function neighborProblems(grid: NeighborGrid): PlaceProblem[]
{
	const problems: PlaceProblem[] = [];

	for (const area of grid.values())
	{
		if (hasNeighbors(area.neighbors) && !canHaveNeighbors(area.bounds))
		{
			problems.push({ kind: 'neighborTooSmall', areaId: area.id });
		}

		for (const side of NEIGHBOR_SIDES)
		{
			const neighborId = area.neighbors[side];

			if (neighborId === null)
			{
				continue;
			}

			const other = grid.get(neighborId);

			if ((neighborId === area.id) || !other || (other.neighbors[oppositeSide(side)] !== area.id))
			{
				problems.push({ kind: 'neighborOneWay', areaId: area.id, side, neighborAreaId: neighborId });
			}
			else if (((side === 'east') || (side === 'south')) && (sideLength(area.bounds, side) !== sideLength(other.bounds, oppositeSide(side))))
			{
				problems.push({ kind: 'neighborSides', areaId: area.id, side, neighborAreaId: neighborId });
			}
		}

		for (const vertical of ['north', 'south'] as const)
		{
			for (const horizontal of ['east', 'west'] as const)
			{
				const first = stepTo(grid, stepTo(grid, area.id, vertical), horizontal);
				const second = stepTo(grid, stepTo(grid, area.id, horizontal), vertical);

				if ((first !== undefined) && (second !== undefined) && (first !== second))
				{
					problems.push({ kind: 'neighborGrid', areaId: area.id, first: vertical, second: horizontal, firstReached: first, secondReached: second });
				}
			}
		}
	}

	return(problems);
}

/**
 * A row or column of areas joined as neighbors
 */
export interface NeighborChain
{
	/**
	 * The areas from west to east, or north to south; for a ring, starting with the area asked about
	 */
	areaIds: string[];

	/**
	 * Whether the chain joins back onto itself, with no ends
	 */
	ring: boolean;
}

/**
 * The row or column of areas an area is in
 *
 * @param grid The areas
 * @param areaId The area's ID
 * @param axis Along a row (eastWest) or a column (northSouth)
 * @return The chain; just the area when it has no neighbors along the axis
 */
export function chainOf(grid: NeighborGrid, areaId: string, axis: NeighborAxis): NeighborChain
{
	const [back, forward] = sidesOf(axis);
	const visited = new Set([areaId]);
	let start = areaId;
	let ring = false;

	for (;;)
	{
		const previous = stepTo(grid, start, back);

		if (previous === undefined)
		{
			break;
		}

		if (visited.has(previous))
		{
			ring = (previous === areaId);
			break;
		}

		visited.add(previous);
		start = previous;
	}

	const first = (ring ? areaId : start);
	const areaIds = [first];
	const seen = new Set([first]);
	let current = first;

	for (;;)
	{
		const next = stepTo(grid, current, forward);

		if ((next === undefined) || seen.has(next))
		{
			break;
		}

		seen.add(next);
		areaIds.push(next);
		current = next;
	}

	return({ areaIds, ring });
}

/**
 * Whether walking off the end of an area's row or column brings a player back on at its other end: a
 * ring always does, and a chain does when the areas at both its ends loop that way
 *
 * @param grid The areas
 * @param areaId The area's ID
 * @param axis The axis
 * @return True when it loops
 */
export function chainLoops(grid: NeighborGrid, areaId: string, axis: NeighborAxis): boolean
{
	const chain = chainOf(grid, areaId, axis);

	if (chain.ring)
	{
		return(true);
	}

	const first = grid.get(chain.areaIds[0]);
	const last = grid.get(chain.areaIds[chain.areaIds.length - 1]);

	return((first !== undefined) && (last !== undefined) && loopsAlong(first, axis) && loopsAlong(last, axis));
}

/**
 * Whether an area's own checkbox for looping along an axis matters: not for an area with neighbors on
 * both sides along it, whose chain's ends decide, nor for one in a ring, which loops by itself
 *
 * - end: it is the end of its chain, or has no neighbors along the axis, and its checkbox counts
 * - middle: it has neighbors on both sides along the axis
 * - ring: its chain is a ring
 *
 * @param grid The areas
 * @param areaId The area's ID
 * @param axis The axis
 * @return Which it is
 */
export function loopPlace(grid: NeighborGrid, areaId: string, axis: NeighborAxis): 'end' | 'middle' | 'ring'
{
	const chain = chainOf(grid, areaId, axis);

	if (chain.ring)
	{
		return('ring');
	}

	const [back, forward] = sidesOf(axis);

	return((((stepTo(grid, areaId, back) !== undefined) && (stepTo(grid, areaId, forward) !== undefined)) ? 'middle' : 'end'));
}

/**
 * The other end of a chain that doesn't loop because only one of its ends is checked, for the warning
 * beside each end's checkbox
 *
 * @param grid The areas
 * @param areaId The area's ID, at one end of the chain
 * @param axis The axis
 * @return The other end's ID, or undefined when the area isn't an end of a chain of two or more, or its
 * ends agree
 */
export function halfLoopingEnd(grid: NeighborGrid, areaId: string, axis: NeighborAxis): string | undefined
{
	const chain = chainOf(grid, areaId, axis);
	const firstId = chain.areaIds[0];
	const lastId = chain.areaIds[chain.areaIds.length - 1];

	if (chain.ring || (chain.areaIds.length < 2) || ((areaId !== firstId) && (areaId !== lastId)))
	{
		return(undefined);
	}

	const first = grid.get(firstId);
	const last = grid.get(lastId);

	if (!first || !last || (loopsAlong(first, axis) === loopsAlong(last, axis)))
	{
		return(undefined);
	}

	return(((areaId === firstId) ? lastId : firstId));
}

/**
 * The areas beside an area, in the rows or columns next to its own, that loop along an axis unlike its
 * row or column: one loops and the other doesn't, or both loop with their ends not lined up. Where such
 * rows meet, going along then across reaches a different area than going across then along, so walking
 * there behaves oddly. Rows side by side that don't loop at all, such as an L-shaped grid, are left alone
 *
 * @param grid The areas
 * @param areaId The area's ID
 * @param axis Along a row (eastWest) or a column (northSouth)
 * @return The IDs of the areas beside it whose rows or columns don't loop alike, if any
 */
export function misalignedLoops(grid: NeighborGrid, areaId: string, axis: NeighborAxis): string[]
{
	const across = sidesOf(((axis === 'eastWest') ? 'northSouth' : 'eastWest'));
	const along = sidesOf(axis);
	const loops = chainLoops(grid, areaId, axis);
	const ownSides = seamSides(grid, areaId);
	const found: string[] = [];

	for (const side of across)
	{
		const besideId = stepTo(grid, areaId, side);

		if ((besideId === undefined) || (!loops && !chainLoops(grid, besideId, axis)))
		{
			continue;
		}

		const besideSides = seamSides(grid, besideId);

		// Where either area goes on along the row, going across from there should reach where the other
		// goes on. Nothing across is fine, as at the corner of an L-shaped grid
		const differs = along.some((step) =>
		{
			const ownNext = ownSides[step];
			const besideNext = besideSides[step];

			return(((ownNext !== null) && ((stepTo(grid, ownNext, side) ?? null) !== besideNext))
				|| ((besideNext !== null) && ((stepTo(grid, besideNext, oppositeSide(side)) ?? null) !== ownNext)));
		});

		if (differs)
		{
			found.push(besideId);
		}
	}

	return(found);
}

/**
 * Whether any rows or columns side by side in a grid don't loop alike (see misalignedLoops())
 *
 * @param grid The areas
 * @return The IDs of the areas whose rows or columns don't loop like those beside them
 */
export function areasWithMisalignedLoops(grid: NeighborGrid): string[]
{
	return([...grid.keys()].filter((areaId) => ((misalignedLoops(grid, areaId, 'eastWest').length > 0) || (misalignedLoops(grid, areaId, 'northSouth').length > 0))));
}

/**
 * Where walking off each side of an area leads: its neighbor, or at the end of a chain that loops the
 * chain's other end, which is the area itself when it has no neighbors along that axis and loops
 *
 * @param grid The areas
 * @param areaId The area's ID
 * @return The area beyond each side, or null where walking off is an edge
 */
export function seamSides(grid: NeighborGrid, areaId: string): AreaNeighbors
{
	const sides: AreaNeighbors = { ...NO_NEIGHBORS };

	for (const axis of ['eastWest', 'northSouth'] as const)
	{
		const [back, forward] = sidesOf(axis);
		const chain = chainOf(grid, areaId, axis);
		const loops = chainLoops(grid, areaId, axis);
		const first = chain.areaIds[0];
		const last = chain.areaIds[chain.areaIds.length - 1];

		sides[back] = (stepTo(grid, areaId, back) ?? ((loops && !chain.ring) ? last : null));
		sides[forward] = (stepTo(grid, areaId, forward) ?? ((loops && !chain.ring) ? first : null));
	}

	return(sides);
}

/**
 * The areas a resize carries along: making an area taller makes every area in its row taller on the same
 * side, and making it wider every area in its column, so touching sides stay the same length
 *
 * @param grid The areas
 * @param areaId The area resized
 * @param before Its bounds before
 * @param after Its bounds after
 * @return The new bounds of each other area resized, by ID
 */
export function carriedResizes(grid: NeighborGrid, areaId: string, before: AreaBounds, after: AreaBounds): Map<string, AreaBounds>
{
	const carried = new Map<string, AreaBounds>();
	const north = (after.minRow - before.minRow);
	const south = (after.maxRow - before.maxRow);
	const west = (after.minColumn - before.minColumn);
	const east = (after.maxColumn - before.maxColumn);
	const carry = (axis: NeighborAxis, change: (bounds: AreaBounds) => AreaBounds): void =>
	{
		for (const id of chainOf(grid, areaId, axis).areaIds)
		{
			const area = grid.get(id);

			if ((id !== areaId) && area)
			{
				carried.set(id, change(carried.get(id) ?? area.bounds));
			}
		}
	};

	if ((north !== 0) || (south !== 0))
	{
		carry('eastWest', (bounds) => ({
			...bounds,
			minRow: bounds.minRow + north,
			maxRow: bounds.maxRow + south
		}));
	}

	if ((west !== 0) || (east !== 0))
	{
		carry('northSouth', (bounds) => ({
			...bounds,
			minColumn: bounds.minColumn + west,
			maxColumn: bounds.maxColumn + east
		}));
	}

	return(carried);
}

/**
 * Where an area is in the grid, in areas from the area the layout started from
 */
interface GridPosition
{
	column: number;
	row: number;
}

/**
 * The areas reached from one through their neighbors, each placed once where it was first reached
 *
 * @param grid The areas
 * @param areaId Where to start
 * @return Each area's place, by ID, and the joins that lead somewhere other than next to the area
 */
function placeAreas(grid: NeighborGrid, areaId: string): { positions: Map<string, GridPosition>; seams: { areaId: string; side: NeighborSide; neighborAreaId: string }[] }
{
	const positions = new Map<string, GridPosition>([[areaId, { column: 0, row: 0 }]]);
	const seams: { areaId: string; side: NeighborSide; neighborAreaId: string }[] = [];
	const queue = [areaId];

	for (let index = 0; index < queue.length; index++)
	{
		const id = queue[index];
		const position = positions.get(id);

		if (!position)
		{
			continue;
		}

		for (const side of NEIGHBOR_SIDES)
		{
			const next = stepTo(grid, id, side);

			if (next === undefined)
			{
				continue;
			}

			const expected = {
				column: position.column + SIDE_STEPS[side].columns,
				row: position.row + SIDE_STEPS[side].rows
			};
			const placed = positions.get(next);

			if (!placed)
			{
				positions.set(next, expected);
				queue.push(next);
			}
			else if (((placed.column !== expected.column) || (placed.row !== expected.row)) && ((side === 'east') || (side === 'south')))
			{
				seams.push({ areaId: id, side, neighborAreaId: next });
			}
		}
	}

	return({ positions, seams });
}

/**
 * The areas next to a place in the grid beside an area, by the side of the place they are on: the area
 * itself, and those found next to the place through the areas around it
 *
 * @param grid The areas
 * @param areaId The area
 * @param side The side of the area the place is on
 * @return The area on each side of the place, by side
 */
export function placeNeighbors(grid: NeighborGrid, areaId: string, side: NeighborSide): Map<NeighborSide, string>
{
	const { positions } = placeAreas(grid, areaId);
	const place = {
		column: SIDE_STEPS[side].columns,
		row: SIDE_STEPS[side].rows
	};
	const around = new Map<NeighborSide, string>([[oppositeSide(side), areaId]]);
	const replaced = stepTo(grid, areaId, side);

	for (const [id, position] of positions)
	{
		if (id === replaced)
		{
			continue;
		}

		for (const each of NEIGHBOR_SIDES)
		{
			if ((position.column === (place.column + SIDE_STEPS[each].columns)) && (position.row === (place.row + SIDE_STEPS[each].rows)) && !around.has(each))
			{
				around.set(each, id);
			}
		}
	}

	return(around);
}

/**
 * Why an area can't be a neighbor in a place, as the area editor's Choose says
 *
 * - itself: it is the area whose side the place is on
 * - tooSmall: it is smaller than MIN_NEIGHBOR_AREA_SIDE either way
 * - taken: one of its sides facing an area next to the place has another neighbor, or that area's side
 *   facing the place does
 * - size: a side touching an area next to the place is a different length
 * - grid: joining it would break the grid somewhere else
 */
export type NeighborRefusal = 'itself' | 'tooSmall' | 'taken' | 'size' | 'grid';

/**
 * A version's areas with an area joined as neighbor to every area next to a place: the area whose side
 * the place is on, replacing the neighbor it had there, and the others around the place
 *
 * @param grid The areas
 * @param candidateId The area joined
 * @param joins The area on each of its sides (placeNeighbors())
 * @param candidate The area joined as the grid will hold it, such as a new one; the grid's by default
 * @return The areas after
 */
function joinedGrid(grid: NeighborGrid, candidateId: string, joins: ReadonlyMap<NeighborSide, string>, candidate?: GridArea): Map<string, GridArea>
{
	const after = new Map([...grid].map(([id, area]) => [id, { ...area, neighbors: { ...area.neighbors } }]));
	const joined = (candidate ?? after.get(candidateId));

	if (!joined)
	{
		return(after);
	}

	after.set(candidateId, { ...joined, neighbors: { ...joined.neighbors } });

	for (const [side, id] of joins)
	{
		const facing = oppositeSide(side);
		const other = after.get(id);
		const self = after.get(candidateId);

		if (!other || !self)
		{
			continue;
		}

		// A place's own area may have had another neighbor there, which loses it
		const previous = other.neighbors[facing];

		if ((previous !== null) && (previous !== candidateId))
		{
			const dropped = after.get(previous);

			if (dropped && (dropped.neighbors[side] === id))
			{
				dropped.neighbors[side] = null;
			}
		}

		other.neighbors[facing] = candidateId;
		self.neighbors[side] = id;
	}

	return(after);
}

/**
 * Whether an area can be a neighbor in a place beside another area: joined to every area next to the
 * place, with sides free to join, touching sides the same length, and the grid as consistent as before
 *
 * @param grid The areas
 * @param areaId The area whose side the place is on
 * @param side The side
 * @param candidateId The area that would go there
 * @return Why it can't, or undefined when it can
 */
export function neighborRefusal(grid: NeighborGrid, areaId: string, side: NeighborSide, candidateId: string): NeighborRefusal | undefined
{
	const area = grid.get(areaId);
	const candidate = grid.get(candidateId);

	if (!area || !candidate || (candidateId === areaId))
	{
		return('itself');
	}

	if (!canHaveNeighbors(candidate.bounds))
	{
		return('tooSmall');
	}

	const joins = placeNeighbors(grid, areaId, side);

	for (const [joinSide, id] of joins)
	{
		const other = grid.get(id);
		const facing = oppositeSide(joinSide);

		if ((id === candidateId) || !other)
		{
			return('grid');
		}

		const candidateTaken = ((candidate.neighbors[joinSide] !== null) && (candidate.neighbors[joinSide] !== id));
		const otherTaken = ((id !== areaId) && (other.neighbors[facing] !== null) && (other.neighbors[facing] !== candidateId));

		if (candidateTaken || otherTaken)
		{
			return('taken');
		}

		if (sideLength(candidate.bounds, joinSide) !== sideLength(other.bounds, facing))
		{
			return('size');
		}
	}

	return((introducesProblems(grid, joinedGrid(grid, candidateId, joins)) ? 'grid' : undefined));
}

/**
 * Whether a change to the areas makes a problem with their neighbors that wasn't there before
 *
 * @param before The areas before
 * @param after The areas after
 * @return True when it does
 */
export function introducesProblems(before: NeighborGrid, after: NeighborGrid): boolean
{
	const keyOf = (problem: PlaceProblem): string => JSON.stringify(problem);
	const known = new Set(neighborProblems(before).map(keyOf));

	return(neighborProblems(after).some((problem) => !known.has(keyOf(problem))));
}

/**
 * What adding a new area beside another gives it: as tall as the row it joins and as wide as the column,
 * taking the area's own size where no other area touches the place, and the areas it joins
 */
export interface NewNeighbor
{
	bounds: AreaBounds;

	/**
	 * The area on each of its sides, by side
	 */
	joins: Map<NeighborSide, string>;
}

/**
 * What a new area added beside another would be, and whether it fits
 *
 * @param grid The areas
 * @param areaId The area it is added beside
 * @param side The side
 * @return The new area, or why it doesn't fit: the area's side taken (taken), the area too small
 * (tooSmall), an area next to the place with its side taken (taken), or the grid broken (grid)
 */
export function newNeighbor(grid: NeighborGrid, areaId: string, side: NeighborSide): NewNeighbor | NeighborRefusal
{
	const area = grid.get(areaId);

	if (!area || !canHaveNeighbors(area.bounds))
	{
		return('tooSmall');
	}

	if (area.neighbors[side] !== null)
	{
		return('taken');
	}

	const joins = placeNeighbors(grid, areaId, side);
	const rowArea = grid.get(joins.get('east') ?? joins.get('west') ?? areaId) ?? area;
	const columnArea = grid.get(joins.get('north') ?? joins.get('south') ?? areaId) ?? area;
	const bounds: AreaBounds = {
		minColumn: columnArea.bounds.minColumn,
		maxColumn: columnArea.bounds.maxColumn,
		minRow: rowArea.bounds.minRow,
		maxRow: rowArea.bounds.maxRow
	};

	for (const [joinSide, id] of joins)
	{
		const other = grid.get(id);
		const facing = oppositeSide(joinSide);

		if (!other || ((id !== areaId) && (other.neighbors[facing] !== null)))
		{
			return('taken');
		}

		if (sideLength(bounds, joinSide) !== sideLength(other.bounds, facing))
		{
			return('size');
		}
	}

	// No area's ID, so the new area is told apart from every other
	const newId = '\u0000new';
	const candidate: GridArea = {
		id: newId,
		bounds,
		neighbors: { ...NO_NEIGHBORS },
		loopsEastWest: false,
		loopsNorthSouth: false
	};

	if (introducesProblems(grid, joinedGrid(grid, newId, joins, candidate)))
	{
		return('grid');
	}

	return({ bounds, joins });
}

/**
 * The grid with an area's neighbors set as joinedGrid() does: for applying a choice in the editor
 *
 * @param grid The areas
 * @param areaId The area joined
 * @param joins The area on each of its sides
 * @param area The area as the grid will hold it, when it isn't in the grid yet
 * @return The areas after
 */
export function withNeighbors(grid: NeighborGrid, areaId: string, joins: ReadonlyMap<NeighborSide, string>, area?: GridArea): Map<string, GridArea>
{
	return(joinedGrid(grid, areaId, joins, area));
}

/**
 * The grid with two areas no longer neighbors on a side
 *
 * @param grid The areas
 * @param areaId One area
 * @param side The side of it the other is on
 * @return The areas after
 */
export function withoutNeighbor(grid: NeighborGrid, areaId: string, side: NeighborSide): Map<string, GridArea>
{
	const after = new Map([...grid].map(([id, area]) => [id, { ...area, neighbors: { ...area.neighbors } }]));
	const area = after.get(areaId);
	const otherId = area?.neighbors[side];

	if (area && (otherId !== null) && (otherId !== undefined))
	{
		area.neighbors[side] = null;

		const other = after.get(otherId);

		if (other && (other.neighbors[oppositeSide(side)] === areaId))
		{
			other.neighbors[oppositeSide(side)] = null;
		}
	}

	return(after);
}

/**
 * An area as the seams between neighbors see it: its bounds, and where walking off each side leads
 * (seamSides())
 */
export interface SeamArea
{
	id: string;
	bounds: AreaBounds;
	sides: AreaNeighbors;
}

/**
 * Finds an area a seam leads to, or nothing where walking off is an edge (one that isn't loaded, is
 * disabled, or is across the lobby region's edge)
 */
export type SeamLookup = (areaId: string) => SeamArea | undefined;

/**
 * A cell of an area
 */
export interface AreaCellRef
{
	areaId: string;
	column: number;
	row: number;
}

/**
 * Most areas a cell is followed across along one axis
 */
const MAX_SEAM_HOPS = 4;

/**
 * The area and cell a cell past an area's edges is in: across its seams with its neighbors, cells meeting
 * row by row (or column by column) counted from the north (or west) edge of each area. A cell past a corner
 * is found going east or west first, then north or south, or the other way round when that reaches nothing
 *
 * @param lookup Finds the areas
 * @param areaId The area the cell is counted from
 * @param column The cell's column in that area, which may be outside it
 * @param row The cell's row, likewise
 * @return The cell in the area it is in, or undefined past an edge
 */
export function locateCell(lookup: SeamLookup, areaId: string, column: number, row: number): AreaCellRef | undefined
{
	return(locateAlong(lookup, areaId, column, row, true) ?? locateAlong(lookup, areaId, column, row, false));
}

/**
 * Follows a cell across seams, one axis then the other
 *
 * @param lookup Finds the areas
 * @param areaId The area the cell is counted from
 * @param column The cell's column
 * @param row The cell's row
 * @param columnsFirst Whether to cross east or west first
 * @return The cell in the area it is in, or undefined past an edge
 */
function locateAlong(lookup: SeamLookup, areaId: string, column: number, row: number, columnsFirst: boolean): AreaCellRef | undefined
{
	const start = lookup(areaId);
	let cellColumn = column;
	let cellRow = row;

	if (!start)
	{
		return(undefined);
	}

	let area: SeamArea = start;

	for (const columns of (columnsFirst ? [true, false] : [false, true]))
	{
		for (let hops = 0; ; hops++)
		{
			const { bounds } = area;
			const past = (columns
				? ((cellColumn < bounds.minColumn) ? 'west' : ((cellColumn > bounds.maxColumn) ? 'east' : undefined))
				: ((cellRow < bounds.minRow) ? 'north' : ((cellRow > bounds.maxRow) ? 'south' : undefined)));

			if (past === undefined)
			{
				break;
			}

			const nextId: string | null = area.sides[past];
			const next: SeamArea | undefined = (((nextId === null) || (hops >= MAX_SEAM_HOPS)) ? undefined : lookup(nextId));

			if (!next)
			{
				return(undefined);
			}

			const to = next.bounds;

			if (past === 'west')
			{
				cellColumn = to.maxColumn - (bounds.minColumn - cellColumn - 1);
				cellRow = (cellRow - bounds.minRow) + to.minRow;
			}
			else if (past === 'east')
			{
				cellColumn = to.minColumn + (cellColumn - bounds.maxColumn - 1);
				cellRow = (cellRow - bounds.minRow) + to.minRow;
			}
			else if (past === 'north')
			{
				cellRow = to.maxRow - (bounds.minRow - cellRow - 1);
				cellColumn = (cellColumn - bounds.minColumn) + to.minColumn;
			}
			else
			{
				cellRow = to.minRow + (cellRow - bounds.maxRow - 1);
				cellColumn = (cellColumn - bounds.minColumn) + to.minColumn;
			}

			area = next;
		}
	}

	return((isInBounds(area.bounds, cellColumn, cellRow) ? { areaId: area.id, column: cellColumn, row: cellRow } : undefined));
}

/**
 * One of the eight places around an area where a seam leads: the area drawn there, and how far its
 * cells are moved to line up with the area's own (a cell of it at column c, row r is drawn at column
 * c + columnOffset, row r + rowOffset of the area)
 */
export interface SeamSlot
{
	areaId: string;
	columnOffset: number;
	rowOffset: number;

	/**
	 * Which way the place is from the area: -1, 0 or 1 along each axis
	 */
	columns: number;
	rows: number;
}

/**
 * The areas around an area across its seams, and where each lines up with it: those past each side and
 * each corner. The same area may fill more than one place, as in a ring of two
 *
 * @param lookup Finds the areas
 * @param areaId The area
 * @return The places that hold an area
 */
export function seamSlots(lookup: SeamLookup, areaId: string): SeamSlot[]
{
	const area = lookup(areaId);
	const slots: SeamSlot[] = [];

	if (!area)
	{
		return(slots);
	}

	const { bounds } = area;

	for (const rows of [-1, 0, 1])
	{
		for (const columns of [-1, 0, 1])
		{
			if ((columns === 0) && (rows === 0))
			{
				continue;
			}

			const column = ((columns < 0) ? bounds.minColumn - 1 : ((columns > 0) ? bounds.maxColumn + 1 : bounds.minColumn));
			const row = ((rows < 0) ? bounds.minRow - 1 : ((rows > 0) ? bounds.maxRow + 1 : bounds.minRow));
			const found = locateCell(lookup, areaId, column, row);

			if (found)
			{
				slots.push({
					areaId: found.areaId,
					columnOffset: column - found.column,
					rowOffset: row - found.row,
					columns,
					rows
				});
			}
		}
	}

	return(slots);
}

/**
 * Cells of an area in a rectangle, inclusive at both ends
 */
export interface AreaCellWindow
{
	areaId: string;
	bounds: AreaBounds;
}

/**
 * The cells of the areas around an area within a distance of one of its cells, across its seams, each in
 * its own area's columns and rows: for loading and sending the neighbors' chunks near a player
 *
 * @param lookup Finds the areas
 * @param slots The places around the area (seamSlots())
 * @param areaId The area
 * @param column The cell's column
 * @param row The cell's row
 * @param radius How many cells either side of the cell to reach
 * @return The cells of each place within reach; none for a place out of reach
 */
export function windowsAcrossSeams(lookup: SeamLookup, slots: readonly SeamSlot[], areaId: string, column: number, row: number, radius: number): AreaCellWindow[]
{
	const area = lookup(areaId);
	const windows: AreaCellWindow[] = [];

	if (!area)
	{
		return(windows);
	}

	const reach: AreaBounds = {
		minColumn: column - radius,
		minRow: row - radius,
		maxColumn: column + radius,
		maxRow: row + radius
	};

	for (const slot of slots)
	{
		const other = lookup(slot.areaId);

		if (!other)
		{
			continue;
		}

		const drawn: AreaBounds = {
			minColumn: Math.max(reach.minColumn, other.bounds.minColumn + slot.columnOffset),
			minRow: Math.max(reach.minRow, other.bounds.minRow + slot.rowOffset),
			maxColumn: Math.min(reach.maxColumn, other.bounds.maxColumn + slot.columnOffset),
			maxRow: Math.min(reach.maxRow, other.bounds.maxRow + slot.rowOffset)
		};

		if ((drawn.minColumn > drawn.maxColumn) || (drawn.minRow > drawn.maxRow))
		{
			continue;
		}

		windows.push({
			areaId: slot.areaId,
			bounds: {
				minColumn: drawn.minColumn - slot.columnOffset,
				minRow: drawn.minRow - slot.rowOffset,
				maxColumn: drawn.maxColumn - slot.columnOffset,
				maxRow: drawn.maxRow - slot.rowOffset
			}
		});
	}

	return(windows);
}

/**
 * An area as the overall map draws it: where it is and how large, in cells from the map's top left, and
 * its place in the grid from the area the map was drawn from
 */
export interface MapPlacement
{
	areaId: string;
	x: number;
	y: number;
	width: number;
	height: number;
	gridColumn: number;
	gridRow: number;
}

/**
 * The overall map of an area's grid: every area reached through neighbors, each drawn once, laid out from
 * the area, and the joins between areas drawn apart, such as where a ring joins back
 */
export interface OverallMap
{
	placements: MapPlacement[];
	seams: { areaId: string; side: NeighborSide; neighborAreaId: string }[];
	width: number;
	height: number;
}

/**
 * Lays out the whole grid an area is in, each column as wide and each row as tall as its widest and
 * tallest area
 *
 * @param grid The areas
 * @param areaId The area to lay it out from
 * @return The map
 */
export function overallMapLayout(grid: NeighborGrid, areaId: string): OverallMap
{
	const { positions, seams } = placeAreas(grid, areaId);
	const widths = new Map<number, number>();
	const heights = new Map<number, number>();

	for (const [id, position] of positions)
	{
		const bounds = grid.get(id)?.bounds;

		if (bounds)
		{
			widths.set(position.column, Math.max(widths.get(position.column) ?? 0, boundsWidth(bounds)));
			heights.set(position.row, Math.max(heights.get(position.row) ?? 0, boundsHeight(bounds)));
		}
	}

	const starts = (sizes: Map<number, number>): Map<number, number> =>
	{
		const found = new Map<number, number>();
		let total = 0;

		for (const index of [...sizes.keys()].sort((first, second) => (first - second)))
		{
			found.set(index, total);
			total += (sizes.get(index) ?? 0);
		}

		return(found);
	};
	const columnStarts = starts(widths);
	const rowStarts = starts(heights);
	const placements: MapPlacement[] = [];

	for (const [id, position] of positions)
	{
		const bounds = grid.get(id)?.bounds;

		if (bounds)
		{
			placements.push({
				areaId: id,
				x: (columnStarts.get(position.column) ?? 0),
				y: (rowStarts.get(position.row) ?? 0),
				width: boundsWidth(bounds),
				height: boundsHeight(bounds),
				gridColumn: position.column,
				gridRow: position.row
			});
		}
	}

	return({
		placements,
		seams,
		width: [...widths.values()].reduce((sum, width) => (sum + width), 0),
		height: [...heights.values()].reduce((sum, height) => (sum + height), 0)
	});
}

/**
 * The areas whose neighbors join them across the lobby region's edge, each pair once
 *
 * @param grid The areas
 * @return Each pair, the area west or north of the seam first
 */
export function neighborPairs(grid: NeighborGrid): { areaId: string; targetAreaId: string }[]
{
	const pairs: { areaId: string; targetAreaId: string }[] = [];

	for (const area of grid.values())
	{
		for (const side of ['east', 'south'] as const)
		{
			const neighborId = area.neighbors[side];

			if ((neighborId !== null) && grid.has(neighborId))
			{
				pairs.push({ areaId: area.id, targetAreaId: neighborId });
			}
		}
	}

	return(pairs);
}
