/**
 * Name of the main game room, registered on the server and joined by the client
 */
export const GAME_ROOM_NAME = 'game';

/**
 * Default port the Colyseus server listens on
 */
export const DEFAULT_SERVER_PORT = 2567;

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
 * Milliseconds between the state patches the server sends to clients
 *
 * Colyseus's default, set explicitly on the room so the client's interpolation can rely on it
 */
export const PATCH_INTERVAL_MS = 50;
