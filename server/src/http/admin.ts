/**
 * The admin page's REST API: settings for the whole site (see shared/src/siteSettings.ts)
 *
 * Anyone can use these routes until there are server admin accounts
 */
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { MAX_CHARACTER_DELETION_DAYS, MAX_UNIVERSES_PER_CREATOR, MIN_UNIVERSES_PER_CREATOR, SITE_SETTINGS_PATH, type SiteSettings } from '@multiverse-kiln/shared';

import { findSiteSettings, saveSiteSettings } from '../db/siteSettingsRepo.js';
import { refuseWritesFromOtherOrigins } from './editorAccess.js';
import { errorMessages, sendError, sendInvalidRequest } from './errors.js';

/**
 * Body of PUT SITE_SETTINGS_PATH
 */
const siteSettingsBody: z.ZodType<SiteSettings> = z.strictObject({
	universeCreationEnabled: z.boolean(),
	universesPerCreator: z.number().int().min(MIN_UNIVERSES_PER_CREATOR).max(MAX_UNIVERSES_PER_CREATOR),
	characterDeletionDays: z.number().int().min(0).max(MAX_CHARACTER_DELETION_DAYS)
});

/**
 * Adds the admin page's routes
 *
 * @param app Express app to add the routes to
 * @param allowedOrigins Normalized origins allowed to make changes from a browser
 */
export function addAdminRoutes(app: Application, allowedOrigins: Set<string>): void
{
	const router = express.Router();

	router.use((_request, response, next) =>
	{
		response.set('Cache-Control', 'no-store');
		next();
	});
	router.use(refuseWritesFromOtherOrigins(allowedOrigins));
	router.use(express.json());

	router.get('/', getSiteSettings);
	router.put('/', updateSiteSettings);

	router.use(handleAdminError);

	app.use(SITE_SETTINGS_PATH, router);
}

/**
 * GET SITE_SETTINGS_PATH: the site's settings
 *
 * @param _request The request
 * @param response The response
 */
async function getSiteSettings(_request: Request, response: Response): Promise<void>
{
	const payload: SiteSettings = await findSiteSettings();

	response.json(payload);
}

/**
 * PUT SITE_SETTINGS_PATH: replaces the site's settings
 *
 * @param request The request
 * @param response The response
 */
async function updateSiteSettings(request: Request, response: Response): Promise<void>
{
	const body = siteSettingsBody.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	await saveSiteSettings(body.data);
	response.sendStatus(204);
}

/**
 * Answers errors from the admin routes: 4xx errors from parsing the body as they are, anything else as 500
 *
 * @param error What went wrong
 * @param request The request
 * @param response The response
 * @param next The next error handler, for when the response has already started
 */
function handleAdminError(error: unknown, request: Request, response: Response, next: NextFunction): void
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

	console.error(`Admin request ${request.method} ${request.originalUrl} failed:`, error);
	sendError(response, 500, errorMessages.somethingWentWrong);
}
