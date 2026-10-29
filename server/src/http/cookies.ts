/**
 * The cookies the server gives browsers. Each has the __Host- prefix, which makes browsers refuse it
 * unless it is Secure, has Path=/ and no Domain, so it can only have been set by this host over HTTPS.
 * Each is HttpOnly, so page scripts can't read it, and SameSite=Strict
 */
import type { Response } from 'express';

/**
 * The login session's token (server/src/auth/sessions.ts)
 */
export const SESSION_COOKIE = '__Host-kiln-session';

/**
 * The token that lets the browser that entered an email code take the next step, such as choosing a password
 */
export const CONTINUATION_COOKIE = '__Host-kiln-continue';

/**
 * What a login with Google or Discord started with (the provider, the state and the PKCE secret), kept
 * while the player is at the provider (http/providerAuth.ts)
 */
export const PROVIDER_START_COOKIE = '__Host-kiln-provider-start';

/**
 * The token that lets the browser that came back from a provider take the next step, such as choosing
 * a username
 */
export const PROVIDER_LOGIN_COOKIE = '__Host-kiln-provider-login';

/**
 * Reads a cookie from a Cookie header
 *
 * @param cookieHeader Cookie header value, or null/undefined when the request has none
 * @param name The cookie's name
 * @return Its value, or undefined when the request doesn't have it
 */
export function readCookie(cookieHeader: string | null | undefined, name: string): string | undefined
{
	for (const pair of (cookieHeader ?? '').split(';'))
	{
		const separator = pair.indexOf('=');

		if ((separator !== -1) && (pair.slice(0, separator).trim() === name))
		{
			return(pair.slice(separator + 1).trim());
		}
	}

	return(undefined);
}

/**
 * Gives the browser a cookie
 *
 * @param response The response to set it on
 * @param name The cookie's name
 * @param value Its value
 * @param maxAgeMs How long the browser keeps it, in milliseconds, or undefined to keep it until the browser closes
 */
export function setCookie(response: Response, name: string, value: string, maxAgeMs: number | undefined): void
{
	response.cookie(name, value, {
		httpOnly: true,
		secure: true,
		sameSite: 'strict',
		path: '/',
		...((maxAgeMs !== undefined) ? { maxAge: maxAgeMs } : {})
	});
}

/**
 * Tells the browser to forget a cookie
 *
 * @param response The response
 * @param name The cookie's name
 */
export function clearCookie(response: Response, name: string): void
{
	response.clearCookie(name, {
		httpOnly: true,
		secure: true,
		sameSite: 'strict',
		path: '/'
	});
}
