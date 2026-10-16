/**
 * Who is using the world editor, and what they may do in the universe a request is about
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import type { EditableUniverse, EditorZone, UniverseRole } from '@multiverse-kiln/shared';

import { findUniverseRole } from '../db/universeEditorRepo.js';
import { findEditableUniverse } from '../db/universeRepo.js';
import { findEditorZone } from '../db/zoneRepo.js';
import { onlinePlayers } from '../players/onlinePlayers.js';
import { readBrowserId } from './browserId.js';
import { isOriginAllowed } from './origins.js';

/**
 * The universe a request is about, and the requesting player's role in it
 */
export interface UniverseContext
{
	playerId: string;
	universe: Omit<EditableUniverse, 'role'>;
	role: UniverseRole;
}

/**
 * The zone a request is about, in its universe
 */
export interface ZoneContext extends UniverseContext
{
	zone: EditorZone;
}

/**
 * Methods that don't change anything
 */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const playerIds = new WeakMap<Request, string>();
const universeContexts = new WeakMap<Request, UniverseContext>();
const zoneContexts = new WeakMap<Request, ZoneContext>();

/**
 * Middleware that refuses writes from browsers on origins outside ALLOWED_ORIGINS
 *
 * The browser ID cookie is SameSite=Strict, but other origins on the same site (another port or
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
			response.status(403).json({ error: 'Not allowed from this origin' });
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
export function requireLogin(request: Request, response: Response, next: NextFunction): void
{
	const browserId = readBrowserId(request.headers.cookie);
	const player = ((browserId === undefined) ? undefined : onlinePlayers.get(browserId));

	if (!player)
	{
		response.status(401).json({ error: 'Log in first' });
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
		const [universe, role] = await Promise.all([
			findEditableUniverse(universeId.data),
			findUniverseRole(universeId.data, playerId)
		]);

		if (universe && role)
		{
			universeContexts.set(request, { playerId, universe, role });
			next();
			return;
		}
	}

	response.status(404).json({ error: 'No such universe' });
}

/**
 * Middleware for routes under /:universeId/zones/:zoneId: loads the zone, which must belong to the universe
 *
 * @param request The request
 * @param response The response
 * @param next Continues to the next handler
 */
export async function loadZoneContext(request: Request, response: Response, next: NextFunction): Promise<void>
{
	const zoneId = z.uuid().safeParse(request.params.zoneId);
	const context = universeContextOf(request);

	if (zoneId.success)
	{
		const found = await findEditorZone(zoneId.data);

		if (found && (found.universeId === context.universe.id))
		{
			zoneContexts.set(request, { ...context, zone: found.zone });
			next();
			return;
		}
	}

	response.status(404).json({ error: 'No such zone' });
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
			response.status(403).json({ error: 'Your role in this universe doesn\'t allow that' });
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
 * The zone of a request that has passed loadZoneContext
 *
 * @param request The request
 * @return The zone, its universe and the player's role in it
 */
export function zoneContextOf(request: Request): ZoneContext
{
	const context = zoneContexts.get(request);

	if (!context)
	{
		throw new Error(`${request.method} ${request.path} reached a handler without loadZoneContext`);
	}

	return(context);
}
