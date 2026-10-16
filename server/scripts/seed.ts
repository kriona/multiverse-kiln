/**
 * Fills the database with the sample universe in sampleUniverse.ts, for local development:
 *
 *   npm run db:seed -w server
 *
 * Run it by hand after migrating, like the migrations themselves; nothing runs it automatically. It
 * replaces the sample universe if it is already there, and leaves everything else alone. It refuses
 * to run when NODE_ENV is production
 *
 * To make a player the sample universe's creator, so they can open it in the editor, name them:
 *
 *   npm run db:seed -w server -- --creator "Ada"
 *
 * The player is created if nobody has the name yet. Replacing the universe also removes its editors,
 * so pass --creator every time
 */
import { parseArgs } from 'node:util';
import { CHUNK_SIZE, DEFAULT_TILE_CELL, VOID_CELL, cellIndexInChunk, chunkCoordinate, chunkKey, type MapBounds } from '@multiverse-kiln/shared';

import { db, pool, type Executor } from '../src/db/client.js';
import { loadOrCreatePlayerByName, type PlayerProfile } from '../src/db/playerRepo.js';
import { createTile, findDefaultTileIds } from '../src/db/tileRepo.js';
import { setUniverseRole } from '../src/db/universeEditorRepo.js';
import { describeInvalidPayload, loginPayload } from '../src/rooms/payloads.js';
import { createUniverse, deleteUniverse, setUniverseZones } from '../src/db/universeRepo.js';
import { createZone, createZoneLink, saveGroundChunk } from '../src/db/zoneRepo.js';
import { SAMPLE_UNIVERSE_ID, sampleLinks, sampleUniverse, sampleZones, stoneWall, type SampleZone } from './sampleUniverse.js';

/**
 * Which tile each map character stands for, besides `.`, space and a zone's digits
 */
const TILE_CHARACTERS: Record<string, string> = {
	'g': 'grass',
	'f': 'forest',
	'd': 'desert',
	'^': 'mountains',
	'~': 'water',
	'=': 'wood_floor',
	'#': stoneWall.key
};

/**
 * A zone's map, read from its drawing
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
 * Reads a zone's drawing into cells, centered on column 0, row 0
 *
 * @param zone The zone
 * @param tileIds Every tile's ID, by key
 * @return The map
 */
function parseMap(zone: SampleZone, tileIds: Map<string, number>): ParsedMap
{
	const width = zone.map[0].length;
	const height = zone.map.length;
	const bounds = {
		minColumn: -Math.floor(width / 2),
		minRow: -Math.floor(height / 2),
		maxColumn: (width - 1) - Math.floor(width / 2),
		maxRow: (height - 1) - Math.floor(height / 2)
	};
	const chunks: ParsedMap['chunks'] = new Map();
	const markers: ParsedMap['markers'] = new Map();

	zone.map.forEach((line, rowIndex) =>
	{
		if (line.length !== width)
		{
			throw new Error(`${zone.key}: row ${rowIndex} is ${line.length} cells wide, not ${width}`);
		}

		[...line].forEach((character, columnIndex) =>
		{
			const column = bounds.minColumn + columnIndex;
			const row = bounds.minRow + rowIndex;
			const value = cellValue(zone, character, tileIds);

			if (character in zone.markers)
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
 * @param zone The zone being read
 * @param character The character
 * @param tileIds Every tile's ID, by key
 * @return A tile ID, DEFAULT_TILE_CELL or VOID_CELL
 */
function cellValue(zone: SampleZone, character: string, tileIds: Map<string, number>): number
{
	if (character === '.')
	{
		return(DEFAULT_TILE_CELL);
	}

	if (character === ' ')
	{
		return(VOID_CELL);
	}

	const tileKey = (zone.markers[character] ?? TILE_CHARACTERS[character]);

	if (tileKey === undefined)
	{
		throw new Error(`${zone.key}: "${character}" isn't a tile or one of the zone's markers`);
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
 * Looks up the cell a digit marks in a zone
 *
 * @param maps Every zone's map, by zone key
 * @param zone The zone's key
 * @param marker The digit
 * @return The cell
 */
function requireMarker(maps: Map<string, ParsedMap>, zone: string, marker: string): { column: number; row: number }
{
	const cell = maps.get(zone)?.markers.get(marker);

	if (!cell)
	{
		throw new Error(`${zone} has no cell marked ${marker}`);
	}

	return(cell);
}

/**
 * Looks up a zone's ID by key
 *
 * @param zoneIds Every zone's ID, by key
 * @param key The zone's key
 * @return The zone's ID
 */
function requireZone(zoneIds: Map<string, string>, key: string): string
{
	const id = zoneIds.get(key);

	if (id === undefined)
	{
		throw new Error(`There is no zone "${key}" (a zone's parent must come before it)`);
	}

	return(id);
}

/**
 * Reads the name given with --creator, checked like a name typed at login
 *
 * @return The name, trimmed, or undefined when --creator wasn't given
 */
function readCreatorName(): string | undefined
{
	const { values } = parseArgs({ options: { creator: { type: 'string' } } });

	if (values.creator === undefined)
	{
		return(undefined);
	}

	const result = loginPayload.safeParse({ name: values.creator });

	if (!result.success)
	{
		throw new Error(`--creator must be a name a player could log in with (${describeInvalidPayload(result.error)})`);
	}

	return(result.data.name);
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

	tileIds.set(stoneWall.key, await createTile({ ...stoneWall, key: null, ruleset: 'pf1e', universeId }, executor));

	const zoneIds = new Map<string, string>();
	const maps = new Map<string, ParsedMap>();

	for (const zone of sampleZones)
	{
		const map = parseMap(zone, tileIds);
		const zoneId = await createZone({
			universeId,
			parentZoneId: ((zone.parent !== undefined) ? requireZone(zoneIds, zone.parent) : null),
			name: zone.name,
			enabled: true,
			indoors: zone.indoors,
			defaultTileId: requireTile(tileIds, zone.defaultTile),
			loopsEastWest: (zone.loopsEastWest ?? false),
			loopsNorthSouth: false,
			passageOfTime: 'inherit',
			bounds: map.bounds
		}, executor);

		for (const chunk of map.chunks.values())
		{
			await saveGroundChunk(zoneId, chunk.chunkColumn, chunk.chunkRow, chunk.cells, executor);
		}

		zoneIds.set(zone.key, zoneId);
		maps.set(zone.key, map);
	}

	for (const link of sampleLinks)
	{
		const from = requireMarker(maps, ...link.from);
		const to = requireMarker(maps, ...link.to);

		await createZoneLink({
			zoneId: requireZone(zoneIds, link.from[0]),
			column: from.column,
			row: from.row,
			targetZoneId: requireZone(zoneIds, link.to[0]),
			targetColumn: to.column,
			targetRow: to.row,
			mode: link.mode,
			requiresWholeGroup: false
		}, executor);
	}

	await setUniverseZones(universeId, requireZone(zoneIds, sampleUniverse.lobbyZone), requireZone(zoneIds, sampleUniverse.startingZone), executor);

	console.log(`Created ${sampleUniverse.name} with ${sampleZones.length} zones and ${sampleLinks.length} links`);

	if (creator)
	{
		await setUniverseRole(universeId, creator.id, 'creator', executor);
		console.log(`${creator.displayName} is its creator`);
	}
	else
	{
		console.log('Nobody can edit it. Pass --creator "<name>" to make a player its creator');
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
		const creatorName = readCreatorName();

		// Created outside the transaction like any login, so it stays if seeding fails
		const creator = ((creatorName === undefined) ? undefined : await loadOrCreatePlayerByName(creatorName));

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
