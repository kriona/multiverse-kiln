/**
 * State the server synchronizes to every client in a game room
 *
 * The server mutates it and Colyseus sends the changes; the client only reads it. Shared so both sides
 * use the same classes. Only what clients need to render goes here; server-only data (such as queued
 * inputs) stays on the room
 */
import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * A player in the room, keyed by player ID in GameState.players
 *
 * Every window of the same browser controls the same player. The player ID is public and is not
 * the browser's ID, which stays on the server
 */
export const Player = schema({
	x: t.number(),
	y: t.number(),
	name: t.string()
}, 'Player');
export type Player = SchemaType<typeof Player>;

/**
 * Root state of a game room
 */
export const GameState = schema({
	players: t.map(Player)
}, 'GameState');
export type GameState = SchemaType<typeof GameState>;

/**
 * A logged-in player, keyed by player ID in LobbyState.players
 */
export const OnlinePlayer = schema({
	name: t.string()
}, 'OnlinePlayer');
export type OnlinePlayer = SchemaType<typeof OnlinePlayer>;

/**
 * Root state of the lobby room
 *
 * Windows that haven't logged in see none of it: players is only added to a window's view once its browser logs in
 */
export const LobbyState = schema({
	players: t.map(OnlinePlayer).view()
}, 'LobbyState');
export type LobbyState = SchemaType<typeof LobbyState>;
