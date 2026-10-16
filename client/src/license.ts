import { startLocalization } from './localization';
import { startLanguagePicker } from './ui/languagePicker';
import { startShortcuts } from './ui/shortcuts';

/**
 * Shows the license page in the player's language
 */
async function start(): Promise<void>
{
	await startLocalization();
	startLanguagePicker();
	startShortcuts();
}

void start();
