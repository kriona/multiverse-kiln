/**
 * 2FA (see Login in STRUCTURE-OVERVIEW.md), on the auth router: finishing a login with an authenticator
 * or recovery code, turning 2FA on and off from the profile, replacing recovery codes and trusted
 * browsers. Also the check the other auth routes make when an account with 2FA logs in, resets its
 * password or links a provider login (checkSecondFactor())
 *
 * Turning 2FA on is two requests: setup gives the logged-in player a new secret for their authenticator
 * app (only in the body of a POST answer, never in an address), and enable turns it on once the app
 * gives a right code, answering with the recovery codes. The server keeps the secret encrypted
 * (server/src/auth/totpSecrets.ts) and the recovery codes as keyed hashes
 */
import { randomBytes } from 'crypto';
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { AUTH_RECOVERY_CODES_PATH, AUTH_TRUSTED_BROWSERS_FORGET_PATH, AUTH_TWO_FACTOR_DISABLE_PATH, AUTH_TWO_FACTOR_ENABLE_PATH, AUTH_TWO_FACTOR_LOGIN_PATH, AUTH_TWO_FACTOR_SETUP_PATH, defineMessages, MAX_LOCALE_LENGTH, MAX_PASSWORD_LENGTH, MAX_TWO_FACTOR_CODE_INPUT_LENGTH, RECOVERY_CODE_COUNT, SITE_NAME, TRUSTED_BROWSER_DAYS, type RecoveryCodesPayload, type RecoveryCodesRequest, type TwoFactorDisableRequest, type TwoFactorEnableRequest, type TwoFactorLoginRequest, type TwoFactorSetupPayload, type TwoFactorSetupRequest } from '@multiverse-kiln/shared';

import { keyedHash } from '../auth/keyedHashes.js';
import { checkLoginPassword } from '../auth/passwords.js';
import { MAX_LOGIN_ATTEMPTS_PER_NETWORK_HOUR, takeAttempt } from '../auth/rateLimits.js';
import { resolveSession, startSession, type SessionIdentity } from '../auth/sessions.js';
import { createToken, hashToken, isTokenForm } from '../auth/tokens.js';
import { decryptTotpSecret, encryptTotpSecret } from '../auth/totpSecrets.js';
import type { Executor } from '../db/client.js';
import { findPasswordHash, findPlayerEmail } from '../db/playerRepo.js';
import { countRecoveryCodes, deletePendingTwoFactorLogin, deleteTrustedBrowsers, deleteTwoFactor, enableAuthenticator, hasTwoFactor, isBrowserTrusted, lockAuthenticator, lockPendingTwoFactorLogin, recordWrongTwoFactorGuess, replaceRecoveryCodes, saveAuthenticatorSetup, saveLastUsedStep, trustBrowser, useRecoveryCode } from '../db/twoFactorRepo.js';
import { inTransaction } from '../db/transactions.js';
import { recoveryCodeUsedEmail, twoFactorDisabledEmail, twoFactorEnabledEmail } from '../email/authEmails.js';
import { sendEmailInBackground } from '../email/mailer.js';
import { DAY_MS, MAX_GUESSES_PER_NETWORK_HOUR } from '../logic/emailCodes.js';
import { encodeBase32, formatRecoveryCode, matchTotpCode, MAX_TWO_FACTOR_ATTEMPTS_PER_ACCOUNT_HOUR, MAX_WRONG_TWO_FACTOR_CODES_PER_LOGIN, readTwoFactorCode, RECOVERY_CODE_LENGTH, recoveryCodeFromBytes, TOTP_SECRET_BYTES, totpUri, TWO_FACTOR_SETUP_LIFETIME_MS } from '../logic/twoFactor.js';
import { authMessages, cookieTokenHash, recordEvent, sendRefusal, tooManyAttempts, type AuthRefusal } from './authCommon.js';
import { clientNetworkHash } from './clientNetwork.js';
import { clearCookie, readCookie, setCookie, TRUSTED_BROWSER_COOKIE, TWO_FACTOR_LOGIN_COOKIE } from './cookies.js';
import { errorMessages, sendInvalidRequest } from './errors.js';

/**
 * How long a browser stays trusted
 */
const TRUSTED_BROWSER_LIFETIME_MS = (TRUSTED_BROWSER_DAYS * DAY_MS);

/**
 * Reasons the 2FA routes give (see shared/src/localization.ts)
 */
const twoFactorMessages = defineMessages({
	codeNeeded: {
		id: 'error.auth.twoFactorCodeNeeded',
		defaultMessage: 'Enter the code from your authenticator app, or one of your recovery codes.',
		description: 'Shown under the two-factor code field when it was left empty, or what was typed can\'t be an authenticator code (6 digits) or a recovery code'
	},
	wrongCode: {
		id: 'error.auth.wrongTwoFactorCode',
		defaultMessage: 'That code isn\'t right, or was already used. Check that your device\'s clock is right, and enter the newest code, or use a recovery code.',
		description: 'Shown under the two-factor code field when the authenticator or recovery code is wrong, or was already used'
	},
	wrongSetupCode: {
		id: 'error.auth.wrongSetupCode',
		defaultMessage: 'That code isn\'t right. Check that your device\'s clock is right, and enter the newest code your authenticator app shows for this site.',
		description: 'Shown under the code field while turning on two-factor authentication, when the code from the authenticator app just set up is wrong'
	},
	loginAgain: {
		id: 'error.auth.twoFactorLoginAgain',
		defaultMessage: 'It has been too long since you typed your password, or too many codes were wrong. Log in with your password again.',
		description: 'Why finishing a login with an authenticator or recovery code was refused: the password was typed more than a few minutes ago, in another browser, or too many wrong codes were typed since'
	},
	setUpAgain: {
		id: 'error.auth.twoFactorSetUpAgain',
		defaultMessage: 'Start setting up two-factor authentication again: it has been too long since it started.',
		description: 'Why turning on two-factor authentication was refused: the player didn\'t start setting it up, or started more than a few minutes ago'
	},
	alreadyOn: {
		id: 'error.auth.twoFactorAlreadyOn',
		defaultMessage: 'Two-factor authentication is already on for your account.',
		description: 'Why setting up two-factor authentication was refused: it is already on, perhaps from another tab'
	},
	notOn: {
		id: 'error.auth.twoFactorNotOn',
		defaultMessage: 'Two-factor authentication isn\'t on for your account.',
		description: 'Why turning off two-factor authentication or making new recovery codes was refused: it isn\'t on, perhaps turned off from another tab'
	},
	noPassword: {
		id: 'error.auth.twoFactorNoPassword',
		defaultMessage: 'Two-factor authentication is for logging in with a password, and your account has none. Google and Discord ask for their own.',
		description: 'Why setting up two-factor authentication was refused: the account logs in only with Google or Discord, whose own two-factor authentication protects it'
	}
});

/**
 * What checking the second factor of a request decided
 */
export type SecondFactorOutcome =
	| { kind: 'notNeeded' }
	| {
		kind: 'right';

		/**
		 * How many recovery codes the account has left, when a recovery code was used
		 */
		recoveryCodesLeft?: number;
	}
	| {
		/**
		 * The code was wrong or missing
		 */
		kind: 'wrong';
		refusal: AuthRefusal;
	}
	| {
		/**
		 * The code wasn't checked: too many have been tried
		 */
		kind: 'refused';
		refusal: AuthRefusal;
	};

const locale = z.string().max(MAX_LOCALE_LENGTH).regex(/^[A-Za-z0-9-]+$/);
const password = z.string().max(MAX_PASSWORD_LENGTH * 4);
const twoFactorCode = z.string().max(MAX_TWO_FACTOR_CODE_INPUT_LENGTH);

const twoFactorLoginRequest = z.object({
	code: twoFactorCode,
	trustBrowser: z.boolean(),
	locale
}) satisfies z.ZodType<TwoFactorLoginRequest>;

const twoFactorSetupRequest = z.object({
	password
}) satisfies z.ZodType<TwoFactorSetupRequest>;

const twoFactorEnableRequest = z.object({
	code: twoFactorCode,
	locale
}) satisfies z.ZodType<TwoFactorEnableRequest>;

const twoFactorDisableRequest = z.object({
	password,
	code: twoFactorCode,
	locale
}) satisfies z.ZodType<TwoFactorDisableRequest>;

const recoveryCodesRequest = z.object({
	password,
	code: twoFactorCode
}) satisfies z.ZodType<RecoveryCodesRequest>;

/**
 * Adds the 2FA routes to the auth router
 *
 * @param router The auth router
 * @param underAuthPath A route's path within the router, from its full path
 */
export function addTwoFactorRoutes(router: Router, underAuthPath: (path: string) => string): void
{
	router.post(underAuthPath(AUTH_TWO_FACTOR_LOGIN_PATH), loginRoute);
	router.post(underAuthPath(AUTH_TWO_FACTOR_SETUP_PATH), setupRoute);
	router.post(underAuthPath(AUTH_TWO_FACTOR_ENABLE_PATH), enableRoute);
	router.post(underAuthPath(AUTH_TWO_FACTOR_DISABLE_PATH), disableRoute);
	router.post(underAuthPath(AUTH_RECOVERY_CODES_PATH), recoveryCodesRoute);
	router.post(underAuthPath(AUTH_TRUSTED_BROWSERS_FORGET_PATH), forgetTrustedBrowsersRoute);
}

/**
 * Whether the browser making a request is trusted to skip an account's authenticator code
 *
 * @param request The request
 * @param playerId The account
 * @param now The time now
 * @param executor The database, or a transaction
 * @return Whether it is
 */
async function isTrusted(request: Request, playerId: string, now: Date, executor?: Executor): Promise<boolean>
{
	const tokenHash = cookieTokenHash(request, TRUSTED_BROWSER_COOKIE);

	return(((tokenHash !== undefined) && await isBrowserTrusted(tokenHash, playerId, now, executor)));
}

/**
 * Whether a request for an account needs its authenticator or recovery code: the account has 2FA on,
 * and the browser isn't trusted
 *
 * @param request The request
 * @param playerId The account
 * @param now The time now
 * @param executor The database, or a transaction
 * @return Whether it does
 */
export async function needsSecondFactor(request: Request, playerId: string, now: Date, executor?: Executor): Promise<boolean>
{
	return((await hasTwoFactor(playerId, executor)) && !(await isTrusted(request, playerId, now, executor)));
}

/**
 * Checks the authenticator or recovery code a request gives for an account, if the account has 2FA on.
 * A right authenticator code can't be used again, and a right recovery code is used up. Every code
 * tried counts against the account's and the network's hourly limits
 *
 * @param request The request
 * @param response The response, which gets a Retry-After header when too many codes were tried
 * @param playerId The account
 * @param typed The code as typed, or null when none was given
 * @param now The time now
 * @param executor A transaction, which must be committed even when the code is wrong, so the attempt counts
 * @param options Whether a trusted browser skips the code
 * @return What was decided
 */
export async function checkSecondFactor(request: Request, response: Response, playerId: string, typed: string | null, now: Date, executor: Executor, options: { trustedBrowserSkips: boolean }): Promise<SecondFactorOutcome>
{
	const authenticator = await lockAuthenticator(playerId, executor);

	if (!authenticator || (authenticator.enabledAt === null))
	{
		return({ kind: 'notNeeded' });
	}

	if (options.trustedBrowserSkips && await isTrusted(request, playerId, now, executor))
	{
		return({ kind: 'notNeeded' });
	}

	const code = ((typed === null) ? undefined : readTwoFactorCode(typed));

	if (code === undefined)
	{
		return({
			kind: 'wrong',
			refusal: {
				status: 401,
				message: twoFactorMessages.codeNeeded,
				field: 'twoFactorCode'
			}
		});
	}

	const attempt = await takeAttempt([
		{
			kind: 'accountTwoFactorAttempt',
			subjectHash: keyedHash('account', playerId),
			limit: MAX_TWO_FACTOR_ATTEMPTS_PER_ACCOUNT_HOUR
		},
		{
			kind: 'networkGuess',
			subjectHash: clientNetworkHash(request),
			limit: MAX_GUESSES_PER_NETWORK_HOUR
		}
	], now, executor);

	if (!attempt.allowed)
	{
		return({
			kind: 'refused',
			refusal: tooManyAttempts(attempt, now, response)
		});
	}

	if (code.kind === 'totp')
	{
		const step = matchTotpCode(decryptTotpSecret(authenticator.encryptedSecret, playerId), code.code, now, authenticator.lastUsedStep);

		if (step !== undefined)
		{
			await saveLastUsedStep(playerId, step, executor);

			return({ kind: 'right' });
		}
	}
	else if (await useRecoveryCode(playerId, keyedHash('recoveryCode', code.code), executor))
	{
		await recordEvent(request, playerId, 'recoveryCodeUsed', now, executor);

		return({
			kind: 'right',
			recoveryCodesLeft: await countRecoveryCodes(playerId, executor)
		});
	}

	await recordEvent(request, playerId, 'twoFactorFailed', now, executor);

	return({
		kind: 'wrong',
		refusal: {
			status: 401,
			message: twoFactorMessages.wrongCode,
			field: 'twoFactorCode'
		}
	});
}

/**
 * Emails an account that one of its recovery codes was used, after the request is answered
 *
 * @param playerId The account
 * @param outcome What checking its code decided
 * @param emailLocale The language the request asked its emails in
 */
export async function reportRecoveryCodeUse(playerId: string, outcome: SecondFactorOutcome, emailLocale: string): Promise<void>
{
	if ((outcome.kind !== 'right') || (outcome.recoveryCodesLeft === undefined))
	{
		return;
	}

	const email = await findPlayerEmail(playerId);

	if (email !== null)
	{
		sendEmailInBackground({
			to: email,
			...recoveryCodeUsedEmail(outcome.recoveryCodesLeft, emailLocale)
		});
	}
}

/**
 * Makes a new set of recovery codes and stores their keyed hashes in place of the account's old ones
 *
 * @param playerId The account
 * @param executor A transaction
 * @return The codes, as shown to the player
 */
async function makeRecoveryCodes(playerId: string, executor: Executor): Promise<string[]>
{
	const codes: string[] = [];

	for (let i = 0; i < RECOVERY_CODE_COUNT; i++)
	{
		codes.push(recoveryCodeFromBytes(randomBytes(RECOVERY_CODE_LENGTH)));
	}

	await replaceRecoveryCodes(playerId, codes.map((code) => keyedHash('recoveryCode', code)), executor);

	return(codes.map(formatRecoveryCode));
}

/**
 * The browser's session, answering the request with a refusal when it has none
 *
 * @param request The request
 * @param response The response
 * @return The session, or undefined when the request was refused
 */
export async function requireSession(request: Request, response: Response): Promise<SessionIdentity | undefined>
{
	const session = await resolveSession(request.headers.cookie);

	if (!session)
	{
		sendRefusal(response, {
			status: 401,
			message: errorMessages.logInFirst
		});
	}

	return(session);
}

/**
 * Checks the logged-in account's password, which changing its 2FA or deleting it asks for again. Tries
 * count against the network's login limit
 *
 * @param request The request
 * @param response The response, which gets a Retry-After header when there were too many tries
 * @param playerId The account
 * @param typed The password as typed
 * @param now The time now
 * @return The refusal when the password isn't right, or the account has none
 */
export async function checkAccountPassword(request: Request, response: Response, playerId: string, typed: string, now: Date): Promise<AuthRefusal | undefined>
{
	const attempt = await inTransaction((executor) => takeAttempt([
		{
			kind: 'networkLoginAttempt',
			subjectHash: clientNetworkHash(request),
			limit: MAX_LOGIN_ATTEMPTS_PER_NETWORK_HOUR
		}
	], now, executor));

	if (!attempt.allowed)
	{
		return(tooManyAttempts(attempt, now, response));
	}

	const passwordHash = await findPasswordHash(playerId);

	if (passwordHash === null)
	{
		return({
			status: 400,
			message: twoFactorMessages.noPassword
		});
	}

	if (!(await checkLoginPassword(passwordHash, typed)).correct)
	{
		await recordEvent(request, playerId, 'loginFailed', now);

		return({
			status: 401,
			message: authMessages.wrongPassword,
			field: 'password'
		});
	}

	return(undefined);
}

/**
 * POST AUTH_TWO_FACTOR_LOGIN_PATH: finishes a login whose password was right, with an authenticator or
 * recovery code, from the browser that gave the password. Too many wrong codes end the login. A browser
 * the player chooses to trust skips the code for TRUSTED_BROWSER_DAYS
 *
 * @param request The request, with a TwoFactorLoginRequest
 * @param response The response: 204 with the session cookie, and the trust cookie when asked for
 */
async function loginRoute(request: Request, response: Response): Promise<void>
{
	const body = twoFactorLoginRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { code, trustBrowser: trust, locale: emailLocale } = body.data;
	const continuationHash = cookieTokenHash(request, TWO_FACTOR_LOGIN_COOKIE);
	const now = new Date();
	const outcome = await inTransaction(async (executor): Promise<AuthRefusal | { playerId: string; check: SecondFactorOutcome }> =>
	{
		const pending = ((continuationHash === undefined) ? undefined : await lockPendingTwoFactorLogin(continuationHash, now, executor));

		if (!pending)
		{
			clearCookie(response, TWO_FACTOR_LOGIN_COOKIE);

			return({
				status: 403,
				message: twoFactorMessages.loginAgain
			});
		}

		const check = await checkSecondFactor(request, response, pending.playerId, code, now, executor, { trustedBrowserSkips: false });

		if (check.kind === 'wrong')
		{
			if ((pending.wrongGuesses + 1) >= MAX_WRONG_TWO_FACTOR_CODES_PER_LOGIN)
			{
				await deletePendingTwoFactorLogin(pending.id, executor);
				clearCookie(response, TWO_FACTOR_LOGIN_COOKIE);

				return({
					status: 403,
					message: twoFactorMessages.loginAgain
				});
			}

			await recordWrongTwoFactorGuess(pending.id, executor);

			return(check.refusal);
		}

		if (check.kind === 'refused')
		{
			return(check.refusal);
		}

		await deletePendingTwoFactorLogin(pending.id, executor);
		await startSession(response, pending.playerId, pending.rememberMe, executor);
		await recordEvent(request, pending.playerId, 'loggedIn', now, executor);

		if (trust)
		{
			// A browser keeps one trust token, which every account it trusts shares
			const existing = readCookie(request.headers.cookie, TRUSTED_BROWSER_COOKIE);
			const token = (((existing !== undefined) && isTokenForm(existing)) ? existing : createToken());

			await trustBrowser(hashToken(token), pending.playerId, new Date(now.getTime() + TRUSTED_BROWSER_LIFETIME_MS), executor);
			await recordEvent(request, pending.playerId, 'browserTrusted', now, executor);
			setCookie(response, TRUSTED_BROWSER_COOKIE, token, TRUSTED_BROWSER_LIFETIME_MS);
		}

		return({
			playerId: pending.playerId,
			check
		});
	});

	if ('status' in outcome)
	{
		sendRefusal(response, outcome);
		return;
	}

	clearCookie(response, TWO_FACTOR_LOGIN_COOKIE);
	response.sendStatus(204);
	await reportRecoveryCodeUse(outcome.playerId, outcome.check, emailLocale);
}

/**
 * POST AUTH_TWO_FACTOR_SETUP_PATH: starts turning on 2FA for the logged-in account, once its password is
 * given: makes a new secret for the authenticator app, replacing a setup already started
 *
 * @param request The request, with a TwoFactorSetupRequest
 * @param response The response: a TwoFactorSetupPayload
 */
async function setupRoute(request: Request, response: Response): Promise<void>
{
	const body = twoFactorSetupRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const session = await requireSession(request, response);

	if (!session)
	{
		return;
	}

	const now = new Date();
	const problem = await checkAccountPassword(request, response, session.playerId, body.data.password, now);

	if (problem)
	{
		sendRefusal(response, problem);
		return;
	}

	const secret = randomBytes(TOTP_SECRET_BYTES);

	if (!(await saveAuthenticatorSetup(session.playerId, encryptTotpSecret(secret, session.playerId), now)))
	{
		sendRefusal(response, {
			status: 409,
			message: twoFactorMessages.alreadyOn
		});
		return;
	}

	const secretBase32 = encodeBase32(secret);
	const payload: TwoFactorSetupPayload = {
		secret: secretBase32,
		uri: totpUri(secretBase32, SITE_NAME, session.username)
	};

	response.json(payload);
}

/**
 * POST AUTH_TWO_FACTOR_ENABLE_PATH: turns on 2FA for the logged-in account, once the authenticator app
 * just set up gives a right code, and makes its recovery codes
 *
 * @param request The request, with a TwoFactorEnableRequest
 * @param response The response: a RecoveryCodesPayload
 */
async function enableRoute(request: Request, response: Response): Promise<void>
{
	const body = twoFactorEnableRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const session = await requireSession(request, response);

	if (!session)
	{
		return;
	}

	const { code: typed, locale: emailLocale } = body.data;
	const playerId = session.playerId;
	const now = new Date();
	const outcome = await inTransaction(async (executor): Promise<AuthRefusal | string[]> =>
	{
		const authenticator = await lockAuthenticator(playerId, executor);

		if (authenticator?.enabledAt)
		{
			return({
				status: 409,
				message: twoFactorMessages.alreadyOn
			});
		}

		if (!authenticator || ((now.getTime() - authenticator.createdAt.getTime()) > TWO_FACTOR_SETUP_LIFETIME_MS))
		{
			return({
				status: 403,
				message: twoFactorMessages.setUpAgain
			});
		}

		const attempt = await takeAttempt([
			{
				kind: 'accountTwoFactorAttempt',
				subjectHash: keyedHash('account', playerId),
				limit: MAX_TWO_FACTOR_ATTEMPTS_PER_ACCOUNT_HOUR
			}
		], now, executor);

		if (!attempt.allowed)
		{
			return(tooManyAttempts(attempt, now, response));
		}

		const code = readTwoFactorCode(typed);
		const step = ((code?.kind === 'totp') ? matchTotpCode(decryptTotpSecret(authenticator.encryptedSecret, playerId), code.code, now, null) : undefined);

		if (step === undefined)
		{
			return({
				status: 400,
				message: twoFactorMessages.wrongSetupCode,
				field: 'code'
			});
		}

		await enableAuthenticator(playerId, step, now, executor);

		const codes = await makeRecoveryCodes(playerId, executor);

		await recordEvent(request, playerId, 'twoFactorEnabled', now, executor);

		return(codes);
	});

	if (!Array.isArray(outcome))
	{
		sendRefusal(response, outcome);
		return;
	}

	const payload: RecoveryCodesPayload = { recoveryCodes: outcome };

	response.json(payload);

	const email = await findPlayerEmail(playerId);

	if (email !== null)
	{
		sendEmailInBackground({
			to: email,
			...twoFactorEnabledEmail(emailLocale)
		});
	}
}

/**
 * Checks the password and code a request to change the logged-in account's 2FA gives
 *
 * @param request The request
 * @param response The response
 * @param playerId The account
 * @param typedPassword The password as typed
 * @param typedCode The authenticator or recovery code as typed
 * @param now The time now
 * @param change What to do once both are right, in the same transaction
 * @return The change's result, or undefined when the request was refused
 */
async function changeTwoFactor<Result>(request: Request, response: Response, playerId: string, typedPassword: string, typedCode: string, now: Date, change: (executor: Executor) => Promise<Result>): Promise<{ result: Result; check: SecondFactorOutcome } | undefined>
{
	const problem = await checkAccountPassword(request, response, playerId, typedPassword, now);

	if (problem)
	{
		sendRefusal(response, problem);
		return(undefined);
	}

	const outcome = await inTransaction(async (executor): Promise<AuthRefusal | { result: Result; check: SecondFactorOutcome }> =>
	{
		const check = await checkSecondFactor(request, response, playerId, typedCode, now, executor, { trustedBrowserSkips: false });

		if (check.kind === 'notNeeded')
		{
			return({
				status: 409,
				message: twoFactorMessages.notOn
			});
		}

		if (check.kind !== 'right')
		{
			return(check.refusal);
		}

		return({
			result: await change(executor),
			check
		});
	});

	if ('status' in outcome)
	{
		sendRefusal(response, outcome);
		return(undefined);
	}

	return(outcome);
}

/**
 * POST AUTH_TWO_FACTOR_DISABLE_PATH: turns off 2FA for the logged-in account, once its password and an
 * authenticator or recovery code are given. Its recovery codes and trusted browsers go with it
 *
 * @param request The request, with a TwoFactorDisableRequest
 * @param response The response: 204
 */
async function disableRoute(request: Request, response: Response): Promise<void>
{
	const body = twoFactorDisableRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const session = await requireSession(request, response);

	if (!session)
	{
		return;
	}

	const { password: typedPassword, code, locale: emailLocale } = body.data;
	const playerId = session.playerId;
	const now = new Date();
	const outcome = await changeTwoFactor(request, response, playerId, typedPassword, code, now, async (executor) =>
	{
		await deleteTwoFactor(playerId, executor);
		await recordEvent(request, playerId, 'twoFactorDisabled', now, executor);
	});

	if (!outcome)
	{
		return;
	}

	response.sendStatus(204);

	const email = await findPlayerEmail(playerId);

	if (email !== null)
	{
		sendEmailInBackground({
			to: email,
			...twoFactorDisabledEmail(emailLocale)
		});
	}
}

/**
 * POST AUTH_RECOVERY_CODES_PATH: replaces the logged-in account's recovery codes, once its password and
 * an authenticator or recovery code are given
 *
 * @param request The request, with a RecoveryCodesRequest
 * @param response The response: a RecoveryCodesPayload
 */
async function recoveryCodesRoute(request: Request, response: Response): Promise<void>
{
	const body = recoveryCodesRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const session = await requireSession(request, response);

	if (!session)
	{
		return;
	}

	const playerId = session.playerId;
	const now = new Date();
	const outcome = await changeTwoFactor(request, response, playerId, body.data.password, body.data.code, now, async (executor) =>
	{
		const codes = await makeRecoveryCodes(playerId, executor);

		await recordEvent(request, playerId, 'recoveryCodesReplaced', now, executor);

		return(codes);
	});

	if (!outcome)
	{
		return;
	}

	const payload: RecoveryCodesPayload = { recoveryCodes: outcome.result };

	response.json(payload);
}

/**
 * POST AUTH_TRUSTED_BROWSERS_FORGET_PATH: stops trusting every browser the logged-in account trusted,
 * so each asks for the authenticator code at its next login
 *
 * @param request The request
 * @param response The response: 204
 */
async function forgetTrustedBrowsersRoute(request: Request, response: Response): Promise<void>
{
	const session = await requireSession(request, response);

	if (!session)
	{
		return;
	}

	const now = new Date();

	await inTransaction(async (executor) =>
	{
		await deleteTrustedBrowsers(session.playerId, executor);
		await recordEvent(request, session.playerId, 'trustedBrowsersForgotten', now, executor);
	});

	response.sendStatus(204);
}
