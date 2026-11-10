import type { Application, Request } from 'express';
import { z } from 'zod';
import { canViewUniverse, editorAccessOf, MAX_UNIVERSE_NAME_LENGTH, MAX_UNIVERSES_PER_PAGE, UNIVERSES_PATH, type UniverseDetails, type UniverseListPayload, type UniversePagePayload, type UniverseTextPayload } from '@multiverse-kiln/shared';

import { resolveSession } from '../auth/sessions.js';
import { listAreas } from '../db/areaRepo.js';
import { isActiveServerAdmin } from '../db/serverAdminRepo.js';
import { loadEditorTiles } from '../db/tileRepo.js';
import { findUniverseAccess, findUniverseRole } from '../db/universeEditorRepo.js';
import { findUniverseDetails, listUniverses } from '../db/universeRepo.js';
import { liveVersion } from '../db/universeVersions.js';
import { errorMessages, sendError, sendInvalidRequest } from './errors.js';
import { rememberProfileLocale, requestLanguages } from './requestLanguages.js';
import { universeTextCache } from './universeTextCache.js';
import { UniverseTextTranslator } from './universeTextTranslator.js';

/**
 * Query parameters of GET UNIVERSES_PATH
 */
const listQuery = z.object({
	offset: z.coerce.number().int().min(0).default(0),
	limit: z.coerce.number().int().min(1).max(MAX_UNIVERSES_PER_PAGE).default(MAX_UNIVERSES_PER_PAGE)
});

/**
 * A universe's ID or slug in a path. A slug is the name with fewer characters, but lowercasing can
 * lengthen a few letters, so the limit leaves room
 */
const universeKey = z.string().min(1).max(MAX_UNIVERSE_NAME_LENGTH * 2);

/**
 * Whether the browser asking may see a universe's page: anyone may see one ready for everyone or at the
 * end of time, and a logged-in player one whose stage their role lets them play it in
 *
 * @param universe The universe
 * @param request The request, which remembers its player's profile language for requestLanguages()
 * @return True when they may
 */
async function maySeeUniverse(universe: UniverseDetails, request: Request): Promise<boolean>
{
	if (canViewUniverse(universe.stage, undefined))
	{
		return(true);
	}

	const session = await resolveSession(request.headers.cookie);

	rememberProfileLocale(request, (session?.locale ?? null));

	return((session !== undefined) && canViewUniverse(universe.stage, await findUniverseRole(universe.id, session.playerId)));
}

/**
 * What the browser asking may do with a universe's page: see it, as maySeeUniverse() says, and work on
 * it in the editor, as its creators, builders and translators and server admins with 2FA on may. Beta
 * testers only play it, so they aren't shown the editor
 *
 * @param universe The universe
 * @param request The request, which remembers its player's profile language for requestLanguages()
 * @return Whether they may see it, and whether they may edit it
 */
async function findPageAccess(universe: UniverseDetails, request: Request): Promise<{ visible: boolean; editable: boolean }>
{
	const session = await resolveSession(request.headers.cookie);

	rememberProfileLocale(request, (session?.locale ?? null));

	if (session === undefined)
	{
		return({
			visible: canViewUniverse(universe.stage, undefined),
			editable: false
		});
	}

	const access = await findUniverseAccess(universe.id, session.playerId);
	const visible = canViewUniverse(universe.stage, access?.role);
	const editor = (visible ? editorAccessOf(access, await isActiveServerAdmin(session.playerId)) : undefined);

	return({
		visible,
		editable: ((editor !== undefined) && (editor.role !== 'beta_tester'))
	});
}

/**
 * The names a universe's rooms leave to the client to look up by ID, in the languages a request asks for
 *
 * @param universe The universe
 * @param requested The languages asked for, most wanted first (requestLanguages())
 * @return The text
 */
async function loadUniverseText(universe: UniverseDetails, requested: readonly string[]): Promise<UniverseTextPayload>
{
	const [areas, tiles, translator] = await Promise.all([
		listAreas(liveVersion(universe.id)),
		loadEditorTiles(liveVersion(universe.id), universe.ruleset),
		UniverseTextTranslator.load(universe, requested, ['area', 'tile'])
	]);

	return({
		areas: Object.fromEntries(areas
			.filter((area) => area.enabled)
			.map((area) => [area.id, translator.text('area', area.id, 'name', area.name)])),
		tiles: Object.fromEntries(tiles.flatMap((tile) => ((tile.name === null) ? [] : [[String(tile.id), translator.text('tile', tile.id, 'name', tile.name)]])))
	});
}

/**
 * Adds the routes for universe pages and the universes Home shows to everyone, which are those ready
 * for everyone (stage let_there_be_light) that a server admin hasn't disabled. Their universe text is
 * in the languages the request asks for (requestLanguages()):
 *
 * - GET UNIVERSES_PATH lists them by name, a page at a time. Answers 400 for an offset or limit that
 *   isn't a whole number in range
 * - GET UNIVERSES_PATH/:key gives a universe in full, by its ID or its slug: one Home lists, one at the
 *   end of time, or one whose stage the player's role lets them play it in (maySeeUniverse), with
 *   whether the player may edit it (findPageAccess). Answers 404 for any other, and for a disabled universe
 * - GET UNIVERSES_PATH/:key/text gives the names its rooms leave to the client (UniverseTextPayload),
 *   for the same universes, with an ETag that changes with the text, answering 304 while it is the same.
 *   The text is kept for each universe and language (universeTextCache) until it changes
 *
 * @param app Express app to add the routes to
 */
export function addUniversesRoutes(app: Application): void
{
	app.get(`${UNIVERSES_PATH}/:key`, async (request, response) =>
	{
		const key = universeKey.safeParse(request.params.key);

		response.set('Cache-Control', 'no-store');

		if (!key.success)
		{
			sendError(response, 404, errorMessages.noSuchUniverse);
			return;
		}

		try
		{
			const universe = await findUniverseDetails(key.data);
			const access = (universe ? await findPageAccess(universe, request) : undefined);

			if (!universe || !access?.visible)
			{
				sendError(response, 404, errorMessages.noSuchUniverse);
				return;
			}

			const translator = await UniverseTextTranslator.load(universe, await requestLanguages(request), ['universe']);
			const payload: UniversePagePayload = {
				...universe,
				name: translator.text('universe', universe.id, 'name', universe.name),
				shortDescription: translator.text('universe', universe.id, 'shortDescription', universe.shortDescription),
				longDescription: translator.text('universe', universe.id, 'longDescription', universe.longDescription),
				editable: access.editable
			};

			response.set('Vary', 'Accept-Language, Cookie');
			response.json(payload);
		}
		catch (error)
		{
			console.error('Could not load a universe:', error);
			sendError(response, 500, errorMessages.somethingWentWrong);
		}
	});

	app.get(`${UNIVERSES_PATH}/:key/text`, async (request, response) =>
	{
		const key = universeKey.safeParse(request.params.key);

		// Kept, but checked with the server each time, which answers 304 while the text is the same
		response.set('Cache-Control', 'private, no-cache');
		response.set('Vary', 'Accept-Language, Cookie');

		if (!key.success)
		{
			sendError(response, 404, errorMessages.noSuchUniverse);
			return;
		}

		try
		{
			const universe = await findUniverseDetails(key.data);

			if (!universe || !await maySeeUniverse(universe, request))
			{
				sendError(response, 404, errorMessages.noSuchUniverse);
				return;
			}

			const requested = await requestLanguages(request);
			const { body, etag } = await universeTextCache.get(universe, requested, () => loadUniverseText(universe, requested));

			response.set('ETag', etag);

			if (request.fresh)
			{
				response.status(304).end();
				return;
			}

			response.type('json').send(body);
		}
		catch (error)
		{
			console.error('Could not load a universe\'s text:', error);
			sendError(response, 500, errorMessages.somethingWentWrong);
		}
	});

	app.get(UNIVERSES_PATH, async (request, response) =>
	{
		const query = listQuery.safeParse(request.query);

		response.set('Cache-Control', 'no-store');

		if (!query.success)
		{
			sendInvalidRequest(response, query.error);
			return;
		}

		const { offset, limit } = query.data;

		try
		{
			// One more than asked for shows whether there is another page
			const universes = await listUniverses('let_there_be_light', offset, limit + 1);
			const page = universes.slice(0, limit);
			const translators = await UniverseTextTranslator.loadAll(page, await requestLanguages(request), ['universe']);
			const payload: UniverseListPayload = {
				universes: page.map((universe) =>
				{
					const translator = translators.get(universe.id);

					return({
						...universe,
						name: (translator?.text('universe', universe.id, 'name', universe.name) ?? universe.name),
						shortDescription: (translator?.text('universe', universe.id, 'shortDescription', universe.shortDescription) ?? universe.shortDescription)
					});
				}),
				hasMore: (universes.length > limit)
			};

			response.set('Vary', 'Accept-Language, Cookie');
			response.json(payload);
		}
		catch (error)
		{
			console.error('Could not list universes:', error);
			sendError(response, 500, errorMessages.somethingWentWrong);
		}
	});
}
