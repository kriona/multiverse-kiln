/**
 * The check that keeps development scripts that log in as players, such as the review's session script
 * (reviewSession.ts), away from every database but the one on this computer, and so away from Neon
 */
import { isDevToolsEnabled } from '../src/devTools.js';

/**
 * The hosts DATABASE_URL may name, as URL's hostname writes them (an IPv6 address in brackets)
 */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/**
 * Why a development script must not run with these settings
 *
 * @param env Environment variables to read
 * @return The reason, or undefined when dev tools are on and DATABASE_URL is a database on this computer
 */
export function localOnlyRefusal(env: NodeJS.ProcessEnv = process.env): string | undefined
{
	if (!isDevToolsEnabled(env))
	{
		return('This script only runs with dev tools on: set ENABLE_DEV_TOOLS=true in server/.env (never in production).');
	}

	if (!env.DATABASE_URL)
	{
		return('DATABASE_URL is not set. See server/.env.example');
	}

	let url: URL;

	try
	{
		url = new URL(env.DATABASE_URL);
	}
	catch
	{
		return('DATABASE_URL is not a URL, so it can\'t be checked to be a database on this computer.');
	}

	// A host parameter replaces the host before it (pg-connection-string), so it could name any server
	if (url.searchParams.has('host') || !LOCAL_HOSTS.includes(url.hostname.toLowerCase()))
	{
		return('This script only runs against a database on this computer: DATABASE_URL\'s host must be localhost, 127.0.0.1 or ::1.');
	}

	return(undefined);
}
