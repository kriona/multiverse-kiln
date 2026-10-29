import { HomePage } from './HomePage';
import { startLocalization, t } from './localization';
import { connectToServer } from './network/serverConnection';
import { startPageLifecycle } from './pageLifecycle';
import { startAccountMenu } from './ui/accountMenu';
import { showStatus } from './ui/dom';
import { startLanguagePicker } from './ui/languagePicker';
import { pageMessages } from './ui/pageMessages';
import { startShortcuts } from './ui/shortcuts';

/**
 * Shows Home in the player's language, connects to the server and lists the universes, or explains that
 * it couldn't connect
 */
async function start(): Promise<void>
{
	startPageLifecycle();
	await startLocalization();
	void startAccountMenu();
	startLanguagePicker();
	startShortcuts();
	showStatus(t(pageMessages.connecting));

	try
	{
		new HomePage(await connectToServer());
	}
	catch (error)
	{
		console.error('Could not connect to the server:', error);
		showStatus(t(pageMessages.connectFailed));
	}
}

void start();
