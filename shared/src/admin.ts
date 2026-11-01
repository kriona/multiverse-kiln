import type { LoginProvider } from './accounts.js';

/**
 * The admin pages' REST API (see Admin in STRUCTURE-OVERVIEW.md): the site's settings
 * (SITE_SETTINGS_PATH in shared/src/siteSettings.ts), its login sessions and its players
 *
 * - GET ADMIN_PATH answers 204, for the admin landing page to find whether the player may use the admin pages
 * - GET ADMIN_SESSIONS_PATH takes AdminSessionListQuery as query parameters, and answers AdminSessionListPayload
 * - GET ADMIN_PLAYERS_PATH takes AdminPlayerListQuery as query parameters, and answers AdminPlayerListPayload
 *
 * Every route under ADMIN_PATH answers 401 to a browser that isn't logged in, and 403 to a player who
 * isn't a server admin or is one without 2FA on (ADMIN_TWO_FACTOR_ERROR_ID), each with an ErrorPayload
 */
export const ADMIN_PATH = '/admin';

/**
 * The login sessions still going, for the Sessions admin page
 */
export const ADMIN_SESSIONS_PATH = `${ADMIN_PATH}/sessions`;

/**
 * Every player account, for the Players admin page
 */
export const ADMIN_PLAYERS_PATH = `${ADMIN_PATH}/players`;

/**
 * ID of the message the admin routes refuse a server admin with while they don't have 2FA on, so the
 * pages can offer to turn it on
 */
export const ADMIN_TWO_FACTOR_ERROR_ID = 'error.adminNeedsTwoFactor';

/**
 * Most rows an admin list returns at once
 */
export const MAX_ADMIN_ROWS_PER_PAGE = 50;

/**
 * Most characters in an admin list's search
 */
export const MAX_ADMIN_SEARCH_LENGTH = 100;

/**
 * Query parameters of GET ADMIN_SESSIONS_PATH
 */
export interface AdminSessionListQuery
{
	/**
	 * Text the session's player's username or name holds, ignoring capitals
	 */
	search?: string;

	/**
	 * Only sessions with a window connected to the game (true), or only those without (false)
	 */
	connected?: boolean;

	/**
	 * How many matching sessions to skip
	 */
	offset?: number;

	/**
	 * Most sessions to return, up to MAX_ADMIN_ROWS_PER_PAGE (the default)
	 */
	limit?: number;
}

/**
 * A login session still going, as the Sessions admin page lists it. Times are ISO 8601
 */
export interface AdminSession
{
	username: string;
	displayName: string;
	createdAt: string;
	lastUsedAt: string;

	/**
	 * When the session ends if it isn't used again
	 */
	expiresAt: string;

	rememberMe: boolean;

	/**
	 * Whether a window of the session is connected to the game: a lobby, a group, or a page that joins the session room
	 */
	connected: boolean;

	/**
	 * Whether it is the session of the browser asking
	 */
	current: boolean;
}

/**
 * Response of GET ADMIN_SESSIONS_PATH: a page of the matching sessions, most recently used first
 */
export interface AdminSessionListPayload
{
	sessions: AdminSession[];

	/**
	 * How many sessions match, on every page
	 */
	total: number;
}

/**
 * Query parameters of GET ADMIN_PLAYERS_PATH
 */
export interface AdminPlayerListQuery
{
	/**
	 * Text the player's username, name or email address holds, ignoring capitals
	 */
	search?: string;

	/**
	 * Only server admins (true), or only other players (false)
	 */
	serverAdmin?: boolean;

	/**
	 * How many matching players to skip
	 */
	offset?: number;

	/**
	 * Most players to return, up to MAX_ADMIN_ROWS_PER_PAGE (the default)
	 */
	limit?: number;
}

/**
 * A player account, as the Players admin page lists it
 */
export interface AdminPlayer
{
	username: string;
	displayName: string;

	/**
	 * The address a local account logs in with, or null for an account without one
	 */
	email: string | null;

	/**
	 * When the account was made, as ISO 8601
	 */
	createdAt: string;

	/**
	 * When the account last logged in, as ISO 8601, or null when it never has
	 */
	lastLoginAt: string | null;

	/**
	 * Whether the account has a password
	 */
	password: boolean;

	/**
	 * The Google and Discord logins linked to the account, in LOGIN_PROVIDERS order
	 */
	providers: LoginProvider[];

	twoFactor: boolean;
	serverAdmin: boolean;

	/**
	 * Whether the account has a window connected to the server
	 */
	active: boolean;
}

/**
 * Response of GET ADMIN_PLAYERS_PATH: a page of the matching players, by username ignoring case
 */
export interface AdminPlayerListPayload
{
	players: AdminPlayer[];

	/**
	 * How many players match, on every page
	 */
	total: number;
}
