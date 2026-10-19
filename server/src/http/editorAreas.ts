/**
 * The world editor's routes for a universe's areas, their maps and their links (listed in shared/src/editor.ts)
 */
import express, { type Request, type Response } from 'express';
import { canEditWorld, DEFAULT_TILE_CELL, isInBounds, localize, MAX_AREAS, NEW_AREA_BOUNDS, VOID_CELL, type ChunkListPayload, type CreatedPayload, type EditableUniverse, type EditorArea, type FaerieMorning, type MessageDescriptor, type ResizeConflictPayload, type Ruleset, type AreaLinkListPayload, type AreaListPayload, type AreaSettings } from '@multiverse-kiln/shared';

import { findDefaultTileIds, findTileKind, loadUniverseTiles } from '../db/tileRepo.js';
import { inTransaction } from '../db/transactions.js';
import { lockUniverse } from '../db/universeRepo.js';
import { countAreas, createArea, deleteArea, deleteAreaLink, editCells, listAreaLinks, listAreas, loadChunks, lockAreas, resizeArea, saveAreaLink, updateAreaSettings } from '../db/areaRepo.js';
import { chunksOfChanges, wouldCreateCycle } from '../logic/mapEdits.js';
import { areaChanges } from '../world/areaChanges.js';
import { loadAreaContext, requireRole, universeContextOf, areaContextOf } from './editorAccess.js';
import { cellEditRequest, cellParameters, chunkRange, newAreaRequest, resizeAreaRequest, areaLinkTarget, areaSettingsUpdate } from './editorPayloads.js';
import { errorMessages, sendError, sendInvalidRequest } from './errors.js';

/**
 * The keys of the default tiles new areas use in each ruleset, outdoors and indoors
 */
export const DEFAULT_AREA_TILE_KEYS: Record<Ruleset, { outdoors: string; indoors: string }> = {
	pf1e: { outdoors: 'grass', indoors: 'wood_floor' }
};

/**
 * Adds the area routes to a universe's router
 *
 * @param router The router for routes under /:universeId
 */
export function addAreaRoutes(router: express.Router): void
{
	const areaRouter = express.Router({ mergeParams: true });

	router.get('/areas', listAreasRoute);
	router.post('/areas', requireRole(canEditWorld), createAreaRoute);
	router.use('/areas/:areaId', loadAreaContext, areaRouter);

	areaRouter.get('/', getArea);
	areaRouter.patch('/', requireRole(canEditWorld), updateArea);
	areaRouter.delete('/', requireRole(canEditWorld), deleteAreaRoute);
	areaRouter.put('/bounds', requireRole(canEditWorld), resizeAreaRoute);
	areaRouter.get('/chunks', getChunks);
	areaRouter.patch('/cells', requireRole(canEditWorld), editCellsRoute);
	areaRouter.get('/links', getLinks);
	areaRouter.put('/links/:column/:row', requireRole(canEditWorld), saveLink);
	areaRouter.delete('/links/:column/:row', requireRole(canEditWorld), deleteLink);
}

/**
 * What is wrong with a universe's or area's passage of time, if anything
 *
 * @param settings The passage of time and faerie morning, and for an area whether it loops
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
			defaultMessage: 'An area whose passage of time is faerie can\'t loop.',
			description: 'Why an area\'s settings were refused: faerie time and a map that wraps around can\'t be combined'
		});
	}

	return(undefined);
}

/**
 * GET /:universeId/areas: every area of the universe
 *
 * @param request The request
 * @param response The response
 */
async function listAreasRoute(request: Request, response: Response): Promise<void>
{
	const { universe } = universeContextOf(request);
	const payload: AreaListPayload = {
		areas: await listAreas(universe.id),
		lobbyAreaId: universe.lobbyAreaId,
		startingAreaId: universe.startingAreaId
	};

	response.json(payload);
}

/**
 * POST /:universeId/areas: adds an area to the universe
 *
 * @param request The request
 * @param response The response
 */
async function createAreaRoute(request: Request, response: Response): Promise<void>
{
	const body = newAreaRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { universe } = universeContextOf(request);
	const indoors = (body.data.indoors ?? false);
	const settings: AreaSettings = {
		name: body.data.name,
		parentAreaId: (body.data.parentAreaId ?? null),
		enabled: (body.data.enabled ?? (universe.stage === 'in_the_beginning')),
		indoors,
		defaultTileId: (body.data.defaultTileId ?? await defaultAreaTileId(universe.ruleset, indoors)),
		passageOfTime: (body.data.passageOfTime ?? 'inherit'),
		faerieMorning: (body.data.faerieMorning ?? null),
		loopsEastWest: (body.data.loopsEastWest ?? false),
		loopsNorthSouth: (body.data.loopsNorthSouth ?? false)
	};
	const problem = await areaSettingsProblem(universe, undefined, settings);

	if (problem !== undefined)
	{
		sendError(response, 400, problem);
		return;
	}

	const areaId = await inTransaction(async (transaction) =>
	{
		await lockUniverse(universe.id, transaction);

		if (await countAreas(universe.id, transaction) >= MAX_AREAS)
		{
			return(undefined);
		}

		return(createArea({ ...settings, universeId: universe.id, bounds: NEW_AREA_BOUNDS }, transaction));
	});

	if (areaId === undefined)
	{
		sendError(response, 409, {
			id: 'error.areaLimit',
			defaultMessage: 'A universe can have at most {max, plural, one {# area} other {# areas}}.',
			description: 'Why a new area wasn\'t made: the universe has as many areas as allowed'
		}, { max: MAX_AREAS });
		return;
	}

	const payload: CreatedPayload = { id: areaId };

	response.status(201).json(payload);
}

/**
 * GET /:universeId/areas/:areaId: the area's settings and bounds
 *
 * @param request The request
 * @param response The response
 */
function getArea(request: Request, response: Response): void
{
	const payload: EditorArea = areaContextOf(request).area;

	response.json(payload);
}

/**
 * PATCH /:universeId/areas/:areaId: changes the area's settings
 *
 * @param request The request
 * @param response The response
 */
async function updateArea(request: Request, response: Response): Promise<void>
{
	const body = areaSettingsUpdate.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { universe, area } = areaContextOf(request);
	const problem = await areaSettingsProblem(universe, area.id, { ...area, ...body.data });

	if (problem !== undefined)
	{
		sendError(response, 400, problem);
		return;
	}

	await updateAreaSettings(area.id, body.data);
	areaChanges.publish({ kind: 'area', areaId: area.id });
	response.sendStatus(204);
}

/**
 * DELETE /:universeId/areas/:areaId: deletes the area, unless it is the universe's lobby or starting area
 *
 * @param request The request
 * @param response The response
 */
async function deleteAreaRoute(request: Request, response: Response): Promise<void>
{
	const { universe, area } = areaContextOf(request);

	if ((area.id === universe.lobbyAreaId) || (area.id === universe.startingAreaId))
	{
		sendError(response, 409, {
			id: 'error.cantDeleteArea',
			defaultMessage: 'The lobby and starting areas can\'t be deleted.',
			description: 'Why an area couldn\'t be deleted: the universe needs it'
		});
		return;
	}

	await deleteArea(area.id);
	areaChanges.publish({ kind: 'deleted', areaId: area.id });
	response.sendStatus(204);
}

/**
 * PUT /:universeId/areas/:areaId/bounds: gives the area's map new bounds
 *
 * @param request The request
 * @param response The response
 */
async function resizeAreaRoute(request: Request, response: Response): Promise<void>
{
	const body = resizeAreaRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { area } = areaContextOf(request);
	const result = await inTransaction((transaction) => resizeArea(area.id, body.data.bounds, body.data.discard, transaction));

	if (!result)
	{
		sendError(response, 404, errorMessages.noSuchArea);
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

	areaChanges.publish({ kind: 'area', areaId: area.id });
	response.sendStatus(204);
}

/**
 * GET /:universeId/areas/:areaId/chunks: the stored chunks of the area's map in a range
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
		chunks: await loadChunks(areaContextOf(request).area.id, range.data)
	};

	response.json(payload);
}

/**
 * PATCH /:universeId/areas/:areaId/cells: changes cells of the area's map
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

	const { universe, area } = areaContextOf(request);
	const result = await inTransaction(async (transaction) =>
	{
		// Deleting a tile waits for the same lock, so a tile can't be deleted while it is being painted
		await lockUniverse(universe.id, transaction);

		const usable = new Set((await loadUniverseTiles(universe.id, universe.ruleset, transaction)).map((tile) => tile.id));

		if (body.data.changes.some(([, , value]) => ((value !== DEFAULT_TILE_CELL) && (value !== VOID_CELL) && !usable.has(value))))
		{
			return('unusable_tile');
		}

		return(editCells(area.id, body.data.changes, transaction));
	});

	switch (result)
	{
		case 'edited':
			areaChanges.publish({ kind: 'cells', areaId: area.id, chunkKeys: [...chunksOfChanges(body.data.changes).keys()] });
			response.sendStatus(204);
			break;

		case 'not_found':
			sendError(response, 404, errorMessages.noSuchArea);
			break;

		case 'out_of_bounds':
			sendError(response, 400, {
				id: 'error.cellOutOfBounds',
				defaultMessage: 'Every cell must be inside the area\'s map.',
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
 * GET /:universeId/areas/:areaId/links: the links on the area's cells
 *
 * @param request The request
 * @param response The response
 */
async function getLinks(request: Request, response: Response): Promise<void>
{
	const payload: AreaLinkListPayload = {
		links: await listAreaLinks(areaContextOf(request).area.id)
	};

	response.json(payload);
}

/**
 * PUT /:universeId/areas/:areaId/links/:column/:row: adds or replaces the link on a cell
 *
 * @param request The request
 * @param response The response
 */
async function saveLink(request: Request, response: Response): Promise<void>
{
	const cell = cellParameters.safeParse(request.params);
	const body = areaLinkTarget.safeParse(request.body);

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

	const { universe, area } = areaContextOf(request);
	const { column, row } = cell.data;
	const target = body.data;

	if (target.targetAreaId === area.id)
	{
		sendError(response, 400, {
			id: 'error.linkToSameArea',
			defaultMessage: 'A link must go to another area.',
			description: 'Why an area link was refused: it leads to the area it is in'
		});
		return;
	}

	const problem = await inTransaction(async (transaction): Promise<MessageDescriptor | undefined> =>
	{
		// Locked so that neither area can shrink away from the link while it is saved
		const locked = await lockAreas([area.id, target.targetAreaId], transaction);
		const source = locked.get(area.id);
		const destination = locked.get(target.targetAreaId);

		if (!source)
		{
			return(errorMessages.noSuchArea);
		}

		if (!destination || (destination.universeId !== universe.id))
		{
			return({
				id: 'error.linkTargetNotInUniverse',
				defaultMessage: 'A link must go to another area of this universe.',
				description: 'Why an area link was refused: the area it leads to doesn\'t exist or is in another universe'
			});
		}

		if (!isInBounds(source.bounds, column, row))
		{
			return({
				id: 'error.linkOutOfBounds',
				defaultMessage: 'The link\'s cell must be inside the area\'s map.',
				description: 'Why an area link was refused: its cell is outside the map, perhaps because another editor made it smaller'
			});
		}

		if (!isInBounds(destination.bounds, target.targetColumn, target.targetRow))
		{
			return({
				id: 'error.linkTargetOutOfBounds',
				defaultMessage: 'Where the link goes must be inside the other area\'s map.',
				description: 'Why an area link was refused: the cell it leads to is outside the other area\'s map'
			});
		}

		await saveAreaLink(area.id, column, row, target, transaction);

		return(undefined);
	});

	if (problem !== undefined)
	{
		sendError(response, 400, problem);
		return;
	}

	areaChanges.publish({ kind: 'area', areaId: area.id });
	response.sendStatus(204);
}

/**
 * DELETE /:universeId/areas/:areaId/links/:column/:row: deletes the link on a cell
 *
 * @param request The request
 * @param response The response
 */
async function deleteLink(request: Request, response: Response): Promise<void>
{
	const cell = cellParameters.safeParse(request.params);

	const { area } = areaContextOf(request);

	if (!cell.success || !(await deleteAreaLink(area.id, cell.data.column, cell.data.row)))
	{
		sendError(response, 404, {
			id: 'error.noSuchLink',
			defaultMessage: 'There is no link on that cell.',
			description: 'Why an area link couldn\'t be deleted: it was already gone, perhaps deleted by another editor'
		});
		return;
	}

	areaChanges.publish({ kind: 'area', areaId: area.id });
	response.sendStatus(204);
}

/**
 * The tile a new area uses by default
 *
 * @param ruleset The universe's ruleset
 * @param indoors Whether the area is indoors
 * @return The tile's ID
 */
async function defaultAreaTileId(ruleset: Ruleset, indoors: boolean): Promise<number>
{
	const keys = DEFAULT_AREA_TILE_KEYS[ruleset];
	const key = (indoors ? keys.indoors : keys.outdoors);
	const tileId = (await findDefaultTileIds(ruleset)).get(key);

	if (tileId === undefined)
	{
		throw new Error(`The ${ruleset} default tile "${key}" is missing`);
	}

	return(tileId);
}

/**
 * What is wrong with an area's settings, if anything, beyond what the request validators check
 *
 * @param universe The area's universe
 * @param areaId The area's ID, or undefined for an area being created
 * @param settings The settings the area would have
 * @return Why the settings can't be saved, or undefined when they can
 */
async function areaSettingsProblem(universe: Omit<EditableUniverse, 'role'>, areaId: string | undefined, settings: AreaSettings): Promise<MessageDescriptor | undefined>
{
	const timeProblem = timeSettingsProblem(settings);

	if (timeProblem !== undefined)
	{
		return(timeProblem);
	}

	if (settings.parentAreaId !== null)
	{
		const parents = new Map((await listAreas(universe.id)).map((area) => [area.id, area.parentAreaId]));

		if (!parents.has(settings.parentAreaId))
		{
			return({
				id: 'error.parentNotInUniverse',
				defaultMessage: 'The parent area must be an area of this universe.',
				description: 'Why an area\'s settings were refused: the area chosen to hold it doesn\'t exist'
			});
		}

		if ((areaId !== undefined) && wouldCreateCycle(parents, areaId, settings.parentAreaId))
		{
			return({
				id: 'error.areaInsideItself',
				defaultMessage: 'An area can\'t be inside itself.',
				description: 'Why an area\'s settings were refused: the parent chosen is the area itself or an area inside it'
			});
		}
	}

	if (await findTileKind(universe.id, universe.ruleset, settings.defaultTileId) === undefined)
	{
		return({
			id: 'error.unusableDefaultTile',
			defaultMessage: 'The default tile must be a tile this universe can use.',
			description: 'Why an area\'s settings were refused: the default tile was deleted, perhaps by another editor'
		});
	}

	return(undefined);
}
