/**
 * Fills the database with the sample universe in sampleUniverse.ts, for local development:
 *
 *   npm run db:seed -w server
 *
 * Run it by hand after migrating, like the migrations themselves; nothing runs it automatically. It
 * replaces the sample universe if it is already there, and leaves everything else alone. It refuses
 * to run when NODE_ENV is production
 *
 * To make a player the sample universe's creator, so they can open it in the editor, give their username:
 *
 *   npm run db:seed -w server -- --creator ada
 *
 * The account must exist already: register it first. Replacing the universe also removes its editors,
 * so pass --creator every time
 */
import { parseArgs } from 'node:util';
import { CHUNK_SIZE, DEFAULT_TILE_CELL, VOID_CELL, cellIndexInChunk, chunkCoordinate, chunkKey, type MapBounds } from '@multiverse-kiln/shared';

import { db, pool, type Executor } from '../src/db/client.js';
import { findPlayerByUsername, type PlayerProfile } from '../src/db/playerRepo.js';
import { addDefaultStartingItems } from '../src/db/startingItemRepo.js';
import { createTile, findDefaultTileIds } from '../src/db/tileRepo.js';
import { setUniverseRole } from '../src/db/universeEditorRepo.js';
import { createUniverse, deleteUniverse, setUniverseAreas } from '../src/db/universeRepo.js';
import { createArea, createAreaLink, saveGroundChunk } from '../src/db/areaRepo.js';
import { SAMPLE_UNIVERSE_ID, sampleLinks, sampleTiles, sampleUniverse, sampleAreas, type SampleArea } from './sampleUniverse.js';

/**
 * Which tile each map character stands for, besides `.`, space and an area's digits
 */
const TILE_CHARACTERS: Record<string, string> = {
	'g': 'grass',
	'f': 'forest',
	'd': 'desert',
	'^': 'mountains',
	'~': 'water',
	'=': 'wood_floor',
	...Object.fromEntries(Object.entries(sampleTiles).map(([character, tile]) => [character, tile.key]))
};

/**
 * An area's map, read from its drawing
 */
interface ParsedMap
{
	bounds: MapBounds;

	/**
	 * The chunks that hold anything but the default tile, by chunkKey()
	 */
	chunks: Map<string, { chunkColumn: number; chunkRow: number; cells: number[] }>;

	/**
	 * The cell each digit marks
	 */
	markers: Map<string, { column: number; row: number }>;
}

/**
 * Reads an area's drawing into cells, centered on column 0, row 0
 *
 * @param area The area
 * @param tileIds Every tile's ID, by key
 * @return The map
 */
function parseMap(area: SampleArea, tileIds: Map<string, number>): ParsedMap
{
	const width = area.map[0].length;
	const height = area.map.length;
	const bounds = {
		minColumn: -Math.floor(width / 2),
		minRow: -Math.floor(height / 2),
		maxColumn: (width - 1) - Math.floor(width / 2),
		maxRow: (height - 1) - Math.floor(height / 2)
	};
	const chunks: ParsedMap['chunks'] = new Map();
	const markers: ParsedMap['markers'] = new Map();

	area.map.forEach((line, rowIndex) =>
	{
		if (line.length !== width)
		{
			throw new Error(`${area.key}: row ${rowIndex} is ${line.length} cells wide, not ${width}`);
		}

		[...line].forEach((character, columnIndex) =>
		{
			const column = bounds.minColumn + columnIndex;
			const row = bounds.minRow + rowIndex;
			const value = cellValue(area, character, tileIds);

			if (character in area.markers)
			{
				markers.set(character, { column, row });
			}

			if (value === DEFAULT_TILE_CELL)
			{
				return;
			}

			const chunkColumn = chunkCoordinate(column);
			const chunkRow = chunkCoordinate(row);
			const key = chunkKey(chunkColumn, chunkRow);
			let chunk = chunks.get(key);

			if (!chunk)
			{
				chunk = {
					chunkColumn,
					chunkRow,
					cells: new Array<number>(CHUNK_SIZE * CHUNK_SIZE).fill(DEFAULT_TILE_CELL)
				};
				chunks.set(key, chunk);
			}

			chunk.cells[cellIndexInChunk(column, row)] = value;
		});
	});

	return({ bounds, chunks, markers });
}

/**
 * The value stored for one character of a drawing
 *
 * @param area The area being read
 * @param character The character
 * @param tileIds Every tile's ID, by key
 * @return A tile ID, DEFAULT_TILE_CELL or VOID_CELL
 */
function cellValue(area: SampleArea, character: string, tileIds: Map<string, number>): number
{
	if (character === '.')
	{
		return(DEFAULT_TILE_CELL);
	}

	if (character === ' ')
	{
		return(VOID_CELL);
	}

	const tileKey = (area.markers[character] ?? TILE_CHARACTERS[character]);

	if (tileKey === undefined)
	{
		throw new Error(`${area.key}: "${character}" isn't a tile or one of the area's markers`);
	}

	return(requireTile(tileIds, tileKey));
}

/**
 * Looks a tile up by key
 *
 * @param tileIds Every tile's ID, by key
 * @param key The tile's key
 * @return The tile's ID
 */
function requireTile(tileIds: Map<string, number>, key: string): number
{
	const id = tileIds.get(key);

	if (id === undefined)
	{
		throw new Error(`There is no tile "${key}". Have the migrations been run?`);
	}

	return(id);
}

/**
 * Looks up the cell a digit marks in an area
 *
 * @param maps Every area's map, by area key
 * @param area The area's key
 * @param marker The digit
 * @return The cell
 */
function requireMarker(maps: Map<string, ParsedMap>, area: string, marker: string): { column: number; row: number }
{
	const cell = maps.get(area)?.markers.get(marker);

	if (!cell)
	{
		throw new Error(`${area} has no cell marked ${marker}`);
	}

	return(cell);
}

/**
 * Looks up an area's ID by key
 *
 * @param areaIds Every area's ID, by key
 * @param key The area's key
 * @return The area's ID
 */
function requireArea(areaIds: Map<string, string>, key: string): string
{
	const id = areaIds.get(key);

	if (id === undefined)
	{
		throw new Error(`There is no area "${key}" (an area's parent must come before it)`);
	}

	return(id);
}

/**
 * Finds the account whose username was given with --creator
 *
 * @return The account, or undefined when --creator wasn't given
 */
async function findCreator(): Promise<PlayerProfile | undefined>
{
	const { values } = parseArgs({ options: { creator: { type: 'string' } } });

	if (values.creator === undefined)
	{
		return(undefined);
	}

	const creator = await findPlayerByUsername(values.creator.trim());

	if (!creator)
	{
		throw new Error(`No account has the username "${values.creator}". Register it first, then seed again`);
	}

	return(creator);
}

/**
 * Creates the sample universe, replacing it if it exists
 *
 * @param executor A transaction
 * @param creator The player to make its creator, if any
 */
async function seed(executor: Executor, creator: PlayerProfile | undefined): Promise<void>
{
	if (await deleteUniverse(SAMPLE_UNIVERSE_ID, executor))
	{
		console.log(`Replacing ${sampleUniverse.name}`);
	}

	const tileIds = await findDefaultTileIds('pf1e', executor);
	const universeId = await createUniverse({
		id: SAMPLE_UNIVERSE_ID,
		name: sampleUniverse.name,
		shortDescription: sampleUniverse.shortDescription,
		longDescription: sampleUniverse.longDescription,
		stage: sampleUniverse.stage,
		ruleset: 'pf1e',
		passageOfTime: sampleUniverse.passageOfTime
	}, executor);

	await addDefaultStartingItems(universeId, 'pf1e', executor);
	for (const tile of Object.values(sampleTiles))
	{
		tileIds.set(tile.key, await createTile({ ...tile, key: null, ruleset: 'pf1e', universeId }, executor));
	}

	const areaIds = new Map<string, string>();
	const maps = new Map<string, ParsedMap>();

	for (const area of sampleAreas)
	{
		const map = parseMap(area, tileIds);
		const areaId = await createArea({
			universeId,
			parentAreaId: ((area.parent !== undefined) ? requireArea(areaIds, area.parent) : null),
			name: area.name,
			enabled: true,
			indoors: area.indoors,
			defaultTileId: requireTile(tileIds, area.defaultTile),
			loopsEastWest: (area.loopsEastWest ?? false),
			loopsNorthSouth: false,
			passageOfTime: 'inherit',
			bounds: map.bounds
		}, executor);

		for (const chunk of map.chunks.values())
		{
			await saveGroundChunk(areaId, chunk.chunkColumn, chunk.chunkRow, chunk.cells, executor);
		}

		areaIds.set(area.key, areaId);
		maps.set(area.key, map);
	}

	for (const link of sampleLinks)
	{
		const from = requireMarker(maps, ...link.from);
		const to = requireMarker(maps, ...link.to);

		await createAreaLink({
			areaId: requireArea(areaIds, link.from[0]),
			column: from.column,
			row: from.row,
			targetAreaId: requireArea(areaIds, link.to[0]),
			targetColumn: to.column,
			targetRow: to.row,
			mode: link.mode,
			requiresWholeGroup: false
		}, executor);
	}

	await setUniverseAreas(universeId, requireArea(areaIds, sampleUniverse.lobbyArea), requireArea(areaIds, sampleUniverse.startingArea), executor);

	console.log(`Created ${sampleUniverse.name} with ${sampleAreas.length} areas and ${sampleLinks.length} links`);

	if (creator)
	{
		await setUniverseRole(universeId, creator.id, 'creator', executor);
		console.log(`${creator.displayName} (${creator.username}) is its creator`);
	}
	else
	{
		console.log('Nobody can edit it. Pass --creator <username> to make an account its creator');
	}
}

if (process.env.NODE_ENV === 'production')
{
	console.error('The seed script only adds sample data for development. It won\'t run with NODE_ENV=production');
	process.exitCode = 1;
}
else
{
	try
	{
		const creator = await findCreator();

		await db.transaction(async (transaction) =>
		{
			await seed(transaction, creator);
		});
	}
	catch (error)
	{
		console.error('Seeding failed, so nothing was changed:', error);
		process.exitCode = 1;
	}
	finally
	{
		await pool.end();
	}
}
