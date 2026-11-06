import { MAX_KEPT_CHAT_MESSAGES, type KeptChatHistoryPayload, type KeptChatMessage } from '@multiverse-kiln/shared';

import { addChatMessages, listChatMessages, type KeptChat, type NewChatMessage } from '../db/chatRepo.js';

/**
 * How often a room writes its chat's new messages to the database, in milliseconds
 */
export const CHAT_SAVE_INTERVAL_MS = 5000;

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
 * written to the database (server-only, never synced)
 *
 * The room loads it as it starts and calls save() every CHAT_SAVE_INTERVAL_MS and as it closes, so
 * adding a message never waits for the database
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
	 * The write going on, if any; each waits for the one before
	 */
	private saving: Promise<void> = Promise.resolve();

	/**
	 * Reads the messages the database keeps for a chat, which the log holds from then on
	 *
	 * @param chat The chat
	 */
	async load(chat: KeptChat): Promise<void>
	{
		this.messages = await listChatMessages(chat);
		this.chat = chat;
	}

	/**
	 * The messages the chat holds, for a window joining
	 *
	 * @return The payload of a ChatHistory message
	 */
	history(): KeptChatHistoryPayload
	{
		return({ messages: this.messages });
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
	 * Writes the new messages to the database, after any write going on. Messages that can't be written
	 * are kept for the next try, unless the chat's universe or group, or a writer's account, is gone. A
	 * chat that hasn't loaded has nothing to write
	 *
	 * @return Resolves once they are written, or have failed to be
	 */
	save(): Promise<void>
	{
		this.saving = this.saving.then(async () =>
		{
			const chat = this.chat;
			const messages = this.unsaved;

			if (!chat || (messages.length === 0))
			{
				return;
			}

			this.unsaved = [];

			try
			{
				if (!await addChatMessages(chat, messages))
				{
					console.log('Dropped', messages.length, 'messages of', describeChat(chat), 'whose universe, group or writer no longer exists');
				}
			}
			catch (error)
			{
				this.unsaved = [...messages, ...this.unsaved].slice(-MAX_KEPT_CHAT_MESSAGES);
				console.error('Could not keep', describeChat(chat), error);
			}
		});

		return(this.saving);
	}
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
