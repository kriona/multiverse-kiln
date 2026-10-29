/**
 * The auth routes (listed in shared/src/accounts.ts): the browser's session, logging in and out, and
 * the email code flows for registering, resetting a password and changing an email address (see Login
 * and Email codes in STRUCTURE-OVERVIEW.md)
 *
 * Nothing these routes answer tells whether an account exists for an address: logins fail with the
 * same message either way, and sending a code answers the same whether or not one was sent. Emails go
 * after the answer, so its timing doesn't tell either
 */
import { randomBytes } from 'crypto';
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { AUTH_CODE_CHECK_PATH, AUTH_CODE_PATH, AUTH_EMAIL_CHANGE_PATH, AUTH_LOGIN_PATH, AUTH_PATH, AUTH_LOGOUT_PATH, AUTH_PASSWORD_RESET_PATH, AUTH_REGISTER_PATH, AUTH_SESSION_PATH, defineMessages, EMAIL_CODE_PURPOSES, HANDLE_PATTERN, isReservedName, localize, MAX_EMAIL_LENGTH, MAX_HANDLE_LENGTH, MAX_LOCALE_LENGTH, MAX_PASSWORD_LENGTH, MAX_PLAYER_NAME_LENGTH, MIN_HANDLE_LENGTH, MIN_PASSWORD_LENGTH, NAME_MESSAGES, type AuthErrorPayload, type AuthField, type EmailChangeRequest, type EmailCodeCheckRequest, type EmailCodeRequest, type LoginRequest, type MessageDescriptor, type MessageValues, type PasswordResetRequest, type RegisterRequest, type SessionPayload } from '@multiverse-kiln/shared';

import { hashAddress, hashesMatch, keyedHash } from '../auth/keyedHashes.js';
import { checkLoginPassword, checkPasswordForMissingAccount, hashPassword } from '../auth/passwords.js';
import { checkPwnedPassword } from '../auth/pwnedPasswords.js';
import { MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR, MAX_LOGIN_ATTEMPTS_PER_NETWORK_HOUR, takeAttempt } from '../auth/rateLimits.js';
import { endSession, resolveSession, startSession, type SessionIdentity } from '../auth/sessions.js';
import { createToken, hashToken, isTokenForm } from '../auth/tokens.js';
import { recordAuthEvent, type AuthEventKind } from '../db/authEventRepo.js';
import type { Executor } from '../db/client.js';
import { deleteEmailCode, lockContinuation, lockEmailCode, recordWrongEmailCodeGuess, replaceEmailCode, useEmailCode } from '../db/emailCodeRepo.js';
import { AccountTakenError, createPlayer, findLocalLogin, findPlayerEmail, findPlayerIdByEmail, saveEmail, savePasswordHash } from '../db/playerRepo.js';
import { findRateLimitTimes, lockRateLimitSubject, recordRateLimitEvent } from '../db/rateLimitRepo.js';
import { deletePlayerSessions } from '../db/sessionRepo.js';
import { inTransaction } from '../db/transactions.js';
import { accountCreatedEmail, accountExistsEmail, emailChangedEmail, emailCodeEmail, passwordChangedEmail } from '../email/authEmails.js';
import { sendEmailInBackground, type EmailContent } from '../email/mailer.js';
import { CONTINUATION_LIFETIME_MS, DAY_MS, decideEmailCodeSend, emailCodeFromBytes, emailCodeState, EMAIL_CODE_LENGTH, HOUR_MS, MAX_EMAIL_CODES_PER_NETWORK_HOUR, MAX_GUESSES_PER_NETWORK_HOUR, normalizeEmailCode, type SendDecision } from '../logic/emailCodes.js';
import { connectedSessions } from '../players/connectedSessions.js';
import { displayText } from '../rooms/payloads.js';
import { clientNetworkHash } from './clientNetwork.js';
import { clearCookie, CONTINUATION_COOKIE, readCookie, setCookie } from './cookies.js';
import { refuseWritesFromOtherOrigins } from './editorAccess.js';
import { errorMessages, sendInvalidRequest } from './errors.js';

/**
 * The largest request body the auth routes read
 */
const MAX_BODY_SIZE = '4kb';

/**
 * Reasons the auth routes give in more than one place (see shared/src/localization.ts)
 */
const authMessages = defineMessages({
	tooManyAttempts: {
		id: 'error.auth.tooManyAttempts',
		defaultMessage: 'Too many tries. Try again in {minutes, plural, one {# minute} other {# minutes}}.',
		description: 'Why a login wasn\'t tried, an email code wasn\'t sent, or a code wasn\'t checked: too many were tried or asked for from this network or for this address in the past hour, or a code was sent to the address less than a minute ago'
	},
	enterCodeFirst: {
		id: 'error.auth.enterCodeFirst',
		defaultMessage: 'Enter the code from the email first, or ask for a new one if it has been more than a few minutes.',
		description: 'Why creating an account, choosing a new password or changing an email address was refused: this browser hasn\'t entered the email code, or entered it too long ago'
	},
	emailMismatch: {
		id: 'error.auth.emailMismatch',
		defaultMessage: 'That isn\'t the address the code was sent to.',
		description: 'Shown under the email field when creating an account or changing an email address: the address typed differs from the one the code was sent to'
	},
	emailForm: {
		id: 'error.auth.emailForm',
		defaultMessage: 'Enter an email address, like name@example.com.',
		description: 'Shown under an email field when what was typed isn\'t an email address'
	},
	passwordLength: {
		id: 'error.auth.passwordLength',
		defaultMessage: 'Use a password of {min} to {max} characters.',
		description: 'Shown under a new password field when the password is too short or too long; {min} and {max} are numbers'
	},
	passwordBreached: {
		id: 'error.auth.passwordBreached',
		defaultMessage: 'This password has turned up in a data breach, so attackers try it. Choose another.',
		description: 'Shown under a new password field when the password is on HaveIBeenPwned\'s list of passwords leaked in data breaches'
	},
	emailTaken: {
		id: 'error.auth.emailTaken',
		defaultMessage: 'Another account already uses that address.',
		description: 'Why an account wasn\'t created, or its email address wasn\'t changed: the address belongs to another account. Only shown after the player proved they can read that address\'s email'
	}
});

/**
 * Why a request is refused, decided inside a transaction where the response isn't at hand
 */
interface AuthRefusal
{
	status: number;
	message: MessageDescriptor;
	values?: MessageValues;
	field?: AuthField;
}

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

const registerRequest = z.object({
	email: emailAddress,
	password: z.string().max(MAX_PASSWORD_LENGTH * 4),
	handle: z.string().trim().max(MAX_HANDLE_LENGTH * 4),
	displayName: displayText(MAX_PLAYER_NAME_LENGTH),
	rememberMe: z.boolean(),
	locale
}) satisfies z.ZodType<RegisterRequest>;

const passwordResetRequest = z.object({
	password: z.string().max(MAX_PASSWORD_LENGTH * 4),
	rememberMe: z.boolean(),
	locale
}) satisfies z.ZodType<PasswordResetRequest>;

const emailChangeRequest = z.object({
	email: emailAddress,
	locale
}) satisfies z.ZodType<EmailChangeRequest>;

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
	router.post(underAuthPath(AUTH_REGISTER_PATH), registerRoute);
	router.post(underAuthPath(AUTH_PASSWORD_RESET_PATH), passwordResetRoute);
	router.post(underAuthPath(AUTH_EMAIL_CHANGE_PATH), emailChangeRoute);
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
 * Answers a request with an error, and the field it is about
 *
 * @param response The response
 * @param refusal Why the request was refused
 */
function sendRefusal(response: Response, refusal: AuthRefusal): void
{
	const payload: AuthErrorPayload = { error: localize(refusal.message, refusal.values) };

	if (refusal.field !== undefined)
	{
		payload.field = refusal.field;
	}

	response.status(refusal.status).json(payload);
}

/**
 * The refusal for an attempt over a rate limit, saying how long to wait
 *
 * @param decision The limit's decision
 * @param now The time now
 * @param response The response, which gets a Retry-After header
 * @return The refusal
 */
function tooManyAttempts(decision: SendDecision & { allowed: false }, now: Date, response: Response): AuthRefusal
{
	const seconds = Math.max(1, Math.ceil((decision.retryAt.getTime() - now.getTime()) / 1000));

	response.set('Retry-After', String(seconds));

	return({
		status: 429,
		message: authMessages.tooManyAttempts,
		values: {
			minutes: Math.ceil(seconds / 60)
		}
	});
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
 * Records an auth event for a request
 *
 * @param request The request
 * @param playerId The account, or null when it isn't known
 * @param kind What happened
 * @param now When
 * @param executor The database, or a transaction
 */
async function recordEvent(request: Request, playerId: string | null, kind: AuthEventKind, now: Date, executor?: Executor): Promise<void>
{
	await recordAuthEvent({
		playerId,
		kind,
		networkHash: clientNetworkHash(request),
		occurredAt: now
	}, executor);
}

/**
 * The continuation token the browser holds after entering an email code
 *
 * @param request The request
 * @return Its hash, or undefined when the browser has none
 */
function continuationHashOf(request: Request): Buffer | undefined
{
	const token = readCookie(request.headers.cookie, CONTINUATION_COOKIE);

	return((((token !== undefined) && isTokenForm(token)) ? hashToken(token) : undefined));
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
			handle: session.handle,
			name: session.name
		} : null)
	};

	response.json(payload);
}

/**
 * POST AUTH_LOGIN_PATH: logs in to a local account with its email address and password. A wrong
 * address and a wrong password get the same answer, in about the same time
 *
 * @param request The request, with a LoginRequest
 * @param response The response: 204 with the session cookie
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
	const attempt = await inTransaction((executor) => takeAttempt([
		{
			kind: 'networkLoginAttempt',
			subjectHash: clientNetworkHash(request),
			limit: MAX_LOGIN_ATTEMPTS_PER_NETWORK_HOUR
		},
		{
			kind: 'addressLoginAttempt',
			subjectHash: hashAddress(email),
			limit: MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR
		}
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

	await inTransaction(async (executor) =>
	{
		if (check.newHash !== undefined)
		{
			await savePasswordHash(login.id, check.newHash, executor);
			await recordEvent(request, login.id, 'passwordRehashed', now, executor);
		}

		await startSession(response, login.id, rememberMe, executor);
		await recordEvent(request, login.id, 'loggedIn', now, executor);
	});

	response.sendStatus(204);
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

	if (purpose === 'changeEmail')
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
 * a cookie that lets it take the next step for CONTINUATION_LIFETIME_MS. A missing, expired, used or
 * wrong code gets the same answer
 *
 * @param request The request, with an EmailCodeCheckRequest
 * @param response The response: 204 with the continuation cookie
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
	const session = ((purpose === 'changeEmail') ? await resolveSession(request.headers.cookie) : undefined);
	const now = new Date();
	const addressHash = hashAddress(email);
	const networkHash = clientNetworkHash(request);
	const outcome = await inTransaction(async (executor): Promise<AuthRefusal | string> =>
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
			&& ((purpose !== 'changeEmail') || (code.playerId === session?.playerId))
			&& (typed !== undefined)
			&& hashesMatch(keyedHash('emailCode', typed), code.codeHash));

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

		const token = createToken();

		await useEmailCode(code.id, hashToken(token), now, new Date(now.getTime() + CONTINUATION_LIFETIME_MS), executor);

		return(token);
	});

	if (typeof outcome !== 'string')
	{
		sendRefusal(response, outcome);
		return;
	}

	setCookie(response, CONTINUATION_COOKIE, outcome, CONTINUATION_LIFETIME_MS);
	response.sendStatus(204);
}

/**
 * Checks a new handle's form
 *
 * @param handle The handle, trimmed
 * @return The refusal when it can't be taken
 */
function checkHandle(handle: string): AuthRefusal | undefined
{
	if ((handle.length < MIN_HANDLE_LENGTH) || (handle.length > MAX_HANDLE_LENGTH) || !HANDLE_PATTERN.test(handle))
	{
		return({
			status: 400,
			message: {
				id: 'error.auth.handleForm',
				defaultMessage: 'Use {min} to {max} letters (a to z), digits and underscores.',
				description: 'Shown under the handle field when the handle has other characters, or is too short or too long; {min} and {max} are numbers'
			},
			values: {
				min: MIN_HANDLE_LENGTH,
				max: MAX_HANDLE_LENGTH
			},
			field: 'handle'
		});
	}

	if (isReservedName(handle))
	{
		return({
			status: 400,
			message: NAME_MESSAGES.reserved,
			field: 'handle'
		});
	}

	return(undefined);
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

	const { email, password, handle, displayName, rememberMe, locale: emailLocale } = body.data;
	const continuationHash = continuationHashOf(request);
	const problem = (checkHandle(handle)
		?? (isReservedName(displayName) ? { status: 400, message: NAME_MESSAGES.reserved, field: 'displayName' as const } : undefined)
		?? checkPasswordLength(password)
		?? ((continuationHash === undefined) ? { status: 403, message: authMessages.enterCodeFirst } : undefined)
		?? await checkBreachedPassword(password));

	if (problem)
	{
		sendRefusal(response, problem);
		return;
	}

	const passwordHash = await hashPassword(password);
	const now = new Date();
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
				handle,
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

			if (error.field === 'handle')
			{
				return({
					status: 409,
					message: {
						id: 'error.auth.handleTaken',
						defaultMessage: 'Another account already has that handle. Choose another.',
						description: 'Shown under the handle field when creating an account: handles are unique, ignoring capitals'
					},
					field: 'handle'
				});
			}

			return({
				status: 409,
				message: authMessages.emailTaken,
				field: 'email'
			});
		}

		await deleteEmailCode(code.id, executor);
		await startSession(response, playerId, rememberMe, executor);
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
 * the account's address. Every session of the account ends, and this browser is logged in afresh
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

	const { password, rememberMe, locale: emailLocale } = body.data;
	const continuationHash = continuationHashOf(request);
	const problem = (checkPasswordLength(password)
		?? ((continuationHash === undefined) ? { status: 403, message: authMessages.enterCodeFirst } : undefined)
		?? await checkBreachedPassword(password));

	if (problem)
	{
		sendRefusal(response, problem);
		return;
	}

	const passwordHash = await hashPassword(password);
	const now = new Date();
	const outcome = await inTransaction(async (executor): Promise<AuthRefusal | { ended: string[]; email: string | null }> =>
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

		await savePasswordHash(playerId, passwordHash, executor);

		const ended = await deletePlayerSessions(playerId, executor);

		await deleteEmailCode(code.id, executor);
		await startSession(response, playerId, rememberMe, executor);
		await recordEvent(request, playerId, 'passwordReset', now, executor);
		await recordEvent(request, playerId, 'loggedIn', now, executor);

		return({
			ended,
			email: await findPlayerEmail(playerId, executor)
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
}

/**
 * POST AUTH_EMAIL_CHANGE_PATH: changes the logged-in account's email address, once this browser has
 * entered the code sent to the new address. Both addresses are told
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

	const { email, locale: emailLocale } = body.data;
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
	const outcome = await inTransaction(async (executor): Promise<AuthRefusal | { oldEmail: string | null }> =>
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

		await deleteEmailCode(code.id, executor);
		await recordEvent(request, session.playerId, 'emailChanged', now, executor);

		return({ oldEmail });
	});

	if ('status' in outcome)
	{
		sendRefusal(response, outcome);
		return;
	}

	clearCookie(response, CONTINUATION_COOKIE);
	response.sendStatus(204);

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

	console.error(`Auth request ${request.method} ${request.originalUrl} failed:`, error);
	sendRefusal(response, {
		status: 500,
		message: errorMessages.somethingWentWrong
	});
}
