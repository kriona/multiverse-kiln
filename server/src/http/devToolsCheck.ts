/**
 * GET DEV_TOOLS_PATH: answers 204 so the client's dev-only pages, such as the avatar positioning tool,
 * can tell the server's dev tools are on. Only added while they are (isDevToolsEnabled()), which is never
 * in production, so otherwise it answers 404 like any unknown path
 */
import type { Application } from 'express';
import { DEV_TOOLS_PATH } from '@multiverse-kiln/shared';

/**
 * Adds GET DEV_TOOLS_PATH
 *
 * @param app Express app to add the route to
 */
export function addDevToolsCheckRoute(app: Application): void
{
	app.get(DEV_TOOLS_PATH, (_request, response) =>
	{
		response.set('Cache-Control', 'no-store');
		response.sendStatus(204);
	});
}
