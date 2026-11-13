import assert from 'assert';

import { CODE_CHECK_FROM_ADDRESS_SEND, CODE_CHECK_FROM_NETWORK_REQUEST, decideCodeSend, decidePasswordAttempt, LOGIN_CHECK_FROM_ADDRESS_ATTEMPT, LOGIN_CHECK_FROM_NETWORK_ATTEMPT, MAX_CHECKED_CODES_PER_ADDRESS_HOUR, MAX_CHECKED_CODES_PER_BLOCKED_ADDRESS_DAY, MAX_CHECKED_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR, MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR, MAX_LOGIN_ATTEMPTS_PER_BROWSER_HOUR, MAX_LOGIN_ATTEMPTS_PER_NETWORK_HOUR, type BotCheckState, type CodeSendAttempts, type LoginAttempts } from '../../src/logic/botChecks.js';
import { DAY_MS, HOUR_MS, MAX_EMAIL_CODES_PER_ADDRESS_HOUR, MAX_EMAIL_CODES_PER_NETWORK_HOUR, MAX_WRONG_GUESSES_PER_ADDRESS_DAY } from '../../src/logic/emailCodes.js';

const NOW = new Date('2026-11-13T12:00:00Z');

/**
 * Checks that are on, with no check passed
 */
const ON: BotCheckState = {
	available: true,
	passed: false,
	checkEveryRequest: false
};

/**
 * Checks that are on, with a check passed
 */
const PASSED: BotCheckState = {
	...ON,
	passed: true
};

/**
 * Checks that aren't configured, or Cloudflare can't be reached
 */
const OFF: BotCheckState = {
	available: false,
	passed: false,
	checkEveryRequest: false
};

/**
 * Some attempts, a few minutes apart, the latest 'latestAgoMs' before NOW
 *
 * @param count How many
 * @param latestAgoMs How long before NOW the latest was made
 * @param spacingMs How far apart they are
 * @return Their times, oldest first
 */
function attempts(count: number, latestAgoMs = (5 * 60 * 1000), spacingMs = (60 * 1000)): Date[]
{
	return(Array.from({ length: count }, (_, index) => new Date(NOW.getTime() - latestAgoMs - ((count - 1 - index) * spacingMs))));
}

/**
 * A password's attempts
 *
 * @param counts How many of each, in the past hour
 * @return The attempts
 */
function logins(counts: { network?: number; address?: number | null; checked?: number }): LoginAttempts
{
	return({
		network: attempts(counts.network ?? (counts.address ?? 0)),
		address: ((counts.address === null) ? null : attempts(counts.address ?? 0)),
		checked: attempts(counts.checked ?? 0)
	});
}

/**
 * A code send's attempts
 *
 * @param counts How many of each, in their windows
 * @return The attempts
 */
function codes(counts: Partial<Record<keyof CodeSendAttempts, number>>): CodeSendAttempts
{
	return({
		network: attempts(counts.network ?? (counts.sent ?? 0)),
		sent: attempts(counts.sent ?? 0),
		wrongGuesses: attempts(counts.wrongGuesses ?? 0),
		checkedSent: attempts(counts.checkedSent ?? 0),
		checkedWhileBlocked: attempts(counts.checkedWhileBlocked ?? 0)
	});
}

describe('botChecks', () =>
{
	describe('decidePasswordAttempt', () =>
	{
		it('lets logins below the soft limits through without a check', () =>
		{
			assert.deepStrictEqual(decidePasswordAttempt('login', logins({}), ON, NOW), { kind: 'allow' });
			assert.deepStrictEqual(decidePasswordAttempt('login', logins({ address: LOGIN_CHECK_FROM_ADDRESS_ATTEMPT - 2 }), ON, NOW), { kind: 'allow' });
		});

		it('asks for a check from the address\'s 5th try in an hour, and takes it with one', () =>
		{
			const counts = logins({ address: LOGIN_CHECK_FROM_ADDRESS_ATTEMPT - 1 });

			assert.strictEqual(LOGIN_CHECK_FROM_ADDRESS_ATTEMPT, 5);
			assert.deepStrictEqual(decidePasswordAttempt('login', counts, ON, NOW), { kind: 'checkNeeded' });
			assert.deepStrictEqual(decidePasswordAttempt('login', counts, PASSED, NOW), { kind: 'allow' });
		});

		it('asks for a check from the network\'s 15th try in an hour, whatever the address', () =>
		{
			assert.strictEqual(LOGIN_CHECK_FROM_NETWORK_ATTEMPT, 15);
			assert.deepStrictEqual(decidePasswordAttempt('login', logins({ network: LOGIN_CHECK_FROM_NETWORK_ATTEMPT - 2 }), ON, NOW), { kind: 'allow' });
			assert.deepStrictEqual(decidePasswordAttempt('login', logins({ network: LOGIN_CHECK_FROM_NETWORK_ATTEMPT - 1 }), ON, NOW), { kind: 'checkNeeded' });
		});

		it('only counts tries within the hour', () =>
		{
			const counts: LoginAttempts = {
				network: attempts(20, HOUR_MS),
				address: attempts(MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR, HOUR_MS),
				checked: []
			};

			assert.deepStrictEqual(decidePasswordAttempt('login', counts, ON, NOW), { kind: 'allow' });
		});

		it('asks nothing while checks are off, and refuses at the hard limits as without them', () =>
		{
			assert.deepStrictEqual(decidePasswordAttempt('login', logins({ address: MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR - 1 }), OFF, NOW), { kind: 'allow' });

			const refused = decidePasswordAttempt('login', logins({ address: MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR }), OFF, NOW);

			assert.strictEqual(refused.kind, 'refused');
		});

		it('lets a try with a passed check through past the address\'s hard limit, up to its own limit', () =>
		{
			const full = logins({ address: MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR });

			assert.deepStrictEqual(decidePasswordAttempt('login', full, ON, NOW), { kind: 'checkNeeded' });
			assert.deepStrictEqual(decidePasswordAttempt('login', full, PASSED, NOW), { kind: 'allowChecked' });

			const checkedFull = logins({
				address: MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR,
				checked: MAX_CHECKED_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR
			});

			assert.strictEqual(decidePasswordAttempt('login', checkedFull, PASSED, NOW).kind, 'refused');
		});

		it('says to try again when the address\'s own window or its checked one frees up, whichever is first', () =>
		{
			const counts: LoginAttempts = {
				network: [],
				address: attempts(MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR, (10 * 60 * 1000)),
				checked: attempts(MAX_CHECKED_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR, (50 * 60 * 1000))
			};

			// The oldest checked try is 59 minutes old; the oldest of the address's own is 19
			assert.deepStrictEqual(decidePasswordAttempt('login', counts, PASSED, NOW), {
				kind: 'refused',
				retryAt: new Date(counts.checked[0].getTime() + HOUR_MS)
			});
			assert.deepStrictEqual(decidePasswordAttempt('login', counts, OFF, NOW), {
				kind: 'refused',
				retryAt: new Date(counts.address![0].getTime() + HOUR_MS)
			});
		});

		it('never loosens the network\'s limit', () =>
		{
			const decision = decidePasswordAttempt('login', logins({ network: MAX_LOGIN_ATTEMPTS_PER_NETWORK_HOUR }), PASSED, NOW);

			assert.strictEqual(decision.kind, 'refused');
			assert.strictEqual(decidePasswordAttempt('knownBrowser', logins({ network: MAX_LOGIN_ATTEMPTS_PER_NETWORK_HOUR, address: 0 }), ON, NOW).kind, 'refused');
		});

		it('never asks a browser that has logged in to the account, past either soft limit, nor lets it past its own limit', () =>
		{
			const busy = logins({
				network: MAX_LOGIN_ATTEMPTS_PER_NETWORK_HOUR - 1,
				address: MAX_LOGIN_ATTEMPTS_PER_BROWSER_HOUR - 1
			});

			assert.deepStrictEqual(decidePasswordAttempt('knownBrowser', busy, {
				...ON,
				checkEveryRequest: true
			}, NOW), { kind: 'allow' });
			assert.strictEqual(decidePasswordAttempt('knownBrowser', logins({ address: MAX_LOGIN_ATTEMPTS_PER_BROWSER_HOUR }), PASSED, NOW).kind, 'refused');
		});

		it('asks for a check at every login when the admin setting is on, but not for a logged-in player\'s password', () =>
		{
			const everyRequest = {
				...ON,
				checkEveryRequest: true
			};

			assert.deepStrictEqual(decidePasswordAttempt('login', logins({}), everyRequest, NOW), { kind: 'checkNeeded' });
			assert.deepStrictEqual(decidePasswordAttempt('login', logins({}), {
				...everyRequest,
				passed: true
			}, NOW), { kind: 'allow' });
			assert.deepStrictEqual(decidePasswordAttempt('password', logins({}), everyRequest, NOW), { kind: 'allow' });
		});

		it('asks a logged-in player for a check once others\' guesses pass the address\'s soft limit', () =>
		{
			assert.deepStrictEqual(decidePasswordAttempt('password', logins({ address: LOGIN_CHECK_FROM_ADDRESS_ATTEMPT - 1 }), ON, NOW), { kind: 'checkNeeded' });
			assert.deepStrictEqual(decidePasswordAttempt('password', logins({ address: MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR }), PASSED, NOW), { kind: 'allowChecked' });
		});

		it('limits an account without an address by its network alone', () =>
		{
			assert.deepStrictEqual(decidePasswordAttempt('password', logins({
				network: 3,
				address: null
			}), ON, NOW), { kind: 'allow' });
			assert.deepStrictEqual(decidePasswordAttempt('password', logins({
				network: LOGIN_CHECK_FROM_NETWORK_ATTEMPT - 1,
				address: null
			}), ON, NOW), { kind: 'checkNeeded' });
		});
	});

	describe('decideCodeSend', () =>
	{
		it('sends the first code without a check', () =>
		{
			assert.deepStrictEqual(decideCodeSend(codes({}), ON, NOW), { kind: 'allow' });
		});

		it('asks for a check from the address\'s 3rd code in an hour, and sends it with one', () =>
		{
			assert.strictEqual(CODE_CHECK_FROM_ADDRESS_SEND, 3);
			assert.deepStrictEqual(decideCodeSend(codes({ sent: CODE_CHECK_FROM_ADDRESS_SEND - 2 }), ON, NOW), { kind: 'allow' });
			assert.deepStrictEqual(decideCodeSend(codes({ sent: CODE_CHECK_FROM_ADDRESS_SEND - 1 }), ON, NOW), { kind: 'checkNeeded' });
			assert.deepStrictEqual(decideCodeSend(codes({ sent: CODE_CHECK_FROM_ADDRESS_SEND - 1 }), PASSED, NOW), { kind: 'allow' });
		});

		it('asks for a check from the network\'s 5th request in an hour', () =>
		{
			assert.strictEqual(CODE_CHECK_FROM_NETWORK_REQUEST, 5);
			assert.deepStrictEqual(decideCodeSend(codes({ network: CODE_CHECK_FROM_NETWORK_REQUEST - 2 }), ON, NOW), { kind: 'allow' });
			assert.deepStrictEqual(decideCodeSend(codes({ network: CODE_CHECK_FROM_NETWORK_REQUEST - 1 }), ON, NOW), { kind: 'checkNeeded' });
		});

		it('asks for a check for every code when the admin setting is on', () =>
		{
			assert.deepStrictEqual(decideCodeSend(codes({}), {
				...ON,
				checkEveryRequest: true
			}, NOW), { kind: 'checkNeeded' });
		});

		it('waits 60 seconds between codes, with a check or without', () =>
		{
			const recent: CodeSendAttempts = {
				...codes({}),
				checkedSent: [new Date(NOW.getTime() - 30000)]
			};

			assert.deepStrictEqual(decideCodeSend(recent, PASSED, NOW), {
				kind: 'refused',
				retryAt: new Date(NOW.getTime() + 30000)
			});
			assert.deepStrictEqual(decideCodeSend({
				...codes({}),
				sent: [new Date(NOW.getTime() - 60000)]
			}, ON, NOW), { kind: 'allow' });
		});

		it('refuses the address\'s 6th code in an hour while checks are off, until the oldest is an hour old', () =>
		{
			const counts = codes({ sent: MAX_EMAIL_CODES_PER_ADDRESS_HOUR });

			assert.deepStrictEqual(decideCodeSend(counts, OFF, NOW), {
				kind: 'refused',
				retryAt: new Date(counts.sent[0].getTime() + HOUR_MS)
			});
		});

		it('sends up to 5 more codes an hour past the address\'s limit, each with a check', () =>
		{
			assert.deepStrictEqual(decideCodeSend(codes({ sent: MAX_EMAIL_CODES_PER_ADDRESS_HOUR }), ON, NOW), { kind: 'checkNeeded' });
			assert.deepStrictEqual(decideCodeSend(codes({ sent: MAX_EMAIL_CODES_PER_ADDRESS_HOUR }), PASSED, NOW), {
				kind: 'allowChecked',
				pastHourly: true,
				whileBlocked: false
			});
			assert.strictEqual(decideCodeSend(codes({
				sent: MAX_EMAIL_CODES_PER_ADDRESS_HOUR,
				checkedSent: MAX_CHECKED_CODES_PER_ADDRESS_HOUR
			}), PASSED, NOW).kind, 'refused');
		});

		it('sends up to 3 more codes a day while wrong guesses block the address\'s codes, each with a check', () =>
		{
			const blocked = codes({ wrongGuesses: MAX_WRONG_GUESSES_PER_ADDRESS_DAY });

			assert.deepStrictEqual(decideCodeSend(blocked, OFF, NOW), {
				kind: 'refused',
				retryAt: new Date(blocked.wrongGuesses[0].getTime() + DAY_MS)
			});
			assert.deepStrictEqual(decideCodeSend(blocked, ON, NOW), { kind: 'checkNeeded' });
			assert.deepStrictEqual(decideCodeSend(blocked, PASSED, NOW), {
				kind: 'allowChecked',
				pastHourly: false,
				whileBlocked: true
			});

			const used = codes({
				wrongGuesses: MAX_WRONG_GUESSES_PER_ADDRESS_DAY,
				checkedWhileBlocked: MAX_CHECKED_CODES_PER_BLOCKED_ADDRESS_DAY
			});

			assert.deepStrictEqual(decideCodeSend(used, PASSED, NOW), {
				kind: 'refused',
				retryAt: new Date(Math.min(used.wrongGuesses[0].getTime(), used.checkedWhileBlocked[0].getTime()) + DAY_MS)
			});
		});

		it('needs both limits\' checked codes when the address is past both', () =>
		{
			const both = codes({
				sent: MAX_EMAIL_CODES_PER_ADDRESS_HOUR,
				wrongGuesses: MAX_WRONG_GUESSES_PER_ADDRESS_DAY
			});

			assert.deepStrictEqual(decideCodeSend(both, PASSED, NOW), {
				kind: 'allowChecked',
				pastHourly: true,
				whileBlocked: true
			});
			assert.strictEqual(decideCodeSend({
				...both,
				checkedWhileBlocked: attempts(MAX_CHECKED_CODES_PER_BLOCKED_ADDRESS_DAY)
			}, PASSED, NOW).kind, 'refused');
		});

		it('never loosens the network\'s limit', () =>
		{
			assert.strictEqual(decideCodeSend(codes({ network: MAX_EMAIL_CODES_PER_NETWORK_HOUR }), PASSED, NOW).kind, 'refused');
		});

		it('ignores codes and guesses outside their windows', () =>
		{
			assert.deepStrictEqual(decideCodeSend({
				network: attempts(MAX_EMAIL_CODES_PER_NETWORK_HOUR, HOUR_MS),
				sent: attempts(MAX_EMAIL_CODES_PER_ADDRESS_HOUR, HOUR_MS),
				wrongGuesses: attempts(MAX_WRONG_GUESSES_PER_ADDRESS_DAY, DAY_MS),
				checkedSent: [],
				checkedWhileBlocked: []
			}, ON, NOW), { kind: 'allow' });
		});
	});
});
