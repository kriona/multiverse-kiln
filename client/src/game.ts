import { GamePage } from './GamePage';
import { t } from './localization';
import { startPage } from './pageStart';
import { showStatus } from './ui/dom';
import { pageMessages } from './ui/pageMessages';

/**
 * Shows the game's page in the player's language, connects to the server and starts the lobby and game,
 * or explains that it couldn't connect
 */
async function start(): Promise<void>
{
	const { server } = await startPage();

	showStatus(t(pageMessages.connecting));

	try
	{
		new GamePage(await server);
	}
	catch (error)
	{
		console.error('Could not connect to the server:', error);
		showStatus(t(pageMessages.connectFailed));
	}
}

void start();
