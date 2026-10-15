/**
 * Message types clients send to the game room
 *
 * Clients send inputs, never state (positions, health, scores): the server decides the outcome
 */
export enum MessageType
{
	/**
	 * The direction the player wants to move in, sent whenever it changes (payload: MovePayload)
	 */
	Move = 'move'
}

/**
 * Message types the game room sends to clients, for one-off events rather than state
 */
export enum ServerMessageType
{
	/**
	 * Sent to each client as it joins: which player in GameState.players it controls (payload: WelcomePayload)
	 */
	Welcome = 'welcome'
}

/**
 * One axis of movement: -1 (left or up), 0 (none) or 1 (right or down)
 */
export type Direction = -1 | 0 | 1;

/**
 * Payload of MessageType.Move: the direction held on each axis, which applies until the next Move
 */
export interface MovePayload
{
	x: Direction;
	y: Direction;
}

/**
 * Payload of ServerMessageType.Welcome
 */
export interface WelcomePayload
{
	/**
	 * Key of the client's own player in GameState.players. Windows of the same browser share one player
	 */
	playerId: string;
}

/**
 * Message types clients send to the lobby room
 */
export enum LobbyMessageType
{
	/**
	 * Log in with a name; every window of the browser is logged in (payload: LoginPayload)
	 */
	Login = 'login',

	/**
	 * Say something in the lobby chat (payload: ChatPayload)
	 */
	Chat = 'chat',

	/**
	 * Create a new group and move the player into it (no payload)
	 */
	CreateGroup = 'createGroup',

	/**
	 * Move the player into an existing group, from a join link (payload: JoinGroupPayload)
	 */
	JoinGroup = 'joinGroup',

	/**
	 * Take the player out of their group, back to the lobby (no payload)
	 */
	LeaveGroup = 'leaveGroup'
}

/**
 * Message types the lobby room sends to clients
 */
export enum LobbyServerMessageType
{
	/**
	 * Who the window's player is and which group they are in, sent on joining the lobby and whenever it changes (payload: AccountPayload)
	 */
	Account = 'account',

	/**
	 * Recent chat, sent to a window when its player logs in or it joins already logged in (payload: ChatHistoryPayload)
	 */
	ChatHistory = 'chatHistory',

	/**
	 * A new chat message, sent to every logged-in window (payload: ChatMessage)
	 */
	Chat = 'chat',

	/**
	 * Something the player asked for didn't happen (payload: NoticePayload)
	 */
	Notice = 'notice'
}

/**
 * Payload of LobbyMessageType.Login
 */
export interface LoginPayload
{
	name: string;
}

/**
 * Payload of LobbyMessageType.Chat
 */
export interface ChatPayload
{
	text: string;
}

/**
 * Payload of LobbyMessageType.JoinGroup
 */
export interface JoinGroupPayload
{
	groupId: string;
}

/**
 * A logged-in player, as their own windows see them
 */
export interface AccountPlayer
{
	/**
	 * Public ID of the player: the key in LobbyState.players and GameState.players
	 */
	playerId: string;

	name: string;

	/**
	 * ID of the player's group (the game room's ID), or null when they are in the lobby
	 */
	groupId: string | null;
}

/**
 * Payload of LobbyServerMessageType.Account
 */
export interface AccountPayload
{
	/**
	 * The window's player, or null when the browser isn't logged in
	 */
	player: AccountPlayer | null;
}

/**
 * One lobby chat message
 */
export interface ChatMessage
{
	playerId: string;

	/**
	 * The sender's name when they sent it
	 */
	name: string;

	text: string;

	/**
	 * When the server received it, in milliseconds since the epoch
	 */
	sentAt: number;
}

/**
 * Payload of LobbyServerMessageType.ChatHistory: the most recent messages, oldest first
 */
export interface ChatHistoryPayload
{
	messages: ChatMessage[];
}

/**
 * Why a request to the lobby was turned down
 */
export enum NoticeReason
{
	/**
	 * The group in a join link doesn't exist (any more)
	 */
	GroupNotFound = 'groupNotFound',

	/**
	 * The group in a join link already has MAX_GROUP_PLAYERS players
	 */
	GroupFull = 'groupFull',

	/**
	 * The player sent chat messages faster than the lobby allows; the message was dropped
	 */
	ChatTooFast = 'chatTooFast'
}

/**
 * Payload of LobbyServerMessageType.Notice
 */
export interface NoticePayload
{
	reason: NoticeReason;
}
