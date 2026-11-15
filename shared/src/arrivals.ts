/**
 * The squares characters are sent to: the starting squares (the universe's, the lobby's, and each
 * race's and class's) and the cells links lead to (see Starting squares and links in
 * STRUCTURE-OVERVIEW.md). Nobody may be sent to a square they can't walk on, so the server refuses
 * every save leaving one there, and the editor lists each one
 */
import { DEFAULT_TILE_CELL, IMPASSABLE_WALK_SECONDS, isInBounds, VOID_CELL, type AreaBounds } from './areaCells.js';
import type { OptionName } from './characters.js';
import type { EditableUniverseDetails } from './editor.js';

/**
 * A race or class, by the ID everything else uses for it, with what it is called
 */
export interface NamedOption extends OptionName
{
	id: number;
}

/**
 * What sends characters to a square
 *
 * - universe: the universe's starting square, where characters start unless their race or class says
 *   otherwise
 * - lobby: the lobby's starting square
 * - race: a race's starting square
 * - class: a class's starting square, for every race
 * - classRace: a class's starting square for characters of one race
 * - link: the link on a cell of an area
 */
export type ArrivalSource =
	| { kind: 'universe' }
	| { kind: 'lobby' }
	| { kind: 'race'; race: NamedOption }
	| { kind: 'class'; characterClass: NamedOption }
	| { kind: 'classRace'; characterClass: NamedOption; race: NamedOption }
	| { kind: 'link'; areaId: string; column: number; row: number };

/**
 * A square characters are sent to, and what sends them there
 */
export interface Arrival
{
	source: ArrivalSource;
	areaId: string;
	column: number;
	row: number;
}

/**
 * An area as far as arriving in it goes
 */
export interface ArrivalArea
{
	bounds: AreaBounds;

	/**
	 * The tile its cells holding DEFAULT_TILE_CELL have
	 */
	defaultTileId: number;
}

/**
 * A square nobody can walk on that characters are sent to: what sends them, the area and cell they
 * arrive on, and the tile there, or null for an Unexplored cell (VOID_CELL)
 */
export interface BlockedArrival
{
	kind: 'arrivalBlocked';
	source: ArrivalSource;
	areaId: string;
	column: number;
	row: number;
	tileId: number | null;
}

/**
 * The value of a cell of an area: a tile ID, DEFAULT_TILE_CELL or VOID_CELL, or undefined when it isn't
 * known, such as in a chunk the editor hasn't loaded
 */
export type ArrivalCellValue = (areaId: string, column: number, row: number) => number | undefined;

/**
 * The universe's own starting square and the lobby's, as squares characters are sent to
 *
 * @param universe The universe's settings
 * @return The squares, leaving out those without an area
 */
export function universeArrivals(universe: Pick<EditableUniverseDetails, 'startingAreaId' | 'startingColumn' | 'startingRow' | 'lobbyAreaId' | 'lobbyColumn' | 'lobbyRow'>): Arrival[]
{
	const arrivals: Arrival[] = [];

	if (universe.startingAreaId !== null)
	{
		arrivals.push({
			source: { kind: 'universe' },
			areaId: universe.startingAreaId,
			column: universe.startingColumn,
			row: universe.startingRow
		});
	}

	if (universe.lobbyAreaId !== null)
	{
		arrivals.push({
			source: { kind: 'lobby' },
			areaId: universe.lobbyAreaId,
			column: universe.lobbyColumn,
			row: universe.lobbyRow
		});
	}

	return(arrivals);
}

/**
 * The cell of its area a square characters are sent to stands for. A starting square outside its area,
 * which may have been made smaller since it was chosen, counts as the nearest cell inside it (see
 * StartingCell). The lobby's starting square and a link's cell must be inside the area, which other
 * checks refuse when they aren't
 *
 * @param arrival The square
 * @param bounds Its area's bounds
 * @return The cell, or undefined for a lobby square or link cell outside the area
 */
export function arrivalSquare(arrival: Arrival, bounds: AreaBounds): { column: number; row: number } | undefined
{
	const { source, column, row } = arrival;

	if ((source.kind === 'lobby') || (source.kind === 'link'))
	{
		return((isInBounds(bounds, column, row) ? { column, row } : undefined));
	}

	return({
		column: Math.min(Math.max(column, bounds.minColumn), bounds.maxColumn),
		row: Math.min(Math.max(row, bounds.minRow), bounds.maxRow)
	});
}

/**
 * The squares characters are sent to that nobody can walk on: an Unexplored cell, a tile whose walk
 * time is IMPASSABLE_WALK_SECONDS, or a tile the universe can't use, as the game treats them
 *
 * @param arrivals The squares
 * @param areas The areas they are in, by ID; squares in an area left out are skipped
 * @param cellAt The value of a cell; a cell whose value isn't known is skipped
 * @param walkSeconds The walk seconds of every tile the universe can use, by ID
 * @return A problem for each square nobody can walk on, in the order given
 */
export function blockedArrivals(arrivals: readonly Arrival[], areas: ReadonlyMap<string, ArrivalArea>, cellAt: ArrivalCellValue, walkSeconds: ReadonlyMap<number, number>): BlockedArrival[]
{
	const problems: BlockedArrival[] = [];

	for (const arrival of arrivals)
	{
		const area = areas.get(arrival.areaId);
		const square = (area ? arrivalSquare(arrival, area.bounds) : undefined);

		if (!area || !square)
		{
			continue;
		}

		const value = cellAt(arrival.areaId, square.column, square.row);

		if (value === undefined)
		{
			continue;
		}

		if (isBlockedCell(value, area.defaultTileId, walkSeconds))
		{
			problems.push({
				kind: 'arrivalBlocked',
				source: arrival.source,
				areaId: arrival.areaId,
				column: square.column,
				row: square.row,
				tileId: cellTileId(value, area.defaultTileId)
			});
		}
	}

	return(problems);
}

/**
 * Whether nobody can walk on a cell, as the game treats it: an Unexplored cell, a tile whose walk time is
 * IMPASSABLE_WALK_SECONDS, or a tile the universe can't use
 *
 * @param value The cell's value: a tile ID, DEFAULT_TILE_CELL or VOID_CELL
 * @param defaultTileId The tile its area's cells holding DEFAULT_TILE_CELL have
 * @param walkSeconds The walk seconds of every tile the universe can use, by ID
 * @return True when nobody can walk on it
 */
export function isBlockedCell(value: number, defaultTileId: number, walkSeconds: ReadonlyMap<number, number>): boolean
{
	const tileId = cellTileId(value, defaultTileId);

	return(((tileId === null) || ((walkSeconds.get(tileId) ?? IMPASSABLE_WALK_SECONDS) === IMPASSABLE_WALK_SECONDS)));
}

/**
 * The tile in a cell
 *
 * @param value The cell's value: a tile ID, DEFAULT_TILE_CELL or VOID_CELL
 * @param defaultTileId The tile its area's cells holding DEFAULT_TILE_CELL have
 * @return The tile's ID, or null for an Unexplored cell
 */
function cellTileId(value: number, defaultTileId: number): number | null
{
	return(((value === VOID_CELL) ? null : ((value === DEFAULT_TILE_CELL) ? defaultTileId : value)));
}
