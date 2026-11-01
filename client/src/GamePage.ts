import { CloseCode } from '@colyseus/sdk';
import { GameMessageType, GameServerMessageType, INVITE_QUERY_PARAMETER, LobbyMessageType, LobbyServerMessageType, NoticeReason, ServerCloseCode, SessionServerMessageType, type AccountPayload, type AccountPlayer, type CharacterListPayload, type CharacterSummary, type ChatHistoryPayload, type ChatMessage, type ChatPayload, type ChooseCharacterPayload, type ControlPayload, type NoticePayload, type PlayingAsPayload, type UniverseSummary } from '@multiverse-kiln/shared';

import { t } from './localization';
import { CharacterApi } from './network/characterApi';
import { describeEditorError, EditorApi } from './network/editorApi';
import { GroupApi } from './network/groupApi';
import { getUniverseDetails, joinGroup, joinLobby, type GameConnection, type LobbyConnection, type ServerConnection } from './network/serverConnection';
import { isLeavingPage } from './pageLifecycle';
import { characterPageUrl, currentPageAddress, gamePageUrl, HOME_PAGE_URL, loginPageUrl, readGameUniverseKey, readPageParameter, replacePageParameters, replacePagePath } from './pages';
import { announce } from './ui/announcer';
import { characterMessages } from './ui/characterMessages';
import { CharacterSheetDialog } from './ui/CharacterSheetDialog';
import { CreateGroupDialog } from './ui/CreateGroupDialog';
import { showNoticeScreen, showScreen, showStatus } from './ui/dom';
import { GroupScreen } from './ui/GroupScreen';
import { InviteDialog } from './ui/InviteDialog';
import { InviteScreen } from './ui/InviteScreen';
import { LobbyScreen } from './ui/LobbyScreen';
import { MapView } from './ui/MapView';
import { pageMessages } from './ui/pageMessages';

/**
 * How long a refused link's message stays in the group's toolbar, in milliseconds
 */
const LINK_NOTICE_MS = 5000;

/**
 * Where a window plays
 *
 * - none: nowhere yet, while the universe and the player's characters load
 * - lobby: the universe's lobby, as the character the lobby plays (lobbyCharacterId asks for one)
 * - group: a group's room, as one of the player's characters in it
 * - invite: the screen an invite link opens, to choose a character to join its group with
 */
type Destination =
	| { kind: 'none' }
	| { kind: 'lobby' }
	| { kind: 'group'; groupId: string; characterId: string }
	| { kind: 'invite'; token: string };

/**
 * The group room this window has joined
 */
interface JoinedGroup
{
	groupId: string;
	connection: GameConnection;
}

/**
 * The universe lobby this window has joined
 */
interface JoinedLobby
{
	universe: UniverseSummary;
	connection: LobbyConnection;
}

/**
 * Runs the game's page (game.html) for the universe its address names: shows the lobby, group or
 * invite screen, and keeps the window in the room that goes with it. A browser that isn't logged in
 * goes to the login page, which comes back here
 *
 * The server decides who the player is, from the browser's session cookie, and tells every window of
 * the browser through the session room. Each window plays one of the player's characters: the one it played last (remembered for the
 * tab), or the player's most recent. A character in a group plays in the group's room; any other plays
 * in the lobby, where every window of the player plays the same one (or none, as a ghost). Choosing a
 * character in another group, or one who isn't in a group, moves the window there; choosing another in
 * the same group switches to them without leaving the room
 */
export class GamePage
{
	private readonly editorApi: EditorApi;
	private readonly characterApi: CharacterApi;
	private readonly groupApi: GroupApi;
	private readonly characterSheet: CharacterSheetDialog;
	private readonly createGroupDialog: CreateGroupDialog;
	private readonly inviteDialog: InviteDialog;
	private readonly lobbyScreen: LobbyScreen;
	private readonly groupScreen: GroupScreen;
	private readonly inviteScreen: InviteScreen;

	/**
	 * The player, from the session's latest Account message; null while logged out
	 */
	private player: AccountPlayer | null = null;

	/**
	 * The universe the page's address names, once it has been looked up
	 */
	private universe: UniverseSummary | undefined;

	/**
	 * The universe the page's address names, by slug or ID, until it has been looked up once the player has logged in
	 */
	private linkUniverseKey: string | undefined;

	/**
	 * The player's characters in the universe, once they have loaded
	 */
	private characters: CharacterListPayload | undefined;

	private destination: Destination = { kind: 'none' };

	/**
	 * A character the window asks the lobby to play once it has joined, when the lobby starts it as another
	 */
	private lobbyCharacterId: string | undefined;

	/**
	 * A character the window is taking out of their group, so the room closing on them isn't news
	 */
	private leavingCharacterId: string | undefined;

	private joinedGroup: JoinedGroup | undefined;

	private joinedLobby: JoinedLobby | undefined;

	/**
	 * Whether syncRooms() is running; it runs one at a time and repeats until the window is where it should be
	 */
	private syncingRooms = false;

	/**
	 * @param server The connection to the server and the joined session room
	 */
	constructor(private readonly server: ServerConnection)
	{
		const { client, session } = server;
		const mapView = new MapView();

		this.editorApi = new EditorApi(client);
		this.characterApi = new CharacterApi(client);
		this.groupApi = new GroupApi(client);
		this.linkUniverseKey = readGameUniverseKey();

		// In the lobby, the lobby tells every window of the player to list the characters again; a group's room doesn't
		this.characterSheet = new CharacterSheetDialog(this.characterApi, () =>
		{
			if (this.destination.kind !== 'lobby')
			{
				void this.loadCharacters();
			}
		});

		this.createGroupDialog = new CreateGroupDialog(this.groupApi, (groupId, characterId) =>
		{
			void this.loadCharacters();
			this.goToGroup(groupId, characterId);
		});

		this.inviteDialog = new InviteDialog(this.groupApi);

		this.lobbyScreen = new LobbyScreen(mapView, {
			sendChat: (text) =>
			{
				const chat: ChatPayload = { text };

				this.joinedLobby?.connection.room.send(LobbyMessageType.Chat, chat);
			},
			createCharacter: () =>
			{
				this.goToCreateCharacter();
			},
			chooseCharacter: (character) =>
			{
				this.chooseCharacter(character);
			},
			openCharacterSheet: (character) =>
			{
				this.openCharacterSheet(character);
			},
			createGroup: (character) =>
			{
				if (this.universe)
				{
					this.createGroupDialog.open(this.universe.id, character);
				}
			},
			leaveLobby: () =>
			{
				window.location.assign(HOME_PAGE_URL);
			}
		});

		this.groupScreen = new GroupScreen(mapView, {
			chooseCharacter: (character) =>
			{
				this.chooseCharacter(character);
			},
			openCharacterSheet: (character) =>
			{
				this.openCharacterSheet(character);
			},
			createCharacter: () =>
			{
				this.goToCreateCharacter();
			},
			invite: () =>
			{
				if (this.universe && this.joinedGroup)
				{
					this.inviteDialog.open(this.universe.id, this.universe.slug, this.joinedGroup.groupId);
				}
			},
			charactersChanged: () =>
			{
				void this.loadCharacters();
			},
			leave: (characterId) => this.leaveGroup(characterId)
		});

		this.inviteScreen = new InviteScreen({
			join: (character) => this.acceptInvite(character),
			goToLobby: () =>
			{
				this.finishInvite();
				this.goToLobby();
			},
			createCharacter: () =>
			{
				if (this.universe && (this.destination.kind === 'invite'))
				{
					window.location.assign(characterPageUrl(this.universe.id, this.destination.token));
				}
			}
		});

		const inviteToken = readPageParameter(INVITE_QUERY_PARAMETER);

		if (inviteToken !== undefined)
		{
			this.destination = { kind: 'invite', token: inviteToken };
		}

		session.onMessage(SessionServerMessageType.Account, (account: AccountPayload) =>
		{
			this.onAccount(account.player);
		});

		session.onLeave(() =>
		{
			this.player = null;
			void this.syncRooms();

			if (!isLeavingPage())
			{
				showStatus(t(pageMessages.disconnected));
			}
		});
	}

	/**
	 * Enters the page's universe once the browser is logged in, and goes to the login page when it isn't,
	 * such as when its session ends
	 *
	 * @param player The player, or null when the browser isn't logged in
	 */
	private onAccount(player: AccountPlayer | null): void
	{
		const wasLoggedIn = (this.player !== null);

		this.player = player;

		if (!player)
		{
			window.location.replace(loginPageUrl(currentPageAddress()));
		}
		else if (!wasLoggedIn)
		{
			void this.enterUniverse();
		}

		void this.syncRooms();
	}

	/**
	 * Looks up the universe the page's address names, loads the player's characters there, and goes where
	 * the window should play: the invite the address names, or the character the tab played last there
	 * (or the player's most recent), in their group or the lobby. Goes to Home when the address names no universe
	 */
	private async enterUniverse(): Promise<void>
	{
		const key = this.linkUniverseKey;

		if (this.universe)
		{
			this.showDestination();
			return;
		}

		if (key === undefined)
		{
			window.location.replace(HOME_PAGE_URL);
			return;
		}

		showStatus(t({
			id: 'game.loadingUniverse',
			defaultMessage: 'Loading the universe...',
			description: 'Shown on the whole page while the game looks up the universe it was opened for'
		}));

		try
		{
			this.universe = await this.findUniverse(key);
		}
		catch (error)
		{
			console.error('Could not find the universe to enter:', error);
			this.showOutside(t({
				id: 'game.universeNotFound',
				defaultMessage: 'That universe could not be found.',
				description: 'Shown on the game\'s page when it was opened to enter a universe that doesn\'t exist or can\'t be played'
			}));
			return;
		}

		this.linkUniverseKey = undefined;
		replacePagePath(gamePageUrl(this.universe.slug));

		if (this.destination.kind === 'invite')
		{
			void this.openInvite(this.destination.token);
			return;
		}

		const characters = await this.loadCharacters();
		const remembered = this.rememberedCharacterId();
		const playable = characters?.characters.filter((character) => (character.deleteAt === null)) ?? [];
		const character = (playable.find((each) => (each.id === remembered))
			?? playable.find((each) => (each.id === characters?.lastPlayedId)));

		if (character?.groupId)
		{
			this.goToGroup(character.groupId, character.id);
		}
		else
		{
			this.lobbyCharacterId = character?.id;
			this.goToLobby();
		}
	}

	/**
	 * A universe as Home lists it. A universe that isn't listed yet is found among the universes the
	 * player has a role in, the only ones they could play
	 *
	 * @param key The universe's slug or ID
	 * @return The universe
	 */
	private async findUniverse(key: string): Promise<UniverseSummary>
	{
		try
		{
			const { id, name, slug, shortDescription, ruleset } = await getUniverseDetails(this.server.client, key);

			return({ id, name, slug, shortDescription, ruleset });
		}
		catch
		{
			const { universes } = await this.editorApi.listUniverses();
			const own = universes.find((universe) => ((universe.slug === key) || (universe.id === key)));

			if (!own)
			{
				throw new Error(`The player has no universe with the slug or ID ${key}`);
			}

			const { id, name, slug, shortDescription, ruleset } = own;

			return({ id, name, slug, shortDescription, ruleset });
		}
	}

	/**
	 * Loads the player's characters in the universe, and lists them on the lobby and group screens
	 *
	 * @return The characters, or undefined when they couldn't be loaded
	 */
	private async loadCharacters(): Promise<CharacterListPayload | undefined>
	{
		const universe = this.universe;

		if (!universe)
		{
			return(undefined);
		}

		try
		{
			const list = await this.characterApi.listCharacters(universe.id);

			if (this.universe === universe)
			{
				this.characters = list;
				this.lobbyScreen.showCharacters(list);
				this.groupScreen.showCharacters(list);
			}

			return(list);
		}
		catch (error)
		{
			this.lobbyScreen.showCharacterError(describeEditorError(error, characterMessages.loadFailed));

			return(undefined);
		}
	}

	/**
	 * Plays one of the player's characters in this window: another in the window's group is switched to in
	 * the room, one in another group is played there, and any other in the lobby
	 *
	 * @param character The character
	 */
	private chooseCharacter(character: CharacterSummary): void
	{
		if (character.groupId === null)
		{
			this.rememberCharacter(character.id);

			if (this.joinedLobby && (this.destination.kind === 'lobby'))
			{
				const choice: ChooseCharacterPayload = { characterId: character.id };

				this.joinedLobby.connection.room.send(LobbyMessageType.ChooseCharacter, choice);
				return;
			}

			this.lobbyCharacterId = character.id;
			this.goToLobby();
			return;
		}

		if (this.joinedGroup?.groupId === character.groupId)
		{
			const control: ControlPayload = { characterId: character.id };

			this.rememberCharacter(character.id);
			this.destination = { kind: 'group', groupId: character.groupId, characterId: character.id };
			this.joinedGroup.connection.room.send(GameMessageType.Control, control);
			return;
		}

		this.goToGroup(character.groupId, character.id);
	}

	/**
	 * Goes to Create Character for the universe, from the lobby or a group
	 */
	private goToCreateCharacter(): void
	{
		if (this.universe)
		{
			window.location.assign(characterPageUrl(this.universe.id));
		}
	}

	/**
	 * Opens a character's sheet
	 *
	 * @param character The character
	 */
	private openCharacterSheet(character: CharacterSummary): void
	{
		if (this.universe)
		{
			void this.characterSheet.open(this.universe.id, character.id, character.name);
		}
	}

	/**
	 * Plays a character in their group's room
	 *
	 * @param groupId The group's ID
	 * @param characterId The character's ID
	 */
	private goToGroup(groupId: string, characterId: string): void
	{
		this.rememberCharacter(characterId);
		this.destination = { kind: 'group', groupId, characterId };
		this.showDestination();
		void this.syncRooms();
	}

	/**
	 * Plays in the universe's lobby
	 *
	 * @param notice A message to show there, if any
	 */
	private goToLobby(notice?: string): void
	{
		this.destination = { kind: 'lobby' };

		if (notice !== undefined)
		{
			this.lobbyScreen.showNotice(notice);
		}

		this.showDestination();
		void this.syncRooms();
	}

	/**
	 * Shows the screen for where the window plays, or a message while its room is being joined
	 */
	private showDestination(): void
	{
		const universe = this.universe;

		if (!this.player || !universe)
		{
			return;
		}

		if (this.destination.kind === 'lobby')
		{
			if (this.joinedLobby)
			{
				this.lobbyScreen.show(universe, this.player.playerId);
				showScreen('lobby');
			}
			else
			{
				showStatus(t({
					id: 'lobby.entering',
					defaultMessage: 'Entering {universe}...',
					description: 'Shown on the whole page while the player goes into a universe\'s lobby; {universe} is its name'
				}, {
					universe: universe.name
				}));
			}
		}
		else if (this.destination.kind === 'group')
		{
			showScreen('group');
		}
		else if (this.destination.kind === 'invite')
		{
			showScreen('invite');
		}
	}

	/**
	 * Shows a message on its own, with a link to Home, for a window that can't play anywhere
	 *
	 * @param message Why
	 */
	private showOutside(message: string): void
	{
		showNoticeScreen(message);
	}

	/**
	 * Says the universe the window was playing in was deleted, so there's nowhere left to play
	 *
	 * @param universe The universe's name
	 */
	private showUniverseDeleted(universe: string): void
	{
		this.destination = { kind: 'none' };
		this.showOutside(t({
			id: 'game.universeDeleted',
			defaultMessage: '{universe} was deleted, with everything in it.',
			description: 'Shown on the game\'s page when the universe being played was deleted, along with its creator\'s account; {universe} is its name'
		}, {
			universe
		}));
	}

	/**
	 * Says the player was turned out of the universe because their role in it changed
	 *
	 * @param universe The universe's name
	 */
	private showAccessLost(universe: string): void
	{
		this.destination = { kind: 'none' };
		this.showOutside(t({
			id: 'game.accessLost',
			defaultMessage: 'Your role in {universe} was changed or taken away, so you can\'t play it while it is in its current stage.',
			description: 'Shown on the game\'s page when the player was turned out of a universe they were playing because one of its creators changed or removed their role, or they left it; {universe} is its name'
		}, {
			universe
		}));
	}

	/**
	 * Explains to the player why something they asked for didn't happen
	 *
	 * @param reason Why
	 */
	private onNotice(reason: NoticeReason): void
	{
		if (reason === NoticeReason.ChatTooFast)
		{
			this.lobbyScreen.restoreLastChat();
			this.lobbyScreen.showNotice(t({
				id: 'lobby.chat.tooFast',
				defaultMessage: 'You are sending messages too quickly. Wait a moment and try again.',
				description: 'Shown in the lobby when the player sends chat messages faster than allowed'
			}));
		}
		else if (reason === NoticeReason.GroupNotTogether)
		{
			const message = t({
				id: 'group.notTogether',
				defaultMessage: 'The whole group has to be here to go that way, the anchor being included.',
				description: 'Shown in a group\'s toolbar, and read out, when a character tries a door or path that needs every member of the group, and one isn\'t playing, is in another area, or is on their way somewhere'
			});

			this.groupScreen.setStatus(message, LINK_NOTICE_MS);
			announce(message);
		}
	}

	/**
	 * Shows the invite an invite link leads to, with the player's characters to join with
	 *
	 * @param token The link's token
	 */
	private async openInvite(token: string): Promise<void>
	{
		showStatus(t({
			id: 'invite.loading',
			defaultMessage: 'Opening the invite...',
			description: 'Shown on the whole page while an invite link to a group loads'
		}));

		try
		{
			const [invite, characters] = await Promise.all([
				this.groupApi.getInvite(token),
				this.loadCharacters()
			]);

			// An invite to a group in another universe opens on that universe's page
			if (invite.universeId !== this.universe?.id)
			{
				window.location.replace(gamePageUrl(invite.universeSlug, token));
				return;
			}

			if (!characters)
			{
				throw new Error('The player\'s characters could not be loaded');
			}

			this.inviteScreen.show(invite, characters);
		}
		catch (error)
		{
			console.error('Could not open the invite:', error);
			this.inviteScreen.showProblem(describeEditorError(error, {
				id: 'invite.failed',
				defaultMessage: 'Could not open the invite.',
				description: 'Shown on the screen an invite link opens when the invite couldn\'t be loaded'
			}));
		}

		if (this.destination.kind === 'invite')
		{
			this.showDestination();
		}
	}

	/**
	 * Joins the invite's group with one of the player's characters, then plays them there
	 *
	 * @param character The character
	 */
	private async acceptInvite(character: CharacterSummary): Promise<void>
	{
		if (this.destination.kind !== 'invite')
		{
			return;
		}

		let groupId: string;

		try
		{
			groupId = await this.groupApi.acceptInvite(this.destination.token, character.id);
		}
		catch (error)
		{
			throw new Error(describeEditorError(error, {
				id: 'invite.joinFailed',
				defaultMessage: 'Could not join the group.',
				description: 'Shown on the screen an invite link opens when the chosen character couldn\'t join the group'
			}), { cause: error });
		}

		this.finishInvite();
		void this.loadCharacters();
		this.goToGroup(groupId, character.id);
	}

	/**
	 * Removes the invite link from the address bar, once it has been used or turned down
	 */
	private finishInvite(): void
	{
		replacePageParameters({ [INVITE_QUERY_PARAMETER]: undefined });
	}

	/**
	 * Takes a character out of the window's group, then plays them in the lobby, or another character
	 * there when the group was disbanded
	 *
	 * @param characterId The character's ID
	 */
	private async leaveGroup(characterId: string): Promise<void>
	{
		const joined = this.joinedGroup;

		if (!this.universe || !joined)
		{
			return;
		}

		this.leavingCharacterId = characterId;

		try
		{
			await this.groupApi.leaveGroup(this.universe.id, joined.groupId, characterId);
		}
		catch (error)
		{
			this.leavingCharacterId = undefined;
			throw new Error(describeEditorError(error, {
				id: 'group.leaveFailed',
				defaultMessage: 'Could not leave the group.',
				description: 'Shown when the character couldn\'t be taken out of their group'
			}), { cause: error });
		}

		// Loaded first, so the lobby knows the character is free to play there
		await this.loadCharacters();
		this.lobbyCharacterId = characterId;
		this.rememberCharacter(characterId);
		this.goToLobby();
	}

	/**
	 * Leaves and joins rooms until the window is where it should play: its group's room, or the
	 * universe's lobby, and neither while logged out or on the invite screen
	 *
	 * Where the window should be can change again while a room is being joined, so this repeats until it catches up
	 */
	private async syncRooms(): Promise<void>
	{
		if (this.syncingRooms)
		{
			return;
		}

		this.syncingRooms = true;

		try
		{
			for (;;)
			{
				const destination = this.destination;
				const wantedGroup = (((this.player !== null) && (destination.kind === 'group')) ? destination : undefined);
				const wantedLobby = (((this.player !== null) && (destination.kind === 'lobby')) ? this.universe : undefined);

				if (this.joinedGroup && (this.joinedGroup.groupId !== wantedGroup?.groupId))
				{
					await this.leaveGroupRoom();
				}
				else if (this.joinedLobby && (this.joinedLobby.universe.id !== wantedLobby?.id))
				{
					await this.leaveLobby();
				}
				else if (wantedGroup && !this.joinedGroup)
				{
					await this.joinGroupRoom(wantedGroup.groupId, wantedGroup.characterId);
				}
				else if (wantedLobby && !this.joinedLobby)
				{
					await this.enterLobby(wantedLobby);
				}
				else
				{
					break;
				}
			}
		}
		finally
		{
			this.syncingRooms = false;
		}
	}

	/**
	 * Joins a universe's lobby and shows it, or explains that it couldn't be joined
	 *
	 * @param universe The universe
	 */
	private async enterLobby(universe: UniverseSummary): Promise<void>
	{
		let connection: LobbyConnection;

		try
		{
			connection = await joinLobby(this.server.client, universe.id);
		}
		catch (error)
		{
			console.error('Could not join the lobby:', error);
			this.destination = { kind: 'none' };
			this.showOutside(t({
				id: 'lobby.notJoined',
				defaultMessage: 'Could not enter {universe}. Try again in a moment.',
				description: 'Shown on the game\'s page when the player couldn\'t go into a universe\'s lobby; {universe} is its name'
			}, {
				universe: universe.name
			}));
			return;
		}

		const joined: JoinedLobby = { universe, connection };
		const { room } = connection;
		let isFirstPlayingAs = true;

		this.joinedLobby = joined;
		this.lobbyScreen.attach(connection);

		if (this.characters)
		{
			this.lobbyScreen.showCharacters(this.characters);
		}

		room.onMessage(LobbyServerMessageType.ChatHistory, (history: ChatHistoryPayload) =>
		{
			this.lobbyScreen.setChatHistory(history.messages);
		});

		room.onMessage(LobbyServerMessageType.Chat, (message: ChatMessage) =>
		{
			this.lobbyScreen.addChatMessage(message);
		});

		// The lobby starts a player as their most recent character there; a window that came to play
		// another asks for them. A character the screen doesn't list was made in another window since the list loaded
		room.onMessage(LobbyServerMessageType.PlayingAs, (playingAs: PlayingAsPayload) =>
		{
			const wanted = this.lobbyCharacterId;

			this.lobbyCharacterId = undefined;

			if (isFirstPlayingAs && (wanted !== undefined) && (wanted !== playingAs.characterId) && this.isLobbyPlayable(wanted))
			{
				const choice: ChooseCharacterPayload = { characterId: wanted };

				room.send(LobbyMessageType.ChooseCharacter, choice);
			}
			else if (playingAs.characterId !== null)
			{
				this.rememberCharacter(playingAs.characterId);
			}

			isFirstPlayingAs = false;

			if (!this.lobbyScreen.setPlayingAs(playingAs.characterId))
			{
				void this.loadCharacters();
			}
		});

		room.onMessage(LobbyServerMessageType.CharactersChanged, () =>
		{
			void this.loadCharacters();
		});

		room.onMessage(LobbyServerMessageType.Notice, (notice: NoticePayload) =>
		{
			this.onNotice(notice.reason);
		});

		room.onLeave((code: number) =>
		{
			this.onLobbyLeft(joined, code);
		});

		if (this.destination.kind === 'lobby')
		{
			this.showDestination();
		}
	}

	/**
	 * Whether the lobby can play one of the player's characters: they aren't in a group or given their last rites
	 *
	 * @param characterId The character's ID
	 * @return True when it can
	 */
	private isLobbyPlayable(characterId: string): boolean
	{
		const character = this.characters?.characters.find((each) => (each.id === characterId));

		return((character !== undefined) && (character.groupId === null) && (character.deleteAt === null));
	}

	/**
	 * Stops showing the lobby and leaves its room
	 */
	private async leaveLobby(): Promise<void>
	{
		const joined = this.joinedLobby;

		if (!joined)
		{
			return;
		}

		this.joinedLobby = undefined;
		this.lobbyScreen.detach();

		if (joined.connection.room.connection.isOpen)
		{
			await joined.connection.room.leave();
		}
	}

	/**
	 * Handles the lobby's room closing when the window didn't leave it itself, explaining that the connection was lost
	 *
	 * @param joined The lobby that closed
	 * @param code WebSocket close code
	 */
	private onLobbyLeft(joined: JoinedLobby, code: number): void
	{
		if (this.joinedLobby !== joined)
		{
			return;
		}

		this.joinedLobby = undefined;
		this.lobbyScreen.detach();

		// A session that ended goes to the login page when the session room says so
		if ((code === CloseCode.CONSENTED) || (code === ServerCloseCode.LoggedOut.valueOf()))
		{
			return;
		}

		if (code === ServerCloseCode.UniverseDeleted.valueOf())
		{
			this.showUniverseDeleted(joined.universe.name);
			return;
		}

		if (code === ServerCloseCode.AccessLost.valueOf())
		{
			this.showAccessLost(joined.universe.name);
			return;
		}

		console.error(`Disconnected from the lobby (code ${code})`);
		this.destination = { kind: 'none' };
		this.showOutside(t({
			id: 'lobby.connectionLost',
			defaultMessage: 'Lost the connection to {universe}.',
			description: 'Shown on the game\'s page when the connection to a universe\'s lobby was lost; {universe} is its name'
		}, {
			universe: joined.universe.name
		}));
	}

	/**
	 * Joins a group's room as one of the player's characters and shows it. If the room can't be joined,
	 * such as when the group has been disbanded, the character plays in the lobby instead
	 *
	 * @param groupId The group's ID
	 * @param characterId The character's ID
	 */
	private async joinGroupRoom(groupId: string, characterId: string): Promise<void>
	{
		let connection: GameConnection;

		if (!this.player)
		{
			return;
		}

		this.groupScreen.prepare(groupId, characterId, this.player.playerId);

		if (this.characters)
		{
			this.groupScreen.showCharacters(this.characters);
		}

		showScreen('group');

		try
		{
			connection = await joinGroup(this.server.client, groupId, characterId);
		}
		catch (error)
		{
			console.error('Could not join the group:', error);
			await this.loadCharacters();
			this.lobbyCharacterId = characterId;
			this.goToLobby(t({
				id: 'group.notJoined',
				defaultMessage: 'Could not join that group. It may have been disbanded.',
				description: 'Shown in the lobby when the player couldn\'t go into their character\'s group'
			}));
			return;
		}

		this.joinedGroup = { groupId, connection };

		connection.room.onMessage(GameServerMessageType.Notice, (notice: NoticePayload) =>
		{
			this.onNotice(notice.reason);
		});

		connection.room.onLeave((code: number) =>
		{
			this.onGroupRoomLeft(connection, code);
		});

		this.groupScreen.start(connection);
	}

	/**
	 * Stops showing the group and leaves its room
	 */
	private async leaveGroupRoom(): Promise<void>
	{
		const joined = this.joinedGroup;

		if (!joined)
		{
			return;
		}

		this.joinedGroup = undefined;
		this.groupScreen.stop();

		if (joined.connection.room.connection.isOpen)
		{
			await joined.connection.room.leave();
		}
	}

	/**
	 * Handles the group's room closing when the window didn't leave it itself: the character left the
	 * group (from another window, or by being deleted), the group was disbanded, or the connection was
	 * lost. The window goes back to the lobby, unless the universe was deleted
	 *
	 * @param connection The room that closed
	 * @param code WebSocket close code
	 */
	private onGroupRoomLeft(connection: GameConnection, code: number): void
	{
		if (this.joinedGroup?.connection !== connection)
		{
			return;
		}

		const characterId = this.groupScreen.getCharacterId();
		const name = this.characters?.characters.find((character) => (character.id === characterId))?.name ?? '';
		let notice: string | undefined;

		this.joinedGroup = undefined;
		this.groupScreen.stop();

		// A session that ended goes to the login page when the session room says so
		if ((code === CloseCode.CONSENTED) || (code === ServerCloseCode.LoggedOut.valueOf()))
		{
			return;
		}

		if (code === ServerCloseCode.UniverseDeleted.valueOf())
		{
			this.showUniverseDeleted((this.universe?.name ?? ''));
			return;
		}

		if (code === ServerCloseCode.AccessLost.valueOf())
		{
			this.showAccessLost((this.universe?.name ?? ''));
			return;
		}

		// The room can close on a character the window is taking out of the group before the server has answered
		if (characterId === this.leavingCharacterId)
		{
			notice = undefined;
		}
		else if (code === ServerCloseCode.GroupDisbanded.valueOf())
		{
			notice = t({
				id: 'group.disbanded',
				defaultMessage: 'The group was disbanded.',
				description: 'Shown in the lobby when the player\'s group ended because the character it was centered on left it'
			});
		}
		else if (code === ServerCloseCode.LeftGroup.valueOf())
		{
			notice = t({
				id: 'group.characterLeft',
				defaultMessage: '{name} is no longer in the group, or can\'t be played.',
				description: 'Shown in the lobby when the character a window played left the group from another window, or was deleted; {name} is the character\'s name'
			}, {
				name
			});
		}
		else
		{
			console.error(`Disconnected from the group (code ${code})`);
			notice = t({
				id: 'group.connectionLost',
				defaultMessage: 'Lost the connection to the group.',
				description: 'Shown in the lobby when the connection to the player\'s group was lost'
			});
		}

		this.leavingCharacterId = undefined;
		this.lobbyCharacterId = characterId;
		showStatus(t({
			id: 'group.returning',
			defaultMessage: 'Going back to the lobby...',
			description: 'Shown on the whole page while the player goes back to the lobby after leaving their group'
		}));

		// Loaded first, so the lobby knows whether the character is free to play there
		void this.loadCharacters().then(() =>
		{
			this.goToLobby(notice);
		});
	}

	/**
	 * The storage key of the character the tab plays in the universe
	 *
	 * @return The key, or undefined before the universe is known
	 */
	private characterStorageKey(): string | undefined
	{
		return(this.universe ? `kiln.playing.${this.universe.id}` : undefined);
	}

	/**
	 * Remembers which character the tab plays, so reloading the page plays them again
	 *
	 * @param characterId The character's ID
	 */
	private rememberCharacter(characterId: string): void
	{
		const key = this.characterStorageKey();

		try
		{
			if (key !== undefined)
			{
				sessionStorage.setItem(key, characterId);
			}
		}
		catch
		{
			// Without storage, the tab plays the player's most recent character next time
		}
	}

	/**
	 * The character the tab played last in the universe
	 *
	 * @return The character's ID, or undefined when it hasn't played one or storage isn't available
	 */
	private rememberedCharacterId(): string | undefined
	{
		const key = this.characterStorageKey();

		try
		{
			return(((key !== undefined) ? (sessionStorage.getItem(key) ?? undefined) : undefined));
		}
		catch
		{
			return(undefined);
		}
	}
}
