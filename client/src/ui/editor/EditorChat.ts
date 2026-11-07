import { MAX_KEPT_CHAT_MESSAGES, type EditorPresence, type KeptChatMessage } from '@multiverse-kiln/shared';

import { currentLocale, formatToNodes, t } from '../../localization';
import { playerPageUrl } from '../../pages';
import { announce } from '../announcer';
import { chatAuthorName, ChatLog } from '../ChatLog';
import { getElement, showMessage } from '../dom';
import { showToast } from '../toast';

/**
 * The editors' chat, in a panel the Chat button in the editor's toolbar shows and hides: the messages of
 * the universe's editors, kept by the server, and the names of who has the editor open. The save bar
 * shows where each of the others is (EditorPresenceBar)
 *
 * Messages from others that arrive while the panel or its tab is hidden, and those written since the
 * player last saw the chat in any window, are counted over the button's icon and before the page's title
 * (ChatLog); the room remembers how far they have read. While the panel is hidden, a new message shows in a toast,
 * read out by screen readers; clicking the toast away clears the count, as opening the panel does.
 * Screen readers hear players opening and closing the editor too
 */
export class EditorChat
{
	private readonly toggle = getElement('editor-chat-toggle', HTMLButtonElement);
	private readonly unread = getElement('editor-chat-unread', HTMLElement);
	private readonly unreadBadge = getElement('editor-chat-unread-count', HTMLElement);
	private readonly panel = getElement('editor-chat', HTMLElement);
	private readonly status = getElement('editor-chat-status', HTMLElement);
	private readonly here = getElement('editor-chat-here', HTMLUListElement);
	private readonly chat: ChatLog;

	/**
	 * Closes the toast showing the newest message, while there may be one
	 */
	private closeToast: (() => void) | undefined;

	/**
	 * The players listed as having the editor open, by player ID, with their names; undefined until the
	 * room's state first arrives, so the players already there aren't read out as arriving
	 */
	private present: Map<string, string> | undefined;

	/**
	 * @param ownPlayerId The player whose page this is
	 * @param send Sends a message to the chat
	 * @param sendRead Tells the room when the newest message the player has seen was sent
	 */
	constructor(private readonly ownPlayerId: string, send: (text: string) => void, sendRead: (readAt: number) => void)
	{
		this.chat = new ChatLog({
			log: 'editor-chat-log',
			form: 'editor-chat-form',
			input: 'editor-chat-input',
			sendButton: 'editor-chat-send'
		}, MAX_KEPT_CHAT_MESSAGES, send, (count) =>
		{
			this.showUnread(count);
		}, sendRead);
		this.chat.setOwnPlayer(ownPlayerId);
		this.setConnected(false);

		this.toggle.addEventListener('click', () =>
		{
			this.setOpen(this.panel.hidden);
		});

		getElement('editor-chat-close', HTMLButtonElement).addEventListener('click', () =>
		{
			this.setOpen(false);
		});

		this.panel.addEventListener('keydown', (event) =>
		{
			if ((event.key === 'Escape') && !event.defaultPrevented)
			{
				event.preventDefault();
				this.setOpen(false);
			}
		});
	}

	/**
	 * Shows or hides the panel. Showing it puts focus in its field and clears the count of unread
	 * messages; hiding it puts focus back on the Chat button when it was in the panel
	 *
	 * @param open Whether to show it
	 */
	setOpen(open: boolean): void
	{
		const hadFocus = this.panel.contains(document.activeElement);

		this.panel.hidden = !open;
		this.toggle.setAttribute('aria-expanded', String(open));

		if (open)
		{
			this.closeToast?.();
			this.closeToast = undefined;
			this.chat.markRead();
			this.chat.scrollToEnd();
			this.chat.focus(this.panel);
		}
		else if (hadFocus)
		{
			this.toggle.focus();
		}
	}

	/**
	 * Turns sending on once the room is joined, or off while it isn't
	 *
	 * @param connected Whether the room is joined
	 */
	setConnected(connected: boolean): void
	{
		this.chat.setEnabled(connected);

		if (connected)
		{
			showMessage(this.status, undefined);
		}
	}

	/**
	 * Says in the panel why the chat can't be used, and turns sending off
	 *
	 * @param message Why, in the player's language
	 */
	showProblem(message: string): void
	{
		this.setConnected(false);
		showMessage(this.status, message);
		this.here.replaceChildren();
		this.present = new Map();
	}

	/**
	 * Says the last message was sent too soon after the others, and puts it back in the field
	 */
	refuseTooFast(): void
	{
		this.chat.refuseTooFast();
	}

	/**
	 * Replaces the chat with the messages the server keeps
	 *
	 * @param messages The messages, oldest first
	 * @param readAt When the newest message the player has seen was sent, when the room knows
	 */
	setHistory(messages: readonly KeptChatMessage[], readAt: number | undefined): void
	{
		this.chat.setHistory(messages, readAt);
	}

	/**
	 * Counts the messages sent up to a time as read, when the player has read them in another window
	 *
	 * @param readAt When the newest message they have seen was sent
	 */
	setReadAt(readAt: number): void
	{
		this.chat.setReadAt(readAt);
	}

	/**
	 * Adds a new message, following it if the chat was scrolled to the bottom. One from someone else
	 * while the panel is hidden shows in a toast and is read out
	 *
	 * @param message The message
	 */
	addMessage(message: KeptChatMessage): void
	{
		this.chat.add(message);

		if (this.panel.hidden && (message.playerId !== this.ownPlayerId))
		{
			const name = document.createElement('span');

			name.className = 'toast-chat-name';
			name.translate = false;
			name.textContent = chatAuthorName(message);
			this.closeToast?.();
			this.closeToast = showToast(formatToNodes({
				id: 'editor.chat.toast',
				defaultMessage: '{name}: {text}',
				description: 'In a toast when another editor writes in the editors\' chat while its panel is hidden; {name} is their display name, shown in color, and {text} what they wrote'
			}, {
				name,
				text: message.text
			}), {
				announce: false,
				onDismiss: () =>
				{
					this.closeToast = undefined;
					this.chat.markRead();
				}
			});
			announce(t({
				id: 'editor.chat.newMessage',
				defaultMessage: '{name} wrote in the editors\' chat: {text}',
				description: 'Read out by screen readers when another editor writes in the editors\' chat while its panel is hidden, which a toast shows; {name} is their display name and {text} what they wrote'
			}, {
				name: chatAuthorName(message),
				text: message.text
			}));
		}
	}

	/**
	 * Lists who has the editor open, reading out who has opened or closed it since the last time
	 *
	 * @param editors The room's state.editors: each player with the editor open, by player ID
	 */
	showEditors(editors: Iterable<[string, EditorPresence]>): void
	{
		const previous = this.present;
		const present = new Map<string, string>();
		const items: HTMLLIElement[] = [];

		for (const [playerId, editor] of [...editors].sort(([, a], [, b]) => a.name.localeCompare(b.name, currentLocale())))
		{
			present.set(playerId, editor.name);
			items.push(this.editorItem(playerId, editor));

			if (previous && !previous.has(playerId) && (playerId !== this.ownPlayerId))
			{
				announce(t({
					id: 'editor.chat.opened',
					defaultMessage: '{name} opened the editor',
					description: 'Read out by screen readers when another editor opens the universe\'s editor; {name} is their display name'
				}, {
					name: editor.name
				}));
			}
		}

		for (const [playerId, name] of (previous ?? []))
		{
			if (!present.has(playerId) && (playerId !== this.ownPlayerId))
			{
				announce(t({
					id: 'editor.chat.closed',
					defaultMessage: '{name} closed the editor',
					description: 'Read out by screen readers when another editor closes their last window of the universe\'s editor; {name} is their display name'
				}, {
					name
				}));
			}
		}

		this.present = present;
		this.here.replaceChildren(...items);
	}

	/**
	 * One player in the list of who has the editor open: their name, linking to their profile
	 *
	 * @param playerId The player's ID
	 * @param editor The player
	 * @return The list item
	 */
	private editorItem(playerId: string, editor: EditorPresence): HTMLLIElement
	{
		const item = document.createElement('li');
		const name = document.createElement('a');

		name.className = 'chat-name';
		name.href = playerPageUrl(editor.username);
		name.translate = false;
		name.textContent = ((playerId === this.ownPlayerId) ? t({
			id: 'editor.chat.you',
			defaultMessage: '{name} (you)',
			description: 'In the editors\' chat panel\'s list of who has the editor open, the player themself; {name} is their display name, which links to their profile'
		}, {
			name: editor.name
		}) : editor.name);
		item.classList.toggle('chat-own', (playerId === this.ownPlayerId));
		item.append(name);

		return(item);
	}

	/**
	 * Shows how many messages are unread as a number over the Chat button's icon, and to screen readers as
	 * the button's description
	 *
	 * @param count How many
	 */
	private showUnread(count: number): void
	{
		showMessage(this.unreadBadge, ((count === 0) ? undefined : new Intl.NumberFormat(currentLocale()).format(count)));
		showMessage(this.unread, ((count === 0) ? undefined : t({
			id: 'editor.chat.unread',
			defaultMessage: '{count, plural, one {# new message} other {# new messages}}',
			description: 'Read out by screen readers with the Chat button in the editor\'s toolbar, which shows the number over its icon: how many messages other editors wrote in the editors\' chat while it or the page\'s tab was hidden'
		}, {
			count
		})));
	}
}
