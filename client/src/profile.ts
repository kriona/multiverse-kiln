import { startLocalization, t } from './localization';
import { connectToServer } from './network/serverConnection';
import { startPageLifecycle } from './pageLifecycle';
import { readPlayerUsername } from './pages';
import { ProfilePage } from './ProfilePage';
import { startAccountMenu } from './ui/accountMenu';
import { startCodeInputs } from './ui/codeInputs';
import { showStatus } from './ui/dom';
import { startLanguagePicker } from './ui/languagePicker';
import { pageMessages } from './ui/pageMessages';
import { startPasswordToggles } from './ui/passwordToggles';
import { startShortcuts } from './ui/shortcuts';
import { startSiteSocials } from './ui/siteSocials';

/**
 * Starts the profile page in the player's language: the player's own profile, or the one of the player
 * its address names
 */
async function start(): Promise<void>
{
	startPageLifecycle();
	await startLocalization();
	void startAccountMenu();
	startLanguagePicker();
	void startSiteSocials();
	startShortcuts();
	startPasswordToggles();
	startCodeInputs();
	showStatus(t(pageMessages.connecting));

	try
	{
		new ProfilePage(await connectToServer(), readPlayerUsername());
	}
	catch (error)
	{
		console.error('Could not connect to the server:', error);
		showStatus(t(pageMessages.connectFailed));
	}
}

void start();
