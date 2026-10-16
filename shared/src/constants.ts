/**
 * Name of the game room, registered on the server; each group of players plays in one
 *
 * Only a lobby creates game rooms, and a client can join one only after its player has been put in that group
 */
export const GAME_ROOM_NAME = 'game';

/**
 * Name of the session room: logging in, who the player is, and joining and leaving groups
 *
 * There is one, and every window stays connected to it for as long as it is open, wherever its player is
 */
export const SESSION_ROOM_NAME = 'session';

/**
 * Name of a universe's lobby room: its map, chat, who's here, and creating groups
 *
 * Clients join with LobbyJoinOptions, and every client of the same universe joins the same lobby
 */
export const LOBBY_ROOM_NAME = 'lobby';

/**
 * Server route listing the universes Home shows (GET, answered with UniverseListPayload)
 *
 * Takes optional `offset` and `limit` query parameters; limit is at most MAX_UNIVERSES_PER_PAGE
 */
export const UNIVERSES_PATH = '/universes';

/**
 * Most universes GET UNIVERSES_PATH returns at once
 */
export const MAX_UNIVERSES_PER_PAGE = 100;

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
 * Width of the client's view of the map, in pixels (one world unit is one pixel): 32 cells
 */
export const VIEW_WIDTH = 960;

/**
 * Height of the client's view of the map, in pixels (one world unit is one pixel): 18 cells
 */
export const VIEW_HEIGHT = 540;

/**
 * Radius of a player in world units
 */
export const PLAYER_RADIUS = 12;

/**
 * Size of one grid cell in world units
 *
 * Players move from cell center to cell center and always stop on one. A cell is a little wider than a
 * player, so a player on a cell center is entirely inside the cell
 */
export const GRID_CELL_SIZE = 30;

/**
 * Milliseconds between the state patches the server sends to clients
 *
 * Colyseus's default, set explicitly on the room so the client's interpolation can rely on it
 */
export const PATCH_INTERVAL_MS = 50;
