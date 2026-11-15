/**
 * The squares characters are sent to (see shared/src/arrivals.ts): the races', classes' and links'
 * squares, and what the cells there hold
 */
import { eq, inArray, sql } from 'drizzle-orm';
import { cellIndexInChunk, chunkCoordinate, DEFAULT_TILE_CELL, type Arrival, type ArrivalArea, type NamedOption, type OptionName, type Ruleset } from '@multiverse-kiln/shared';

import { loadClassNames } from './classRepo.js';
import { db, type Executor } from './client.js';
import { loadRaceNames } from './raceRepo.js';
import { areaChunks, areaLinks, areas, classes, classRaceAreas, races } from './schema.js';
import { inVersion, type UniverseVersion } from './universeVersions.js';

/**
 * The squares a version's races, classes and links send characters to; the universe's own starting
 * square and the lobby's are in its settings (universeArrivals())
 *
 * @param version The universe's live version or draft
 * @param ruleset The universe's ruleset
 * @param areaIds Only the squares in these areas of the version, or undefined for every square
 * @param executor The database, or a transaction
 * @return The squares: the races', then the classes', then the classes' for each race, then the links'
 */
export async function listArrivals(version: UniverseVersion, ruleset: Ruleset, areaIds: readonly string[] | undefined, executor: Executor = db): Promise<Arrival[]>
{
	if (areaIds?.length === 0)
	{
		return([]);
	}

	const versionAreas = ((areaIds === undefined)
		? executor
			.select({ id: areas.id })
			.from(areas)
			.where(inVersion(areas, version))
		: [...areaIds]);

	// One after another, since they may share a transaction
	const raceRows = await executor
		.select({
			id: races.id,
			overridesRaceId: races.overridesRaceId,
			areaId: races.startingAreaId,
			column: races.startingColumn,
			row: races.startingRow
		})
		.from(races)
		.where(inArray(races.startingAreaId, versionAreas))
		.orderBy(races.id);
	const classRows = await executor
		.select({
			id: classes.id,
			overridesClassId: classes.overridesClassId,
			areaId: classes.startingAreaId,
			column: classes.startingColumn,
			row: classes.startingRow
		})
		.from(classes)
		.where(inArray(classes.startingAreaId, versionAreas))
		.orderBy(classes.id);
	const classRaceRows = await executor
		.select({
			classId: classes.id,
			overridesClassId: classes.overridesClassId,
			raceId: classRaceAreas.raceId,
			areaId: classRaceAreas.areaId,
			column: classRaceAreas.startingColumn,
			row: classRaceAreas.startingRow
		})
		.from(classRaceAreas)
		.innerJoin(classes, eq(classes.id, classRaceAreas.classId))
		.where(inArray(classRaceAreas.areaId, versionAreas))
		.orderBy(classes.id, classRaceAreas.raceId);
	const hasOptions = ((raceRows.length > 0) || (classRows.length > 0) || (classRaceRows.length > 0));
	const raceNames = (hasOptions ? await loadRaceNames(version, ruleset, executor) : new Map<number, OptionName>());
	const classNames = (hasOptions ? await loadClassNames(version, ruleset, executor) : new Map<number, OptionName>());
	const links = await executor
		.select({
			areaId: areaLinks.areaId,
			column: areaLinks.column,
			row: areaLinks.row,
			targetAreaId: areaLinks.targetAreaId,
			targetColumn: areaLinks.targetColumn,
			targetRow: areaLinks.targetRow
		})
		.from(areaLinks)
		.where(inArray(areaLinks.targetAreaId, versionAreas))
		.orderBy(areaLinks.areaId, areaLinks.row, areaLinks.column);
	const race = (id: number): NamedOption => ({ id, ...(raceNames.get(id) ?? { key: null, name: null }) });
	const characterClass = (id: number): NamedOption => ({ id, ...(classNames.get(id) ?? { key: null, name: null }) });
	const arrivals: Arrival[] = [];

	for (const row of raceRows)
	{
		if (row.areaId !== null)
		{
			arrivals.push({
				source: { kind: 'race', race: race(row.overridesRaceId ?? row.id) },
				areaId: row.areaId,
				column: row.column,
				row: row.row
			});
		}
	}

	for (const row of classRows)
	{
		if (row.areaId !== null)
		{
			arrivals.push({
				source: { kind: 'class', characterClass: characterClass(row.overridesClassId ?? row.id) },
				areaId: row.areaId,
				column: row.column,
				row: row.row
			});
		}
	}

	for (const row of classRaceRows)
	{
		arrivals.push({
			source: { kind: 'classRace', characterClass: characterClass(row.overridesClassId ?? row.classId), race: race(row.raceId) },
			areaId: row.areaId,
			column: row.column,
			row: row.row
		});
	}

	for (const link of links)
	{
		arrivals.push({
			source: { kind: 'link', areaId: link.areaId, column: link.column, row: link.row },
			areaId: link.targetAreaId,
			column: link.targetColumn,
			row: link.targetRow
		});
	}

	return(arrivals);
}

/**
 * Some areas' bounds and default tiles, as their settings were last worked out
 *
 * @param areaIds The areas' IDs
 * @param executor The database, or a transaction
 * @return The areas found, by ID
 */
export async function loadArrivalAreas(areaIds: readonly string[], executor: Executor = db): Promise<Map<string, ArrivalArea>>
{
	if (areaIds.length === 0)
	{
		return(new Map());
	}

	const rows = await executor
		.select({
			id: areas.id,
			minColumn: areas.minColumn,
			minRow: areas.minRow,
			maxColumn: areas.maxColumn,
			maxRow: areas.maxRow,
			defaultTileId: areas.resolvedDefaultTileId
		})
		.from(areas)
		.where(inArray(areas.id, [...new Set(areaIds)]));

	return(new Map(rows.map((row) => [row.id, {
		bounds: {
			minColumn: row.minColumn,
			minRow: row.minRow,
			maxColumn: row.maxColumn,
			maxRow: row.maxRow
		},
		defaultTileId: row.defaultTileId
	}])));
}

/**
 * The key loadCellValues() finds a cell's value by
 *
 * @param areaId The area's ID
 * @param column The cell's column
 * @param row The cell's row
 * @return The key
 */
export function cellValueKey(areaId: string, column: number, row: number): string
{
	return(`${areaId}:${column},${row}`);
}

/**
 * What some cells hold, reading only those cells of their chunks
 *
 * @param cells The cells, each with its area's ID
 * @param executor The database, or a transaction
 * @return Each cell's value (a tile ID, DEFAULT_TILE_CELL or VOID_CELL), by cellValueKey(); a cell of a
 * chunk that isn't stored holds DEFAULT_TILE_CELL
 */
export async function loadCellValues(cells: readonly { areaId: string; column: number; row: number }[], executor: Executor = db): Promise<Map<string, number>>
{
	const values = new Map(cells.map((cell) => [cellValueKey(cell.areaId, cell.column, cell.row), DEFAULT_TILE_CELL]));

	if (cells.length === 0)
	{
		return(values);
	}

	// Postgres arrays count from 1
	const wanted = sql`unnest(
		${sql.param(cells.map((cell) => cell.areaId))}::uuid[],
		${sql.param(cells.map((cell) => cell.column))}::integer[],
		${sql.param(cells.map((cell) => cell.row))}::integer[],
		${sql.param(cells.map((cell) => chunkCoordinate(cell.column)))}::integer[],
		${sql.param(cells.map((cell) => chunkCoordinate(cell.row)))}::integer[],
		${sql.param(cells.map((cell) => (cellIndexInChunk(cell.column, cell.row) + 1)))}::integer[]
	) AS wanted (area_id, cell_column, cell_row, chunk_column, chunk_row, cell_index)`;
	const result = await executor.execute<{ area_id: string; cell_column: number; cell_row: number; value: number | null }>(sql`
		SELECT wanted.area_id, wanted.cell_column, wanted.cell_row, ${areaChunks.cells}[wanted.cell_index] AS value
		FROM ${wanted}
		JOIN ${areaChunks} ON ${areaChunks.areaId} = wanted.area_id
			AND ${areaChunks.chunkColumn} = wanted.chunk_column
			AND ${areaChunks.chunkRow} = wanted.chunk_row
	`);

	for (const row of result.rows)
	{
		if (row.value !== null)
		{
			values.set(cellValueKey(row.area_id, Number(row.cell_column), Number(row.cell_row)), Number(row.value));
		}
	}

	return(values);
}
