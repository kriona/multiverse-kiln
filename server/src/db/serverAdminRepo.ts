/**
 * Server admins: the only module that reads or writes the server_admins table
 */
import { eq } from 'drizzle-orm';

import { db, type Executor } from './client.js';
import { serverAdmins } from './schema.js';

/**
 * Makes a player a server admin
 *
 * @param playerId The player
 * @param executor The database, or a transaction
 * @return Whether they became one; false when they were one already
 */
export async function addServerAdmin(playerId: string, executor: Executor = db): Promise<boolean>
{
	const rows = await executor
		.insert(serverAdmins)
		.values({
			playerId
		})
		.onConflictDoNothing()
		.returning({
			playerId: serverAdmins.playerId
		});

	return((rows.length > 0));
}

/**
 * Whether a player is a server admin
 *
 * @param playerId The player
 * @param executor The database, or a transaction
 * @return Whether they are
 */
export async function isServerAdmin(playerId: string, executor: Executor = db): Promise<boolean>
{
	const [row] = await executor
		.select({
			playerId: serverAdmins.playerId
		})
		.from(serverAdmins)
		.where(eq(serverAdmins.playerId, playerId))
		.limit(1);

	return((row !== undefined));
}
