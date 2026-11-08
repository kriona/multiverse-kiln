/**
 * Login sessions: the only module that reads or writes the sessions table
 */
import { and, count, desc, eq, inArray, lte, ne, not, notInArray, or, sql, type SQL } from 'drizzle-orm';

import { SESSION_LIFETIMES, type SessionTimes } from '../logic/sessionLifetimes.js';
import { db, type Executor } from './client.js';
import { players, sessions } from './schema.js';
import { anyColumnContains } from './textSearch.js';

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
	const rows = await executor
		.delete(sessions)
		.where(expiredCondition(now))
		.returning({
			id: sessions.id
		});

	return(rows.map((row) => row.id));
}

/**
 * Which of some players have one of some sessions, such as those with windows connected
 *
 * @param playerIds The players' IDs
 * @param sessionIds The sessions' IDs
 * @param executor The database, or a transaction
 * @return The IDs of the players with one
 */
export async function findPlayersWithSessions(playerIds: readonly string[], sessionIds: readonly string[], executor: Executor = db): Promise<Set<string>>
{
	if ((playerIds.length === 0) || (sessionIds.length === 0))
	{
		return(new Set());
	}

	const rows = await executor
		.selectDistinct({
			playerId: sessions.playerId
		})
		.from(sessions)
		.where(and(
			inArray(sessions.playerId, [...playerIds]),
			inArray(sessions.id, [...sessionIds])
		));

	return(new Set(rows.map((row) => row.playerId)));
}

/**
 * A condition that a session has expired (isSessionExpired())
 *
 * @param now The time now
 * @return The condition
 */
function expiredCondition(now: Date): SQL
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

	return((or(...conditions) ?? sql`false`));
}

/**
 * What a list of the sessions still going is narrowed to
 */
export interface ActiveSessionFilter
{
	/**
	 * Text the player's username or name holds, ignoring capitals
	 */
	search?: string;

	/**
	 * Only these sessions (connected: true) or only the others (false), such as those with a window connected
	 */
	connected?: {
		ids: readonly string[];
		connected: boolean;
	};
}

/**
 * A session still going, with its player's names
 */
export interface ActiveSession extends SessionRecord
{
	username: string;
	displayName: string;
}

/**
 * A page of the sessions that haven't expired, for the admin pages
 *
 * @param filter What to narrow the list to
 * @param page How many matching sessions to skip, and the most to return
 * @param now The time now
 * @param executor The database, or a transaction
 * @return The sessions, most recently used first (then newest, then by ID), and how many match in all
 */
export async function listActiveSessions(filter: ActiveSessionFilter, page: { offset: number; limit: number }, now: Date, executor: Executor = db): Promise<{ sessions: ActiveSession[]; total: number }>
{
	const where = and(
		not(expiredCondition(now)),
		((filter.search === undefined) ? undefined : anyColumnContains([players.username, players.displayName], filter.search)),
		((filter.connected === undefined)
			? undefined
			: (filter.connected.connected ? inArray(sessions.id, [...filter.connected.ids]) : notInArray(sessions.id, [...filter.connected.ids])))
	);
	const [rows, [counted]] = await Promise.all([
		executor
			.select({
				id: sessions.id,
				playerId: sessions.playerId,
				rememberMe: sessions.rememberMe,
				createdAt: sessions.createdAt,
				lastUsedAt: sessions.lastUsedAt,
				username: players.username,
				displayName: players.displayName
			})
			.from(sessions)
			.innerJoin(players, eq(players.id, sessions.playerId))
			.where(where)
			.orderBy(desc(sessions.lastUsedAt), desc(sessions.createdAt), sessions.id)
			.offset(page.offset)
			.limit(page.limit),
		executor
			.select({
				total: count()
			})
			.from(sessions)
			.innerJoin(players, eq(players.id, sessions.playerId))
			.where(where)
	]);

	return({
		sessions: rows,
		total: counted.total
	});
}
