import { Callbacks } from '@colyseus/sdk';
import { DISALLOWED_TEXT_CHARACTERS, MAX_CHAT_MESSAGE_LENGTH, type ChatMessage, type OnlinePlayer } from '@multiverse-kiln/shared';

import type { LobbyRoom } from '../network/serverConnection';
import { getElement } from './dom';

/**
 * Most names shown in the online list; the rest are counted
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
}

/**
 * The lobby screen: chat, who's online, and the Create game button
 */
export class LobbyScreen
{
	private readonly playerName = getElement('lobby-player-name', HTMLElement);
	private readonly createButton = getElement('create-group', HTMLButtonElement);
	private readonly notice = getElement('lobby-notice', HTMLElement);
	private readonly chatLog = getElement('chat-log', HTMLOListElement);
	private readonly chatForm = getElement('chat-form', HTMLFormElement);
	private readonly chatInput = getElement('chat-input', HTMLInputElement);
	private readonly onlineCount = getElement('online-count', HTMLElement);
	private readonly onlineList = getElement('online-list', HTMLUListElement);
	private readonly onlineMore = getElement('online-more', HTMLElement);

	/**
	 * Names of the players online, by player ID
	 */
	private readonly onlinePlayers = new Map<string, string>();

	private ownPlayerId: string | undefined;
	private lastSentChat = '';
	private onlineListQueued = false;

	/**
	 * @param lobby The joined lobby room, whose state holds who's online
	 * @param actions What the screen's controls do
	 */
	constructor(lobby: LobbyRoom, actions: LobbyScreenActions)
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

		const callbacks = Callbacks.get(lobby);

		callbacks.onAdd('players', (player: OnlinePlayer, playerId: string) =>
		{
			this.onlinePlayers.set(playerId, player.name);
			this.queueOnlineList();
		});

		callbacks.onRemove('players', (_player: OnlinePlayer, playerId: string) =>
		{
			this.onlinePlayers.delete(playerId);
			this.queueOnlineList();
		});
	}

	/**
	 * Gets the screen ready to be shown for a player
	 *
	 * @param playerId The player's ID
	 * @param name The player's name
	 */
	show(playerId: string, name: string): void
	{
		this.ownPlayerId = playerId;
		this.playerName.textContent = name;
		this.createButton.disabled = false;
		this.queueOnlineList();
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
		time.textContent = new Date(message.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
	 * Redraws the online list once the current state patch has been applied, however many players it added or removed
	 */
	private queueOnlineList(): void
	{
		if (this.onlineListQueued)
		{
			return;
		}

		this.onlineListQueued = true;

		queueMicrotask(() =>
		{
			this.onlineListQueued = false;
			this.renderOnlineList();
		});
	}

	/**
	 * Draws the online list: the player first, then everyone else by name, up to MAX_LISTED_PLAYERS
	 */
	private renderOnlineList(): void
	{
		const others = [...this.onlinePlayers].filter(([playerId]) => (playerId !== this.ownPlayerId)).sort(([, a], [, b]) => a.localeCompare(b));
		const own = ((this.ownPlayerId !== undefined) ? this.onlinePlayers.get(this.ownPlayerId) : undefined);
		const listed = ((own !== undefined) ? [{ name: own, isOwn: true }] : []);

		for (const [, name] of others.slice(0, MAX_LISTED_PLAYERS - listed.length))
		{
			listed.push({ name, isOwn: false });
		}

		this.onlineList.replaceChildren(...listed.map(({ name, isOwn }) =>
		{
			const item = document.createElement('li');

			item.textContent = name;
			item.classList.toggle('online-own', isOwn);

			return(item);
		}));

		const unlisted = this.onlinePlayers.size - listed.length;

		this.onlineCount.textContent = String(this.onlinePlayers.size);
		this.onlineMore.textContent = `and ${unlisted} more`;
		this.onlineMore.hidden = (unlisted <= 0);
	}
}
