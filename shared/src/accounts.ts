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
 * POST: check whether a new account could take a username (UsernameCheckRequest), answered with 204
 * when it could, or the refusal registering would give. Only for a browser creating an account: one
 * that entered a code to register, or came back from a provider with a login that has no account yet
 */
export const AUTH_USERNAME_CHECK_PATH = `${AUTH_PATH}/username/check`;

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
 * checked, giving the password (or for an account without one, after the code sent to its current
 * address was checked) and the 2FA code (EmailChangeRequest). Every other browser logged in to the
 * account is logged out
 */
export const AUTH_EMAIL_CHANGE_PATH = `${AUTH_PATH}/email`;

/**
 * POST: change the logged-in account's password, giving the current one (PasswordChangeRequest). Every
 * other browser logged in to the account is logged out
 */
export const AUTH_PASSWORD_CHANGE_PATH = `${AUTH_PATH}/password`;

/**
 * POST: finish a login that is waiting on the account's second factor, with an authenticator or recovery
 * code (TwoFactorLoginRequest)
 */
export const AUTH_TWO_FACTOR_LOGIN_PATH = `${AUTH_PATH}/two-factor/login`;

/**
 * POST: start turning on 2FA for the logged-in account, giving its password (TwoFactorSetupRequest),
 * answered with the secret for the authenticator app (TwoFactorSetupPayload)
 */
export const AUTH_TWO_FACTOR_SETUP_PATH = `${AUTH_PATH}/two-factor/setup`;

/**
 * POST: turn on 2FA, with a code from the authenticator app just set up (TwoFactorEnableRequest),
 * answered with the account's recovery codes (RecoveryCodesPayload)
 */
export const AUTH_TWO_FACTOR_ENABLE_PATH = `${AUTH_PATH}/two-factor/enable`;

/**
 * POST: turn off 2FA, giving the password and an authenticator or recovery code (TwoFactorDisableRequest)
 */
export const AUTH_TWO_FACTOR_DISABLE_PATH = `${AUTH_PATH}/two-factor/disable`;

/**
 * POST: replace the account's recovery codes, giving the password and an authenticator or recovery code
 * (RecoveryCodesRequest), answered with the new ones (RecoveryCodesPayload)
 */
export const AUTH_RECOVERY_CODES_PATH = `${AUTH_PATH}/two-factor/recovery-codes`;

/**
 * POST: stop trusting every browser the account trusted to skip the authenticator code
 */
export const AUTH_TRUSTED_BROWSERS_FORGET_PATH = `${AUTH_PATH}/two-factor/trusted-browsers/forget`;

/**
 * GET: the login providers this site offers (ProvidersPayload)
 */
export const AUTH_PROVIDERS_PATH = `${AUTH_PATH}/providers`;

/**
 * POST: start logging in with a provider, or linking it to the logged-in account
 * (ProviderStartRequest), answered with the provider's page to send the browser to
 * (ProviderStartPayload)
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
 * POST: delete the logged-in account (AccountDeleteRequest), after GET PROFILE_DELETION_PATH says what
 * to decide first
 */
export const AUTH_ACCOUNT_DELETE_PATH = `${AUTH_PATH}/account/delete`;

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
 * The characters of email and recovery codes: Crockford's base32 alphabet, the digits and the capital
 * letters except I, L, O and U. Typing is forgiving: O, I and L are read as 0, 1 and 1
 */
export const EMAIL_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * How many characters an email code has: 32^6, a little over a billion possible codes
 */
export const EMAIL_CODE_LENGTH = 6;

/**
 * How many characters a recovery code has, from EMAIL_CODE_ALPHABET: 50 bits. Shown with a dash in the
 * middle, which typing may leave out
 */
export const RECOVERY_CODE_LENGTH = 10;

/**
 * How many digits an authenticator app's codes have (TOTP, RFC 6238)
 */
export const TWO_FACTOR_CODE_LENGTH = 6;

/**
 * How many recovery codes an account with 2FA gets: each works once, in place of an authenticator code
 */
export const RECOVERY_CODE_COUNT = 10;

/**
 * How long a browser the player chose to trust skips the authenticator code at login
 */
export const TRUSTED_BROWSER_DAYS = 30;

/**
 * The longest authenticator or recovery code read from a request, before spaces and dashes are removed
 */
export const MAX_TWO_FACTOR_CODE_INPUT_LENGTH = 32;

/**
 * What an email code is for. 'changeEmail' is sent to the new address, and 'confirmEmailChange' to the
 * current address of an account without a password, to check it's the owner changing it.
 * 'deleteAccount' checks it's the owner deleting an account without a password
 */
export const EMAIL_CODE_PURPOSES = ['register', 'resetPassword', 'changeEmail', 'linkLogin', 'confirmEmailChange', 'deleteAccount'] as const;

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

	/**
	 * The language the player chose on their profile, which pages use ahead of the browser's settings;
	 * null when they haven't chosen one
	 */
	locale: string | null;
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
 * Response of POST AUTH_LOGIN_PATH: the browser is logged in, or the account has 2FA and the login waits
 * a few minutes for its code (AUTH_TWO_FACTOR_LOGIN_PATH), from this browser
 */
export interface LoginPayload
{
	outcome: 'loggedIn' | 'twoFactor';
}

/**
 * Body of POST AUTH_TWO_FACTOR_LOGIN_PATH
 */
export interface TwoFactorLoginRequest
{
	/**
	 * A code from the authenticator app, or one of the account's recovery codes, as typed
	 */
	code: string;

	/**
	 * Whether this browser skips the authenticator code at login for TRUSTED_BROWSER_DAYS
	 */
	trustBrowser: boolean;

	locale: string;
}

/**
 * Body of POST AUTH_TWO_FACTOR_SETUP_PATH
 */
export interface TwoFactorSetupRequest
{
	password: string;
}

/**
 * Response of POST AUTH_TWO_FACTOR_SETUP_PATH: the secret the authenticator app makes its codes from
 */
export interface TwoFactorSetupPayload
{
	/**
	 * The secret in base32, for typing into the app by hand
	 */
	secret: string;

	/**
	 * The otpauth:// URI the client draws as a QR code for the app to scan. It holds the secret, so it is
	 * only ever drawn, never used as a link or sent anywhere
	 */
	uri: string;
}

/**
 * Body of POST AUTH_TWO_FACTOR_ENABLE_PATH
 */
export interface TwoFactorEnableRequest
{
	/**
	 * A code from the authenticator app just set up
	 */
	code: string;

	locale: string;
}

/**
 * Body of POST AUTH_TWO_FACTOR_DISABLE_PATH
 */
export interface TwoFactorDisableRequest
{
	password: string;

	/**
	 * An authenticator or recovery code
	 */
	code: string;

	locale: string;
}

/**
 * Body of POST AUTH_RECOVERY_CODES_PATH
 */
export interface RecoveryCodesRequest
{
	password: string;

	/**
	 * An authenticator or recovery code
	 */
	code: string;

	locale: string;
}

/**
 * Response of POST AUTH_TWO_FACTOR_ENABLE_PATH and AUTH_RECOVERY_CODES_PATH: the account's recovery
 * codes, shown once. The server keeps only their keyed hashes
 */
export interface RecoveryCodesPayload
{
	recoveryCodes: string[];
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
 * Response of POST AUTH_CODE_CHECK_PATH
 */
export interface EmailCodeCheckPayload
{
	/**
	 * Whether the next step needs the account's authenticator or recovery code too: resetting the
	 * password of an account with 2FA, from a browser it doesn't trust
	 */
	twoFactor: boolean;
}

/**
 * Body of POST AUTH_USERNAME_CHECK_PATH
 */
export interface UsernameCheckRequest
{
	username: string;
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

	/**
	 * An authenticator or recovery code, when the code check said one is needed; otherwise null
	 */
	twoFactorCode: string | null;
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

	/**
	 * The account's password, or null for an account without one, which enters a code sent to its
	 * current address (purpose 'confirmEmailChange') instead
	 */
	currentPassword: string | null;

	/**
	 * The authenticator or recovery code, for an account with 2FA; otherwise null
	 */
	twoFactorCode: string | null;
}

/**
 * Body of POST AUTH_PASSWORD_CHANGE_PATH
 */
export interface PasswordChangeRequest
{
	currentPassword: string;
	newPassword: string;
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

	/**
	 * Whether the session lasts longer; a link keeps the session the browser has
	 */
	rememberMe: boolean;

	/**
	 * How the player confirms linking the provider login to the account the browser is logged in to,
	 * from its profile; null to log in instead
	 */
	link: ProviderLinkConfirmation | null;
}

/**
 * What linking a provider login from the profile asks for, so a session alone can't add a login to the
 * account: its password, or for an account without one, a code sent to its address (purpose
 * 'linkLogin') that this browser entered. With 2FA, its authenticator or recovery code too
 */
export interface ProviderLinkConfirmation
{
	/**
	 * The account's password, or null when it has none
	 */
	password: string | null;

	/**
	 * An authenticator or recovery code, when the account has 2FA; otherwise null
	 */
	twoFactorCode: string | null;

	/**
	 * The language to write an email in, such as telling the player a recovery code was used
	 */
	locale: string;
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

	/**
	 * The language of the email telling the account a login was linked to it
	 */
	locale: string;
}

/**
 * Response of POST AUTH_PROVIDER_CALLBACK_PATH: the browser is logged in, the provider login is linked
 * to the account the browser is logged in to, or the player takes one more step within a few minutes,
 * from this browser
 */
export type ProviderCallbackPayload =
	| { outcome: 'loggedIn' }
	| {
		/**
		 * The provider login is an account's that has 2FA, and the browser isn't trusted: enter the
		 * authenticator or recovery code (AUTH_TWO_FACTOR_LOGIN_PATH), as after a password
		 */
		outcome: 'twoFactor';
	}
	| {
		/**
		 * The login started as a link (ProviderStartRequest's link), and the account has the provider
		 * login now
		 */
		outcome: 'linked';
		provider: LoginProvider;
	}
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

		/**
		 * Whether linking needs the account's authenticator or recovery code too, since the account has
		 * 2FA and this browser isn't trusted
		 */
		twoFactor: boolean;
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

	/**
	 * An authenticator or recovery code, when the callback said one is needed; otherwise null
	 */
	twoFactorCode: string | null;
}

/**
 * What becomes of a universe the player is the only creator of when their account is deleted
 */
export interface UniverseDecision
{
	universeId: string;

	/**
	 * Another of its editors, who becomes its creator; null deletes the universe
	 */
	newCreatorId: string | null;
}

/**
 * Body of POST AUTH_ACCOUNT_DELETE_PATH
 */
export interface AccountDeleteRequest
{
	/**
	 * The account's password, or null for an account without one
	 */
	password: string | null;

	/**
	 * An authenticator or recovery code when the account has 2FA; otherwise null
	 */
	twoFactorCode: string | null;

	/**
	 * The account's username, typed to confirm, for an account without a password; otherwise null. An
	 * account without a password that has an address also enters a code sent to it first (purpose
	 * 'deleteAccount')
	 */
	username: string | null;

	/**
	 * A decision for each universe the player is the only creator of
	 */
	universes: UniverseDecision[];

	/**
	 * The language of the email saying the account was deleted
	 */
	locale: string;
}

/**
 * The fields of the auth routes' requests that an error can be about
 */
export type AuthField = 'email' | 'password' | 'currentPassword' | 'username' | 'displayName' | 'code' | 'twoFactorCode';

/**
 * Why an auth route refused a request, and which field it is about, if one
 */
export interface AuthErrorPayload
{
	error: LocalizedMessage;
	field?: AuthField;
}
