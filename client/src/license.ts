import { startLocalization } from './localization';
import { startLanguagePicker } from './ui/languagePicker';

/**
 * Shows the license page in the player's language
 */
async function start(): Promise<void>
{
	await startLocalization();
	startLanguagePicker();
}

void start();
