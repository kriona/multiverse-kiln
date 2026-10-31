/**
 * Browsers that have logged in to an account (see Login limits in STRUCTURE-OVERVIEW.md). Anyone can
 * use up an address's hourly login limit with wrong passwords, so a browser that has logged in to the
 * account counts its own tries instead, and someone else's guesses can't lock the player out
 *
 * The cookie holds a random ID, when it ends, and a keyed hash of both with the account's ID. The
 * server keeps nothing, only it can make one, and the cookie doesn't name the account: a login checks
 * it against the account the address belongs to
 */
import type { Request, Response } from 'express';

import { KNOWN_BROWSER_COOKIE, readCookie, setCookie } from '../http/cookies.js';
import { hashesMatch, keyedHash } from './keyedHashes.js';
import { createToken, isTokenForm } from './tokens.js';

/**
 * How long a browser stays known after it last logged in
 */
export const KNOWN_BROWSER_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * The keyed hash that shows the server made a known browser cookie for an account
 *
 * @param id The browser's ID
 * @param expiresAt When the cookie ends, in milliseconds since 1970
 * @param playerId The account
 * @return The hash
 */
function signature(id: string, expiresAt: number, playerId: string): Buffer
{
	return(keyedHash('knownBrowser', `${id}.${expiresAt}.${playerId}`));
}

/**
 * Marks the browser as one that has logged in to an account, with a new ID, so its count of login
 * tries starts again. A browser is known to the account it last logged in to
 *
 * @param response The response to the login
 * @param playerId The account
 * @param now The time now
 */
export function markKnownBrowser(response: Response, playerId: string, now: Date): void
{
	const id = createToken();
	const expiresAt = (now.getTime() + KNOWN_BROWSER_LIFETIME_MS);

	setCookie(response, KNOWN_BROWSER_COOKIE, `${id}.${expiresAt}.${signature(id, expiresAt, playerId).toString('base64url')}`, KNOWN_BROWSER_LIFETIME_MS);
}

/**
 * Whether the browser has a known browser cookie, for any account
 *
 * @param request The request
 * @return Whether it has
 */
export function hasKnownBrowserCookie(request: Request): boolean
{
	return(readCookie(request.headers.cookie, KNOWN_BROWSER_COOKIE) !== undefined);
}

/**
 * What a known browser's login tries are counted under: a keyed hash of its ID, when its cookie was
 * made for the account and hasn't ended
 *
 * @param request The request
 * @param playerId The account the login is for
 * @param now The time now
 * @return The hash, or undefined when the browser isn't known to the account
 */
export function knownBrowserHash(request: Request, playerId: string, now: Date): Buffer | undefined
{
	const [id, expires, mac, extra] = (readCookie(request.headers.cookie, KNOWN_BROWSER_COOKIE) ?? '').split('.');
	const expiresAt = Number(expires);

	if (!id || !mac || (extra !== undefined) || !isTokenForm(id) || !Number.isSafeInteger(expiresAt) || (expiresAt <= now.getTime()))
	{
		return(undefined);
	}

	if (!hashesMatch(signature(id, expiresAt, playerId), Buffer.from(mac, 'base64url')))
	{
		return(undefined);
	}

	// The ID alone, which no signature is a hash of, since those include the time and account
	return(keyedHash('knownBrowser', id));
}
