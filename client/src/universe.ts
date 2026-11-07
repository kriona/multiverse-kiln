import { ServerError } from '@colyseus/sdk';
import { RULESET_NAMES, SessionServerMessageType, type AccountPayload, type UniverseDetails } from '@multiverse-kiln/shared';

import { t } from './localization';
import { AuthApi } from './network/authApi';
import { CharacterApi } from './network/characterApi';
import { GroupApi } from './network/groupApi';
import { ProfileApi } from './network/profileApi';
import { createClient, getUniverseDetails, type ServerConnection } from './network/serverConnection';
import { startPage } from './pageStart';
import { gamePageUrl, HOME_PAGE_URL, readUniverseKey, replacePagePath, universePageUrl } from './pages';
import { CharacterSheetDialog } from './ui/CharacterSheetDialog';
import { getElement, setPageTitle, showNoticeScreen, showScreen, showStatus } from './ui/dom';
import { showMarkdown } from './ui/markdown';
import { pageMessages } from './ui/pageMessages';
import { UniverseCharacters } from './ui/UniverseCharacters';
import { reportSiteLanguageChange, UniverseLanguageChooser } from './ui/UniverseLanguageChooser';

/**
 * Shows a universe: its name, ruleset and descriptions, that it is locked at the end of time, and Enter
 * Universe, which goes to its lobby, or to the player's group in a locked universe. The address ends
 * with the slug, so one opened by ID changes to it
 *
 * @param universe The universe
 */
function showUniverse(universe: UniverseDetails): void
{
	getElement('universe-name', HTMLElement).textContent = universe.name;
	getElement('universe-ruleset', HTMLElement).textContent = t(RULESET_NAMES[universe.ruleset]);
	getElement('universe-summary', HTMLElement).textContent = universe.shortDescription;
	showMarkdown(getElement('universe-description', HTMLElement), universe.longDescription);
	getElement('universe-locked', HTMLElement).hidden = (universe.stage !== 'end_of_time');
	getElement('universe-enter', HTMLAnchorElement).href = gamePageUrl(universe.slug);
	replacePagePath(universePageUrl(universe.slug));
	setPageTitle(universe.name);
	showScreen('universe');
}

/**
 * Lists the player's characters in the universe while the browser is logged in, and tells the Languages
 * section about their profile's language, following the session as the player logs in or out in any
 * window. The page works without it, so a failed connection only leaves the list hidden
 *
 * @param universe The universe
 * @param languages The Languages section
 * @param connection The page's connection to the server (startPage())
 */
async function followPlayer(universe: UniverseDetails, languages: UniverseLanguageChooser, connection: Promise<ServerConnection>): Promise<void>
{
	let server: ServerConnection;

	try
	{
		server = await connection;
	}
	catch (error)
	{
		console.error('Could not connect to the server to list your characters:', error);
		return;
	}

	const api = new CharacterApi(server.client);
	const sheet = new CharacterSheetDialog(api, new GroupApi(server.client), () =>
	{
		void characters.follow(true);
	});
	const characters = new UniverseCharacters(api, universe.id, sheet);
	const auth = new AuthApi(server.client);
	const profiles = new ProfileApi(server.client);

	server.session.onMessage(SessionServerMessageType.Account, (account: AccountPayload) =>
	{
		void characters.follow(account.player !== null);
		void followProfileLocale(languages, auth, ((account.player === null) ? undefined : profiles));
	});

	server.session.onLeave(() =>
	{
		void characters.follow(false);
		languages.setPlayer(undefined, null);
	});
}

/**
 * Tells the Languages section whether the browser is logged in, and the language the profile names. A
 * profile that can't be read is taken to name none, which only leaves out the note that choosing a
 * language changes it
 *
 * @param languages The Languages section
 * @param auth The login routes
 * @param profiles The profile routes while the browser is logged in, or undefined while it isn't
 */
async function followProfileLocale(languages: UniverseLanguageChooser, auth: AuthApi, profiles: ProfileApi | undefined): Promise<void>
{
	if (profiles === undefined)
	{
		languages.setPlayer(undefined, null);
		return;
	}

	try
	{
		languages.setPlayer(profiles, ((await auth.getSession())?.locale ?? null));
	}
	catch (error)
	{
		console.error('Could not find the language your profile names:', error);
		languages.setPlayer(profiles, null);
	}
}

/**
 * Starts a universe's page in the player's language, showing the universe its address names, or goes
 * to Home without one
 */
async function start(): Promise<void>
{
	const key = readUniverseKey();

	if (key === undefined)
	{
		window.location.replace(HOME_PAGE_URL);
		return;
	}

	const { server } = await startPage();

	reportSiteLanguageChange();
	showStatus(t(pageMessages.loading));

	let universe: UniverseDetails;

	try
	{
		universe = await getUniverseDetails(createClient(), key);
	}
	catch (error)
	{
		console.error('Could not load the universe:', error);
		showNoticeScreen((((error instanceof ServerError) && (error.code === 404)) ? t({
			id: 'universePage.notFound',
			defaultMessage: 'That universe could not be found. It may have been renamed, or it isn\'t open to everyone yet.',
			description: 'Shown on the whole of a universe\'s page when the universe its address names doesn\'t exist or isn\'t listed on Home'
		}) : t({
			id: 'universePage.loadFailed',
			defaultMessage: 'Could not load the universe. Reload the page to try again.',
			description: 'Shown on the whole of a universe\'s page when the universe couldn\'t be loaded, such as when the server can\'t be reached'
		})), t({
			id: 'universePage.unavailableTitle',
			defaultMessage: 'Universe',
			description: 'The browser tab\'s title on a universe\'s page when the universe couldn\'t be shown, before the game engine\'s name'
		}));
		return;
	}

	showUniverse(universe);
	void followPlayer(universe, new UniverseLanguageChooser(universe), server);
}

void start();
