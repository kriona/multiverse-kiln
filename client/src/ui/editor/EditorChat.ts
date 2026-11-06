import { EDITOR_ROLE_NAMES, MAX_CHAT_MESSAGE_LENGTH, MAX_KEPT_CHAT_MESSAGES, type EditorPresence, type EditorRole, type KeptChatMessage } from '@multiverse-kiln/shared';

import { currentLocale, t } from '../../localization';
import { announce } from '../announcer';
import { getElement, showMessage } from '../dom';

/**
 * How close to the bottom, in pixels, the chat must be scrolled to keep following new messages
 */
const FOLLOW_THRESHOLD = 40;

/**
 * Whether a value names one of the editor's roles
 *
 * @param role The value, from the room's state
 * @return True when it does
 */
function isEditorRole(role: string): role is EditorRole
{
	return(Object.hasOwn(EDITOR_ROLE_NAMES, role));
}

/**
 * The name of one of the editor's tabs as its tab shows it, in the player's language
 *
 * @param tab The tab
 * @return Its name, without the mark of unsaved changes
 */
function tabName(tab: string): string
{
	const button = document.getElementById(`editor-tab-${tab}`);

	return([...(button?.childNodes ?? [])]
		.filter((node) => (node.nodeType === Node.TEXT_NODE))
		.map((node) => (node.textContent ?? ''))
		.join('')
		.trim());
}

/**
 * The editors' chat, in a panel the Chat button in the editor's toolbar shows and hides: the messages of
 * the universe's editors, kept by the server, and who has the editor open, with their role and the tabs
 * their windows show
 *
 * Messages that arrive while the panel is hidden are counted beside the button and read out by screen
 * readers, as are players opening and closing the editor
 */
export class EditorChat
{
	private readonly toggle = getElement('editor-chat-toggle', HTMLButtonElement);
	private readonly unread = getElement('editor-chat-unread', HTMLElement);
	private readonly panel = getElement('editor-chat', HTMLElement);
	private readonly status = getElement('editor-chat-status', HTMLElement);
	private readonly here = getElement('editor-chat-here', HTMLUListElement);
	private readonly log = getElement('editor-chat-log', HTMLOListElement);
	private readonly form = getElement('editor-chat-form', HTMLFormElement);
	private readonly input = getElement('editor-chat-input', HTMLInputElement);
	private readonly sendButton = getElement('editor-chat-send', HTMLButtonElement);

	/**
	 * How many messages from others have arrived since the panel was last shown
	 */
	private unreadCount = 0;

	/**
	 * The players listed as having the editor open, by player ID, with their names; undefined until the
	 * room's state first arrives, so the players already there aren't read out as arriving
	 */
	private present: Map<string, string> | undefined;

	/**
	 * The last message sent, for putting back when the server drops it
	 */
	private lastSent = '';

	/**
	 * @param ownPlayerId The player whose page this is
	 * @param send Sends a message to the chat
	 */
	constructor(private readonly ownPlayerId: string, send: (text: string) => void)
	{
		this.input.maxLength = MAX_CHAT_MESSAGE_LENGTH;
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

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();

			const text = this.input.value.trim();

			if (text === '')
			{
				return;
			}

			send(text);
			this.lastSent = text;
			this.input.value = '';
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
			this.setUnread(0);
			this.log.scrollTop = this.log.scrollHeight;
			(this.input.disabled ? this.panel : this.input).focus();
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
		this.input.disabled = !connected;
		this.sendButton.disabled = !connected;

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
		const message = t({
			id: 'editor.chat.tooFast',
			defaultMessage: 'You are sending messages too quickly. Wait a moment, then send it again.',
			description: 'Shown in the editors\' chat panel when the player sent chat messages faster than allowed; their message is put back in the field'
		});

		if (this.input.value === '')
		{
			this.input.value = this.lastSent;
		}

		showMessage(this.status, message);
		announce(message);
	}

	/**
	 * Replaces the chat with the messages the server keeps
	 *
	 * @param messages The messages, oldest first
	 */
	setHistory(messages: readonly KeptChatMessage[]): void
	{
		this.log.replaceChildren();

		for (const message of messages)
		{
			this.addLine(message);
		}

		this.log.scrollTop = this.log.scrollHeight;
	}

	/**
	 * Adds a new message, following it if the chat was scrolled to the bottom. One from someone else
	 * while the panel is hidden is counted and read out
	 *
	 * @param message The message
	 */
	addMessage(message: KeptChatMessage): void
	{
		const following = ((this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight) < FOLLOW_THRESHOLD);

		this.addLine(message);

		if (message.playerId === this.ownPlayerId)
		{
			showMessage(this.status, undefined);
		}

		if (following)
		{
			this.log.scrollTop = this.log.scrollHeight;
		}

		if (this.panel.hidden && (message.playerId !== this.ownPlayerId))
		{
			this.setUnread(this.unreadCount + 1);
			announce(t({
				id: 'editor.chat.newMessage',
				defaultMessage: '{name} wrote in the editors\' chat: {text}',
				description: 'Read out by screen readers when another editor writes in the editors\' chat while its panel is hidden; {name} is their display name and {text} what they wrote'
			}, {
				name: this.nameOf(message),
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
	 * One player in the list of who has the editor open: their name, username and role, and the tabs
	 * their windows show, marking those showing the draft
	 *
	 * @param playerId The player's ID
	 * @param editor The player
	 * @return The list item
	 */
	private editorItem(playerId: string, editor: EditorPresence): HTMLLIElement
	{
		const item = document.createElement('li');
		const name = document.createElement('span');
		const where = document.createElement('span');
		const places = new Set<string>();

		for (const window of editor.windows.values())
		{
			places.add((window.version === 'draft') ? t({
				id: 'editor.chat.draftTab',
				defaultMessage: '{tab} (draft)',
				description: 'In the editors\' chat panel\'s list of who has the editor open, a tab an editor has open on the universe\'s draft (a copy players don\'t see until it is applied); {tab} is the tab\'s name, such as Areas'
			}, {
				tab: tabName(window.tab)
			}) : tabName(window.tab));
		}

		name.className = 'chat-name';
		name.textContent = ((playerId === this.ownPlayerId) ? t({
			id: 'editor.chat.you',
			defaultMessage: '{name} (you)',
			description: 'In the editors\' chat panel\'s list of who has the editor open, the player themself; {name} is their display name'
		}, {
			name: editor.name
		}) : editor.name);
		where.className = 'editor-chat-where';
		where.textContent = t({
			id: 'editor.chat.where',
			defaultMessage: '@{username}, {role}, on {tabs}',
			description: 'In the editors\' chat panel\'s list of who has the editor open, after an editor\'s name: {username} is their username, {role} their role (such as builder) and {tabs} the tabs their windows show, such as "Areas and Items (draft)"'
		}, {
			username: editor.username,
			role: (isEditorRole(editor.role) ? t(EDITOR_ROLE_NAMES[editor.role]) : editor.role),
			tabs: new Intl.ListFormat(currentLocale(), { type: 'conjunction' }).format([...places])
		});
		item.classList.toggle('chat-own', (playerId === this.ownPlayerId));
		item.append(name, where);

		return(item);
	}

	/**
	 * Adds a message to the end of the chat, dropping the oldest past what the server keeps
	 *
	 * @param message The message
	 */
	private addLine(message: KeptChatMessage): void
	{
		const line = document.createElement('li');
		const time = document.createElement('span');
		const name = document.createElement('span');
		const text = document.createElement('span');

		time.className = 'chat-time';
		time.textContent = new Date(message.sentAt).toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' });
		name.className = 'chat-name';
		name.textContent = this.nameOf(message);

		if (message.username !== null)
		{
			name.title = `@${message.username}`;
		}

		text.textContent = message.text;
		line.classList.toggle('chat-own', (message.playerId === this.ownPlayerId));
		line.append(time, name, text);
		this.log.append(line);

		while (this.log.childElementCount > MAX_KEPT_CHAT_MESSAGES)
		{
			this.log.firstElementChild?.remove();
		}
	}

	/**
	 * Who wrote a message, as the chat shows them
	 *
	 * @param message The message
	 * @return Their display name, or a stand-in once their account is deleted
	 */
	private nameOf(message: KeptChatMessage): string
	{
		return(((message.playerId === null) ? t({
			id: 'editor.chat.deletedAccount',
			defaultMessage: 'Deleted account',
			description: 'In the editors\' chat, in place of the name of a player who wrote a message and has since deleted their account'
		}) : message.name));
	}

	/**
	 * Shows how many messages arrived while the panel was hidden, beside the Chat button
	 *
	 * @param count How many
	 */
	private setUnread(count: number): void
	{
		this.unreadCount = count;
		showMessage(this.unread, ((count === 0) ? undefined : t({
			id: 'editor.chat.unread',
			defaultMessage: '{count, plural, one {# new message} other {# new messages}}',
			description: 'Beside the Chat button in the editor\'s toolbar, how many messages other editors wrote in the editors\' chat while it was hidden'
		}, {
			count
		})));
	}
}
