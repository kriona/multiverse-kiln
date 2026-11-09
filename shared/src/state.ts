/**
 * State the server synchronizes to clients in the rooms
 *
 * The server mutates it and Colyseus sends the changes; the client only reads it. Shared so both sides
 * use the same classes. Only what clients need to render goes here; server-only data (such as queued
 * inputs) stays on the room
 */
import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * A player in a room's areas, keyed by player ID in the room's players
 *
 * Every window of the same browser controls the same player. The player ID is public and is not
 * the browser's ID, which stays on the server. In a lobby, name is the character's being played, and a
 * player playing none is a ghost: only their own windows see them, and their name is empty
 */
export const Player = schema({
	x: t.number(),
	y: t.number(),
	name: t.string(),
	ghost: t.boolean(),

	/**
	 * How many squares the character sees in the dark (darkvisionSquares), and whether bright light
	 * dazzles them, which the client's fog follows (see visionBudget)
	 */
	darkvision: t.number(),
	lightSensitivity: t.boolean()
}, 'Player');
export type Player = SchemaType<typeof Player>;

/**
 * A character in a group, keyed by character ID in GameState.members
 */
export const GroupMember = schema({
	name: t.string(),

	/**
	 * The character's player, so a window knows which members it can control
	 */
	playerId: t.string(),

	/**
	 * Whether the character is in the room: their player has a window in it. Links that need the whole
	 * group can't be taken while any member isn't
	 */
	present: t.boolean()
}, 'GroupMember');
export type GroupMember = SchemaType<typeof GroupMember>;

/**
 * Root state of a group's game room
 *
 * players holds each member who is present, keyed by character ID. A client sees only the players in
 * the same area as the character it controls: the server adds each one to the client's view (StateView)
 * as they enter the area and removes them as they leave it. members lists every member, present or not
 */
export const GameState = schema({
	players: t.map(Player).view(),

	/**
	 * The group's name; empty when it has none
	 */
	name: t.string(),

	/**
	 * The anchor being's character ID
	 */
	anchorId: t.string(),

	members: t.map(GroupMember),

	/**
	 * The group's game clock: seconds of game time since its world began. Areas whose time flows
	 * normally take their time of day from it (see secondOfDay)
	 */
	clock: t.number(),

	/**
	 * Whether the universe has reached the end of time: the group can look at its area, but nothing in
	 * the game changes, so the room refuses moving and links
	 */
	locked: t.boolean()
}, 'GameState');
export type GameState = SchemaType<typeof GameState>;

/**
 * A player in a universe's lobby playing a character, keyed by player ID in LobbyState.members; name
 * is the character's. Ghosts aren't members
 */
export const LobbyMember = schema({
	name: t.string()
}, 'LobbyMember');
export type LobbyMember = SchemaType<typeof LobbyMember>;

/**
 * Root state of a universe's lobby room
 *
 * players works as in GameState: a client sees only the players in its own player's area, and never
 * another player's ghost. members lists everyone in the lobby playing a character, whichever area they
 * are in, and whether or not the lobby has an area
 */
export const LobbyState = schema({
	players: t.map(Player).view(),
	members: t.map(LobbyMember),

	/**
	 * Whether the lobby has an area to walk around: its universe has a lobby area, and it is enabled.
	 * Without one, players is empty, and players only chat and choose their characters
	 */
	hasArea: t.boolean()
}, 'LobbyState');
export type LobbyState = SchemaType<typeof LobbyState>;

/**
 * What one window with a universe's editor open has open, keyed in EditorPresence.windows by a number
 * the room gives each window
 */
export const EditorWindow = schema({
	/**
	 * The version of the universe open (UniverseVersionName)
	 */
	version: t.string(),

	/**
	 * The tab showing (EditorTab)
	 */
	tab: t.string(),

	/**
	 * The area open in the area editor, or empty when none is
	 */
	areaId: t.string(),

	/**
	 * Whether the window holds work not yet saved, which applying or discarding the draft would leave it
	 * unable to save when the draft is open
	 */
	unsaved: t.boolean()
}, 'EditorWindow');
export type EditorWindow = SchemaType<typeof EditorWindow>;

/**
 * A player with a universe's editor open, keyed by player ID in EditorState.editors, however many
 * windows they have open
 */
export const EditorPresence = schema({
	/**
	 * The player's display name and username
	 */
	name: t.string(),
	username: t.string(),

	/**
	 * Their role in the editor (EditorRole), the site admin role included
	 */
	role: t.string(),

	windows: t.map(EditorWindow)
}, 'EditorPresence');
export type EditorPresence = SchemaType<typeof EditorPresence>;

/**
 * Root state of a universe's editor room: who has the editor open
 */
export const EditorState = schema({
	editors: t.map(EditorPresence)
}, 'EditorState');
export type EditorState = SchemaType<typeof EditorState>;
