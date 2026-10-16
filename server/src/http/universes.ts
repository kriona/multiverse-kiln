import type { Application } from 'express';
import { z } from 'zod';
import { MAX_UNIVERSES_PER_PAGE, UNIVERSES_PATH, type UniverseListPayload } from '@multiverse-kiln/shared';

import { listUniverses } from '../db/universeRepo.js';

/**
 * Query parameters of GET UNIVERSES_PATH
 */
const listQuery = z.object({
	offset: z.coerce.number().int().min(0).default(0),
	limit: z.coerce.number().int().min(1).max(MAX_UNIVERSES_PER_PAGE).default(MAX_UNIVERSES_PER_PAGE)
});

/**
 * Adds GET UNIVERSES_PATH, which lists the universes Home shows: those ready for everyone (stage
 * let_there_be_light), by name, a page at a time
 *
 * Answers 400 for an offset or limit that isn't a whole number in range
 *
 * @param app Express app to add the route to
 */
export function addUniversesRoute(app: Application): void
{
	app.get(UNIVERSES_PATH, async (req, res) =>
	{
		const query = listQuery.safeParse(req.query);

		res.set('Cache-Control', 'no-store');

		if (!query.success)
		{
			res.status(400).json({ error: 'offset and limit must be whole numbers in range' });
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

			res.json(payload);
		}
		catch (error)
		{
			console.error('Could not list universes:', error);
			res.status(500).json({ error: 'Could not list universes' });
		}
	});
}
