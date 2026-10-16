import type { Application } from 'express';

/**
 * Path of the health-check route
 */
export const HEALTH_PATH = '/health';

/**
 * Adds GET /health, which answers 200 while the process is serving requests
 *
 * The response is never cached, so a monitor always sees the live state
 *
 * @param app Express app to add the route to
 */
export function addHealthRoute(app: Application): void
{
	app.get(HEALTH_PATH, (_request, response) =>
	{
		response.set('Cache-Control', 'no-store');
		response.json({ status: 'ok' });
	});
}
