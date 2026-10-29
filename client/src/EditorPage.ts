import { SessionServerMessageType, type AccountPayload } from '@multiverse-kiln/shared';

import { t } from './localization';
import { EditorApi } from './network/editorApi';
import type { ServerConnection } from './network/serverConnection';
import { isLeavingPage } from './pageLifecycle';
import { currentPageAddress, gamePageUrl, HOME_PAGE_URL, loginPageUrl, pushPageParameters, replacePageParameters, TAB_PARAMETER, AREA_PARAMETER } from './pages';
import { showScreen, showStatus } from './ui/dom';
import { EditorScreen, isEditorTab, type EditorPlace } from './ui/editor/EditorScreen';
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
 * Runs the world editor's page (edit.html): edits one universe. A browser that isn't logged in goes to
 * the login page, which comes back here
 *
 * The page joins the session room, which says whether the browser is logged in and tells it when its
 * session ends. Being open counts as using the session
 */
export class EditorPage
{
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

		session.onLeave(() =>
		{
			if (!isLeavingPage())
			{
				showStatus(t(pageMessages.disconnected));
			}
		});
	}

	/**
	 * Shows the editor while the browser is logged in, and goes to the login page when it isn't. Changes
	 * not yet saved make the browser ask before leaving
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
}
