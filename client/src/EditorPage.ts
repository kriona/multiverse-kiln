import { CloseCode } from '@colyseus/sdk';
import { EditorMessageType, EditorServerMessageType, NoticeReason, ServerCloseCode, SessionServerMessageType, type AccountPayload, type ChatPayload, type EditorPlacePayload, type KeptChatHistoryPayload, type KeptChatMessage, type NoticePayload, type UniverseVersionName } from '@multiverse-kiln/shared';

import { t } from './localization';
import { EditorApi } from './network/editorApi';
import { joinEditorRoom, type EditorRoom, type ServerConnection } from './network/serverConnection';
import { isLeavingPage } from './pageLifecycle';
import { currentPageAddress, loginPageUrl, pushPageParameters, replacePageParameters, TAB_PARAMETER, AREA_PARAMETER, VERSION_PARAMETER } from './pages';
import { showScreen, showStatus } from './ui/dom';
import { EditorChat } from './ui/editor/EditorChat';
import { EditorPresenceBar } from './ui/editor/EditorPresenceBar';
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
 * session ends. Being open counts as using the session. Once logged in, it joins the universe's editor
 * room too, which lists who has the editor open and carries the editors' chat, and tells it what this
 * window has open
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
	 * The version of the universe open
	 */
	private version: UniverseVersionName;

	/**
	 * The universe's editor room, while it is joined
	 */
	private editorRoom: EditorRoom | undefined;

	/**
	 * The editors' chat, once the browser is known to be logged in
	 */
	private chat: EditorChat | undefined;

	/**
	 * The other editors and where they are, in the save bar, once the browser is known to be logged in
	 */
	private presenceBar: EditorPresenceBar | undefined;

	/**
	 * @param server The connection to the server and the joined session room
	 * @param universeId The universe to edit
	 * @param startingPlace The tab and area to open it at
	 * @param version The version of the universe to open
	 */
	constructor(private readonly server: ServerConnection, private readonly universeId: string, private readonly startingPlace: Partial<EditorPlace>, version: UniverseVersionName)
	{
		const { client, session } = server;
		const api = new EditorApi(client);

		api.version = version;
		this.version = version;
		this.editorScreen = new EditorScreen(api, {
			placeChanged: (changed) =>
			{
				this.recordPlace(changed);
				this.sendPlace();
			},
			versionChanged: (changed) =>
			{
				this.version = changed;
				replacePageParameters({
					[VERSION_PARAMETER]: ((changed === 'draft') ? changed : undefined)
				});
				this.sendPlace();
			},
			areasLoaded: () =>
			{
				this.presenceBar?.refresh();
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
			this.chat = new EditorChat(account.player.playerId, (text) =>
			{
				const chat: ChatPayload = { text };

				this.editorRoom?.send(EditorMessageType.Chat, chat);
			});
			this.presenceBar = new EditorPresenceBar(account.player.playerId, (version, areaId) => this.editorScreen.areaName(version, areaId), (shown) =>
			{
				this.editorScreen.setOthersHere(shown);
			});
			void this.editorScreen.open(this.universeId, this.startingPlace);
			void this.joinEditorRoom(this.chat, this.presenceBar);
		}
	}

	/**
	 * Joins the universe's editor room, which lists who has the editor open and carries the editors'
	 * chat, and follows what it says
	 *
	 * @param chat The editors' chat
	 * @param presenceBar The other editors and where they are, in the save bar
	 */
	private async joinEditorRoom(chat: EditorChat, presenceBar: EditorPresenceBar): Promise<void>
	{
		let room: EditorRoom;

		try
		{
			room = await joinEditorRoom(this.server.client, this.universeId);
		}
		catch (error)
		{
			console.error('Could not join the editor room:', error);
			chat.showProblem(t({
				id: 'editor.chat.notJoined',
				defaultMessage: 'Could not connect to the editors\' chat. Reload the page to try again.',
				description: 'Shown in the editors\' chat panel when the page couldn\'t join it, which also lists who has the editor open'
			}));
			return;
		}

		this.editorRoom = room;
		chat.setConnected(true);
		this.sendPlace();

		room.onStateChange(() =>
		{
			chat.showEditors(room.state.editors);
			presenceBar.show(room.state.editors);
		});

		room.onMessage(EditorServerMessageType.ChatHistory, (history: KeptChatHistoryPayload) =>
		{
			chat.setHistory(history.messages);
		});

		room.onMessage(EditorServerMessageType.Chat, (message: KeptChatMessage) =>
		{
			chat.addMessage(message);
		});

		room.onMessage(EditorServerMessageType.Notice, (notice: NoticePayload) =>
		{
			if (notice.reason === NoticeReason.ChatTooFast)
			{
				chat.refuseTooFast();
			}
		});

		room.onMessage(EditorServerMessageType.AccessChanged, () =>
		{
			this.editorScreen.accessChanged();
		});

		room.onLeave((code: number) =>
		{
			this.onEditorRoomLeft(chat, code);
		});
	}

	/**
	 * Handles the editor room closing when the page isn't being left: says why in the chat, and turns
	 * saving off when the player may no longer edit the universe or it was deleted
	 *
	 * @param chat The editors' chat
	 * @param code WebSocket close code
	 */
	private onEditorRoomLeft(chat: EditorChat, code: number): void
	{
		this.editorRoom = undefined;
		this.presenceBar?.show([]);

		// A session that ended goes to the login page when the session room says so
		if (isLeavingPage() || (code === CloseCode.CONSENTED) || (code === ServerCloseCode.LoggedOut.valueOf()))
		{
			return;
		}

		if (code === ServerCloseCode.AccessLost.valueOf())
		{
			const message = t({
				id: 'editor.accessLost',
				defaultMessage: 'You no longer have a role in this universe, so your changes can\'t be saved.',
				description: 'Shown above the editor\'s tabs, and in the editors\' chat panel, when the player\'s role in the universe was taken away while they had the editor open'
			});

			this.editorScreen.lockOut(message);
			chat.showProblem(message);
		}
		else if (code === ServerCloseCode.UniverseDeleted.valueOf())
		{
			const message = t({
				id: 'editor.universeDeleted',
				defaultMessage: 'This universe has been deleted, so changes to it can\'t be saved.',
				description: 'Shown above the editor\'s tabs, and in the editors\' chat panel, when the universe was deleted while the player had its editor open'
			});

			this.editorScreen.lockOut(message);
			chat.showProblem(message);
		}
		else
		{
			chat.showProblem(t({
				id: 'editor.chat.disconnected',
				defaultMessage: 'The editors\' chat was disconnected. Reload the page to reconnect.',
				description: 'Shown in the editors\' chat panel when its connection to the server was lost'
			}));
		}
	}

	/**
	 * Tells the editor room which version, tab and area the page has open, once it has opened one
	 */
	private sendPlace(): void
	{
		if (!this.editorRoom || !this.place)
		{
			return;
		}

		const place: EditorPlacePayload = {
			version: this.version,
			tab: this.place.tab,
			areaId: (this.place.areaId ?? null)
		};

		this.editorRoom.send(EditorMessageType.Place, place);
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
			this.sendPlace();
		}
		else
		{
			pushPageParameters(placeParameters(place), place);
		}
	}
}
