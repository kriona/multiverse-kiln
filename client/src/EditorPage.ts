import { NoticeReason, SessionMessageType, SessionServerMessageType, type AccountPayload, type LoginPayload, type NoticePayload } from '@multiverse-kiln/shared';

import { EditorApi } from './network/editorApi';
import type { ServerConnection } from './network/serverConnection';
import { gamePageUrl, replacePageParameters, TAB_PARAMETER, ZONE_PARAMETER } from './pages';
import { showScreen, showStatus } from './ui/dom';
import { EditorScreen, type EditorPlace } from './ui/editor/EditorScreen';
import { LoginScreen } from './ui/LoginScreen';

/**
 * Runs the world editor's page (edit.html): logs the browser in, then edits one universe
 *
 * The editor's requests need the browser to be logged in, and a browser is only logged in while one
 * of its windows is in the session room, so this page joins it too. When the game is open in another
 * tab, the browser is logged in already and the editor opens straight away
 */
export class EditorPage
{
	private readonly loginScreen: LoginScreen;
	private readonly editorScreen: EditorScreen;

	/**
	 * Whether the editor has been opened; it opens once, the first time the browser is logged in
	 */
	private opened = false;

	/**
	 * @param server The connection to the server and the joined session room
	 * @param universeId The universe to edit
	 * @param place The tab and zone to open it at
	 */
	constructor(server: ServerConnection, private readonly universeId: string, private readonly place: Partial<EditorPlace>)
	{
		const { client, session } = server;

		this.loginScreen = new LoginScreen((name) =>
		{
			const login: LoginPayload = { name };

			session.send(SessionMessageType.Login, login);
		});

		this.editorScreen = new EditorScreen(new EditorApi(client), {
			goHome: () =>
			{
				window.location.assign(gamePageUrl());
			},
			play: (universe) =>
			{
				window.location.assign(gamePageUrl(universe.id));
			},
			placeChanged: (changed) =>
			{
				replacePageParameters({
					[TAB_PARAMETER]: ((changed.tab === 'universe') ? undefined : changed.tab),
					[ZONE_PARAMETER]: changed.zoneId
				});
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
			showStatus('Disconnected from the server. Reload the page to reconnect.');
		});
	}

	/**
	 * Shows the login screen while the browser is logged out, and the editor once it is logged in
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

		showScreen('editor');

		if (!this.opened)
		{
			this.opened = true;
			void this.editorScreen.open(this.universeId, this.place);
		}
	}

	/**
	 * Explains why logging in didn't work. The editor ignores the session's other notices, which are about groups
	 *
	 * @param reason Why
	 */
	private onNotice(reason: NoticeReason): void
	{
		if (reason === NoticeReason.NameInUse)
		{
			this.loginScreen.showError('That player is already logged in from another browser.');
		}
		else if (reason === NoticeReason.LoginFailed)
		{
			this.loginScreen.showError('Could not log in. Try again in a moment.');
		}
	}
}
