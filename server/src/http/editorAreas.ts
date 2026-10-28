/**
 * The world editor's routes for a universe's areas, their maps and their links (listed in
 * shared/src/editor.ts), and saving changes to them (see editorChanges.ts)
 */
import express, { type Request, type Response } from 'express';
import { DEFAULT_AREA_TILE_KEYS, DEFAULT_TILE_CELL, isInBounds, isNewRef, MAX_AREAS, NEW_AREA_BOUNDS, VOID_CELL, type AreaChangeUpdate, type CellChange, type CellChangeRef, type ChunkListPayload, type EditorArea, type FaerieMorning, type MapBounds, type NewAreaChange, type NewRef, type Ruleset, type StringRef, type UniverseSettings, type MessageDescriptor, type AreaLinkListPayload, type AreaLinkTarget, type AreaListPayload, type AreaSettings, type AreaSettingsUpdate } from '@multiverse-kiln/shared';

import type { Executor } from '../db/client.js';
import { findDefaultTileIds, findTileKind, loadUniverseTiles } from '../db/tileRepo.js';
import { countAreas, createArea, deleteArea, deleteAreaLink, editCells, findEditorArea, listAreaLinks, listAreas, loadChunks, lockAreas, resizeArea, saveAreaLink, updateAreaSettings } from '../db/areaRepo.js';
import { chunksOfChanges, wouldCreateCycle } from '../logic/mapEdits.js';
import { loadAreaContext, universeContextOf, areaContextOf } from './editorAccess.js';
import { ChangeRefusal, recordRef, refuse, resolveNumberRef, resolveStringRef, type ChangeContext } from './editorChangeContext.js';
import { chunkRange } from './editorPayloads.js';
import { errorMessages, sendInvalidRequest } from './errors.js';

/**
 * Adds the area routes to a universe's router
 *
 * @param router The router for routes under /:universeId
 */
export function addAreaRoutes(router: express.Router): void
{
	const areaRouter = express.Router({ mergeParams: true });

	router.get('/areas', listAreasRoute);
	router.use('/areas/:areaId', loadAreaContext, areaRouter);

	areaRouter.get('/', getArea);
	areaRouter.get('/chunks', getChunks);
	areaRouter.get('/links', getLinks);
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
			description: 'Why an area can\'t both have faerie time and a map that wraps around: shown by the area editor\'s loop checkboxes, and as the reason the server refused an area\'s settings'
		});
	}

	return(undefined);
}

/**
 * What is wrong with a universe's lobby time, if anything
 *
 * @param lobby The lobby's passage of time and faerie morning
 * @param lobbyArea Whether the lobby's area loops, or undefined when the universe has no lobby area yet
 * @return Why the settings can't be saved, or undefined when they can
 */
export function lobbyTimeProblem(lobby: Pick<UniverseSettings, 'lobbyPassageOfTime' | 'lobbyFaerieMorning'>, lobbyArea: Pick<EditorArea, 'loopsEastWest' | 'loopsNorthSouth'> | undefined): MessageDescriptor | undefined
{
	const problem = timeSettingsProblem({
		passageOfTime: lobby.lobbyPassageOfTime,
		faerieMorning: lobby.lobbyFaerieMorning
	});

	if (problem !== undefined)
	{
		return(problem);
	}

	if ((lobby.lobbyPassageOfTime === 'faerie') && ((lobbyArea?.loopsEastWest ?? false) || (lobbyArea?.loopsNorthSouth ?? false)))
	{
		return({
			id: 'error.faerieLobbyCantLoop',
			defaultMessage: 'The lobby\'s passage of time can\'t be faerie while its map loops.',
			description: 'Why the lobby\'s settings, or its area\'s, were refused: faerie time and a map that wraps around can\'t be combined'
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
 * An area of the universe a change names
 *
 * @param context The save
 * @param ref The area's ID, or the ref of one made earlier in the save
 * @return The area, as the changes before this one left it; a missing area is refused
 */
async function areaOf(context: ChangeContext, ref: StringRef): Promise<EditorArea>
{
	const found = await findEditorArea(resolveStringRef(context, ref), context.transaction);

	if (!found || (found.universeId !== context.universe.id))
	{
		refuse(404, errorMessages.noSuchArea);
	}

	return(found.area);
}

/**
 * Area settings in a save with the things they name, as saved
 *
 * @param context The save
 * @param update The settings
 * @return The settings, naming the default tile and parent by their IDs
 */
function resolveAreaUpdate(context: ChangeContext, update: AreaChangeUpdate): AreaSettingsUpdate
{
	const { defaultTileId, parentAreaId, ...rest } = update;

	return({
		...rest,
		...((defaultTileId === undefined) ? {} : { defaultTileId: resolveNumberRef(context, defaultTileId) }),
		...((parentAreaId === undefined) ? {} : { parentAreaId: ((parentAreaId === null) ? null : resolveStringRef(context, parentAreaId)) })
	});
}

/**
 * Adds an area to the universe. Settings left out take their defaults (see NewAreaRequest)
 *
 * @param context The save
 * @param ref The area's ref
 * @param area Its settings
 */
export async function createAreaChange(context: ChangeContext, ref: NewRef, area: NewAreaChange): Promise<void>
{
	const { universe, transaction } = context;
	const resolved = resolveAreaUpdate(context, area);
	const indoors = (resolved.indoors ?? false);
	const settings: AreaSettings = {
		name: area.name,
		parentAreaId: (resolved.parentAreaId ?? null),
		enabled: (resolved.enabled ?? (universe.stage === 'in_the_beginning')),
		indoors,
		lightLevel: (resolved.lightLevel ?? 'lit'),
		defaultTileId: (resolved.defaultTileId ?? await defaultAreaTileId(universe.ruleset, indoors, transaction)),
		passageOfTime: (resolved.passageOfTime ?? 'inherit'),
		faerieMorning: (resolved.faerieMorning ?? null),
		loopsEastWest: (resolved.loopsEastWest ?? false),
		loopsNorthSouth: (resolved.loopsNorthSouth ?? false)
	};

	await checkAreaSettings(context, undefined, settings);

	if (await countAreas(universe.id, transaction) >= MAX_AREAS)
	{
		refuse(409, {
			id: 'error.areaLimit',
			defaultMessage: 'A universe can have at most {max, plural, one {# area} other {# areas}}.',
			description: 'Why a new area wasn\'t made: the universe has as many areas as allowed'
		}, {
			max: MAX_AREAS
		});
	}

	recordRef(context, ref, await createArea({ ...settings, universeId: universe.id, bounds: NEW_AREA_BOUNDS }, transaction));
}

/**
 * Changes an area's settings
 *
 * @param context The save
 * @param areaId The area
 * @param update The settings to change
 */
export async function updateAreaChange(context: ChangeContext, areaId: StringRef, update: AreaChangeUpdate): Promise<void>
{
	const area = await areaOf(context, areaId);
	const resolved = resolveAreaUpdate(context, update);

	await checkAreaSettings(context, area.id, { ...area, ...resolved });
	await updateAreaSettings(area.id, resolved, context.transaction);
	context.published.push({ kind: 'area', areaId: area.id });

	// The areas inside it may inherit its passage of time
	if ((resolved.passageOfTime !== undefined) || (resolved.faerieMorning !== undefined) || (resolved.parentAreaId !== undefined))
	{
		context.published.push({ kind: 'time', universeId: context.universe.id });
	}
}

/**
 * Deletes an area, unless it is the universe's lobby or starting area
 *
 * @param context The save
 * @param areaId The area
 */
export async function deleteAreaChange(context: ChangeContext, areaId: StringRef): Promise<void>
{
	const { universe } = context;
	const area = await areaOf(context, areaId);

	if ((area.id === universe.lobbyAreaId) || (area.id === universe.startingAreaId))
	{
		refuse(409, {
			id: 'error.cantDeleteArea',
			defaultMessage: 'The lobby and starting areas can\'t be deleted.',
			description: 'Why an area couldn\'t be deleted: the universe needs it'
		});
	}

	await deleteArea(area.id, context.transaction);
	context.published.push({ kind: 'deleted', areaId: area.id });
}

/**
 * Gives an area's map new bounds
 *
 * @param context The save
 * @param areaId The area
 * @param bounds The new bounds
 * @param discard Whether to go ahead when shrinking would discard painted cells or links
 */
export async function resizeAreaChange(context: ChangeContext, areaId: StringRef, bounds: MapBounds, discard: boolean): Promise<void>
{
	const area = await areaOf(context, areaId);
	const result = await resizeArea(area.id, bounds, discard, context.transaction);

	if (!result)
	{
		refuse(404, errorMessages.noSuchArea);
	}

	if (!result.resized)
	{
		throw new ChangeRefusal({
			status: 409,
			message: {
				id: 'error.resizeDiscards',
				defaultMessage: 'Resizing would discard painted cells or links.',
				description: 'Why a map wasn\'t made smaller without asking: the part it would lose has painting or links'
			}
		}, {
			discardedCells: result.discardedCells,
			discardedLinks: result.discardedLinks
		});
	}

	context.published.push({ kind: 'area', areaId: area.id });
}

/**
 * Changes cells of an area's map
 *
 * @param context The save
 * @param areaId The area
 * @param changes The cells and their new values, whose tiles may be made earlier in the save
 */
export async function editCellsChange(context: ChangeContext, areaId: StringRef, changes: readonly CellChangeRef[]): Promise<void>
{
	const { universe, transaction } = context;
	const area = await areaOf(context, areaId);
	const resolved = changes.map(([column, row, value]): CellChange => [column, row, (isNewRef(value) ? resolveNumberRef(context, value) : value)]);

	// Deleting a tile waits for the universe's lock too, so a tile can't be deleted while it is being painted
	const usable = new Set((await loadUniverseTiles(universe.id, universe.ruleset, transaction)).map((tile) => tile.id));

	if (resolved.some(([, , value]) => ((value !== DEFAULT_TILE_CELL) && (value !== VOID_CELL) && !usable.has(value))))
	{
		refuse(400, {
			id: 'error.unusableTile',
			defaultMessage: 'One of the tiles painted isn\'t one this universe can use.',
			description: 'Why painting was refused: a tile was deleted, perhaps by another editor'
		});
	}

	const result = await editCells(area.id, resolved, transaction);

	if (result === 'not_found')
	{
		refuse(404, errorMessages.noSuchArea);
	}

	if (result === 'out_of_bounds')
	{
		refuse(400, {
			id: 'error.cellOutOfBounds',
			defaultMessage: 'Every cell must be inside the area\'s map.',
			description: 'Why painting was refused: some cells are outside the map, perhaps because another editor made it smaller'
		});
	}

	context.published.push({ kind: 'cells', areaId: area.id, chunkKeys: [...chunksOfChanges(resolved).keys()] });
}

/**
 * Adds or replaces the link on a cell of an area
 *
 * @param context The save
 * @param areaId The area
 * @param column The cell's column
 * @param row The cell's row
 * @param target Where the link goes, whose area may be made earlier in the save
 */
export async function saveLinkChange(context: ChangeContext, areaId: StringRef, column: number, row: number, target: AreaLinkTarget): Promise<void>
{
	const { universe, transaction } = context;
	const area = await areaOf(context, areaId);
	const targetAreaId = resolveStringRef(context, target.targetAreaId);

	if (targetAreaId === area.id)
	{
		refuse(400, {
			id: 'error.linkToSameArea',
			defaultMessage: 'A link must go to another area.',
			description: 'Why an area link was refused: it leads to the area it is in'
		});
	}

	// Locked so that neither area can shrink away from the link while it is saved
	const locked = await lockAreas([area.id, targetAreaId], transaction);
	const source = locked.get(area.id);
	const destination = locked.get(targetAreaId);

	if (!source)
	{
		refuse(400, errorMessages.noSuchArea);
	}

	if (!destination || (destination.universeId !== universe.id))
	{
		refuse(400, {
			id: 'error.linkTargetNotInUniverse',
			defaultMessage: 'A link must go to another area of this universe.',
			description: 'Why an area link was refused: the area it leads to doesn\'t exist or is in another universe'
		});
	}

	if (!isInBounds(source.bounds, column, row))
	{
		refuse(400, {
			id: 'error.linkOutOfBounds',
			defaultMessage: 'The link\'s cell must be inside the area\'s map.',
			description: 'Why an area link was refused: its cell is outside the map, perhaps because another editor made it smaller'
		});
	}

	if (!isInBounds(destination.bounds, target.targetColumn, target.targetRow))
	{
		refuse(400, {
			id: 'error.linkTargetOutOfBounds',
			defaultMessage: 'Where the link goes must be inside the other area\'s map.',
			description: 'Why an area link was refused: the cell it leads to is outside the other area\'s map'
		});
	}

	await saveAreaLink(area.id, column, row, { ...target, targetAreaId }, transaction);
	context.published.push({ kind: 'area', areaId: area.id });
}

/**
 * Deletes the link on a cell of an area
 *
 * @param context The save
 * @param areaId The area
 * @param column The cell's column
 * @param row The cell's row
 */
export async function deleteLinkChange(context: ChangeContext, areaId: StringRef, column: number, row: number): Promise<void>
{
	const area = await areaOf(context, areaId);

	if (!(await deleteAreaLink(area.id, column, row, context.transaction)))
	{
		refuse(404, {
			id: 'error.noSuchLink',
			defaultMessage: 'There is no link on that cell.',
			description: 'Why an area link couldn\'t be deleted: it was already gone, perhaps deleted by another editor'
		});
	}

	context.published.push({ kind: 'area', areaId: area.id });
}

/**
 * The tile a new area uses by default
 *
 * @param ruleset The universe's ruleset
 * @param indoors Whether the area is indoors
 * @param executor The save's transaction
 * @return The tile's ID
 */
async function defaultAreaTileId(ruleset: Ruleset, indoors: boolean, executor: Executor): Promise<number>
{
	const keys = DEFAULT_AREA_TILE_KEYS[ruleset];
	const key = (indoors ? keys.indoors : keys.outdoors);
	const tileId = (await findDefaultTileIds(ruleset, executor)).get(key);

	if (tileId === undefined)
	{
		throw new Error(`The ${ruleset} default tile "${key}" is missing`);
	}

	return(tileId);
}

/**
 * Refuses an area's settings with a time that doesn't fit, a parent that isn't an area of the universe
 * or is inside the area, or a default tile the universe can't use
 *
 * @param context The save
 * @param areaId The area's ID, or undefined for an area being created
 * @param settings The settings the area would have
 */
async function checkAreaSettings(context: ChangeContext, areaId: string | undefined, settings: AreaSettings): Promise<void>
{
	const { universe, transaction } = context;
	const timeProblem = (timeSettingsProblem(settings)
		?? ((areaId === universe.lobbyAreaId) ? lobbyTimeProblem(universe, settings) : undefined));

	if (timeProblem !== undefined)
	{
		refuse(400, timeProblem);
	}

	if (settings.parentAreaId !== null)
	{
		const parents = new Map((await listAreas(universe.id, transaction)).map((area) => [area.id, area.parentAreaId]));

		if (!parents.has(settings.parentAreaId))
		{
			refuse(400, {
				id: 'error.parentNotInUniverse',
				defaultMessage: 'The parent area must be an area of this universe.',
				description: 'Why an area\'s settings were refused: the area chosen to hold it doesn\'t exist'
			});
		}

		if ((areaId !== undefined) && wouldCreateCycle(parents, areaId, settings.parentAreaId))
		{
			refuse(400, {
				id: 'error.areaInsideItself',
				defaultMessage: 'An area can\'t be inside itself.',
				description: 'Why an area\'s settings were refused: the parent chosen is the area itself or an area inside it'
			});
		}
	}

	if (await findTileKind(universe.id, universe.ruleset, settings.defaultTileId, transaction) === undefined)
	{
		refuse(400, {
			id: 'error.unusableDefaultTile',
			defaultMessage: 'The default tile must be a tile this universe can use.',
			description: 'Why an area\'s settings were refused: the default tile was deleted, perhaps by another editor'
		});
	}
}
