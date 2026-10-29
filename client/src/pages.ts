/**
 * The client's pages and the addresses that open them at a particular place
 *
 * Links leave out .html (/edit, not /edit.html): Vite's dev and preview servers serve <name>.html for
 * /<name>, and the production client's host has to do the same. The pages in PATH_PAGES also serve
 * every address under their path, such as /universe/kilnhaven (the pathPages plugin in vite.config.ts),
 * which the host has to do too
 *
 * - index.html: Home, the universes to play and the player's own universes, each linking to its page
 * - universe.html: a universe's page, at /universe/<slug> or /universe/<id>: its name, ruleset and
 *   descriptions, and Enter Universe. Opened by ID, the address changes to the slug
 * - game.html: a universe's lobby and a group's game, on a page of their own so Home and the other pages
 *   can be open in other tabs while the player plays. /game/<slug> or /game/<id> enters that universe
 *   once the player has logged in (the address then changes to the slug), playing the character the tab
 *   last played there, or the player's most recent: in their group, or in the lobby when they aren't in
 *   one. ?invite=<token> (INVITE_QUERY_PARAMETER) opens an invite link, to choose a character to join
 *   its group. Without a universe it goes to Home
 * - edit.html: the world editor at /edit/<id>, on the tab given by ?tab= and the area given by ?area=
 * - character.html: Create Character for ?universe=<id>, which goes back to that universe's lobby, or to
 *   the invite link in ?invite= when it was opened from one
 * - license.html: the game's license and the licenses of what it uses, linked to from the footer
 * - privacy.html: the privacy policy, linked to from the footer
 * - admin.html: settings for the whole site, linked to from Home's toolbar. Anyone can use it until
 *   there are server admin accounts
 * - login.html: logging in, creating an account and resetting a forgotten password, linked to from
 *   Home's toolbar. The game, the world editor and Create Character send a browser that isn't logged in
 *   here with ?next=<their address>, and it goes back there once logged in
 *
 * Every page takes ?locale= to choose a language, as the language picker in the footer does (see src/localization.ts)
 */

import { INVITE_QUERY_PARAMETER, LOGIN_PAGE_PATH } from '@multiverse-kiln/shared';

/**
 * Query string parameter choosing the language, e.g. en-x-pirate, or en-XA for the pseudo-language in development
 */
export const LOCALE_PARAMETER = 'locale';

/**
 * Query string parameter naming a universe, on Create Character
 */
export const UNIVERSE_PARAMETER = 'universe';

/**
 * Query string parameter of the editor naming the tab shown
 */
export const TAB_PARAMETER = 'tab';

/**
 * Query string parameter of the editor naming the area open in the area editor
 */
export const AREA_PARAMETER = 'area';

/**
 * Query string parameter of the login page naming the page to go back to once logged in
 */
const NEXT_PARAMETER = 'next';

/**
 * Path of the login page, which Google and Discord also send the browser back to
 */
const LOGIN_PAGE = LOGIN_PAGE_PATH;

/**
 * Where the login page keeps its own address (with the page to go back to and its language) in the
 * tab's session storage while the player is at Google or Discord, which send the browser back to the
 * login page without it
 */
const LOGIN_ADDRESS_KEY = 'kiln-login-address';

/**
 * Path of the world editor's page, followed by /<universe ID>
 */
const EDIT_PAGE = '/edit';

/**
 * Path of the Create Character page
 */
const CHARACTER_PAGE = '/character';

/**
 * Path of the game's page, followed by /<slug> or /<universe ID> to enter a universe
 */
const GAME_PAGE = '/game';

/**
 * Path of a universe's page, followed by /<slug> or /<universe ID>
 */
const UNIVERSE_PAGE = '/universe';

/**
 * Path of the player's own profile, where they change it
 */
const PROFILE_PAGE = '/profile';

/**
 * Path of a player's profile as others see it, followed by /<username>. The same page as PROFILE_PAGE
 */
const PLAYER_PAGE = '/player';

/**
 * The pages that name what they show with the rest of their address, by their path, and the file each serves
 */
export const PATH_PAGES: Record<string, string> = {
	[GAME_PAGE]: 'game.html',
	[UNIVERSE_PAGE]: 'universe.html',
	[EDIT_PAGE]: 'edit.html',
	[PLAYER_PAGE]: 'profile.html'
};

/**
 * The address of the player's own profile
 */
export const PROFILE_PAGE_URL = PROFILE_PAGE;

/**
 * The address of Home
 */
export const HOME_PAGE_URL = '/';

/**
 * The address of the world editor for a universe
 *
 * @param universeId The universe's ID
 * @return The address
 */
export function editPageUrl(universeId: string): string
{
	return(`${EDIT_PAGE}/${encodeURIComponent(universeId)}`);
}

/**
 * The address of Create Character for a universe
 *
 * @param universeId The universe's ID
 * @param inviteToken The invite link to go back to once the character is made, if any
 * @return The address
 */
export function characterPageUrl(universeId: string, inviteToken?: string): string
{
	const parameters = new URLSearchParams({ [UNIVERSE_PARAMETER]: universeId });

	if (inviteToken !== undefined)
	{
		parameters.set(INVITE_QUERY_PARAMETER, inviteToken);
	}

	return(`${CHARACTER_PAGE}?${parameters.toString()}`);
}

/**
 * The address of the game's page, entering a universe if one is given
 *
 * @param key The universe's slug or ID, or undefined for none
 * @param inviteToken An invite link's token, to open the invite in that universe
 * @return The address
 */
export function gamePageUrl(key?: string, inviteToken?: string): string
{
	const path = ((key === undefined) ? GAME_PAGE : `${GAME_PAGE}/${encodeURIComponent(key)}`);

	return(((inviteToken === undefined) ? path : `${path}?${new URLSearchParams({ [INVITE_QUERY_PARAMETER]: inviteToken }).toString()}`));
}

/**
 * The full address of an invite link, as shared with other players
 *
 * @param universeSlug The universe's slug
 * @param inviteToken The link's token
 * @return The address, with the page's origin
 */
export function inviteLinkUrl(universeSlug: string, inviteToken: string): string
{
	return(new URL(gamePageUrl(universeSlug, inviteToken), window.location.origin).toString());
}

/**
 * The address of the login page, keeping the language the page was chosen in
 *
 * @param next The address to go back to once logged in, such as the page sending the player there; Home when not given
 * @return The address
 */
export function loginPageUrl(next?: string): string
{
	const parameters = new URLSearchParams();
	const locale = readPageParameter(LOCALE_PARAMETER);

	if (next !== undefined)
	{
		parameters.set(NEXT_PARAMETER, next);
	}

	if (locale !== undefined)
	{
		parameters.set(LOCALE_PARAMETER, locale);
	}

	const query = parameters.toString();

	return(((query === '') ? LOGIN_PAGE : `${LOGIN_PAGE}?${query}`));
}

/**
 * The address of the page being shown, as the login page's next parameter takes it
 *
 * @return The path, query string and fragment
 */
export function currentPageAddress(): string
{
	const { pathname, search, hash } = window.location;

	return(`${pathname}${search}${hash}`);
}

/**
 * Keeps the login page's address while the player goes to Google or Discord, for
 * takeProviderReturn() to put back. Without session storage, the page goes back to Home afterwards
 */
export function rememberLoginAddress(): void
{
	try
	{
		sessionStorage.setItem(LOGIN_ADDRESS_KEY, currentPageAddress());
	}
	catch
	{
		// Session storage is blocked: the login still works
	}
}

/**
 * Takes what Google or Discord sent the browser back to the login page with out of its address, and
 * puts back the address the page had before the player went there (rememberLoginAddress()), so its
 * language and the page to go back to are as they were
 *
 * @return The provider's query string parameters (code and state, or error), or undefined when the page wasn't opened by a provider
 */
export function takeProviderReturn(): URLSearchParams | undefined
{
	const parameters = new URLSearchParams(window.location.search);

	if ((window.location.pathname !== LOGIN_PAGE) || (!parameters.has('code') && !parameters.has('error')))
	{
		return(undefined);
	}

	let address: string | null = null;

	try
	{
		address = sessionStorage.getItem(LOGIN_ADDRESS_KEY);
		sessionStorage.removeItem(LOGIN_ADDRESS_KEY);
	}
	catch
	{
		// Session storage is blocked: the page goes back to Home once logged in
	}

	const restored = new URL((address ?? LOGIN_PAGE), window.location.origin);
	const sameLoginPage = ((restored.origin === window.location.origin) && (restored.pathname === LOGIN_PAGE));

	window.history.replaceState(null, '', (sameLoginPage ? `${restored.pathname}${restored.search}` : LOGIN_PAGE));

	return(parameters);
}

/**
 * Where the login page goes once logged in: the address its next parameter names, when that is a page
 * of this site, or Home. Only a path is taken, so a link can't send a player to another site after
 * they log in
 *
 * @return The address
 */
export function readNextPage(): string
{
	const next = readPageParameter(NEXT_PARAMETER);

	if ((next === undefined) || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\'))
	{
		return(HOME_PAGE_URL);
	}

	const url = new URL(next, window.location.origin);

	return(((url.origin === window.location.origin) && (url.pathname !== LOGIN_PAGE)) ? `${url.pathname}${url.search}${url.hash}` : HOME_PAGE_URL);
}

/**
 * The address of a universe's page
 *
 * @param key The universe's slug, or its ID
 * @return The address
 */
export function universePageUrl(key: string): string
{
	return(`${UNIVERSE_PAGE}/${encodeURIComponent(key)}`);
}

/**
 * The universe the game page's address names, as in /game/<slug>
 *
 * @return The universe's slug or ID, or undefined when the address doesn't name one
 */
export function readGameUniverseKey(): string | undefined
{
	return(readPathKey(GAME_PAGE));
}

/**
 * The address of a player's profile as others see it
 *
 * @param username The player's username
 * @return The address
 */
export function playerPageUrl(username: string): string
{
	return(`${PLAYER_PAGE}/${encodeURIComponent(username)}`);
}

/**
 * The player a profile page's address names, as in /player/<username>
 *
 * @return The username, or undefined when the address is the player's own profile
 */
export function readPlayerUsername(): string | undefined
{
	return(readPathKey(PLAYER_PAGE));
}

/**
 * The universe a universe page's address names, as in /universe/<slug>
 *
 * @return The universe's slug or ID, or undefined when the address doesn't name one
 */
export function readUniverseKey(): string | undefined
{
	return(readPathKey(UNIVERSE_PAGE));
}

/**
 * The universe the editor's address names, as in /edit/<universe ID>
 *
 * @return The universe's ID, or undefined when the address doesn't name one
 */
export function readEditUniverseId(): string | undefined
{
	return(readPathKey(EDIT_PAGE));
}

/**
 * What the address names after a page's path, as in <page>/<key>
 *
 * @param page The page's path
 * @return The key, or undefined when the address doesn't have one
 */
function readPathKey(page: string): string | undefined
{
	const prefix = `${page}/`;
	const { pathname } = window.location;

	if (!pathname.startsWith(prefix))
	{
		return(undefined);
	}

	const segment = pathname
		.slice(prefix.length)
		.replace(/\/$/, '');

	try
	{
		return(((segment === '') ? undefined : decodeURIComponent(segment)));
	}
	catch
	{
		return(undefined);
	}
}

/**
 * Changes the path in the address bar, keeping the query string and fragment, without loading the
 * page again or adding to its history
 *
 * @param path The new path
 */
export function replacePagePath(path: string): void
{
	const url = new URL(window.location.href);

	url.pathname = path;
	window.history.replaceState(window.history.state, '', url);
}

/**
 * Reads one parameter of the page's query string
 *
 * @param name The parameter
 * @return Its value, or undefined when the address doesn't have it
 */
export function readPageParameter(name: string): string | undefined
{
	return(new URLSearchParams(window.location.search).get(name) ?? undefined);
}

/**
 * Sets or removes parameters of the page's query string, without loading the page again or adding to its history
 *
 * @param parameters Each parameter's new value, or undefined to remove it
 * @param state What the history entry holds for when the browser comes back to it; what it holds already when not given
 */
export function replacePageParameters(parameters: Record<string, string | undefined>, state: unknown = window.history.state): void
{
	window.history.replaceState(state, '', pageUrlWith(parameters));
}

/**
 * Sets or removes parameters of the page's query string without loading the page again, as a new entry
 * in its history that the browser's Back button returns from (a popstate event)
 *
 * @param parameters Each parameter's new value, or undefined to remove it
 * @param state What the new history entry holds, for when the browser comes back to it
 */
export function pushPageParameters(parameters: Record<string, string | undefined>, state: unknown): void
{
	window.history.pushState(state, '', pageUrlWith(parameters));
}

/**
 * The page's address with some of its query string's parameters set or removed
 *
 * @param parameters Each parameter's new value, or undefined to remove it
 * @return The address
 */
function pageUrlWith(parameters: Record<string, string | undefined>): URL
{
	const url = new URL(window.location.href);

	for (const [name, value] of Object.entries(parameters))
	{
		if (value === undefined)
		{
			url.searchParams.delete(name);
		}
		else
		{
			url.searchParams.set(name, value);
		}
	}

	return(url);
}
