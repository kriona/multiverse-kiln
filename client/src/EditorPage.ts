import { NAME_MESSAGES, NoticeReason, SessionMessageType, SessionServerMessageType, type AccountPayload, type LoginPayload, type NoticePayload } from '@multiverse-kiln/shared';

import { t } from './localization';
import { EditorApi } from './network/editorApi';
import type { ServerConnection } from './network/serverConnection';
import { isLeavingPage } from './pageLifecycle';
import { gamePageUrl, HOME_PAGE_URL, pushPageParameters, replacePageParameters, TAB_PARAMETER, AREA_PARAMETER } from './pages';
import { showScreen, showStatus } from './ui/dom';
import { EditorScreen, isEditorTab, type EditorPlace } from './ui/editor/EditorScreen';
import { LoginScreen } from './ui/LoginScreen';
import { pageMessages } from './ui/pageMessages';

/**
 * The query string parameters that show a place in the editor. The Universe tab is named whenever an
 * area is, since an address with an area and no tab opens the Areas tab
 *
 * @param place The tab and area
 * @return Each parameter's value, or undefined to leave it out
 */
function placeParameters(place: EditorPlace): Record<string, string | undefined>
{
	return({
		[TAB_PARAMETER]: (((place.tab === 'universe') && (place.areaId === undefined)) ? undefined : place.tab),
		[AREA_PARAMETER]: place.areaId
	});
}

/**
 * Whether a history entry's state is a place in the editor, as recordPlace() stores it
 *
 * @param state The state
 * @return True when it is
 */
function isEditorPlace(state: unknown): state is EditorPlace
{
	if ((typeof state !== 'object') || (state === null))
	{
		return(false);
	}

	const { tab, areaId } = state as Record<string, unknown>;

	return(isEditorTab(typeof tab === 'string' ? tab : undefined) && ((areaId === undefined) || (typeof areaId === 'string')));
}

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
	 * The tab and area the page's address shows, once the editor has opened
	 */
	private place: EditorPlace | undefined;

	/**
	 * Whether the place has already changed in the task running now. One action, such as Edit the
	 * lobby's area choosing a tab and then an area, adds one entry to the page's history
	 */
	private changingPlace = false;

	/**
	 * Whether the editor is showing a place the page's history went back or forward to, which is in the address already
	 */
	private restoringPlace = false;

	/**
	 * @param server The connection to the server and the joined session room
	 * @param universeId The universe to edit
	 * @param place The tab and area to open it at
	 */
	constructor(server: ServerConnection, private readonly universeId: string, private readonly startingPlace: Partial<EditorPlace>)
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
				window.location.assign(HOME_PAGE_URL);
			},
			play: (universe) =>
			{
				window.location.assign(gamePageUrl(universe.slug));
			},
			placeChanged: (changed) =>
			{
				this.recordPlace(changed);
			}
		});

		window.addEventListener('popstate', (event) =>
		{
			this.restorePlace(event.state);
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
			void this.editorScreen.open(this.universeId, this.startingPlace);
		}
	}

	/**
	 * Puts where the player has moved to in the page's address and history, so the browser's Back button
	 * returns to where they were. The place the editor opens at replaces the entry the page loaded with
	 *
	 * @param place The tab and area
	 */
	private recordPlace(place: EditorPlace): void
	{
		const previous = this.place;

		if (this.restoringPlace || ((previous?.tab === place.tab) && (previous.areaId === place.areaId)))
		{
			return;
		}

		this.place = { ...place };

		if ((previous === undefined) || this.changingPlace)
		{
			replacePageParameters(placeParameters(place), this.place);
		}
		else
		{
			pushPageParameters(placeParameters(place), this.place);
		}

		if (!this.changingPlace)
		{
			this.changingPlace = true;
			queueMicrotask(() =>
			{
				this.changingPlace = false;
			});
		}
	}

	/**
	 * Shows the place the browser's Back or Forward button went to. When the player keeps unsaved changes
	 * instead, the place they stay at goes back in the history, so the address still shows it
	 *
	 * @param state What the history entry holds
	 */
	private restorePlace(state: unknown): void
	{
		const place = this.place;

		if (!isEditorPlace(state) || (place === undefined))
		{
			return;
		}

		this.restoringPlace = true;

		let shown: boolean;

		try
		{
			shown = this.editorScreen.showPlace(state);
		}
		finally
		{
			this.restoringPlace = false;
		}

		if (shown)
		{
			this.place = { ...state };
		}
		else
		{
			pushPageParameters(placeParameters(place), place);
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
