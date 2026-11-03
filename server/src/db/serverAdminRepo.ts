/**
 * Server admins: the only module that reads or writes the server_admins table
 */
import { and, eq, isNotNull, notExists, sql } from 'drizzle-orm';
import type { PlayerMatch } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { searchPlayers, type PlayerSearch } from './playerRepo.js';
import { authenticators, players, serverAdmins } from './schema.js';

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

/**
 * Whether a player is a server admin with 2FA on, who may use the admin pages and edit any universe
 *
 * @param playerId The player
 * @param executor The database, or a transaction
 * @return Whether they are
 */
export async function isActiveServerAdmin(playerId: string, executor: Executor = db): Promise<boolean>
{
	const [row] = await executor
		.select({
			playerId: serverAdmins.playerId
		})
		.from(serverAdmins)
		.innerJoin(authenticators, eq(authenticators.playerId, serverAdmins.playerId))
		.where(and(
			eq(serverAdmins.playerId, playerId),
			isNotNull(authenticators.enabledAt)
		))
		.limit(1);

	return((row !== undefined));
}

/**
 * Why a server admin couldn't be removed
 */
export type ServerAdminRemoval = 'removed' | 'notAdmin' | 'lastAdmin';

/**
 * Takes away a player's server admin role, unless they are the last server admin
 *
 * Every admin's row is locked first, so two admins removed at once can't both see another left
 *
 * @param playerId The player
 * @param executor A transaction
 * @return Whether they were removed, or why not
 */
export async function removeServerAdmin(playerId: string, executor: Executor): Promise<ServerAdminRemoval>
{
	const admins = await executor
		.select({
			playerId: serverAdmins.playerId
		})
		.from(serverAdmins)
		.for('update');

	if (!admins.some((admin) => (admin.playerId === playerId)))
	{
		return('notAdmin');
	}

	if (admins.length <= 1)
	{
		return('lastAdmin');
	}

	await executor
		.delete(serverAdmins)
		.where(eq(serverAdmins.playerId, playerId));

	return('removed');
}

/**
 * A server admin, as the Admins admin page lists them
 */
export interface ServerAdminRecord
{
	playerId: string;
	username: string;
	displayName: string;
	addedAt: Date;

	/**
	 * Whether they have 2FA on
	 */
	twoFactor: boolean;
}

/**
 * Every server admin
 *
 * @param executor The database, or a transaction
 * @return The admins, by username ignoring case
 */
export async function listServerAdmins(executor: Executor = db): Promise<ServerAdminRecord[]>
{
	return(executor
		.select({
			playerId: players.id,
			username: players.username,
			displayName: players.displayName,
			addedAt: serverAdmins.createdAt,
			twoFactor: sql<boolean>`EXISTS (SELECT 1 FROM ${authenticators} WHERE ${and(eq(authenticators.playerId, players.id), isNotNull(authenticators.enabledAt))})`
		})
		.from(serverAdmins)
		.innerJoin(players, eq(players.id, serverAdmins.playerId))
		.orderBy(sql`lower(${players.username})`));
}

/**
 * Players who could be made server admins: those whose username, or name unless only usernames are
 * searched, holds some text, ignoring capitals, other than the admins
 *
 * @param search The text, and whether only usernames are searched (parsePlayerSearch())
 * @param limit The most players to return
 * @param executor The database, or a transaction
 * @return The players, ordered as searchPlayers() orders them
 */
export async function searchPlayersToMakeAdmin(search: PlayerSearch, limit: number, executor: Executor = db): Promise<PlayerMatch[]>
{
	return(searchPlayers(search, limit, notExists(executor
		.select({
			playerId: serverAdmins.playerId
		})
		.from(serverAdmins)
		.where(eq(serverAdmins.playerId, players.id))), executor));
}
