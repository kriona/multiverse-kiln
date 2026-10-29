/**
 * Accounts and logins: the rules for usernames and passwords, and the auth routes the client calls
 * (see Login and Email codes in STRUCTURE-OVERVIEW.md)
 */
import type { LocalizedMessage } from './localization.js';

/**
 * Where the auth routes are, under the game server
 */
export const AUTH_PATH = '/auth';

/**
 * GET: the browser's session (SessionPayload)
 */
export const AUTH_SESSION_PATH = `${AUTH_PATH}/session`;

/**
 * POST: log in to a local account (LoginRequest)
 */
export const AUTH_LOGIN_PATH = `${AUTH_PATH}/login`;

/**
 * POST: log out, ending the browser's session
 */
export const AUTH_LOGOUT_PATH = `${AUTH_PATH}/logout`;

/**
 * POST: send an email code (EmailCodeRequest)
 */
export const AUTH_CODE_PATH = `${AUTH_PATH}/code`;

/**
 * POST: check an email code (EmailCodeCheckRequest), which lets this browser take the next step
 */
export const AUTH_CODE_CHECK_PATH = `${AUTH_PATH}/code/check`;

/**
 * POST: create a local account, after its code was checked (RegisterRequest)
 */
export const AUTH_REGISTER_PATH = `${AUTH_PATH}/register`;

/**
 * POST: choose a new password, after the reset code was checked (PasswordResetRequest)
 */
export const AUTH_PASSWORD_RESET_PATH = `${AUTH_PATH}/password-reset`;

/**
 * POST: change the logged-in account's email address, after the code sent to the new address was
 * checked (EmailChangeRequest)
 */
export const AUTH_EMAIL_CHANGE_PATH = `${AUTH_PATH}/email`;

/**
 * GET: the login providers this site offers (ProvidersPayload)
 */
export const AUTH_PROVIDERS_PATH = `${AUTH_PATH}/providers`;

/**
 * POST: start logging in with a provider (ProviderStartRequest), answered with the provider's page to
 * send the browser to (ProviderStartPayload)
 */
export const AUTH_PROVIDER_START_PATH = `${AUTH_PATH}/providers/start`;

/**
 * POST: finish logging in with a provider, once it sends the browser back to PROVIDER_RETURN_PATH
 * (ProviderCallbackRequest), answered with what happens next (ProviderCallbackPayload)
 */
export const AUTH_PROVIDER_CALLBACK_PATH = `${AUTH_PATH}/providers/callback`;

/**
 * POST: create an account for a provider login that has none (ProviderRegisterRequest)
 */
export const AUTH_PROVIDER_REGISTER_PATH = `${AUTH_PATH}/providers/register`;

/**
 * POST: link a provider login to the local account with the same email address, by logging in to it
 * (ProviderLinkRequest)
 */
export const AUTH_PROVIDER_LINK_PATH = `${AUTH_PATH}/providers/link`;

/**
 * The client's login page, which emails link to
 */
export const LOGIN_PAGE_PATH = '/login';

/**
 * Query string parameter that opens the login page on resetting a forgotten password, as in /login?reset
 */
export const PASSWORD_RESET_PARAMETER = 'reset';

/**
 * The client's page a provider sends the browser back to, with the code and state in its query string:
 * the login page. Each provider is told this address, under the site's own (the server's SITE_URL)
 */
export const PROVIDER_RETURN_PATH = LOGIN_PAGE_PATH;

/**
 * Usernames: how players find each other and tell apart players with the same display name. Letters
 * a-z, digits and underscores only, so no username can pass for another with look-alike letters from
 * other alphabets. Compared ignoring capitals, and checked against reserved words like player names
 */
export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 20;
export const USERNAME_PATTERN = /^[A-Za-z0-9_]+$/;

/**
 * Passwords have no rules about which characters they use: only a length, and a check against
 * passwords seen in data breaches. The shortest is NIST SP 800-63B's minimum for a password that is
 * the only factor, which it is for any account without 2FA. The longest is generous for passphrases,
 * and keeps hashing quick
 */
export const MIN_PASSWORD_LENGTH = 15;
export const MAX_PASSWORD_LENGTH = 256;

/**
 * How long an emailed code works after it is sent
 */
export const EMAIL_CODE_LIFETIME_MINUTES = 15;

/**
 * The longest email address (RFC 5321's limit on a path)
 */
export const MAX_EMAIL_LENGTH = 254;

/**
 * The longest language tag a request may give for its emails
 */
export const MAX_LOCALE_LENGTH = 35;

/**
 * What an email code is for
 */
export const EMAIL_CODE_PURPOSES = ['register', 'resetPassword', 'changeEmail', 'linkLogin'] as const;

export type EmailCodePurpose = (typeof EMAIL_CODE_PURPOSES)[number];

/**
 * The services a player can log in with instead of a password (see Login in STRUCTURE-OVERVIEW.md)
 */
export const LOGIN_PROVIDERS = ['google', 'discord'] as const;

export type LoginProvider = (typeof LOGIN_PROVIDERS)[number];

/**
 * Each provider's name, as players know it, which messages take as an argument
 */
export const LOGIN_PROVIDER_NAMES: Readonly<Record<LoginProvider, string>> = {
	google: 'Google',
	discord: 'Discord'
};

/**
 * A logged-in player, as their own pages see them
 */
export interface SessionPlayer
{
	playerId: string;
	username: string;
	name: string;
}

/**
 * Response of GET AUTH_SESSION_PATH
 */
export interface SessionPayload
{
	/**
	 * The browser's player, or null when it isn't logged in
	 */
	player: SessionPlayer | null;
}

/**
 * Body of POST AUTH_LOGIN_PATH
 */
export interface LoginRequest
{
	email: string;
	password: string;

	/**
	 * Whether the session lasts 30 days without use (90 in all) rather than an hour (24 in all)
	 */
	rememberMe: boolean;
}

/**
 * Body of POST AUTH_CODE_PATH
 */
export interface EmailCodeRequest
{
	purpose: EmailCodePurpose;

	/**
	 * Where to send the code: the account's address, or the new address when changing it
	 */
	email: string;

	/**
	 * The language to write the email in, such as the page's
	 */
	locale: string;
}

/**
 * Body of POST AUTH_CODE_CHECK_PATH
 */
export interface EmailCodeCheckRequest
{
	purpose: EmailCodePurpose;
	email: string;

	/**
	 * The code as typed: case, spaces and dashes don't matter, and O, I and L count as 0, 1 and 1
	 */
	code: string;
}

/**
 * Body of POST AUTH_REGISTER_PATH
 */
export interface RegisterRequest
{
	/**
	 * The address the code was sent to, asked for again since the server doesn't keep it
	 */
	email: string;

	password: string;
	username: string;
	displayName: string;
	rememberMe: boolean;
	locale: string;
}

/**
 * Body of POST AUTH_PASSWORD_RESET_PATH
 */
export interface PasswordResetRequest
{
	password: string;
	rememberMe: boolean;
	locale: string;
}

/**
 * Body of POST AUTH_EMAIL_CHANGE_PATH
 */
export interface EmailChangeRequest
{
	/**
	 * The new address, which the code was sent to
	 */
	email: string;

	locale: string;
}

/**
 * Response of GET AUTH_PROVIDERS_PATH
 */
export interface ProvidersPayload
{
	/**
	 * The providers the site is set up for, which the login page offers
	 */
	providers: LoginProvider[];
}

/**
 * Body of POST AUTH_PROVIDER_START_PATH
 */
export interface ProviderStartRequest
{
	provider: LoginProvider;
	rememberMe: boolean;
}

/**
 * Response of POST AUTH_PROVIDER_START_PATH
 */
export interface ProviderStartPayload
{
	/**
	 * The provider's page that asks the player to log in, which sends them back to
	 * PROVIDER_RETURN_PATH
	 */
	url: string;
}

/**
 * Body of POST AUTH_PROVIDER_CALLBACK_PATH: what the provider put in PROVIDER_RETURN_PATH's query string
 */
export interface ProviderCallbackRequest
{
	code: string;
	state: string;
}

/**
 * Response of POST AUTH_PROVIDER_CALLBACK_PATH: the browser is logged in, or the player takes one more
 * step within a few minutes, from this browser
 */
export type ProviderCallbackPayload =
	| { outcome: 'loggedIn' }
	| {
		/**
		 * No account has the provider login or its email address: choose a username
		 * (AUTH_PROVIDER_REGISTER_PATH)
		 */
		outcome: 'register';
		provider: LoginProvider;
		email: string;

		/**
		 * The provider's name for the player, to suggest as their name
		 */
		displayName: string;
	}
	| {
		/**
		 * A local account has the provider login's email address: log in to it to link them
		 * (AUTH_PROVIDER_LINK_PATH), with its password or a code sent to the address
		 */
		outcome: 'link';
		provider: LoginProvider;
		email: string;

		/**
		 * Whether the account has a password; without one, only an email code links it
		 */
		hasPassword: boolean;
	};

/**
 * Body of POST AUTH_PROVIDER_REGISTER_PATH
 */
export interface ProviderRegisterRequest
{
	username: string;
	displayName: string;
	locale: string;
}

/**
 * Body of POST AUTH_PROVIDER_LINK_PATH
 */
export interface ProviderLinkRequest
{
	/**
	 * The account's password, or null when this browser has entered a code sent to its address
	 * (purpose 'linkLogin') instead
	 */
	password: string | null;

	locale: string;
}

/**
 * The fields of the auth routes' requests that an error can be about
 */
export type AuthField = 'email' | 'password' | 'username' | 'displayName' | 'code';

/**
 * Why an auth route refused a request, and which field it is about, if one
 */
export interface AuthErrorPayload
{
	error: LocalizedMessage;
	field?: AuthField;
}
