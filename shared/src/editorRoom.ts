/**
 * The editor room: one per universe, joined by every window with its editor open, which says who has the
 * editor open and what each window has open, and carries the editors' chat (see Editing together in
 * STRUCTURE-OVERVIEW.md)
 */
import type { UniverseVersionName } from './editor.js';

/**
 * The editor's tabs, in the order they are shown
 */
export const EDITOR_TABS = [
	'universe',
	'editors',
	'ruleset',
	'lobby',
	'characters',
	'characterList',
	'tilesets',
	'areas',
	'items',
	'audit',
	'translations'
] as const;

export type EditorTab = typeof EDITOR_TABS[number];

/**
 * Most messages a kept chat holds (the editors' chat and each group's); writing another deletes the oldest
 */
export const MAX_KEPT_CHAT_MESSAGES = 200;

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
	Chat = 'chat'
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
	 * What the player may do in the editor may have changed: their role, the universe's stage, or whether
	 * the site's admins have disabled it. The window loads the universe again (no payload)
	 */
	AccessChanged = 'accessChanged',

	/**
	 * Something the player asked for didn't happen (payload: NoticePayload)
	 */
	Notice = 'notice'
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
}

/**
 * One message of a chat that is kept
 */
export interface KeptChatMessage
{
	/**
	 * The player who wrote it, or null once their account is deleted
	 */
	playerId: string | null;

	/**
	 * The writer's name: in a group's chat, their character's when they wrote it, and in the editors'
	 * chat the player's display name. Empty once their account is deleted
	 */
	name: string;

	/**
	 * In the editors' chat, the writer's username; null in a group's chat, and once their account is deleted
	 */
	username: string | null;

	text: string;

	/**
	 * When the server received it, in milliseconds since the epoch
	 */
	sentAt: number;
}

/**
 * Payload of EditorServerMessageType.ChatHistory: the messages the chat keeps, oldest first
 */
export interface KeptChatHistoryPayload
{
	messages: KeptChatMessage[];
}
