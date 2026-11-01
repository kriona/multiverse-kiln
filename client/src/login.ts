import { LoginPage } from './LoginPage';
import { currentLocale, startLocalization, t } from './localization';
import { AuthApi } from './network/authApi';
import { EditorApiError } from './network/editorApi';
import { createClient } from './network/serverConnection';
import { onLoginElsewhere } from './network/sessionBroadcast';
import { keepProviderLinkError, providerLinkedPageUrl, readNextPage, takeProviderReturn } from './pages';
import { forgetPlayerValues } from './rememberedValues';
import { startCodeInputs } from './ui/codeInputs';
import { showNoticeScreen, showStatus } from './ui/dom';
import { startLanguagePicker } from './ui/languagePicker';
import { pageMessages } from './ui/pageMessages';
import { startPasswordToggles } from './ui/passwordToggles';
import { startShortcuts } from './ui/shortcuts';
import { startSiteSocials } from './ui/siteSocials';

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
	void startSiteSocials();
	startShortcuts();
	startPasswordToggles();
	startCodeInputs();
	showStatus(t(pageMessages.connecting));

	const api = new AuthApi(createClient());

	try
	{
		if (await api.getSession())
		{
			if (providerReturn)
			{
				await finishProviderLink(api, providerReturn);
				return;
			}

			window.location.replace(readNextPage());
			return;
		}

		forgetPlayerValues();
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

/**
 * Finishes linking a Google or Discord login from the profile, which sent the logged-in browser to the
 * provider, and goes back to the profile: naming the provider once linked, or with why it wasn't kept
 * for the profile to show. When it can't be kept, it shows here instead
 *
 * @param api The auth routes
 * @param providerReturn What the provider sent the browser back with (takeProviderReturn())
 */
async function finishProviderLink(api: AuthApi, providerReturn: URLSearchParams): Promise<void>
{
	const code = providerReturn.get('code');
	const state = providerReturn.get('state');

	// The player turned the provider down, which needs no explaining
	if ((code === null) || (state === null))
	{
		window.location.replace(readNextPage());
		return;
	}

	try
	{
		const result = await api.finishProviderLogin({
			code,
			state,
			locale: currentLocale()
		});

		window.location.replace(((result.outcome === 'linked') ? providerLinkedPageUrl(readNextPage(), result.provider) : readNextPage()));
	}
	catch (error)
	{
		if (!(error instanceof EditorApiError))
		{
			console.error('Could not link a login:', error);
		}

		const message = ((error instanceof EditorApiError) ? error.message : t(pageMessages.connectFailed));

		if (keepProviderLinkError(message))
		{
			window.location.replace(readNextPage());
		}
		else
		{
			showNoticeScreen(message);
		}
	}
}

void start();
