import type { LoginProvider } from './accounts.js';
import type { Ruleset, UniverseStage } from './universes.js';

/**
 * The admin pages' REST API (see Admin in STRUCTURE-OVERVIEW.md): the site's settings
 * (SITE_SETTINGS_PATH in shared/src/siteSettings.ts), its login sessions, its players, its server
 * admins and its universes
 *
 * - GET ADMIN_PATH answers 204, for the admin landing page to find whether the player may use the admin pages
 * - GET ADMIN_SESSIONS_PATH takes AdminSessionListQuery as query parameters, and answers AdminSessionListPayload
 * - GET ADMIN_PLAYERS_PATH takes AdminPlayerListQuery as query parameters, and answers AdminPlayerListPayload
 * - GET ADMIN_ADMINS_PATH answers ServerAdminListPayload
 * - GET ADMIN_ADMINS_SEARCH_PATH takes PlayerSearchQuery (shared/src/editor.ts) as query parameters, and
 *   answers PlayerSearchPayload: players who aren't server admins, found as the Editors tab finds them
 * - POST ADMIN_ADMINS_PATH takes ServerAdminRequest and makes the player a server admin, answering 204, 404
 *   when no player has the username and 409 when they are one already
 * - DELETE ADMIN_ADMINS_PATH/:username takes away a player's server admin role, answering 204, 404 when
 *   they aren't one and 409 when they are the last
 * - GET ADMIN_UNIVERSES_PATH takes AdminUniverseListQuery as query parameters, and answers AdminUniverseListPayload
 * - PUT ADMIN_UNIVERSES_PATH/:universeId/disabled takes UniverseDisableRequest and disables the universe,
 *   answering 204, 404 when there is no such universe and 409 when it is disabled already
 * - DELETE ADMIN_UNIVERSES_PATH/:universeId/disabled enables the universe again, answering 204, 404 when
 *   there is no such universe and 409 when it isn't disabled
 *
 * Every route under ADMIN_PATH answers 401 to a browser that isn't logged in, and 403 to a player who
 * isn't a server admin, each with an ErrorPayload. A server admin always has 2FA on while logged in,
 * since their sessions need it (see Admin in STRUCTURE-OVERVIEW.md). What admins change is recorded as
 * admin events
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
 * The site's server admins, for the Admins admin page
 */
export const ADMIN_ADMINS_PATH = `${ADMIN_PATH}/admins`;

/**
 * Players who could be made server admins, found by name or username
 */
export const ADMIN_ADMINS_SEARCH_PATH = `${ADMIN_ADMINS_PATH}/search`;

/**
 * Every universe, for the Universes admin page, which disables and enables them
 */
export const ADMIN_UNIVERSES_PATH = `${ADMIN_PATH}/universes`;

/**
 * Most characters in the reason a server admin gives for disabling a universe
 */
export const MAX_DISABLED_REASON_LENGTH = 500;

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

/**
 * A server admin, as the Admins admin page lists them
 */
export interface ServerAdminSummary
{
	username: string;
	displayName: string;

	/**
	 * When they became a server admin, as ISO 8601
	 */
	addedAt: string;

	/**
	 * Whether they have 2FA on, which they need to use the admin pages
	 */
	twoFactor: boolean;

	/**
	 * Whether they are the player asking
	 */
	current: boolean;
}

/**
 * Response of GET ADMIN_ADMINS_PATH: every server admin, by username ignoring case
 */
export interface ServerAdminListPayload
{
	admins: ServerAdminSummary[];
}

/**
 * Body of POST ADMIN_ADMINS_PATH: the player to make a server admin
 */
export interface ServerAdminRequest
{
	username: string;
}

/**
 * Query parameters of GET ADMIN_UNIVERSES_PATH
 */
export interface AdminUniverseListQuery
{
	/**
	 * Text the universe's name holds, ignoring capitals
	 */
	search?: string;

	/**
	 * Only disabled universes (true), or only those that aren't (false)
	 */
	disabled?: boolean;

	/**
	 * How many matching universes to skip
	 */
	offset?: number;

	/**
	 * Most universes to return, up to MAX_ADMIN_ROWS_PER_PAGE (the default)
	 */
	limit?: number;
}

/**
 * One of a universe's creators, as the Universes admin page names them
 */
export interface AdminUniverseCreator
{
	username: string;
	displayName: string;
}

/**
 * A universe, as the Universes admin page lists it
 */
export interface AdminUniverse
{
	id: string;
	name: string;

	/**
	 * The name in the form its page's address uses (universeSlug)
	 */
	slug: string;

	stage: UniverseStage;
	ruleset: Ruleset;

	/**
	 * When it was made, as ISO 8601
	 */
	createdAt: string;

	/**
	 * Its creators, by username ignoring case
	 */
	creators: AdminUniverseCreator[];

	/**
	 * When a server admin disabled it, as ISO 8601, or null while it isn't disabled
	 */
	disabledAt: string | null;

	/**
	 * Why it was disabled, or null while it isn't
	 */
	disabledReason: string | null;

	/**
	 * Whether the server admin who disabled it kept its creators from deleting it
	 */
	deletionPrevented: boolean;
}

/**
 * Response of GET ADMIN_UNIVERSES_PATH: a page of the matching universes, by name ignoring case
 */
export interface AdminUniverseListPayload
{
	universes: AdminUniverse[];

	/**
	 * How many universes match, on every page
	 */
	total: number;
}

/**
 * Body of PUT ADMIN_UNIVERSES_PATH/:universeId/disabled
 */
export interface UniverseDisableRequest
{
	/**
	 * Why the universe is disabled, which its editors are shown. Trimmed, from 1 to
	 * MAX_DISABLED_REASON_LENGTH characters
	 */
	reason: string;

	/**
	 * Whether its creators are kept from deleting it while it is disabled: a creator deleting their
	 * account has to hand it to another of its editors
	 */
	preventDeletion: boolean;
}
