import { GamePage } from './GamePage';
import { startLocalization, t } from './localization';
import { connectToServer } from './network/serverConnection';
import { startPageLifecycle } from './pageLifecycle';
import { showStatus } from './ui/dom';
import { startLanguagePicker } from './ui/languagePicker';
import { pageMessages } from './ui/pageMessages';
import { startShortcuts } from './ui/shortcuts';

/**
 * Shows the game's page in the player's language, connects to the server and starts the lobby and game,
 * or explains that it couldn't connect
 */
async function start(): Promise<void>
{
	startPageLifecycle();
	await startLocalization();
	startLanguagePicker();
	startShortcuts();
	showStatus(t(pageMessages.connecting));

	try
	{
		new GamePage(await connectToServer());
	}
	catch (error)
	{
		console.error('Could not connect to the server:', error);
		showStatus(t(pageMessages.connectFailed));
	}
}

void start();
