/**
 * Logging in with Google or Discord (see Login in STRUCTURE-OVERVIEW.md), on the auth router
 *
 * The login page starts a login (AUTH_PROVIDER_START_PATH) and sends the browser to the provider, which
 * sends it back to the login page with a code. The page hands the code over
 * (AUTH_PROVIDER_CALLBACK_PATH), and a provider login an account has logs the browser in, after the
 * authenticator code when the account has 2FA and doesn't trust the browser. Otherwise the
 * login waits a few minutes for one more step from that browser: choosing a username for a new account
 * (AUTH_PROVIDER_REGISTER_PATH), or, when a local account has the same email address, logging in to it
 * to link them (AUTH_PROVIDER_LINK_PATH), with its authenticator or recovery code too when it has 2FA.
 * A provider login is never linked to an account by its email address alone
 *
 * A logged-in player links a provider from their profile the same way: the start says so, with the
 * account's password (or an emailed code) and 2FA code, and the callback links the provider login to
 * the account the browser is still logged in to
 */
import type { Request, Response, Router } from 'express';
import { generateCodeVerifier, generateState } from 'arctic';
import { z } from 'zod';
import { AUTH_PROVIDER_CALLBACK_PATH, AUTH_PROVIDER_LINK_PATH, AUTH_PROVIDER_REGISTER_PATH, AUTH_PROVIDER_START_PATH, AUTH_PROVIDERS_PATH, defineMessages, LOGIN_PROVIDER_NAMES, LOGIN_PROVIDERS, MAX_LOCALE_LENGTH, MAX_PASSWORD_LENGTH, MAX_PLAYER_NAME_LENGTH, MAX_TWO_FACTOR_CODE_INPUT_LENGTH, MAX_USERNAME_LENGTH, type LoginProvider, type ProviderCallbackPayload, type ProviderCallbackRequest, type ProviderLinkConfirmation, type ProviderLinkRequest, type ProviderRegisterRequest, type ProvidersPayload, type ProviderStartPayload, type ProviderStartRequest } from '@multiverse-kiln/shared';

import { hashAddress, hashesMatch, keyedHash } from '../auth/keyedHashes.js';
import { checkLoginPassword } from '../auth/passwords.js';
import { enabledProviders, providerClient, ProviderLoginError, type ProviderUser } from '../auth/providers.js';
import { MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR, MAX_LOGIN_ATTEMPTS_PER_NETWORK_HOUR, takeAttempt } from '../auth/rateLimits.js';
import { resolveSession, startSession } from '../auth/sessions.js';
import { createToken, hashToken } from '../auth/tokens.js';
import type { Executor } from '../db/client.js';
import { deleteEmailCode, lockContinuation } from '../db/emailCodeRepo.js';
import { AccountTakenError, createPlayer, findLocalLogin, findPasswordHash, findPlayerEmail, findPlayerIdByEmail, savePasswordHash } from '../db/playerRepo.js';
import { addProviderLogin, deletePendingProviderLogin, findProviderLoginPlayer, lockPendingProviderLogin, ProviderLoginTakenError, savePendingProviderLogin, type PendingProviderLogin } from '../db/providerLoginRepo.js';
import { inTransaction } from '../db/transactions.js';
import { savePendingTwoFactorLogin } from '../db/twoFactorRepo.js';
import { accountCreatedEmail, providerLinkedEmail } from '../email/authEmails.js';
import { sendEmailInBackground } from '../email/mailer.js';
import { CONTINUATION_LIFETIME_MS } from '../logic/emailCodes.js';
import { displayText } from '../rooms/payloads.js';
import { authMessages, checkDisplayName, checkUsername, cookieTokenHash, recordEvent, sendRefusal, tooManyAttempts, type AuthRefusal } from './authCommon.js';
import { clientNetworkHash } from './clientNetwork.js';
import { clearCookie, CONTINUATION_COOKIE, PROVIDER_LOGIN_COOKIE, PROVIDER_START_COOKIE, readCookie, setCookie, TWO_FACTOR_LOGIN_COOKIE } from './cookies.js';
import { errorMessages, sendInvalidRequest } from './errors.js';
import { checkAccountPassword, checkSecondFactor, needsSecondFactor, reportRecoveryCodeUse, requireSession, type SecondFactorOutcome } from './twoFactorAuth.js';

/**
 * How long a player has at the provider before the login must start again
 */
const PROVIDER_START_LIFETIME_MS = 10 * 60 * 1000;

/**
 * The longest code and state read from a provider's answer
 */
const MAX_PROVIDER_VALUE_LENGTH = 2048;

/**
 * Reasons the provider routes give (see shared/src/localization.ts)
 */
const providerMessages = defineMessages({
	notOffered: {
		id: 'error.auth.providerNotOffered',
		defaultMessage: 'This site doesn\'t offer logging in with {provider}.',
		description: 'Why logging in with Google or Discord didn\'t start: the site isn\'t set up for it; {provider} is Google or Discord'
	},
	failed: {
		id: 'error.auth.providerFailed',
		defaultMessage: 'Logging in with {provider} didn\'t finish. Try again.',
		description: 'Why logging in with Google or Discord failed after coming back from it: the login took too long, was started in another browser, or the provider refused it; {provider} is Google or Discord'
	},
	notFinished: {
		id: 'error.auth.providerNotFinished',
		defaultMessage: 'Logging in with Google or Discord didn\'t finish. Try again.',
		description: 'Why logging in with Google or Discord failed after coming back from it, when it isn\'t known which: this browser didn\'t start the login, or started it too long ago'
	},
	unavailable: {
		id: 'error.auth.providerUnavailable',
		defaultMessage: '{provider} didn\'t answer. Try again in a few minutes.',
		description: 'Why logging in with Google or Discord failed: the server couldn\'t reach it, or it answered with something unexpected; {provider} is Google or Discord'
	},
	noVerifiedEmail: {
		id: 'error.auth.providerNoVerifiedEmail',
		defaultMessage: 'Your {provider} account has no verified email address. Verify one with {provider} first, or create an account with your email address.',
		description: 'Why logging in with Google or Discord failed: the provider has no email address for the player that it checked they can read, and every account needs one; {provider} is Google or Discord'
	},
	startAgain: {
		id: 'error.auth.providerStartAgain',
		defaultMessage: 'It has been more than a few minutes since you logged in with Google or Discord. Log in with it again.',
		description: 'Why creating an account or linking a login after logging in with Google or Discord was refused: this browser came back from the provider too long ago, or not at all'
	},
	otherAccount: {
		id: 'error.auth.providerOtherAccount',
		defaultMessage: 'That {provider} account is already linked to another account here.',
		description: 'Why linking a Google or Discord login, or creating an account with it, was refused: another account has that provider login; {provider} is Google or Discord'
	},
	otherLogin: {
		id: 'error.auth.providerOtherLogin',
		defaultMessage: 'Your account already has a different {provider} login. Log in with that one, or with your password.',
		description: 'Why linking a Google or Discord login was refused: the account already has a login with the same provider, from another account there; {provider} is Google or Discord'
	},
	otherLoginLinked: {
		id: 'error.auth.providerOtherLoginLinked',
		defaultMessage: 'Your account already has a different {provider} login.',
		description: 'Why linking a Google or Discord login from the player\'s own profile was refused: the account already has a login with the same provider, from another account there; {provider} is Google or Discord'
	}
});

/**
 * What the start cookie holds
 */
const providerStart = z.object({
	provider: z.enum(LOGIN_PROVIDERS),
	state: z.string(),
	codeVerifier: z.string(),
	rememberMe: z.boolean(),

	// The account a link is for, which the browser must still be logged in to when it comes back; null for a login
	playerId: z.string().nullable()
});

type ProviderStart = z.infer<typeof providerStart>;

/**
 * The language a request asks its emails to be written in
 */
const locale = z.string().max(MAX_LOCALE_LENGTH).regex(/^[A-Za-z0-9-]+$/);

const providerStartRequest = z.object({
	provider: z.enum(LOGIN_PROVIDERS),
	rememberMe: z.boolean(),
	link: z.object({
		password: z.string().max(MAX_PASSWORD_LENGTH * 4).nullable(),
		twoFactorCode: z.string().max(MAX_TWO_FACTOR_CODE_INPUT_LENGTH).nullable(),
		locale
	}).nullable()
}) satisfies z.ZodType<ProviderStartRequest>;

const providerCallbackRequest = z.object({
	code: z.string().min(1).max(MAX_PROVIDER_VALUE_LENGTH),
	state: z.string().min(1).max(MAX_PROVIDER_VALUE_LENGTH),
	locale
}) satisfies z.ZodType<ProviderCallbackRequest>;

const providerRegisterRequest = z.object({
	username: z.string().trim().max(MAX_USERNAME_LENGTH * 4),
	displayName: displayText(MAX_PLAYER_NAME_LENGTH),
	locale
}) satisfies z.ZodType<ProviderRegisterRequest>;

const providerLinkRequest = z.object({
	password: z.string().max(MAX_PASSWORD_LENGTH * 4).nullable(),
	locale,
	twoFactorCode: z.string().max(MAX_TWO_FACTOR_CODE_INPUT_LENGTH).nullable()
}) satisfies z.ZodType<ProviderLinkRequest>;

/**
 * Adds the provider routes to the auth router
 *
 * @param router The auth router
 * @param underAuthPath A route's path within the router, from its full path
 */
export function addProviderRoutes(router: Router, underAuthPath: (path: string) => string): void
{
	router.get(underAuthPath(AUTH_PROVIDERS_PATH), providersRoute);
	router.post(underAuthPath(AUTH_PROVIDER_START_PATH), startRoute);
	router.post(underAuthPath(AUTH_PROVIDER_CALLBACK_PATH), callbackRoute);
	router.post(underAuthPath(AUTH_PROVIDER_REGISTER_PATH), registerRoute);
	router.post(underAuthPath(AUTH_PROVIDER_LINK_PATH), linkRoute);
}

/**
 * The refusal for a login a provider didn't finish
 *
 * @param provider The provider
 * @return The refusal
 */
function providerFailed(provider: LoginProvider): AuthRefusal
{
	return({
		status: 400,
		message: providerMessages.failed,
		values: {
			provider: LOGIN_PROVIDER_NAMES[provider]
		}
	});
}

/**
 * The refusal for a login that can't be linked to an account, or used to create one
 *
 * @param error Why
 * @param provider The provider
 * @param loggedIn Whether the player is logged in to the account, linking from its profile
 * @return The refusal
 */
function loginTaken(error: ProviderLoginTakenError, provider: LoginProvider, loggedIn: boolean = false): AuthRefusal
{
	const otherLogin = (loggedIn ? providerMessages.otherLoginLinked : providerMessages.otherLogin);

	return({
		status: 409,
		message: ((error.by === 'otherAccount') ? providerMessages.otherAccount : otherLogin),
		values: {
			provider: LOGIN_PROVIDER_NAMES[provider]
		}
	});
}

/**
 * The start cookie's value: the start as base64url JSON, then a keyed hash of it, so the server reads
 * back only a start it wrote. The browser can't change which account a login links to, or skip the
 * check confirmLink() makes before a link starts
 *
 * @param start What the login started with
 * @return The cookie's value
 */
function encodeProviderStart(start: ProviderStart): string
{
	const body = Buffer.from(JSON.stringify(start)).toString('base64url');

	return(`${body}.${keyedHash('providerStart', body).toString('base64url')}`);
}

/**
 * Reads the start cookie
 *
 * @param request The request
 * @return What the login started with, or undefined when the browser has no start cookie, or it is
 * unreadable or wasn't written by this server
 */
function readProviderStart(request: Request): ProviderStart | undefined
{
	const value = readCookie(request.headers.cookie, PROVIDER_START_COOKIE);
	const [body, mac, extra] = (value ?? '').split('.');

	if (!body || !mac || (extra !== undefined) || !hashesMatch(keyedHash('providerStart', body), Buffer.from(mac, 'base64url')))
	{
		return(undefined);
	}

	try
	{
		const parsed = providerStart.safeParse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')));

		return((parsed.success ? parsed.data : undefined));
	}
	catch
	{
		return(undefined);
	}
}

/**
 * The pending provider login the browser came back from the provider with, locked until the
 * transaction ends
 *
 * @param request The request
 * @param now The time now
 * @param executor A transaction
 * @return The login, or the refusal when the browser has none, or it has expired
 */
async function lockBrowserLogin(request: Request, now: Date, executor: Executor): Promise<PendingProviderLogin | AuthRefusal>
{
	const pendingHash = cookieTokenHash(request, PROVIDER_LOGIN_COOKIE);
	const pending = ((pendingHash === undefined) ? undefined : await lockPendingProviderLogin(pendingHash, now, executor));

	return((pending ?? {
		status: 403,
		message: providerMessages.startAgain
	}));
}

/**
 * GET AUTH_PROVIDERS_PATH: the providers the site offers
 *
 * @param _request The request
 * @param response The response: a ProvidersPayload
 */
function providersRoute(_request: Request, response: Response): void
{
	const payload: ProvidersPayload = { providers: enabledProviders() };

	response.json(payload);
}

/**
 * POST AUTH_PROVIDER_START_PATH: starts a login with a provider, or a link to the account the browser
 * is logged in to, once the player confirms it (confirmLink()). The browser keeps the state and PKCE
 * secret in a cookie, so only it can finish
 *
 * @param request The request, with a ProviderStartRequest
 * @param response The response: a ProviderStartPayload, with the start cookie
 */
async function startRoute(request: Request, response: Response): Promise<void>
{
	const body = providerStartRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { provider, rememberMe, link } = body.data;
	const session = ((link !== null) ? await requireSession(request, response) : undefined);

	if ((link !== null) && !session)
	{
		return;
	}

	const client = providerClient(provider);

	if (!client)
	{
		sendRefusal(response, {
			status: 404,
			message: providerMessages.notOffered,
			values: {
				provider: LOGIN_PROVIDER_NAMES[provider]
			}
		});
		return;
	}

	if (session && (link !== null) && !(await confirmLink(request, response, session.playerId, link)))
	{
		return;
	}

	const start: ProviderStart = {
		provider,
		state: generateState(),
		codeVerifier: generateCodeVerifier(),
		rememberMe,
		playerId: (session?.playerId ?? null)
	};
	const payload: ProviderStartPayload = { url: client.authorizationUrl(start.state, start.codeVerifier).toString() };

	setCookie(response, PROVIDER_START_COOKIE, encodeProviderStart(start), PROVIDER_START_LIFETIME_MS);
	response.json(payload);
}

/**
 * Checks that the player linking a provider login from their profile is the account's owner, not just
 * someone with its session: its password, or for an account without one, a code sent to its address
 * that this browser entered, which is used up. With 2FA, its authenticator or recovery code too, even
 * from a trusted browser
 *
 * @param request The request
 * @param response The response, answered with the refusal when the check fails
 * @param playerId The account the browser is logged in to
 * @param link What the player gave
 * @return Whether the link may start
 */
async function confirmLink(request: Request, response: Response, playerId: string, link: ProviderLinkConfirmation): Promise<boolean>
{
	const now = new Date();
	const hasPassword = ((await findPasswordHash(playerId)) !== null);

	if (hasPassword)
	{
		const problem = await checkAccountPassword(request, response, playerId, (link.password ?? ''), now);

		if (problem)
		{
			sendRefusal(response, problem);
			return(false);
		}
	}

	const outcome = await inTransaction(async (executor): Promise<AuthRefusal | SecondFactorOutcome> =>
	{
		let codeId: string | undefined;

		if (!hasPassword)
		{
			const continuationHash = cookieTokenHash(request, CONTINUATION_COOKIE);
			const code = ((continuationHash === undefined) ? undefined : await lockContinuation('linkLogin', continuationHash, now, executor));

			if (!code || (code.playerId !== playerId))
			{
				return({
					status: 403,
					message: authMessages.enterCodeFirst
				});
			}

			codeId = code.id;
		}

		// Checked before the email code is used up, so a wrong code can be typed again
		const check = await checkSecondFactor(request, response, playerId, link.twoFactorCode, now, executor, {
			trustedBrowserSkips: false,
			emailLocale: link.locale
		});

		if ((check.kind === 'wrong') || (check.kind === 'refused'))
		{
			return(check.refusal);
		}

		if (codeId !== undefined)
		{
			await deleteEmailCode(codeId, executor);
		}

		return(check);
	});

	if ('status' in outcome)
	{
		sendRefusal(response, outcome);
		return(false);
	}

	clearCookie(response, CONTINUATION_COOKIE);
	await reportRecoveryCodeUse(playerId, outcome, link.locale);

	return(true);
}

/**
 * POST AUTH_PROVIDER_CALLBACK_PATH: finishes a login with a provider, from the browser that started it.
 * A provider login an account has logs the browser in, or for an account with 2FA from a browser it
 * doesn't trust, waits for the authenticator code as a password login does. Otherwise the browser gets
 * a cookie that lets it take the next step for CONTINUATION_LIFETIME_MS. A link links the provider
 * login to the account instead (linkToSession())
 *
 * @param request The request, with a ProviderCallbackRequest
 * @param response The response: a ProviderCallbackPayload, with the session cookie, the 2FA login cookie or the provider login cookie
 */
async function callbackRoute(request: Request, response: Response): Promise<void>
{
	const body = providerCallbackRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const start = readProviderStart(request);

	// A start is used once, whatever happens
	clearCookie(response, PROVIDER_START_COOKIE);

	if (!start || !hashesMatch(hashToken(start.state), hashToken(body.data.state)))
	{
		sendRefusal(response, {
			status: 400,
			message: providerMessages.notFinished
		});
		return;
	}

	const { provider, codeVerifier, rememberMe } = start;
	const client = providerClient(provider);

	if (!client)
	{
		sendRefusal(response, providerFailed(provider));
		return;
	}

	const session = ((start.playerId === null) ? undefined : await resolveSession(request.headers.cookie));

	// The player logged out, or in to another account, while at the provider
	if ((start.playerId !== null) && (session?.playerId !== start.playerId))
	{
		sendRefusal(response, {
			status: 401,
			message: errorMessages.logInFirst
		});
		return;
	}

	const now = new Date();
	const attempt = await inTransaction((executor) => takeAttempt([
		{
			kind: 'networkLoginAttempt',
			subjectHash: clientNetworkHash(request),
			limit: MAX_LOGIN_ATTEMPTS_PER_NETWORK_HOUR
		}
	], now, executor));

	if (!attempt.allowed)
	{
		sendRefusal(response, tooManyAttempts(attempt, now, response));
		return;
	}

	let user: ProviderUser;

	try
	{
		user = await client.fetchUser(body.data.code, codeVerifier);
	}
	catch (error)
	{
		if (!(error instanceof ProviderLoginError))
		{
			throw error;
		}

		if (error.reason === 'unavailable')
		{
			console.error(`Could not finish a ${LOGIN_PROVIDER_NAMES[provider]} login:`, error.cause);
		}

		sendRefusal(response, ((error.reason === 'refused') ? providerFailed(provider) : {
			status: 502,
			message: providerMessages.unavailable,
			values: {
				provider: LOGIN_PROVIDER_NAMES[provider]
			}
		}));
		return;
	}

	const email = user.email;

	// Checked for a link too, since the login it links could never log in without one
	if ((email === null) || !user.emailVerified)
	{
		sendRefusal(response, {
			status: 400,
			message: providerMessages.noVerifiedEmail,
			values: {
				provider: LOGIN_PROVIDER_NAMES[provider]
			}
		});
		return;
	}

	if (start.playerId !== null)
	{
		await linkToSession(request, response, start.playerId, provider, user, body.data.locale, now);
		return;
	}

	const token = createToken();
	const payload = await inTransaction(async (executor): Promise<ProviderCallbackPayload> =>
	{
		const playerId = await findProviderLoginPlayer(provider, user.providerUserId, executor);

		if (playerId !== undefined)
		{
			// The account's 2FA covers every way in, not only its password
			if (await needsSecondFactor(request, playerId, now, executor))
			{
				await savePendingTwoFactorLogin({
					continuationHash: hashToken(token),
					playerId,
					rememberMe,
					expiresAt: new Date(now.getTime() + CONTINUATION_LIFETIME_MS)
				}, executor);

				return({ outcome: 'twoFactor' });
			}

			await startSession(request, response, playerId, rememberMe, executor);
			await recordEvent(request, playerId, 'loggedIn', now, executor);

			return({ outcome: 'loggedIn' });
		}

		const ownerId = await findPlayerIdByEmail(email, executor);

		await savePendingProviderLogin({
			continuationHash: hashToken(token),
			provider,
			providerUserId: user.providerUserId,
			email,
			displayName: user.displayName,
			playerId: (ownerId ?? null),
			rememberMe,
			expiresAt: new Date(now.getTime() + CONTINUATION_LIFETIME_MS)
		}, executor);

		if (ownerId === undefined)
		{
			return({
				outcome: 'register',
				provider,
				email,
				displayName: user.displayName
			});
		}

		return({
			outcome: 'link',
			provider,
			email,
			hasPassword: ((await findLocalLogin(email, executor))?.id === ownerId),
			twoFactor: await needsSecondFactor(request, ownerId, now, executor)
		});
	});

	if (payload.outcome === 'twoFactor')
	{
		setCookie(response, TWO_FACTOR_LOGIN_COOKIE, token, CONTINUATION_LIFETIME_MS);
	}
	else if (payload.outcome !== 'loggedIn')
	{
		setCookie(response, PROVIDER_LOGIN_COOKIE, token, CONTINUATION_LIFETIME_MS);
	}

	response.json(payload);
}

/**
 * Finishes a link from the profile: links the provider login to the account the browser is logged in
 * to, and emails the account. The account's email address needn't match the provider's, since the
 * player is logged in to the account already
 *
 * @param request The callback's request
 * @param response The response: a ProviderCallbackPayload
 * @param playerId The account
 * @param provider The provider
 * @param user The player as the provider knows them
 * @param emailLocale The language of the email
 * @param now The time now
 */
async function linkToSession(request: Request, response: Response, playerId: string, provider: LoginProvider, user: ProviderUser, emailLocale: string, now: Date): Promise<void>
{
	const outcome = await inTransaction(async (executor): Promise<AuthRefusal | { email: string | null }> =>
	{
		// Linking a login the account has already changes nothing
		if (await findProviderLoginPlayer(provider, user.providerUserId, executor) === playerId)
		{
			return({ email: null });
		}

		try
		{
			await addProviderLogin(provider, user.providerUserId, playerId, executor);
		}
		catch (error)
		{
			if (!(error instanceof ProviderLoginTakenError))
			{
				throw error;
			}

			return(loginTaken(error, provider, true));
		}

		await recordEvent(request, playerId, 'providerLinked', now, executor);

		return({ email: await findPlayerEmail(playerId, executor) });
	});

	if ('status' in outcome)
	{
		sendRefusal(response, outcome);
		return;
	}

	const payload: ProviderCallbackPayload = {
		outcome: 'linked',
		provider
	};

	response.json(payload);

	if (outcome.email !== null)
	{
		sendEmailInBackground({
			to: outcome.email,
			...providerLinkedEmail(LOGIN_PROVIDER_NAMES[provider], emailLocale)
		});
	}
}

/**
 * POST AUTH_PROVIDER_REGISTER_PATH: creates an account for the provider login this browser came back
 * with, when no account has its email address, and logs the browser in
 *
 * @param request The request, with a ProviderRegisterRequest
 * @param response The response: 204 with the session cookie
 */
async function registerRoute(request: Request, response: Response): Promise<void>
{
	const body = providerRegisterRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { username, displayName, locale: emailLocale } = body.data;
	const problem = (checkUsername(username) ?? checkDisplayName(displayName));

	if (problem)
	{
		sendRefusal(response, problem);
		return;
	}

	const now = new Date();
	const outcome = await inTransaction(async (executor): Promise<AuthRefusal | { email: string }> =>
	{
		const pending = await lockBrowserLogin(request, now, executor);

		if ('status' in pending)
		{
			return(pending);
		}

		if (pending.playerId !== null)
		{
			return({
				status: 403,
				message: providerMessages.startAgain
			});
		}

		let playerId: string;

		try
		{
			playerId = (await createPlayer({
				username,
				displayName,
				email: pending.email,
				passwordHash: null
			}, executor)).id;
			await addProviderLogin(pending.provider, pending.providerUserId, playerId, executor);
		}
		catch (error)
		{
			if (error instanceof ProviderLoginTakenError)
			{
				return(loginTaken(error, pending.provider));
			}

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

			// Someone created an account with the address since the player came back from the provider
			return({
				status: 409,
				message: authMessages.emailTaken
			});
		}

		await deletePendingProviderLogin(pending.id, executor);
		await startSession(request, response, playerId, pending.rememberMe, executor);
		await recordEvent(request, playerId, 'registered', now, executor);
		await recordEvent(request, playerId, 'loggedIn', now, executor);

		return({ email: pending.email });
	});

	if ('status' in outcome)
	{
		sendRefusal(response, outcome);
		return;
	}

	clearCookie(response, PROVIDER_LOGIN_COOKIE);
	response.sendStatus(204);
	sendEmailInBackground({
		to: outcome.email,
		...accountCreatedEmail(emailLocale)
	});
}

/**
 * POST AUTH_PROVIDER_LINK_PATH: links the provider login this browser came back with to the local
 * account with its email address, once the player logs in to that account: with its password, or with
 * a code sent to the address (purpose 'linkLogin') that this browser entered. Logs the browser in
 *
 * @param request The request, with a ProviderLinkRequest
 * @param response The response: 204 with the session cookie
 */
async function linkRoute(request: Request, response: Response): Promise<void>
{
	const body = providerLinkRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { password, locale: emailLocale, twoFactorCode } = body.data;
	const now = new Date();
	const pending = await inTransaction((executor) => lockBrowserLogin(request, now, executor));

	if ('status' in pending)
	{
		sendRefusal(response, pending);
		return;
	}

	let newHash: string | undefined;

	if (password !== null)
	{
		const attempt = await inTransaction((executor) => takeAttempt([
			{
				kind: 'networkLoginAttempt',
				subjectHash: clientNetworkHash(request),
				limit: MAX_LOGIN_ATTEMPTS_PER_NETWORK_HOUR
			},
			{
				kind: 'addressLoginAttempt',
				subjectHash: hashAddress(pending.email),
				limit: MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR
			}
		], now, executor));

		if (!attempt.allowed)
		{
			sendRefusal(response, tooManyAttempts(attempt, now, response));
			return;
		}

		const login = await findLocalLogin(pending.email);
		const check = (((login !== undefined) && (login.id === pending.playerId)) ? await checkLoginPassword(login.passwordHash, password) : undefined);

		if (!check?.correct)
		{
			await recordEvent(request, pending.playerId, 'loginFailed', now);
			sendRefusal(response, {
				status: 401,
				message: authMessages.wrongPassword,
				field: 'password'
			});
			return;
		}

		newHash = check.newHash;
	}

	const outcome = await inTransaction(async (executor): Promise<AuthRefusal | { playerId: string; provider: LoginProvider; email: string | null; check: SecondFactorOutcome }> =>
	{
		const locked = await lockBrowserLogin(request, now, executor);

		if (('status' in locked) || (locked.id !== pending.id) || (locked.playerId === null))
		{
			return({
				status: 403,
				message: providerMessages.startAgain
			});
		}

		const playerId = locked.playerId;
		let codeId: string | undefined;

		if (password === null)
		{
			const continuationHash = cookieTokenHash(request, CONTINUATION_COOKIE);
			const code = ((continuationHash === undefined) ? undefined : await lockContinuation('linkLogin', continuationHash, now, executor));

			if (!code || (code.playerId !== playerId))
			{
				return({
					status: 403,
					message: authMessages.enterCodeFirst
				});
			}

			codeId = code.id;
		}

		// Checked before anything is used up, so a wrong code can be typed again
		const check = await checkSecondFactor(request, response, playerId, twoFactorCode, now, executor, {
			trustedBrowserSkips: true,
			emailLocale
		});

		if ((check.kind === 'wrong') || (check.kind === 'refused'))
		{
			return(check.refusal);
		}

		if (codeId !== undefined)
		{
			await deleteEmailCode(codeId, executor);
		}

		try
		{
			await addProviderLogin(locked.provider, locked.providerUserId, playerId, executor);
		}
		catch (error)
		{
			if (!(error instanceof ProviderLoginTakenError))
			{
				throw error;
			}

			return(loginTaken(error, locked.provider));
		}

		if (newHash !== undefined)
		{
			await savePasswordHash(playerId, newHash, executor);
			await recordEvent(request, playerId, 'passwordRehashed', now, executor);
		}

		await deletePendingProviderLogin(locked.id, executor);
		await startSession(request, response, playerId, locked.rememberMe, executor);
		await recordEvent(request, playerId, 'providerLinked', now, executor);
		await recordEvent(request, playerId, 'loggedIn', now, executor);

		return({
			playerId,
			provider: locked.provider,
			email: await findPlayerEmail(playerId, executor),
			check
		});
	});

	if ('status' in outcome)
	{
		sendRefusal(response, outcome);
		return;
	}

	clearCookie(response, PROVIDER_LOGIN_COOKIE);
	clearCookie(response, CONTINUATION_COOKIE);
	response.sendStatus(204);

	if (outcome.email !== null)
	{
		sendEmailInBackground({
			to: outcome.email,
			...providerLinkedEmail(LOGIN_PROVIDER_NAMES[outcome.provider], emailLocale)
		});
	}

	await reportRecoveryCodeUse(outcome.playerId, outcome.check, emailLocale);
}
