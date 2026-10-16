import type { MapBounds } from './maps.js';
import type { Ruleset, ZoneLinkMode } from './universes.js';

/**
 * Message types clients send to the rooms with a map: a universe's lobby and a group's game room
 *
 * Clients send inputs, never state (positions, health, scores): the server decides the outcome
 */
export enum MessageType
{
	/**
	 * The direction the player wants to move in, sent whenever it changes (payload: MovePayload)
	 */
	Move = 'move',

	/**
	 * Take the manual zone link on the cell the player is standing on (no payload)
	 */
	TakeLink = 'takeLink'
}

/**
 * Message types the rooms with a map send to clients, for one-off events rather than state
 */
export enum ServerMessageType
{
	/**
	 * Sent to each client as it joins: which player in state.players it controls (payload: WelcomePayload)
	 */
	Welcome = 'welcome',

	/**
	 * The zone the client's player is in, sent on joining, whenever the player moves to another zone,
	 * and again when an editor changes the zone's settings, bounds or links (payload: ZonePayload)
	 */
	Zone = 'zone',

	/**
	 * Chunks of the zone's map that the player has come near, or that an editor has changed (payload: ChunksPayload)
	 */
	Chunks = 'chunks'
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
	 * Key of the client's own player in state.players. Windows of the same browser share one player
	 */
	playerId: string;
}

/**
 * A tile a zone's map can use, as the client draws it
 */
export interface ZoneTile
{
	id: number;
	name: string;

	/**
	 * 0xRRGGBB
	 */
	color: number;
}

/**
 * One stored chunk of a zone's map
 */
export interface ZoneChunk
{
	chunkColumn: number;
	chunkRow: number;

	/**
	 * CHUNK_SIZE * CHUNK_SIZE cell values, row by row: a tile ID, DEFAULT_TILE_CELL or VOID_CELL
	 */
	cells: number[];
}

/**
 * A chunk of a zone's map, as sent when the player comes near it or an editor changes it
 */
export interface ZoneChunkUpdate
{
	chunkColumn: number;
	chunkRow: number;

	/**
	 * CHUNK_SIZE * CHUNK_SIZE cell values, row by row, or null when every cell is the zone's default tile
	 */
	cells: number[] | null;
}

/**
 * Payload of ServerMessageType.Chunks
 */
export interface ChunksPayload
{
	/**
	 * The zone the chunks belong to; a client whose player has since moved to another zone ignores them
	 */
	zoneId: string;

	chunks: ZoneChunkUpdate[];
}

/**
 * A cell with a zone link, as the client sees it: where the link goes stays on the server
 */
export interface ZoneLinkCell
{
	column: number;
	row: number;
	mode: ZoneLinkMode;
}

/**
 * Payload of ServerMessageType.Zone: everything needed to draw a zone's map, with the stored chunks
 * near the player. Chunks further away arrive in ChunksPayloads as the player comes near them
 */
export interface ZonePayload
{
	zoneId: string;
	name: string;
	indoors: boolean;
	bounds: MapBounds;
	loopsEastWest: boolean;
	loopsNorthSouth: boolean;

	/**
	 * Tile of every cell holding DEFAULT_TILE_CELL, including every cell of a chunk that isn't listed
	 */
	defaultTileId: number;

	tiles: ZoneTile[];
	chunks: ZoneChunk[];
	links: ZoneLinkCell[];
}

/**
 * Message types clients send to the session room
 */
export enum SessionMessageType
{
	/**
	 * Log in with a name; every window of the browser is logged in (payload: LoginPayload)
	 */
	Login = 'login',

	/**
	 * Move the player into an existing group, from a join link (payload: JoinGroupPayload)
	 */
	JoinGroup = 'joinGroup',

	/**
	 * Take the player out of their group (no payload)
	 */
	LeaveGroup = 'leaveGroup'
}

/**
 * Message types the session room sends to clients
 */
export enum SessionServerMessageType
{
	/**
	 * Who the window's player is and which group they are in, sent on joining and whenever it changes (payload: AccountPayload)
	 */
	Account = 'account',

	/**
	 * Something the player asked for didn't happen (payload: NoticePayload)
	 */
	Notice = 'notice'
}

/**
 * Message types clients send to a universe's lobby room
 */
export enum LobbyMessageType
{
	/**
	 * Say something in the lobby chat (payload: ChatPayload)
	 */
	Chat = 'chat',

	/**
	 * Create a new group in this universe and move the player into it (no payload)
	 */
	CreateGroup = 'createGroup'
}

/**
 * Message types a universe's lobby room sends to clients
 */
export enum LobbyServerMessageType
{
	/**
	 * Recent chat, sent to a window as it joins (payload: ChatHistoryPayload)
	 */
	ChatHistory = 'chatHistory',

	/**
	 * A new chat message, sent to every window in the lobby (payload: ChatMessage)
	 */
	Chat = 'chat',

	/**
	 * Something the player asked for didn't happen (payload: NoticePayload)
	 */
	Notice = 'notice'
}

/**
 * Options a client joins a universe's lobby with
 */
export interface LobbyJoinOptions
{
	universeId: string;
}

/**
 * Payload of SessionMessageType.Login
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
 * Payload of SessionMessageType.JoinGroup
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
	 * Public ID of the player: their key in LobbyState and GameState
	 */
	playerId: string;

	name: string;

	/**
	 * ID of the player's group (the game room's ID), or null when they aren't in one
	 */
	groupId: string | null;
}

/**
 * Payload of SessionServerMessageType.Account
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
 * Why a request to the session or a lobby was turned down
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
	 * The server couldn't create a group
	 */
	GroupNotCreated = 'groupNotCreated',

	/**
	 * The player sent chat messages faster than the lobby allows; the message was dropped
	 */
	ChatTooFast = 'chatTooFast',

	/**
	 * The player with that name is already logged in from another browser
	 */
	NameInUse = 'nameInUse',

	/**
	 * The server couldn't load or create the player, so the browser wasn't logged in
	 */
	LoginFailed = 'loginFailed'
}

/**
 * Payload of SessionServerMessageType.Notice and LobbyServerMessageType.Notice
 */
export interface NoticePayload
{
	reason: NoticeReason;
}

/**
 * A universe as Home lists it (GET UNIVERSES_PATH)
 */
export interface UniverseSummary
{
	id: string;
	name: string;
	shortDescription: string;
	ruleset: Ruleset;
}

/**
 * A universe as Home's overview of it shows it (GET UNIVERSES_PATH/:id)
 */
export interface UniverseDetails extends UniverseSummary
{
	/**
	 * Markdown
	 */
	longDescription: string;
}

/**
 * Response of GET UNIVERSES_PATH
 */
export interface UniverseListPayload
{
	universes: UniverseSummary[];

	/**
	 * Whether there are more universes after these
	 */
	hasMore: boolean;
}
