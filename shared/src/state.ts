/**
 * State the server synchronizes to clients in the rooms
 *
 * The server mutates it and Colyseus sends the changes; the client only reads it. Shared so both sides
 * use the same classes. Only what clients need to render goes here; server-only data (such as queued
 * inputs) stays on the room
 */
import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * A player on a room's map, keyed by player ID in the room's players
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
 * Root state of a group's game room
 *
 * A client sees only the players in the same zone as its own player: the server adds each one to the
 * client's view (StateView) as they enter the zone and removes them as they leave it
 */
export const GameState = schema({
	players: t.map(Player).view()
}, 'GameState');
export type GameState = SchemaType<typeof GameState>;

/**
 * A player in a universe's lobby, keyed by player ID in LobbyState.members
 */
export const LobbyMember = schema({
	name: t.string()
}, 'LobbyMember');
export type LobbyMember = SchemaType<typeof LobbyMember>;

/**
 * Root state of a universe's lobby room
 *
 * players works as in GameState: a client sees only the players in its own player's zone. members
 * lists everyone in the lobby, whichever zone they are in
 */
export const LobbyState = schema({
	players: t.map(Player).view(),
	members: t.map(LobbyMember)
}, 'LobbyState');
export type LobbyState = SchemaType<typeof LobbyState>;
