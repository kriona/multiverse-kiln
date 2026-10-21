import type { Application } from 'express';
import { z } from 'zod';
import { MAX_UNIVERSE_NAME_LENGTH, MAX_UNIVERSES_PER_PAGE, UNIVERSES_PATH, type UniverseListPayload } from '@multiverse-kiln/shared';

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
 * Adds the routes for the universes Home shows, which are those ready for everyone (stage let_there_be_light):
 *
 * - GET UNIVERSES_PATH lists them by name, a page at a time. Answers 400 for an offset or limit that
 *   isn't a whole number in range
 * - GET UNIVERSES_PATH/:key gives one of them in full, by its ID or its slug. Answers 404 for anything
 *   else, including a universe that exists but isn't listed
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
			const universe = await findUniverseDetails(key.data, 'let_there_be_light');

			if (!universe)
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
