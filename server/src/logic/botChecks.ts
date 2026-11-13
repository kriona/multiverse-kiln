/**
 * When a request needs a bot check (see Bot checks in STRUCTURE-OVERVIEW.md): logging in with a
 * password, a logged-in account's password given again, and sending an email code. Past a soft limit
 * below the hard limits that refuse requests, a browser has to pass a check first, and one that passes
 * a check for each request can make a few more past an address's hard limit
 *
 * The callers keep the counts these functions decide from, locking them and recording what the
 * decision says to count in one transaction, so these stay pure. The counts are kept for every address
 * whether or not it has an account, so no decision tells whether one does
 */
import { DAY_MS, decideLimit, EMAIL_CODE_RESEND_MS, HOUR_MS, MAX_EMAIL_CODES_PER_ADDRESS_HOUR, MAX_EMAIL_CODES_PER_NETWORK_HOUR, MAX_WRONG_GUESSES_PER_ADDRESS_DAY, type SendDecision } from './emailCodes.js';

/**
 * How many times one address may be tried at login in an hour, whether or not the account exists
 */
export const MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR = 10;

/**
 * How many times a browser that has logged in to an account may try logging in to it again in an hour.
 * Its tries are counted in place of the address's, so others' guesses at the address can't lock it out
 */
export const MAX_LOGIN_ATTEMPTS_PER_BROWSER_HOUR = 10;

/**
 * How many logins one network may try in an hour, whatever addresses they are for
 */
export const MAX_LOGIN_ATTEMPTS_PER_NETWORK_HOUR = 30;

/**
 * From which of an address's login tries in an hour a browser that hasn't logged in to the account needs
 * a check: tries that went through before it, not those refused for want of one
 */
export const LOGIN_CHECK_FROM_ADDRESS_ATTEMPT = 5;

/**
 * From which of a network's login tries in an hour a browser that hasn't logged in to the account needs
 * a check
 */
export const LOGIN_CHECK_FROM_NETWORK_ATTEMPT = 15;

/**
 * How many more login tries an address may have in an hour past MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR,
 * each with a passed check
 */
export const MAX_CHECKED_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR = 10;

/**
 * From which code sent to an address in an hour sending one needs a check
 */
export const CODE_CHECK_FROM_ADDRESS_SEND = 3;

/**
 * From which code asked for from a network in an hour sending one needs a check
 */
export const CODE_CHECK_FROM_NETWORK_REQUEST = 5;

/**
 * How many more codes may be sent to an address in an hour past MAX_EMAIL_CODES_PER_ADDRESS_HOUR, each
 * with a passed check
 */
export const MAX_CHECKED_CODES_PER_ADDRESS_HOUR = 5;

/**
 * How many codes may be sent to an address in a day while MAX_WRONG_GUESSES_PER_ADDRESS_DAY wrong
 * guesses block its codes, each with a passed check. A code ends after MAX_WRONG_GUESSES_PER_CODE wrong
 * guesses, so these allow at most 15 more
 */
export const MAX_CHECKED_CODES_PER_BLOCKED_ADDRESS_DAY = 3;

/**
 * Whether checks can be asked for, and how this request stands
 */
export interface BotCheckState
{
	/**
	 * Whether checks are on: Turnstile's keys are set and the server can reach Cloudflare. While they
	 * aren't, nothing is checked, and requests past the hard limits are refused as without checks
	 */
	available: boolean;

	/**
	 * Whether the request sent a token Cloudflare said is a passed check, made for this request's action
	 * on this site
	 */
	passed: boolean;

	/**
	 * Whether the admin setting checks every request this decision covers (the browsers that have logged
	 * in to the account and logged-in players' password dialogs are left out by the callers)
	 */
	checkEveryRequest: boolean;
}

/**
 * What to do with a request a check may be needed for
 *
 * - 'allow': take it, counting it against the network and the address (or the known browser)
 * - 'allowChecked': take it, past the address's hard limit with a passed check, counting it against the
 *   network and the limits for checked requests, not the address's own
 * - 'checkNeeded': refuse it until a check is passed, counting it against the network only
 * - 'refused': refuse it, counting it against nothing, until retryAt
 */
export type BotCheckDecision =
	| { kind: 'allow' }
	| { kind: 'allowChecked' }
	| { kind: 'checkNeeded' }
	| { kind: 'refused'; retryAt: Date };

/**
 * The attempts a password's limits count, each list in the past hour
 */
export interface LoginAttempts
{
	/**
	 * The network's tries, including those refused for want of a check
	 */
	network: readonly Date[];

	/**
	 * The address's tries that went through, or the known browser's when the browser has logged in to
	 * the account; null when the account has no address (a logged-in account logging in only with Google
	 * or Discord), which leaves only the network's limits
	 */
	address: readonly Date[] | null;

	/**
	 * The address's tries past its hard limit with a passed check
	 */
	checked: readonly Date[];
}

/**
 * Where a password was given
 *
 * - 'login': logging in, from a browser that hasn't logged in to the account
 * - 'knownBrowser': logging in, from a browser that has logged in to the account, which is never asked
 *   for a check and counts its own tries in place of the address's
 * - 'password': a logged-in account's password given again, which the admin setting doesn't cover
 */
export type PasswordSource = 'login' | 'knownBrowser' | 'password';

/**
 * Whether a list of attempts in a window has reached a count
 *
 * @param attemptsAt When each attempt was made
 * @param count The count
 * @param windowMs The window
 * @param now The time now
 * @return Whether it has
 */
function reached(attemptsAt: readonly Date[], count: number, windowMs: number, now: Date): boolean
{
	return(!decideLimit(attemptsAt, count, windowMs, now).allowed);
}

/**
 * When a refused limit lets requests through again
 *
 * @param decision The limit's decision, refused
 * @return When
 */
function retryOf(decision: SendDecision): Date
{
	return(decision.allowed ? new Date(0) : decision.retryAt);
}

/**
 * Decides whether a password may be checked: at login, or given again by a logged-in account
 *
 * @param source Where the password was given
 * @param attempts The attempts its limits count
 * @param check Whether checks are on and this request passed one
 * @param now The time now
 * @return What to do
 */
export function decidePasswordAttempt(source: PasswordSource, attempts: LoginAttempts, check: BotCheckState, now: Date): BotCheckDecision
{
	const network = decideLimit(attempts.network, MAX_LOGIN_ATTEMPTS_PER_NETWORK_HOUR, HOUR_MS, now);

	if (!network.allowed)
	{
		return({
			kind: 'refused',
			retryAt: network.retryAt
		});
	}

	if (source === 'knownBrowser')
	{
		const browser = decideLimit((attempts.address ?? []), MAX_LOGIN_ATTEMPTS_PER_BROWSER_HOUR, HOUR_MS, now);

		return((browser.allowed ? { kind: 'allow' } : { kind: 'refused', retryAt: browser.retryAt }));
	}

	const address = ((attempts.address === null) ? { allowed: true as const } : decideLimit(attempts.address, MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR, HOUR_MS, now));

	if (address.allowed)
	{
		const suspicious = (((source === 'login') && check.checkEveryRequest)
			|| reached(attempts.network, (LOGIN_CHECK_FROM_NETWORK_ATTEMPT - 1), HOUR_MS, now)
			|| ((attempts.address !== null) && reached(attempts.address, (LOGIN_CHECK_FROM_ADDRESS_ATTEMPT - 1), HOUR_MS, now)));

		return(((check.available && suspicious && !check.passed) ? { kind: 'checkNeeded' } : { kind: 'allow' }));
	}

	const checked = decideLimit(attempts.checked, MAX_CHECKED_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR, HOUR_MS, now);

	if (!check.available || !checked.allowed)
	{
		// Whichever window frees up first lets a try through again: the address's own, or with a check
		const retryAt = ((check.available && (retryOf(checked) < address.retryAt)) ? retryOf(checked) : address.retryAt);

		return({
			kind: 'refused',
			retryAt
		});
	}

	return((check.passed ? { kind: 'allowChecked' } : { kind: 'checkNeeded' }));
}

/**
 * The attempts the limits on sending a code to an address count
 */
export interface CodeSendAttempts
{
	/**
	 * The codes asked for from the network in the past hour, including those refused for want of a check
	 */
	network: readonly Date[];

	/**
	 * The codes sent to the address in the past hour within its own limit
	 */
	sent: readonly Date[];

	/**
	 * The address's wrong guesses in the past day
	 */
	wrongGuesses: readonly Date[];

	/**
	 * The codes sent to the address in the past hour past its hourly limit, each with a passed check
	 */
	checkedSent: readonly Date[];

	/**
	 * The codes sent to the address in the past day while its wrong guesses blocked its codes, each with
	 * a passed check
	 */
	checkedWhileBlocked: readonly Date[];
}

/**
 * What to do with a request to send a code. 'allowChecked' names which checked limits it counts against:
 * the hourly one when it is past the address's hourly limit, the daily one when wrong guesses block the
 * address's codes, or both
 */
export type CodeSendDecision =
	| { kind: 'allow' }
	| { kind: 'allowChecked'; pastHourly: boolean; whileBlocked: boolean }
	| { kind: 'checkNeeded' }
	| { kind: 'refused'; retryAt: Date };

/**
 * Decides whether a code may be sent to an address (see Email codes in STRUCTURE-OVERVIEW.md): the
 * network's limit, at most one every EMAIL_CODE_RESEND_MS, MAX_EMAIL_CODES_PER_ADDRESS_HOUR an hour, and
 * none while MAX_WRONG_GUESSES_PER_ADDRESS_DAY wrong guesses in a day block the address's codes; with a
 * check past the soft limits, and a few more with a check each past the address's limits
 *
 * @param attempts The attempts the limits count
 * @param check Whether checks are on and this request passed one. A dormant account's login code is
 * never checked on its own: pass checks that aren't available, which decides as without checks
 * @param now The time now
 * @return What to do
 */
export function decideCodeSend(attempts: CodeSendAttempts, check: BotCheckState, now: Date): CodeSendDecision
{
	const network = decideLimit(attempts.network, MAX_EMAIL_CODES_PER_NETWORK_HOUR, HOUR_MS, now);

	if (!network.allowed)
	{
		return({
			kind: 'refused',
			retryAt: network.retryAt
		});
	}

	// Still one code a minute, however it was sent
	const lastSent = Math.max(0, ...[...attempts.sent, ...attempts.checkedSent].map((time) => time.getTime()));

	if ((now.getTime() - lastSent) < EMAIL_CODE_RESEND_MS)
	{
		return({
			kind: 'refused',
			retryAt: new Date(lastSent + EMAIL_CODE_RESEND_MS)
		});
	}

	const hourly = decideLimit(attempts.sent, MAX_EMAIL_CODES_PER_ADDRESS_HOUR, HOUR_MS, now);
	const blocked = decideLimit(attempts.wrongGuesses, MAX_WRONG_GUESSES_PER_ADDRESS_DAY, DAY_MS, now);

	if (hourly.allowed && blocked.allowed)
	{
		const suspicious = (check.checkEveryRequest
			|| reached(attempts.network, (CODE_CHECK_FROM_NETWORK_REQUEST - 1), HOUR_MS, now)
			|| reached(attempts.sent, (CODE_CHECK_FROM_ADDRESS_SEND - 1), HOUR_MS, now));

		return(((check.available && suspicious && !check.passed) ? { kind: 'checkNeeded' } : { kind: 'allow' }));
	}

	// Each limit the address has reached must allow a checked code; each frees up when either its own
	// window or its checked one does, and the request waits for the last of them
	const pastHourly = !hourly.allowed;
	const whileBlocked = !blocked.allowed;
	const checkedHourly = (pastHourly ? decideLimit(attempts.checkedSent, MAX_CHECKED_CODES_PER_ADDRESS_HOUR, HOUR_MS, now) : { allowed: true as const });
	const checkedBlocked = (whileBlocked ? decideLimit(attempts.checkedWhileBlocked, MAX_CHECKED_CODES_PER_BLOCKED_ADDRESS_DAY, DAY_MS, now) : { allowed: true as const });

	if (!check.available || !checkedHourly.allowed || !checkedBlocked.allowed)
	{
		const waits: number[] = [];

		for (const [own, checked] of [[hourly, checkedHourly], [blocked, checkedBlocked]] as const)
		{
			if (!own.allowed && (!check.available || !checked.allowed))
			{
				waits.push(Math.min(own.retryAt.getTime(), (check.available ? retryOf(checked).getTime() : Infinity)));
			}
		}

		return({
			kind: 'refused',
			retryAt: new Date(Math.max(...waits))
		});
	}

	if (!check.passed)
	{
		return({ kind: 'checkNeeded' });
	}

	return({
		kind: 'allowChecked',
		pastHourly,
		whileBlocked
	});
}
