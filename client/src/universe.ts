import { ServerError } from '@colyseus/sdk';
import { RULESET_NAMES, SessionServerMessageType, type AccountPayload, type UniverseDetails } from '@multiverse-kiln/shared';

import { startLocalization, t } from './localization';
import { CharacterApi } from './network/characterApi';
import { connectToServer, createClient, getUniverseDetails, type ServerConnection } from './network/serverConnection';
import { startPageLifecycle } from './pageLifecycle';
import { gamePageUrl, HOME_PAGE_URL, readUniverseKey, replacePagePath, universePageUrl } from './pages';
import { startAccountMenu } from './ui/accountMenu';
import { CharacterSheetDialog } from './ui/CharacterSheetDialog';
import { getElement, setPageTitle, showNoticeScreen, showScreen, showStatus } from './ui/dom';
import { startLanguagePicker } from './ui/languagePicker';
import { showMarkdown } from './ui/markdown';
import { pageMessages } from './ui/pageMessages';
import { startShortcuts } from './ui/shortcuts';
import { UniverseCharacters } from './ui/UniverseCharacters';

/**
 * Shows a universe: its name, ruleset and descriptions, and Enter Universe, which goes to its lobby.
 * The address ends with the slug, so one opened by ID changes to it
 *
 * @param universe The universe
 */
function showUniverse(universe: UniverseDetails): void
{
	getElement('universe-name', HTMLElement).textContent = universe.name;
	getElement('universe-ruleset', HTMLElement).textContent = t(RULESET_NAMES[universe.ruleset]);
	getElement('universe-summary', HTMLElement).textContent = universe.shortDescription;
	showMarkdown(getElement('universe-description', HTMLElement), universe.longDescription);
	getElement('universe-enter', HTMLAnchorElement).href = gamePageUrl(universe.slug);
	replacePagePath(universePageUrl(universe.slug));
	setPageTitle(universe.name);
	showScreen('universe');
}

/**
 * Lists the player's characters in the universe while the browser is logged in, following the session
 * as the player logs in or out in any window. The page works without it, so a failed connection only
 * leaves the list hidden
 *
 * @param universe The universe
 */
async function followPlayer(universe: UniverseDetails): Promise<void>
{
	let server: ServerConnection;

	try
	{
		server = await connectToServer();
	}
	catch (error)
	{
		console.error('Could not connect to the server to list your characters:', error);
		return;
	}

	const api = new CharacterApi(server.client);
	const sheet = new CharacterSheetDialog(api, () =>
	{
		void characters.follow(true);
	});
	const characters = new UniverseCharacters(api, universe.id, sheet);

	server.session.onMessage(SessionServerMessageType.Account, (account: AccountPayload) =>
	{
		void characters.follow(account.player !== null);
	});

	server.session.onLeave(() =>
	{
		void characters.follow(false);
	});
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

	startPageLifecycle();
	await startLocalization();
	void startAccountMenu();
	startLanguagePicker();
	startShortcuts();
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
	void followPlayer(universe);
}

void start();
