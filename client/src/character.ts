import { CharacterPage } from './CharacterPage';
import { startLocalization, t } from './localization';
import { connectToServer } from './network/serverConnection';
import { startPageLifecycle } from './pageLifecycle';
import { HOME_PAGE_URL, readPageParameter, UNIVERSE_PARAMETER } from './pages';
import { startAccountMenu } from './ui/accountMenu';
import { setPageTitle, showStatus } from './ui/dom';
import { startLanguagePicker } from './ui/languagePicker';
import { pageMessages } from './ui/pageMessages';
import { startShortcuts } from './ui/shortcuts';
import { startSiteSocials } from './ui/siteSocials';

/**
 * Starts the Create Character page in the player's language for the universe its address names, or goes
 * to Home without one
 */
async function start(): Promise<void>
{
	const universeId = readPageParameter(UNIVERSE_PARAMETER);

	if (universeId === undefined)
	{
		window.location.replace(HOME_PAGE_URL);
		return;
	}

	startPageLifecycle();
	await startLocalization();
	setPageTitle(document.title);
	void startAccountMenu();
	startLanguagePicker();
	void startSiteSocials();
	startShortcuts();
	showStatus(t(pageMessages.connecting));

	try
	{
		new CharacterPage(await connectToServer(), universeId);
	}
	catch (error)
	{
		console.error('Could not connect to the server:', error);
		showStatus(t(pageMessages.connectFailed));
	}
}

void start();
