/**
 * Accounts and logins: the rules for handles and passwords, and the auth routes the client calls
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
 * Handles: how players find each other and tell apart players with the same display name. Letters
 * a-z, digits and underscores only, so no handle can pass for another with look-alike letters from
 * other alphabets. Compared ignoring capitals, and checked against reserved words like player names
 */
export const MIN_HANDLE_LENGTH = 3;
export const MAX_HANDLE_LENGTH = 20;
export const HANDLE_PATTERN = /^[A-Za-z0-9_]+$/;

/**
 * Passwords have no rules about which characters they use: only a length, and a check against
 * passwords seen in data breaches. The shortest is NIST SP 800-63B's minimum for a password that is
 * the only factor, which it is for any account without 2FA. The longest is generous for passphrases,
 * and keeps hashing quick
 */
export const MIN_PASSWORD_LENGTH = 15;
export const MAX_PASSWORD_LENGTH = 256;

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
export const EMAIL_CODE_PURPOSES = ['register', 'resetPassword', 'changeEmail'] as const;

export type EmailCodePurpose = (typeof EMAIL_CODE_PURPOSES)[number];

/**
 * A logged-in player, as their own pages see them
 */
export interface SessionPlayer
{
	playerId: string;
	handle: string;
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
	handle: string;
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
 * The fields of the auth routes' requests that an error can be about
 */
export type AuthField = 'email' | 'password' | 'handle' | 'displayName' | 'code';

/**
 * Why an auth route refused a request, and which field it is about, if one
 */
export interface AuthErrorPayload
{
	error: LocalizedMessage;
	field?: AuthField;
}
