import type { Application } from 'express';
import { z } from 'zod';
import { canViewUniverse, MAX_UNIVERSE_NAME_LENGTH, MAX_UNIVERSES_PER_PAGE, UNIVERSES_PATH, type UniverseDetails, type UniverseListPayload } from '@multiverse-kiln/shared';

import { resolveSession } from '../auth/sessions.js';
import { findUniverseRole } from '../db/universeEditorRepo.js';
import { findUniverseDetails, listUniverses } from '../db/universeRepo.js';
import { errorMessages, sendError, sendInvalidRequest } from './errors.js';

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
 * @param cookieHeader The request's Cookie header
 * @return True when they may
 */
async function maySeeUniverse(universe: UniverseDetails, cookieHeader: string | undefined): Promise<boolean>
{
	if (canViewUniverse(universe.stage, undefined))
	{
		return(true);
	}

	const session = await resolveSession(cookieHeader);

	return((session !== undefined) && canViewUniverse(universe.stage, await findUniverseRole(universe.id, session.playerId)));
}

/**
 * Adds the routes for universe pages and the universes Home shows to everyone, which are those ready
 * for everyone (stage let_there_be_light) that a server admin hasn't disabled:
 *
 * - GET UNIVERSES_PATH lists them by name, a page at a time. Answers 400 for an offset or limit that
 *   isn't a whole number in range
 * - GET UNIVERSES_PATH/:key gives a universe in full, by its ID or its slug: one Home lists, one at the
 *   end of time, or one whose stage the player's role lets them play it in (maySeeUniverse). Answers
 *   404 for any other, and for a disabled universe
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

			if (!universe || !await maySeeUniverse(universe, request.headers.cookie))
			{
				sendError(response, 404, errorMessages.noSuchUniverse);
				return;
			}

			response.json(universe);
		}
		catch (error)
		{
			console.error('Could not load a universe:', error);
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
			const payload: UniverseListPayload = {
				universes: universes.slice(0, limit),
				hasMore: (universes.length > limit)
			};

			response.json(payload);
		}
		catch (error)
		{
			console.error('Could not list universes:', error);
			sendError(response, 500, errorMessages.somethingWentWrong);
		}
	});
}
