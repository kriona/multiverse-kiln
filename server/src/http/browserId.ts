import { randomUUID } from 'crypto';
import type { Application } from 'express';
import { BROWSER_ID_PATH } from '@multiverse-kiln/shared';

/**
 * Name of the cookie holding the browser ID
 *
 * The __Host- prefix makes browsers refuse it unless it is Secure, has Path=/ and no Domain, so it
 * can only have been set by this host over HTTPS
 */
export const BROWSER_ID_COOKIE = '__Host-kiln-browser';

/**
 * A random (version 4) UUID, the only form of browser ID the server issues or accepts
 */
const browserIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Adds POST /browser-id, which gives a browser a browser ID cookie if it doesn't already have a valid one
 *
 * The browser ID identifies a browser until there are logins: every window that sends the cookie
 * controls the same player. The cookie is HttpOnly, so page scripts can't read it, and has no
 * expiry, so the browser discards it when it closes
 *
 * @param app Express app to add the route to
 */
export function addBrowserIdRoute(app: Application): void
{
	app.post(BROWSER_ID_PATH, (request, response) =>
	{
		if (readBrowserId(request.headers.cookie) === undefined)
		{
			response.cookie(BROWSER_ID_COOKIE, randomUUID(), {
				httpOnly: true,
				secure: true,
				sameSite: 'strict',
				path: '/'
			});
		}

		response.set('Cache-Control', 'no-store');
		response.sendStatus(204);
	});
}

/**
 * Reads the browser ID from a Cookie header
 *
 * @param cookieHeader Cookie header value, or null/undefined when the request has none
 * @return The browser ID, or undefined when the cookie is missing or isn't a valid browser ID
 */
export function readBrowserId(cookieHeader: string | null | undefined): string | undefined
{
	for (const pair of (cookieHeader ?? '').split(';'))
	{
		const separator = pair.indexOf('=');

		if ((separator !== -1) && (pair.slice(0, separator).trim() === BROWSER_ID_COOKIE))
		{
			const value = pair.slice(separator + 1).trim();

			return((browserIdPattern.test(value) ? value : undefined));
		}
	}

	return(undefined);
}
