import { CloseCode } from '@colyseus/sdk';
import { GROUP_QUERY_PARAMETER, LobbyMessageType, LobbyServerMessageType, MAX_GROUP_PLAYERS, NoticeReason, ServerCloseCode, SessionMessageType, SessionServerMessageType, type AccountPayload, type AccountPlayer, type ChatHistoryPayload, type ChatMessage, type ChatPayload, type JoinGroupPayload, type LoginPayload, type NoticePayload, type UniverseSummary } from '@multiverse-kiln/shared';

import { findFirstUniverse, joinGroup, joinLobby, type GameConnection, type LobbyConnection, type ServerConnection } from './network/serverConnection';
import { showScreen, showStatus } from './ui/dom';
import { GroupScreen } from './ui/GroupScreen';
import { LobbyScreen } from './ui/LobbyScreen';
import { LoginScreen } from './ui/LoginScreen';

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
 * Runs the page: shows the login, lobby or group screen to match the player the session says this
 * window is, and keeps the window in the room that goes with it
 *
 * The server decides who the player is and which group they are in, and tells every window of the
 * browser through the session room; a window only asks for changes and follows what it is told. A
 * logged-in player who isn't in a group is in a universe's lobby: for now always the first universe
 * the server lists
 */
export class App
{
	private readonly loginScreen: LoginScreen;
	private readonly lobbyScreen: LobbyScreen;
	private readonly groupScreen: GroupScreen;

	/**
	 * The player, from the session's latest Account message; null while logged out
	 */
	private player: AccountPlayer | null = null;

	/**
	 * The group from a join link this window was opened with, until the server has answered the request to join it
	 */
	private linkGroupId: string | undefined;

	private joinedGroup: JoinedGroup | undefined;

	private joinedLobby: JoinedLobby | undefined;

	/**
	 * A group whose room couldn't be joined, so it isn't tried again while the session takes the player out of it
	 */
	private failedGroupId: string | undefined;

	/**
	 * Set when no lobby could be joined, so the window doesn't keep trying; reloading the page tries again
	 */
	private lobbyUnavailable = false;

	/**
	 * Whether syncRooms() is running; it runs one at a time and repeats until the window is where the player is
	 */
	private syncingRooms = false;

	/**
	 * @param server The connection to the server and the joined session room
	 */
	constructor(private readonly server: ServerConnection)
	{
		const { session } = server;

		this.linkGroupId = (new URLSearchParams(window.location.search).get(GROUP_QUERY_PARAMETER) ?? undefined);

		this.loginScreen = new LoginScreen((name) =>
		{
			const login: LoginPayload = { name };

			session.send(SessionMessageType.Login, login);
		});

		this.lobbyScreen = new LobbyScreen({
			sendChat: (text) =>
			{
				const chat: ChatPayload = { text };

				this.joinedLobby?.connection.room.send(LobbyMessageType.Chat, chat);
			},
			createGroup: () =>
			{
				this.joinedLobby?.connection.room.send(LobbyMessageType.CreateGroup);
			}
		});

		this.groupScreen = new GroupScreen(() =>
		{
			session.send(SessionMessageType.LeaveGroup);
		});

		session.onMessage(SessionServerMessageType.Account, (account: AccountPayload) =>
		{
			this.onAccount(account.player);
		});

		session.onMessage(SessionServerMessageType.Notice, (notice: NoticePayload) =>
		{
			this.onNotice(notice.reason);
		});

		session.onLeave(() =>
		{
			this.player = null;
			void this.syncRooms();
			showStatus('Disconnected from the server. Reload the page to reconnect.');
		});
	}

	/**
	 * Shows the screen for the player, and moves the window into the room they should be in
	 *
	 * @param player The player, or null when the browser isn't logged in
	 */
	private onAccount(player: AccountPlayer | null): void
	{
		const wasLoggedIn = (this.player !== null);

		this.player = player;

		if (player?.groupId !== this.failedGroupId)
		{
			this.failedGroupId = undefined;
		}

		if (!player)
		{
			this.loginScreen.reset();
			showScreen('login');
		}
		else if (player.groupId === null)
		{
			this.showLobby();
		}

		if (player && !wasLoggedIn)
		{
			this.followJoinLink(player);
		}

		if (player && (player.groupId !== null) && (player.groupId === this.linkGroupId))
		{
			this.finishJoinLink();
		}

		void this.syncRooms();
	}

	/**
	 * Asks to join the group from the join link, once the player has logged in
	 *
	 * @param player The player
	 */
	private followJoinLink(player: AccountPlayer): void
	{
		if (this.linkGroupId === undefined)
		{
			return;
		}

		if (player.groupId === this.linkGroupId)
		{
			this.finishJoinLink();
			return;
		}

		const join: JoinGroupPayload = { groupId: this.linkGroupId };

		this.server.session.send(SessionMessageType.JoinGroup, join);
	}

	/**
	 * Forgets the join link and removes it from the address bar, once the server has answered it
	 */
	private finishJoinLink(): void
	{
		const url = new URL(window.location.href);

		this.linkGroupId = undefined;
		url.searchParams.delete(GROUP_QUERY_PARAMETER);
		window.history.replaceState(window.history.state, '', url);
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
			this.lobbyScreen.showNotice('You are sending messages too quickly. Wait a moment and try again.');
			return;
		}

		if (reason === NoticeReason.NameInUse)
		{
			this.loginScreen.showError('That player is already logged in from another browser.');
			return;
		}

		if (reason === NoticeReason.LoginFailed)
		{
			this.loginScreen.showError('Could not log in. Try again in a moment.');
			return;
		}

		if (reason === NoticeReason.GroupNotCreated)
		{
			this.lobbyScreen.showNotice('Could not create a game. Try again in a moment.');
			return;
		}

		// Only a join link asks to join a group. A player already in a group stays in it and sees the message there
		const message = ((reason === NoticeReason.GroupFull) ? `That game is full: it already has ${MAX_GROUP_PLAYERS} players.` : 'That game has ended or the link is wrong.');

		this.finishJoinLink();

		if (this.player?.groupId)
		{
			this.groupScreen.setStatus(message);
		}
		else
		{
			this.lobbyScreen.showNotice(message);
			this.showLobby();
			void this.syncRooms();
		}
	}

	/**
	 * Shows the lobby screen once the window is in a lobby, or a message while it gets there
	 */
	private showLobby(): void
	{
		if (this.joinedLobby && this.player)
		{
			this.lobbyScreen.show(this.joinedLobby.universe.name, this.player.playerId, this.player.name);
			showScreen('lobby');
		}
		else if (!this.lobbyUnavailable)
		{
			showStatus('Entering the lobby...');
		}
	}

	/**
	 * Leaves and joins rooms until the window is where the player is: their group's room when they are
	 * in a group, a universe's lobby when they are logged in and not, and neither when logged out
	 *
	 * The player can change again while a room is being joined, so this repeats until it catches up
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
				const wantedGroupId = this.wantedGroupId();

				// While a join link is being answered, the player is about to be in a group
				const wantsLobby = (
					(this.player !== null) &&
					(wantedGroupId === undefined) &&
					(this.linkGroupId === undefined) &&
					!this.lobbyUnavailable
				);

				if (this.joinedGroup && (this.joinedGroup.groupId !== wantedGroupId))
				{
					await this.leaveGroupRoom();
				}
				else if (this.joinedLobby && !wantsLobby)
				{
					await this.leaveLobby();
				}
				else if ((wantedGroupId !== undefined) && !this.joinedGroup)
				{
					await this.joinGroupRoom(wantedGroupId);
				}
				else if (wantsLobby && !this.joinedLobby)
				{
					await this.enterLobby();
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
	 * The group the window should be in
	 *
	 * @return The player's group ID, or undefined when they aren't in one
	 */
	private wantedGroupId(): string | undefined
	{
		const groupId = (this.player?.groupId ?? undefined);

		return(((groupId === this.failedGroupId) ? undefined : groupId));
	}

	/**
	 * Joins the lobby of the first universe the server lists, and shows it
	 */
	private async enterLobby(): Promise<void>
	{
		let joined: JoinedLobby;

		try
		{
			const universe = await findFirstUniverse(this.server.client);

			if (!universe)
			{
				this.lobbyUnavailable = true;
				showStatus('There are no universes to play in yet.');
				return;
			}

			joined = {
				universe,
				connection: await joinLobby(this.server.client, universe.id)
			};
		}
		catch (error)
		{
			console.error('Could not join the lobby:', error);
			this.lobbyUnavailable = true;
			showStatus('Could not enter the lobby. Reload the page to try again.');
			return;
		}

		const { room } = joined.connection;

		this.joinedLobby = joined;
		this.lobbyScreen.attach(room);

		room.onMessage(LobbyServerMessageType.ChatHistory, (history: ChatHistoryPayload) =>
		{
			this.lobbyScreen.setChatHistory(history.messages);
		});

		room.onMessage(LobbyServerMessageType.Chat, (message: ChatMessage) =>
		{
			this.lobbyScreen.addChatMessage(message);
		});

		room.onMessage(LobbyServerMessageType.Notice, (notice: NoticePayload) =>
		{
			this.onNotice(notice.reason);
		});

		room.onLeave((code: number) =>
		{
			this.onLobbyLeft(joined, code);
		});

		if (this.player?.groupId === null)
		{
			this.showLobby();
		}
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
	 * Handles the lobby's room closing when the window didn't leave it itself
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

		if (code !== CloseCode.CONSENTED)
		{
			console.error(`Disconnected from the lobby (code ${code})`);
			this.lobbyUnavailable = true;
			showStatus('Lost the connection to the lobby. Reload the page to reconnect.');
		}
	}

	/**
	 * Joins a group's room and shows it
	 *
	 * If the room can't be joined, asks the session to take the player out of the group, so that every
	 * window goes back to the lobby rather than trying again
	 *
	 * @param groupId The group's ID
	 */
	private async joinGroupRoom(groupId: string): Promise<void>
	{
		let connection: GameConnection;

		this.groupScreen.prepare(groupId);
		showScreen('group');

		try
		{
			connection = await joinGroup(this.server.client, groupId);
		}
		catch (error)
		{
			console.error('Could not join the group:', error);
			this.failedGroupId = groupId;
			this.lobbyScreen.showNotice('Could not join that game. It may have just ended.');
			this.showLobby();
			this.server.session.send(SessionMessageType.LeaveGroup);
			return;
		}

		this.joinedGroup = { groupId, connection };

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
	 * Handles the group's room closing when the window didn't leave it itself
	 *
	 * The server closes it with LeftGroup when the player leaves the group from another window, and
	 * the session's Account message moves this window too. Any other close means the room failed, so the
	 * player is taken out of the group
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

		this.joinedGroup = undefined;
		this.groupScreen.stop();

		if (code === ServerCloseCode.LeftGroup.valueOf())
		{
			return;
		}

		if (code !== CloseCode.CONSENTED)
		{
			console.error(`Disconnected from the group (code ${code})`);
			this.lobbyScreen.showNotice('Lost the connection to the game.');
		}

		this.server.session.send(SessionMessageType.LeaveGroup);
	}
}
