import { CharacterPage } from './CharacterPage';
import { startLocalization, t } from './localization';
import { connectToServer } from './network/serverConnection';
import { startPageLifecycle } from './pageLifecycle';
import { gamePageUrl, readPageParameter, UNIVERSE_PARAMETER } from './pages';
import { showStatus } from './ui/dom';
import { startLanguagePicker } from './ui/languagePicker';
import { pageMessages } from './ui/pageMessages';
import { startShortcuts } from './ui/shortcuts';

/**
 * Starts the Create Character page in the player's language for the universe its address names, or goes
 * to Home without one
 */
async function start(): Promise<void>
{
	const universeId = readPageParameter(UNIVERSE_PARAMETER);

	if (universeId === undefined)
	{
		window.location.replace(gamePageUrl());
		return;
	}

	startPageLifecycle();
	await startLocalization();
	startLanguagePicker();
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
