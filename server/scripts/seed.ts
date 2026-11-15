/**
 * Fills the database with the sample universe in sampleUniverse.ts, for local development:
 *
 *   npm run db:seed -w server
 *
 * Run it by hand after migrating, like the migrations themselves; nothing runs it automatically. When
 * the sample universe is already there, it replaces its world (its regions, areas, tiles and tilesets,
 * and its draft), keeping its characters, groups and editors, and leaves everything else alone. Groups
 * and characters saved in an area that went start over in the universe's starting area. It refuses to
 * run when NODE_ENV is production
 *
 * To make a player the sample universe's creator, so they can open it in the editor, give their username:
 *
 *   npm run db:seed -w server -- --creator ada
 *
 * The account must exist already: register it first
 */
import { parseArgs } from 'node:util';
import { areasWithMisalignedLoops, neighborProblems, resolveAreaSettings, type NeighborSide, type PlaceRef, type ResolvedAreaSettings } from '@multiverse-kiln/shared';

import { db, pool, type Executor } from '../src/db/client.js';
import { findPlayerByUsername, type PlayerProfile } from '../src/db/playerRepo.js';
import { addDefaultStartingItems } from '../src/db/startingItemRepo.js';
import { listTileGraphicStorageKeys } from '../src/db/tileGraphicRepo.js';
import { createTile, findDefaultTileIds } from '../src/db/tileRepo.js';
import { setUniverseRole } from '../src/db/universeEditorRepo.js';
import { discardDraft } from '../src/db/universeDraftRepo.js';
import { createUniverse, deleteUniverseWorld, findEditableUniverse, findUniverse, hasDraft, setUniverseAreas, updateUniverseSettings } from '../src/db/universeRepo.js';
import { createArea, createAreaLink, loadNeighborGrid, loadPlaceWorld, saveGroundChunk, setAreaNeighbor, setAreaParents, storeResolvedSettings } from '../src/db/areaRepo.js';
import { createRegion, setRegionParents } from '../src/db/regionRepo.js';
import { liveVersion } from '../src/db/universeVersions.js';
import { findBlockedArrivals } from '../src/http/editorPlaces.js';
import { deleteObjects } from '../src/storage/objectStorage.js';
import { SAMPLE_UNIVERSE_ID, parseArea, requireMarker, requireTile, sampleLinks, sampleRegions, sampleTiles, sampleUniverse, sampleAreas, type ParsedArea } from './sampleUniverse.js';

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
 * Looks up a region's ID by key
 *
 * @param regionIds Every region's ID, by key
 * @param key The region's key
 * @return The region's ID
 */
function requireRegion(regionIds: Map<string, string>, key: string): string
{
	const id = regionIds.get(key);

	if (id === undefined)
	{
		throw new Error(`There is no region "${key}" (a region's parents must come before it)`);
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
 * Creates the sample universe, or replaces the world of the one already there: its draft, regions, areas,
 * tiles and tilesets go, and its characters, groups, editors and other settings stay
 *
 * @param executor A transaction
 * @param creator The player to make its creator, if any
 * @return Where the replaced universe's uploaded tile graphics are in object storage, to delete once the transaction commits
 */
async function seed(executor: Executor, creator: PlayerProfile | undefined): Promise<string[]>
{
	const storageKeys = await listTileGraphicStorageKeys(SAMPLE_UNIVERSE_ID, executor);
	const universeId = SAMPLE_UNIVERSE_ID;
	const version = liveVersion(universeId);

	if (await findUniverse(universeId, executor))
	{
		console.log(`Replacing the world of ${sampleUniverse.name}, keeping its characters and groups`);

		if (await hasDraft(universeId, executor))
		{
			await discardDraft(universeId, executor);
		}

		await deleteUniverseWorld(universeId, executor);
		await updateUniverseSettings(version, {
			name: sampleUniverse.name,
			shortDescription: sampleUniverse.shortDescription,
			longDescription: sampleUniverse.longDescription,
			stage: sampleUniverse.stage
		}, executor);
	}
	else
	{
		await createUniverse({
			id: universeId,
			name: sampleUniverse.name,
			shortDescription: sampleUniverse.shortDescription,
			longDescription: sampleUniverse.longDescription,
			stage: sampleUniverse.stage,
			ruleset: 'pf1e'
		}, executor);
		await addDefaultStartingItems(universeId, 'pf1e', executor);
	}

	const tileIds = await findDefaultTileIds('pf1e', executor);

	for (const tile of Object.values(sampleTiles))
	{
		tileIds.set(tile.key, await createTile({ ...tile, key: null, ruleset: 'pf1e', universeId }, executor));
	}

	const regionIds = new Map<string, string>();

	for (const region of sampleRegions)
	{
		const regionId = await createRegion(version, {
			name: region.name,
			enabled: null,
			indoors: (region.indoors ?? null),
			lightLevel: (region.lightLevel ?? null),
			defaultTileId: ((region.defaultTile === undefined) ? null : requireTile(tileIds, region.defaultTile)),
			passageOfTime: (region.passageOfTime ?? null),
			faerieMorning: null,
			fogOfWar: (region.fogOfWar ?? null)
		}, executor);

		await setRegionParents(regionId, region.parents.map((parent) => requireRegion(regionIds, parent)), executor);
		regionIds.set(region.key, regionId);
	}

	const areaIds = new Map<string, string>();
	const parsedAreas = new Map<string, ParsedArea>();

	// Any settings will do until every area's are worked out below
	const placeholder: ResolvedAreaSettings = {
		enabled: true,
		indoors: false,
		lightLevel: null,
		defaultTileId: requireTile(tileIds, 'grass'),
		passageOfTime: 'flows_normally',
		faerieMorning: null,
		fogOfWar: true,
		lobby: false
	};

	for (const area of sampleAreas)
	{
		const parsed = parseArea(area, tileIds);
		const areaId = await createArea({
			universeId,
			name: area.name,
			enabled: null,
			indoors: (area.indoors ?? null),
			lightLevel: (area.lightLevel ?? null),
			defaultTileId: ((area.defaultTile === undefined) ? null : requireTile(tileIds, area.defaultTile)),
			loopsEastWest: (area.loopsEastWest ?? false),
			loopsNorthSouth: false,
			resolved: placeholder,
			bounds: parsed.bounds
		}, executor);

		await setAreaParents(areaId, [
			...area.regions.map((key): PlaceRef => ({ kind: 'region', id: requireRegion(regionIds, key) })),
			...((area.parentArea === undefined) ? [] : [{ kind: 'area', id: requireArea(areaIds, area.parentArea) } satisfies PlaceRef])
		], executor);

		for (const chunk of parsed.chunks.values())
		{
			await saveGroundChunk(areaId, chunk.chunkColumn, chunk.chunkRow, chunk.cells, executor);
		}

		areaIds.set(area.key, areaId);
		parsedAreas.set(area.key, parsed);
	}

	const lobbyRegionId = requireRegion(regionIds, sampleUniverse.lobbyRegion);

	await setUniverseAreas(universeId, {
		lobbyRegionId,
		lobbyAreaId: requireArea(areaIds, sampleUniverse.lobbyArea),
		startingAreaId: requireArea(areaIds, sampleUniverse.startingArea)
	}, executor);

	const lobbySquare = requireMarker(parsedAreas, sampleUniverse.lobbyArea, sampleUniverse.lobbySquare);
	const startingSquare = requireMarker(parsedAreas, sampleUniverse.startingArea, sampleUniverse.startingSquare);

	await updateUniverseSettings(version, {
		lobbyColumn: lobbySquare.column,
		lobbyRow: lobbySquare.row,
		startingColumn: startingSquare.column,
		startingRow: startingSquare.row
	}, executor);

	// Every area's settings come from its own and its regions', as a save in the editor works them out
	const { world } = await loadPlaceWorld(version, 'pf1e', lobbyRegionId, executor);
	const resolution = resolveAreaSettings(world);

	if (resolution.problems.length > 0)
	{
		throw new Error(`The sample world's settings can't be worked out: ${JSON.stringify(resolution.problems)}`);
	}

	await storeResolvedSettings(resolution.stored, executor);

	for (const link of sampleLinks)
	{
		const from = requireMarker(parsedAreas, ...link.from);
		const to = requireMarker(parsedAreas, ...link.to);

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

	// Each pair of neighbors is set from one of its areas, which sets both ways
	for (const area of sampleAreas)
	{
		for (const [side, neighbor] of Object.entries(area.neighbors ?? {}) as [NeighborSide, string][])
		{
			await setAreaNeighbor(requireArea(areaIds, area.key), side, requireArea(areaIds, neighbor), executor);
		}
	}

	const grid = await loadNeighborGrid(version, executor);
	const neighborProblemsFound = neighborProblems(grid);
	const misaligned = areasWithMisalignedLoops(grid);

	if (neighborProblemsFound.length > 0)
	{
		throw new Error(`The sample world's neighboring areas don't fit together: ${JSON.stringify(neighborProblemsFound)}`);
	}

	if (misaligned.length > 0)
	{
		throw new Error(`The sample world's rows or columns of neighboring areas don't loop alike: ${misaligned.map((areaId) => sampleAreas.find((area) => (areaIds.get(area.key) === areaId))?.key ?? areaId).join(', ')}`);
	}

	const universe = await findEditableUniverse(version, executor);
	const blocked = (universe ? await findBlockedArrivals(version, universe, undefined, executor) : []);

	if (blocked.length > 0)
	{
		throw new Error(`The sample world's starting squares or links send characters to squares they can't walk on: ${JSON.stringify(blocked)}`);
	}

	console.log(`Created ${sampleUniverse.name} with ${sampleRegions.length} regions, ${sampleAreas.length} areas and ${sampleLinks.length} links`);

	if (creator)
	{
		await setUniverseRole(universeId, creator.id, 'creator', executor);
		console.log(`${creator.displayName} (${creator.username}) is its creator`);
	}
	else
	{
		console.log('Nobody can edit it. Pass --creator <username> to make an account its creator');
	}

	return(storageKeys);
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

		const storageKeys = await db.transaction(async (transaction) =>
		{
			return(await seed(transaction, creator));
		});

		await deleteObjects(storageKeys);
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
