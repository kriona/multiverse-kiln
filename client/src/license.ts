import { startLocalization } from './localization';
import { startAccountMenu } from './ui/accountMenu';
import { scrollToFragment, setPageTitle } from './ui/dom';
import { startLanguagePicker } from './ui/languagePicker';
import { startShortcuts } from './ui/shortcuts';

/**
 * Shows the license page in the player's language
 */
async function start(): Promise<void>
{
	await startLocalization();
	setPageTitle(document.title);
	void startAccountMenu();
	startLanguagePicker();
	startShortcuts();
	scrollToFragment();
}

void start();
