/**
 * The client's pages and the addresses that open them at a particular place
 *
 * - index.html: Home, a universe's lobby and a group's game. ?universe=<id> enters that universe's
 *   lobby once the player has logged in, and ?group=<id> (GROUP_QUERY_PARAMETER) joins a group
 * - edit.html: the world editor for ?universe=<id>, on the tab given by ?tab= and the zone given by ?zone=
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
 * Query string parameter naming a universe, on either page
 */
export const UNIVERSE_PARAMETER = 'universe';

/**
 * Query string parameter of the editor naming the tab shown
 */
export const TAB_PARAMETER = 'tab';

/**
 * Query string parameter of the editor naming the zone open in the zone editor
 */
export const ZONE_PARAMETER = 'zone';

/**
 * Path of the world editor's page
 */
const EDIT_PAGE = '/edit.html';

/**
 * Path of the Create Character page
 */
const CHARACTER_PAGE = '/character.html';

/**
 * Path of the game's page
 */
const GAME_PAGE = '/';

/**
 * The address of the world editor for a universe
 *
 * @param universeId The universe's ID
 * @return The address
 */
export function editPageUrl(universeId: string): string
{
	return(`${EDIT_PAGE}?${new URLSearchParams({ [UNIVERSE_PARAMETER]: universeId }).toString()}`);
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
 * @param universeId The universe's ID, or undefined for Home
 * @return The address
 */
export function gamePageUrl(universeId?: string): string
{
	return(((universeId === undefined) ? GAME_PAGE : `${GAME_PAGE}?${new URLSearchParams({ [UNIVERSE_PARAMETER]: universeId }).toString()}`));
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
