import type { Client } from 'colyseus';
import { ServerCloseCode } from '@multiverse-kiln/shared';

/**
 * Invalid messages a client may send in one session before it is disconnected
 *
 * An honest client never sends one, so this only tolerates a few from a buggy client before giving up.
 * It also caps how many warnings one session can log
 */
export const MAX_INVALID_MESSAGES = 10;

/**
 * Counts the invalid messages each client in a room sends, and disconnects a client once it has sent too many
 */
export class InvalidMessages
{
	private readonly counts = new Map<string, number>();

	/**
	 * Logs a message that failed validation (the caller ignores it), and disconnects the client once it has sent too many
	 *
	 * @param client The client that sent the message
	 * @param type Type of the message
	 * @param reason Why it failed validation (must not include the payload)
	 */
	reject(client: Client, type: string, reason: string): void
	{
		const count = (this.counts.get(client.sessionId) ?? 0) + 1;

		this.counts.set(client.sessionId, count);

		console.warn(client.sessionId, `sent an invalid ${type} message (${count} of ${MAX_INVALID_MESSAGES}), ignored:`, reason);

		if (count >= MAX_INVALID_MESSAGES)
		{
			console.warn(client.sessionId, 'disconnected for sending too many invalid messages');
			client.leave(ServerCloseCode.TooManyInvalidMessages);
		}
	}

	/**
	 * Forgets a client that has left
	 *
	 * @param sessionId The client's session ID
	 */
	forget(sessionId: string): void
	{
		this.counts.delete(sessionId);
	}
}
