import { startLocalization } from './localization';
import { AdminApi } from './network/adminApi';
import { createClient } from './network/serverConnection';
import { startAccountMenu } from './ui/accountMenu';
import { setPageTitle } from './ui/dom';
import { SiteSettingsForm } from './ui/SiteSettingsForm';
import { startLanguagePicker } from './ui/languagePicker';
import { startShortcuts } from './ui/shortcuts';
import { startSiteSocials } from './ui/siteSocials';

/**
 * Starts the admin page in the player's language, and loads the site's settings
 */
async function start(): Promise<void>
{
	await startLocalization();
	setPageTitle(document.title);
	void startAccountMenu();
	startLanguagePicker();
	void startSiteSocials();
	startShortcuts();
	await new SiteSettingsForm(new AdminApi(createClient())).load();
}

void start();
