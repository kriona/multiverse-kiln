import type { MapBounds } from './maps.js';
import type { AreaTime } from './time.js';
import type { DisplayTime, Ruleset, AreaLightLevel, AreaLinkMode } from './universes.js';

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
	 * Take the manual area link on the cell the player is standing on (no payload)
	 */
	TakeLink = 'takeLink'
}

/**
 * Message types the rooms with a map send to clients, for one-off events rather than state
 */
export enum ServerMessageType
{
	/**
	 * Sent to each client as it joins, and in a group's room whenever the window controls another
	 * character: which player in state.players it controls (payload: WelcomePayload)
	 */
	Welcome = 'welcome',

	/**
	 * The area the client's player is in, sent on joining, whenever the player moves to another area,
	 * and again when an editor changes the area's settings, bounds or links (payload: AreaPayload)
	 */
	Area = 'area',

	/**
	 * Chunks of the area's map that the player has come near, or that an editor has changed (payload: ChunksPayload)
	 */
	Chunks = 'chunks'
}

/**
 * Message types clients send to a group's game room
 */
export enum GameMessageType
{
	/**
	 * Control another of the player's characters in the group, in this window only
	 * (payload: ControlPayload). The room answers with Welcome and Area, as on joining
	 */
	Control = 'control'
}

/**
 * Message types a group's game room sends to clients
 */
export enum GameServerMessageType
{
	/**
	 * Something the player asked for didn't happen (payload: NoticePayload)
	 */
	Notice = 'notice',

	/**
	 * The group has seen cells of the client's area for the first time: their tiles, which were sent as
	 * UNSEEN_CELL until now (payload: CellsSeenPayload)
	 */
	CellsSeen = 'cellsSeen'
}

/**
 * A cell of an area's map and what it holds
 */
export interface CellValue
{
	column: number;
	row: number;

	/**
	 * A tile ID, DEFAULT_TILE_CELL or VOID_CELL
	 */
	value: number;
}

/**
 * Payload of GameServerMessageType.CellsSeen
 */
export interface CellsSeenPayload
{
	/**
	 * The area the cells belong to; a client whose player has since moved to another area ignores them
	 */
	areaId: string;

	/**
	 * The cells, leaving out those in chunks not yet loaded on the server, which arrive with their chunk
	 */
	cells: CellValue[];

	/**
	 * The links on the cells
	 */
	links: AreaLinkCell[];
}

/**
 * Options a client joins a group's game room with
 */
export interface GameJoinOptions
{
	groupId: string;

	/**
	 * The character the window controls: one of the player's characters in the group
	 */
	characterId: string;
}

/**
 * Payload of GameMessageType.Control
 */
export interface ControlPayload
{
	/**
	 * One of the player's characters in the group
	 */
	characterId: string;
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
	 * Key of the client's own player in state.players. In a lobby it is the player's ID, shared by every
	 * window of the browser; in a group's room it is the ID of the character the window controls
	 */
	playerId: string;
}

/**
 * A tile an area's map can use, as the client draws it
 */
export interface AreaTile
{
	id: number;

	/**
	 * The default tile's key (DEFAULT_TILE_NAMES), when name is null
	 */
	key: string | null;

	/**
	 * The universe's name for the tile, or null for a default tile's name, which the client shows in
	 * the player's language from key
	 */
	name: string | null;

	/**
	 * 0xRRGGBB, drawn when the tile has no graphic
	 */
	color: number;

	/**
	 * The graphic the tile is drawn with (TILE_GRAPHICS), or null to draw it in its color
	 */
	graphic: string | null;

	/**
	 * Whether the tile can't be entered (IMPASSABLE_WALK_SECONDS). No player stands on it, so its graphic
	 * is drawn over the players next to it too, such as a mountain's peaks over a player north of it
	 */
	impassable: boolean;

	/**
	 * How hard the tile is to see past, in percent, which the client's fog follows (see VisionMap)
	 */
	visionCost: number;
}

/**
 * One stored chunk of an area's map
 */
export interface AreaChunk
{
	chunkColumn: number;
	chunkRow: number;

	/**
	 * CHUNK_SIZE * CHUNK_SIZE cell values, row by row: a tile ID, DEFAULT_TILE_CELL or VOID_CELL
	 */
	cells: number[];
}

/**
 * A chunk of an area's map, as sent when the player comes near it or an editor changes it
 */
export interface AreaChunkUpdate
{
	chunkColumn: number;
	chunkRow: number;

	/**
	 * CHUNK_SIZE * CHUNK_SIZE cell values, row by row, or null when every cell is the area's default tile
	 */
	cells: number[] | null;
}

/**
 * Payload of ServerMessageType.Chunks
 */
export interface ChunksPayload
{
	/**
	 * The area the chunks belong to; a client whose player has since moved to another area ignores them
	 */
	areaId: string;

	chunks: AreaChunkUpdate[];
}

/**
 * A cell with an area link, as the client sees it: where the link goes stays on the server
 */
export interface AreaLinkCell
{
	column: number;
	row: number;
	mode: AreaLinkMode;
}

/**
 * Payload of ServerMessageType.Area: everything needed to draw an area's map, with the stored chunks
 * near the player. Chunks further away arrive in ChunksPayloads as the player comes near them
 */
export interface AreaPayload
{
	areaId: string;
	name: string;

	/**
	 * The universe's ruleset, which names its default tiles
	 */
	ruleset: Ruleset;

	indoors: boolean;

	/**
	 * How the area's time of day is worked out, with the room's clock (GameState.clock) when time flows
	 * normally
	 */
	time: AreaTime;

	/**
	 * How the universe shows players the time of day
	 */
	displayTime: DisplayTime;

	/**
	 * How light an indoor area is at any time of day, or null for an outdoor area, which follows the time of day (see areaLight)
	 */
	lightLevel: AreaLightLevel | null;

	/**
	 * Whether everyone sees DAY_VISION_SQUARES whatever the time of day: a lobby whose universe gives it
	 * no vision cost, whose tiles have none either
	 */
	fullVision: boolean;

	bounds: MapBounds;
	loopsEastWest: boolean;
	loopsNorthSouth: boolean;

	/**
	 * Tile of every cell holding DEFAULT_TILE_CELL, including every cell of a chunk that isn't listed
	 */
	defaultTileId: number;

	tiles: AreaTile[];

	/**
	 * In a group's room, every cell the group hasn't seen holds UNSEEN_CELL, and links on them are left
	 * out; they arrive as GameServerMessageType.CellsSeen once the group sees them
	 */
	chunks: AreaChunk[];

	links: AreaLinkCell[];
}

/**
 * Message types clients send to the session room
 */
export enum SessionMessageType
{
	/**
	 * Log in with a name; every window of the browser is logged in (payload: LoginPayload)
	 */
	Login = 'login'
}

/**
 * Message types the session room sends to clients
 */
export enum SessionServerMessageType
{
	/**
	 * Who the window's player is, sent on joining and whenever it changes (payload: AccountPayload)
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
	 * Play one of the player's characters in this universe who isn't in a group, in every window of the
	 * player in the lobby (payload: ChooseCharacterPayload)
	 */
	ChooseCharacter = 'chooseCharacter'
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
	 * Which character the player is playing, sent to a window as it joins and to every window of the
	 * player when it changes (payload: PlayingAsPayload)
	 */
	PlayingAs = 'playingAs',

	/**
	 * The player's characters in the universe changed (one was deleted, given their last rites or
	 * restored), so their windows list them again (no payload)
	 */
	CharactersChanged = 'charactersChanged',

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
 * Payload of LobbyMessageType.ChooseCharacter
 */
export interface ChooseCharacterPayload
{
	/**
	 * One of the player's characters in the lobby's universe
	 */
	characterId: string;
}

/**
 * Payload of LobbyServerMessageType.PlayingAs
 */
export interface PlayingAsPayload
{
	/**
	 * The character the player is playing, or null while they are a ghost: unseen by others, holding no
	 * cell, and unable to chat
	 */
	characterId: string | null;
}

/**
 * A logged-in player, as their own windows see them
 */
export interface AccountPlayer
{
	/**
	 * Public ID of the player: their key in LobbyState, and GroupMember.playerId in GameState
	 */
	playerId: string;

	name: string;
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
	 * The sender's name when they sent it: in a lobby, their character's
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
 * Why a request to the session, a lobby or a group's room was turned down
 */
export enum NoticeReason
{
	/**
	 * The link the character stands on needs the whole group, and a member isn't here: their player
	 * isn't playing, they are in another area, or they are on their way somewhere
	 */
	GroupNotTogether = 'groupNotTogether',

	/**
	 * The player sent chat messages faster than the lobby allows; the message was dropped
	 */
	ChatTooFast = 'chatTooFast',

	/**
	 * The player with that name is already logged in from another browser
	 */
	NameInUse = 'nameInUse',

	/**
	 * The name could pass as the game's staff (isReservedName), so the browser wasn't logged in
	 */
	NameReserved = 'nameReserved',

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

	/**
	 * The name in the form its page's address uses (universeSlug)
	 */
	slug: string;

	shortDescription: string;
	ruleset: Ruleset;
}

/**
 * A universe as its page shows it (GET UNIVERSES_PATH/:key, by ID or slug)
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
