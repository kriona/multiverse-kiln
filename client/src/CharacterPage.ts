import { NAME_MESSAGES, NoticeReason, SessionMessageType, SessionServerMessageType, type AccountPayload, type LoginPayload, type NoticePayload } from '@multiverse-kiln/shared';

import { t } from './localization';
import { CharacterApi } from './network/characterApi';
import type { ServerConnection } from './network/serverConnection';
import { isLeavingPage } from './pageLifecycle';
import { gamePageUrl } from './pages';
import { CreateCharacterScreen } from './ui/CreateCharacterScreen';
import { showScreen, showStatus } from './ui/dom';
import { LoginScreen } from './ui/LoginScreen';
import { pageMessages } from './ui/pageMessages';

/**
 * Runs the Create Character page (character.html): logs the browser in, then makes a character in one
 * universe, going back to its lobby when done
 *
 * Like the world editor, the page joins the session room so the browser stays logged in while it is open
 */
export class CharacterPage
{
	private readonly loginScreen: LoginScreen;
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

		this.loginScreen = new LoginScreen((name) =>
		{
			const login: LoginPayload = { name };

			session.send(SessionMessageType.Login, login);
		});

		this.characterScreen = new CreateCharacterScreen(new CharacterApi(client), () =>
		{
			window.location.assign(gamePageUrl(universeId));
		});

		session.onMessage(SessionServerMessageType.Account, (account: AccountPayload) =>
		{
			this.onAccount(account);
		});

		session.onMessage(SessionServerMessageType.Notice, (notice: NoticePayload) =>
		{
			this.onNotice(notice.reason);
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
	 * Shows the login screen while the browser is logged out, and Create Character once it is logged in
	 *
	 * @param account The browser's player
	 */
	private onAccount(account: AccountPayload): void
	{
		if (!account.player)
		{
			this.loginScreen.reset();
			showScreen('login');
			return;
		}

		showScreen('character');

		if (!this.opened)
		{
			this.opened = true;
			void this.characterScreen.open(this.universeId);
		}
	}

	/**
	 * Explains why logging in didn't work. The page ignores the session's other notices, which are about groups
	 *
	 * @param reason Why
	 */
	private onNotice(reason: NoticeReason): void
	{
		if (reason === NoticeReason.NameInUse)
		{
			this.loginScreen.showError(t(pageMessages.nameInUse));
		}
		else if (reason === NoticeReason.NameReserved)
		{
			this.loginScreen.showError(t(NAME_MESSAGES.reserved));
		}
		else if (reason === NoticeReason.LoginFailed)
		{
			this.loginScreen.showError(t(pageMessages.loginFailed));
		}
	}
}
