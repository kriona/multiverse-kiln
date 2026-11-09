/**
 * How long a login session lasts (see Login in STRUCTURE-OVERVIEW.md)
 */
import { REMEMBERED_SESSION_IDLE_DAYS, REMEMBERED_SESSION_TOTAL_DAYS, SESSION_IDLE_HOURS, SESSION_TOTAL_HOURS } from '@multiverse-kiln/shared';

const HOUR_MS = (60 * 60 * 1000);
const DAY_MS = (24 * HOUR_MS);

/**
 * How long a session lasts without use, and in all, with and without "Remember me"
 */
export const SESSION_LIFETIMES = {
	short: {
		idleMs: (SESSION_IDLE_HOURS * HOUR_MS),
		totalMs: (SESSION_TOTAL_HOURS * HOUR_MS)
	},
	remembered: {
		idleMs: (REMEMBERED_SESSION_IDLE_DAYS * DAY_MS),
		totalMs: (REMEMBERED_SESSION_TOTAL_DAYS * DAY_MS)
	}
} as const;

/**
 * How long after a session's last recorded use a new use is recorded, in milliseconds, so a busy
 * player doesn't write to the database on every request. Small next to the shortest idle lifetime,
 * so a session never ends early by more than this
 */
export const SESSION_TOUCH_INTERVAL_MS = (5 * 60 * 1000);

/**
 * A session's times, as stored
 */
export interface SessionTimes
{
	createdAt: Date;
	lastUsedAt: Date;
	rememberMe: boolean;
}

/**
 * When a session ends if it isn't used again
 *
 * @param session The session
 * @return The earlier of its idle and total limits
 */
export function sessionExpiresAt(session: SessionTimes): Date
{
	const lifetime = (session.rememberMe ? SESSION_LIFETIMES.remembered : SESSION_LIFETIMES.short);

	return(new Date(Math.min((session.lastUsedAt.getTime() + lifetime.idleMs), (session.createdAt.getTime() + lifetime.totalMs))));
}

/**
 * Whether a session has ended
 *
 * @param session The session
 * @param now The time now
 * @return Whether it has gone unused too long or lasted too long in all
 */
export function isSessionExpired(session: SessionTimes, now: Date): boolean
{
	return(now.getTime() >= sessionExpiresAt(session).getTime());
}

/**
 * Whether a use of a session should be recorded
 *
 * @param session The session
 * @param now The time now
 * @return Whether its last recorded use is SESSION_TOUCH_INTERVAL_MS old or more
 */
export function shouldTouchSession(session: SessionTimes, now: Date): boolean
{
	return((now.getTime() - session.lastUsedAt.getTime()) >= SESSION_TOUCH_INTERVAL_MS);
}
