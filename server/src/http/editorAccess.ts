/**
 * Who is using the world editor, and what they may do in the universe a request is about
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { defineMessages, EDITOR_VERSION_PARAM, UNIVERSE_VERSIONS, editorAccessOf, type EditableUniverseDetails, type EditorAccess, type EditorArea, type EditorRole, type MessageDescriptor } from '@multiverse-kiln/shared';

import type { Executor } from '../db/client.js';
import { isActiveServerAdmin } from '../db/serverAdminRepo.js';
import { hasTwoFactor } from '../db/twoFactorRepo.js';
import { findUniverseAccess } from '../db/universeEditorRepo.js';
import { findEditableUniverse } from '../db/universeRepo.js';
import { findEditorArea } from '../db/areaRepo.js';
import { draftVersion, isSameVersion, liveVersion, type UniverseVersion } from '../db/universeVersions.js';
import { resolveSession } from '../auth/sessions.js';
import { errorMessages, sendError } from './errors.js';
import { isOriginAllowed } from './origins.js';
import { rememberProfileLocale } from './requestLanguages.js';

/**
 * The universe a request is about, and the requesting player's role in the editor
 */
export interface UniverseContext
{
	playerId: string;

	/**
	 * The universe, with the settings of the version the request is about
	 */
	universe: EditableUniverseDetails;

	/**
	 * The version the request reads or changes: the one its EDITOR_VERSION_PARAM names
	 */
	version: UniverseVersion;

	/**
	 * Their role in the universe, or ADMIN_ROLE for a server admin without a stronger one
	 */
	role: EditorRole;

	/**
	 * The languages the player may translate into, as a translator
	 */
	languages: readonly string[];

	/**
	 * Whether the player is a server admin with 2FA on, who may save while the universe is disabled
	 */
	serverAdmin: boolean;

	/**
	 * Whether the player has 2FA on, without which a universe that requires it refuses every request but
	 * a save that only leaves it (refuseWithoutRequiredTwoFactor())
	 */
	twoFactor: boolean;
}

/**
 * The area a request is about, in its universe
 */
export interface AreaContext extends UniverseContext
{
	area: EditorArea;
}

/**
 * Why a universe that requires its editors to have 2FA on refuses an editor without it
 * (EDITOR_TWO_FACTOR_ERROR_ID), taking the universe's name as {universe}
 */
export const EDITOR_TWO_FACTOR_REFUSAL: MessageDescriptor = defineMessages({
	editorNeedsTwoFactor: {
		id: 'error.editorNeedsTwoFactor',
		defaultMessage: '{universe} requires its editors to have two-factor authentication on. Turn it on to open the universe in the editor.',
		description: 'Shown on the page the world editor shows in place of a universe whose creators require its editors to have two-factor authentication on, to an editor who doesn\'t; {universe} is the universe\'s name. Buttons to turn it on, leave the universe and go back to Home follow'
	}
}).editorNeedsTwoFactor;

/**
 * Methods that don't change anything
 */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const playerIds = new WeakMap<Request, string>();
const universeContexts = new WeakMap<Request, UniverseContext>();
const areaContexts = new WeakMap<Request, AreaContext>();

/**
 * Middleware that refuses writes from browsers on origins outside ALLOWED_ORIGINS
 *
 * The session cookie is SameSite=Strict, but other origins on the same site (another port or
 * subdomain) would still send it. Requests without an Origin header come from non-browser clients,
 * which can't borrow a browser's cookie, so they are let through
 *
 * @param allowedOrigins Normalized allowed origins
 * @return The middleware
 */
export function refuseWritesFromOtherOrigins(allowedOrigins: Set<string>): RequestHandler
{
	return((request, response, next) =>
	{
		const origin = (request.headers.origin ?? null);

		if (!READ_METHODS.has(request.method) && (origin !== null) && !isOriginAllowed(origin, allowedOrigins))
		{
			sendError(response, 403, {
				id: 'error.otherOrigin',
				defaultMessage: 'Changes aren\'t allowed from this website.',
				description: 'Why an editor change was refused: it came from a page on another website'
			});
			return;
		}

		next();
	});
}

/**
 * Middleware that answers 401 unless the request's browser is logged in, and remembers its player
 *
 * @param request The request
 * @param response The response
 * @param next Continues to the next handler
 */
export async function requireLogin(request: Request, response: Response, next: NextFunction): Promise<void>
{
	const player = await resolveSession(request.headers.cookie);

	if (!player)
	{
		sendError(response, 401, errorMessages.logInFirst);
		return;
	}

	playerIds.set(request, player.playerId);
	rememberProfileLocale(request, player.locale);
	next();
}

/**
 * What a player may do in a universe's editor: their role in it, or ADMIN_ROLE for a server admin with
 * 2FA on who has no stronger one (editorAccessOf())
 *
 * @param universeId The universe's ID
 * @param playerId The player's ID
 * @param executor The database when left out, or a transaction
 * @return Their access, undefined when they may not open the universe's editor, and whether they are a
 * server admin with 2FA on
 */
export async function findEditorAccess(universeId: string, playerId: string, executor?: Executor): Promise<{ access: EditorAccess | undefined; serverAdmin: boolean }>
{
	const access = await findUniverseAccess(universeId, playerId, executor);
	const serverAdmin = await isActiveServerAdmin(playerId, executor);

	return({
		access: editorAccessOf(access, serverAdmin),
		serverAdmin
	});
}

/**
 * Middleware for routes under /:universeId: loads the universe, in the version its EDITOR_VERSION_PARAM
 * names (the live version when it names none), and the player's role in the editor
 *
 * Answers 404 when the universe doesn't exist and when the player may not edit it, so the editor
 * doesn't reveal universes the player can't see, and when the draft is asked for and the universe has none
 *
 * @param request The request
 * @param response The response
 * @param next Continues to the next handler
 */
export async function loadUniverseContext(request: Request, response: Response, next: NextFunction): Promise<void>
{
	const universeId = z.uuid().safeParse(request.params.universeId);
	const versionName = z.enum(UNIVERSE_VERSIONS).default('live').safeParse(request.query[EDITOR_VERSION_PARAM]);
	const playerId = playerIdOf(request);

	if (universeId.success && versionName.success)
	{
		const version = ((versionName.data === 'draft') ? draftVersion(universeId.data) : liveVersion(universeId.data));
		const [universe, { access, serverAdmin }, twoFactor] = await Promise.all([
			findEditableUniverse(version),
			findEditorAccess(universeId.data, playerId),
			hasTwoFactor(playerId)
		]);

		if (universe && access)
		{
			universeContexts.set(request, {
				playerId,
				universe,
				version,
				role: access.role,
				languages: access.languages,
				serverAdmin,
				twoFactor
			});
			next();
			return;
		}

		// The universe without its draft, so its editors are told there is no draft rather than no universe
		if (access && version.draft && await findEditableUniverse(liveVersion(universeId.data)))
		{
			sendError(response, 404, errorMessages.noSuchDraft);
			return;
		}
	}

	sendError(response, 404, errorMessages.noSuchUniverse);
}

/**
 * Middleware for routes under /:universeId that answers 403 while the universe requires its editors to
 * have 2FA on and the player doesn't, naming the universe (EDITOR_TWO_FACTOR_ERROR_ID). Saving comes
 * before it, since such a player may still save leaving the universe (editorChanges.ts)
 *
 * @param request The request
 * @param response The response
 * @param next Continues to the next handler
 */
export function refuseWithoutRequiredTwoFactor(request: Request, response: Response, next: NextFunction): void
{
	const { universe, twoFactor } = universeContextOf(request);

	if (universe.requireTwoFactor && !twoFactor)
	{
		sendError(response, 403, EDITOR_TWO_FACTOR_REFUSAL, {
			universe: universe.name
		});
		return;
	}

	next();
}

/**
 * Middleware for routes under /:universeId/areas/:areaId: loads the area, which must belong to the universe
 *
 * @param request The request
 * @param response The response
 * @param next Continues to the next handler
 */
export async function loadAreaContext(request: Request, response: Response, next: NextFunction): Promise<void>
{
	const areaId = z.uuid().safeParse(request.params.areaId);
	const context = universeContextOf(request);

	if (areaId.success)
	{
		const found = await findEditorArea(areaId.data);

		if (found && isSameVersion(found.version, context.version))
		{
			areaContexts.set(request, { ...context, area: found.area });
			next();
			return;
		}
	}

	sendError(response, 404, errorMessages.noSuchArea);
}

/**
 * Middleware that answers 403 unless the player's role passes a check
 *
 * @param allowed The check, such as canEditWorld
 * @return The middleware
 */
export function requireRole(allowed: (role: EditorRole) => boolean): RequestHandler
{
	return((request, response, next) =>
	{
		if (!allowed(universeContextOf(request).role))
		{
			sendError(response, 403, errorMessages.roleNotAllowed);
			return;
		}

		next();
	});
}

/**
 * The player making a request that has passed requireLogin
 *
 * @param request The request
 * @return The player's ID
 */
export function playerIdOf(request: Request): string
{
	const playerId = playerIds.get(request);

	if (playerId === undefined)
	{
		throw new Error(`${request.method} ${request.path} reached a handler without requireLogin`);
	}

	return(playerId);
}

/**
 * The universe of a request that has passed loadUniverseContext
 *
 * @param request The request
 * @return The universe and the player's role in it
 */
export function universeContextOf(request: Request): UniverseContext
{
	const context = universeContexts.get(request);

	if (!context)
	{
		throw new Error(`${request.method} ${request.path} reached a handler without loadUniverseContext`);
	}

	return(context);
}

/**
 * The area of a request that has passed loadAreaContext
 *
 * @param request The request
 * @return The area, its universe and the player's role in it
 */
export function areaContextOf(request: Request): AreaContext
{
	const context = areaContexts.get(request);

	if (!context)
	{
		throw new Error(`${request.method} ${request.path} reached a handler without loadAreaContext`);
	}

	return(context);
}
