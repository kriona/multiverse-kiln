import { matchMaker } from 'colyseus';

import { isOriginAllowed } from './origins.js';

/**
 * Sets the headers Colyseus adds to every HTTP response: CORS limited to the allowlist, plus nosniff
 *
 * Colyseus's defaults allow every origin with credentials. Its CORS hook runs for every HTTP
 * request (matchmaking, its own routes and Express routes), so it also carries nosniff
 *
 * @param allowedOrigins Normalized allowed origins
 */
export function configureResponseHeaders(allowedOrigins: Set<string>): void
{
	const defaultHeaders: Record<string, string> = matchMaker.controller.DEFAULT_CORS_HEADERS;

	// Only allowed origins get Access-Control-Allow-Origin, from getCorsHeaders below
	delete defaultHeaders['Access-Control-Allow-Origin'];

	defaultHeaders['Vary'] = 'Origin';
	defaultHeaders['X-Content-Type-Options'] = 'nosniff';

	matchMaker.controller.getCorsHeaders = (headers): Record<string, string> =>
	{
		const origin = headers.get('origin');

		return(((origin !== null) && isOriginAllowed(origin, allowedOrigins)) ? { 'Access-Control-Allow-Origin': origin } : {});
	};
}
