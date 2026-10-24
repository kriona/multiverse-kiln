import { Callbacks } from '@colyseus/sdk';
import { DISALLOWED_TEXT_CHARACTERS, MAX_CHAT_MESSAGE_LENGTH, type CharacterListPayload, type CharacterSummary, type ChatMessage, type LobbyMember, type UniverseSummary } from '@multiverse-kiln/shared';

import { currentLocale, t } from '../localization';
import type { LobbyConnection } from '../network/serverConnection';
import { universePageUrl } from '../pages';
import { announce } from './announcer';
import { CharacterList } from './CharacterList';
import { characterMessages } from './characterMessages';
import { getElement, showMessage, titleLink } from './dom';
import type { MapView } from './MapView';
import { addShortcut } from './shortcuts';

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
	createCharacter: () => void;

	/**
	 * Play one of the player's characters: here, or in their group when they are in one
	 */
	chooseCharacter: (character: CharacterSummary) => void;

	/**
	 * Show one of the player's characters on their character sheet
	 */
	openCharacterSheet: (character: CharacterSummary) => void;

	/**
	 * Make a group around the character the player is playing
	 */
	createGroup: (character: CharacterSummary) => void;

	/**
	 * Go back to Home
	 */
	leaveLobby: () => void;
}

/**
 * The lobby screen: the lobby's map, chat, who's here, the player's characters, and the Create
 * Character, Create Group and Leave lobby buttons
 *
 * The screen is made once and attached to whichever universe lobby the window is in. Choosing one of
 * the player's characters plays them, here or in their group. A player playing none is a ghost: the
 * screen says so, makes Create Character the main button, and turns off the chat and Create Group
 */
export class LobbyScreen
{
	private readonly title = getElement('lobby-title', HTMLElement);
	private readonly playerName = getElement('lobby-player-name', HTMLElement);
	private readonly createCharacterButton = getElement('create-character', HTMLButtonElement);
	private readonly ghostNote = getElement('lobby-ghost-note', HTMLElement);
	private readonly characterList = getElement('character-list', HTMLUListElement);
	private readonly characterNone = getElement('character-none', HTMLElement);
	private readonly characterError = getElement('character-error', HTMLElement);
	private readonly createButton = getElement('create-group', HTMLButtonElement);
	private readonly leaveButton = getElement('leave-lobby', HTMLButtonElement);
	private readonly map = getElement('lobby-map', HTMLElement);
	private readonly notice = getElement('lobby-notice', HTMLElement);
	private readonly chatLog = getElement('chat-log', HTMLOListElement);
	private readonly chatForm = getElement('chat-form', HTMLFormElement);
	private readonly chatInput = getElement('chat-input', HTMLInputElement);
	private readonly chatSendButton = getElement('chat-send', HTMLButtonElement);
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

	/**
	 * The player's characters in the universe, once they have loaded
	 */
	private characters: CharacterListPayload | undefined;

	/**
	 * The character the player is playing: null while they are a ghost, undefined until the lobby has said
	 */
	private playingId: string | null | undefined;

	private readonly characterChoices: CharacterList;

	private ownPlayerId: string | undefined;
	private lastSentChat = '';
	private memberListQueued = false;

	/**
	 * @param mapView The map, shared with the group screen
	 * @param actions What the screen's controls do
	 */
	constructor(private readonly mapView: MapView, private readonly actions: LobbyScreenActions)
	{
		this.chatInput.maxLength = MAX_CHAT_MESSAGE_LENGTH;
		this.characterChoices = new CharacterList(this.characterList, this.characterNone, {
			choose: (character) =>
			{
				this.hideNotice();
				actions.chooseCharacter(character);
			},
			openSheet: (character) =>
			{
				actions.openCharacterSheet(character);
			}
		});

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

		this.createCharacterButton.addEventListener('click', () =>
		{
			this.hideNotice();
			actions.createCharacter();
		});

		this.createButton.addEventListener('click', () =>
		{
			const character = this.playingCharacter();

			if (character)
			{
				this.hideNotice();
				actions.createGroup(character);
			}
		});

		this.leaveButton.addEventListener('click', () =>
		{
			this.hideNotice();
			actions.leaveLobby();
		});

		addShortcut({
			keys: 'Alt+K',
			scope: getElement('lobby-screen', HTMLElement),
			description: () => t(characterMessages.sheetShortcut),
			run: () =>
			{
				const character = this.playingCharacter();

				if (character)
				{
					actions.openCharacterSheet(character);
				}
			}
		});
	}

	/**
	 * The character the player is playing here
	 *
	 * @return The character, or undefined for a ghost or while the characters load
	 */
	private playingCharacter(): CharacterSummary | undefined
	{
		return(this.characters?.characters.find((each) => (each.id === this.playingId)));
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
	 * Stops drawing and following the attached lobby, and empties the chat, the list of who's here and
	 * the list of the player's characters
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
		this.characters = undefined;
		this.playingId = undefined;
		this.renderCharacters();
		this.updatePlayingState();
		showMessage(this.characterError, undefined);
		this.queueMemberList();
	}

	/**
	 * Gets the screen ready to be shown for a player
	 *
	 * @param universe The universe whose lobby it is
	 * @param playerId The player's ID
	 * @param name The player's name
	 */
	show(universe: UniverseSummary, playerId: string, name: string): void
	{
		this.ownPlayerId = playerId;
		this.title.replaceChildren(titleLink(universe.name, universePageUrl(universe.slug)));
		document.title = t({
			id: 'lobby.pageTitle',
			defaultMessage: 'Lobby - {universe} - Multiverse Kiln',
			description: 'The browser tab\'s title in a universe\'s lobby; {universe} is the universe\'s name and Multiverse Kiln is the game engine\'s name'
		}, {
			universe: universe.name
		});
		this.playerName.textContent = name;
		this.updatePlayingState();
		this.queueMemberList();
	}

	/**
	 * Lists the player's characters in the universe
	 *
	 * @param list The characters, oldest first, and the universe's ruleset
	 */
	showCharacters(list: CharacterListPayload): void
	{
		showMessage(this.characterError, undefined);
		this.characters = list;
		this.renderCharacters();
	}

	/**
	 * Shows which character the player is playing, reading out a change
	 *
	 * @param characterId The character, or null for a ghost
	 * @return False when the character isn't in the list the screen has, so the list needs loading again
	 */
	setPlayingAs(characterId: string | null): boolean
	{
		const previous = this.playingId;
		const character = this.characters?.characters.find((each) => (each.id === characterId));

		this.playingId = characterId;
		this.renderCharacters();
		this.updatePlayingState();
		this.queueMemberList();

		if ((previous !== undefined) && (previous !== characterId) && character)
		{
			announce(t(characterMessages.nowPlaying, {
				name: character.name
			}));
		}

		return((characterId === null) || (this.characters === undefined) || (character !== undefined));
	}

	/**
	 * Says the player's characters couldn't be listed
	 *
	 * @param message Why, in the player's language
	 */
	showCharacterError(message: string): void
	{
		showMessage(this.characterError, message);
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
	 * Draws the player's characters, marking the one being played
	 */
	private renderCharacters(): void
	{
		this.characterChoices.render(this.characters, this.playingId);
	}

	/**
	 * Matches the controls to whether the player is a ghost: a ghost can't chat or create a group, and
	 * Create Character becomes the main button
	 */
	private updatePlayingState(): void
	{
		const isGhost = (this.playingId === null);

		this.ghostNote.hidden = !isGhost;
		this.chatInput.disabled = isGhost;
		this.chatSendButton.disabled = isGhost;
		this.createButton.disabled = (typeof this.playingId !== 'string');
		this.createCharacterButton.classList.toggle('secondary', (typeof this.playingId === 'string'));

		for (const control of [this.chatInput, this.chatSendButton, this.createButton])
		{
			if (isGhost)
			{
				control.setAttribute('aria-describedby', this.ghostNote.id);
			}
			else
			{
				control.removeAttribute('aria-describedby');
			}
		}
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
	 * Draws the list of who's here: the player first (as a ghost when they are one, whom only they see
	 * listed), then everyone else by name, up to MAX_LISTED_PLAYERS
	 */
	private renderMemberList(): void
	{
		const others = [...this.members]
			.filter(([playerId]) => (playerId !== this.ownPlayerId))
			.sort(([, a], [, b]) => a.localeCompare(b, currentLocale()));

		const own = ((this.ownPlayerId !== undefined) ? this.members.get(this.ownPlayerId) : undefined);
		const isGhost = ((own === undefined) && (this.playingId === null));
		const listed: string[] = [];

		// Said in words as well as in color, for players who can't tell the colors apart and for screen readers
		if (own !== undefined)
		{
			listed.push(t({
				id: 'lobby.ownName',
				defaultMessage: '{name} (you)',
				description: 'In the list of players in the lobby, the player\'s own name; {name} is the name'
			}, {
				name: own
			}));
		}
		else if (isGhost)
		{
			listed.push(t({
				id: 'lobby.ownGhost',
				defaultMessage: 'You (a ghost)',
				description: 'In the list of players in the lobby, the player themself while they play no character: a ghost, whom only they see listed'
			}));
		}

		const ownCount = listed.length;

		for (const [, name] of others.slice(0, MAX_LISTED_PLAYERS - ownCount))
		{
			listed.push(name);
		}

		this.memberList.replaceChildren(...listed.map((name, index) =>
		{
			const item = document.createElement('li');

			item.textContent = name;
			item.classList.toggle('member-own', (index < ownCount));

			return(item);
		}));

		const total = this.members.size + (isGhost ? 1 : 0);
		const unlisted = total - listed.length;

		this.memberCount.textContent = String(total);
		this.memberMore.textContent = t({
			id: 'lobby.morePlayers',
			defaultMessage: 'and {count, number} more',
			description: 'Under the list of players in the lobby, how many more are here than are listed'
		}, {
			count: unlisted
		});
		this.memberMore.hidden = (unlisted <= 0);
	}
}
