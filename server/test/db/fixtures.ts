import { randomUUID } from 'crypto';

import { CHUNK_SIZE, cellIndexInChunk, chunkCoordinate, chunkKey, DEFAULT_TILE_CELL, type MapBounds } from '@multiverse-kiln/shared';

import { createCharacter, type NewCharacter } from '../../src/db/characterRepo.js';
import { findDefaultClassIds } from '../../src/db/classRepo.js';
import { createGroup } from '../../src/db/groupRepo.js';
import { findDefaultItemIds } from '../../src/db/itemRepo.js';
import { findDefaultRaceIds } from '../../src/db/raceRepo.js';
import { findDefaultTileIds } from '../../src/db/tileRepo.js';
import { inTransaction } from '../../src/db/transactions.js';
import { createUniverse, setUniverseAreas } from '../../src/db/universeRepo.js';
import { createArea, createAreaLink, loadChunks, loadArea, saveGroundChunk } from '../../src/db/areaRepo.js';
import type { AreaMap } from '../../src/logic/areaGrid.js';

/**
 * A universe with a lobby to walk around and a starting area for groups, from addPlayableUniverse()
 */
export interface PlayableUniverse
{
	universeId: string;

	/**
	 * The lobby: 32 x 18 cells of grass from column 0, row 0, with forest at (10, 3) and mountains at
	 * (12, 3). Stepping onto (5, 5) takes a player into the house
	 */
	squareAreaId: string;

	/**
	 * 10 x 6 cells of wood floor from column 0, row 0. A player arrives at (2, 2), and (2, 4) has a
	 * manual link back out to (5, 6) in the square
	 */
	houseAreaId: string;

	/**
	 * Where groups start: 32 x 18 cells of grass from column 0, row 0
	 */
	fieldAreaId: string;
}

/**
 * A dwarf fighter with two daggers, for a player in a universe
 *
 * @param playerId The player's ID
 * @param universeId The universe's ID
 * @param name The character's name
 * @return The character
 */
export async function dwarfFighter(playerId: string, universeId: string, name: string = 'Brokk'): Promise<NewCharacter>
{
	const raceId = (await findDefaultRaceIds('pf1e')).get('dwarf');
	const classId = (await findDefaultClassIds('pf1e')).get('fighter');
	const daggerId = (await findDefaultItemIds('pf1e')).get('dagger');

	if ((raceId === undefined) || (classId === undefined) || (daggerId === undefined))
	{
		throw new Error('The default dwarf, fighter or dagger is missing from the test database');
	}

	return({
		playerId,
		universeId,
		ruleset: 'pf1e',
		name,
		raceId,
		classId,
		themeId: null,
		abilityScores: {
			strength: 16,
			dexterity: 12,
			constitution: 16,
			intelligence: 10,
			wisdom: 12,
			charisma: 6
		},
		money: {
			pp: 0,
			gp: 15,
			sp: 5,
			cp: 0,
			cr: 0
		},
		items: [{
			itemId: daggerId,
			quantity: 2
		}],
		areaId: null
	});
}

/**
 * Adds a dwarf fighter (see dwarfFighter) for a player in a universe
 *
 * @param playerId The player's ID
 * @param universeId The universe's ID
 * @param name The character's name
 * @return The character's ID
 */
export async function addCharacter(playerId: string, universeId: string, name: string): Promise<string>
{
	const character = await dwarfFighter(playerId, universeId, name);

	return(inTransaction((transaction) => createCharacter(character, transaction)));
}

/**
 * Adds a group around a character, starting in an area
 *
 * @param universeId The universe's ID
 * @param anchorCharacterId The anchor being's character ID
 * @param startingAreaId Where the group starts, or null for the universe's starting area
 * @param name The group's name
 * @return The group's ID
 */
export async function addGroup(universeId: string, anchorCharacterId: string, startingAreaId: string | null, name: string = ''): Promise<string>
{
	return(inTransaction((transaction) => createGroup({ universeId, anchorCharacterId, name, startingAreaId }, transaction)));
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
 * The ID of one of the Pathfinder 1E default races
 *
 * @param key The race's key
 * @return Its ID
 */
export async function defaultRaceId(key: string): Promise<number>
{
	const id = (await findDefaultRaceIds('pf1e')).get(key);

	if (id === undefined)
	{
		throw new Error(`The default race "${key}" is missing from the test database`);
	}

	return(id);
}

/**
 * A universe name no other universe has (universe names are unique). A counter wouldn't do, since names
 * that differ only in repeated characters, such as "1" and "11", count as the same
 *
 * @param prefix The start of the name
 * @return The name
 */
function newUniverseName(prefix: string): string
{
	return(`${prefix} ${randomUUID()}`);
}

/**
 * Adds a Pathfinder 1E universe with no areas
 *
 * @param name The universe's name, or undefined for a name no other universe has
 * @return The universe's ID
 */
export async function addUniverse(name?: string): Promise<string>
{
	return(createUniverse({
		name: (name ?? newUniverseName('Test Universe')),
		ruleset: 'pf1e'
	}));
}

/**
 * Adds an area to a universe: five columns by three rows of grass around the center, unless told otherwise
 *
 * @param universeId The universe's ID
 * @param name The area's name
 * @param options The area's bounds, default tile and whether it is indoors
 * @return The area's ID
 */
export async function addArea(universeId: string, name: string = 'Test Area', options: { bounds?: MapBounds; tile?: string; indoors?: boolean } = {}): Promise<string>
{
	return(createArea({
		universeId,
		name,
		indoors: (options.indoors ?? false),
		defaultTileId: await defaultTileId(options.tile ?? 'grass'),
		bounds: (options.bounds ?? { minColumn: -2, minRow: -1, maxColumn: 2, maxRow: 1 })
	}));
}

/**
 * An area's whole map: the area with every one of its stored chunks, for checking cells in tests
 *
 * @param areaId The area's ID
 * @return The map, or undefined when there is no such area
 */
export async function loadWholeMap(areaId: string): Promise<AreaMap | undefined>
{
	const loaded = await loadArea(areaId);

	if (!loaded)
	{
		return(undefined);
	}

	const { bounds } = loaded;
	const chunks = await loadChunks(areaId, {
		minChunkColumn: chunkCoordinate(bounds.minColumn),
		minChunkRow: chunkCoordinate(bounds.minRow),
		maxChunkColumn: chunkCoordinate(bounds.maxColumn),
		maxChunkRow: chunkCoordinate(bounds.maxRow)
	});

	return({
		tiles: {
			bounds,
			defaultTileId: loaded.defaultTileId,
			chunks: new Map(chunks.map((chunk) => [chunkKey(chunk.chunkColumn, chunk.chunkRow), chunk.cells]))
		},
		loopsEastWest: loaded.loopsEastWest,
		loopsNorthSouth: loaded.loopsNorthSouth,
		tileWalkSeconds: new Map(loaded.tiles.map((tile) => [tile.id, tile.walkSeconds])),
		links: loaded.links
	});
}

/**
 * Adds a universe with a lobby area, a house off it, and a starting area for groups (see PlayableUniverse)
 *
 * @return The universe's and areas' IDs
 */
export async function addPlayableUniverse(): Promise<PlayableUniverse>
{
	const universeId = await createUniverse({ name: newUniverseName('Playable Universe'), ruleset: 'pf1e', stage: 'let_there_be_light' });
	const wideBounds = { minColumn: 0, minRow: 0, maxColumn: 31, maxRow: 17 };
	const squareAreaId = await addArea(universeId, 'Square', { bounds: wideBounds });
	const houseAreaId = await addArea(universeId, 'House', { bounds: { minColumn: 0, minRow: 0, maxColumn: 9, maxRow: 5 }, tile: 'wood_floor', indoors: true });
	const fieldAreaId = await addArea(universeId, 'Field', { bounds: wideBounds });
	const cells = new Array<number>(CHUNK_SIZE * CHUNK_SIZE).fill(DEFAULT_TILE_CELL);

	cells[cellIndexInChunk(10, 3)] = await defaultTileId('forest');
	cells[cellIndexInChunk(12, 3)] = await defaultTileId('mountains');
	await saveGroundChunk(squareAreaId, 0, 0, cells);

	await createAreaLink({ areaId: squareAreaId, column: 5, row: 5, targetAreaId: houseAreaId, targetColumn: 2, targetRow: 2, mode: 'automatic', requiresWholeGroup: false });
	await createAreaLink({ areaId: houseAreaId, column: 2, row: 4, targetAreaId: squareAreaId, targetColumn: 5, targetRow: 6, mode: 'manual', requiresWholeGroup: false });
	await setUniverseAreas(universeId, squareAreaId, fieldAreaId);

	return({ universeId, squareAreaId, houseAreaId, fieldAreaId });
}
