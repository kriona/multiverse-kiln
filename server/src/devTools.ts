/**
 * Whether to serve the Colyseus playground and /monitor
 *
 * Dev tools are opt-in: an unset or misconfigured environment keeps them off. Never enabled in
 * production, even if ENABLE_DEV_TOOLS is set there by mistake
 *
 * @param env Environment variables to read
 * @return True only when ENABLE_DEV_TOOLS is exactly "true" and NODE_ENV isn't production
 */
export function isDevToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean
{
	return((env.ENABLE_DEV_TOOLS === 'true') && (env.NODE_ENV !== 'production'));
}
