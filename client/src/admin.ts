import { startLocalization } from './localization';
import { AdminApi } from './network/adminApi';
import { createClient } from './network/serverConnection';
import { setPageTitle } from './ui/dom';
import { SiteSettingsForm } from './ui/SiteSettingsForm';
import { startLanguagePicker } from './ui/languagePicker';
import { startShortcuts } from './ui/shortcuts';

/**
 * Starts the admin page in the player's language, and loads the site's settings
 */
async function start(): Promise<void>
{
	await startLocalization();
	setPageTitle(document.title);
	startLanguagePicker();
	startShortcuts();
	await new SiteSettingsForm(new AdminApi(createClient())).load();
}

void start();
