/**
 * 2FA (see Login in STRUCTURE-OVERVIEW.md), on the auth router: finishing a login with an authenticator
 * or recovery code, turning 2FA on and off from the profile, replacing recovery codes and trusted
 * browsers. Also the check the other auth routes make when an account with 2FA logs in, resets its
 * password or links a provider login (checkSecondFactor()), and how they log a browser in
 * (startLogin()): a server admin without 2FA turns it on before their login finishes, with the
 * login's own setup routes, since a server admin's session needs it (see Admin in STRUCTURE-OVERVIEW.md)
 *
 * Changing an account's 2FA asks for its password, or for an account without one (it logs in only with
 * Google or Discord), a code sent to its address (purpose 'changeTwoFactor'), so a stolen session alone
 * can't turn 2FA on and lock the owner out, or turn it off
 *
 * Turning 2FA on is two requests: setup gives the logged-in player a new secret for their authenticator
 * app (only in the body of a POST answer, never in an address), and enable turns it on once the app
 * gives a right code, answering with the recovery codes. The server keeps the secret encrypted
 * (server/src/auth/totpSecrets.ts) and the recovery codes as keyed hashes
 */
import { randomBytes } from 'crypto';
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { AUTH_RECOVERY_CODES_PATH, AUTH_TRUSTED_BROWSERS_FORGET_PATH, AUTH_TWO_FACTOR_DISABLE_PATH, AUTH_TWO_FACTOR_ENABLE_PATH, AUTH_TWO_FACTOR_LOGIN_ENABLE_PATH, AUTH_TWO_FACTOR_LOGIN_PATH, AUTH_TWO_FACTOR_LOGIN_SETUP_PATH, AUTH_TWO_FACTOR_SETUP_PATH, defineMessages, MAX_LOCALE_LENGTH, MAX_PASSWORD_LENGTH, MAX_TWO_FACTOR_CODE_INPUT_LENGTH, RECOVERY_CODE_COUNT, SITE_NAME, TRUSTED_BROWSER_DAYS, TWO_FACTOR_CODE_LENGTH, type RecoveryCodesPayload, type RecoveryCodesRequest, type SessionStartPayload, type TwoFactorDisableRequest, type TwoFactorEnableRequest, type TwoFactorLoginRequest, type TwoFactorLoginSetupPayload, type TwoFactorSetupPayload, type TwoFactorSetupRequest } from '@multiverse-kiln/shared';

import { isDevCode } from '../auth/devCodes.js';
import { keyedHash } from '../auth/keyedHashes.js';
import { checkLoginPassword } from '../auth/passwords.js';
import { takeAttempt } from '../auth/rateLimits.js';
import { giveSession, resolveSession, startSession, type SessionIdentity, type StartedSession } from '../auth/sessions.js';
import { createToken, hashToken, isTokenForm } from '../auth/tokens.js';
import { decryptTotpSecret, encryptTotpSecret } from '../auth/totpSecrets.js';
import type { Executor } from '../db/client.js';
import { deleteEmailCode, lockContinuation } from '../db/emailCodeRepo.js';
import { findEmailRecipient, findPasswordHash, findPlayer, findPlayerEmail } from '../db/playerRepo.js';
import { findRateLimitTimes, recordRateLimitEvent } from '../db/rateLimitRepo.js';
import { isServerAdmin, isServerAdminWithoutTwoFactor } from '../db/serverAdminRepo.js';
import { deletePlayerSessions } from '../db/sessionRepo.js';
import { countRecoveryCodes, deletePendingTwoFactorLogin, deleteTrustedBrowsers, deleteTwoFactor, enableAuthenticator, hasTwoFactor, isBrowserTrusted, lockAuthenticator, lockPendingTwoFactorLogin, recordWrongTwoFactorGuess, replaceRecoveryCodes, saveAuthenticatorSetup, saveLastUsedStep, savePendingTwoFactorLogin, trustBrowser, useRecoveryCode } from '../db/twoFactorRepo.js';
import { inTransaction } from '../db/transactions.js';
import { recoveryCodeUsedEmail, twoFactorDisabledEmail, twoFactorEnabledEmail, wrongAuthenticatorCodesEmail } from '../email/authEmails.js';
import { sendEmailInBackground } from '../email/mailer.js';
import { CONTINUATION_LIFETIME_MS, DAY_MS, decideLimit, MAX_GUESSES_PER_NETWORK_HOUR, type SendDecision } from '../logic/emailCodes.js';
import { connectedSessions } from '../players/connectedSessions.js';
import { twoFactorChanges } from '../players/twoFactorChanges.js';
import { encodeBase32, formatRecoveryCode, matchTotpCode, MAX_TWO_FACTOR_ATTEMPTS_PER_ACCOUNT_HOUR, MAX_WRONG_AUTHENTICATOR_CODES_PER_ACCOUNT_DAY, MAX_WRONG_TWO_FACTOR_CODES_PER_LOGIN, readTwoFactorCode, RECOVERY_CODE_LENGTH, recoveryCodeFromBytes, TOTP_SECRET_BYTES, totpStep, totpUri, TWO_FACTOR_SETUP_LIFETIME_MS, WRONG_AUTHENTICATOR_CODES_BEFORE_WARNING } from '../logic/twoFactor.js';
import { accountPasswordLimits, authMessages, cookieTokenHash, recordEvent, sendRefusal, tooManyAttempts, type AuthRefusal } from './authCommon.js';
import { clientNetworkHash } from './clientNetwork.js';
import { clearCookie, CONTINUATION_COOKIE, readCookie, setCookie, TRUSTED_BROWSER_COOKIE, TWO_FACTOR_LOGIN_COOKIE } from './cookies.js';
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
		description: 'Why finishing a login with an authenticator or recovery code, or with the code from the authenticator app a site admin is setting up at login, was refused: the password was typed more than a few minutes ago, in another browser, or too many wrong codes were typed since'
	},
	adminKeepsTwoFactor: {
		id: 'error.auth.adminKeepsTwoFactor',
		defaultMessage: 'The site\'s admins must keep two-factor authentication on. To turn it off, ask another admin to remove you from the site\'s admins first.',
		description: 'Why turning off two-factor authentication was refused: the player is one of the site\'s admins, who can\'t log in without it'
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
	tooManyWrongCodes: {
		id: 'error.auth.tooManyWrongAuthenticatorCodes',
		defaultMessage: 'Too many wrong codes from an authenticator app were typed for your account today. Use one of your recovery codes, or try again in {hours, plural, one {# hour} other {# hours}}.',
		description: 'Shown under the two-factor code field when the account had too many wrong authenticator app codes in the past day, so only recovery codes are taken for now; {hours} is how long until an authenticator code is taken again'
	},
	noPassword: {
		id: 'error.auth.noPasswordToCheck',
		defaultMessage: 'Your account has no password to check. Reload the page and try again.',
		description: 'Why a change on the player\'s own profile that asks for their password was refused: the account has no password (it logs in only with Google or Discord), though the page asked for one'
	},
	noEmail: {
		id: 'error.auth.twoFactorNoEmail',
		defaultMessage: 'Your account has neither a password nor an email address to check it\'s you, so two-factor authentication can\'t be changed.',
		description: 'Why turning two-factor authentication on or off, or making new recovery codes, was refused: the account logs in only with Google or Discord and has no email address, so there is no password to ask for or address to email a code to'
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
	password: password.nullable()
}) satisfies z.ZodType<TwoFactorSetupRequest>;

const twoFactorEnableRequest = z.object({
	code: twoFactorCode,
	locale
}) satisfies z.ZodType<TwoFactorEnableRequest>;

const twoFactorDisableRequest = z.object({
	password: password.nullable(),
	code: twoFactorCode,
	locale
}) satisfies z.ZodType<TwoFactorDisableRequest>;

const recoveryCodesRequest = z.object({
	password: password.nullable(),
	code: twoFactorCode,
	locale
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
	router.post(underAuthPath(AUTH_TWO_FACTOR_LOGIN_SETUP_PATH), loginSetupRoute);
	router.post(underAuthPath(AUTH_TWO_FACTOR_LOGIN_ENABLE_PATH), loginEnableRoute);
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
 * Keeps a login whose password (or provider login, or emailed code) was right waiting, for
 * CONTINUATION_LIFETIME_MS, on the account's authenticator or recovery code, or for a server admin
 * without 2FA, on turning it on. Only this browser can finish it: it gets the cookie that names the login
 *
 * @param response The response, which carries the cookie
 * @param playerId The account
 * @param rememberMe Whether the player checked "Remember me", for the session the login starts
 * @param now The time now
 * @param executor A transaction
 */
export async function waitForSecondFactor(response: Response, playerId: string, rememberMe: boolean, now: Date, executor: Executor): Promise<void>
{
	const token = createToken();

	await savePendingTwoFactorLogin({
		continuationHash: hashToken(token),
		playerId,
		rememberMe,
		expiresAt: new Date(now.getTime() + CONTINUATION_LIFETIME_MS)
	}, executor);
	setCookie(response, TWO_FACTOR_LOGIN_COOKIE, token, CONTINUATION_LIFETIME_MS);
}

/**
 * A login startLogin() started, for finishLogin() to answer once its transaction commits
 */
export interface StartedLogin
{
	/**
	 * Whether the browser is logged in, or waits to turn 2FA on
	 */
	outcome: SessionStartPayload['outcome'];

	/**
	 * The session to give the browser, when it is logged in
	 */
	session: StartedSession | undefined;
}

/**
 * Logs a browser in once it has shown it's the account's owner (and given the account's authenticator
 * or recovery code, when it needs one), recording the login. A server admin without 2FA isn't logged
 * in: the login waits for them to turn it on (AUTH_TWO_FACTOR_LOGIN_SETUP_PATH), since their sessions
 * don't count without it (resolveSession()). Once the transaction commits, finishLogin() gives the
 * browser its session
 *
 * @param request The request, with the browser's cookies
 * @param response The response, which carries the cookie that lets this browser turn 2FA on
 * @param playerId The account
 * @param rememberMe Whether the player checked "Remember me"
 * @param now The time now
 * @param executor A transaction
 * @return Whether the browser is logged in, with its session, or waits to turn 2FA on
 */
export async function startLogin(request: Request, response: Response, playerId: string, rememberMe: boolean, now: Date, executor: Executor): Promise<StartedLogin>
{
	if (await isServerAdminWithoutTwoFactor(playerId, executor))
	{
		await waitForSecondFactor(response, playerId, rememberMe, now, executor);

		return({
			outcome: 'twoFactorSetup',
			session: undefined
		});
	}

	const session = await startSession(request, playerId, rememberMe, executor);

	await recordEvent(request, playerId, 'loggedIn', now, executor);

	return({
		outcome: 'loggedIn',
		session
	});
}

/**
 * Gives the browser the session a login started, once the login's transaction has committed
 *
 * @param response The response, which carries the session cookie
 * @param login The login, from startLogin()
 * @return Whether the browser is logged in, or waits to turn 2FA on
 */
export function finishLogin(response: Response, login: StartedLogin): SessionStartPayload['outcome']
{
	if (login.session)
	{
		giveSession(response, login.session);
	}

	return(login.outcome);
}

/**
 * Checks the authenticator or recovery code a request gives for an account, if the account has 2FA on.
 * A right authenticator code can't be used again, and a right recovery code is used up. Every code
 * tried counts against the account's and the network's hourly limits. Wrong authenticator codes also
 * count against the account's daily limit, after which only recovery codes are taken, and the account
 * is emailed when it reaches WRONG_AUTHENTICATOR_CODES_BEFORE_WARNING of them in a day
 *
 * @param request The request
 * @param response The response, which gets a Retry-After header when too many codes were tried
 * @param playerId The account
 * @param typed The code as typed, or null when none was given
 * @param now The time now
 * @param executor A transaction, which must be committed even when the code is wrong, so the attempt counts
 * @param options Whether a trusted browser skips the code, and the language the request asked its emails in
 * @return What was decided
 */
export async function checkSecondFactor(request: Request, response: Response, playerId: string, typed: string | null, now: Date, executor: Executor, options: { trustedBrowserSkips: boolean; emailLocale: string }): Promise<SecondFactorOutcome>
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

	const accountHash = keyedHash('account', playerId);

	// The authenticator row stays locked until the transaction ends, so wrong codes sent at once are counted one after another
	const wrongCodesAt = ((code.kind === 'totp') ? await findRateLimitTimes('accountWrongAuthenticatorCode', accountHash, new Date(now.getTime() - DAY_MS), executor) : []);
	const wrongCodes = decideLimit(wrongCodesAt, MAX_WRONG_AUTHENTICATOR_CODES_PER_ACCOUNT_DAY, DAY_MS, now);

	if (!wrongCodes.allowed)
	{
		return({
			kind: 'refused',
			refusal: tooManyWrongAuthenticatorCodes(wrongCodes, now, response)
		});
	}

	const attempt = await takeAttempt([
		{
			kind: 'accountTwoFactorAttempt',
			subjectHash: accountHash,
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

	if ((code.kind === 'totp') && isDevCode(code.code, TWO_FACTOR_CODE_LENGTH))
	{
		return({ kind: 'right' });
	}

	if (code.kind === 'totp')
	{
		const step = matchTotpCode(decryptTotpSecret(authenticator.encryptedSecret, playerId), code.code, now, authenticator.lastUsedStep);

		if (step !== undefined)
		{
			await saveLastUsedStep(playerId, step, executor);

			return({ kind: 'right' });
		}

		await recordRateLimitEvent('accountWrongAuthenticatorCode', accountHash, now, executor);

		if ((wrongCodesAt.length + 1) === WRONG_AUTHENTICATOR_CODES_BEFORE_WARNING)
		{
			const recipient = await findEmailRecipient(playerId, executor);

			if (recipient)
			{
				sendEmailInBackground({
					to: recipient.email,
					...wrongAuthenticatorCodesEmail(WRONG_AUTHENTICATOR_CODES_BEFORE_WARNING, recipient.displayName, options.emailLocale)
				});
			}
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
 * The refusal for an authenticator code typed after the account's daily limit of wrong ones, telling
 * the browser when to try again
 *
 * @param decision The limit's decision
 * @param now The time now
 * @param response The response, which gets the Retry-After header
 * @return The refusal
 */
function tooManyWrongAuthenticatorCodes(decision: SendDecision & { allowed: false }, now: Date, response: Response): AuthRefusal
{
	const seconds = Math.max(1, Math.ceil((decision.retryAt.getTime() - now.getTime()) / 1000));

	response.set('Retry-After', String(seconds));

	return({
		status: 429,
		message: twoFactorMessages.tooManyWrongCodes,
		values: {
			hours: Math.ceil(seconds / 3600)
		},
		field: 'twoFactorCode'
	});
}

/**
 * Emails an account that one of its recovery codes was used. The change the code allowed is already
 * saved, so a failure finding the address is logged rather than thrown: it mustn't fail the request or
 * stop the caller's other notices
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

	try
	{
		const recipient = await findEmailRecipient(playerId);

		if (recipient)
		{
			sendEmailInBackground({
				to: recipient.email,
				...recoveryCodeUsedEmail(outcome.recoveryCodesLeft, recipient.displayName, emailLocale)
			});
		}
	}
	catch (error)
	{
		console.error('Could not email an account that a recovery code was used:', error);
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
 * Checks the logged-in account's password, which changing its 2FA, linking a provider login from the
 * profile or deleting the account asks for again. Tries
 * count against the login limits of the network and of the account's address
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
	const email = await findPlayerEmail(playerId);
	const attempt = await inTransaction((executor) => takeAttempt(accountPasswordLimits(request, email), now, executor));

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
 * How a request changing the logged-in account's 2FA showed it's the account's owner: with its
 * password, or, for an account without one, with a code sent to its address that this browser entered
 * (purpose 'changeTwoFactor'), which lockEmailConfirmation() checks in the change's transaction
 */
type OwnerCheck = 'password' | 'emailCode';

/**
 * Checks it's the owner changing the logged-in account's 2FA, so a stolen session alone can't: its
 * password, or for an account without one, that it has an address to send a code to
 *
 * @param request The request
 * @param response The response, which gets a Retry-After header when there were too many tries
 * @param playerId The account
 * @param typedPassword The password as typed, or null when the browser says the account has none
 * @param now The time now
 * @return The refusal, or how the request shows it's the owner
 */
async function checkOwner(request: Request, response: Response, playerId: string, typedPassword: string | null, now: Date): Promise<AuthRefusal | OwnerCheck>
{
	if ((await findPasswordHash(playerId)) !== null)
	{
		return((await checkAccountPassword(request, response, playerId, (typedPassword ?? ''), now)) ?? 'password');
	}

	if ((await findPlayerEmail(playerId)) === null)
	{
		return({
			status: 400,
			message: twoFactorMessages.noEmail
		});
	}

	return('emailCode');
}

/**
 * Finds the code sent to the logged-in account's address (purpose 'changeTwoFactor') that this browser
 * entered, for an account without a password
 *
 * @param request The request
 * @param playerId The account
 * @param now The time now
 * @param executor A transaction
 * @return The code's ID, to delete once the change is made, or the refusal when the browser hasn't entered one
 */
async function lockEmailConfirmation(request: Request, playerId: string, now: Date, executor: Executor): Promise<AuthRefusal | string>
{
	const continuationHash = cookieTokenHash(request, CONTINUATION_COOKIE);
	const code = ((continuationHash === undefined) ? undefined : await lockContinuation('changeTwoFactor', continuationHash, now, executor));

	if (!code || (code.playerId !== playerId))
	{
		return({
			status: 403,
			message: authMessages.enterCodeFirst
		});
	}

	return(code.id);
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
	const outcome = await inTransaction(async (executor): Promise<AuthRefusal | { playerId: string; check: SecondFactorOutcome; session: StartedSession; trustToken: string | undefined }> =>
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

		const check = await checkSecondFactor(request, response, pending.playerId, code, now, executor, {
			trustedBrowserSkips: false,
			emailLocale
		});

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

		// A server admin whose 2FA went while the login waited logs in again, to turn it on
		if ((check.kind === 'notNeeded') && await isServerAdminWithoutTwoFactor(pending.playerId, executor))
		{
			await deletePendingTwoFactorLogin(pending.id, executor);
			clearCookie(response, TWO_FACTOR_LOGIN_COOKIE);

			return({
				status: 403,
				message: twoFactorMessages.loginAgain
			});
		}

		await deletePendingTwoFactorLogin(pending.id, executor);
		const session = await startSession(request, pending.playerId, pending.rememberMe, executor);

		await recordEvent(request, pending.playerId, 'loggedIn', now, executor);

		let trustToken: string | undefined;

		if (trust)
		{
			// A browser keeps one trust token, which every account it trusts shares
			const existing = readCookie(request.headers.cookie, TRUSTED_BROWSER_COOKIE);

			trustToken = (((existing !== undefined) && isTokenForm(existing)) ? existing : createToken());
			await trustBrowser(hashToken(trustToken), pending.playerId, new Date(now.getTime() + TRUSTED_BROWSER_LIFETIME_MS), executor);
			await recordEvent(request, pending.playerId, 'browserTrusted', now, executor);
		}

		return({
			playerId: pending.playerId,
			check,
			session,
			trustToken
		});
	});

	if ('status' in outcome)
	{
		sendRefusal(response, outcome);
		return;
	}

	giveSession(response, outcome.session);

	if (outcome.trustToken !== undefined)
	{
		setCookie(response, TRUSTED_BROWSER_COOKIE, outcome.trustToken, TRUSTED_BROWSER_LIFETIME_MS);
	}

	clearCookie(response, TWO_FACTOR_LOGIN_COOKIE);
	response.sendStatus(204);
	await reportRecoveryCodeUse(outcome.playerId, outcome.check, emailLocale);
}

/**
 * POST AUTH_TWO_FACTOR_LOGIN_SETUP_PATH: starts turning on 2FA for a server admin's login that waits on
 * it (startLogin()), from the browser that logged in: makes a new secret for the authenticator app,
 * replacing a setup already started. The login itself showed it's the account's owner, so nothing more
 * is asked for
 *
 * @param request The request
 * @param response The response: a TwoFactorLoginSetupPayload
 */
async function loginSetupRoute(request: Request, response: Response): Promise<void>
{
	const continuationHash = cookieTokenHash(request, TWO_FACTOR_LOGIN_COOKIE);
	const now = new Date();
	const secret = randomBytes(TOTP_SECRET_BYTES);
	const outcome = await inTransaction(async (executor): Promise<AuthRefusal | { username: string }> =>
	{
		const pending = ((continuationHash === undefined) ? undefined : await lockPendingTwoFactorLogin(continuationHash, now, executor));
		const player = (pending ? await findPlayer(pending.playerId, executor) : undefined);

		if (!pending || !player)
		{
			clearCookie(response, TWO_FACTOR_LOGIN_COOKIE);

			return({
				status: 403,
				message: twoFactorMessages.loginAgain
			});
		}

		// Refused once 2FA is on, so a login waiting on its code can't replace the account's authenticator
		if (!(await saveAuthenticatorSetup(pending.playerId, encryptTotpSecret(secret, pending.playerId), now, executor)))
		{
			return({
				status: 409,
				message: twoFactorMessages.alreadyOn
			});
		}

		return({ username: player.username });
	});

	if ('status' in outcome)
	{
		sendRefusal(response, outcome);
		return;
	}

	const secretBase32 = encodeBase32(secret);
	const payload: TwoFactorLoginSetupPayload = {
		secret: secretBase32,
		uri: totpUri(secretBase32, SITE_NAME, outcome.username),
		username: outcome.username
	};

	response.json(payload);
}

/**
 * POST AUTH_TWO_FACTOR_LOGIN_ENABLE_PATH: turns on 2FA for a server admin's login that waits on it,
 * once the authenticator app just set up gives a right code, makes its recovery codes and logs the
 * browser in. Too many wrong codes end the login, as at AUTH_TWO_FACTOR_LOGIN_PATH
 *
 * @param request The request, with a TwoFactorEnableRequest
 * @param response The response: a RecoveryCodesPayload, with the session cookie
 */
async function loginEnableRoute(request: Request, response: Response): Promise<void>
{
	const body = twoFactorEnableRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { code: typed, locale: emailLocale } = body.data;
	const continuationHash = cookieTokenHash(request, TWO_FACTOR_LOGIN_COOKIE);
	const now = new Date();
	const outcome = await inTransaction(async (executor): Promise<AuthRefusal | { playerId: string; codes: string[]; ended: string[]; session: StartedSession }> =>
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

		const enabled = await enableWithSetupCode(response, pending.playerId, typed, now, executor);

		if (enabled.kind === 'wrong')
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

			return(enabled.refusal);
		}

		if (enabled.kind === 'refused')
		{
			return(enabled.refusal);
		}

		// The account's sessions didn't count without 2FA, so only this browser is logged in
		const ended = await deletePlayerSessions(pending.playerId, executor);

		await deletePendingTwoFactorLogin(pending.id, executor);
		await recordEvent(request, pending.playerId, 'twoFactorEnabled', now, executor);
		const session = await startSession(request, pending.playerId, pending.rememberMe, executor);

		await recordEvent(request, pending.playerId, 'loggedIn', now, executor);

		return({
			playerId: pending.playerId,
			codes: enabled.codes,
			ended,
			session
		});
	});

	if ('status' in outcome)
	{
		sendRefusal(response, outcome);
		return;
	}

	giveSession(response, outcome.session);
	clearCookie(response, TWO_FACTOR_LOGIN_COOKIE);
	await answerTwoFactorEnabled(response, outcome.playerId, outcome.codes, outcome.ended, emailLocale);
}

/**
 * POST AUTH_TWO_FACTOR_SETUP_PATH: starts turning on 2FA for the logged-in account, once its password is
 * given, or for an account without one, once this browser has entered a code sent to its address: makes
 * a new secret for the authenticator app, replacing a setup already started. The emailed code works once
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

	const playerId = session.playerId;
	const now = new Date();
	const owner = await checkOwner(request, response, playerId, body.data.password, now);

	if (typeof owner !== 'string')
	{
		sendRefusal(response, owner);
		return;
	}

	const secret = randomBytes(TOTP_SECRET_BYTES);
	const problem = await inTransaction(async (executor): Promise<AuthRefusal | undefined> =>
	{
		const emailCodeId = ((owner === 'emailCode') ? await lockEmailConfirmation(request, playerId, now, executor) : undefined);

		if (typeof emailCodeId === 'object')
		{
			return(emailCodeId);
		}

		if (!(await saveAuthenticatorSetup(playerId, encryptTotpSecret(secret, playerId), now, executor)))
		{
			return({
				status: 409,
				message: twoFactorMessages.alreadyOn
			});
		}

		if (emailCodeId !== undefined)
		{
			await deleteEmailCode(emailCodeId, executor);
		}

		return(undefined);
	});

	if (problem)
	{
		sendRefusal(response, problem);
		return;
	}

	if (owner === 'emailCode')
	{
		clearCookie(response, CONTINUATION_COOKIE);
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
 * just set up gives a right code, and makes its recovery codes. Every other browser logged in to the
 * account is logged out, and the player's open editors of universes that require 2FA may save again
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
	const outcome = await inTransaction(async (executor): Promise<AuthRefusal | { codes: string[]; ended: string[] }> =>
	{
		const enabled = await enableWithSetupCode(response, playerId, typed, now, executor);

		if (enabled.kind !== 'enabled')
		{
			return(enabled.refusal);
		}

		// A player turning 2FA on may suspect someone else is logged in, so every other browser logs in again, with the code
		const ended = await deletePlayerSessions(playerId, executor, session.sessionId);

		await recordEvent(request, playerId, 'twoFactorEnabled', now, executor);

		return({
			codes: enabled.codes,
			ended
		});
	});

	if ('status' in outcome)
	{
		sendRefusal(response, outcome);
		return;
	}

	await answerTwoFactorEnabled(response, playerId, outcome.codes, outcome.ended, emailLocale);
}

/**
 * What checking the code from an authenticator app just set up decided
 */
type SetupCodeOutcome =
	| {
		kind: 'enabled';

		/**
		 * The account's recovery codes, as shown to the player
		 */
		codes: string[];
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
		 * The code wasn't checked: 2FA is on already, the setup is missing or too old, or too many codes
		 * have been tried
		 */
		kind: 'refused';
		refusal: AuthRefusal;
	};

/**
 * Turns on 2FA for an account once the authenticator app just set up gives a right code, and makes its
 * recovery codes. Every code tried counts against the account's hourly limit
 *
 * @param response The response, which gets a Retry-After header when too many codes were tried
 * @param playerId The account
 * @param typed The code as typed
 * @param now The time now
 * @param executor A transaction, which must be committed even when the code is wrong, so the attempt counts
 * @return The recovery codes, or why 2FA wasn't turned on
 */
async function enableWithSetupCode(response: Response, playerId: string, typed: string, now: Date, executor: Executor): Promise<SetupCodeOutcome>
{
	const authenticator = await lockAuthenticator(playerId, executor);

	if (authenticator?.enabledAt)
	{
		return({
			kind: 'refused',
			refusal: {
				status: 409,
				message: twoFactorMessages.alreadyOn
			}
		});
	}

	if (!authenticator || ((now.getTime() - authenticator.createdAt.getTime()) > TWO_FACTOR_SETUP_LIFETIME_MS))
	{
		return({
			kind: 'refused',
			refusal: {
				status: 403,
				message: twoFactorMessages.setUpAgain
			}
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
		return({
			kind: 'refused',
			refusal: tooManyAttempts(attempt, now, response)
		});
	}

	const code = readTwoFactorCode(typed);
	let step: number | undefined;

	if (code?.kind === 'totp')
	{
		step = (isDevCode(code.code, TWO_FACTOR_CODE_LENGTH) ? totpStep(now) : matchTotpCode(decryptTotpSecret(authenticator.encryptedSecret, playerId), code.code, now, null));
	}

	if (step === undefined)
	{
		return({
			kind: 'wrong',
			refusal: {
				status: 400,
				message: twoFactorMessages.wrongSetupCode,
				field: 'code'
			}
		});
	}

	await enableAuthenticator(playerId, step, now, executor);

	return({
		kind: 'enabled',
		codes: await makeRecoveryCodes(playerId, executor)
	});
}

/**
 * Answers a request that turned 2FA on with the account's recovery codes, once its transaction is
 * committed: turns away the windows of the sessions it ended, tells the rooms, and emails the account
 *
 * @param response The response: a RecoveryCodesPayload
 * @param playerId The account
 * @param codes The recovery codes, as shown to the player
 * @param ended The IDs of the account's sessions that turning 2FA on ended
 * @param emailLocale The language the request asked its emails in
 */
async function answerTwoFactorEnabled(response: Response, playerId: string, codes: string[], ended: string[], emailLocale: string): Promise<void>
{
	connectedSessions.end(ended);
	twoFactorChanges.publish(playerId, true);

	const payload: RecoveryCodesPayload = { recoveryCodes: codes };

	response.json(payload);

	const recipient = await findEmailRecipient(playerId);

	if (recipient)
	{
		sendEmailInBackground({
			to: recipient.email,
			...twoFactorEnabledEmail(recipient.displayName, emailLocale)
		});
	}
}

/**
 * Checks what a request to change the logged-in account's 2FA gives: its password, or for an account
 * without one, a code sent to its address that this browser entered (which works once, and stays usable
 * while the authenticator or recovery code is wrong), and an authenticator or recovery code
 *
 * @param request The request
 * @param response The response
 * @param playerId The account
 * @param typedPassword The password as typed, or null when the browser says the account has none
 * @param typedCode The authenticator or recovery code as typed
 * @param emailLocale The language the request asked its emails in
 * @param now The time now
 * @param change What to do once both are right, in the same transaction
 * @return The change's result, or undefined when the request was refused
 */
async function changeTwoFactor<Result>(request: Request, response: Response, playerId: string, typedPassword: string | null, typedCode: string, emailLocale: string, now: Date, change: (executor: Executor) => Promise<Result>): Promise<{ result: Result; check: SecondFactorOutcome } | undefined>
{
	const owner = await checkOwner(request, response, playerId, typedPassword, now);

	if (typeof owner !== 'string')
	{
		sendRefusal(response, owner);
		return(undefined);
	}

	const outcome = await inTransaction(async (executor): Promise<AuthRefusal | { result: Result; check: SecondFactorOutcome }> =>
	{
		// Before the authenticator code, so a browser without the emailed code doesn't use up the account's tries
		const emailCodeId = ((owner === 'emailCode') ? await lockEmailConfirmation(request, playerId, now, executor) : undefined);

		if (typeof emailCodeId === 'object')
		{
			return(emailCodeId);
		}

		const check = await checkSecondFactor(request, response, playerId, typedCode, now, executor, {
			trustedBrowserSkips: false,
			emailLocale
		});

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

		if (emailCodeId !== undefined)
		{
			await deleteEmailCode(emailCodeId, executor);
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

	if (owner === 'emailCode')
	{
		clearCookie(response, CONTINUATION_COOKIE);
	}

	return(outcome);
}

/**
 * POST AUTH_TWO_FACTOR_DISABLE_PATH: turns off 2FA for the logged-in account, once its password (or
 * without one, an emailed code) and an authenticator or recovery code are given. Its recovery codes and
 * trusted browsers go with it, and the player's open editors of universes that require 2FA stop letting
 * them save. A server admin is refused, since they can't be logged in without it
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

	// Before the password, so an admin doesn't use up the account's tries; resolveSession() covers one made an admin meanwhile
	if (await isServerAdmin(playerId))
	{
		sendRefusal(response, {
			status: 403,
			message: twoFactorMessages.adminKeepsTwoFactor
		});
		return;
	}

	const now = new Date();
	const outcome = await changeTwoFactor(request, response, playerId, typedPassword, code, emailLocale, now, async (executor) =>
	{
		await deleteTwoFactor(playerId, executor);
		await recordEvent(request, playerId, 'twoFactorDisabled', now, executor);
	});

	if (!outcome)
	{
		return;
	}

	twoFactorChanges.publish(playerId, false);
	response.sendStatus(204);

	const recipient = await findEmailRecipient(playerId);

	if (recipient)
	{
		sendEmailInBackground({
			to: recipient.email,
			...twoFactorDisabledEmail(recipient.displayName, emailLocale)
		});
	}
}

/**
 * POST AUTH_RECOVERY_CODES_PATH: replaces the logged-in account's recovery codes, once its password (or
 * without one, an emailed code) and an authenticator or recovery code are given
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
	const outcome = await changeTwoFactor(request, response, playerId, body.data.password, body.data.code, body.data.locale, now, async (executor) =>
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
