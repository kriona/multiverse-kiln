/**
 * The world editor's routes for a universe's areas, their cells and their links (listed in
 * shared/src/editor.ts), and saving changes to them (see editorChanges.ts)
 */
import express, { type Request, type Response } from 'express';
import { canEditWorld, DEFAULT_TILE_CELL, editsEveryPlace, isInBounds, isNewRef, MAX_AREA_LINKS, NEW_AREA_BOUNDS, VOID_CELL, type AreaChangeUpdate, type AreaEvacuations, type AreaNode, type CellChange, type CellChangeRef, type ChunkListPayload, type EditorArea, type FaerieMorning, type AreaBounds, type NewAreaChange, type NewRef, type PlaceRef, type StringRef, type UniverseSettings, type MessageDescriptor, type AreaLinkListPayload, type AreaLinkTarget, type AreaListPayload, type AreaSettings, type AreaSettingsUpdate } from '@multiverse-kiln/shared';

import type { Executor } from '../db/client.js';
import { loadUniverseTiles } from '../db/tileRepo.js';
import { findSiteSettings } from '../db/siteSettingsRepo.js';
import { deleteUniverseTextOf } from '../db/universeTextRepo.js';
import { listRegions } from '../db/regionRepo.js';
import { countAreaLinksBesides, countAreas, createArea, deleteArea, deleteAreaLink, editCells, findEditorArea, listAreaLinks, listAreas, listAreasLinkingTo, listStartingAreaIds, loadChunks, lockAreas, resizeArea, saveAreaLink, setAreaParents, storeResolvedSettings, updateAreaSettings } from '../db/areaRepo.js';
import { arrivalCell, enabledAncestor, type AreaInTree, type LinkInto } from '../logic/disabling.js';
import { chunksOfChanges } from '../logic/areaEdits.js';
import { isSameVersion } from '../db/universeVersions.js';
import type { AreaPlace } from '../world/areaChanges.js';
import { loadAreaContext, requireRole, universeContextOf, areaContextOf } from './editorAccess.js';
import { ChangeRefusal, recordRef, refuse, resolveNumberRef, resolveStringRef, type ChangeContext } from './editorChangeContext.js';
import { checkOwnSettings, faerieMorningMismatchMessage, requireParentChangesWithin, resolveParents } from './editorPlaces.js';
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

	router.get('/areas', requireRole(canEditWorld), listAreasRoute);
	router.use('/areas/:areaId', requireRole(canEditWorld), loadAreaContext, areaRouter);

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
		return(faerieMorningMismatchMessage);
	}

	if (faerie && ((settings.loopsEastWest === true) || (settings.loopsNorthSouth === true)))
	{
		return({
			id: 'error.faerieCantLoop',
			defaultMessage: 'An area whose passage of time is faerie can\'t loop.',
			description: 'Why an area can\'t both have faerie time and wrap around at its edges: shown by the area editor\'s loop checkboxes, and as the reason the server refused an area\'s settings'
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
			defaultMessage: 'The lobby\'s passage of time can\'t be faerie while its area loops.',
			description: 'Why the lobby\'s settings, or its area\'s, were refused: faerie time and an area that wraps around at its edges can\'t be combined'
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
	const { universe, version } = universeContextOf(request);
	const payload: AreaListPayload = {
		regions: await listRegions(version),
		areas: await listAreas(version),
		lobbyAreaId: universe.lobbyAreaId,
		startingAreaId: universe.startingAreaId,
		startingAreaIds: await listStartingAreaIds(version)
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
 * GET /:universeId/areas/:areaId/chunks: the stored chunks of the area in a range
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
 * @return The area, as the changes before this one left it; a missing area is refused, and so is one
 * outside a builder's assignments
 */
async function areaOf(context: ChangeContext, ref: StringRef): Promise<EditorArea>
{
	const found = await findEditorArea(resolveStringRef(context, ref), context.transaction);

	if (!found || !isSameVersion(found.version, context.version))
	{
		refuse(404, errorMessages.noSuchArea);
	}

	await context.places.requireWithin({ kind: 'area', id: found.area.id });

	return(found.area);
}

/**
 * An area of the version a change names, as the changes before it left it
 *
 * @param context The save
 * @param ref The area's ID, or the ref of one made earlier in the save
 * @return The area; a missing area is refused
 */
async function areaNodeOf(context: ChangeContext, ref: StringRef): Promise<AreaNode>
{
	const model = await context.places.load();
	const area = model.area(resolveStringRef(context, ref));

	if (!area)
	{
		refuse(404, errorMessages.noSuchArea);
	}

	return(area);
}

/**
 * An area's own settings in a save with the default tile it names, as saved
 *
 * @param context The save
 * @param update The settings
 * @return The settings, naming the default tile by its ID, without the parents
 */
function resolveAreaUpdate(context: ChangeContext, { defaultTileId, parents: _parents, ...rest }: AreaChangeUpdate): Omit<AreaSettingsUpdate, 'parents'>
{
	return({
		...rest,
		...((defaultTileId === undefined) ? {} : { defaultTileId: ((defaultTileId === null) ? null : resolveNumberRef(context, defaultTileId)) })
	});
}

/**
 * Adds an area to the universe, inside the parents it names. Settings left out take their defaults (see
 * NewAreaRequest); its settings are worked out once every change is saved
 *
 * @param context The save
 * @param ref The area's ref
 * @param area Its settings
 */
export async function createAreaChange(context: ChangeContext, ref: NewRef, area: NewAreaChange): Promise<void>
{
	const { universe, version, transaction } = context;
	const resolved = resolveAreaUpdate(context, area);
	const parents = await resolveParents(context, 'area', area.parents);
	const settings: Omit<AreaSettings, 'parents'> = {
		name: area.name,
		enabled: ((resolved.enabled !== undefined) ? resolved.enabled : ((universe.stage === 'in_the_beginning') ? null : false)),
		indoors: (resolved.indoors ?? null),
		lightLevel: (resolved.lightLevel ?? null),
		defaultTileId: (resolved.defaultTileId ?? null),
		passageOfTime: (resolved.passageOfTime ?? null),
		faerieMorning: (resolved.faerieMorning ?? null),
		fogOfWar: (resolved.fogOfWar ?? null),
		loopsEastWest: (resolved.loopsEastWest ?? false),
		loopsNorthSouth: (resolved.loopsNorthSouth ?? false)
	};

	await context.places.requireWithin(...parents);
	await checkOwnSettings(context, settings);

	const { areasPerUniverse } = await findSiteSettings(transaction);

	if (await countAreas(version, transaction) >= areasPerUniverse)
	{
		refuse(409, errorMessages.areaLimit, {
			max: areasPerUniverse
		});
	}

	const placeholder = await context.places.placeholderSettings();
	const areaId = await createArea({
		...settings,
		universeId: version.universeId,
		draft: version.draft,
		resolved: placeholder,
		bounds: NEW_AREA_BOUNDS
	}, transaction);

	await setAreaParents(areaId, parents, transaction);
	(await context.places.load()).setArea({ ...settings, id: areaId, parents });
	context.places.noteStored(areaId, placeholder);
	context.places.touch();
	recordRef(context, ref, areaId);
}

/**
 * Changes an area's settings or parents. Once the save has saved every change, each area other than
 * the lobby's that it leaves disabled sends the characters in it where moveTo says, those playing and
 * those saved there by their group (see editorDisablings.ts)
 *
 * @param context The save
 * @param areaId The area
 * @param update The settings to change
 * @param moveTo Where disabling the areas it disables sends the characters in them, by area
 */
export async function updateAreaChange(context: ChangeContext, areaId: StringRef, update: AreaChangeUpdate, moveTo: AreaEvacuations): Promise<void>
{
	const { universe, transaction } = context;
	const area = await areaNodeOf(context, areaId);
	const place: PlaceRef = { kind: 'area', id: area.id };
	const resolved = resolveAreaUpdate(context, update);
	const parents = ((update.parents === undefined) ? area.parents : await resolveParents(context, 'area', update.parents, area.id));
	const updated: AreaNode = { ...area, ...resolved, parents };

	await context.places.requireWithin(place);
	await requireParentChangesWithin(context, place, area.parents, parents);
	await checkOwnSettings(context, updated);

	if (area.id === universe.lobbyAreaId)
	{
		const lobbyProblem = lobbyTimeProblem(universe, updated);

		if (lobbyProblem !== undefined)
		{
			refuse(400, lobbyProblem);
		}
	}

	// The database refuses an area that loops with faerie time stored for it, though the save may yet
	// change its time, so the stored time is set aside until its settings are worked out again
	const stored = context.places.storedOf(area.id);

	if ((updated.loopsEastWest || updated.loopsNorthSouth) && (stored?.passageOfTime === 'faerie'))
	{
		const setAside = { ...stored, passageOfTime: null, faerieMorning: null };

		await storeResolvedSettings(new Map([[area.id, setAside]]), transaction);
		context.places.noteStored(area.id, setAside);
	}

	await updateAreaSettings(area.id, resolved, transaction);

	if (update.parents !== undefined)
	{
		await setAreaParents(area.id, parents, transaction);
	}

	(await context.places.load()).setArea(updated);
	context.places.touch();
	context.disablings.areas(moveTo);
	context.published.push({ kind: 'area', areaId: area.id });
}

/**
 * Where characters leaving a disabled area for its parent arrive: the nearest enabled area holding it,
 * on a link there leading back in, or its center
 *
 * @param transaction The save's transaction
 * @param areas Every area of the universe, as the save leaves them, by ID (see areasById())
 * @param areaId The disabled area
 * @param loadedLinks The links of the areas loaded so far, by area, which it adds the area it finds to,
 * so areas sharing a parent load its links once
 * @return The place, or null when no enabled area holds it, so they go where they start instead
 */
export async function parentPlace(transaction: Executor, areas: ReadonlyMap<string, AreaInTree>, areaId: string, loadedLinks: Map<string, readonly LinkInto[]>): Promise<AreaPlace | null>
{
	const found = enabledAncestor(areas, areaId);

	if (!found)
	{
		return(null);
	}

	let links = loadedLinks.get(found.ancestorId);

	if (links === undefined)
	{
		links = await listAreaLinks(found.ancestorId, transaction);
		loadedLinks.set(found.ancestorId, links);
	}

	return({
		areaId: found.ancestorId,
		...arrivalCell(links, found.passed)
	});
}

/**
 * Deletes an area, unless it is the universe's lobby or starting area. The areas inside it take its
 * parents in its place, beside their other parents
 *
 * @param context The save
 * @param areaId The area
 * @param moveTo Where the characters in the areas inside it go when their new parents disable them, by area
 */
export async function deleteAreaChange(context: ChangeContext, areaId: StringRef, moveTo: AreaEvacuations): Promise<void>
{
	const { universe, version, transaction } = context;
	const area = await areaNodeOf(context, areaId);

	if ((area.id === universe.lobbyAreaId) || (area.id === universe.startingAreaId))
	{
		refuse(409, {
			id: 'error.cantDeleteArea',
			defaultMessage: 'The lobby and starting areas can\'t be deleted.',
			description: 'Why an area couldn\'t be deleted: the universe needs it'
		});
	}

	await context.places.requireWithin({ kind: 'area', id: area.id });
	await context.places.requireLinksWithin(area.id);

	// The links leading here go with it, so the areas they're on are read again
	const linkingAreaIds = await listAreasLinkingTo(area.id, transaction);

	for (const child of (await context.places.load()).deleteArea(area.id))
	{
		await setAreaParents(child.id, child.parents, transaction);
		context.published.push({ kind: 'area', areaId: child.id });
	}

	context.places.touch();
	context.disablings.areas(moveTo);
	await deleteArea(area.id, transaction);
	await deleteUniverseTextOf(version, 'area', area.id, context.transaction);
	context.published.push({ kind: 'deleted', areaId: area.id });

	for (const linkingAreaId of linkingAreaIds)
	{
		context.published.push({ kind: 'area', areaId: linkingAreaId });
	}
}

/**
 * Gives an area new bounds
 *
 * @param context The save
 * @param areaId The area
 * @param bounds The new bounds
 * @param discard Whether to go ahead when shrinking would discard painted cells or links
 */
export async function resizeAreaChange(context: ChangeContext, areaId: StringRef, bounds: AreaBounds, discard: boolean): Promise<void>
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
				description: 'Why an area wasn\'t made smaller without asking: the part it would lose has painting or links'
			}
		}, {
			discardedCells: result.discardedCells,
			discardedLinks: result.discardedLinks
		});
	}

	context.published.push({ kind: 'area', areaId: area.id });

	// Links from other areas into the cells it lost were deleted, so those areas are read again
	for (const linkingAreaId of result.linkingAreaIds)
	{
		context.published.push({ kind: 'area', areaId: linkingAreaId });
	}
}

/**
 * Changes cells of an area
 *
 * @param context The save
 * @param areaId The area
 * @param changes The cells and their new values, whose tiles may be made earlier in the save
 */
export async function editCellsChange(context: ChangeContext, areaId: StringRef, changes: readonly CellChangeRef[]): Promise<void>
{
	const { universe, version, transaction } = context;
	const area = await areaOf(context, areaId);
	const resolved = changes.map(([column, row, value]): CellChange => [column, row, (isNewRef(value) ? resolveNumberRef(context, value) : value)]);

	// Deleting a tile waits for the universe's lock too, so a tile can't be deleted while it is being painted
	const usable = new Set((await loadUniverseTiles(version, universe.ruleset, transaction)).map((tile) => tile.id));

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
			defaultMessage: 'Every cell must be inside the area.',
			description: 'Why painting was refused: some cells are outside the area, perhaps because another editor made it smaller'
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
	const { version, transaction } = context;
	const area = await areaOf(context, areaId);
	const targetAreaId = resolveStringRef(context, target.targetAreaId);

	await context.places.requireWithin({ kind: 'area', id: targetAreaId });
	await requireLinkTargetWithin(context, area.id, column, row);

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

	if (!destination || !isSameVersion(destination.version, version))
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
			defaultMessage: 'The link\'s cell must be inside the area.',
			description: 'Why an area link was refused: its cell is outside the area, perhaps because another editor made it smaller'
		});
	}

	if (!isInBounds(destination.bounds, target.targetColumn, target.targetRow))
	{
		refuse(400, {
			id: 'error.linkTargetOutOfBounds',
			defaultMessage: 'Where the link goes must be inside the other area.',
			description: 'Why an area link was refused: the cell it leads to is outside the other area'
		});
	}

	if (await countAreaLinksBesides(area.id, column, row, transaction) >= MAX_AREA_LINKS)
	{
		refuse(409, {
			id: 'error.areaLinkLimit',
			defaultMessage: 'An area can have at most {max, plural, one {# link} other {# links}}.',
			description: 'Why an area link wasn\'t added: the area has as many links on its cells as allowed. A link takes characters who step on its cell to another area'
		}, {
			max: MAX_AREA_LINKS
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

	await requireLinkTargetWithin(context, area.id, column, row);

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
 * Refuses a builder's replacing or deleting the link on a cell when it leads outside their assignments,
 * which only creators delete
 *
 * @param context The save
 * @param areaId The area's ID
 * @param column The cell's column
 * @param row The cell's row
 */
async function requireLinkTargetWithin(context: ChangeContext, areaId: string, column: number, row: number): Promise<void>
{
	if (editsEveryPlace(context.role))
	{
		return;
	}

	const link = (await listAreaLinks(areaId, context.transaction)).find((each) => ((each.column === column) && (each.row === row)));

	if (link)
	{
		await context.places.requireWithin({ kind: 'area', id: link.targetAreaId });
	}
}
