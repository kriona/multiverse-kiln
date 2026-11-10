/**
 * The chats that are kept: the only module that reads or writes the chat_messages and chat_reads tables.
 * Each chat holds its newest MAX_KEPT_CHAT_MESSAGES messages, and remembers how far each player has read it
 */
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { MAX_KEPT_CHAT_MESSAGES, type ChatNotice, type KeptChatMessage } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { chatMessages, chatReads, groups, players, universes } from './schema.js';
import { inTransaction } from './transactions.js';

/**
 * Postgres's code for a row that names a row that doesn't exist
 */
const FOREIGN_KEY_VIOLATION = '23503';

/**
 * A chat that is kept: a universe's editors' chat, or a group's
 */
export type KeptChat =
	| { kind: 'editors'; universeId: string }
	| { kind: 'group'; universeId: string; groupId: string };

/**
 * A message to keep
 */
export interface NewChatMessage
{
	/**
	 * Who wrote it, or null once their account is deleted. For a notice, the player of the character it
	 * is about
	 */
	playerId: string | null;

	/**
	 * In a group's chat, the name of the character who wrote it, or for a notice the character it is
	 * about; null in the editors' chat
	 */
	authorName: string | null;

	/**
	 * For a notice the server wrote, what it says, with text empty; null for a message a player wrote
	 */
	notice: ChatNotice | null;

	text: string;
	sentAt: Date;
}

/**
 * A message the player wrote, as their data download gives it
 */
export interface OwnChatMessage
{
	universeId: string;
	universeName: string;

	/**
	 * The group whose chat it is in, or null for the editors' chat
	 */
	groupId: string | null;

	groupName: string | null;
	text: string;
	sentAt: Date;
}

/**
 * How far a player has read a chat, as their data download gives it
 */
export interface OwnChatRead
{
	universeId: string;
	universeName: string;

	/**
	 * The group whose chat it is, or null for the editors' chat
	 */
	groupId: string | null;

	groupName: string | null;

	/**
	 * When the newest message they have seen was sent
	 */
	readAt: Date;
}

/**
 * The condition that picks a chat's messages
 *
 * @param chat The chat
 * @return The condition
 */
function inChat(chat: KeptChat): SQL | undefined
{
	return((chat.kind === 'editors') ? and(eq(chatMessages.universeId, chat.universeId), isNull(chatMessages.groupId)) : eq(chatMessages.groupId, chat.groupId));
}

/**
 * The messages a chat keeps
 *
 * @param chat The chat
 * @param executor The database, or a transaction
 * @return Its newest MAX_KEPT_CHAT_MESSAGES messages, oldest first, with the names of the players who
 * wrote them in the editors' chat
 */
export async function listChatMessages(chat: KeptChat, executor: Executor = db): Promise<KeptChatMessage[]>
{
	const rows = await executor
		.select({
			playerId: chatMessages.playerId,
			authorName: chatMessages.authorName,
			displayName: players.displayName,
			username: players.username,
			notice: chatMessages.notice,
			text: chatMessages.text,
			sentAt: chatMessages.sentAt
		})
		.from(chatMessages)
		.leftJoin(players, eq(players.id, chatMessages.playerId))
		.where(inChat(chat))
		.orderBy(desc(chatMessages.id))
		.limit(MAX_KEPT_CHAT_MESSAGES);

	return(rows
		.reverse()
		.map((row) => ({
			playerId: row.playerId,
			name: ((chat.kind === 'editors') ? (row.displayName ?? '') : (row.authorName ?? '')),
			username: ((chat.kind === 'editors') ? row.username : null),
			notice: row.notice,
			text: row.text,
			sentAt: row.sentAt.getTime()
		})));
}

/**
 * Whether an error is Postgres refusing a row that names a row that doesn't exist
 *
 * @param error What a query threw
 * @return True when it is
 */
function isForeignKeyViolation(error: unknown): boolean
{
	const cause = ((error instanceof Error) ? (error.cause ?? error) : error);

	return((typeof cause === 'object') && (cause !== null) && ('code' in cause) && (cause.code === FOREIGN_KEY_VIOLATION));
}

/**
 * Adds messages to a chat, in the order given, and deletes the oldest past MAX_KEPT_CHAT_MESSAGES. A
 * message whose writer's account is gone is added without its writer, as forgetChatAuthor() leaves the
 * messages kept already
 *
 * @param chat The chat
 * @param messages The messages
 * @return False when the chat's universe or group is gone, and nothing was added
 */
export async function addChatMessages(chat: KeptChat, messages: readonly NewChatMessage[]): Promise<boolean>
{
	if (messages.length === 0)
	{
		return(true);
	}

	try
	{
		await saveChatMessages(chat, messages);
		return(true);
	}
	catch (error)
	{
		if (!isForeignKeyViolation(error))
		{
			throw error;
		}
	}

	const writers = await listExistingPlayers(messages.flatMap((message) => ((message.playerId === null) ? [] : [message.playerId])));
	const kept = messages.map((message) => (((message.playerId === null) || writers.has(message.playerId))
		? message
		: {
			...message,
			playerId: null,
			authorName: null
		}));

	if (kept.every((message, index) => (message === messages[index])))
	{
		return(false);
	}

	try
	{
		await saveChatMessages(chat, kept);
	}
	catch (error)
	{
		if (isForeignKeyViolation(error))
		{
			return(false);
		}

		throw error;
	}

	return(true);
}

/**
 * Which of some players' accounts still exist
 *
 * @param playerIds The players' IDs
 * @return The IDs of those that do
 */
async function listExistingPlayers(playerIds: readonly string[]): Promise<Set<string>>
{
	if (playerIds.length === 0)
	{
		return(new Set());
	}

	const rows = await db
		.select({ id: players.id })
		.from(players)
		.where(inArray(players.id, [...new Set(playerIds)]));

	return(new Set(rows.map((row) => row.id)));
}

/**
 * Adds messages to a chat in one transaction, deleting the oldest past MAX_KEPT_CHAT_MESSAGES
 *
 * @param chat The chat
 * @param messages The messages
 */
async function saveChatMessages(chat: KeptChat, messages: readonly NewChatMessage[]): Promise<void>
{
	await inTransaction(async (transaction) =>
	{
		await transaction
			.insert(chatMessages)
			.values(messages.map((message) => ({
				universeId: chat.universeId,
				groupId: ((chat.kind === 'group') ? chat.groupId : null),
				playerId: message.playerId,
				authorName: message.authorName,
				notice: message.notice,
				text: message.text,
				sentAt: message.sentAt
			})));

		const older = transaction
			.select({ id: chatMessages.id })
			.from(chatMessages)
			.where(inChat(chat))
			.orderBy(desc(chatMessages.id))
			.offset(MAX_KEPT_CHAT_MESSAGES);

		await transaction
			.delete(chatMessages)
			.where(inArray(chatMessages.id, older));
	});
}

/**
 * The messages the chats still keep that a player wrote, for their data download. Notices about their
 * characters aren't messages they wrote, so they are left out
 *
 * @param playerId The player's ID
 * @param executor The database, or a transaction
 * @return The messages, oldest first
 */
export async function listOwnChatMessages(playerId: string, executor: Executor = db): Promise<OwnChatMessage[]>
{
	return(await executor
		.select({
			universeId: chatMessages.universeId,
			universeName: universes.name,
			groupId: chatMessages.groupId,
			groupName: groups.name,
			text: chatMessages.text,
			sentAt: chatMessages.sentAt
		})
		.from(chatMessages)
		.innerJoin(universes, eq(universes.id, chatMessages.universeId))
		.leftJoin(groups, eq(groups.id, chatMessages.groupId))
		.where(and(eq(chatMessages.playerId, playerId), isNull(chatMessages.notice)))
		.orderBy(asc(chatMessages.id)));
}

/**
 * The condition that picks a player's row of how far they have read a chat
 *
 * @param chat The chat
 * @param playerId The player's ID
 * @return The condition
 */
function readOf(chat: KeptChat, playerId: string): SQL | undefined
{
	return(and(eq(chatReads.playerId, playerId), eq(chatReads.universeId, chat.universeId), ((chat.kind === 'editors') ? isNull(chatReads.groupId) : eq(chatReads.groupId, chat.groupId))));
}

/**
 * How far a player has read a chat
 *
 * @param chat The chat
 * @param playerId The player's ID
 * @param executor The database, or a transaction
 * @return When the newest message they have seen was sent, or undefined when the chat has no record of them
 */
export async function findChatRead(chat: KeptChat, playerId: string, executor: Executor = db): Promise<Date | undefined>
{
	const [row] = await executor
		.select({ readAt: chatReads.readAt })
		.from(chatReads)
		.where(readOf(chat, playerId))
		.limit(1);

	return(row?.readAt);
}

/**
 * Records how far players have read a chat, in one statement. A player's record only moves forward, so
 * a write that arrives late never undoes a newer one
 *
 * @param chat The chat
 * @param reads When the newest message each player has seen was sent, by player ID
 * @return How many records were dropped because the chat's universe or group, or the player, is gone
 */
export async function saveChatReads(chat: KeptChat, reads: ReadonlyMap<string, Date>): Promise<number>
{
	if (reads.size === 0)
	{
		return(0);
	}

	let saved: number;

	try
	{
		saved = await upsertChatReads(chat, reads);
	}
	catch (error)
	{
		if (!isForeignKeyViolation(error))
		{
			throw error;
		}

		// A row was deleted after the statement checked it was there; run it again, which leaves it out
		saved = await upsertChatReads(chat, reads);
	}

	return(reads.size - saved);
}

/**
 * Writes how far players have read a chat in one INSERT, leaving out the players whose account is gone,
 * and every player when the chat's universe or group is gone
 *
 * @param chat The chat
 * @param reads When the newest message each player has seen was sent, by player ID
 * @return How many records were written
 */
async function upsertChatReads(chat: KeptChat, reads: ReadonlyMap<string, Date>): Promise<number>
{
	const groupId = ((chat.kind === 'group') ? chat.groupId : null);
	const chatExists = ((groupId === null)
		? sql`EXISTS (SELECT 1 FROM ${universes} WHERE ${universes.id} = ${chat.universeId})`
		: sql`EXISTS (SELECT 1 FROM ${groups} WHERE ${groups.id} = ${groupId})`);

	const result = await db.execute(sql`
		INSERT INTO ${chatReads} (player_id, universe_id, group_id, read_at)
		SELECT reader.player_id, ${chat.universeId}::uuid, ${groupId}::uuid, reader.read_at
		FROM unnest(
			${sql.param([...reads.keys()])}::uuid[],
			${sql.param([...reads.values()].map((readAt) => readAt.toISOString()))}::timestamptz[]
		) AS reader (player_id, read_at)
		WHERE EXISTS (SELECT 1 FROM ${players} WHERE ${players.id} = reader.player_id)
			AND ${chatExists}
		ON CONFLICT (player_id, universe_id, group_id) DO UPDATE SET read_at = greatest(${chatReads}.read_at, excluded.read_at)
	`);

	return(result.rowCount ?? 0);
}

/**
 * How far a player has read each kept chat, for their data download
 *
 * @param playerId The player's ID
 * @param executor The database, or a transaction
 * @return The records, by universe and then group
 */
export async function listOwnChatReads(playerId: string, executor: Executor = db): Promise<OwnChatRead[]>
{
	return(await executor
		.select({
			universeId: chatReads.universeId,
			universeName: universes.name,
			groupId: chatReads.groupId,
			groupName: groups.name,
			readAt: chatReads.readAt
		})
		.from(chatReads)
		.innerJoin(universes, eq(universes.id, chatReads.universeId))
		.leftJoin(groups, eq(groups.id, chatReads.groupId))
		.where(eq(chatReads.playerId, playerId))
		.orderBy(asc(universes.name), asc(groups.name)));
}

/**
 * Takes a player's name off the messages they wrote, as their account is deleted, leaving the messages
 * where they were written
 *
 * @param playerId The player's ID
 * @param executor The database, or a transaction (the deletion's own)
 */
export async function forgetChatAuthor(playerId: string, executor: Executor = db): Promise<void>
{
	await executor
		.update(chatMessages)
		.set({
			playerId: null,
			authorName: null
		})
		.where(eq(chatMessages.playerId, playerId));
}
