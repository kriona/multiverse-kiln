import { startPage } from './pageStart';
import { scrollToFragment, setPageTitle } from './ui/dom';

/**
 * Shows the license page in the player's language. It works without the server, so it doesn't wait for
 * the connection
 */
async function start(): Promise<void>
{
	await startPage();
	setPageTitle(document.title);
	scrollToFragment();
}

void start();
