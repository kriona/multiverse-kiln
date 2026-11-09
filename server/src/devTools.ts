/**
 * Whether to serve the Colyseus playground, /monitor and the load test's bot login
 *
 * Dev tools are opt-in: an unset or misconfigured environment keeps them off, and .env.example leaves
 * them off. They need ENABLE_DEV_TOOLS exactly "true", NODE_ENV unset or exactly "development", and not
 * being on Colyseus Cloud, so setting ENABLE_DEV_TOOLS on a deployed server by mistake doesn't turn them on
 *
 * @param env Environment variables to read
 * @return Whether dev tools are on
 */
export function isDevToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean
{
	return((env.ENABLE_DEV_TOOLS === 'true')
		&& ((env.NODE_ENV === undefined) || (env.NODE_ENV === 'development'))
		&& (env.COLYSEUS_CLOUD === undefined));
}
