import { devCode } from '@multiverse-kiln/shared';

/**
 * Whether a typed code is the dev code (all 1s), which is right for any email or authenticator code
 * on a local development server, so testing logins doesn't need a mailbox or an authenticator app
 *
 * It lets anyone who knows an account's email address log in to it, so it has a switch of its own,
 * ENABLE_DEV_CODES, apart from ENABLE_DEV_TOOLS and left off in .env.example, so a server set up from
 * the example doesn't take it. It needs ENABLE_DEV_CODES exactly "true", NODE_ENV unset or exactly
 * "development", and not being on Colyseus Cloud
 *
 * @param typed The code, as read for checking
 * @param length How many characters the code it stands in for has
 * @param env Environment variables to read
 * @return Whether it is the dev code and dev codes are on
 */
export function isDevCode(typed: string, length: number, env: NodeJS.ProcessEnv = process.env): boolean
{
	return((env.ENABLE_DEV_CODES === 'true')
		&& ((env.NODE_ENV === undefined) || (env.NODE_ENV === 'development'))
		&& (env.COLYSEUS_CLOUD === undefined)
		&& (typed === devCode(length)));
}
