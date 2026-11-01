import { startLocalization } from './localization';
import { connectToServer, type ServerConnection } from './network/serverConnection';
import { startPageLifecycle } from './pageLifecycle';
import { startAccountMenu } from './ui/accountMenu';
import { startLanguagePicker } from './ui/languagePicker';
import { startShortcuts } from './ui/shortcuts';
import { startSiteSocials } from './ui/siteSocials';

/**
 * A page that startPage() has started
 */
export interface StartedPage
{
	/**
	 * The connection to the server, once the session room is joined. It rejects when the server can't be
	 * reached, which a page that works without it can ignore
	 */
	server: Promise<ServerConnection>;
}

/**
 * Starts what every page with the site's toolbar has, then connects to the server: the page in the
 * player's language, the account menu, the language picker, the site's social links and the keyboard
 * shortcuts. Every such page joins the session room, so having any of them open counts as using the
 * session, its account menu follows the player logging in and out in other windows, and features that
 * work on every page (such as chat) have a connection to use. The login page starts on its own
 *
 * The connection starts once the page is in the player's language, so what a page shows while it
 * connects, and if it can't, is in that language too. A page listening for the session room's messages
 * adds its handlers as soon as the connection resolves, before the room's first message is handled
 *
 * @return The started page
 */
export async function startPage(): Promise<StartedPage>
{
	startPageLifecycle();
	await startLocalization();

	const server = connectToServer();

	startAccountMenu(server);
	startLanguagePicker();
	void startSiteSocials();
	startShortcuts();

	return({ server });
}
