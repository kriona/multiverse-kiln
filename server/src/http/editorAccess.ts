/**
 * Who is using the world editor, and what they may do in the universe a request is about
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import type { EditableUniverseDetails, EditorArea, UniverseRole } from '@multiverse-kiln/shared';

import { findUniverseAccess } from '../db/universeEditorRepo.js';
import { findEditableUniverse } from '../db/universeRepo.js';
import { findEditorArea } from '../db/areaRepo.js';
import { resolveSession } from '../auth/sessions.js';
import { errorMessages, sendError } from './errors.js';
import { isOriginAllowed } from './origins.js';

/**
 * The universe a request is about, and the requesting player's role in it
 */
export interface UniverseContext
{
	playerId: string;
	universe: EditableUniverseDetails;
	role: UniverseRole;

	/**
	 * The languages the player may translate into, as a translator
	 */
	languages: readonly string[];
}

/**
 * The area a request is about, in its universe
 */
export interface AreaContext extends UniverseContext
{
	area: EditorArea;
}

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
	next();
}

/**
 * Middleware for routes under /:universeId: loads the universe and the player's role in it
 *
 * Answers 404 when the universe doesn't exist and when the player has no role in it, so the editor
 * doesn't reveal universes the player can't see
 *
 * @param request The request
 * @param response The response
 * @param next Continues to the next handler
 */
export async function loadUniverseContext(request: Request, response: Response, next: NextFunction): Promise<void>
{
	const universeId = z.uuid().safeParse(request.params.universeId);
	const playerId = playerIdOf(request);

	if (universeId.success)
	{
		const [universe, access] = await Promise.all([
			findEditableUniverse(universeId.data),
			findUniverseAccess(universeId.data, playerId)
		]);

		if (universe && access)
		{
			universeContexts.set(request, {
				playerId,
				universe,
				role: access.role,
				languages: access.languages
			});
			next();
			return;
		}
	}

	sendError(response, 404, errorMessages.noSuchUniverse);
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

		if (found && (found.universeId === context.universe.id))
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
export function requireRole(allowed: (role: UniverseRole) => boolean): RequestHandler
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
