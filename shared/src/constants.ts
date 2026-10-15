/**
 * Name of the main game room, registered on the server and joined by the client
 */
export const GAME_ROOM_NAME = 'game';

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
