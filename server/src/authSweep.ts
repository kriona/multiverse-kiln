/**
 * Keeps login records tidy: once as the server starts, then every few minutes. It runs on its own
 * timer, never in a room's simulation tick
 *
 * - Sessions with a window connected to a room are recorded as used, since an open connection counts as use
 * - Expired sessions are deleted, and their windows turned away
 * - Email codes that can no longer be used are deleted, provider logins and logins waiting on an
 *   authenticator code left waiting too long, and browsers whose trust has ended
 * - Rate limit records are deleted once no limit counts them, and auth events after 90 days
 */
import { deleteAuthEventsBefore } from './db/authEventRepo.js';
import { deleteStaleEmailCodes } from './db/emailCodeRepo.js';
import { deleteExpiredPendingProviderLogins } from './db/providerLoginRepo.js';
import { deleteRateLimitEventsBefore } from './db/rateLimitRepo.js';
import { deleteExpiredSessions, touchSessions } from './db/sessionRepo.js';
import { deleteExpiredPendingTwoFactorLogins, deleteExpiredTrustedBrowsers } from './db/twoFactorRepo.js';
import { DAY_MS, HOUR_MS } from './logic/emailCodes.js';
import { SESSION_TOUCH_INTERVAL_MS } from './logic/sessionLifetimes.js';
import { connectedSessions } from './players/connectedSessions.js';

/**
 * How often the sweep runs: as often as a session's use is recorded, so a connected session is never
 * left unrecorded longer than that
 */
const SWEEP_INTERVAL_MS = SESSION_TOUCH_INTERVAL_MS;

/**
 * How long auth events are kept
 */
const AUTH_EVENT_DAYS = 90;

/**
 * Records the connected sessions' use, then deletes what is no longer needed, logging what fails
 *
 * @param now The time now
 */
export async function sweepAuth(now: Date = new Date()): Promise<void>
{
	try
	{
		await touchSessions(connectedSessions.ids(), now);
		connectedSessions.end(await deleteExpiredSessions(now));
	}
	catch (error)
	{
		console.error('Could not tidy the login sessions:', error);
	}

	try
	{
		await deleteStaleEmailCodes(now);
		await deleteExpiredPendingProviderLogins(now);
		await deleteExpiredPendingTwoFactorLogins(now);
		await deleteExpiredTrustedBrowsers(now);
		await deleteRateLimitEventsBefore(['addressCodeSent', 'networkCodeRequest', 'networkGuess', 'addressLoginAttempt', 'networkLoginAttempt', 'accountTwoFactorAttempt', 'browserLoginAttempt', 'networkUsernameCheck'], new Date(now.getTime() - HOUR_MS));
		await deleteRateLimitEventsBefore(['addressWrongGuess', 'accountWrongAuthenticatorCode'], new Date(now.getTime() - DAY_MS));
		await deleteAuthEventsBefore(new Date(now.getTime() - (AUTH_EVENT_DAYS * DAY_MS)));
	}
	catch (error)
	{
		console.error('Could not delete old email codes, waiting logins, trusted browsers, rate limit records and auth events:', error);
	}
}

/**
 * Sweeps now and every SWEEP_INTERVAL_MS. The timer doesn't keep the process running on its own
 *
 * @return Stops the sweeps
 */
export function startAuthSweep(): () => void
{
	void sweepAuth();

	const timer = setInterval(() =>
	{
		void sweepAuth();
	}, SWEEP_INTERVAL_MS);

	timer.unref();

	return(() =>
	{
		clearInterval(timer);
	});
}
