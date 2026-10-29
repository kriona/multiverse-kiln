/**
 * Login sessions: the only module that reads or writes the sessions table
 */
import { and, eq, inArray, lte, ne, or } from 'drizzle-orm';

import { SESSION_LIFETIMES, type SessionTimes } from '../logic/sessionLifetimes.js';
import { db, type Executor } from './client.js';
import { players, sessions } from './schema.js';

/**
 * A session as the rest of the server sees it
 */
export interface SessionRecord extends SessionTimes
{
	id: string;
	playerId: string;
}

/**
 * A session and its player's names
 */
export interface SessionWithPlayer extends SessionRecord
{
	username: string;
	displayName: string;

	/**
	 * The language the player chose, or null when they haven't
	 */
	locale: string | null;
}

/**
 * Starts a session
 *
 * @param playerId The account logging in
 * @param tokenHash Hash of the token in the browser's cookie (hashToken())
 * @param rememberMe Whether the player checked "Remember me"
 * @param executor The database, or a transaction
 * @return The session
 */
export async function createSession(playerId: string, tokenHash: Uint8Array, rememberMe: boolean, executor: Executor = db): Promise<SessionRecord>
{
	const [row] = await executor
		.insert(sessions)
		.values({
			tokenHash,
			playerId,
			rememberMe
		})
		.returning({
			id: sessions.id,
			playerId: sessions.playerId,
			rememberMe: sessions.rememberMe,
			createdAt: sessions.createdAt,
			lastUsedAt: sessions.lastUsedAt
		});

	return(row);
}

/**
 * Finds the session a browser's token belongs to, whether or not it has expired
 *
 * @param tokenHash Hash of the token in the browser's cookie
 * @param executor The database, or a transaction
 * @return The session, or undefined when there is none
 */
export async function findSessionByTokenHash(tokenHash: Uint8Array, executor: Executor = db): Promise<SessionRecord | undefined>
{
	const [row] = await executor
		.select({
			id: sessions.id,
			playerId: sessions.playerId,
			rememberMe: sessions.rememberMe,
			createdAt: sessions.createdAt,
			lastUsedAt: sessions.lastUsedAt
		})
		.from(sessions)
		.where(eq(sessions.tokenHash, tokenHash))
		.limit(1);

	return(row);
}

/**
 * Finds the session a browser's token belongs to, with its player's names, whether or not it has expired
 *
 * @param tokenHash Hash of the token in the browser's cookie
 * @param executor The database, or a transaction
 * @return The session and its player, or undefined when there is none
 */
export async function findSessionWithPlayer(tokenHash: Uint8Array, executor: Executor = db): Promise<SessionWithPlayer | undefined>
{
	const [row] = await executor
		.select({
			id: sessions.id,
			playerId: sessions.playerId,
			rememberMe: sessions.rememberMe,
			createdAt: sessions.createdAt,
			lastUsedAt: sessions.lastUsedAt,
			username: players.username,
			displayName: players.displayName,
			locale: players.locale
		})
		.from(sessions)
		.innerJoin(players, eq(players.id, sessions.playerId))
		.where(eq(sessions.tokenHash, tokenHash))
		.limit(1);

	return(row);
}

/**
 * Records that a session was used
 *
 * @param sessionId The session
 * @param now The time it was used
 * @param executor The database, or a transaction
 */
export async function touchSession(sessionId: string, now: Date, executor: Executor = db): Promise<void>
{
	await touchSessions([sessionId], now, executor);
}

/**
 * Records that sessions were used, such as every session with a window connected to a room
 *
 * @param sessionIds The sessions
 * @param now The time they were used
 * @param executor The database, or a transaction
 */
export async function touchSessions(sessionIds: readonly string[], now: Date, executor: Executor = db): Promise<void>
{
	if (sessionIds.length === 0)
	{
		return;
	}

	await executor
		.update(sessions)
		.set({
			lastUsedAt: now
		})
		.where(inArray(sessions.id, [...sessionIds]));
}

/**
 * Ends a session, as logging out does
 *
 * @param sessionId The session
 * @param executor The database, or a transaction
 */
export async function deleteSession(sessionId: string, executor: Executor = db): Promise<void>
{
	await executor
		.delete(sessions)
		.where(eq(sessions.id, sessionId));
}

/**
 * An account's sessions, for its data export
 *
 * @param playerId The account
 * @param executor The database, or a transaction
 * @return When each started and was last used, and whether it was remembered, oldest first
 */
export async function listPlayerSessions(playerId: string, executor: Executor = db): Promise<{ createdAt: Date; lastUsedAt: Date; rememberMe: boolean }[]>
{
	return(executor
		.select({
			createdAt: sessions.createdAt,
			lastUsedAt: sessions.lastUsedAt,
			rememberMe: sessions.rememberMe
		})
		.from(sessions)
		.where(eq(sessions.playerId, playerId))
		.orderBy(sessions.createdAt));
}

/**
 * Ends every session of an account, as changing its password does
 *
 * @param playerId The account
 * @param executor The database, or a transaction
 * @param keepSessionId A session to leave going, such as that of the browser changing the password
 * @return The IDs of the sessions ended, so the rooms can turn away their windows
 */
export async function deletePlayerSessions(playerId: string, executor: Executor = db, keepSessionId?: string): Promise<string[]>
{
	const rows = await executor
		.delete(sessions)
		.where(and(
			eq(sessions.playerId, playerId),
			((keepSessionId === undefined) ? undefined : ne(sessions.id, keepSessionId))
		))
		.returning({
			id: sessions.id
		});

	return(rows.map((row) => row.id));
}

/**
 * Deletes every session that has expired (isSessionExpired())
 *
 * @param now The time now
 * @param executor The database, or a transaction
 * @return The IDs of the sessions deleted, so the rooms can turn away their windows
 */
export async function deleteExpiredSessions(now: Date, executor: Executor = db): Promise<string[]>
{
	const conditions = ([true, false] as const).map((rememberMe) =>
	{
		const lifetime = (rememberMe ? SESSION_LIFETIMES.remembered : SESSION_LIFETIMES.short);

		return(and(
			eq(sessions.rememberMe, rememberMe),
			or(
				lte(sessions.lastUsedAt, new Date(now.getTime() - lifetime.idleMs)),
				lte(sessions.createdAt, new Date(now.getTime() - lifetime.totalMs))
			)
		));
	});
	const rows = await executor
		.delete(sessions)
		.where(or(...conditions))
		.returning({
			id: sessions.id
		});

	return(rows.map((row) => row.id));
}
