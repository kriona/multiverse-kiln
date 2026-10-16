/**
 * The world editor's routes for a universe's zones, their maps and their links (listed in shared/src/editor.ts)
 */
import express, { type Request, type Response } from 'express';
import { canEditWorld, DEFAULT_TILE_CELL, isInBounds, localize, MAX_ZONES, NEW_ZONE_BOUNDS, VOID_CELL, type ChunkListPayload, type CreatedPayload, type EditableUniverse, type EditorZone, type FaerieMorning, type MessageDescriptor, type ResizeConflictPayload, type Ruleset, type ZoneLinkListPayload, type ZoneListPayload, type ZoneSettings } from '@multiverse-kiln/shared';

import { findDefaultTileIds, findTileKind, loadUniverseTiles } from '../db/tileRepo.js';
import { inTransaction } from '../db/transactions.js';
import { lockUniverse } from '../db/universeRepo.js';
import { countZones, createZone, deleteZone, deleteZoneLink, editCells, listZoneLinks, listZones, loadChunks, lockZones, resizeZone, saveZoneLink, updateZoneSettings } from '../db/zoneRepo.js';
import { chunksOfChanges, wouldCreateCycle } from '../logic/mapEdits.js';
import { zoneChanges } from '../world/zoneChanges.js';
import { loadZoneContext, requireRole, universeContextOf, zoneContextOf } from './editorAccess.js';
import { cellEditRequest, cellParameters, chunkRange, newZoneRequest, resizeZoneRequest, zoneLinkTarget, zoneSettingsUpdate } from './editorPayloads.js';
import { errorMessages, sendError, sendInvalidRequest } from './errors.js';

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
export function timeSettingsProblem(settings: { passageOfTime: string; faerieMorning: FaerieMorning | null; loopsEastWest?: boolean; loopsNorthSouth?: boolean }): MessageDescriptor | undefined
{
	const faerie = (settings.passageOfTime === 'faerie');

	if (faerie !== (settings.faerieMorning !== null))
	{
		return({
			id: 'error.faerieMorningMismatch',
			defaultMessage: 'Where morning is must be chosen when, and only when, the passage of time is faerie.',
			description: 'Why time settings were refused: "where is morning?" was given without faerie time, or left out with it'
		});
	}

	if (faerie && ((settings.loopsEastWest === true) || (settings.loopsNorthSouth === true)))
	{
		return({
			id: 'error.faerieCantLoop',
			defaultMessage: 'A zone whose passage of time is faerie can\'t loop.',
			description: 'Why a zone\'s settings were refused: faerie time and a map that wraps around can\'t be combined'
		});
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
		sendInvalidRequest(response, body.error);
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
		sendError(response, 400, problem);
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
		sendError(response, 409, {
			id: 'error.zoneLimit',
			defaultMessage: 'A universe can have at most {max, plural, one {# zone} other {# zones}}.',
			description: 'Why a new zone wasn\'t made: the universe has as many zones as allowed'
		}, { max: MAX_ZONES });
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
		sendInvalidRequest(response, body.error);
		return;
	}

	const { universe, zone } = zoneContextOf(request);
	const problem = await zoneSettingsProblem(universe, zone.id, { ...zone, ...body.data });

	if (problem !== undefined)
	{
		sendError(response, 400, problem);
		return;
	}

	await updateZoneSettings(zone.id, body.data);
	zoneChanges.publish({ kind: 'zone', zoneId: zone.id });
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
		sendError(response, 409, {
			id: 'error.cantDeleteZone',
			defaultMessage: 'The lobby and starting zones can\'t be deleted.',
			description: 'Why a zone couldn\'t be deleted: the universe needs it'
		});
		return;
	}

	await deleteZone(zone.id);
	zoneChanges.publish({ kind: 'deleted', zoneId: zone.id });
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
		sendInvalidRequest(response, body.error);
		return;
	}

	const { zone } = zoneContextOf(request);
	const result = await inTransaction((transaction) => resizeZone(zone.id, body.data.bounds, body.data.discard, transaction));

	if (!result)
	{
		sendError(response, 404, errorMessages.noSuchZone);
		return;
	}

	if (!result.resized)
	{
		const payload: ResizeConflictPayload = {
			error: localize({
				id: 'error.resizeDiscards',
				defaultMessage: 'Resizing would discard painted cells or links.',
				description: 'Why a map wasn\'t made smaller without asking: the part it would lose has painting or links'
			}),
			discardedCells: result.discardedCells,
			discardedLinks: result.discardedLinks
		};

		response.status(409).json(payload);
		return;
	}

	zoneChanges.publish({ kind: 'zone', zoneId: zone.id });
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
		sendInvalidRequest(response, range.error);
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
		sendInvalidRequest(response, body.error);
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
			zoneChanges.publish({ kind: 'cells', zoneId: zone.id, chunkKeys: [...chunksOfChanges(body.data.changes).keys()] });
			response.sendStatus(204);
			break;

		case 'not_found':
			sendError(response, 404, errorMessages.noSuchZone);
			break;

		case 'out_of_bounds':
			sendError(response, 400, {
				id: 'error.cellOutOfBounds',
				defaultMessage: 'Every cell must be inside the zone\'s map.',
				description: 'Why painting was refused: some cells are outside the map, perhaps because another editor made it smaller'
			});
			break;

		case 'unusable_tile':
			sendError(response, 400, {
				id: 'error.unusableTile',
				defaultMessage: 'One of the tiles painted isn\'t one this universe can use.',
				description: 'Why painting was refused: a tile was deleted, perhaps by another editor'
			});
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
		sendInvalidRequest(response, cell.error);
		return;
	}

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { universe, zone } = zoneContextOf(request);
	const { column, row } = cell.data;
	const target = body.data;

	if (target.targetZoneId === zone.id)
	{
		sendError(response, 400, {
			id: 'error.linkToSameZone',
			defaultMessage: 'A link must go to another zone.',
			description: 'Why a zone link was refused: it leads to the zone it is in'
		});
		return;
	}

	const problem = await inTransaction(async (transaction): Promise<MessageDescriptor | undefined> =>
	{
		// Locked so that neither zone can shrink away from the link while it is saved
		const locked = await lockZones([zone.id, target.targetZoneId], transaction);
		const source = locked.get(zone.id);
		const destination = locked.get(target.targetZoneId);

		if (!source)
		{
			return(errorMessages.noSuchZone);
		}

		if (!destination || (destination.universeId !== universe.id))
		{
			return({
				id: 'error.linkTargetNotInUniverse',
				defaultMessage: 'A link must go to another zone of this universe.',
				description: 'Why a zone link was refused: the zone it leads to doesn\'t exist or is in another universe'
			});
		}

		if (!isInBounds(source.bounds, column, row))
		{
			return({
				id: 'error.linkOutOfBounds',
				defaultMessage: 'The link\'s cell must be inside the zone\'s map.',
				description: 'Why a zone link was refused: its cell is outside the map, perhaps because another editor made it smaller'
			});
		}

		if (!isInBounds(destination.bounds, target.targetColumn, target.targetRow))
		{
			return({
				id: 'error.linkTargetOutOfBounds',
				defaultMessage: 'Where the link goes must be inside the other zone\'s map.',
				description: 'Why a zone link was refused: the cell it leads to is outside the other zone\'s map'
			});
		}

		await saveZoneLink(zone.id, column, row, target, transaction);

		return(undefined);
	});

	if (problem !== undefined)
	{
		sendError(response, 400, problem);
		return;
	}

	zoneChanges.publish({ kind: 'zone', zoneId: zone.id });
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

	const { zone } = zoneContextOf(request);

	if (!cell.success || !(await deleteZoneLink(zone.id, cell.data.column, cell.data.row)))
	{
		sendError(response, 404, {
			id: 'error.noSuchLink',
			defaultMessage: 'There is no link on that cell.',
			description: 'Why a zone link couldn\'t be deleted: it was already gone, perhaps deleted by another editor'
		});
		return;
	}

	zoneChanges.publish({ kind: 'zone', zoneId: zone.id });
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
async function zoneSettingsProblem(universe: Omit<EditableUniverse, 'role'>, zoneId: string | undefined, settings: ZoneSettings): Promise<MessageDescriptor | undefined>
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
			return({
				id: 'error.parentNotInUniverse',
				defaultMessage: 'The parent zone must be a zone of this universe.',
				description: 'Why a zone\'s settings were refused: the zone chosen to hold it doesn\'t exist'
			});
		}

		if ((zoneId !== undefined) && wouldCreateCycle(parents, zoneId, settings.parentZoneId))
		{
			return({
				id: 'error.zoneInsideItself',
				defaultMessage: 'A zone can\'t be inside itself.',
				description: 'Why a zone\'s settings were refused: the parent chosen is the zone itself or a zone inside it'
			});
		}
	}

	if (await findTileKind(universe.id, universe.ruleset, settings.defaultTileId) === undefined)
	{
		return({
			id: 'error.unusableDefaultTile',
			defaultMessage: 'The default tile must be a tile this universe can use.',
			description: 'Why a zone\'s settings were refused: the default tile was deleted, perhaps by another editor'
		});
	}

	return(undefined);
}
