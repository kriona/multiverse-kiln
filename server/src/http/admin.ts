/**
 * The admin pages' REST API (see shared/src/admin.ts and shared/src/siteSettings.ts): settings for the
 * whole site, the login sessions still going, and the player accounts. Only server admins with 2FA on
 * may use the routes under ADMIN_PATH; anyone may read the public settings
 */
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { ADMIN_PATH, ADMIN_PLAYERS_PATH, ADMIN_SESSIONS_PATH, isPrivacyContact, isSiteSocialUrl, MAX_ADMIN_ROWS_PER_PAGE, MAX_ADMIN_SEARCH_LENGTH, MAX_CHARACTER_DELETION_DAYS, MAX_UNIVERSES_PER_CREATOR, MIN_UNIVERSES_PER_CREATOR, PUBLIC_SITE_SETTINGS_PATH, SITE_SETTINGS_PATH, type AdminPlayerListPayload, type AdminPlayerListQuery, type AdminSessionListPayload, type AdminSessionListQuery, type PublicSiteSettings, type SiteSettings, type SiteSocialSite } from '@multiverse-kiln/shared';

import { resolveSession } from '../auth/sessions.js';
import { listPlayersForAdmin } from '../db/playerRepo.js';
import { isServerAdmin } from '../db/serverAdminRepo.js';
import { listActiveSessions } from '../db/sessionRepo.js';
import { findSiteSettings, saveSiteSettings } from '../db/siteSettingsRepo.js';
import { hasTwoFactor } from '../db/twoFactorRepo.js';
import { sessionExpiresAt } from '../logic/sessionLifetimes.js';
import { connectedSessions } from '../players/connectedSessions.js';
import { refuseWritesFromOtherOrigins } from './editorAccess.js';
import { errorMessages, sendError, sendInvalidRequest } from './errors.js';

/**
 * A link to the site's page on a social site, or null for none
 *
 * @param site The social site
 * @return The schema
 */
function socialUrl(site: SiteSocialSite): z.ZodType<string | null>
{
	return(z.string().refine((url) => isSiteSocialUrl(site, url)).nullable());
}

/**
 * Body of PUT SITE_SETTINGS_PATH
 */
const siteSettingsBody: z.ZodType<SiteSettings> = z.strictObject({
	universeCreationEnabled: z.boolean(),
	universesPerCreator: z.number().int().min(MIN_UNIVERSES_PER_CREATOR).max(MAX_UNIVERSES_PER_CREATOR),
	characterDeletionDays: z.number().int().min(0).max(MAX_CHARACTER_DELETION_DAYS),
	socials: z.strictObject({
		discord: socialUrl('discord'),
		facebook: socialUrl('facebook'),
		instagram: socialUrl('instagram'),
		tiktok: socialUrl('tiktok'),
		x: socialUrl('x'),
		youtube: socialUrl('youtube')
	}),
	privacyContact: z.string().refine(isPrivacyContact).nullable()
});

/**
 * A true or false query parameter
 */
const booleanText = z.enum(['true', 'false']).transform((value) => (value === 'true'));

/**
 * An admin list's search: left out when empty
 */
const searchText = z.string()
	.trim()
	.max(MAX_ADMIN_SEARCH_LENGTH)
	.transform((text) => ((text === '') ? undefined : text))
	.optional();

/**
 * An admin list's page
 */
const pageParameters = {
	offset: z.coerce.number().int().min(0).default(0),
	limit: z.coerce.number().int().min(1).max(MAX_ADMIN_ROWS_PER_PAGE).default(MAX_ADMIN_ROWS_PER_PAGE)
};

/**
 * Query parameters of GET ADMIN_SESSIONS_PATH
 */
const sessionListQuery = z.object({
	search: searchText,
	connected: booleanText.optional(),
	...pageParameters
}) satisfies z.ZodType<AdminSessionListQuery, unknown>;

/**
 * Query parameters of GET ADMIN_PLAYERS_PATH
 */
const playerListQuery = z.object({
	search: searchText,
	serverAdmin: booleanText.optional(),
	...pageParameters
}) satisfies z.ZodType<AdminPlayerListQuery, unknown>;

/**
 * The session of each request that has passed requireServerAdmin
 */
const adminSessionIds = new WeakMap<Request, string>();

/**
 * Adds the admin routes, and the public site settings route
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
	router.use(requireServerAdmin);
	router.use(express.json());

	// The admin landing page asks this to find whether the player may use the admin pages
	router.get('/', (_request, response) =>
	{
		response.sendStatus(204);
	});
	router.get(underAdminPath(SITE_SETTINGS_PATH), getSiteSettings);
	router.put(underAdminPath(SITE_SETTINGS_PATH), updateSiteSettings);
	router.get(underAdminPath(ADMIN_SESSIONS_PATH), listSessions);
	router.get(underAdminPath(ADMIN_PLAYERS_PATH), listPlayers);

	router.use(handleAdminError);

	app.get(PUBLIC_SITE_SETTINGS_PATH, getPublicSiteSettings);
	app.use(ADMIN_PATH, router);
}

/**
 * A route's path within the admin router
 *
 * @param path The route's full path, under ADMIN_PATH
 * @return The path after ADMIN_PATH
 */
function underAdminPath(path: string): string
{
	return(path.slice(ADMIN_PATH.length));
}

/**
 * Middleware that answers 401 unless the browser is logged in, and 403 unless its player is a server
 * admin with 2FA on
 *
 * @param request The request
 * @param response The response
 * @param next Continues to the next handler
 */
async function requireServerAdmin(request: Request, response: Response, next: NextFunction): Promise<void>
{
	const session = await resolveSession(request.headers.cookie);

	if (!session)
	{
		sendError(response, 401, errorMessages.logInFirst);
		return;
	}

	const [admin, twoFactor] = await Promise.all([
		isServerAdmin(session.playerId),
		hasTwoFactor(session.playerId)
	]);

	if (!admin)
	{
		sendError(response, 403, {
			id: 'error.notServerAdmin',
			defaultMessage: 'Only the site\'s admins can use this page.',
			description: 'Why an admin page, such as the site settings or the list of players, was refused: the player isn\'t one of the site\'s admins'
		});
		return;
	}

	if (!twoFactor)
	{
		sendError(response, 403, {
			id: 'error.adminNeedsTwoFactor',
			defaultMessage: 'Turn on two-factor authentication to use the admin pages.',
			description: 'Why an admin page was refused to one of the site\'s admins: admins must have two-factor authentication on. The page offers a link to turn it on'
		});
		return;
	}

	adminSessionIds.set(request, session.sessionId);
	next();
}

/**
 * GET PUBLIC_SITE_SETTINGS_PATH: the settings any page may read
 *
 * @param _request The request
 * @param response The response
 */
async function getPublicSiteSettings(_request: Request, response: Response): Promise<void>
{
	response.set('Cache-Control', 'no-store');

	try
	{
		const { characterDeletionDays, socials, privacyContact } = await findSiteSettings();
		const payload: PublicSiteSettings = {
			characterDeletionDays,
			socials,
			privacyContact
		};

		response.json(payload);
	}
	catch (error)
	{
		console.error('Could not load the public site settings:', error);
		sendError(response, 500, errorMessages.somethingWentWrong);
	}
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
 * GET ADMIN_SESSIONS_PATH: a page of the login sessions still going
 *
 * @param request The request
 * @param response The response
 */
async function listSessions(request: Request, response: Response): Promise<void>
{
	const query = sessionListQuery.safeParse(request.query);

	if (!query.success)
	{
		sendInvalidRequest(response, query.error);
		return;
	}

	const { search, connected, offset, limit } = query.data;
	const connectedIds = new Set(connectedSessions.ids());
	const currentSessionId = adminSessionIds.get(request);
	const page = await listActiveSessions({
		search,
		connected: ((connected === undefined) ? undefined : {
			ids: [...connectedIds],
			connected
		})
	}, {
		offset,
		limit
	}, new Date());
	const payload: AdminSessionListPayload = {
		sessions: page.sessions.map((session) => ({
			username: session.username,
			displayName: session.displayName,
			createdAt: session.createdAt.toISOString(),
			lastUsedAt: session.lastUsedAt.toISOString(),
			expiresAt: sessionExpiresAt(session).toISOString(),
			rememberMe: session.rememberMe,
			connected: connectedIds.has(session.id),
			current: (session.id === currentSessionId)
		})),
		total: page.total
	};

	response.json(payload);
}

/**
 * GET ADMIN_PLAYERS_PATH: a page of the player accounts
 *
 * @param request The request
 * @param response The response
 */
async function listPlayers(request: Request, response: Response): Promise<void>
{
	const query = playerListQuery.safeParse(request.query);

	if (!query.success)
	{
		sendInvalidRequest(response, query.error);
		return;
	}

	const { search, serverAdmin, offset, limit } = query.data;
	const page = await listPlayersForAdmin({
		search,
		serverAdmin
	}, {
		offset,
		limit
	});
	const payload: AdminPlayerListPayload = {
		players: page.players.map((player) => ({
			username: player.username,
			displayName: player.displayName,
			email: player.email,
			createdAt: player.createdAt.toISOString(),
			lastLoginAt: (player.lastLoginAt?.toISOString() ?? null),
			password: player.hasPassword,
			providers: player.providers,
			twoFactor: player.twoFactor,
			serverAdmin: player.serverAdmin
		})),
		total: page.total
	};

	response.json(payload);
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

	console.error('Admin request %s %s failed:', request.method, request.originalUrl, error);
	sendError(response, 500, errorMessages.somethingWentWrong);
}
