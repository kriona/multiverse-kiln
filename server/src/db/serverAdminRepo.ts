/**
 * Server admins: the only module that reads or writes the server_admins table
 */
import { and, eq, isNotNull, notExists, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { PlayerMatch } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { searchPlayers, type PlayerSearch } from './playerRepo.js';
import { authenticators, players, serverAdmins } from './schema.js';

/**
 * The transaction-level advisory lock that makes removing server admins and deleting their accounts take
 * turns (see lockServerAdmins()). Any number no other lock uses
 */
const SERVER_ADMINS_LOCK = 4_150_927;

/**
 * Makes a player a server admin
 *
 * @param playerId The player
 * @param executor The admin role's database or one of its transactions (adminDb, inAdminTransaction()):
 * the server's own role can't write server_admins
 * @return Whether they became one; false when they were one already
 */
export async function addServerAdmin(playerId: string, executor: Executor): Promise<boolean>
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
 * SQL that is true for a player who is a server admin without 2FA on, who can't be logged in until they
 * turn it on (see Admin in STRUCTURE-OVERVIEW.md)
 *
 * @param playerId The column holding the player's ID, such as the session's
 * @return The condition
 */
export function adminWithoutTwoFactor(playerId: AnyColumn): SQL<boolean>
{
	return(sql<boolean>`(EXISTS (SELECT 1 FROM ${serverAdmins} WHERE ${eq(serverAdmins.playerId, playerId)}) AND NOT EXISTS (SELECT 1 FROM ${authenticators} WHERE ${and(eq(authenticators.playerId, playerId), isNotNull(authenticators.enabledAt))}))`);
}

/**
 * Whether a player is a server admin without 2FA on, whose logins wait for them to turn it on
 *
 * @param playerId The player
 * @param executor The database, or a transaction
 * @return Whether they are
 */
export async function isServerAdminWithoutTwoFactor(playerId: string, executor: Executor = db): Promise<boolean>
{
	const [row] = await executor
		.select({
			waits: adminWithoutTwoFactor(players.id)
		})
		.from(players)
		.where(eq(players.id, playerId))
		.limit(1);

	return((row?.waits ?? false));
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
 * Makes transactions that remove server admins, or delete one's account, wait for each other until the
 * transaction ends, so two admins leaving at once can't both see another left, then lists the admins.
 * An advisory lock rather than a lock on the rows, because locking rows needs the UPDATE privilege,
 * which the server's role (kiln_app) doesn't have on server_admins, and account deletion runs as it
 *
 * @param executor A transaction
 * @return The admins' player IDs
 */
async function lockServerAdmins(executor: Executor): Promise<string[]>
{
	await executor.execute(sql`SELECT pg_advisory_xact_lock(${SERVER_ADMINS_LOCK})`);

	// Read after the lock is taken, so it sees what the transaction that held it last committed
	const admins = await executor
		.select({
			playerId: serverAdmins.playerId
		})
		.from(serverAdmins);

	return(admins.map((admin) => admin.playerId));
}

/**
 * Whether a player is the only server admin. In a transaction, every admin's row stays locked until it
 * ends, so the answer holds while it deletes the player
 *
 * @param playerId The player
 * @param executor The database, or a transaction
 * @return Whether they are
 */
export async function isLastServerAdmin(playerId: string, executor: Executor = db): Promise<boolean>
{
	const admins = await lockServerAdmins(executor);

	return(((admins.length === 1) && (admins[0] === playerId)));
}

/**
 * Why a server admin couldn't be removed
 */
export type ServerAdminRemoval = 'removed' | 'notAdmin' | 'lastAdmin';

/**
 * Takes away a player's server admin role, unless they are the last server admin
 *
 * @param playerId The player
 * @param executor One of the admin role's transactions (inAdminTransaction()): the server's own role can't
 * write server_admins
 * @return Whether they were removed, or why not
 */
export async function removeServerAdmin(playerId: string, executor: Executor): Promise<ServerAdminRemoval>
{
	const admins = await lockServerAdmins(executor);

	if (!admins.includes(playerId))
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
