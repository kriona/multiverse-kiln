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
 *   can be open in other tabs while the player plays. /game/<slug> or /game/<id> enters that universe's
 *   lobby once the player has logged in (the address then changes to the slug), and ?group=<id>
 *   (GROUP_QUERY_PARAMETER) joins a group. Without either it shows the player's group, or goes to Home
 *   when they aren't in one
 * - edit.html: the world editor at /edit/<id>, on the tab given by ?tab= and the area given by ?area=
 * - character.html: Create Character for ?universe=<id>, which goes back to that universe's lobby
 * - license.html: the game's license and the licenses of what it uses, linked to from the footer
 * - admin.html: settings for the whole site, linked to from Home's toolbar. Anyone can use it until
 *   there are server admin accounts
 *
 * Every page takes ?locale= to choose a language, as the language picker in the footer does (see src/localization.ts)
 */

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
 * The pages that name what they show with the rest of their address, by their path, and the file each serves
 */
export const PATH_PAGES: Record<string, string> = {
	[GAME_PAGE]: 'game.html',
	[UNIVERSE_PAGE]: 'universe.html',
	[EDIT_PAGE]: 'edit.html'
};

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
 * @return The address
 */
export function characterPageUrl(universeId: string): string
{
	return(`${CHARACTER_PAGE}?${new URLSearchParams({ [UNIVERSE_PARAMETER]: universeId }).toString()}`);
}

/**
 * The address of the game's page, entering a universe's lobby if one is given
 *
 * @param key The universe's slug or ID, or undefined for the player's group
 * @return The address
 */
export function gamePageUrl(key?: string): string
{
	return(((key === undefined) ? GAME_PAGE : `${GAME_PAGE}/${encodeURIComponent(key)}`));
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
 */
export function replacePageParameters(parameters: Record<string, string | undefined>): void
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

	window.history.replaceState(window.history.state, '', url);
}
