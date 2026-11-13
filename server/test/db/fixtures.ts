import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';

import { CHUNK_SIZE, cellIndexInChunk, chunkCoordinate, chunkKey, DEFAULT_TILE_CELL, type AreaBounds, type ResolvedAreaSettings } from '@multiverse-kiln/shared';

import { createCharacter, type NewCharacter } from '../../src/db/characterRepo.js';
import type { Executor } from '../../src/db/client.js';
import { findDefaultClassIds } from '../../src/db/classRepo.js';
import { findDefaultDifficultyLevel } from '../../src/db/difficultyRepo.js';
import { createGroup } from '../../src/db/groupRepo.js';
import { findDefaultItemIds } from '../../src/db/itemRepo.js';
import { findDefaultRaceIds } from '../../src/db/raceRepo.js';
import { findDefaultTileIds } from '../../src/db/tileRepo.js';
import { inTransaction } from '../../src/db/transactions.js';
import { createUniverse, setUniverseAreas } from '../../src/db/universeRepo.js';
import { createArea, createAreaLink, findEditorArea, loadChunks, loadArea, saveGroundChunk, setAreaParents, storeResolvedSettings } from '../../src/db/areaRepo.js';
import { createRegion, listRegions, setRegionAssignments } from '../../src/db/regionRepo.js';
import { liveVersion } from '../../src/db/universeVersions.js';
import type { AreaLayout } from '../../src/logic/areaGrid.js';

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
		}]
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
 * Adds a group around a character, starting in an area, at the universe's default difficulty level
 *
 * @param universeId The universe's ID
 * @param anchorCharacterId The anchor being's character ID
 * @param startingAreaId Where the group starts, or null for the universe's starting area
 * @param name The group's name
 * @return The group's ID
 */
export async function addGroup(universeId: string, anchorCharacterId: string, startingAreaId: string | null, name: string = ''): Promise<string>
{
	const difficultyLevel = await findDefaultDifficultyLevel(liveVersion(universeId));

	if (!difficultyLevel)
	{
		throw new Error(`Universe ${universeId} has no default difficulty level`);
	}

	return(inTransaction((transaction) => createGroup({ universeId, anchorCharacterId, name, startingAreaId, startingColumn: 0, startingRow: 0, difficultyLevelId: difficultyLevel.id }, transaction)));
}

/**
 * Runs repository calls in a transaction that fails rather than wait for a lock, to show that a lock
 * another transaction holds doesn't block them
 *
 * @param work The calls to make
 * @return What work resolves with
 */
export function inTransactionWithoutWaiting<T>(work: (executor: Executor) => Promise<T>): Promise<T>
{
	return(inTransaction(async (transaction) =>
	{
		await transaction.execute(sql`SET LOCAL lock_timeout = '200ms'`);

		return(work(transaction));
	}));
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
 * The ID of one of the Pathfinder 1E default classes
 *
 * @param key The class's key, e.g. fighter
 * @return The class's ID
 */
export async function defaultClassId(key: string): Promise<number>
{
	const id = (await findDefaultClassIds('pf1e')).get(key);

	if (id === undefined)
	{
		throw new Error(`The default class "${key}" is missing from the test database`);
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
 * The name of the region addArea() puts a universe's areas in
 */
export const TEST_REGION_NAME = 'Test Region';

/**
 * The region of a universe's live version that addArea() puts its areas in, added the first time: top-level,
 * outdoors, lit, grass, with time flowing normally
 *
 * @param universeId The universe's ID
 * @return The region's ID
 */
export async function testRegionId(universeId: string): Promise<string>
{
	const version = liveVersion(universeId);
	const existing = (await listRegions(version)).find((region) => (region.name === TEST_REGION_NAME));

	if (existing)
	{
		return(existing.id);
	}

	return(createRegion(version, {
		name: TEST_REGION_NAME,
		enabled: null,
		indoors: false,
		lightLevel: 'lit',
		defaultTileId: await defaultTileId('grass'),
		passageOfTime: 'flows_normally',
		faerieMorning: null,
		fogOfWar: true
	}));
}

/**
 * Changes some of the settings stored as worked out for an area, which the rooms play, as a save would
 * once it works them out from the area's regions
 *
 * @param areaId The area's ID
 * @param changes The settings to change
 */
export async function setWorkedOut(areaId: string, changes: Partial<ResolvedAreaSettings>): Promise<void>
{
	const found = await findEditorArea(areaId);

	if (!found)
	{
		throw new Error(`No area ${areaId}`);
	}

	await storeResolvedSettings(new Map([[areaId, { ...found.area.resolved, ...changes }]]));
}

/**
 * Assigns builders to a universe's test region (testRegionId()), so they can edit the areas addArea() adds
 *
 * @param universeId The universe's ID
 * @param playerIds The builders' IDs, each already a builder of the universe
 */
export async function assignToTestRegion(universeId: string, playerIds: string[]): Promise<void>
{
	await setRegionAssignments(universeId, await testRegionId(universeId), playerIds);
}

/**
 * Adds an area to a universe, in its test region (testRegionId()): five columns by three rows of grass
 * around the center, unless told otherwise. A default tile or indoors given is the area's own setting
 *
 * @param universeId The universe's ID
 * @param name The area's name
 * @param options The area's bounds, default tile and whether it is indoors
 * @return The area's ID
 */
export async function addArea(universeId: string, name: string = 'Test Area', options: { bounds?: AreaBounds; tile?: string; indoors?: boolean } = {}): Promise<string>
{
	const indoors = (options.indoors ?? false);
	const tileId = await defaultTileId(options.tile ?? 'grass');
	const regionId = await testRegionId(universeId);
	const areaId = await createArea({
		universeId,
		name,
		loopsEastWest: false,
		loopsNorthSouth: false,
		indoors: ((options.indoors === undefined) ? null : indoors),
		defaultTileId: ((options.tile === undefined) ? null : tileId),
		resolved: {
			enabled: true,
			indoors,
			lightLevel: (indoors ? 'lit' : null),
			defaultTileId: tileId,
			passageOfTime: 'flows_normally',
			faerieMorning: null,
			fogOfWar: true
		},
		bounds: (options.bounds ?? { minColumn: -2, minRow: -1, maxColumn: 2, maxRow: 1 })
	});

	await setAreaParents(areaId, [{ kind: 'region', id: regionId }]);

	return(areaId);
}

/**
 * An area's whole layout: the area with every one of its stored chunks, for checking cells in tests
 *
 * @param areaId The area's ID
 * @return The layout, or undefined when there is no such area
 */
export async function loadWholeArea(areaId: string): Promise<AreaLayout | undefined>
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
		indoors: loaded.area.indoors,
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
