import { CHUNK_SIZE, cellIndexInChunk, DEFAULT_TILE_CELL, type MapBounds } from '@multiverse-kiln/shared';

import { findDefaultTileIds } from '../../src/db/tileRepo.js';
import { createUniverse, setUniverseZones } from '../../src/db/universeRepo.js';
import { createZone, createZoneLink, saveGroundChunk } from '../../src/db/zoneRepo.js';

/**
 * A universe with a lobby to walk around and a starting zone for groups, from addPlayableUniverse()
 */
export interface PlayableUniverse
{
	universeId: string;

	/**
	 * The lobby: 32 x 18 cells of grass from column 0, row 0, with forest at (10, 3) and mountains at
	 * (12, 3). Stepping onto (5, 5) takes a player into the house
	 */
	squareZoneId: string;

	/**
	 * 10 x 6 cells of wood floor from column 0, row 0. A player arrives at (2, 2), and (2, 4) has a
	 * manual link back out to (5, 6) in the square
	 */
	houseZoneId: string;

	/**
	 * Where groups start: 32 x 18 cells of grass from column 0, row 0
	 */
	fieldZoneId: string;
}

/**
 * The ID of one of the Pathfinder 1E default tiles
 *
 * @param key The tile's key
 * @return Its ID
 */
export async function defaultTileId(key: string): Promise<number>
{
	const id = (await findDefaultTileIds('pf1e')).get(key);

	if (id === undefined)
	{
		throw new Error(`The default tile "${key}" is missing from the test database`);
	}

	return(id);
}

/**
 * Adds a Pathfinder 1E universe with no zones
 *
 * @param name The universe's name
 * @return The universe's ID
 */
export async function addUniverse(name: string = 'Test Universe'): Promise<string>
{
	return(createUniverse({ name, ruleset: 'pf1e' }));
}

/**
 * Adds a zone to a universe: five columns by three rows of grass around the center, unless told otherwise
 *
 * @param universeId The universe's ID
 * @param name The zone's name
 * @param options The zone's bounds, default tile and whether it is indoors
 * @return The zone's ID
 */
export async function addZone(universeId: string, name: string = 'Test Zone', options: { bounds?: MapBounds; tile?: string; indoors?: boolean } = {}): Promise<string>
{
	return(createZone({
		universeId,
		name,
		indoors: (options.indoors ?? false),
		defaultTileId: await defaultTileId(options.tile ?? 'grass'),
		bounds: (options.bounds ?? { minColumn: -2, minRow: -1, maxColumn: 2, maxRow: 1 })
	}));
}

/**
 * Adds a universe with a lobby zone, a house off it, and a starting zone for groups (see PlayableUniverse)
 *
 * @return The universe's and zones' IDs
 */
export async function addPlayableUniverse(): Promise<PlayableUniverse>
{
	const universeId = await createUniverse({ name: 'Playable Universe', ruleset: 'pf1e', stage: 'let_there_be_light' });
	const wideBounds = { minColumn: 0, minRow: 0, maxColumn: 31, maxRow: 17 };
	const squareZoneId = await addZone(universeId, 'Square', { bounds: wideBounds });
	const houseZoneId = await addZone(universeId, 'House', { bounds: { minColumn: 0, minRow: 0, maxColumn: 9, maxRow: 5 }, tile: 'wood_floor', indoors: true });
	const fieldZoneId = await addZone(universeId, 'Field', { bounds: wideBounds });
	const cells = new Array<number>(CHUNK_SIZE * CHUNK_SIZE).fill(DEFAULT_TILE_CELL);

	cells[cellIndexInChunk(10, 3)] = await defaultTileId('forest');
	cells[cellIndexInChunk(12, 3)] = await defaultTileId('mountains');
	await saveGroundChunk(squareZoneId, 0, 0, cells);

	await createZoneLink({ zoneId: squareZoneId, column: 5, row: 5, targetZoneId: houseZoneId, targetColumn: 2, targetRow: 2, mode: 'automatic', requiresWholeGroup: false });
	await createZoneLink({ zoneId: houseZoneId, column: 2, row: 4, targetZoneId: squareZoneId, targetColumn: 5, targetRow: 6, mode: 'manual', requiresWholeGroup: false });
	await setUniverseZones(universeId, squareZoneId, fieldZoneId);

	return({ universeId, squareZoneId, houseZoneId, fieldZoneId });
}
