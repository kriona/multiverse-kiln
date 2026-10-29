/**
 * The game engine's name, the same in every language. Pages show it as %SITE_NAME% (client/vite.config.ts)
 */
export const SITE_NAME = 'Multiverse Kiln';

/**
 * Name of the game room, registered on the server; each group plays in one
 *
 * Clients join with GameJoinOptions, and every client asking for the same group joins the same room,
 * which is made from the database when the first of them arrives. A client is admitted only to play one
 * of its player's characters in the group
 */
export const GAME_ROOM_NAME = 'game';

/**
 * Name of the session room: logging in and who the player is
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
 * Takes optional `offset` and `limit` query parameters; limit is at most MAX_UNIVERSES_PER_PAGE.
 * GET UNIVERSES_PATH/:id answers with one of them as UniverseDetails
 */
export const UNIVERSES_PATH = '/universes';

/**
 * Most universes GET UNIVERSES_PATH returns at once
 */
export const MAX_UNIVERSES_PER_PAGE = 100;

/**
 * Most characters in one group; each universe sets its own group size up to it
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
 * Default port the Colyseus server listens on
 */
export const DEFAULT_SERVER_PORT = 2567;

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
export const GRID_CELL_SIZE = 32;

/**
 * How many cells across the client's view of the map is
 *
 * The camera centers on the player, who stands on a cell's center, so an odd number of cells puts the
 * view's edges on cell boundaries: a standing player sees only whole tiles
 */
export const VIEW_COLUMNS = 31;

/**
 * How many cells tall the client's view of the map is; odd for the same reason as VIEW_COLUMNS
 */
export const VIEW_ROWS = 17;

/**
 * Width of the client's view of the map, in pixels (one world unit is one pixel)
 */
export const VIEW_WIDTH = VIEW_COLUMNS * GRID_CELL_SIZE;

/**
 * Height of the client's view of the map, in pixels
 */
export const VIEW_HEIGHT = VIEW_ROWS * GRID_CELL_SIZE;

/**
 * Milliseconds between the state patches the server sends to clients
 *
 * Colyseus's default, set explicitly on the room so the client's interpolation can rely on it
 */
export const PATCH_INTERVAL_MS = 50;
