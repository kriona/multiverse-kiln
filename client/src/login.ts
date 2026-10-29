import { LoginPage } from './LoginPage';
import { startLocalization, t } from './localization';
import { AuthApi } from './network/authApi';
import { createClient } from './network/serverConnection';
import { onLoginElsewhere } from './network/sessionBroadcast';
import { readNextPage, takeProviderReturn } from './pages';
import { startCodeInputs } from './ui/codeInputs';
import { showStatus } from './ui/dom';
import { startLanguagePicker } from './ui/languagePicker';
import { pageMessages } from './ui/pageMessages';
import { startPasswordToggles } from './ui/passwordToggles';
import { startShortcuts } from './ui/shortcuts';

/**
 * Starts the login page in the player's language. A browser that is logged in already goes straight
 * on to the page it was sent from, as it does when another tab logs it in
 */
async function start(): Promise<void>
{
	// Before anything reads the address: it holds the language and the page to go back to
	const providerReturn = takeProviderReturn();

	await startLocalization();
	startLanguagePicker();
	startShortcuts();
	startPasswordToggles();
	startCodeInputs();
	showStatus(t(pageMessages.connecting));

	const api = new AuthApi(createClient());

	try
	{
		if (await api.getSession())
		{
			window.location.replace(readNextPage());
			return;
		}
	}
	catch (error)
	{
		console.error('Could not connect to the server:', error);
		showStatus(t(pageMessages.connectFailed));
		return;
	}

	onLoginElsewhere(() =>
	{
		window.location.replace(readNextPage());
	});

	await new LoginPage(api).start(providerReturn);
}

void start();
