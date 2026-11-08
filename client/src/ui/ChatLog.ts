import { DISALLOWED_TEXT_CHARACTERS, MAX_CHAT_MESSAGE_LENGTH, type ChatNotice } from '@multiverse-kiln/shared';

import { currentLocale, t } from '../localization';
import { getElement, setUnreadChatCount } from './dom';
import { showToast } from './toast';

/**
 * How close to the bottom, in pixels, the chat must be scrolled to keep following new messages
 */
const FOLLOW_THRESHOLD = 40;

/**
 * One message as a chat shows it: a lobby's (ChatMessage) or a kept chat's (KeptChatMessage)
 */
export interface ChatLine
{
	/**
	 * Who wrote it, or null once their account is deleted
	 */
	playerId: string | null;

	name: string;

	/**
	 * In the editors' chat, the writer's username, shown when the name is pointed at
	 */
	username?: string | null;

	/**
	 * In a kept chat, for a notice the server wrote, what it says about the character named; null or
	 * absent for a message a player wrote
	 */
	notice?: ChatNotice | null;

	text: string;

	/**
	 * When the server received it, in milliseconds since the epoch
	 */
	sentAt: number;
}

/**
 * The IDs of a chat's elements in the page
 */
export interface ChatElementIds
{
	/**
	 * The list of messages
	 */
	log: string;

	form: string;
	input: string;
	sendButton: string;
}

/**
 * A chat's messages and the field for sending one, as the lobby, the group screen and the editors'
 * chat show them
 *
 * The player's own messages are marked, notices the server wrote (such as a character leaving a group)
 * are set apart, the newest are followed while the list is scrolled to the bottom, and only the newest
 * maxLines are kept. A message with characters the server refuses (DISALLOWED_TEXT_CHARACTERS) isn't sent
 *
 * Messages from others that arrive while the chat can't be seen (its tab is hidden, or the chat is, or it
 * is scrolled out of view) are counted before the page's title until it is seen again. A chat that
 * remembers how far the player has read it (the editors') also counts those sent while they were away,
 * and reports how far they read (onRead)
 */
export class ChatLog
{
	private readonly log: HTMLOListElement;
	private readonly form: HTMLFormElement;
	private readonly input: HTMLInputElement;
	private readonly sendButton: HTMLButtonElement;

	/**
	 * The player whose page this is, whose messages are marked as theirs
	 */
	private ownPlayerId: string | undefined;

	/**
	 * The last message sent, for putting back when the server drops it
	 */
	private lastSent = '';

	/**
	 * Closes the toast saying a message was sent too quickly, while there may be one
	 */
	private closeTooFast: (() => void) | undefined;

	/**
	 * Who wrote each message on screen, and when, oldest first, for counting those that are unread, with
	 * what each notice says
	 */
	private messages: Pick<ChatLine, 'playerId' | 'sentAt' | 'notice'>[] = [];

	/**
	 * When the newest message the player has seen was sent, in milliseconds since the epoch: others'
	 * messages after it are unread
	 */
	private readAt = 0;

	/**
	 * How many messages from others were sent after readAt
	 */
	private unreadCount = 0;

	/**
	 * Whether the list of messages is shown and within the page's view, whether or not its tab is
	 */
	private onScreen = false;

	/**
	 * @param ids The chat's elements
	 * @param maxLines Most messages kept on screen
	 * @param send Sends a message to the chat
	 * @param onUnreadChange Told how many messages are unread each time the count changes
	 * @param onRead Told when the newest message the player has seen was sent, each time that moves, for
	 * a chat that remembers how far the player has read it
	 */
	constructor(ids: ChatElementIds, private readonly maxLines: number, send: (text: string) => void, private readonly onUnreadChange?: (count: number) => void, private readonly onRead?: (readAt: number) => void)
	{
		this.log = getElement(ids.log, HTMLOListElement);
		this.form = getElement(ids.form, HTMLFormElement);
		this.input = getElement(ids.input, HTMLInputElement);
		this.sendButton = getElement(ids.sendButton, HTMLButtonElement);
		this.input.maxLength = MAX_CHAT_MESSAGE_LENGTH;

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();

			const text = this.input.value.trim();

			if ((text === '') || DISALLOWED_TEXT_CHARACTERS.test(text))
			{
				return;
			}

			send(text);
			this.lastSent = text;
			this.input.value = '';
		});

		const observer = new IntersectionObserver((entries) =>
		{
			for (const entry of entries)
			{
				this.onScreen = entry.isIntersecting;
			}

			this.markReadIfSeen();
		});

		observer.observe(this.log);

		document.addEventListener('visibilitychange', () =>
		{
			this.markReadIfSeen();
		});
	}

	/**
	 * Sets whose messages are marked as the player's own
	 *
	 * @param playerId The player's ID
	 */
	setOwnPlayer(playerId: string): void
	{
		this.ownPlayerId = playerId;
	}

	/**
	 * Turns sending on or off
	 *
	 * @param enabled Whether the player can send
	 */
	setEnabled(enabled: boolean): void
	{
		this.input.disabled = !enabled;
		this.sendButton.disabled = !enabled;
	}

	/**
	 * The field and the button that send a message, for pointing at why they are turned off
	 *
	 * @return The field and the button
	 */
	controls(): HTMLElement[]
	{
		return([this.input, this.sendButton]);
	}

	/**
	 * Puts focus in the field, or on the given element while sending is turned off
	 *
	 * @param fallback What takes focus while the field can't
	 */
	focus(fallback: HTMLElement): void
	{
		(this.input.disabled ? fallback : this.input).focus();
	}

	/**
	 * Replaces the messages
	 *
	 * @param messages The messages, oldest first
	 * @param readAt In a chat that remembers how far the player has read it, when the newest message
	 * they have seen was sent; others' messages after it are unread. Without it, every message given is read
	 */
	setHistory(messages: readonly ChatLine[], readAt?: number): void
	{
		this.log.replaceChildren();
		this.messages = [];

		for (const message of messages)
		{
			this.addLine(message);
		}

		const newest = (messages.at(-1)?.sentAt ?? 0);
		const known = this.readAt;

		this.readAt = Math.max(known, (readAt ?? newest));

		// Reading reported while the room couldn't be told, such as while reconnecting, is told now
		if ((readAt !== undefined) && (known > readAt))
		{
			this.onRead?.(known);
		}

		this.scrollToEnd();
		this.countUnread();
		this.markReadIfSeen();
	}

	/**
	 * Adds a new message, following it if the chat was scrolled to the bottom. Seen, it is read at once;
	 * otherwise someone else's counts as unread
	 *
	 * @param message The message
	 */
	add(message: ChatLine): void
	{
		const following = ((this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight) < FOLLOW_THRESHOLD);

		this.addLine(message);

		if (following)
		{
			this.scrollToEnd();
		}

		if (this.isSeen())
		{
			this.markRead();
		}
		else
		{
			this.countUnread();
		}
	}

	/**
	 * Shows the messages a player wrote without their name, once their account is deleted
	 *
	 * @param playerId The player's ID
	 */
	forgetAuthor(playerId: string): void
	{
		const lines = [...this.log.children];

		this.messages.forEach((message, index) =>
		{
			if (message.playerId !== playerId)
			{
				return;
			}

			const line = lines.at(index);
			const name = line?.querySelector('.chat-name');
			const notice = message.notice;

			message.playerId = null;
			line?.classList.remove('chat-own');

			if (line && notice)
			{
				line.querySelector('.chat-notice-text')?.replaceChildren(noticeText(notice, chatAuthorName({
					playerId: null,
					name: ''
				})));
			}
			else if (name instanceof HTMLElement)
			{
				name.textContent = chatAuthorName({
					playerId: null,
					name: ''
				});
				name.removeAttribute('title');
			}
		});
	}

	/**
	 * Empties the chat
	 */
	clear(): void
	{
		this.log.replaceChildren();
		this.messages = [];
		this.countUnread();
	}

	/**
	 * Counts every message as read, such as when the player has seen the newest in a toast
	 */
	markRead(): void
	{
		const newest = this.messages.at(-1)?.sentAt;

		if ((newest !== undefined) && (newest > this.readAt))
		{
			this.readAt = newest;
			this.onRead?.(newest);
		}

		this.countUnread();
	}

	/**
	 * Counts the messages sent up to a time as read, when the player has read them in another window
	 *
	 * @param readAt When the newest message they have seen was sent, in milliseconds since the epoch
	 */
	setReadAt(readAt: number): void
	{
		if (readAt > this.readAt)
		{
			this.readAt = readAt;
			this.countUnread();
		}
	}

	/**
	 * Scrolls to the newest message
	 */
	scrollToEnd(): void
	{
		this.log.scrollTop = this.log.scrollHeight;
	}

	/**
	 * Says in a toast, read out by screen readers, that the last message was sent too soon after the
	 * others, which the server dropped, and puts it back in the field unless the player has started another
	 */
	refuseTooFast(): void
	{
		if (this.input.value === '')
		{
			this.input.value = this.lastSent;
		}

		this.closeTooFast?.();
		this.closeTooFast = showToast(t({
			id: 'chat.tooFast',
			defaultMessage: 'You are sending messages too quickly. Wait a moment and try again.',
			description: 'In a toast when the player sends chat messages faster than allowed, in a universe\'s lobby, a group or the editors\' chat; the message they last sent is put back in the chat field'
		}));
	}

	/**
	 * Whether the player can see the chat: its tab is shown and so is the list of messages
	 *
	 * @return Whether they can
	 */
	private isSeen(): boolean
	{
		return(!document.hidden && this.onScreen);
	}

	/**
	 * Counts every message as read once the player can see the chat
	 */
	private markReadIfSeen(): void
	{
		if (this.isSeen())
		{
			this.markRead();
		}
	}

	/**
	 * Counts the messages from others sent after readAt, showing the count before the page's title and
	 * telling onUnreadChange when it changes
	 */
	private countUnread(): void
	{
		const count = this.messages.filter((message) => ((message.playerId !== this.ownPlayerId) && (message.sentAt > this.readAt))).length;

		if (count !== this.unreadCount)
		{
			this.unreadCount = count;
			setUnreadChatCount(this, count);
			this.onUnreadChange?.(count);
		}
	}

	/**
	 * Adds a message to the end of the chat, dropping the oldest past maxLines
	 *
	 * @param message The message
	 */
	private addLine(message: ChatLine): void
	{
		const line = document.createElement('li');
		const time = document.createElement('span');
		const notice = (message.notice ?? null);

		time.className = 'chat-time';
		time.textContent = new Date(message.sentAt).toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' });

		if (notice)
		{
			const text = document.createElement('span');

			text.className = 'chat-notice-text';
			text.textContent = noticeText(notice, chatAuthorName(message));
			line.className = 'chat-notice';
			line.append(time, text);
		}
		else
		{
			const name = document.createElement('span');
			const text = document.createElement('span');

			name.className = 'chat-name';
			name.textContent = chatAuthorName(message);

			if ((message.username !== undefined) && (message.username !== null))
			{
				name.title = `@${message.username}`;
			}

			text.textContent = message.text;
			line.classList.toggle('chat-own', ((message.playerId !== null) && (message.playerId === this.ownPlayerId)));
			line.append(time, name, text);
		}

		this.log.append(line);
		this.messages.push({
			playerId: message.playerId,
			sentAt: message.sentAt,
			notice
		});

		while (this.log.childElementCount > this.maxLines)
		{
			this.log.firstElementChild?.remove();
		}

		this.messages = this.messages.slice(-this.maxLines);
	}
}

/**
 * What a notice the server wrote in a chat says
 *
 * @param notice The notice
 * @param name The name of the character it is about, or the stand-in for a deleted account
 * @return The sentence
 */
export function noticeText(notice: ChatNotice, name: string): string
{
	switch (notice)
	{
		case 'created':
		{
			return(t({
				id: 'chat.created',
				defaultMessage: '{name} created the group.',
				description: 'In a group\'s chat, shown in place of a message as its first line, when a character creates the group (they are its anchor being). {name} is the character\'s name, or "[deleted user]" once their player has deleted their account'
			}, {
				name
			}));
		}

		case 'joined':
		{
			return(t({
				id: 'chat.joined',
				defaultMessage: '{name} joined the group.',
				description: 'In a group\'s chat, shown in place of a message when a character joins the group through an invite link. {name} is the character\'s name, or "[deleted user]" once their player has deleted their account'
			}, {
				name
			}));
		}

		case 'left':
		{
			return(t({
				id: 'chat.left',
				defaultMessage: '{name} has left this group.',
				description: 'In a group\'s chat, shown in place of a message when a character leaves the group, in any way: from the group or their sheet, because the universe\'s group size was lowered, or because their player deleted their account. {name} is the character\'s name, or "[deleted user]" once their player has deleted their account'
			}, {
				name
			}));
		}
	}
}

/**
 * Who wrote a chat message, as a chat shows them
 *
 * @param message The message
 * @return Their name, or a stand-in once their account is deleted
 */
export function chatAuthorName(message: Pick<ChatLine, 'playerId' | 'name'>): string
{
	return(((message.playerId === null) ? t({
		id: 'chat.deletedAccount',
		defaultMessage: '[deleted user]',
		description: 'In a chat (a universe\'s lobby, a group\'s or the editors\'), in place of the name of a player who wrote a message and has since deleted their account; the brackets mark it as a stand-in rather than a name'
	}) : message.name));
}
