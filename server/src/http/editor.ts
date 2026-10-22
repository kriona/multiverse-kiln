/**
 * The world editor's REST API (routes listed in shared/src/editor.ts)
 *
 * Editing isn't real-time, so it uses plain HTTP rather than a room. Every route needs a logged-in
 * browser; routes about a universe also need a role in it, and changes need a role that allows them
 */
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import { canEditUniverseSettings, canEditWorld, defineMessages, EDITOR_UNIVERSES_PATH, MAX_CUSTOM_TILES, NEW_AREA_BOUNDS, SOURCE_LOCALE, Translator, type CreatedPayload, type EditableUniverse, type EditableUniverseListPayload, type RulesetSettings, type UniverseSettingsUpdate } from '@multiverse-kiln/shared';

import { lockPlayer } from '../db/playerRepo.js';
import { loadRulesetSettings, storeRulesetSettings } from '../db/rulesetRepo.js';
import { findSiteSettings } from '../db/siteSettingsRepo.js';
import { countCustomTiles, createCustomTile, deleteCustomTile, findDefaultTileIds, findTileKind, listEditorTiles, restoreDefaultTile, saveEditedDefaultTile, updateCustomTile } from '../db/tileRepo.js';
import { inTransaction } from '../db/transactions.js';
import { countUniversesWithRole, listEditableUniverses, setUniverseRole } from '../db/universeEditorRepo.js';
import { createUniverse, lockUniverse, setUniverseAreas, UniverseNameTakenError, updateUniverseSettings } from '../db/universeRepo.js';
import { createArea, findEditorArea, isTileInUse } from '../db/areaRepo.js';
import { areaChanges } from '../world/areaChanges.js';
import { loadUniverseContext, playerIdOf, refuseWritesFromOtherOrigins, requireLogin, requireRole, universeContextOf } from './editorAccess.js';
import { addDefaultStartingItems } from '../db/startingItemRepo.js';
import { addClassRoutes } from './editorClasses.js';
import { addItemRoutes } from './editorItems.js';
import { newUniverseRequest, rulesetSettings, tileIdParameter, tileListQuery, tileSettings, universeSettingsUpdate } from './editorPayloads.js';
import { addRaceRoutes } from './editorRaces.js';
import { addThemeRoutes } from './editorThemes.js';
import { findStartingProblem } from './editorStartingExtras.js';
import { addAreaRoutes, DEFAULT_AREA_TILE_KEYS, lobbyTimeProblem, timeSettingsProblem } from './editorAreas.js';
import { errorMessages, sendError, sendInvalidRequest, type Refusal } from './errors.js';

/**
 * Reasons the tile routes give in more than one place (see shared/src/localization.ts)
 */
const messages = defineMessages({
	noSuchTile: {
		id: 'error.noSuchTile',
		defaultMessage: 'The tile doesn\'t exist.',
		description: 'Why a request about a tile failed: it was deleted, perhaps by another editor'
	},
	tileNeedsName: {
		id: 'error.tileNeedsName',
		defaultMessage: 'A tile needs a name.',
		description: 'Why a tile the universe added couldn\'t be saved: its name was left out'
	}
});

/**
 * Names the areas of a new universe. The server has no translations, so they are in English; the
 * creator can rename them
 */
const universeTranslator = new Translator(SOURCE_LOCALE);

/**
 * Largest request body the editor accepts: a CellEditRequest of MAX_CELL_CHANGES cells fits well inside it
 */
const MAX_BODY_SIZE = '1mb';

/**
 * Adds the world editor's routes under EDITOR_UNIVERSES_PATH
 *
 * @param app Express app to add the routes to
 * @param allowedOrigins Normalized origins allowed to make changes from a browser
 */
export function addEditorRoutes(app: Application, allowedOrigins: Set<string>): void
{
	app.use(EDITOR_UNIVERSES_PATH, createEditorRouter(allowedOrigins));
}

/**
 * Builds the editor's router
 *
 * @param allowedOrigins Normalized origins allowed to make changes from a browser
 * @return The router
 */
function createEditorRouter(allowedOrigins: Set<string>): express.Router
{
	const router = express.Router();
	const universeRouter = express.Router({ mergeParams: true });

	router.use((_request, response, next) =>
	{
		response.set('Cache-Control', 'no-store');
		next();
	});
	router.use(refuseWritesFromOtherOrigins(allowedOrigins));
	router.use(express.json({ limit: MAX_BODY_SIZE }));
	router.use(requireLogin);

	router.get('/', listUniverses);
	router.post('/', createUniverseRoute);
	router.use('/:universeId', loadUniverseContext, universeRouter);

	universeRouter.get('/', getUniverse);
	universeRouter.patch('/', requireRole(canEditUniverseSettings), updateUniverse);
	universeRouter.get('/ruleset', getRulesetSettings);
	universeRouter.put('/ruleset', requireRole(canEditUniverseSettings), saveRulesetSettings);
	universeRouter.get('/tiles', listTiles);
	universeRouter.post('/tiles', requireRole(canEditWorld), createTileRoute);
	universeRouter.put('/tiles/:tileId', requireRole(canEditWorld), saveTile);
	universeRouter.delete('/tiles/:tileId', requireRole(canEditWorld), deleteTile);
	addItemRoutes(universeRouter);
	addRaceRoutes(universeRouter);
	addClassRoutes(universeRouter);
	addThemeRoutes(universeRouter);
	addAreaRoutes(universeRouter);

	router.use(handleEditorError);

	return(router);
}

/**
 * GET /: the universes the player has a role in
 *
 * @param request The request
 * @param response The response
 */
async function listUniverses(request: Request, response: Response): Promise<void>
{
	const { universeCreationEnabled, universesPerCreator } = await findSiteSettings();
	const payload: EditableUniverseListPayload = {
		universes: await listEditableUniverses(playerIdOf(request)),
		universeCreationEnabled,
		universesPerCreator
	};

	response.json(payload);
}

/**
 * Runs work that names a universe, refusing with 409 when another universe has the name. The work's
 * transaction has rolled back by then
 *
 * @param work The work, such as a transaction
 * @return What the work returns, or the refusal
 */
async function refusingTakenName<T>(work: () => Promise<T>): Promise<T | Refusal>
{
	try
	{
		return(await work());
	}
	catch (error)
	{
		if (error instanceof UniverseNameTakenError)
		{
			return({
				status: 409,
				message: errorMessages.universeNameTaken
			});
		}

		throw error;
	}
}

/**
 * POST /: a new universe with a lobby area and a starting area, created by the player
 *
 * @param request The request
 * @param response The response
 */
async function createUniverseRoute(request: Request, response: Response): Promise<void>
{
	const body = newUniverseRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const playerId = playerIdOf(request);
	const { name, shortDescription, ruleset } = body.data;
	const created = await refusingTakenName(() => inTransaction(async (transaction): Promise<Refusal | string> =>
	{
		// Concurrent requests from the same player wait here, so they can't all slip under the limit
		await lockPlayer(playerId, transaction);

		const { universeCreationEnabled, universesPerCreator } = await findSiteSettings(transaction);

		if (!universeCreationEnabled)
		{
			return({
				status: 403,
				message: {
					id: 'error.universeCreationDisabled',
					defaultMessage: 'Creating universes is turned off for now.',
					description: 'Why a new universe wasn\'t made: the site\'s admins have stopped everyone from creating universes'
				}
			});
		}

		if (await countUniversesWithRole(playerId, 'creator', transaction) >= universesPerCreator)
		{
			return({
				status: 409,
				message: {
					id: 'error.universeLimit',
					defaultMessage: 'You can create at most {max, plural, one {# universe} other {# universes}}.',
					description: 'Why a new universe wasn\'t made: the player has made as many as allowed'
				},
				values: {
					max: universesPerCreator
				}
			});
		}

		const createdId = await createUniverse({ name, shortDescription, ruleset }, transaction);
		const tileKey = DEFAULT_AREA_TILE_KEYS[ruleset].outdoors;
		const defaultTileId = (await findDefaultTileIds(ruleset, transaction)).get(tileKey);

		if (defaultTileId === undefined)
		{
			throw new Error(`The ${ruleset} default tile "${tileKey}" is missing`);
		}

		const area = {
			universeId: createdId,
			enabled: true,
			indoors: false,
			defaultTileId,
			bounds: NEW_AREA_BOUNDS
		};
		const lobbyAreaName = universeTranslator.format({
			id: 'universe.lobbyAreaName',
			defaultMessage: 'Lobby',
			description: 'Name given to the lobby area of a new universe, which its creator can change'
		});
		const startingAreaName = universeTranslator.format({
			id: 'universe.startingAreaName',
			defaultMessage: 'Starting Area',
			description: 'Name given to the area characters of a new universe start in, which its creator can change'
		});
		const lobbyAreaId = await createArea({ ...area, name: lobbyAreaName }, transaction);
		const startingAreaId = await createArea({ ...area, name: startingAreaName }, transaction);

		await setUniverseAreas(createdId, lobbyAreaId, startingAreaId, transaction);
		await addDefaultStartingItems(createdId, ruleset, transaction);
		await setUniverseRole(createdId, playerId, 'creator', transaction);

		return(createdId);
	}));

	if (typeof created !== 'string')
	{
		sendError(response, created.status, created.message, created.values);
		return;
	}

	const payload: CreatedPayload = { id: created };

	response.status(201).json(payload);
}

/**
 * GET /:universeId: the universe's settings, and the player's role in it
 *
 * @param request The request
 * @param response The response
 */
function getUniverse(request: Request, response: Response): void
{
	const { universe, role } = universeContextOf(request);
	const payload: EditableUniverse = { ...universe, role };

	response.json(payload);
}

/**
 * PATCH /:universeId: changes the universe's settings
 *
 * @param request The request
 * @param response The response
 */
async function updateUniverse(request: Request, response: Response): Promise<void>
{
	const { universe } = universeContextOf(request);
	const body = universeSettingsUpdate[universe.ruleset].safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const lobbyArea = ((universe.lobbyAreaId !== null) ? await findEditorArea(universe.lobbyAreaId) : undefined);
	const problem = (timeSettingsProblem({ ...universe, ...body.data })
		?? lobbyTimeProblem({ ...universe, ...body.data }, lobbyArea?.area));

	if (problem !== undefined)
	{
		sendError(response, 400, problem);
		return;
	}

	const { startingAreaId, startingItems } = body.data;
	const refusal = await refusingTakenName(() => inTransaction(async (transaction): Promise<Refusal | undefined> =>
	{
		// Deleting an item waits for the universe's lock too, so an item can't be deleted as it is added here
		await lockUniverse(universe.id, transaction);

		const found = await findStartingProblem(universe, {
			areaIds: ((startingAreaId === undefined) ? [] : [startingAreaId]),
			itemIds: startingItems?.map(({ itemId }) => itemId)
		}, transaction);

		if (found !== undefined)
		{
			return({
				status: 400,
				message: found
			});
		}

		await updateUniverseSettings(universe.id, body.data, transaction);

		return(undefined);
	}));

	if (refusal !== undefined)
	{
		sendError(response, refusal.status, refusal.message, refusal.values);
		return;
	}

	const timeKeys: (keyof UniverseSettingsUpdate)[] = ['passageOfTime', 'faerieMorning', 'lobbyPassageOfTime', 'lobbyDayHours', 'lobbyFaerieMorning'];

	if (timeKeys.some((key) => (body.data[key] !== undefined)))
	{
		areaChanges.publish({ kind: 'time', universeId: universe.id });
	}

	response.sendStatus(204);
}

/**
 * GET /:universeId/ruleset: how the universe plays under its ruleset
 *
 * @param request The request
 * @param response The response
 */
async function getRulesetSettings(request: Request, response: Response): Promise<void>
{
	const { universe } = universeContextOf(request);
	const payload: RulesetSettings = await loadRulesetSettings(universe.id, universe.ruleset);

	response.json(payload);
}

/**
 * PUT /:universeId/ruleset: changes how the universe plays under its ruleset
 *
 * @param request The request
 * @param response The response
 */
async function saveRulesetSettings(request: Request, response: Response): Promise<void>
{
	const body = rulesetSettings.safeParse(request.body);
	const { universe } = universeContextOf(request);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	if (body.data.ruleset !== universe.ruleset)
	{
		sendError(response, 400, {
			id: 'error.wrongRuleset',
			defaultMessage: 'These settings are for a different ruleset than the universe\'s.',
			description: 'Why a universe\'s ruleset settings were refused: they were made for another set of game rules'
		});
		return;
	}

	await storeRulesetSettings(universe.id, body.data);
	response.sendStatus(204);
}

/**
 * GET /:universeId/tiles: a page of the universe's tiles, filtered
 *
 * @param request The request
 * @param response The response
 */
async function listTiles(request: Request, response: Response): Promise<void>
{
	const query = tileListQuery.safeParse(request.query);

	if (!query.success)
	{
		sendInvalidRequest(response, query.error);
		return;
	}

	const { universe } = universeContextOf(request);

	response.json(await listEditorTiles(universe.id, universe.ruleset, query.data));
}

/**
 * POST /:universeId/tiles: adds a tile to the universe
 *
 * @param request The request
 * @param response The response
 */
async function createTileRoute(request: Request, response: Response): Promise<void>
{
	const body = tileSettings.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { name } = body.data;

	if (name === null)
	{
		sendError(response, 400, messages.tileNeedsName);
		return;
	}

	const { universe } = universeContextOf(request);
	const tileId = await inTransaction(async (transaction) =>
	{
		await lockUniverse(universe.id, transaction);

		if (await countCustomTiles(universe.id, transaction) >= MAX_CUSTOM_TILES)
		{
			return(undefined);
		}

		return(createCustomTile(universe.id, universe.ruleset, { ...body.data, name }, transaction));
	});

	if (tileId === undefined)
	{
		sendError(response, 409, {
			id: 'error.tileLimit',
			defaultMessage: 'A universe can have at most {max, plural, one {# tile} other {# tiles}} of its own.',
			description: 'Why a new tile wasn\'t made: the universe has as many tiles of its own as allowed'
		}, { max: MAX_CUSTOM_TILES });
		return;
	}

	const payload: CreatedPayload<number> = { id: tileId };

	areaChanges.publish({ kind: 'tiles', universeId: universe.id });
	response.status(201).json(payload);
}

/**
 * PUT /:universeId/tiles/:tileId: changes one of the universe's tiles, or stores its edited copy of a default tile
 *
 * @param request The request
 * @param response The response
 */
async function saveTile(request: Request, response: Response): Promise<void>
{
	const tileId = tileIdParameter.safeParse(request.params.tileId);
	const body = tileSettings.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { universe } = universeContextOf(request);
	const kind = (tileId.success ? await findTileKind(universe.id, universe.ruleset, tileId.data) : undefined);

	if (!tileId.success || (kind === undefined))
	{
		sendError(response, 404, messages.noSuchTile);
		return;
	}

	const { name } = body.data;

	if (kind === 'default')
	{
		await saveEditedDefaultTile(universe.id, universe.ruleset, tileId.data, body.data);
	}
	else if (name === null)
	{
		sendError(response, 400, messages.tileNeedsName);
		return;
	}
	else
	{
		await updateCustomTile(universe.id, tileId.data, { ...body.data, name });
	}

	areaChanges.publish({ kind: 'tiles', universeId: universe.id });
	response.sendStatus(204);
}

/**
 * DELETE /:universeId/tiles/:tileId: deletes one of the universe's own tiles if no map uses it, or
 * restores a default tile the universe has edited
 *
 * @param request The request
 * @param response The response
 */
async function deleteTile(request: Request, response: Response): Promise<void>
{
	const tileId = tileIdParameter.safeParse(request.params.tileId);
	const { universe } = universeContextOf(request);
	const kind = (tileId.success ? await findTileKind(universe.id, universe.ruleset, tileId.data) : undefined);

	if (!tileId.success || (kind === undefined))
	{
		sendError(response, 404, messages.noSuchTile);
		return;
	}

	if (kind === 'default')
	{
		await restoreDefaultTile(universe.id, tileId.data);
		areaChanges.publish({ kind: 'tiles', universeId: universe.id });
		response.sendStatus(204);
		return;
	}

	const deleted = await inTransaction(async (transaction) =>
	{
		// Painting waits for the universe's lock too, so the tile can't come into use before it is deleted
		await lockUniverse(universe.id, transaction);

		if (await isTileInUse(universe.id, tileId.data, transaction))
		{
			return(false);
		}

		await deleteCustomTile(universe.id, tileId.data, transaction);

		return(true);
	});

	if (!deleted)
	{
		sendError(response, 409, {
			id: 'error.tileInUse',
			defaultMessage: 'A map uses this tile, so it can\'t be deleted.',
			description: 'Why a tile couldn\'t be deleted: some area\'s map is painted with it'
		});
		return;
	}

	areaChanges.publish({ kind: 'tiles', universeId: universe.id });
	response.sendStatus(204);
}

/**
 * Answers errors from the editor's routes: 4xx errors from parsing the body as they are, anything else as 500
 *
 * @param error What went wrong
 * @param request The request
 * @param response The response
 * @param next The next error handler, for when the response has already started
 */
function handleEditorError(error: unknown, request: Request, response: Response, next: NextFunction): void
{
	if (response.headersSent)
	{
		next(error);
		return;
	}

	const status = (((typeof error === 'object') && (error !== null) && ('status' in error) && (typeof error.status === 'number')) ? error.status : 500);

	if ((status >= 400) && (status < 500))
	{
		sendError(response, status, errorMessages.unreadableBody);
		return;
	}

	console.error(`Editor request ${request.method} ${request.originalUrl} failed:`, error);
	sendError(response, 500, errorMessages.somethingWentWrong);
}
