import { Callbacks } from '@colyseus/sdk';
import { DAY_SECONDS, defineMessages, GRID_CELL_SIZE, secondOfDay, ServerMessageType, type AreaPayload, type CharacterListPayload, type CharacterSummary, type GroupMember, type WelcomePayload } from '@multiverse-kiln/shared';
import signOutIcon from 'virtual:icon/ph:sign-out';

import { currentLocale, t } from '../localization';
import type { GameConnection } from '../network/serverConnection';
import { announce } from './announcer';
import { CharacterList } from './CharacterList';
import { characterMessages } from './characterMessages';
import { getElement, setButtonLabel, showMessage } from './dom';
import type { MapView } from './MapView';
import { addShortcut } from './shortcuts';
import { describeTimeOfDay } from './timeOfDay';

/**
 * Text the group screen shows in more than one place (see src/localization.ts)
 */
const messages = defineMessages({
	joining: {
		id: 'group.joining',
		defaultMessage: 'Joining...',
		description: 'Shown in the group\'s toolbar while the player goes into the group'
	}
});

/**
 * Milliseconds between refreshes of the toolbar's clock, which in a faerie area follows the character
 * as they walk
 */
const CLOCK_REFRESH_MS = 500;

/**
 * What the group screen asks the app to do
 */
export interface GroupScreenActions
{
	/**
	 * Play one of the player's characters: another in this group switches this window to them, and any
	 * other goes where they are
	 */
	chooseCharacter: (character: CharacterSummary) => void;

	/**
	 * Show one of the player's characters on their character sheet
	 */
	openCharacterSheet: (character: CharacterSummary) => void;

	/**
	 * Go to Create Character
	 */
	createCharacter: () => void;

	/**
	 * Open the Invite dialog, for the anchor being's player
	 */
	invite: () => void;

	/**
	 * List the player's characters again: one of them joined or left the group, from another window
	 */
	charactersChanged: () => void;

	/**
	 * Take the character this window plays out of the group, once the player has said so
	 *
	 * @return Resolves once they have left; rejects with the reason, in the player's language, when they couldn't
	 */
	leave: (characterId: string) => Promise<void>;
}

/**
 * The group screen: the group's map, its members (who is here, and who the anchor being is), the
 * player's characters with Create Character, and the Invite and Leave group buttons
 *
 * Each window plays one character. Choosing another of the player's characters in the group switches
 * the window to them without leaving the room: the room sends Welcome and Area again, and the map
 * starts over around them. Only the anchor being's player sees Invite. Leaving asks first; the anchor
 * being leaving disbands the group
 */
export class GroupScreen
{
	private readonly title = getElement('group-title', HTMLElement);
	private readonly characterName = getElement('group-character-name', HTMLElement);
	private readonly status = getElement('group-status', HTMLElement);
	private readonly time = getElement('group-time', HTMLElement);
	private readonly inviteButton = getElement('invite-group', HTMLButtonElement);
	private readonly leaveButton = getElement('leave-group', HTMLButtonElement);
	private readonly map = getElement('group-map', HTMLElement);
	private readonly memberCount = getElement('group-member-count', HTMLElement);
	private readonly memberList = getElement('group-member-list', HTMLUListElement);
	private readonly leaveDialog = getElement('leave-group-dialog', HTMLDialogElement);
	private readonly leaveTitle = getElement('leave-group-title', HTMLElement);
	private readonly leaveQuestion = getElement('leave-group-question', HTMLElement);
	private readonly leaveError = getElement('leave-group-error', HTMLElement);
	private readonly leaveConfirm = getElement('leave-group-confirm', HTMLButtonElement);
	private readonly characterChoices: CharacterList;
	private statusTimer?: number;

	/**
	 * The group the window is in, and the character it plays there
	 */
	private groupId: string | undefined;
	private characterId: string | undefined;

	/**
	 * The joined room, once the window is in it
	 */
	private connection: GameConnection | undefined;

	/**
	 * The area the window's character is in, for the toolbar's clock
	 */
	private area: AreaPayload | undefined;

	/**
	 * The player's ID, which tells their own members apart
	 */
	private ownPlayerId: string | undefined;

	private characters: CharacterListPayload | undefined;

	/**
	 * The group's members, by character ID, from the room's state
	 */
	private readonly members = new Map<string, { name: string; playerId: string; present: boolean }>();

	private anchorId = '';
	private groupName = '';

	/**
	 * A character the window has just switched to, until the room sends the area they are in
	 */
	private switchingTo: string | undefined;

	/**
	 * Stops following the room
	 */
	private readonly unbinds: Array<() => void> = [];

	private renderQueued = false;

	/**
	 * Whether the player has asked to leave and the server hasn't answered
	 */
	private leaving = false;

	/**
	 * @param mapView The map, shared with the lobby screen
	 * @param actions What the screen's controls do
	 */
	constructor(private readonly mapView: MapView, private readonly actions: GroupScreenActions)
	{
		this.characterChoices = new CharacterList(getElement('group-character-list', HTMLUListElement), getElement('group-character-none', HTMLElement), {
			choose: (character) =>
			{
				actions.chooseCharacter(character);
			},
			openSheet: (character) =>
			{
				actions.openCharacterSheet(character);
			}
		});

		getElement('group-create-character', HTMLButtonElement).addEventListener('click', () =>
		{
			actions.createCharacter();
		});

		this.inviteButton.addEventListener('click', () =>
		{
			actions.invite();
		});

		this.leaveButton.addEventListener('click', () =>
		{
			this.askToLeave();
		});

		getElement('leave-group-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			this.leaveDialog.close();
		});

		this.leaveConfirm.addEventListener('click', () =>
		{
			void this.leave();
		});

		// Escape doesn't close the question while the answer is being sent
		this.leaveDialog.addEventListener('cancel', (event) =>
		{
			if (this.leaving)
			{
				event.preventDefault();
			}
		});

		addShortcut({
			keys: 'Alt+K',
			scope: getElement('group-screen', HTMLElement),
			description: () => t(characterMessages.sheetShortcut),
			run: () =>
			{
				const character = this.characters?.characters.find((each) => (each.id === this.characterId));

				if (character)
				{
					actions.openCharacterSheet(character);
				}
			}
		});
	}

	/**
	 * Gets the screen ready while the group's room is being joined
	 *
	 * @param groupId The group's ID
	 * @param characterId The character the window plays
	 * @param ownPlayerId The player's ID
	 */
	prepare(groupId: string, characterId: string, ownPlayerId: string): void
	{
		this.groupId = groupId;
		this.characterId = characterId;
		this.ownPlayerId = ownPlayerId;
		this.groupName = '';
		this.anchorId = '';
		this.members.clear();
		this.leaving = false;
		this.leaveButton.disabled = false;
		this.inviteButton.hidden = true;
		this.setStatus(t(messages.joining));
		this.render();
	}

	/**
	 * Starts drawing a joined group's room, and following its members and which character the window plays
	 *
	 * @param connection The joined room
	 */
	start(connection: GameConnection): void
	{
		const { room } = connection;
		const callbacks = Callbacks.get(room);

		this.connection = connection;
		this.characterId = connection.playerId;
		this.area = connection.area;

		// Keeps any message that arrived while joining
		if (this.status.textContent === t(messages.joining))
		{
			this.setStatus('');
		}

		this.mapView.show(this.map, connection);

		this.unbinds.push(callbacks.listen('name', (name: string) =>
		{
			this.groupName = name;
			this.queueRender();
		}));

		this.unbinds.push(callbacks.listen('anchorId', (anchorId: string) =>
		{
			this.anchorId = anchorId;
			this.queueRender();
		}));

		this.unbinds.push(callbacks.listen('clock', () =>
		{
			this.showClock();
		}));

		// Faerie time changes as the character walks, without the clock moving
		const clockTimer = window.setInterval(() =>
		{
			this.showClock();
		}, CLOCK_REFRESH_MS);

		this.unbinds.push(() =>
		{
			window.clearInterval(clockTimer);
		});

		// Fires for members already in the group too
		this.unbinds.push(callbacks.onAdd('members', (member: GroupMember, characterId: string) =>
		{
			this.members.set(characterId, { name: member.name, playerId: member.playerId, present: member.present });
			this.queueRender();

			if ((member.playerId === this.ownPlayerId) && this.isListedOutsideGroup(characterId))
			{
				this.actions.charactersChanged();
			}

			this.unbinds.push(callbacks.listen(member, 'present', (present: boolean) =>
			{
				const shown = this.members.get(characterId);

				if (shown)
				{
					shown.present = present;
					this.queueRender();
				}
			}));
		}));

		this.unbinds.push(callbacks.onRemove('members', (member: GroupMember, characterId: string) =>
		{
			this.members.delete(characterId);
			this.queueRender();

			if (member.playerId === this.ownPlayerId)
			{
				this.actions.charactersChanged();
			}
		}));

		this.unbinds.push(room.onMessage(ServerMessageType.Welcome, (welcome: WelcomePayload) =>
		{
			if (welcome.playerId !== this.characterId)
			{
				this.switchingTo = welcome.playerId;
			}
		}));

		this.unbinds.push(room.onMessage(ServerMessageType.Area, (area: AreaPayload) =>
		{
			this.area = area;
			this.finishSwitch(area);
			this.showClock();
		}));
	}

	/**
	 * Stops drawing the group's room; the caller leaves the room
	 */
	stop(): void
	{
		for (const unbind of this.unbinds.splice(0))
		{
			unbind();
		}

		this.connection = undefined;
		this.area = undefined;
		this.groupId = undefined;
		this.switchingTo = undefined;
		this.time.textContent = '';
		this.leaveDialog.close();
		this.mapView.hide();
	}

	/**
	 * Shows the group's game clock in the toolbar: the day since its world began, and the time of day in
	 * the character's area, the way the universe shows it. That is the clock's time where time flows
	 * normally and the area's fixed time in an always area. In a faerie area, where the time of day comes
	 * from where the character stands, it is at most a word for the time of day there, such as afternoon.
	 * A universe that doesn't show the time shows no clock
	 */
	private showClock(): void
	{
		const connection = this.connection;

		if (!connection)
		{
			return;
		}

		const clock = connection.room.state.clock;
		const day = Math.floor(clock / DAY_SECONDS) + 1;
		const area = this.area;
		const own = ((this.characterId !== undefined) ? connection.room.state.players.get(this.characterId) : undefined);

		// Until the area arrives, it isn't known whether the universe shows the time
		if (!area)
		{
			this.time.textContent = '';
			return;
		}

		const seconds = secondOfDay(area.time, clock, Date.now(), { column: Math.floor((own?.x ?? 0) / GRID_CELL_SIZE), row: Math.floor((own?.y ?? 0) / GRID_CELL_SIZE) }, area.bounds);
		const roughOnly = ((area.time.passage === 'faerie') && (area.displayTime === 'precise'));
		const time = describeTimeOfDay(seconds, (roughOnly ? 'rough' : area.displayTime));

		if (time === undefined)
		{
			this.time.textContent = '';
			return;
		}

		this.time.textContent = t({
			id: 'group.clock',
			defaultMessage: 'Day {day, number}, {time}',
			description: 'In the group\'s toolbar, the group\'s game clock: how many days its world has run, counting the first as 1, and the time of day, e.g. "Day 1, 8:00:00 AM" or "Day 1, afternoon"'
		}, {
			day,
			time
		});
	}

	/**
	 * The character the window plays
	 *
	 * @return The character's ID, or undefined while the window isn't in a group
	 */
	getCharacterId(): string | undefined
	{
		return(this.characterId);
	}

	/**
	 * Lists the player's characters in the universe
	 *
	 * @param list The characters, oldest first, and the universe's ruleset
	 */
	showCharacters(list: CharacterListPayload): void
	{
		this.characters = list;
		this.render();
	}

	/**
	 * Shows a message in the toolbar
	 *
	 * @param message Text to show; empty to clear it
	 * @param durationMs How long to show it, or undefined to keep it until the next message
	 */
	setStatus(message: string, durationMs?: number): void
	{
		window.clearTimeout(this.statusTimer);
		this.status.textContent = message;

		if (durationMs !== undefined)
		{
			this.statusTimer = window.setTimeout(() =>
			{
				this.status.textContent = '';
			}, durationMs);
		}
	}

	/**
	 * Whether the player's character list, once loaded, doesn't have a character in this group, so it
	 * needs loading again
	 *
	 * @param characterId The character's ID
	 * @return True when the list says otherwise
	 */
	private isListedOutsideGroup(characterId: string): boolean
	{
		const listed = this.characters?.characters.find((character) => (character.id === characterId));

		return((this.characters !== undefined) && (listed?.groupId !== this.groupId));
	}

	/**
	 * Restarts the map around the character the window has switched to, once the room has sent their area
	 *
	 * @param area The area they are in
	 */
	private finishSwitch(area: AreaPayload): void
	{
		const characterId = this.switchingTo;
		const connection = this.connection;

		if ((characterId === undefined) || !connection)
		{
			return;
		}

		this.switchingTo = undefined;
		this.characterId = characterId;
		this.connection = { room: connection.room, playerId: characterId, area };
		this.mapView.show(this.map, this.connection);
		this.render();

		const name = this.members.get(characterId)?.name;

		if (name !== undefined)
		{
			announce(t(characterMessages.nowPlaying, {
				name
			}));
		}
	}

	/**
	 * Asks whether to leave the group: the anchor being leaving disbands it for everyone
	 */
	private askToLeave(): void
	{
		const name = (this.members.get(this.characterId ?? '')?.name ?? '');
		const isAnchor = (this.characterId === this.anchorId);

		this.leaveTitle.textContent = (isAnchor
			? t({
				id: 'leaveGroup.disbandTitle',
				defaultMessage: 'Disband the Group?',
				description: 'Title of the dialog that asks the anchor being\'s player whether to leave the group, which ends it'
			})
			: t({
				id: 'leaveGroup.title',
				defaultMessage: 'Leave the Group?',
				description: 'Title of the dialog that asks whether to take a character out of their group'
			}));
		this.leaveQuestion.textContent = (isAnchor
			? t({
				id: 'leaveGroup.disbandQuestion',
				defaultMessage: '{name} is the anchor being, so if they leave, the group is disbanded for everyone. Every character keeps their items and money.',
				description: 'Asked before the anchor being leaves their group; {name} is the anchor being\'s name'
			}, {
				name
			})
			: t({
				id: 'leaveGroup.question',
				defaultMessage: '{name} leaves the group and goes to the lobby. To come back, they need a new invite.',
				description: 'Asked before a character leaves their group; {name} is the character\'s name'
			}, {
				name
			}));
		setButtonLabel(this.leaveConfirm, signOutIcon, (isAnchor
			? t({
				id: 'leaveGroup.disband',
				defaultMessage: 'Disband',
				description: 'Button that takes the anchor being out of the group, which ends the group for everyone'
			})
			: t({
				id: 'leaveGroup.confirm',
				defaultMessage: 'Leave Group',
				description: 'Button that takes the character out of their group'
			})));
		this.leaveConfirm.disabled = false;
		showMessage(this.leaveError, undefined);
		this.leaveDialog.showModal();
	}

	/**
	 * Takes the character out of the group, once the player has said so
	 */
	private async leave(): Promise<void>
	{
		const characterId = this.characterId;

		if ((characterId === undefined) || this.leaving)
		{
			return;
		}

		this.leaving = true;
		this.leaveConfirm.disabled = true;
		this.leaveButton.disabled = true;

		try
		{
			await this.actions.leave(characterId);
			this.leaveDialog.close();
		}
		catch (error)
		{
			showMessage(this.leaveError, ((error instanceof Error) ? error.message : String(error)));
			this.leaveConfirm.disabled = false;
			this.leaveButton.disabled = false;
		}
		finally
		{
			this.leaving = false;
		}
	}

	/**
	 * Redraws once the current state patch has been applied, however many members it changed
	 */
	private queueRender(): void
	{
		if (this.renderQueued)
		{
			return;
		}

		this.renderQueued = true;

		queueMicrotask(() =>
		{
			this.renderQueued = false;
			this.render();
		});
	}

	/**
	 * Draws the group's name, the character the window plays, the members, the player's characters,
	 * Invite for the anchor being's player, and Leave group, which is Disband Group for the anchor being
	 */
	private render(): void
	{
		const groupName = ((this.groupName !== '') ? this.groupName : t({
			id: 'group.unnamed',
			defaultMessage: 'Group',
			description: 'Heading of a group\'s screen when the group has no name'
		}));
		const playing = this.members.get(this.characterId ?? '');

		this.title.textContent = groupName;
		this.characterName.textContent = (playing?.name ?? '');
		document.title = t({
			id: 'group.pageTitle',
			defaultMessage: '{group} - Multiverse Kiln',
			description: 'The browser tab\'s title while the player is in a group; {group} is the group\'s name, or "Group", and Multiverse Kiln is the game engine\'s name'
		}, {
			group: groupName
		});
		this.inviteButton.hidden = (this.members.get(this.anchorId)?.playerId !== this.ownPlayerId);
		setButtonLabel(this.leaveButton, signOutIcon, ((this.characterId === this.anchorId)
			? t({
				id: 'group.disband',
				defaultMessage: 'Disband Group',
				description: 'Button, in place of Leave group while the window plays the anchor being, that takes them out of the group, which ends the group for everyone (it asks first)'
			})
			: t({
				id: 'group.leave',
				defaultMessage: 'Leave group',
				description: 'Button that takes the character this window plays out of the group, back to the lobby'
			})));
		this.characterChoices.render(this.characters, this.characterId, this.groupId);
		this.renderMembers();
	}

	/**
	 * Draws the members, the anchor being first, then by name, saying in words which is the anchor being,
	 * which are the player's own and which aren't here
	 */
	private renderMembers(): void
	{
		const sorted = [...this.members]
			.sort(([aId, a], [bId, b]) => ((Number(bId === this.anchorId) - Number(aId === this.anchorId)) || a.name.localeCompare(b.name, currentLocale())));

		this.memberCount.textContent = String(this.members.size);
		this.memberList.replaceChildren(...sorted.map(([characterId, member]) =>
		{
			const item = document.createElement('li');
			const notes: string[] = [];

			if (characterId === this.anchorId)
			{
				notes.push(t({
					id: 'group.member.anchor',
					defaultMessage: 'anchor',
					description: 'In the list of a group\'s members, beside the character the group is centered on'
				}));
			}

			if (member.playerId === this.ownPlayerId)
			{
				notes.push(t({
					id: 'group.member.own',
					defaultMessage: 'yours',
					description: 'In the list of a group\'s members, beside the player\'s own characters'
				}));
			}

			if (!member.present)
			{
				notes.push(t({
					id: 'group.member.away',
					defaultMessage: 'not here',
					description: 'In the list of a group\'s members, beside one whose player isn\'t playing; links that need the whole group can\'t be used until they are'
				}));
			}

			item.textContent = ((notes.length > 0)
				? t({
					id: 'group.member.withNotes',
					defaultMessage: '{name} ({notes})',
					description: 'In the list of a group\'s members, a member\'s name followed by notes about them, such as "anchor being, not here"; {notes} is the notes joined as a list'
				}, {
					name: member.name,
					notes: new Intl.ListFormat(currentLocale(), { style: 'short', type: 'unit' }).format(notes)
				})
				: member.name);
			item.classList.toggle('member-own', (member.playerId === this.ownPlayerId));
			item.classList.toggle('member-away', !member.present);

			return(item);
		}));
	}
}
