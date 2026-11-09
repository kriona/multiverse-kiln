/**
 * The admin pages' REST API (see shared/src/admin.ts and shared/src/siteSettings.ts): settings for the
 * whole site, the login sessions still going, the player accounts, the server admins and the
 * universes. Only server admins with 2FA on may use the routes under ADMIN_PATH; anyone may read the
 * public settings. Adding and removing admins, and disabling, enabling and deleting universes, are
 * recorded as admin events in the same transaction
 *
 * Changes are made as the admin role (adminClient.ts), the only one that can write server admins, site
 * settings and admin events
 */
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { ADMIN_ADMINS_PATH, ADMIN_ADMINS_SEARCH_PATH, ADMIN_PATH, ADMIN_PLAYERS_PATH, ADMIN_SESSIONS_PATH, ADMIN_UNIVERSES_PATH, DISALLOWED_TEXT_CHARACTERS, isPrivacyContact, isSiteSocialUrl, MAX_ADMIN_ROWS_PER_PAGE, MAX_ADMIN_SEARCH_LENGTH, MAX_AREAS_PER_UNIVERSE, MAX_CHARACTER_DELETION_DAYS, MAX_DISABLED_REASON_LENGTH, MAX_PLAYER_SEARCH_RESULTS, MAX_UNIVERSES_PER_CREATOR, MAX_USERNAME_LENGTH, MIN_AREAS_PER_UNIVERSE, MIN_UNIVERSES_PER_CREATOR, parsePlayerSearch, PUBLIC_SITE_SETTINGS_PATH, SITE_SETTINGS_PATH, type AdminPlayerListPayload, type AdminPlayerListQuery, type AdminSessionListPayload, type AdminSessionListQuery, type AdminUniverseListPayload, type AdminUniverseListQuery, type PlayerSearchPayload, type PublicSiteSettings, type ServerAdminListPayload, type ServerAdminRequest, type SiteSettings, type SiteSocialSite, type UniverseDisableRequest, UNIVERSE_DELETION_PATH } from '@multiverse-kiln/shared';

import { resolveSession } from '../auth/sessions.js';
import { adminDb, inAdminTransaction } from '../db/adminClient.js';
import { recordAdminEvent } from '../db/adminEventRepo.js';
import { findPlayerByUsername, listPlayersForAdmin } from '../db/playerRepo.js';
import { addServerAdmin, isServerAdmin, listServerAdmins, removeServerAdmin, searchPlayersToMakeAdmin } from '../db/serverAdminRepo.js';
import { deletePlayerSessions, findPlayersWithSessions, listActiveSessions } from '../db/sessionRepo.js';
import { findSiteSettings, saveSiteSettings } from '../db/siteSettingsRepo.js';
import { hasTwoFactor } from '../db/twoFactorRepo.js';
import { listUniversesForAdmin, lockUniverse, setUniverseDisabled } from '../db/universeRepo.js';
import { sessionExpiresAt } from '../logic/sessionLifetimes.js';
import { connectedSessions } from '../players/connectedSessions.js';
import { serverAdminChanges } from '../players/serverAdminChanges.js';
import { areaChanges } from '../world/areaChanges.js';
import { editorUpdates } from '../world/editorUpdates.js';
import { refuseWritesFromOtherOrigins } from './editorAccess.js';
import { playerSearchQuery } from './editorPayloads.js';
import { errorMessages, sendError, sendInvalidRequest, type Refusal } from './errors.js';
import { deleteUniverseRoute } from './universeDeletion.js';

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
	areasPerUniverse: z.number().int().min(MIN_AREAS_PER_UNIVERSE).max(MAX_AREAS_PER_UNIVERSE),
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
 * Query parameters of GET ADMIN_UNIVERSES_PATH
 */
const universeListQuery = z.object({
	search: searchText,
	disabled: booleanText.optional(),
	...pageParameters
}) satisfies z.ZodType<AdminUniverseListQuery, unknown>;

/**
 * Body of POST ADMIN_ADMINS_PATH
 */
const serverAdminBody = z.strictObject({
	username: z.string().trim().min(1).max(MAX_USERNAME_LENGTH)
}) satisfies z.ZodType<ServerAdminRequest, unknown>;

/**
 * Body of PUT ADMIN_UNIVERSES_PATH/:universeId/disabled: a reason that may run over several lines, each
 * ending in \n
 */
const universeDisableBody = z.strictObject({
	reason: z.string()
		.transform((text) => text.replace(/\r\n?/g, '\n').trim())
		.pipe(z.string()
			.min(1)
			.max(MAX_DISABLED_REASON_LENGTH)
			.refine((text) => !DISALLOWED_TEXT_CHARACTERS.test(text.replaceAll('\n', '')), 'Contains disallowed characters')),
	preventDeletion: z.boolean()
}) satisfies z.ZodType<UniverseDisableRequest, unknown>;

/**
 * Who each request that has passed requireServerAdmin comes from: the admin and their login session
 */
const adminSessions = new WeakMap<Request, { playerId: string; sessionId: string }>();

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
	router.get(underAdminPath(ADMIN_ADMINS_PATH), listAdmins);
	router.get(underAdminPath(ADMIN_ADMINS_SEARCH_PATH), searchAdminCandidates);
	router.post(underAdminPath(ADMIN_ADMINS_PATH), addAdmin);
	router.delete(`${underAdminPath(ADMIN_ADMINS_PATH)}/:username`, removeAdmin);
	router.get(underAdminPath(ADMIN_UNIVERSES_PATH), listUniverses);
	router.put(`${underAdminPath(ADMIN_UNIVERSES_PATH)}/:universeId/disabled`, disableUniverse);
	router.delete(`${underAdminPath(ADMIN_UNIVERSES_PATH)}/:universeId/disabled`, enableUniverse);
	router.post(`${underAdminPath(ADMIN_UNIVERSES_PATH)}/:universeId${UNIVERSE_DELETION_PATH}`, deleteUniverseAsAdminRoute);

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
 * admin. A server admin's session only counts with 2FA on (resolveSession()), so every admin here has it
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

	if (!await isServerAdmin(session.playerId))
	{
		sendError(response, 403, {
			id: 'error.notServerAdmin',
			defaultMessage: 'Only the site\'s admins can use this page.',
			description: 'Why an admin page, such as the site settings or the list of players, was refused: the player isn\'t one of the site\'s admins'
		});
		return;
	}

	adminSessions.set(request, {
		playerId: session.playerId,
		sessionId: session.sessionId
	});
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

	await saveSiteSettings(body.data, adminDb);
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
	const currentSessionId = adminOf(request).sessionId;
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
	const active = await findPlayersWithSessions(page.players.map((player) => player.id), connectedSessions.ids());
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
			serverAdmin: player.serverAdmin,
			active: active.has(player.id)
		})),
		total: page.total
	};

	response.json(payload);
}

/**
 * The admin making a request that has passed requireServerAdmin
 *
 * @param request The request
 * @return The admin's player ID and login session
 */
function adminOf(request: Request): { playerId: string; sessionId: string }
{
	const admin = adminSessions.get(request);

	if (!admin)
	{
		throw new Error(`${request.method} ${request.path} reached a handler without requireServerAdmin`);
	}

	return(admin);
}

/**
 * GET ADMIN_ADMINS_PATH: every server admin
 *
 * @param request The request
 * @param response The response
 */
async function listAdmins(request: Request, response: Response): Promise<void>
{
	const { playerId } = adminOf(request);
	const payload: ServerAdminListPayload = {
		admins: (await listServerAdmins()).map((admin) => ({
			username: admin.username,
			displayName: admin.displayName,
			addedAt: admin.addedAt.toISOString(),
			twoFactor: admin.twoFactor,
			current: (admin.playerId === playerId)
		}))
	};

	response.json(payload);
}

/**
 * GET ADMIN_ADMINS_SEARCH_PATH: players who could be made server admins, by username or name, for the
 * Admins page to offer as they are typed
 *
 * @param request The request, with a PlayerSearchQuery
 * @param response The response
 */
async function searchAdminCandidates(request: Request, response: Response): Promise<void>
{
	const query = playerSearchQuery.safeParse(request.query);

	if (!query.success)
	{
		sendInvalidRequest(response, query.error);
		return;
	}

	const payload: PlayerSearchPayload = {
		players: await searchPlayersToMakeAdmin(parsePlayerSearch(query.data.query), MAX_PLAYER_SEARCH_RESULTS)
	};

	response.json(payload);
}

/**
 * POST ADMIN_ADMINS_PATH: makes a player a server admin, by username. One without 2FA on is logged out
 * everywhere, since their sessions don't count until they turn it on, which their next login asks them to
 *
 * @param request The request
 * @param response The response
 */
async function addAdmin(request: Request, response: Response): Promise<void>
{
	const body = serverAdminBody.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const adminId = adminOf(request).playerId;
	let ended: string[] = [];
	const refusal = await inAdminTransaction(async (transaction): Promise<Refusal | undefined> =>
	{
		const player = await findPlayerByUsername(body.data.username, transaction);

		if (!player)
		{
			return({
				status: 404,
				message: {
					id: 'error.noSuchPlayerToMakeAdmin',
					defaultMessage: 'No player has that username.',
					description: 'Why a player couldn\'t be made one of the site\'s admins on the Admins admin page: no account has the username chosen, perhaps because the player changed it or deleted their account'
				}
			});
		}

		if (!await addServerAdmin(player.id, transaction))
		{
			return({
				status: 409,
				message: {
					id: 'error.alreadyServerAdmin',
					defaultMessage: 'They are already one of the site\'s admins.',
					description: 'Why a player couldn\'t be made one of the site\'s admins on the Admins admin page: they are one, perhaps because another admin added them a moment ago'
				}
			});
		}

		await recordAdminEvent({
			kind: 'adminAdded',
			adminId,
			playerId: player.id,
			occurredAt: new Date()
		}, transaction);

		if (!await hasTwoFactor(player.id, transaction))
		{
			ended = await deletePlayerSessions(player.id, transaction);
		}

		return(undefined);
	});

	if (refusal)
	{
		sendError(response, refusal.status, refusal.message, refusal.values);
		return;
	}

	connectedSessions.end(ended);
	response.sendStatus(204);
}

/**
 * DELETE ADMIN_ADMINS_PATH/:username: takes away a player's server admin role, unless they are the last,
 * and tells the editor rooms they no longer edit with the site admin role. An admin may remove themself
 *
 * @param request The request
 * @param response The response
 */
async function removeAdmin(request: Request, response: Response): Promise<void>
{
	const username = z.string().min(1).max(MAX_USERNAME_LENGTH).safeParse(request.params.username);
	const notAdmin: Refusal = {
		status: 404,
		message: {
			id: 'error.notAnAdminToRemove',
			defaultMessage: 'They aren\'t one of the site\'s admins.',
			description: 'Why a player couldn\'t be removed from the site\'s admins on the Admins admin page: they aren\'t one, perhaps because another admin removed them a moment ago'
		}
	};

	if (!username.success)
	{
		sendError(response, notAdmin.status, notAdmin.message);
		return;
	}

	const adminId = adminOf(request).playerId;
	let removedId: string | undefined;
	const refusal = await inAdminTransaction(async (transaction): Promise<Refusal | undefined> =>
	{
		const player = await findPlayerByUsername(username.data, transaction);
		const removal = (player ? await removeServerAdmin(player.id, transaction) : 'notAdmin');

		if (!player || (removal === 'notAdmin'))
		{
			return(notAdmin);
		}

		if (removal === 'lastAdmin')
		{
			return({
				status: 409,
				message: {
					id: 'error.lastServerAdmin',
					defaultMessage: 'The site needs at least one admin, so the last can\'t be removed.',
					description: 'Why a player couldn\'t be removed from the site\'s admins on the Admins admin page: they are the only one left'
				}
			});
		}

		await recordAdminEvent({
			kind: 'adminRemoved',
			adminId,
			playerId: player.id,
			occurredAt: new Date()
		}, transaction);
		removedId = player.id;

		return(undefined);
	});

	if (refusal)
	{
		sendError(response, refusal.status, refusal.message, refusal.values);
		return;
	}

	if (removedId !== undefined)
	{
		serverAdminChanges.publishLost(removedId);
	}

	response.sendStatus(204);
}

/**
 * GET ADMIN_UNIVERSES_PATH: a page of every universe
 *
 * @param request The request
 * @param response The response
 */
async function listUniverses(request: Request, response: Response): Promise<void>
{
	const query = universeListQuery.safeParse(request.query);

	if (!query.success)
	{
		sendInvalidRequest(response, query.error);
		return;
	}

	const { search, disabled, offset, limit } = query.data;
	const page = await listUniversesForAdmin({
		search,
		disabled
	}, {
		offset,
		limit
	});
	const payload: AdminUniverseListPayload = {
		universes: page.universes.map((universe) => ({
			id: universe.id,
			name: universe.name,
			slug: universe.slug,
			stage: universe.stage,
			ruleset: universe.ruleset,
			createdAt: universe.createdAt.toISOString(),
			creators: universe.creators,
			disabledAt: (universe.disabledAt?.toISOString() ?? null),
			disabledReason: universe.disabledReason,
			deletionPrevented: universe.deletionPrevented
		})),
		total: page.total
	};

	response.json(payload);
}

/**
 * PUT ADMIN_UNIVERSES_PATH/:universeId/disabled: disables a universe, and turns everyone playing it out
 * of its rooms
 *
 * @param request The request
 * @param response The response
 */
async function disableUniverse(request: Request, response: Response): Promise<void>
{
	const universeId = z.uuid().safeParse(request.params.universeId);
	const body = universeDisableBody.safeParse(request.body);

	if (!universeId.success)
	{
		sendError(response, 404, errorMessages.noSuchUniverse);
		return;
	}

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { reason, preventDeletion } = body.data;
	const adminId = adminOf(request).playerId;
	const refusal = await inAdminTransaction(async (transaction): Promise<Refusal | undefined> =>
	{
		// The universe's lock makes an editor save in progress commit first, and later ones see it disabled
		if (!await lockUniverse(universeId.data, transaction))
		{
			return({
				status: 404,
				message: errorMessages.noSuchUniverse
			});
		}

		if (!await setUniverseDisabled(universeId.data, { reason, preventDeletion }, transaction))
		{
			return({
				status: 409,
				message: {
					id: 'error.universeAlreadyDisabled',
					defaultMessage: 'The universe is already disabled.',
					description: 'Why a universe couldn\'t be disabled on the Universes admin page: it is disabled, perhaps because another admin disabled it a moment ago'
				}
			});
		}

		await recordAdminEvent({
			kind: 'universeDisabled',
			adminId,
			universeId: universeId.data,
			reason,
			preventsDeletion: preventDeletion,
			occurredAt: new Date()
		}, transaction);

		return(undefined);
	});

	if (refusal)
	{
		sendError(response, refusal.status, refusal.message, refusal.values);
		return;
	}

	areaChanges.publish({
		kind: 'universeDisabled',
		universeId: universeId.data
	});
	editorUpdates.publish({
		kind: 'access',
		universeId: universeId.data
	});
	response.sendStatus(204);
}

/**
 * DELETE ADMIN_UNIVERSES_PATH/:universeId/disabled: enables a universe again
 *
 * @param request The request
 * @param response The response
 */
async function enableUniverse(request: Request, response: Response): Promise<void>
{
	const universeId = z.uuid().safeParse(request.params.universeId);

	if (!universeId.success)
	{
		sendError(response, 404, errorMessages.noSuchUniverse);
		return;
	}

	const adminId = adminOf(request).playerId;
	const refusal = await inAdminTransaction(async (transaction): Promise<Refusal | undefined> =>
	{
		if (!await lockUniverse(universeId.data, transaction))
		{
			return({
				status: 404,
				message: errorMessages.noSuchUniverse
			});
		}

		if (!await setUniverseDisabled(universeId.data, null, transaction))
		{
			return({
				status: 409,
				message: {
					id: 'error.universeNotDisabled',
					defaultMessage: 'The universe isn\'t disabled.',
					description: 'Why a universe couldn\'t be enabled on the Universes admin page: it isn\'t disabled, perhaps because another admin enabled it a moment ago'
				}
			});
		}

		await recordAdminEvent({
			kind: 'universeEnabled',
			adminId,
			universeId: universeId.data,
			occurredAt: new Date()
		}, transaction);

		return(undefined);
	});

	if (refusal)
	{
		sendError(response, refusal.status, refusal.message, refusal.values);
		return;
	}

	editorUpdates.publish({
		kind: 'access',
		universeId: universeId.data
	});
	response.sendStatus(204);
}

/**
 * POST ADMIN_UNIVERSES_PATH/:universeId/deletion: deletes a universe as a server admin, once the admin
 * confirms it as its creators do (universeDeletion.ts), recording it as an admin event. The editor's
 * Universe tab sends it when the admin deletes it as an admin (deletesUniverseAsAdmin())
 *
 * @param request The request, with a UniverseDeleteRequest
 * @param response The response: 204, or the refusal
 */
async function deleteUniverseAsAdminRoute(request: Request, response: Response): Promise<void>
{
	const universeId = z.uuid().safeParse(request.params.universeId);

	if (!universeId.success)
	{
		sendError(response, 404, errorMessages.noSuchUniverse);
		return;
	}

	const adminId = adminOf(request).playerId;

	await deleteUniverseRoute(request, response, universeId.data, {
		inTransaction: inAdminTransaction,
		check: () => Promise.resolve(undefined),
		asAdmin: true,
		record: async (universeName, transaction) =>
		{
			await recordAdminEvent({
				kind: 'universeDeleted',
				adminId,
				universeId: universeId.data,
				universeName,
				occurredAt: new Date()
			}, transaction);
		}
	});
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
