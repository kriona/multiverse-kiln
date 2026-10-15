/**
 * State the server synchronizes to every client in a game room
 *
 * The server mutates it and Colyseus sends the changes; the client only reads it. Shared so both sides
 * use the same classes. Only what clients need to render goes here; server-only data (such as queued
 * inputs) stays on the room
 */
import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * A player in the room, keyed by session ID in GameState.players
 */
export const Player = schema({
	x: t.number(),
	y: t.number()
}, 'Player');
export type Player = SchemaType<typeof Player>;

/**
 * Root state of a game room
 */
export const GameState = schema({
	players: t.map(Player)
}, 'GameState');
export type GameState = SchemaType<typeof GameState>;
