/**
 * Bot checks in the auth routes (see Bot checks in STRUCTURE-OVERVIEW.md): reading and verifying the
 * token a request sends, asking for a check, and recording what became of each as auth events
 *
 * A token is verified with Cloudflare before the transaction that counts the attempt opens, so a network
 * call never holds a transaction open; the transaction then decides, under the same locks as the counts,
 * whether a check was needed (takePasswordAttempt() and takeCodeSend() in rateLimits.ts)
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
	 * What became of the token the request sent, or undefined when it sent none or checks are off
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
 * Reads and verifies the token a request sent, if any, and whether checks are on. Call it before the
 * transaction that counts the attempt
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
			tokenOutcome: undefined
		});
	}

	const token = botCheckTokenOf(request);
	const tokenOutcome = ((token === undefined) ? undefined : await verifier.verify(token, action, now));
	const available = verifier.available(now);

	return({
		action,
		state: {
			available,
			passed: (tokenOutcome === 'passed'),
			checkEveryRequest: (available && coveredByEveryRequest && (await findSiteSettings()).botCheckEveryRequest)
		},
		tokenOutcome
	});
}

/**
 * Makes sure Cloudflare can still be reached before a browser is asked for a check, when the server
 * hasn't heard from it for a while: during an outage no browser could pass one, so checks are turned off
 * instead. Only asks Cloudflare when the attempt would need a check, which wouldNeedCheck() finds out by
 * looking at the counts without taking the attempt
 *
 * @param check The request's check, whose state is updated
 * @param wouldNeedCheck Whether the attempt would need a check, as things stand
 * @param now The time now
 */
export async function confirmBotChecks(check: RequestBotCheck, wouldNeedCheck: () => Promise<boolean>, now: Date): Promise<void>
{
	const verifier = botCheckVerifier();

	if (!check.state.available || check.state.passed || verifier.reachedRecently(now) || !(await wouldNeedCheck()))
	{
		return;
	}

	check.state.available = await verifier.confirmAvailable(now);

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

	await confirmBotChecks(check, async () => ((await takePasswordAttempt(subjects, check.state, now, undefined)).kind === 'checkNeeded'), now);

	return(await inTransaction(async (executor): Promise<AuthRefusal | undefined> =>
	{
		const decision = await takePasswordAttempt(subjects, check.state, now, executor);
		const asked = (decision.kind === 'checkNeeded');

		if (asked || (check.tokenOutcome === 'passed') || (check.tokenOutcome === 'failed'))
		{
			await recordBotCheckEvents(request, check, asked, ((typeof account === 'function') ? await account(executor) : account), now, executor);
		}

		if (decision.kind === 'refused')
		{
			return(tooManyAttempts(decision, now, response));
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
