/**
 * The world editor's routes for a universe's zones, their maps and their links (listed in shared/src/editor.ts)
 */
import express, { type Request, type Response } from 'express';
import { canEditWorld, DEFAULT_TILE_CELL, isInBounds, MAX_ZONES, NEW_ZONE_BOUNDS, VOID_CELL, type ChunkListPayload, type CreatedPayload, type EditableUniverse, type EditorZone, type FaerieMorning, type ResizeConflictPayload, type Ruleset, type ZoneLinkListPayload, type ZoneListPayload, type ZoneSettings } from '@multiverse-kiln/shared';

import { findDefaultTileIds, findTileKind, loadUniverseTiles } from '../db/tileRepo.js';
import { inTransaction } from '../db/transactions.js';
import { lockUniverse } from '../db/universeRepo.js';
import { countZones, createZone, deleteZone, deleteZoneLink, editCells, listZoneLinks, listZones, loadChunks, lockZones, resizeZone, saveZoneLink, updateZoneSettings } from '../db/zoneRepo.js';
import { wouldCreateCycle } from '../logic/mapEdits.js';
import { describeInvalidPayload } from '../rooms/payloads.js';
import { loadZoneContext, requireRole, universeContextOf, zoneContextOf } from './editorAccess.js';
import { cellEditRequest, cellParameters, chunkRange, newZoneRequest, resizeZoneRequest, zoneLinkTarget, zoneSettingsUpdate } from './editorPayloads.js';

/**
 * The keys of the default tiles new zones use in each ruleset, outdoors and indoors
 */
export const DEFAULT_ZONE_TILE_KEYS: Record<Ruleset, { outdoors: string; indoors: string }> = {
	pf1e: { outdoors: 'grass', indoors: 'wood_floor' }
};

/**
 * Adds the zone routes to a universe's router
 *
 * @param router The router for routes under /:universeId
 */
export function addZoneRoutes(router: express.Router): void
{
	const zoneRouter = express.Router({ mergeParams: true });

	router.get('/zones', listZonesRoute);
	router.post('/zones', requireRole(canEditWorld), createZoneRoute);
	router.use('/zones/:zoneId', loadZoneContext, zoneRouter);

	zoneRouter.get('/', getZone);
	zoneRouter.patch('/', requireRole(canEditWorld), updateZone);
	zoneRouter.delete('/', requireRole(canEditWorld), deleteZoneRoute);
	zoneRouter.put('/bounds', requireRole(canEditWorld), resizeZoneRoute);
	zoneRouter.get('/chunks', getChunks);
	zoneRouter.patch('/cells', requireRole(canEditWorld), editCellsRoute);
	zoneRouter.get('/links', getLinks);
	zoneRouter.put('/links/:column/:row', requireRole(canEditWorld), saveLink);
	zoneRouter.delete('/links/:column/:row', requireRole(canEditWorld), deleteLink);
}

/**
 * What is wrong with a universe's or zone's passage of time, if anything
 *
 * @param settings The passage of time and faerie morning, and for a zone whether it loops
 * @return Why the settings can't be saved, or undefined when they can
 */
export function timeSettingsProblem(settings: { passageOfTime: string; faerieMorning: FaerieMorning | null; loopsEastWest?: boolean; loopsNorthSouth?: boolean }): string | undefined
{
	const faerie = (settings.passageOfTime === 'faerie');

	if (faerie !== (settings.faerieMorning !== null))
	{
		return('faerieMorning must be set exactly when passageOfTime is faerie');
	}

	if (faerie && ((settings.loopsEastWest === true) || (settings.loopsNorthSouth === true)))
	{
		return('A zone whose passage of time is faerie can\'t loop');
	}

	return(undefined);
}

/**
 * GET /:universeId/zones: every zone of the universe
 *
 * @param request The request
 * @param response The response
 */
async function listZonesRoute(request: Request, response: Response): Promise<void>
{
	const { universe } = universeContextOf(request);
	const payload: ZoneListPayload = {
		zones: await listZones(universe.id),
		lobbyZoneId: universe.lobbyZoneId,
		startingZoneId: universe.startingZoneId
	};

	response.json(payload);
}

/**
 * POST /:universeId/zones: adds a zone to the universe
 *
 * @param request The request
 * @param response The response
 */
async function createZoneRoute(request: Request, response: Response): Promise<void>
{
	const body = newZoneRequest.safeParse(request.body);

	if (!body.success)
	{
		response.status(400).json({ error: describeInvalidPayload(body.error) });
		return;
	}

	const { universe } = universeContextOf(request);
	const indoors = (body.data.indoors ?? false);
	const settings: ZoneSettings = {
		name: body.data.name,
		parentZoneId: (body.data.parentZoneId ?? null),
		enabled: (body.data.enabled ?? (universe.stage === 'in_the_beginning')),
		indoors,
		defaultTileId: (body.data.defaultTileId ?? await defaultZoneTileId(universe.ruleset, indoors)),
		passageOfTime: (body.data.passageOfTime ?? 'inherit'),
		faerieMorning: (body.data.faerieMorning ?? null),
		loopsEastWest: (body.data.loopsEastWest ?? false),
		loopsNorthSouth: (body.data.loopsNorthSouth ?? false)
	};
	const problem = await zoneSettingsProblem(universe, undefined, settings);

	if (problem !== undefined)
	{
		response.status(400).json({ error: problem });
		return;
	}

	const zoneId = await inTransaction(async (transaction) =>
	{
		await lockUniverse(universe.id, transaction);

		if (await countZones(universe.id, transaction) >= MAX_ZONES)
		{
			return(undefined);
		}

		return(createZone({ ...settings, universeId: universe.id, bounds: NEW_ZONE_BOUNDS }, transaction));
	});

	if (zoneId === undefined)
	{
		response.status(409).json({ error: `A universe can have at most ${MAX_ZONES} zones` });
		return;
	}

	const payload: CreatedPayload = { id: zoneId };

	response.status(201).json(payload);
}

/**
 * GET /:universeId/zones/:zoneId: the zone's settings and bounds
 *
 * @param request The request
 * @param response The response
 */
function getZone(request: Request, response: Response): void
{
	const payload: EditorZone = zoneContextOf(request).zone;

	response.json(payload);
}

/**
 * PATCH /:universeId/zones/:zoneId: changes the zone's settings
 *
 * @param request The request
 * @param response The response
 */
async function updateZone(request: Request, response: Response): Promise<void>
{
	const body = zoneSettingsUpdate.safeParse(request.body);

	if (!body.success)
	{
		response.status(400).json({ error: describeInvalidPayload(body.error) });
		return;
	}

	const { universe, zone } = zoneContextOf(request);
	const problem = await zoneSettingsProblem(universe, zone.id, { ...zone, ...body.data });

	if (problem !== undefined)
	{
		response.status(400).json({ error: problem });
		return;
	}

	await updateZoneSettings(zone.id, body.data);
	response.sendStatus(204);
}

/**
 * DELETE /:universeId/zones/:zoneId: deletes the zone, unless it is the universe's lobby or starting zone
 *
 * @param request The request
 * @param response The response
 */
async function deleteZoneRoute(request: Request, response: Response): Promise<void>
{
	const { universe, zone } = zoneContextOf(request);

	if ((zone.id === universe.lobbyZoneId) || (zone.id === universe.startingZoneId))
	{
		response.status(409).json({ error: 'The lobby and starting zones can\'t be deleted' });
		return;
	}

	await deleteZone(zone.id);
	response.sendStatus(204);
}

/**
 * PUT /:universeId/zones/:zoneId/bounds: gives the zone's map new bounds
 *
 * @param request The request
 * @param response The response
 */
async function resizeZoneRoute(request: Request, response: Response): Promise<void>
{
	const body = resizeZoneRequest.safeParse(request.body);

	if (!body.success)
	{
		response.status(400).json({ error: describeInvalidPayload(body.error) });
		return;
	}

	const { zone } = zoneContextOf(request);
	const result = await inTransaction((transaction) => resizeZone(zone.id, body.data.bounds, body.data.discard, transaction));

	if (!result)
	{
		response.status(404).json({ error: 'No such zone' });
		return;
	}

	if (!result.resized)
	{
		const payload: ResizeConflictPayload = {
			error: 'Resizing would discard cells or links',
			discardedCells: result.discardedCells,
			discardedLinks: result.discardedLinks
		};

		response.status(409).json(payload);
		return;
	}

	response.sendStatus(204);
}

/**
 * GET /:universeId/zones/:zoneId/chunks: the stored chunks of the zone's map in a range
 *
 * @param request The request
 * @param response The response
 */
async function getChunks(request: Request, response: Response): Promise<void>
{
	const range = chunkRange.safeParse(request.query);

	if (!range.success)
	{
		response.status(400).json({ error: describeInvalidPayload(range.error) });
		return;
	}

	const payload: ChunkListPayload = {
		chunks: await loadChunks(zoneContextOf(request).zone.id, range.data)
	};

	response.json(payload);
}

/**
 * PATCH /:universeId/zones/:zoneId/cells: changes cells of the zone's map
 *
 * @param request The request
 * @param response The response
 */
async function editCellsRoute(request: Request, response: Response): Promise<void>
{
	const body = cellEditRequest.safeParse(request.body);

	if (!body.success)
	{
		response.status(400).json({ error: describeInvalidPayload(body.error) });
		return;
	}

	const { universe, zone } = zoneContextOf(request);
	const result = await inTransaction(async (transaction) =>
	{
		// Deleting a tile waits for the same lock, so a tile can't be deleted while it is being painted
		await lockUniverse(universe.id, transaction);

		const usable = new Set((await loadUniverseTiles(universe.id, universe.ruleset, transaction)).map((tile) => tile.id));

		if (body.data.changes.some(([, , value]) => ((value !== DEFAULT_TILE_CELL) && (value !== VOID_CELL) && !usable.has(value))))
		{
			return('unusable_tile');
		}

		return(editCells(zone.id, body.data.changes, transaction));
	});

	switch (result)
	{
		case 'edited':
			response.sendStatus(204);
			break;

		case 'not_found':
			response.status(404).json({ error: 'No such zone' });
			break;

		case 'out_of_bounds':
			response.status(400).json({ error: 'Every cell must be inside the zone\'s bounds' });
			break;

		case 'unusable_tile':
			response.status(400).json({ error: 'Every value must be a tile this universe can use, DEFAULT_TILE_CELL or VOID_CELL' });
			break;
	}
}

/**
 * GET /:universeId/zones/:zoneId/links: the links on the zone's cells
 *
 * @param request The request
 * @param response The response
 */
async function getLinks(request: Request, response: Response): Promise<void>
{
	const payload: ZoneLinkListPayload = {
		links: await listZoneLinks(zoneContextOf(request).zone.id)
	};

	response.json(payload);
}

/**
 * PUT /:universeId/zones/:zoneId/links/:column/:row: adds or replaces the link on a cell
 *
 * @param request The request
 * @param response The response
 */
async function saveLink(request: Request, response: Response): Promise<void>
{
	const cell = cellParameters.safeParse(request.params);
	const body = zoneLinkTarget.safeParse(request.body);

	if (!cell.success)
	{
		response.status(400).json({ error: describeInvalidPayload(cell.error) });
		return;
	}

	if (!body.success)
	{
		response.status(400).json({ error: describeInvalidPayload(body.error) });
		return;
	}

	const { universe, zone } = zoneContextOf(request);
	const { column, row } = cell.data;
	const target = body.data;

	if (target.targetZoneId === zone.id)
	{
		response.status(400).json({ error: 'A link must go to another zone' });
		return;
	}

	const problem = await inTransaction(async (transaction) =>
	{
		// Locked so that neither zone can shrink away from the link while it is saved
		const locked = await lockZones([zone.id, target.targetZoneId], transaction);
		const source = locked.get(zone.id);
		const destination = locked.get(target.targetZoneId);

		if (!source)
		{
			return('No such zone');
		}

		if (!destination || (destination.universeId !== universe.id))
		{
			return('The target must be another zone of this universe');
		}

		if (!isInBounds(source.bounds, column, row))
		{
			return('The cell must be inside the zone\'s bounds');
		}

		if (!isInBounds(destination.bounds, target.targetColumn, target.targetRow))
		{
			return('The target cell must be inside the target zone\'s bounds');
		}

		await saveZoneLink(zone.id, column, row, target, transaction);

		return(undefined);
	});

	if (problem !== undefined)
	{
		response.status(400).json({ error: problem });
		return;
	}

	response.sendStatus(204);
}

/**
 * DELETE /:universeId/zones/:zoneId/links/:column/:row: deletes the link on a cell
 *
 * @param request The request
 * @param response The response
 */
async function deleteLink(request: Request, response: Response): Promise<void>
{
	const cell = cellParameters.safeParse(request.params);

	if (!cell.success || !(await deleteZoneLink(zoneContextOf(request).zone.id, cell.data.column, cell.data.row)))
	{
		response.status(404).json({ error: 'No link on that cell' });
		return;
	}

	response.sendStatus(204);
}

/**
 * The tile a new zone uses by default
 *
 * @param ruleset The universe's ruleset
 * @param indoors Whether the zone is indoors
 * @return The tile's ID
 */
async function defaultZoneTileId(ruleset: Ruleset, indoors: boolean): Promise<number>
{
	const keys = DEFAULT_ZONE_TILE_KEYS[ruleset];
	const key = (indoors ? keys.indoors : keys.outdoors);
	const tileId = (await findDefaultTileIds(ruleset)).get(key);

	if (tileId === undefined)
	{
		throw new Error(`The ${ruleset} default tile "${key}" is missing`);
	}

	return(tileId);
}

/**
 * What is wrong with a zone's settings, if anything, beyond what the request validators check
 *
 * @param universe The zone's universe
 * @param zoneId The zone's ID, or undefined for a zone being created
 * @param settings The settings the zone would have
 * @return Why the settings can't be saved, or undefined when they can
 */
async function zoneSettingsProblem(universe: Omit<EditableUniverse, 'role'>, zoneId: string | undefined, settings: ZoneSettings): Promise<string | undefined>
{
	const timeProblem = timeSettingsProblem(settings);

	if (timeProblem !== undefined)
	{
		return(timeProblem);
	}

	if (settings.parentZoneId !== null)
	{
		const parents = new Map((await listZones(universe.id)).map((zone) => [zone.id, zone.parentZoneId]));

		if (!parents.has(settings.parentZoneId))
		{
			return('The parent must be a zone of this universe');
		}

		if ((zoneId !== undefined) && wouldCreateCycle(parents, zoneId, settings.parentZoneId))
		{
			return('A zone can\'t be inside itself');
		}
	}

	if (await findTileKind(universe.id, universe.ruleset, settings.defaultTileId) === undefined)
	{
		return('The default tile must be a tile this universe can use');
	}

	return(undefined);
}
