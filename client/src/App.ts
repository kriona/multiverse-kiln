import { CloseCode } from '@colyseus/sdk';
import { GROUP_QUERY_PARAMETER, LobbyMessageType, LobbyServerMessageType, MAX_GROUP_PLAYERS, NoticeReason, ServerCloseCode, type AccountPayload, type AccountPlayer, type ChatHistoryPayload, type ChatMessage, type ChatPayload, type JoinGroupPayload, type LoginPayload, type NoticePayload } from '@multiverse-kiln/shared';

import { joinGroup, type GameConnection, type ServerConnection } from './network/serverConnection';
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
 * Runs the page: shows the login, lobby or group screen to match the player the lobby says this
 * window is, and keeps the window in its player's group room
 *
 * The server decides who the player is and which group they are in, and tells every window of the
 * browser; a window only asks for changes and follows what it is told
 */
export class App
{
	private readonly loginScreen: LoginScreen;
	private readonly lobbyScreen: LobbyScreen;
	private readonly groupScreen: GroupScreen;

	/**
	 * The player, from the lobby's latest Account message; null while logged out
	 */
	private player: AccountPlayer | null = null;

	/**
	 * The group from a join link this window was opened with, until the server has answered the request to join it
	 */
	private linkGroupId: string | undefined;

	private joinedGroup: JoinedGroup | undefined;

	/**
	 * A group whose room couldn't be joined, so it isn't tried again while the lobby takes the player out of it
	 */
	private failedGroupId: string | undefined;

	/**
	 * Whether syncGroup() is running; it runs one at a time and repeats until the window is where the player is
	 */
	private syncingGroup = false;

	/**
	 * @param server The connection to the server and the joined lobby
	 */
	constructor(private readonly server: ServerConnection)
	{
		const { lobby } = server;

		this.linkGroupId = (new URLSearchParams(window.location.search).get(GROUP_QUERY_PARAMETER) ?? undefined);

		this.loginScreen = new LoginScreen((name) =>
		{
			const login: LoginPayload = { name };

			lobby.send(LobbyMessageType.Login, login);
		});

		this.lobbyScreen = new LobbyScreen(lobby, {
			sendChat: (text) =>
			{
				const chat: ChatPayload = { text };

				lobby.send(LobbyMessageType.Chat, chat);
			},
			createGroup: () =>
			{
				lobby.send(LobbyMessageType.CreateGroup);
			}
		});

		this.groupScreen = new GroupScreen(() =>
		{
			lobby.send(LobbyMessageType.LeaveGroup);
		});

		lobby.onMessage(LobbyServerMessageType.Account, (account: AccountPayload) =>
		{
			this.onAccount(account.player);
		});

		lobby.onMessage(LobbyServerMessageType.ChatHistory, (history: ChatHistoryPayload) =>
		{
			this.lobbyScreen.setChatHistory(history.messages);
		});

		lobby.onMessage(LobbyServerMessageType.Chat, (message: ChatMessage) =>
		{
			this.lobbyScreen.addChatMessage(message);
		});

		lobby.onMessage(LobbyServerMessageType.Notice, (notice: NoticePayload) =>
		{
			this.onNotice(notice.reason);
		});

		lobby.onLeave(() =>
		{
			this.player = null;
			void this.syncGroup();
			showStatus('Disconnected from the server. Reload the page to reconnect.');
		});
	}

	/**
	 * Shows the screen for the player, and moves the window into or out of their group
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
			this.lobbyScreen.show(player.playerId, player.name);
			showScreen('lobby');
		}

		if (player && !wasLoggedIn)
		{
			this.followJoinLink(player);
		}

		if (player && (player.groupId !== null) && (player.groupId === this.linkGroupId))
		{
			this.finishJoinLink();
		}

		void this.syncGroup();
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

		this.server.lobby.send(LobbyMessageType.JoinGroup, join);
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
		}
	}

	/**
	 * Leaves and joins group rooms until the window is in the player's group, or in none when they are in the lobby
	 *
	 * The player can change group again while a room is being joined, so this repeats until it catches up
	 */
	private async syncGroup(): Promise<void>
	{
		if (this.syncingGroup)
		{
			return;
		}

		this.syncingGroup = true;

		try
		{
			for (let wanted = this.wantedGroupId(); wanted !== this.joinedGroup?.groupId; wanted = this.wantedGroupId())
			{
				if (this.joinedGroup)
				{
					await this.leaveGroupRoom();
				}
				else if (wanted !== undefined)
				{
					await this.joinGroupRoom(wanted);
				}
			}
		}
		finally
		{
			this.syncingGroup = false;
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
	 * Joins a group's room and shows it
	 *
	 * If the room can't be joined, asks the lobby to take the player out of the group, so that every
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
			this.server.lobby.send(LobbyMessageType.LeaveGroup);
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
	 * the lobby's Account message moves this window too. Any other close means the room failed, so the
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

		this.server.lobby.send(LobbyMessageType.LeaveGroup);
	}
}
