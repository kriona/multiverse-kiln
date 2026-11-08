import { t } from './localization';
import { startPage } from './pageStart';
import { readPlayerUsername } from './pages';
import { ProfilePage } from './ProfilePage';
import { startCodeInputs } from './ui/codeInputs';
import { showStatus } from './ui/dom';
import { pageMessages } from './ui/pageMessages';
import { startPasswordToggles } from './ui/passwordToggles';

/**
 * Starts the profile page in the player's language: the player's own profile, or the one of the player
 * its address names
 */
async function start(): Promise<void>
{
	const { server } = await startPage();

	startPasswordToggles();
	startCodeInputs();
	showStatus(t(pageMessages.connecting));

	try
	{
		new ProfilePage(await server, readPlayerUsername());
	}
	catch (error)
	{
		console.error('Could not connect to the server:', error);
		showStatus(t(pageMessages.connectFailed));
	}
}

void start();
