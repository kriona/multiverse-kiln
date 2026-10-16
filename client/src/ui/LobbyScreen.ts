import { Callbacks } from '@colyseus/sdk';
import { DISALLOWED_TEXT_CHARACTERS, MAX_CHAT_MESSAGE_LENGTH, type ChatMessage, type LobbyMember } from '@multiverse-kiln/shared';

import { currentLocale, t } from '../localization';
import type { LobbyConnection } from '../network/serverConnection';
import { getElement } from './dom';
import type { MapView } from './MapView';

/**
 * Most names shown in the list of who's here; the rest are counted
 *
 * The lobby may hold hundreds of players, more than are worth drawing or reading
 */
const MAX_LISTED_PLAYERS = 100;

/**
 * Most chat messages kept on screen
 */
const MAX_CHAT_LINES = 200;

/**
 * How close to the bottom, in pixels, the chat must be scrolled to keep following new messages
 */
const CHAT_FOLLOW_THRESHOLD = 40;

/**
 * What the lobby screen asks the app to do
 */
export interface LobbyScreenActions
{
	sendChat: (text: string) => void;
	createGroup: () => void;

	/**
	 * Go back to Home
	 */
	leaveLobby: () => void;
}

/**
 * The lobby screen: the lobby's map, chat, who's here, and the Create game and Leave lobby buttons
 *
 * The screen is made once and attached to whichever universe lobby the window is in
 */
export class LobbyScreen
{
	private readonly title = getElement('lobby-title', HTMLElement);
	private readonly playerName = getElement('lobby-player-name', HTMLElement);
	private readonly createButton = getElement('create-group', HTMLButtonElement);
	private readonly leaveButton = getElement('leave-lobby', HTMLButtonElement);
	private readonly map = getElement('lobby-map', HTMLElement);
	private readonly notice = getElement('lobby-notice', HTMLElement);
	private readonly chatLog = getElement('chat-log', HTMLOListElement);
	private readonly chatForm = getElement('chat-form', HTMLFormElement);
	private readonly chatInput = getElement('chat-input', HTMLInputElement);
	private readonly memberCount = getElement('member-count', HTMLElement);
	private readonly memberList = getElement('member-list', HTMLUListElement);
	private readonly memberMore = getElement('member-more', HTMLElement);

	/**
	 * Names of the players in the lobby, by player ID
	 */
	private readonly members = new Map<string, string>();

	/**
	 * The lobby the screen is drawing, if any
	 */
	private attached: LobbyConnection | undefined;

	/**
	 * Stops following the attached lobby's state
	 */
	private readonly unbinds: Array<() => void> = [];

	private ownPlayerId: string | undefined;
	private lastSentChat = '';
	private memberListQueued = false;

	/**
	 * @param mapView The map, shared with the group screen
	 * @param actions What the screen's controls do
	 */
	constructor(private readonly mapView: MapView, actions: LobbyScreenActions)
	{
		this.chatInput.maxLength = MAX_CHAT_MESSAGE_LENGTH;

		this.chatForm.addEventListener('submit', (event) =>
		{
			event.preventDefault();

			const text = this.chatInput.value.trim();

			if ((text === '') || DISALLOWED_TEXT_CHARACTERS.test(text))
			{
				return;
			}

			actions.sendChat(text);
			this.lastSentChat = text;
			this.chatInput.value = '';
		});

		this.createButton.addEventListener('click', () =>
		{
			// Stays disabled until the server answers, which shows the group screen
			this.createButton.disabled = true;
			this.hideNotice();
			actions.createGroup();
		});

		this.leaveButton.addEventListener('click', () =>
		{
			this.hideNotice();
			actions.leaveLobby();
		});
	}

	/**
	 * Draws a lobby the window has joined and follows who's in it, in place of any lobby it was attached to before
	 *
	 * @param connection The joined lobby, whose state lists its members
	 */
	attach(connection: LobbyConnection): void
	{
		const callbacks = Callbacks.get(connection.room);

		this.detach();
		this.attached = connection;
		this.mapView.show(this.map, connection);

		// Fires for members already in the lobby too
		this.unbinds.push(callbacks.onAdd('members', (member: LobbyMember, playerId: string) =>
		{
			this.members.set(playerId, member.name);
			this.queueMemberList();
		}));

		this.unbinds.push(callbacks.onRemove('members', (_member: LobbyMember, playerId: string) =>
		{
			this.members.delete(playerId);
			this.queueMemberList();
		}));
	}

	/**
	 * Stops drawing and following the attached lobby, and empties the chat and the list of who's here
	 */
	detach(): void
	{
		if (this.attached)
		{
			this.mapView.hide();
			this.attached = undefined;
		}

		for (const unbind of this.unbinds.splice(0))
		{
			unbind();
		}

		this.members.clear();
		this.chatLog.replaceChildren();
		this.queueMemberList();
	}

	/**
	 * Gets the screen ready to be shown for a player
	 *
	 * @param universeName The name of the universe whose lobby it is
	 * @param playerId The player's ID
	 * @param name The player's name
	 */
	show(universeName: string, playerId: string, name: string): void
	{
		this.ownPlayerId = playerId;
		this.title.textContent = universeName;
		document.title = t({
			id: 'lobby.pageTitle',
			defaultMessage: 'Lobby - {universe} - Multiverse Kiln',
			description: 'The browser tab\'s title in a universe\'s lobby; {universe} is the universe\'s name and Multiverse Kiln is the game engine\'s name'
		}, { universe: universeName });
		this.playerName.textContent = name;
		this.createButton.disabled = false;
		this.queueMemberList();
	}

	/**
	 * Replaces the chat with the server's recent messages
	 *
	 * @param messages The messages, oldest first
	 */
	setChatHistory(messages: ChatMessage[]): void
	{
		this.chatLog.replaceChildren();

		for (const message of messages)
		{
			this.addChatMessage(message);
		}

		this.chatLog.scrollTop = this.chatLog.scrollHeight;
	}

	/**
	 * Adds a chat message, following it if the chat was scrolled to the bottom
	 *
	 * @param message The message
	 */
	addChatMessage(message: ChatMessage): void
	{
		const following = (this.chatLog.scrollHeight - this.chatLog.scrollTop - this.chatLog.clientHeight < CHAT_FOLLOW_THRESHOLD);
		const line = document.createElement('li');
		const time = document.createElement('span');
		const name = document.createElement('span');
		const text = document.createElement('span');

		time.className = 'chat-time';
		time.textContent = new Date(message.sentAt).toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' });
		name.className = 'chat-name';
		name.textContent = message.name;
		text.textContent = message.text;

		line.classList.toggle('chat-own', (message.playerId === this.ownPlayerId));
		line.append(time, name, text);
		this.chatLog.append(line);

		while (this.chatLog.childElementCount > MAX_CHAT_LINES)
		{
			this.chatLog.firstElementChild?.remove();
		}

		if (following)
		{
			this.chatLog.scrollTop = this.chatLog.scrollHeight;
		}
	}

	/**
	 * Shows a message above the lobby until the player does something else
	 *
	 * @param message Text to show
	 */
	showNotice(message: string): void
	{
		this.notice.textContent = message;
		this.notice.hidden = false;
		this.createButton.disabled = false;
	}

	/**
	 * Puts the player's last chat message back in the input, when the server dropped it
	 */
	restoreLastChat(): void
	{
		if (this.chatInput.value === '')
		{
			this.chatInput.value = this.lastSentChat;
		}
	}

	/**
	 * Hides the notice
	 */
	hideNotice(): void
	{
		this.notice.hidden = true;
	}

	/**
	 * Redraws the list of who's here once the current state patch has been applied, however many players it added or removed
	 */
	private queueMemberList(): void
	{
		if (this.memberListQueued)
		{
			return;
		}

		this.memberListQueued = true;

		queueMicrotask(() =>
		{
			this.memberListQueued = false;
			this.renderMemberList();
		});
	}

	/**
	 * Draws the list of who's here: the player first, then everyone else by name, up to MAX_LISTED_PLAYERS
	 */
	private renderMemberList(): void
	{
		const others = [...this.members]
			.filter(([playerId]) => (playerId !== this.ownPlayerId))
			.sort(([, a], [, b]) => a.localeCompare(b, currentLocale()));

		const own = ((this.ownPlayerId !== undefined) ? this.members.get(this.ownPlayerId) : undefined);
		const listed = ((own !== undefined) ? [{ name: own, isOwn: true }] : []);

		for (const [, name] of others.slice(0, MAX_LISTED_PLAYERS - listed.length))
		{
			listed.push({ name, isOwn: false });
		}

		this.memberList.replaceChildren(...listed.map(({ name, isOwn }) =>
		{
			const item = document.createElement('li');

			// Said in words as well as in color, for players who can't tell the colors apart and for screen readers
			item.textContent = (isOwn
				? t({
					id: 'lobby.ownName',
					defaultMessage: '{name} (you)',
					description: 'In the list of players in the lobby, the player\'s own name; {name} is the name'
				}, { name })
				: name);
			item.classList.toggle('member-own', isOwn);

			return(item);
		}));

		const unlisted = this.members.size - listed.length;

		this.memberCount.textContent = String(this.members.size);
		this.memberMore.textContent = t({
			id: 'lobby.morePlayers',
			defaultMessage: 'and {count, number} more',
			description: 'Under the list of players in the lobby, how many more are here than are listed'
		}, { count: unlisted });
		this.memberMore.hidden = (unlisted <= 0);
	}
}
