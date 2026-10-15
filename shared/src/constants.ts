/**
 * Name of the game room, registered on the server; each group of players plays in one
 *
 * Only the lobby creates game rooms, and a client can join one only after the lobby has put its player in that group
 */
export const GAME_ROOM_NAME = 'game';

/**
 * Name of the lobby room, which every logged-in player is in: login, chat, who's online, and creating and joining groups
 *
 * Every window stays connected to it for as long as it is open, even while its player is in a group
 */
export const LOBBY_ROOM_NAME = 'lobby';

/**
 * Most players in one group
 */
export const MAX_GROUP_PLAYERS = 6;

/**
 * Most characters in a player's name
 */
export const MAX_PLAYER_NAME_LENGTH = 20;

/**
 * Most characters in one lobby chat message
 */
export const MAX_CHAT_MESSAGE_LENGTH = 500;

/**
 * Characters not allowed in names and chat: control characters, and the bidirectional marks, overrides
 * and isolates that can make text display out of order
 */
export const DISALLOWED_TEXT_CHARACTERS = /[\p{Cc}\p{Bidi_Control}]/u;

/**
 * Query string parameter of a join link that holds the group's ID
 */
export const GROUP_QUERY_PARAMETER = 'group';

/**
 * Default port the Colyseus server listens on
 */
export const DEFAULT_SERVER_PORT = 2567;

/**
 * Server route the client POSTs to before joining, to get a browser ID cookie
 *
 * Every window of the same browser sends the cookie when it joins a room, so they all control the same player
 */
export const BROWSER_ID_PATH = '/browser-id';

/**
 * Width of the game world in world units; the server keeps players inside it
 */
export const WORLD_WIDTH = 960;

/**
 * Height of the game world in world units; the server keeps players inside it
 */
export const WORLD_HEIGHT = 540;

/**
 * Radius of a player in world units; the server keeps the whole player inside the world
 */
export const PLAYER_RADIUS = 12;

/**
 * Size of one grid cell in world units
 *
 * Players move from cell center to cell center and always stop on one. A cell is a little wider than a
 * player, and the world's width and height are whole numbers of cells (32 x 18)
 */
export const GRID_CELL_SIZE = 30;

/**
 * Milliseconds between the state patches the server sends to clients
 *
 * Colyseus's default, set explicitly on the room so the client's interpolation can rely on it
 */
export const PATCH_INTERVAL_MS = 50;
