/**
 * The auth routes (listed in shared/src/accounts.ts): the browser's session, logging in and out, and
 * the email code flows for registering, resetting a password, changing an email address and linking a
 * provider login (see Login and Email codes in STRUCTURE-OVERVIEW.md). Logging in with Google or
 * Discord is in providerAuth.ts, 2FA in twoFactorAuth.ts and deleting an account in accountDeletion.ts
 *
 * Nothing these routes answer tells whether an account exists for an address: logins fail with the
 * same message either way, and sending a code answers the same whether or not one was sent. Emails go
 * after the answer, so its timing doesn't tell either
 */
import { randomBytes } from 'crypto';
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { AUTH_CODE_CHECK_PATH, AUTH_CODE_PATH, AUTH_EMAIL_CHANGE_PATH, AUTH_LOGIN_PATH, AUTH_PATH, AUTH_LOGOUT_PATH, AUTH_PASSWORD_CHANGE_PATH, AUTH_PASSWORD_RESET_PATH, AUTH_REGISTER_PATH, AUTH_SESSION_PATH, AUTH_USERNAME_CHECK_PATH, EMAIL_CODE_PURPOSES, MAX_EMAIL_LENGTH, MAX_LOCALE_LENGTH, MAX_PASSWORD_LENGTH, MAX_PLAYER_NAME_LENGTH, MAX_TWO_FACTOR_CODE_INPUT_LENGTH, MAX_USERNAME_LENGTH, MIN_PASSWORD_LENGTH, type EmailChangeRequest, type EmailCodeCheckPayload, type EmailCodeCheckRequest, type EmailCodePurpose, type EmailCodeRequest, type LoginPayload, type LoginRequest, type PasswordChangeRequest, type PasswordResetRequest, type RegisterRequest, type SessionPayload, type UsernameCheckRequest } from '@multiverse-kiln/shared';

import { isDevCode } from '../auth/devCodes.js';
import { hashAddress, hashesMatch, keyedHash } from '../auth/keyedHashes.js';
import { checkLoginPassword, checkPasswordForMissingAccount, hashPassword } from '../auth/passwords.js';
import { checkPwnedPassword } from '../auth/pwnedPasswords.js';
import { hasKnownBrowserCookie, knownBrowserHash } from '../auth/knownBrowsers.js';
import { MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR, MAX_LOGIN_ATTEMPTS_PER_BROWSER_HOUR, MAX_LOGIN_ATTEMPTS_PER_NETWORK_HOUR, MAX_USERNAME_CHECKS_PER_NETWORK_HOUR, takeAttempt } from '../auth/rateLimits.js';
import { endSession, resolveSession, startSession, type SessionIdentity } from '../auth/sessions.js';
import { createToken, hashToken, isTokenForm } from '../auth/tokens.js';
import type { Executor } from '../db/client.js';
import { deleteEmailCode, deletePlayerEmailCodes, lockContinuation, lockEmailCode, recordWrongEmailCodeGuess, replaceEmailCode, useEmailCode } from '../db/emailCodeRepo.js';
import { AccountTakenError, createPlayer, findLocalLogin, findPasswordHash, findPlayerByUsername, findPlayerEmail, findPlayerIdByEmail, saveEmail, savePasswordHash } from '../db/playerRepo.js';
import { lockPendingProviderLogin } from '../db/providerLoginRepo.js';
import { findRateLimitTimes, lockRateLimitSubject, recordRateLimitEvent } from '../db/rateLimitRepo.js';
import { isServerAdmin } from '../db/serverAdminRepo.js';
import { deletePlayerSessions } from '../db/sessionRepo.js';
import { inTransaction } from '../db/transactions.js';
import { deleteTrustedBrowsers, savePendingTwoFactorLogin } from '../db/twoFactorRepo.js';
import { accountCreatedEmail, accountExistsEmail, emailChangedEmail, emailCodeEmail, passwordChangedEmail } from '../email/authEmails.js';
import { sendEmailInBackground, type EmailContent } from '../email/mailer.js';
import { CONTINUATION_LIFETIME_MS, DAY_MS, decideEmailCodeSend, emailCodeFromBytes, emailCodeState, EMAIL_CODE_LENGTH, HOUR_MS, MAX_EMAIL_CODES_PER_NETWORK_HOUR, MAX_GUESSES_PER_NETWORK_HOUR, normalizeEmailCode } from '../logic/emailCodes.js';
import { connectedSessions } from '../players/connectedSessions.js';
import { displayText } from '../rooms/payloads.js';
import { addAccountDeletionRoutes } from './accountDeletion.js';
import { accountPasswordLimits, authMessages, checkDisplayName, checkUsername, cookieTokenHash, recordEvent, sendRefusal, tooManyAttempts, type AuthRefusal } from './authCommon.js';
import { clientNetworkHash } from './clientNetwork.js';
import { clearCookie, CONTINUATION_COOKIE, PROVIDER_LOGIN_COOKIE, readCookie, setCookie, TWO_FACTOR_LOGIN_COOKIE } from './cookies.js';
import { refuseWritesFromOtherOrigins } from './editorAccess.js';
import { errorMessages, sendInvalidRequest } from './errors.js';
import { addProviderRoutes } from './providerAuth.js';
import { addTwoFactorRoutes, checkAccountPassword, checkSecondFactor, needsSecondFactor, reportRecoveryCodeUse, type SecondFactorOutcome } from './twoFactorAuth.js';

/**
 * The largest request body the auth routes read
 */
const MAX_BODY_SIZE = '4kb';

/**
 * An email address as typed: trimmed, at most MAX_EMAIL_LENGTH characters, with one @ and no spaces.
 * Whether it receives email is only known by sending one
 */
const emailAddress = z.string().trim().max(MAX_EMAIL_LENGTH);

/**
 * The language a request asks its emails to be written in
 */
const locale = z.string().max(MAX_LOCALE_LENGTH).regex(/^[A-Za-z0-9-]+$/);

const loginRequest = z.object({
	email: emailAddress,
	password: z.string().max(MAX_PASSWORD_LENGTH * 4),
	rememberMe: z.boolean()
}) satisfies z.ZodType<LoginRequest>;

const emailCodeRequest = z.object({
	purpose: z.enum(EMAIL_CODE_PURPOSES),
	email: emailAddress,
	locale
}) satisfies z.ZodType<EmailCodeRequest>;

const emailCodeCheckRequest = z.object({
	purpose: z.enum(EMAIL_CODE_PURPOSES),
	email: emailAddress,
	code: z.string().max(EMAIL_CODE_LENGTH * 4)
}) satisfies z.ZodType<EmailCodeCheckRequest>;

const usernameCheckRequest = z.object({
	username: z.string().trim().max(MAX_USERNAME_LENGTH * 4)
}) satisfies z.ZodType<UsernameCheckRequest>;

const registerRequest = z.object({
	email: emailAddress,
	password: z.string().max(MAX_PASSWORD_LENGTH * 4),
	username: z.string().trim().max(MAX_USERNAME_LENGTH * 4),
	displayName: displayText(MAX_PLAYER_NAME_LENGTH),
	rememberMe: z.boolean(),
	locale
}) satisfies z.ZodType<RegisterRequest>;

const passwordResetRequest = z.object({
	password: z.string().max(MAX_PASSWORD_LENGTH * 4),
	rememberMe: z.boolean(),
	locale,
	twoFactorCode: z.string().max(MAX_TWO_FACTOR_CODE_INPUT_LENGTH).nullable()
}) satisfies z.ZodType<PasswordResetRequest>;

const emailChangeRequest = z.object({
	email: emailAddress,
	locale,
	currentPassword: z.string().max(MAX_PASSWORD_LENGTH * 4).nullable(),
	twoFactorCode: z.string().max(MAX_TWO_FACTOR_CODE_INPUT_LENGTH).nullable()
}) satisfies z.ZodType<EmailChangeRequest>;

const passwordChangeRequest = z.object({
	currentPassword: z.string().max(MAX_PASSWORD_LENGTH * 4),
	newPassword: z.string().max(MAX_PASSWORD_LENGTH * 4),
	locale
}) satisfies z.ZodType<PasswordChangeRequest>;

/**
 * Adds the auth routes under AUTH_PATH
 *
 * @param app Express app to add the routes to
 * @param allowedOrigins Normalized origins allowed to log in from a browser
 */
export function addAuthRoutes(app: Application, allowedOrigins: Set<string>): void
{
	const router = express.Router();

	router.use((_request, response, next) =>
	{
		response.set('Cache-Control', 'no-store');
		next();
	});

	// Another site's page can't log a browser in to an account of its choosing, or out
	router.use(refuseWritesFromOtherOrigins(allowedOrigins));
	router.use(express.json({ limit: MAX_BODY_SIZE }));

	router.get(underAuthPath(AUTH_SESSION_PATH), sessionRoute);
	router.post(underAuthPath(AUTH_LOGIN_PATH), loginRoute);
	router.post(underAuthPath(AUTH_LOGOUT_PATH), logoutRoute);
	router.post(underAuthPath(AUTH_CODE_PATH), sendCodeRoute);
	router.post(underAuthPath(AUTH_CODE_CHECK_PATH), checkCodeRoute);
	router.post(underAuthPath(AUTH_USERNAME_CHECK_PATH), usernameCheckRoute);
	router.post(underAuthPath(AUTH_REGISTER_PATH), registerRoute);
	router.post(underAuthPath(AUTH_PASSWORD_RESET_PATH), passwordResetRoute);
	router.post(underAuthPath(AUTH_EMAIL_CHANGE_PATH), emailChangeRoute);
	router.post(underAuthPath(AUTH_PASSWORD_CHANGE_PATH), passwordChangeRoute);
	addProviderRoutes(router, underAuthPath);
	addTwoFactorRoutes(router, underAuthPath);
	addAccountDeletionRoutes(router, underAuthPath);
	router.use(handleAuthError);

	app.use(AUTH_PATH, router);
}

/**
 * A route's path within the auth router, which is mounted at AUTH_PATH
 *
 * @param path The route's full path
 * @return The part after AUTH_PATH
 */
function underAuthPath(path: string): string
{
	return(path.slice(AUTH_PATH.length));
}

/**
 * Checks a new password's length
 *
 * @param password The password
 * @return The refusal when it is too short or too long
 */
function checkPasswordLength(password: string): AuthRefusal | undefined
{
	const length = [...password].length;

	if ((length >= MIN_PASSWORD_LENGTH) && (length <= MAX_PASSWORD_LENGTH))
	{
		return(undefined);
	}

	return({
		status: 400,
		message: authMessages.passwordLength,
		values: {
			min: MIN_PASSWORD_LENGTH,
			max: MAX_PASSWORD_LENGTH
		},
		field: 'password'
	});
}

/**
 * Checks that what was typed looks like an email address
 *
 * @param email The address, trimmed
 * @return The refusal when it doesn't
 */
function checkEmailForm(email: string): AuthRefusal | undefined
{
	if (/^[^\s@]+@[^\s@]+$/.test(email))
	{
		return(undefined);
	}

	return({
		status: 400,
		message: authMessages.emailForm,
		field: 'email'
	});
}

/**
 * Checks a new password against passwords seen in data breaches. When the service doesn't answer, the
 * password is allowed rather than blocking the player
 *
 * @param password The password
 * @return The refusal when it is breached
 */
async function checkBreachedPassword(password: string): Promise<AuthRefusal | undefined>
{
	if ((await checkPwnedPassword(password)) !== true)
	{
		return(undefined);
	}

	return({
		status: 400,
		message: authMessages.passwordBreached,
		field: 'password'
	});
}

/**
 * The continuation token the browser holds after entering an email code
 *
 * @param request The request
 * @return Its hash, or undefined when the browser has none
 */
function continuationHashOf(request: Request): Buffer | undefined
{
	return(cookieTokenHash(request, CONTINUATION_COOKIE));
}

/**
 * Whether this browser entered a code for a purpose and can still take its next step. Checked before
 * the breach check and hashing the password, so a request without one costs only a lookup; the step's
 * transaction checks again
 *
 * @param purpose What the code was for
 * @param continuationHash The hash of the browser's continuation token, if it has one
 * @param now The time now
 * @return Whether it can
 */
async function codeWasEntered(purpose: EmailCodePurpose, continuationHash: Buffer | undefined, now: Date): Promise<boolean>
{
	if (continuationHash === undefined)
	{
		return(false);
	}

	return((await inTransaction((executor) => lockContinuation(purpose, continuationHash, now, executor))) !== undefined);
}

/**
 * The browser's continuation token, when it names a code this browser entered that was sent to the
 * current address of the account changing its email address (purpose 'confirmEmailChange'). The code
 * sent to the new address takes the same token, so the change finds both
 *
 * @param request The request
 * @param playerId The account changing its address
 * @param now The time now
 * @param executor The transaction
 * @return The token, or undefined when the browser has none, or it names no such code
 */
async function confirmedChangeToken(request: Request, playerId: string, now: Date, executor: Executor): Promise<string | undefined>
{
	const token = readCookie(request.headers.cookie, CONTINUATION_COOKIE);

	if ((token === undefined) || !isTokenForm(token))
	{
		return(undefined);
	}

	const confirmation = await lockContinuation('confirmEmailChange', hashToken(token), now, executor);

	return(((confirmation?.playerId === playerId) ? token : undefined));
}

/**
 * GET AUTH_SESSION_PATH: who the browser is logged in as
 *
 * @param request The request
 * @param response The response: a SessionPayload
 */
async function sessionRoute(request: Request, response: Response): Promise<void>
{
	const session = await resolveSession(request.headers.cookie);
	const payload: SessionPayload = {
		player: (session ? {
			playerId: session.playerId,
			username: session.username,
			name: session.name,
			locale: session.locale,
			serverAdmin: await isServerAdmin(session.playerId)
		} : null)
	};

	response.json(payload);
}

/**
 * POST AUTH_LOGIN_PATH: logs in to a local account with its email address and password. A wrong
 * address and a wrong password get the same answer, in about the same time. An account with 2FA, on a
 * browser it doesn't trust, then waits for its authenticator or recovery code (twoFactorAuth.ts)
 *
 * @param request The request, with a LoginRequest
 * @param response The response: a LoginPayload, with the session cookie, or the cookie that lets this
 * browser give the code
 */
async function loginRoute(request: Request, response: Response): Promise<void>
{
	const body = loginRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { email, password, rememberMe } = body.data;
	const now = new Date();

	// A browser that has logged in to the account counts its own tries, so others' guesses at the address can't lock it out
	const ownerId = (hasKnownBrowserCookie(request) ? await findPlayerIdByEmail(email) : undefined);
	const browserHash = ((ownerId !== undefined) ? knownBrowserHash(request, ownerId, now) : undefined);
	const attempt = await inTransaction((executor) => takeAttempt([
		{
			kind: 'networkLoginAttempt',
			subjectHash: clientNetworkHash(request),
			limit: MAX_LOGIN_ATTEMPTS_PER_NETWORK_HOUR
		},
		((browserHash !== undefined)
			? {
				kind: 'browserLoginAttempt',
				subjectHash: browserHash,
				limit: MAX_LOGIN_ATTEMPTS_PER_BROWSER_HOUR
			}
			: {
				kind: 'addressLoginAttempt',
				subjectHash: hashAddress(email),
				limit: MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR
			})
	], now, executor));

	if (!attempt.allowed)
	{
		sendRefusal(response, tooManyAttempts(attempt, now, response));
		return;
	}

	const login = await findLocalLogin(email);
	const check = (login ? await checkLoginPassword(login.passwordHash, password) : undefined);

	if (!login || !check?.correct)
	{
		if (!login)
		{
			await checkPasswordForMissingAccount(password);
		}

		await recordEvent(request, (login?.id ?? null), 'loginFailed', now);
		sendRefusal(response, {
			status: 401,
			message: {
				id: 'error.auth.wrongLogin',
				defaultMessage: 'That email address and password don\'t match an account.',
				description: 'Why a login failed: no account has that address, or the password is wrong (the message doesn\'t say which, so it doesn\'t reveal who has an account)'
			}
		});
		return;
	}

	const payload = await inTransaction(async (executor): Promise<LoginPayload> =>
	{
		if (check.newHash !== undefined)
		{
			await savePasswordHash(login.id, check.newHash, executor);
			await recordEvent(request, login.id, 'passwordRehashed', now, executor);
		}

		if (await needsSecondFactor(request, login.id, now, executor))
		{
			const token = createToken();

			await savePendingTwoFactorLogin({
				continuationHash: hashToken(token),
				playerId: login.id,
				rememberMe,
				expiresAt: new Date(now.getTime() + CONTINUATION_LIFETIME_MS)
			}, executor);
			setCookie(response, TWO_FACTOR_LOGIN_COOKIE, token, CONTINUATION_LIFETIME_MS);

			return({ outcome: 'twoFactor' });
		}

		await startSession(request, response, login.id, rememberMe, executor);
		await recordEvent(request, login.id, 'loggedIn', now, executor);

		return({ outcome: 'loggedIn' });
	});

	response.json(payload);
}

/**
 * POST AUTH_LOGOUT_PATH: ends the browser's session, turning its windows away
 *
 * @param request The request
 * @param response The response: 204, and the browser forgets the cookie
 */
async function logoutRoute(request: Request, response: Response): Promise<void>
{
	const session = await resolveSession(request.headers.cookie);

	if (session)
	{
		await endSession(response, session.sessionId);
		await recordEvent(request, session.playerId, 'loggedOut', new Date());
	}

	response.sendStatus(204);
}

/**
 * What to email after a code is asked for
 */
type CodeOutcome = { kind: 'refused'; refusal: AuthRefusal } | { kind: 'send'; email: EmailContent | undefined };

/**
 * POST AUTH_CODE_PATH: sends a code, if the purpose allows one for the address. The answer is the same
 * whether or not a code was sent: registering an address that has an account emails its owner instead,
 * and resetting the password of an address without one sends nothing
 *
 * @param request The request, with an EmailCodeRequest
 * @param response The response: 204
 */
async function sendCodeRoute(request: Request, response: Response): Promise<void>
{
	const body = emailCodeRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { purpose, email, locale: emailLocale } = body.data;
	const formProblem = checkEmailForm(email);

	if (formProblem)
	{
		sendRefusal(response, formProblem);
		return;
	}

	let session: SessionIdentity | undefined;

	if (purpose === 'linkLogin')
	{
		// Linking from the profile, which needn't be logged in when linking from the login page
		session = await resolveSession(request.headers.cookie);
	}
	else if ((purpose === 'changeEmail') || (purpose === 'confirmEmailChange') || (purpose === 'deleteAccount'))
	{
		session = await resolveSession(request.headers.cookie);

		if (!session)
		{
			sendRefusal(response, {
				status: 401,
				message: errorMessages.logInFirst
			});
			return;
		}
	}

	const now = new Date();
	const addressHash = hashAddress(email);
	const networkHash = clientNetworkHash(request);
	const outcome = await inTransaction(async (executor): Promise<CodeOutcome> =>
	{
		const network = await takeAttempt([
			{
				kind: 'networkCodeRequest',
				subjectHash: networkHash,
				limit: MAX_EMAIL_CODES_PER_NETWORK_HOUR
			}
		], now, executor);

		if (!network.allowed)
		{
			return({
				kind: 'refused',
				refusal: tooManyAttempts(network, now, response)
			});
		}

		await lockRateLimitSubject(addressHash, executor);

		const send = decideEmailCodeSend({
			sentAt: await findRateLimitTimes('addressCodeSent', addressHash, new Date(now.getTime() - HOUR_MS), executor),
			wrongGuessesAt: await findRateLimitTimes('addressWrongGuess', addressHash, new Date(now.getTime() - DAY_MS), executor)
		}, now);

		if (!send.allowed)
		{
			return({
				kind: 'refused',
				refusal: tooManyAttempts(send, now, response)
			});
		}

		// Counted whatever is sent, so the limits don't depend on whether the address has an account
		await recordRateLimitEvent('addressCodeSent', addressHash, now, executor);

		const ownerId = await findPlayerIdByEmail(email, executor);
		let playerId: string | null;

		if (purpose === 'register')
		{
			if (ownerId !== undefined)
			{
				return({
					kind: 'send',
					email: accountExistsEmail(emailLocale)
				});
			}

			playerId = null;
		}
		else if (purpose === 'resetPassword')
		{
			if (ownerId === undefined)
			{
				return({
					kind: 'send',
					email: undefined
				});
			}

			playerId = ownerId;
		}
		else if (purpose === 'linkLogin')
		{
			// Only the account that a provider login waiting in this browser would be linked to, or the
			// one the browser is logged in to, linking from its profile
			const pendingHash = cookieTokenHash(request, PROVIDER_LOGIN_COOKIE);
			const pending = ((pendingHash === undefined) ? undefined : await lockPendingProviderLogin(pendingHash, now, executor));

			if ((ownerId === undefined) || ((pending?.playerId !== ownerId) && (session?.playerId !== ownerId)))
			{
				return({
					kind: 'send',
					email: undefined
				});
			}

			playerId = ownerId;
		}
		else if ((purpose === 'confirmEmailChange') || (purpose === 'deleteAccount'))
		{
			// Only the address of the account the browser is logged in to
			if ((ownerId === undefined) || (session?.playerId !== ownerId))
			{
				return({
					kind: 'send',
					email: undefined
				});
			}

			playerId = ownerId;
		}
		else
		{
			// An address another account has gets nothing, and the account's own address needs no change
			if ((ownerId !== undefined) || !session)
			{
				return({
					kind: 'send',
					email: undefined
				});
			}

			playerId = session.playerId;
		}

		const code = emailCodeFromBytes(randomBytes(EMAIL_CODE_LENGTH));

		await replaceEmailCode({
			purpose,
			addressHash,
			playerId,
			codeHash: keyedHash('emailCode', code)
		}, now, executor);

		return({
			kind: 'send',
			email: emailCodeEmail(purpose, code, emailLocale)
		});
	});

	if (outcome.kind === 'refused')
	{
		sendRefusal(response, outcome.refusal);
		return;
	}

	response.sendStatus(204);

	if (outcome.email)
	{
		sendEmailInBackground({
			to: email,
			...outcome.email
		});
	}
}

/**
 * POST AUTH_CODE_CHECK_PATH: checks an email code. A right one gives this browser, and only this one,
 * a cookie that lets it take the next step for CONTINUATION_LIFETIME_MS, and says whether that step
 * needs the account's authenticator or recovery code. A missing, expired, used or wrong code gets the
 * same answer
 *
 * @param request The request, with an EmailCodeCheckRequest
 * @param response The response: an EmailCodeCheckPayload, with the continuation cookie
 */
async function checkCodeRoute(request: Request, response: Response): Promise<void>
{
	const body = emailCodeCheckRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { purpose, email } = body.data;
	const typed = normalizeEmailCode(body.data.code);
	const forAccount = ((purpose === 'changeEmail') || (purpose === 'confirmEmailChange') || (purpose === 'deleteAccount'));
	const session = (forAccount ? await resolveSession(request.headers.cookie) : undefined);
	const now = new Date();
	const addressHash = hashAddress(email);
	const networkHash = clientNetworkHash(request);
	const outcome = await inTransaction(async (executor): Promise<AuthRefusal | { token: string; twoFactor: boolean }> =>
	{
		const network = await takeAttempt([
			{
				kind: 'networkGuess',
				subjectHash: networkHash,
				limit: MAX_GUESSES_PER_NETWORK_HOUR
			}
		], now, executor);

		if (!network.allowed)
		{
			return(tooManyAttempts(network, now, response));
		}

		const code = await lockEmailCode(purpose, addressHash, executor);
		const right = ((code !== undefined)
			&& (emailCodeState(code, now) === 'open')
			&& (!forAccount || (code.playerId === session?.playerId))
			&& (typed !== undefined)
			&& (isDevCode(typed, EMAIL_CODE_LENGTH) || hashesMatch(keyedHash('emailCode', typed), code.codeHash)));

		if (!right)
		{
			if (code)
			{
				await recordWrongEmailCodeGuess(code.id, executor);
			}

			await recordRateLimitEvent('addressWrongGuess', addressHash, now, executor);

			return({
				status: 400,
				message: {
					id: 'error.auth.wrongCode',
					defaultMessage: 'That code isn\'t right, or it has expired. Check the latest email, or ask for a new code.',
					description: 'Shown under the code field when an email code is wrong, was already used, or is too old'
				},
				field: 'code'
			});
		}

		// Changing the email address of an account without a password needs both codes, entered by one browser
		const token = ((((purpose === 'changeEmail') && (code.playerId !== null)) ? await confirmedChangeToken(request, code.playerId, now, executor) : undefined) ?? createToken());

		await useEmailCode(code.id, hashToken(token), now, new Date(now.getTime() + CONTINUATION_LIFETIME_MS), executor);

		return({
			token,
			// Only a password reset asks here: linking is told by the provider's answer (providerAuth.ts)
			twoFactor: ((purpose === 'resetPassword') && (code.playerId !== null) && await needsSecondFactor(request, code.playerId, now, executor))
		});
	});

	if ('status' in outcome)
	{
		sendRefusal(response, outcome);
		return;
	}

	const payload: EmailCodeCheckPayload = { twoFactor: outcome.twoFactor };

	setCookie(response, CONTINUATION_COOKIE, outcome.token, CONTINUATION_LIFETIME_MS);
	response.json(payload);
}

/**
 * POST AUTH_USERNAME_CHECK_PATH: says whether a new account could take a username, so the page can say
 * so before the account is created. Only a browser creating an account may ask: one that entered a
 * code to register, or has a provider login waiting for a username. Its network can ask
 * MAX_USERNAME_CHECKS_PER_NETWORK_HOUR times an hour, so usernames can't be listed by asking
 *
 * @param request The request, with a UsernameCheckRequest
 * @param response The response: 204 when the username could be taken, or the refusal registering would give
 */
async function usernameCheckRoute(request: Request, response: Response): Promise<void>
{
	const body = usernameCheckRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { username } = body.data;
	const formProblem = checkUsername(username);

	if (formProblem)
	{
		sendRefusal(response, formProblem);
		return;
	}

	const now = new Date();
	const outcome = await inTransaction(async (executor): Promise<AuthRefusal | undefined> =>
	{
		const continuationHash = continuationHashOf(request);
		const pendingHash = cookieTokenHash(request, PROVIDER_LOGIN_COOKIE);
		const registering = (((continuationHash !== undefined) && ((await lockContinuation('register', continuationHash, now, executor)) !== undefined))
			|| ((pendingHash !== undefined) && ((await lockPendingProviderLogin(pendingHash, now, executor))?.playerId === null)));

		if (!registering)
		{
			return({
				status: 403,
				message: authMessages.enterCodeFirst
			});
		}

		const attempt = await takeAttempt([
			{
				kind: 'networkUsernameCheck',
				subjectHash: clientNetworkHash(request),
				limit: MAX_USERNAME_CHECKS_PER_NETWORK_HOUR
			}
		], now, executor);

		if (!attempt.allowed)
		{
			return(tooManyAttempts(attempt, now, response));
		}

		if ((await findPlayerByUsername(username, executor)) !== undefined)
		{
			return({
				status: 409,
				message: authMessages.usernameTaken,
				field: 'username'
			});
		}

		return(undefined);
	});

	if (outcome)
	{
		sendRefusal(response, outcome);
		return;
	}

	response.sendStatus(204);
}

/**
 * POST AUTH_REGISTER_PATH: creates a local account, once this browser has entered the code sent to its
 * address, and logs the browser in
 *
 * @param request The request, with a RegisterRequest
 * @param response The response: 204 with the session cookie
 */
async function registerRoute(request: Request, response: Response): Promise<void>
{
	const body = registerRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { email, password, username, displayName, rememberMe, locale: emailLocale } = body.data;
	const continuationHash = continuationHashOf(request);
	const now = new Date();
	const problem = (checkUsername(username)
		?? checkDisplayName(displayName)
		?? checkPasswordLength(password)
		?? (!(await codeWasEntered('register', continuationHash, now)) ? { status: 403, message: authMessages.enterCodeFirst } : undefined)
		?? await checkBreachedPassword(password));

	if (problem)
	{
		sendRefusal(response, problem);
		return;
	}

	const passwordHash = await hashPassword(password);
	const outcome = await inTransaction(async (executor): Promise<AuthRefusal | undefined> =>
	{
		const code = await lockContinuation('register', continuationHash as Buffer, now, executor);

		if (!code)
		{
			return({
				status: 403,
				message: authMessages.enterCodeFirst
			});
		}

		if (!hashesMatch(code.addressHash, hashAddress(email)))
		{
			return({
				status: 400,
				message: authMessages.emailMismatch,
				field: 'email'
			});
		}

		let playerId: string;

		try
		{
			playerId = (await createPlayer({
				username,
				displayName,
				email,
				passwordHash
			}, executor)).id;
		}
		catch (error)
		{
			if (!(error instanceof AccountTakenError))
			{
				throw error;
			}

			if (error.field === 'username')
			{
				return({
					status: 409,
					message: authMessages.usernameTaken,
					field: 'username'
				});
			}

			return({
				status: 409,
				message: authMessages.emailTaken,
				field: 'email'
			});
		}

		await deleteEmailCode(code.id, executor);
		await startSession(request, response, playerId, rememberMe, executor);
		await recordEvent(request, playerId, 'registered', now, executor);
		await recordEvent(request, playerId, 'loggedIn', now, executor);

		return(undefined);
	});

	if (outcome)
	{
		sendRefusal(response, outcome);
		return;
	}

	clearCookie(response, CONTINUATION_COOKIE);
	response.sendStatus(204);
	sendEmailInBackground({
		to: email,
		...accountCreatedEmail(emailLocale)
	});
}

/**
 * POST AUTH_PASSWORD_RESET_PATH: sets a new password, once this browser has entered the code sent to
 * the account's address, and for an account with 2FA, given its authenticator or recovery code too, so
 * someone who gets into the player's email still can't take the account. Every session of the account
 * ends, every browser it trusts must give the authenticator code again, and this browser is logged in
 * afresh
 *
 * @param request The request, with a PasswordResetRequest
 * @param response The response: 204 with the session cookie
 */
async function passwordResetRoute(request: Request, response: Response): Promise<void>
{
	const body = passwordResetRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { password, rememberMe, locale: emailLocale, twoFactorCode } = body.data;
	const continuationHash = continuationHashOf(request);
	const now = new Date();
	const problem = (checkPasswordLength(password)
		?? (!(await codeWasEntered('resetPassword', continuationHash, now)) ? { status: 403, message: authMessages.enterCodeFirst } : undefined)
		?? await checkBreachedPassword(password));

	if (problem)
	{
		sendRefusal(response, problem);
		return;
	}

	const passwordHash = await hashPassword(password);
	const outcome = await inTransaction(async (executor): Promise<AuthRefusal | { playerId: string; ended: string[]; email: string | null; check: SecondFactorOutcome }> =>
	{
		const code = await lockContinuation('resetPassword', continuationHash as Buffer, now, executor);

		if (!code || (code.playerId === null))
		{
			return({
				status: 403,
				message: authMessages.enterCodeFirst
			});
		}

		const playerId = code.playerId;
		const check = await checkSecondFactor(request, response, playerId, twoFactorCode, now, executor, {
			trustedBrowserSkips: true,
			emailLocale
		});

		if ((check.kind === 'wrong') || (check.kind === 'refused'))
		{
			return(check.refusal);
		}

		await savePasswordHash(playerId, passwordHash, executor);

		const ended = await deletePlayerSessions(playerId, executor);

		// A reset is how a player takes back an account, so no browser keeps skipping its 2FA
		await deleteTrustedBrowsers(playerId, executor);
		await deletePlayerEmailCodes(playerId, executor);
		await startSession(request, response, playerId, rememberMe, executor);
		await recordEvent(request, playerId, 'passwordReset', now, executor);
		await recordEvent(request, playerId, 'loggedIn', now, executor);

		return({
			playerId,
			ended,
			email: await findPlayerEmail(playerId, executor),
			check
		});
	});

	if ('status' in outcome)
	{
		sendRefusal(response, outcome);
		return;
	}

	connectedSessions.end(outcome.ended);
	clearCookie(response, CONTINUATION_COOKIE);
	response.sendStatus(204);

	if (outcome.email !== null)
	{
		sendEmailInBackground({
			to: outcome.email,
			...passwordChangedEmail(emailLocale)
		});
	}

	await reportRecoveryCodeUse(outcome.playerId, outcome.check, emailLocale);
}

/**
 * POST AUTH_EMAIL_CHANGE_PATH: changes the logged-in account's email address, once this browser has
 * entered the code sent to the new address. The player shows it's the owner, not just someone with the
 * session, since the new address can reset the password: with the account's password, or for an
 * account without one, the code sent to its current address that this browser entered, and with 2FA,
 * its authenticator or recovery code, even from a trusted browser. Every other browser logged in to
 * the account is logged out, and both addresses are told
 *
 * @param request The request, with an EmailChangeRequest
 * @param response The response: 204
 */
async function emailChangeRoute(request: Request, response: Response): Promise<void>
{
	const body = emailChangeRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { email, locale: emailLocale, currentPassword, twoFactorCode } = body.data;
	const session = await resolveSession(request.headers.cookie);
	const continuationHash = continuationHashOf(request);

	if (!session)
	{
		sendRefusal(response, {
			status: 401,
			message: errorMessages.logInFirst
		});
		return;
	}

	if (continuationHash === undefined)
	{
		sendRefusal(response, {
			status: 403,
			message: authMessages.enterCodeFirst
		});
		return;
	}

	const now = new Date();
	const hasPassword = ((await findPasswordHash(session.playerId)) !== null);

	if (hasPassword)
	{
		const problem = await checkAccountPassword(request, response, session.playerId, (currentPassword ?? ''), now);

		if (problem)
		{
			sendRefusal(response, problem);
			return;
		}
	}

	const outcome = await inTransaction(async (executor): Promise<AuthRefusal | { oldEmail: string | null; ended: string[]; check: SecondFactorOutcome }> =>
	{
		const code = await lockContinuation('changeEmail', continuationHash, now, executor);

		if (!code || (code.playerId !== session.playerId))
		{
			return({
				status: 403,
				message: authMessages.enterCodeFirst
			});
		}

		if (!hashesMatch(code.addressHash, hashAddress(email)))
		{
			return({
				status: 400,
				message: authMessages.emailMismatch,
				field: 'email'
			});
		}

		const oldEmail = await findPlayerEmail(session.playerId, executor);

		// An account without a password or an address has nothing else to check it's the owner with
		if (!hasPassword && (oldEmail !== null))
		{
			const confirmation = await lockContinuation('confirmEmailChange', continuationHash, now, executor);

			if (!confirmation || (confirmation.playerId !== session.playerId))
			{
				return({
					status: 403,
					message: authMessages.enterCodeFirst
				});
			}
		}

		const check = await checkSecondFactor(request, response, session.playerId, twoFactorCode, now, executor, {
			trustedBrowserSkips: false,
			emailLocale
		});

		if ((check.kind === 'wrong') || (check.kind === 'refused'))
		{
			return(check.refusal);
		}

		try
		{
			await saveEmail(session.playerId, email, executor);
		}
		catch (error)
		{
			if (!(error instanceof AccountTakenError))
			{
				throw error;
			}

			return({
				status: 409,
				message: authMessages.emailTaken,
				field: 'email'
			});
		}

		// Codes sent to the old address, such as for a password reset, no longer act for the account
		await deletePlayerEmailCodes(session.playerId, executor);

		const ended = await deletePlayerSessions(session.playerId, executor, session.sessionId);

		await recordEvent(request, session.playerId, 'emailChanged', now, executor);

		return({
			oldEmail,
			ended,
			check
		});
	});

	if ('status' in outcome)
	{
		sendRefusal(response, outcome);
		return;
	}

	connectedSessions.end(outcome.ended);
	clearCookie(response, CONTINUATION_COOKIE);
	response.sendStatus(204);
	await reportRecoveryCodeUse(session.playerId, outcome.check, emailLocale);

	if (outcome.oldEmail !== null)
	{
		sendEmailInBackground({
			to: outcome.oldEmail,
			...emailChangedEmail({
				address: 'old',
				newAddress: email
			}, emailLocale)
		});
	}

	sendEmailInBackground({
		to: email,
		...emailChangedEmail({ address: 'new' }, emailLocale)
	});
}

/**
 * POST AUTH_PASSWORD_CHANGE_PATH: changes the logged-in account's password, once the current one is
 * given. Every other browser logged in to the account is logged out, and the account is told
 *
 * @param request The request, with a PasswordChangeRequest
 * @param response The response: 204
 */
async function passwordChangeRoute(request: Request, response: Response): Promise<void>
{
	const body = passwordChangeRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { currentPassword, newPassword, locale: emailLocale } = body.data;
	const session = await resolveSession(request.headers.cookie);

	if (!session)
	{
		sendRefusal(response, {
			status: 401,
			message: errorMessages.logInFirst
		});
		return;
	}

	const problem = (checkPasswordLength(newPassword) ?? await checkBreachedPassword(newPassword));

	if (problem)
	{
		sendRefusal(response, problem);
		return;
	}

	const now = new Date();
	const email = await findPlayerEmail(session.playerId);
	const attempt = await inTransaction((executor) => takeAttempt(accountPasswordLimits(request, email), now, executor));

	if (!attempt.allowed)
	{
		sendRefusal(response, tooManyAttempts(attempt, now, response));
		return;
	}

	const passwordHash = await findPasswordHash(session.playerId);

	if (passwordHash === null)
	{
		sendRefusal(response, {
			status: 400,
			message: {
				id: 'error.auth.noPassword',
				defaultMessage: 'Your account has no password to change. To give it one, log out and use "Forgot your password?" on the login page.',
				description: 'Why changing the password was refused: the account logs in only with Google or Discord, so it has no password yet'
			}
		});
		return;
	}

	if (!(await checkLoginPassword(passwordHash, currentPassword)).correct)
	{
		await recordEvent(request, session.playerId, 'loginFailed', now);
		sendRefusal(response, {
			status: 401,
			message: {
				id: 'error.auth.wrongCurrentPassword',
				defaultMessage: 'That isn\'t your current password.',
				description: 'Shown under the current password field when changing the password, and the password typed is wrong'
			},
			field: 'currentPassword'
		});
		return;
	}

	const newHash = await hashPassword(newPassword);
	const ended = await inTransaction(async (executor) =>
	{
		await savePasswordHash(session.playerId, newHash, executor);

		const ended = await deletePlayerSessions(session.playerId, executor, session.sessionId);

		// A password reset asked for before the change can't undo it
		await deletePlayerEmailCodes(session.playerId, executor);
		await recordEvent(request, session.playerId, 'passwordChanged', now, executor);

		return(ended);
	});

	connectedSessions.end(ended);
	response.sendStatus(204);

	if (email !== null)
	{
		sendEmailInBackground({
			to: email,
			...passwordChangedEmail(emailLocale)
		});
	}
}

/**
 * Answers a request whose body couldn't be read with its 4xx status, and anything else that went wrong with 500
 *
 * @param error What went wrong
 * @param request The request
 * @param response The response
 * @param next Passes the error on when the answer has already started
 */
function handleAuthError(error: unknown, request: Request, response: Response, next: NextFunction): void
{
	if (response.headersSent)
	{
		next(error);
		return;
	}

	const status = (((typeof error === 'object') && (error !== null) && ('status' in error) && (typeof error.status === 'number')) ? error.status : 500);

	if ((status >= 400) && (status < 500))
	{
		sendRefusal(response, {
			status,
			message: errorMessages.unreadableBody
		});
		return;
	}

	console.error('Auth request %s %s failed:', request.method, request.originalUrl, error);
	sendRefusal(response, {
		status: 500,
		message: errorMessages.somethingWentWrong
	});
}
