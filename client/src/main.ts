import { App } from './App';
import { startLocalization, t } from './localization';
import { connectToServer } from './network/serverConnection';
import { showStatus } from './ui/dom';
import { startLanguagePicker } from './ui/languagePicker';
import { pageMessages } from './ui/pageMessages';

/**
 * Shows the page in the player's language, connects to the server and starts the app, or explains that
 * it couldn't connect
 */
async function start(): Promise<void>
{
	await startLocalization();
	startLanguagePicker();
	showStatus(t(pageMessages.connecting));

	try
	{
		new App(await connectToServer());
	}
	catch (error)
	{
		console.error('Could not connect to the server:', error);
		showStatus(t(pageMessages.connectFailed));
	}
}

void start();
