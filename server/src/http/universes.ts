import type { Application } from 'express';
import { z } from 'zod';
import { MAX_UNIVERSES_PER_PAGE, UNIVERSES_PATH, type UniverseListPayload } from '@multiverse-kiln/shared';

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
 * Adds the routes for the universes Home shows, which are those ready for everyone (stage let_there_be_light):
 *
 * - GET UNIVERSES_PATH lists them by name, a page at a time. Answers 400 for an offset or limit that
 *   isn't a whole number in range
 * - GET UNIVERSES_PATH/:id gives one of them in full. Answers 404 for anything else, including a
 *   universe that exists but isn't listed
 *
 * @param app Express app to add the routes to
 */
export function addUniversesRoutes(app: Application): void
{
	app.get(`${UNIVERSES_PATH}/:id`, async (request, response) =>
	{
		const id = z.uuid().safeParse(request.params.id);

		response.set('Cache-Control', 'no-store');

		if (!id.success)
		{
			sendError(response, 404, errorMessages.noSuchUniverse);
			return;
		}

		try
		{
			const universe = await findUniverseDetails(id.data, 'let_there_be_light');

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
