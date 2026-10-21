import { NAME_MESSAGES, NoticeReason, SessionMessageType, SessionServerMessageType, type AccountPayload, type LoginPayload, type NoticePayload } from '@multiverse-kiln/shared';

import { t } from './localization';
import { EditorApi } from './network/editorApi';
import { listUniverses, type ServerConnection } from './network/serverConnection';
import { isLeavingPage } from './pageLifecycle';
import { editPageUrl } from './pages';
import { showScreen, showStatus } from './ui/dom';
import { HomeScreen } from './ui/HomeScreen';
import { LoginScreen } from './ui/LoginScreen';
import { pageMessages } from './ui/pageMessages';

/**
 * Runs Home (index.html): logs the browser in, then lists the universes to play and the player's own
 *
 * Each universe links to its page, which enters it on the game's page. Home stays usable while the game
 * is open in another tab
 */
export class HomePage
{
	private readonly loginScreen: LoginScreen;
	private readonly homeScreen: HomeScreen;

	/**
	 * Whether the browser was logged in at the last Account message
	 */
	private loggedIn = false;

	/**
	 * @param server The connection to the server and the joined session room
	 */
	constructor(server: ServerConnection)
	{
		const { client, session } = server;
		const editorApi = new EditorApi(client);

		this.loginScreen = new LoginScreen((name) =>
		{
			const login: LoginPayload = { name };

			session.send(SessionMessageType.Login, login);
		});

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
	 * Shows the login screen while the browser is logged out, and Home once it logs in. Home lists the
	 * universes when it is shown, and only then, so a change of group doesn't reload the lists or close
	 * a dialog
	 *
	 * @param account The browser's player
	 */
	private onAccount(account: AccountPayload): void
	{
		const { player } = account;
		const wasLoggedIn = this.loggedIn;

		this.loggedIn = (player !== null);

		if (!player)
		{
			this.loginScreen.reset();
			showScreen('login');
			return;
		}

		if (!wasLoggedIn)
		{
			this.homeScreen.show(player.name);
			showScreen('home');
		}
	}

	/**
	 * Explains why logging in didn't work. Home ignores the session's other notices, which are about groups
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
