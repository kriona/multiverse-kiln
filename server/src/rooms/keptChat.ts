import { MAX_KEPT_CHAT_MESSAGES, type KeptChatHistoryPayload, type KeptChatMessage } from '@multiverse-kiln/shared';

import { addChatMessages, findChatRead, listChatMessages, saveChatReads, type KeptChat, type NewChatMessage } from '../db/chatRepo.js';

/**
 * How often a room writes its chat's new messages to the database, in milliseconds
 */
export const CHAT_SAVE_INTERVAL_MS = 5000;

/**
 * Each chat's latest write going on, by chatKey(), for a log loading that chat to wait for. A room's last
 * write runs in onDispose, after Colyseus has stopped listing it, so the next room for the same chat
 * can be loading it meanwhile
 */
const writesGoingOn = new Map<string, Promise<void>>();

/**
 * Who wrote a message to a kept chat
 */
export interface ChatAuthor
{
	playerId: string;

	/**
	 * Their name as the chat shows it: the character's in a group's chat, the display name in the editors'
	 */
	name: string;

	/**
	 * Their username in the editors' chat; null in a group's
	 */
	username: string | null;
}

/**
 * A room's kept chat (server/src/db/chatRepo.ts): the messages it holds, oldest first, and those not yet
 * written to the database (server-only, never synced). A room whose chat remembers how far each player
 * has read it loads each player's record with findRead() and keepRead() as they join, and moves it
 * with markRead()
 *
 * The room loads it as it starts and calls save() every CHAT_SAVE_INTERVAL_MS and as it closes, so
 * adding a message or reading the chat never waits for the database. A log loading a chat waits for
 * the writes of any other log of the same chat, such as one whose room is closing
 */
export class KeptChatLog
{
	/**
	 * Which chat it is, once loaded
	 */
	private chat: KeptChat | undefined;

	private messages: KeptChatMessage[] = [];

	/**
	 * Messages added since the chat was last written to the database, oldest first
	 */
	private unsaved: NewChatMessage[] = [];

	/**
	 * How far each player held with keepRead() has read the chat: when the newest message they have
	 * seen was sent, in milliseconds since the epoch, by player ID
	 */
	private readonly reads = new Map<string, number>();

	/**
	 * The players whose record has moved since the chat was last written to the database
	 */
	private unsavedReads = new Set<string>();

	/**
	 * The write going on, if any; each waits for the one before
	 */
	private saving: Promise<void> = Promise.resolve();

	/**
	 * Reads the messages the database keeps for a chat, which the log holds from then on, once another
	 * log's write of the chat going on is done
	 *
	 * @param chat The chat
	 */
	async load(chat: KeptChat): Promise<void>
	{
		await writesGoingOn.get(chatKey(chat));
		this.messages = await listChatMessages(chat);
		this.chat = chat;
	}

	/**
	 * Reads how far a player has read the chat from the database, unless the log knows already, for
	 * keepRead() to hold. It holds nothing itself, so a room can look it up while it is still deciding
	 * whether to admit the player
	 *
	 * @param playerId The player's ID
	 * @return When the newest message they have seen was sent; undefined when the chat has no record of
	 * them, or the log knows already
	 */
	async findRead(playerId: string): Promise<Date | undefined>
	{
		if (!this.chat)
		{
			throw new Error('A player\'s reading was loaded for a chat that has not loaded');
		}

		if (this.reads.has(playerId))
		{
			return(undefined);
		}

		return(await findChatRead(this.chat, playerId));
	}

	/**
	 * Holds how far a player has read the chat, as findRead() found it, unless the log knows already. A
	 * player the chat has no record of starts with every message it holds so far read, so a chat they
	 * have never seen doesn't greet them with its whole history as new
	 *
	 * @param playerId The player's ID
	 * @param readAt What findRead() found for them
	 */
	keepRead(playerId: string, readAt: Date | undefined): void
	{
		// Another window of the player may have loaded it, or read further, while findRead() waited
		if (this.reads.has(playerId))
		{
			return;
		}

		if (readAt === undefined)
		{
			this.markRead(playerId, Date.now());
		}
		else
		{
			this.reads.set(playerId, readAt.getTime());
		}
	}

	/**
	 * Moves how far a player has read the chat, to be written with the next save(). It never moves
	 * back, or past the present
	 *
	 * @param playerId The player's ID
	 * @param readAt When the newest message they have seen was sent, in milliseconds since the epoch
	 * @return True when their record moved
	 */
	markRead(playerId: string, readAt: number): boolean
	{
		const at = Math.min(readAt, Date.now());

		if (at <= (this.reads.get(playerId) ?? -1))
		{
			return(false);
		}

		this.reads.set(playerId, at);
		this.unsavedReads.add(playerId);

		return(true);
	}

	/**
	 * How far a player has read the chat
	 *
	 * @param playerId The player's ID
	 * @return When the newest message they have seen was sent, in milliseconds since the epoch, or
	 * undefined until keepRead() has held it
	 */
	readOf(playerId: string): number | undefined
	{
		return(this.reads.get(playerId));
	}

	/**
	 * The messages the chat holds, for a window joining, with how far its player has read them when the
	 * chat remembers that
	 *
	 * @param playerId The window's player, for a chat that remembers how far players have read it
	 * @return The payload of a ChatHistory message
	 */
	history(playerId?: string): KeptChatHistoryPayload
	{
		const readAt = ((playerId === undefined) ? undefined : this.reads.get(playerId));

		return(((readAt === undefined) ? { messages: this.messages } : { messages: this.messages, readAt }));
	}

	/**
	 * Adds a message, dropping the oldest past MAX_KEPT_CHAT_MESSAGES, to be written with the next save()
	 *
	 * @param author Who wrote it
	 * @param text What they wrote
	 * @return The message, to send to the room's windows
	 */
	add(author: ChatAuthor, text: string): KeptChatMessage
	{
		if (!this.chat)
		{
			throw new Error('A message was added to a chat that has not loaded');
		}

		const message: KeptChatMessage = {
			playerId: author.playerId,
			name: author.name,
			username: author.username,
			text,
			sentAt: Date.now()
		};

		this.messages = [...this.messages, message].slice(-MAX_KEPT_CHAT_MESSAGES);
		this.unsaved.push({
			playerId: author.playerId,
			authorName: ((this.chat.kind === 'group') ? author.name : null),
			text,
			sentAt: new Date(message.sentAt)
		});

		return(message);
	}

	/**
	 * Takes the name off the messages a player wrote, held or not yet written, once their account is
	 * deleted, as the database does with those it keeps (forgetChatAuthor()), and forgets how far they
	 * have read the chat
	 *
	 * @param playerId The player's ID
	 * @return True when the log held a message of theirs, for the room to tell its windows
	 */
	forgetAuthor(playerId: string): boolean
	{
		const held = this.messages.some((message) => (message.playerId === playerId));

		if (held)
		{
			this.messages = this.messages.map((message) => ((message.playerId === playerId)
				? {
					...message,
					playerId: null,
					name: '',
					username: null
				}
				: message));
		}

		this.unsaved = this.unsaved.map((message) => ((message.playerId === playerId)
			? {
				...message,
				playerId: null,
				authorName: null
			}
			: message));
		this.reads.delete(playerId);
		this.unsavedReads.delete(playerId);

		return(held);
	}

	/**
	 * Writes the new messages, and how far players have read the chat, to the database, after any write
	 * going on. What can't be written is kept for the next try, unless the chat's universe or group is
	 * gone, or the reader's account; a message whose writer's account is gone is kept without its writer.
	 * A chat that hasn't loaded has nothing to write
	 *
	 * @return Resolves once they are written, or have failed to be
	 */
	save(): Promise<void>
	{
		const saving = this.saving.then(async () =>
		{
			const chat = this.chat;

			if (!chat)
			{
				return;
			}

			await this.saveMessages(chat);
			await this.saveReads(chat);
		});

		this.saving = saving;

		if (this.chat)
		{
			holdWrite(this.chat, saving);
		}

		return(saving);
	}

	/**
	 * Writes the messages added since the last write
	 *
	 * @param chat The chat
	 */
	private async saveMessages(chat: KeptChat): Promise<void>
	{
		const messages = this.unsaved;

		if (messages.length === 0)
		{
			return;
		}

		this.unsaved = [];

		try
		{
			if (!await addChatMessages(chat, messages))
			{
				console.log('Dropped', messages.length, 'messages of', describeChat(chat), 'whose universe or group no longer exists');
			}
		}
		catch (error)
		{
			this.unsaved = [...messages, ...this.unsaved].slice(-MAX_KEPT_CHAT_MESSAGES);
			console.error('Could not keep', describeChat(chat), error);
		}
	}

	/**
	 * Writes how far players have read the chat, for those whose record has moved since the last write
	 *
	 * @param chat The chat
	 */
	private async saveReads(chat: KeptChat): Promise<void>
	{
		const playerIds = this.unsavedReads;

		if (playerIds.size === 0)
		{
			return;
		}

		this.unsavedReads = new Set();

		const reads = new Map([...playerIds].map((playerId) => [playerId, new Date(this.reads.get(playerId) ?? 0)]));

		try
		{
			const dropped = await saveChatReads(chat, reads);

			if (dropped > 0)
			{
				console.log('Dropped', dropped, 'records of reading', describeChat(chat), 'whose universe, group or reader no longer exists');
			}
		}
		catch (error)
		{
			this.unsavedReads = new Set([...playerIds, ...this.unsavedReads]);
			console.error('Could not keep how far players have read', describeChat(chat), error);
		}
	}
}

/**
 * Identifies a chat, whichever log holds it
 *
 * @param chat The chat
 * @return E.g. "group:<ID>"
 */
function chatKey(chat: KeptChat): string
{
	return(((chat.kind === 'group') ? `group:${chat.groupId}` : `editors:${chat.universeId}`));
}

/**
 * Records a write of a chat going on, for a log loading the chat to wait for, until it is done
 *
 * @param chat The chat
 * @param write The write, which resolves once its messages and records are written or have failed to be
 */
function holdWrite(chat: KeptChat, write: Promise<void>): void
{
	const key = chatKey(chat);

	writesGoingOn.set(key, write);
	void write.finally(() =>
	{
		if (writesGoingOn.get(key) === write)
		{
			writesGoingOn.delete(key);
		}
	});
}

/**
 * Names a chat for the server's log
 *
 * @param chat The chat
 * @return E.g. "the chat of group <ID>"
 */
function describeChat(chat: KeptChat): string
{
	return(((chat.kind === 'group') ? `the chat of group ${chat.groupId}` : `the editors' chat of universe ${chat.universeId}`));
}
