/**
 * The world editor's REST API (routes listed in shared/src/editor.ts)
 *
 * Editing isn't real-time, so it uses plain HTTP rather than a room. Every route needs a logged-in
 * browser; routes about a universe also need a role in it, and changes need a role that allows them
 */
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import { canEditUniverseSettings, canEditWorld, EDITOR_UNIVERSES_PATH, MAX_CREATED_UNIVERSES, MAX_CUSTOM_TILES, NEW_ZONE_BOUNDS, type CreatedPayload, type EditableUniverse, type EditableUniverseListPayload } from '@multiverse-kiln/shared';

import { lockPlayer } from '../db/playerRepo.js';
import { countCustomTiles, createCustomTile, deleteCustomTile, findDefaultTileIds, findTileKind, listEditorTiles, restoreDefaultTile, saveEditedDefaultTile, updateCustomTile } from '../db/tileRepo.js';
import { inTransaction } from '../db/transactions.js';
import { countUniversesWithRole, listEditableUniverses, setUniverseRole } from '../db/universeEditorRepo.js';
import { createUniverse, lockUniverse, setUniverseZones, updateUniverseSettings } from '../db/universeRepo.js';
import { createZone, isTileInUse } from '../db/zoneRepo.js';
import { describeInvalidPayload } from '../rooms/payloads.js';
import { loadUniverseContext, playerIdOf, refuseWritesFromOtherOrigins, requireLogin, requireRole, universeContextOf } from './editorAccess.js';
import { newUniverseRequest, tileIdParameter, tileListQuery, tileSettings, universeSettingsUpdate } from './editorPayloads.js';
import { addZoneRoutes, DEFAULT_ZONE_TILE_KEYS, timeSettingsProblem } from './editorZones.js';

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
	universeRouter.get('/tiles', listTiles);
	universeRouter.post('/tiles', requireRole(canEditWorld), createTileRoute);
	universeRouter.put('/tiles/:tileId', requireRole(canEditWorld), saveTile);
	universeRouter.delete('/tiles/:tileId', requireRole(canEditWorld), deleteTile);
	addZoneRoutes(universeRouter);

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
	const payload: EditableUniverseListPayload = {
		universes: await listEditableUniverses(playerIdOf(request))
	};

	response.json(payload);
}

/**
 * POST /: a new universe with a lobby zone and a starting zone, created by the player
 *
 * @param request The request
 * @param response The response
 */
async function createUniverseRoute(request: Request, response: Response): Promise<void>
{
	const body = newUniverseRequest.safeParse(request.body);

	if (!body.success)
	{
		response.status(400).json({ error: describeInvalidPayload(body.error) });
		return;
	}

	const playerId = playerIdOf(request);
	const { name, shortDescription, ruleset } = body.data;
	const universeId = await inTransaction(async (transaction) =>
	{
		// Concurrent requests from the same player wait here, so they can't all slip under the limit
		await lockPlayer(playerId, transaction);

		if (await countUniversesWithRole(playerId, 'creator', transaction) >= MAX_CREATED_UNIVERSES)
		{
			return(undefined);
		}

		const createdId = await createUniverse({ name, shortDescription, ruleset }, transaction);
		const tileKey = DEFAULT_ZONE_TILE_KEYS[ruleset].outdoors;
		const defaultTileId = (await findDefaultTileIds(ruleset, transaction)).get(tileKey);

		if (defaultTileId === undefined)
		{
			throw new Error(`The ${ruleset} default tile "${tileKey}" is missing`);
		}

		const zone = {
			universeId: createdId,
			enabled: true,
			indoors: false,
			defaultTileId,
			bounds: NEW_ZONE_BOUNDS
		};
		const lobbyZoneId = await createZone({ ...zone, name: 'Lobby' }, transaction);
		const startingZoneId = await createZone({ ...zone, name: 'Starting Zone' }, transaction);

		await setUniverseZones(createdId, lobbyZoneId, startingZoneId, transaction);
		await setUniverseRole(createdId, playerId, 'creator', transaction);

		return(createdId);
	});

	if (universeId === undefined)
	{
		response.status(409).json({ error: `You can create at most ${MAX_CREATED_UNIVERSES} universes` });
		return;
	}

	const payload: CreatedPayload = { id: universeId };

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
	const body = universeSettingsUpdate.safeParse(request.body);

	if (!body.success)
	{
		response.status(400).json({ error: describeInvalidPayload(body.error) });
		return;
	}

	const { universe } = universeContextOf(request);
	const problem = timeSettingsProblem({ ...universe, ...body.data });

	if (problem !== undefined)
	{
		response.status(400).json({ error: problem });
		return;
	}

	await updateUniverseSettings(universe.id, body.data);
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
		response.status(400).json({ error: describeInvalidPayload(query.error) });
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
		response.status(400).json({ error: describeInvalidPayload(body.error) });
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

		return(createCustomTile(universe.id, universe.ruleset, body.data, transaction));
	});

	if (tileId === undefined)
	{
		response.status(409).json({ error: `A universe can have at most ${MAX_CUSTOM_TILES} tiles of its own` });
		return;
	}

	const payload: CreatedPayload<number> = { id: tileId };

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
		response.status(400).json({ error: describeInvalidPayload(body.error) });
		return;
	}

	const { universe } = universeContextOf(request);
	const kind = (tileId.success ? await findTileKind(universe.id, universe.ruleset, tileId.data) : undefined);

	if (!tileId.success || (kind === undefined))
	{
		response.status(404).json({ error: 'No such tile' });
		return;
	}

	if (kind === 'default')
	{
		await saveEditedDefaultTile(universe.id, universe.ruleset, tileId.data, body.data);
	}
	else
	{
		await updateCustomTile(universe.id, tileId.data, body.data);
	}

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
		response.status(404).json({ error: 'No such tile' });
		return;
	}

	if (kind === 'default')
	{
		await restoreDefaultTile(universe.id, tileId.data);
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
		response.status(409).json({ error: 'A map uses this tile' });
		return;
	}

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
		response.status(status).json({ error: 'The request body could not be read' });
		return;
	}

	console.error(`Editor request ${request.method} ${request.originalUrl} failed:`, error);
	response.status(500).json({ error: 'Something went wrong' });
}
