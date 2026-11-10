/**
 * How many connections the server's database pools open (DATABASE_POOL_SIZE and DATABASE_BULK_POOL_SIZE)
 */

/**
 * The most connections a pool size setting may name
 */
const MAX_POOL_SIZE = 500;

/**
 * Connections the shared pool opens when DATABASE_POOL_SIZE is unset
 */
export const DEFAULT_POOL_SIZE = 20;

/**
 * Connections the bulk pool opens when DATABASE_BULK_POOL_SIZE is unset
 */
export const DEFAULT_BULK_POOL_SIZE = 4;

/**
 * The most connections each pool opens
 */
export interface PoolSizes
{
	/**
	 * The shared pool's, for every query outside a bulk transaction
	 */
	shared: number;

	/**
	 * The bulk pool's, for the long transactions of editor saves, imports, exports and deleting universes
	 */
	bulk: number;
}

/**
 * Reads one pool size setting
 *
 * @param env Environment variables to read
 * @param name The setting's name
 * @param fallback The size when the setting is unset
 * @return The size
 * @throws Error when the setting isn't a whole number from 1 to MAX_POOL_SIZE
 */
function parsePoolSize(env: NodeJS.ProcessEnv, name: string, fallback: number): number
{
	const value = env[name]?.trim();

	if (!value)
	{
		return(fallback);
	}

	const size = Number(value);

	if (!Number.isInteger(size) || (size < 1) || (size > MAX_POOL_SIZE))
	{
		throw new Error(`${name} must be a whole number from 1 to ${MAX_POOL_SIZE}: ${value}`);
	}

	return(size);
}

/**
 * Reads and checks how many connections each pool opens
 *
 * @param env Environment variables to read
 * @return The sizes
 * @throws Error when a setting is invalid
 */
export function parsePoolSizes(env: NodeJS.ProcessEnv): PoolSizes
{
	return({
		shared: parsePoolSize(env, 'DATABASE_POOL_SIZE', DEFAULT_POOL_SIZE),
		bulk: parsePoolSize(env, 'DATABASE_BULK_POOL_SIZE', DEFAULT_BULK_POOL_SIZE)
	});
}
