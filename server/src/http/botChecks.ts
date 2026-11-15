/**
 * Bot checks in the auth routes (see Bot checks in STRUCTURE-OVERVIEW.md): reading and verifying the
 * token a request sends, asking for a check, and recording what became of each as auth events
 *
 * Each attempt is decided in the transaction that counts it, under the same locks as the counts
 * (takePasswordAttempt() and takeCodeSend() in rateLimits.ts), and Cloudflare is never called while a
 * transaction is open. An attempt that sends a token is first decided without a transaction too, from the
 * counts as they stand, and its token is verified with Cloudflare only when that decision needs a check,
 * so the limits bound how often the server calls Cloudflare: a request they refuse, or one that needs no
 * check, never sends its token there. Tokens only come from browsers that were asked for a check, so
 * other attempts are decided once. The transaction's decision is the one that counts, so when the counts
 * change between the two and it finds a check needed after all, a request whose token wasn't verified is
 * asked for a check again
 *
 * Before a browser is asked for a check, the server makes sure it can still reach Cloudflare when it
 * hasn't heard from it for a while: the transaction rolls back, Cloudflare is called with no transaction
 * open, and the attempt is decided again in a new one (inBotCheckTransaction()). During an outage no
 * browser could pass a check, so that attempt is decided with checks off
 */
import type { Request, Response } from 'express';
import { BOT_CHECK_MESSAGES, MAX_BOT_CHECK_TOKEN_LENGTH, type BotCheckAction } from '@multiverse-kiln/shared';

import { isDevSuspicious } from '../auth/devSuspicious.js';
import { hashAddress } from '../auth/keyedHashes.js';
import { takePasswordAttempt, type PasswordAttemptSubjects } from '../auth/rateLimits.js';
import { botCheckVerifier, type TokenOutcome } from '../auth/turnstile.js';
import type { Executor } from '../db/client.js';
import { findSiteSettings } from '../db/siteSettingsRepo.js';
import { inTransaction } from '../db/transactions.js';
import type { BotCheckState, PasswordSource } from '../logic/botChecks.js';
import { recordEvent, tooManyAttempts, type AuthRefusal } from './authCommon.js';
import { clientNetworkHash } from './clientNetwork.js';

/**
 * What a request's bot check came to, before its attempt is counted
 */
export interface RequestBotCheck
{
	action: BotCheckAction;

	/**
	 * What the decision about the attempt takes
	 */
	state: BotCheckState;

	/**
	 * The token the request sent, or undefined when it sent none or checks aren't configured
	 */
	token: string | undefined;

	/**
	 * What became of the token, or undefined when it wasn't verified: none was sent, checks are off, or the
	 * attempt didn't need a check (verifyBotCheckToken())
	 */
	tokenOutcome: TokenOutcome | undefined;

	/**
	 * Whether Cloudflare was called for the request, verifying its token or making sure it can be reached,
	 * so a check can be asked for without calling it again
	 */
	cloudflareAsked: boolean;
}

/**
 * Thrown in a transaction whose decision needs a check before the server has made sure it can reach
 * Cloudflare, rolling back what the transaction counted (confirmBeforeAsking(), inBotCheckTransaction())
 */
class UnconfirmedBotCheck extends Error
{
	/**
	 * Makes the error
	 */
	constructor()
	{
		super('A bot check would be asked for before Cloudflare was found reachable');
	}
}

/**
 * The token a request sent, if one of a form Turnstile could have made
 *
 * @param request The request
 * @return The token, or undefined
 */
function botCheckTokenOf(request: Request): string | undefined
{
	const body: unknown = request.body;

	if ((typeof body !== 'object') || (body === null) || !('botCheckToken' in body))
	{
		return(undefined);
	}

	const token = body.botCheckToken;

	return((((typeof token === 'string') && (token.length > 0) && (token.length <= MAX_BOT_CHECK_TOKEN_LENGTH)) ? token : undefined));
}

/**
 * Reads the token a request sent, if any, and whether checks are on. The token is verified by
 * verifyBotCheckToken(), only when the attempt needs a check
 *
 * @param request The request
 * @param action The action the request's checks are made for
 * @param coveredByEveryRequest Whether the admin setting that checks every request covers this one: not
 * for browsers that have logged in to the account, or logged-in players' password dialogs. A browser
 * acting suspicious for testing (isDevSuspicious()) is checked as if the setting were on
 * @param now The time now
 * @return The check
 */
export async function readBotCheck(request: Request, action: BotCheckAction, coveredByEveryRequest: boolean, now: Date): Promise<RequestBotCheck>
{
	const verifier = botCheckVerifier();

	if (verifier.siteKey === undefined)
	{
		return({
			action,
			state: {
				available: false,
				passed: false,
				checkEveryRequest: false
			},
			token: undefined,
			tokenOutcome: undefined,
			cloudflareAsked: false
		});
	}

	const available = verifier.available(now);

	return({
		action,
		state: {
			available,
			passed: false,
			checkEveryRequest: (available && coveredByEveryRequest && (isDevSuspicious(request) || (await findSiteSettings()).botCheckEveryRequest))
		},
		token: botCheckTokenOf(request),
		tokenOutcome: undefined,
		cloudflareAsked: false
	});
}

/**
 * Verifies the token a request sent with Cloudflare before the transaction that counts the attempt, only
 * when the attempt would need a check, which wouldNeedCheck() finds out by looking at the counts without
 * taking the attempt. A request without a token is left to the transaction
 *
 * @param check The request's check (readBotCheck()), whose state and token outcome are updated
 * @param wouldNeedCheck Whether the attempt would need a check without a passed one, as things stand
 * @param now The time now
 */
export async function verifyBotCheckToken(check: RequestBotCheck, wouldNeedCheck: () => Promise<boolean>, now: Date): Promise<void>
{
	if (!check.state.available || (check.token === undefined) || !(await wouldNeedCheck()))
	{
		return;
	}

	const verifier = botCheckVerifier();

	check.tokenOutcome = await verifier.verify(check.token, check.action, now);
	check.cloudflareAsked = true;
	check.state.passed = (check.tokenOutcome === 'passed');
	check.state.available = verifier.available(now);

	if (!check.state.available)
	{
		check.state.checkEveryRequest = false;
	}
}

/**
 * Called in the transaction whose decision needs a check, before anything about it is recorded: when
 * Cloudflare wasn't called for the request and the server hasn't heard from it for a while, throws,
 * rolling the transaction back, so inBotCheckTransaction() can make sure it can be reached and decide
 * again
 *
 * @param check The request's check
 * @param now The time now
 * @throws UnconfirmedBotCheck when Cloudflare has to be reached first
 */
export function confirmBeforeAsking(check: RequestBotCheck, now: Date): void
{
	if (!check.cloudflareAsked && !botCheckVerifier().reachedRecently(now))
	{
		throw new UnconfirmedBotCheck();
	}
}

/**
 * Runs the transaction that counts a request's attempt. When its decision needs a check before the server
 * has made sure it can reach Cloudflare (confirmBeforeAsking()), the transaction rolls back, so nothing it
 * counted stays, Cloudflare is called with no transaction open, and work runs again in a new one: with
 * checks off when Cloudflare can't be reached, since during an outage no browser could pass one
 *
 * @param check The request's check, whose state is updated when Cloudflare is called
 * @param now The time now
 * @param work The transaction's calls, which call confirmBeforeAsking() before asking for a check
 * @return What work resolves with
 */
export async function inBotCheckTransaction<T>(check: RequestBotCheck, now: Date, work: (executor: Executor) => Promise<T>): Promise<T>
{
	try
	{
		return(await inTransaction(work));
	}
	catch (error)
	{
		if (!(error instanceof UnconfirmedBotCheck))
		{
			throw error;
		}
	}

	check.state.available = await botCheckVerifier().confirmAvailable(now);
	check.cloudflareAsked = true;

	if (!check.state.available)
	{
		check.state.checkEveryRequest = false;
	}

	return(await inTransaction(work));
}

/**
 * The refusal of a request that needs a passed check, carrying how to show one
 *
 * @param check The request's check
 * @return The refusal
 */
export function botCheckRefusal(check: RequestBotCheck): AuthRefusal<never>
{
	return({
		status: 403,
		message: BOT_CHECK_MESSAGES.needed,
		botCheck: {
			siteKey: (botCheckVerifier().siteKey ?? ''),
			action: check.action
		}
	});
}

/**
 * Records what became of a request's check as auth events: its token passed or failed, and whether a
 * check was asked for
 *
 * @param request The request
 * @param check The request's check
 * @param asked Whether the request was refused for want of a check
 * @param playerId The account, only when the address has one, as for failed logins
 * @param now The time now
 * @param executor The database, or a transaction
 */
export async function recordBotCheckEvents(request: Request, check: RequestBotCheck, asked: boolean, playerId: string | null, now: Date, executor?: Executor): Promise<void>
{
	if (check.tokenOutcome === 'passed')
	{
		await recordEvent(request, playerId, 'botCheckPassed', now, executor);
	}
	else if (check.tokenOutcome === 'failed')
	{
		await recordEvent(request, playerId, 'botCheckFailed', now, executor);
	}

	if (asked)
	{
		await recordEvent(request, playerId, 'botCheckAsked', now, executor);
	}
}

/**
 * The account a password is given for, when the address has one: known, or found when an event needs it
 */
export type AccountOf = string | null | ((executor: Executor) => Promise<string | null>);

/**
 * Takes a try at a password against the login limits (takePasswordAttempt()), with its bot check: a
 * login (action 'login') or a logged-in account's password given again (action 'password'). Call it
 * before checking the password, which is only checked once this lets it through
 *
 * @param request The request, which may carry a botCheckToken
 * @param response The response, which gets a Retry-After header when the try is refused
 * @param source Where the password was given
 * @param hashes The address's keyed hash, or null when the account has none, and for 'knownBrowser'
 * the browser's
 * @param account The account, for the bot check's auth events
 * @param now The time now
 * @return Why the try is refused, or undefined when the password may be checked
 */
export async function takePasswordTry(request: Request, response: Response, source: PasswordSource, hashes: Pick<PasswordAttemptSubjects, 'addressHash' | 'browserHash'>, account: AccountOf, now: Date): Promise<AuthRefusal | undefined>
{
	const check = await readBotCheck(request, ((source === 'password') ? 'password' : 'login'), (source === 'login'), now);
	const subjects: PasswordAttemptSubjects = {
		source,
		networkHash: clientNetworkHash(request),
		...hashes
	};

	// A browser that has logged in to the account is never asked for a check, so nothing is asked of Cloudflare
	if (source !== 'knownBrowser')
	{
		await verifyBotCheckToken(check, async () => ((await takePasswordAttempt(subjects, check.state, now, undefined)).kind === 'checkNeeded'), now);
	}

	return(await inBotCheckTransaction(check, now, async (executor): Promise<AuthRefusal | undefined> =>
	{
		const decision = await takePasswordAttempt(subjects, check.state, now, executor);

		// A refused try records no events, so the limits bound how many a network can add
		if (decision.kind === 'refused')
		{
			return(tooManyAttempts(decision, now, response));
		}

		const asked = (decision.kind === 'checkNeeded');

		if (asked)
		{
			confirmBeforeAsking(check, now);
		}

		if (asked || (check.tokenOutcome === 'passed') || (check.tokenOutcome === 'failed'))
		{
			await recordBotCheckEvents(request, check, asked, ((typeof account === 'function') ? await account(executor) : account), now, executor);
		}

		return((asked ? botCheckRefusal(check) : undefined));
	}));
}

/**
 * Takes a try at a logged-in account's password, given again to change it or its 2FA, delete it or a
 * universe, or link a login: it counts against the network's login limits and the account's address's, so
 * someone with a stolen session can't guess the password faster than logging in would let them, and
 * needs a bot check past their soft limits as a login would (action 'password')
 *
 * @param request The request, which may carry a botCheckToken
 * @param response The response, which gets a Retry-After header when the try is refused
 * @param playerId The account
 * @param email The account's address, or null when it has none
 * @param now The time now
 * @return Why the try is refused, or undefined when the password may be checked
 */
export async function takeAccountPasswordTry(request: Request, response: Response, playerId: string, email: string | null, now: Date): Promise<AuthRefusal | undefined>
{
	return(await takePasswordTry(request, response, 'password', { addressHash: ((email !== null) ? hashAddress(email) : null) }, ((email !== null) ? playerId : null), now));
}
