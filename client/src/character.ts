import { CharacterPage } from './CharacterPage';
import { t } from './localization';
import { startPage } from './pageStart';
import { HOME_PAGE_URL, readPageParameter, UNIVERSE_PARAMETER } from './pages';
import { setPageTitle, showStatus } from './ui/dom';
import { pageMessages } from './ui/pageMessages';

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

	const { server } = await startPage();

	setPageTitle(document.title);
	showStatus(t(pageMessages.connecting));

	try
	{
		new CharacterPage(await server, universeId);
	}
	catch (error)
	{
		console.error('Could not connect to the server:', error);
		showStatus(t(pageMessages.connectFailed));
	}
}

void start();
