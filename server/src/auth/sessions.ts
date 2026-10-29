/**
 * Login sessions: which player a request or a room connection belongs to, from its session cookie
 * (see Login in STRUCTURE-OVERVIEW.md)
 *
 * A session lives in the database; the browser holds only a random token, and the database only its
 * hash. Every window of a browser sends the same cookie, so they are all the same player, and a player
 * may be logged in from several browsers, each with a session of its own
 */
import type { Response } from 'express';

import type { Executor } from '../db/client.js';
import { createSession, deleteSession, findSessionWithPlayer, touchSession } from '../db/sessionRepo.js';
import { clearCookie, readCookie, SESSION_COOKIE, setCookie } from '../http/cookies.js';
import { isSessionExpired, SESSION_LIFETIMES, shouldTouchSession } from '../logic/sessionLifetimes.js';
import { connectedSessions } from '../players/connectedSessions.js';
import { createToken, hashToken, isTokenForm } from './tokens.js';

/**
 * Who a session belongs to
 */
export interface SessionIdentity
{
	sessionId: string;

	/**
	 * Public ID of the player (their account's ID), used as their key in synced state. The session's ID
	 * and token never leave the server
	 */
	playerId: string;

	username: string;
	name: string;

	/**
	 * The language the player chose on their profile, or null when they haven't
	 */
	locale: string | null;
}

/**
 * Finds the session a Cookie header names, if it is still going. A session found expired is deleted,
 * and its windows turned away; one used a while ago has the use recorded
 *
 * @param cookieHeader The request's or connection's Cookie header
 * @param now The time now
 * @return Who the session belongs to, or undefined when there is no session going
 */
export async function resolveSession(cookieHeader: string | null | undefined, now: Date = new Date()): Promise<SessionIdentity | undefined>
{
	const token = readCookie(cookieHeader, SESSION_COOKIE);

	if ((token === undefined) || !isTokenForm(token))
	{
		return(undefined);
	}

	const session = await findSessionWithPlayer(hashToken(token));

	if (!session)
	{
		return(undefined);
	}

	if (isSessionExpired(session, now))
	{
		await deleteSession(session.id);
		connectedSessions.end([session.id]);
		return(undefined);
	}

	if (shouldTouchSession(session, now))
	{
		await touchSession(session.id, now);
	}

	return({
		sessionId: session.id,
		playerId: session.playerId,
		username: session.username,
		name: session.displayName,
		locale: session.locale
	});
}

/**
 * Logs a browser in: starts a session and gives the browser its cookie. Without "Remember me" the
 * cookie goes when the browser closes; with it, the browser keeps it as long as the session can last
 *
 * @param response The response to the login, which carries the cookie
 * @param playerId The account
 * @param rememberMe Whether the player checked "Remember me"
 * @param executor The database, or a transaction
 * @return The session's ID
 */
export async function startSession(response: Response, playerId: string, rememberMe: boolean, executor?: Executor): Promise<string>
{
	const token = createToken();
	const session = await createSession(playerId, hashToken(token), rememberMe, executor);

	setCookie(response, SESSION_COOKIE, token, (rememberMe ? SESSION_LIFETIMES.remembered.totalMs : undefined));

	return(session.id);
}

/**
 * Logs a browser out: ends its session, turns its windows away and has it forget the cookie
 *
 * @param response The response to the logout
 * @param sessionId The session
 */
export async function endSession(response: Response, sessionId: string): Promise<void>
{
	await deleteSession(sessionId);
	connectedSessions.end([sessionId]);
	clearCookie(response, SESSION_COOKIE);
}
