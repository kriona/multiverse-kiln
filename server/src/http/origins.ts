import type { BeforeUpgradeHandler } from 'colyseus';

/**
 * Parses ALLOWED_ORIGINS: a comma-separated list of origins allowed to use the server from a browser
 *
 * Each entry is normalized to its origin (scheme, host and port), so "https://Example.com/" becomes
 * "https://example.com"
 *
 * @param value Raw ALLOWED_ORIGINS value
 * @return Set of normalized origins
 */
export function parseAllowedOrigins(value: string | undefined): Set<string>
{
	const entries = (value ?? '').split(',').map((entry) => entry.trim()).filter((entry) => (entry !== ''));

	if (entries.length === 0)
	{
		throw new Error('ALLOWED_ORIGINS is required: a comma-separated list of origins allowed to use the server from a browser, e.g. https://www.multiversekiln-dev.com:5173');
	}

	const origins = new Set<string>();

	for (const entry of entries)
	{
		origins.add(normalizeOrigin(entry));
	}

	return(origins);
}

/**
 * Normalizes one ALLOWED_ORIGINS entry, rejecting anything that isn't an http(s) origin
 *
 * @param entry Origin as written in ALLOWED_ORIGINS
 * @return Origin with a lowercase host and no trailing slash
 */
function normalizeOrigin(entry: string): string
{
	let url: URL;

	try
	{
		url = new URL(entry);
	}
	catch
	{
		throw new Error(`ALLOWED_ORIGINS entry is not a valid origin: ${entry}`);
	}

	if (((url.protocol !== 'https:') && (url.protocol !== 'http:')) || ((url.pathname !== '/') || (url.search !== '') || (url.hash !== '')))
	{
		throw new Error(`ALLOWED_ORIGINS entry must be just a scheme, host and optional port, e.g. https://example.com: ${entry}`);
	}

	return(url.origin);
}

/**
 * Whether a request's Origin header is in the allowlist
 *
 * @param origin Origin header value, or null when the request has none
 * @param allowedOrigins Normalized allowed origins
 * @return True when the origin is allowed
 */
export function isOriginAllowed(origin: string | null, allowedOrigins: Set<string>): boolean
{
	return((origin !== null) && allowedOrigins.has(origin));
}

/**
 * Creates a WebSocket upgrade check that rejects browsers on other sites
 *
 * Browsers don't apply CORS to WebSockets, so the server checks Origin itself. Connections without
 * an Origin header come from non-browser clients (tests, load tests), which can set any header
 * they like, so they are let through
 *
 * @param allowedOrigins Normalized allowed origins
 * @return Handler for WebSocketTransport's beforeUpgrade option
 */
export function createOriginCheck(allowedOrigins: Set<string>): BeforeUpgradeHandler
{
	return((_request, context) =>
	{
		const origin = context.headers.get('origin');

		if ((origin !== null) && !isOriginAllowed(origin, allowedOrigins))
		{
			return(new Response('Forbidden', { status: 403 }));
		}

		return(undefined);
	});
}
