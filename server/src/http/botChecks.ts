/**
 * Bot checks in the auth routes (see Bot checks in STRUCTURE-OVERVIEW.md): reading and verifying the
 * token a request sends, asking for a check, and recording what became of each as auth events
 *
 * Each attempt is decided twice (takePasswordAttempt() and takeCodeSend() in rateLimits.ts): first
 * without a transaction, from the counts as they stand, to find whether it would need a check, and then in
 * the transaction that counts it, under the same locks as the counts. A token is verified with Cloudflare
 * between the two, only when the first decision needs a check, so a network call never holds a transaction
 * open, and the limits bound how often the server calls Cloudflare: a request they refuse, or one that
 * needs no check, never sends its token there. The transaction's decision is the one that counts, so when
 * the counts change between the two and it finds a check needed after all, a request whose token wasn't
 * verified is asked for a check again
 */
import type { Request, Response } from 'express';
import { BOT_CHECK_MESSAGES, MAX_BOT_CHECK_TOKEN_LENGTH, type BotCheckAction } from '@multiverse-kiln/shared';

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
	 * attempt didn't need a check (settleBotCheck())
	 */
	tokenOutcome: TokenOutcome | undefined;
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
 * settleBotCheck(), only when the attempt needs a check
 *
 * @param request The request
 * @param action The action the request's checks are made for
 * @param coveredByEveryRequest Whether the admin setting that checks every request covers this one: not
 * for browsers that have logged in to the account, or logged-in players' password dialogs
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
			tokenOutcome: undefined
		});
	}

	const available = verifier.available(now);

	return({
		action,
		state: {
			available,
			passed: false,
			checkEveryRequest: (available && coveredByEveryRequest && (await findSiteSettings()).botCheckEveryRequest)
		},
		token: botCheckTokenOf(request),
		tokenOutcome: undefined
	});
}

/**
 * Asks Cloudflare what it needs to before the transaction that counts the attempt, only when the attempt
 * would need a check, which wouldNeedCheck() finds out by looking at the counts without taking the
 * attempt. A token the request sent is verified then, and only then. Without one, it makes sure
 * Cloudflare can still be reached before a browser is asked for a check, when the server hasn't heard
 * from it for a while: during an outage no browser could pass one, so checks are turned off instead
 *
 * @param check The request's check (readBotCheck()), whose state and token outcome are updated
 * @param wouldNeedCheck Whether the attempt would need a check without a passed one, as things stand
 * @param now The time now
 */
export async function settleBotCheck(check: RequestBotCheck, wouldNeedCheck: () => Promise<boolean>, now: Date): Promise<void>
{
	const verifier = botCheckVerifier();

	if (!check.state.available || ((check.token === undefined) && verifier.reachedRecently(now)) || !(await wouldNeedCheck()))
	{
		return;
	}

	if (check.token === undefined)
	{
		check.state.available = await verifier.confirmAvailable(now);
	}
	else
	{
		check.tokenOutcome = await verifier.verify(check.token, check.action, now);
		check.state.passed = (check.tokenOutcome === 'passed');
		check.state.available = verifier.available(now);
	}

	if (!check.state.available)
	{
		check.state.checkEveryRequest = false;
	}
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
		await settleBotCheck(check, async () => ((await takePasswordAttempt(subjects, check.state, now, undefined)).kind === 'checkNeeded'), now);
	}

	return(await inTransaction(async (executor): Promise<AuthRefusal | undefined> =>
	{
		const decision = await takePasswordAttempt(subjects, check.state, now, executor);

		// A refused try records no events, so the limits bound how many a network can add
		if (decision.kind === 'refused')
		{
			return(tooManyAttempts(decision, now, response));
		}

		const asked = (decision.kind === 'checkNeeded');

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
