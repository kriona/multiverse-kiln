/**
 * The editor room: one per universe, joined by every window with its editor open, which says who has the
 * editor open and what each window has open, carries the editors' chat, and tells each window what the
 * others save (see Editing together in STRUCTURE-OVERVIEW.md)
 */
import type { UniverseEditDetail, UniverseVersionName } from './editor.js';

/**
 * The names of the editor's tabs. The page's tab list decides the order they are shown in
 */
export const EDITOR_TABS = [
	'areas',
	'audit',
	'characterList',
	'characters',
	'editors',
	'items',
	'lobby',
	'ruleset',
	'tilesets',
	'translations',
	'universe'
] as const;

export type EditorTab = typeof EDITOR_TABS[number];

/**
 * Message types clients send to a universe's editor room
 */
export enum EditorMessageType
{
	/**
	 * What the window has open, sent on joining and whenever it changes (payload: EditorPlacePayload)
	 */
	Place = 'place',

	/**
	 * Say something in the editors' chat (payload: ChatPayload)
	 */
	Chat = 'chat',

	/**
	 * The player has seen the editors' chat up to a message, sent as the chat is seen with newer
	 * messages in it (payload: ChatReadPayload)
	 */
	ChatRead = 'chatRead'
}

/**
 * Message types a universe's editor room sends to clients
 */
export enum EditorServerMessageType
{
	/**
	 * The chat's kept messages, sent to a window as it joins (payload: KeptChatHistoryPayload)
	 */
	ChatHistory = 'chatHistory',

	/**
	 * A new chat message, sent to every window in the room (payload: KeptChatMessage)
	 */
	Chat = 'chat',

	/**
	 * A player who wrote messages in the chat deleted their account (payload: ChatAuthorDeletedPayload)
	 */
	ChatAuthorDeleted = 'chatAuthorDeleted',

	/**
	 * The player has seen the editors' chat up to a message in another of their windows, which counts
	 * the messages before it as read too (payload: ChatReadPayload)
	 */
	ChatRead = 'chatRead',

	/**
	 * What the player may do in the editor may have changed: their role, the universe's stage, or whether
	 * the site's admins have disabled it. The window loads the universe again (no payload)
	 */
	AccessChanged = 'accessChanged',

	/**
	 * Someone saved changes from another window (payload: EditorSavedPayload)
	 */
	Saved = 'saved',

	/**
	 * Something the player asked for didn't happen (payload: NoticePayload)
	 */
	Notice = 'notice'
}

/**
 * Payload of EditorServerMessageType.Saved: a save made in another window, sent to each window it
 * concerns once it has committed
 */
export interface EditorSavedPayload
{
	/**
	 * Who saved, with their display name and username
	 */
	playerId: string;
	name: string;
	username: string;

	/**
	 * The version the save changed
	 */
	version: UniverseVersionName;

	/**
	 * What it changed that the window shows, as the Audit tab lists it: what the tabs its player's role
	 * sees show, all of it for a window with the same version open, and only what the universe holds once
	 * (its editors, its stage and its draft) for a window with the other version open. Empty when it
	 * changed nothing the window shows, which still hears of it for the Audit tab, which lists the saves
	 * of both versions
	 */
	details: SavedEditDetail[];
}

/**
 * One thing a save changed, as the Audit tab lists it, with the ID the editor finds it by on its tabs
 */
export interface SavedEditDetail extends UniverseEditDetail
{
	/**
	 * The ID of the tile, item, race, class, theme, difficulty level, area (the one whose map or links it
	 * changed, for cells and links) or uploaded tileset, or the editor's player ID; null for something
	 * added, and for the settings, the ruleset, translations and the draft
	 */
	id: number | string | null;

	/**
	 * For cells, the chunks of the area's map the save painted, for the area editor to load again and mark
	 * the cells that changed; left out of the details saved for the Audit tab
	 */
	chunks?: ChunkCoordinates[];
}

/**
 * A chunk of an area's map, by its column and row among chunks
 */
export interface ChunkCoordinates
{
	chunkColumn: number;
	chunkRow: number;
}

/**
 * Options a client joins a universe's editor room with
 */
export interface EditorJoinOptions
{
	universeId: string;
}

/**
 * Payload of EditorMessageType.Place
 */
export interface EditorPlacePayload
{
	version: UniverseVersionName;
	tab: EditorTab;

	/**
	 * The area open in the area editor, or null when none is
	 */
	areaId: string | null;

	/**
	 * Whether the window holds work not yet saved
	 */
	unsaved: boolean;
}
