import { SessionServerMessageType, type AccountPayload } from '@multiverse-kiln/shared';

import { t } from './localization';
import { EditorApi } from './network/editorApi';
import { listUniverses, type ServerConnection } from './network/serverConnection';
import { onLoginElsewhere } from './network/sessionBroadcast';
import { isLeavingPage } from './pageLifecycle';
import { editPageUrl } from './pages';
import { showScreen, showStatus } from './ui/dom';
import { HomeScreen } from './ui/HomeScreen';
import { pageMessages } from './ui/pageMessages';

/**
 * Runs Home (index.html): lists the universes to play, and once the browser is logged in, the player's
 * own universes too. Anyone can see it; its toolbar links to the login page
 *
 * Each universe links to its page, which enters it on the game's page. Home stays usable while the game
 * is open in another tab
 */
export class HomePage
{
	private readonly homeScreen: HomeScreen;

	/**
	 * The player's ID at the last Account message, or null while the browser isn't logged in, or
	 * undefined before the first
	 */
	private playerId: string | null | undefined;

	/**
	 * @param server The connection to the server and the joined session room
	 */
	constructor(server: ServerConnection)
	{
		const { client, session } = server;
		const editorApi = new EditorApi(client);

		this.homeScreen = new HomeScreen({
			loadPage: (offset) => listUniverses(client, offset),
			loadOwnUniverses: () => editorApi.listUniverses(),
			createUniverse: (universe) => editorApi.createUniverse(universe),
			edit: (universeId) =>
			{
				window.location.assign(editPageUrl(universeId));
			}
		});

		session.onMessage(SessionServerMessageType.Account, (account: AccountPayload) =>
		{
			this.onAccount(account);
		});

		// This window joined the session room logged out, so it loads again to be logged in too
		onLoginElsewhere(() =>
		{
			if (this.playerId === null)
			{
				window.location.reload();
			}
		});

		session.onLeave(() =>
		{
			if (!isLeavingPage())
			{
				showStatus(t(pageMessages.disconnected));
			}
		});
	}

	/**
	 * Shows Home, logged in or not, listing the universes again when that changes. The lists aren't
	 * reloaded otherwise, so a change of group doesn't reload them or close a dialog
	 *
	 * @param account The browser's player
	 */
	private onAccount(account: AccountPayload): void
	{
		const playerId = (account.player?.playerId ?? null);

		if (playerId === this.playerId)
		{
			return;
		}

		this.playerId = playerId;
		this.homeScreen.show(account.player !== null);
		showScreen('home');
	}
}
