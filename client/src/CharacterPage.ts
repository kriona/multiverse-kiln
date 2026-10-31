import { INVITE_QUERY_PARAMETER, SessionServerMessageType, type AccountPayload } from '@multiverse-kiln/shared';

import { t } from './localization';
import { CharacterApi } from './network/characterApi';
import type { ServerConnection } from './network/serverConnection';
import { isLeavingPage } from './pageLifecycle';
import { currentPageAddress, gamePageUrl, loginPageUrl, readPageParameter } from './pages';
import { CreateCharacterScreen } from './ui/CreateCharacterScreen';
import { showScreen, showStatus } from './ui/dom';
import { pageMessages } from './ui/pageMessages';

/**
 * Runs the Create Character page (character.html): makes a character in one universe, going back to
 * its lobby when done. A browser that isn't logged in goes to the login page, which comes back here
 *
 * Like the world editor, the page joins the session room, so being open counts as using the session
 */
export class CharacterPage
{
	private readonly characterScreen: CreateCharacterScreen;

	/**
	 * Whether Create Character has been opened; it opens once, the first time the browser is logged in
	 */
	private opened = false;

	/**
	 * @param server The connection to the server and the joined session room
	 * @param universeId The universe to make the character in
	 */
	constructor(server: ServerConnection, private readonly universeId: string)
	{
		const { client, session } = server;

		// Opened from an invite link, it goes back to the invite to choose the new character
		this.characterScreen = new CreateCharacterScreen(new CharacterApi(client), () =>
		{
			window.location.assign(gamePageUrl(universeId, readPageParameter(INVITE_QUERY_PARAMETER)));
		});

		session.onMessage(SessionServerMessageType.Account, (account: AccountPayload) =>
		{
			this.onAccount(account);
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
	 * Shows Create Character while the browser is logged in, and goes to the login page when it isn't
	 *
	 * @param account The browser's player
	 */
	private onAccount(account: AccountPayload): void
	{
		if (!account.player)
		{
			window.location.replace(loginPageUrl(currentPageAddress()));
			return;
		}

		showScreen('character');

		if (!this.opened)
		{
			this.opened = true;
			void this.characterScreen.open(this.universeId);
		}
	}
}
