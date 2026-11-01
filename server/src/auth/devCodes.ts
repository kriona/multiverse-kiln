import { devCode } from '@multiverse-kiln/shared';
import { isDevToolsEnabled } from '../devTools.js';

/**
 * Whether a typed code is the dev code (all 1s), which is right for any email or authenticator code
 * on a local development server, so testing logins doesn't need a mailbox or an authenticator app
 *
 * It lets anyone who knows an account's email address log in to it, so it needs every sign of local
 * development: dev tools on (devTools.ts), NODE_ENV unset or exactly "development", and not on
 * Colyseus Cloud
 *
 * @param typed The code, as read for checking
 * @param length How many characters the code it stands in for has
 * @param env Environment variables to read
 * @return Whether it is the dev code and the server is a local development server
 */
export function isDevCode(typed: string, length: number, env: NodeJS.ProcessEnv = process.env): boolean
{
	return(isDevToolsEnabled(env)
		&& ((env.NODE_ENV === undefined) || (env.NODE_ENV === 'development'))
		&& (env.COLYSEUS_CLOUD === undefined)
		&& (typed === devCode(length)));
}
