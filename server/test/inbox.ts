import type { Room as ClientRoom } from '@colyseus/sdk';

/**
 * Collects the messages a room sends one client, so a test can wait for them in order
 */
export class Inbox<T extends string>
{
	private readonly received = new Map<string, unknown[]>();
	private readonly waiting = new Map<string, Array<(payload: unknown) => void>>();

	/**
	 * Starts listening for every message type given
	 *
	 * @param room Client-side room
	 * @param types The message types to collect
	 */
	constructor(room: ClientRoom, types: T[])
	{
		for (const type of types)
		{
			room.onMessage(type, (payload: unknown) =>
			{
				const resolve = this.waiting.get(type)?.shift();

				if (resolve)
				{
					resolve(payload);
				}
				else
				{
					this.received.set(type, [...(this.received.get(type) ?? []), payload]);
				}
			});
		}
	}

	/**
	 * Takes the oldest message of a type not taken yet, waiting for one if there is none
	 *
	 * @param type Message type
	 * @param timeoutMs How long to wait before failing
	 * @return The message's payload
	 */
	take<P>(type: T, timeoutMs: number = 2000): Promise<P>
	{
		const queued = this.received.get(type);

		if (queued && (queued.length > 0))
		{
			return(Promise.resolve(queued.shift() as P));
		}

		return(new Promise<P>((resolve, reject) =>
		{
			const waiter = (payload: unknown) =>
			{
				clearTimeout(timer);
				resolve(payload as P);
			};
			const timer = setTimeout(() =>
			{
				const waiters = this.waiting.get(type) ?? [];

				waiters.splice(waiters.indexOf(waiter), 1);
				reject(new Error(`no ${type} message within ${timeoutMs}ms`));
			}, timeoutMs);

			this.waiting.set(type, [...(this.waiting.get(type) ?? []), waiter]);
		}));
	}

	/**
	 * How many messages of a type have arrived and not been taken
	 *
	 * @param type Message type
	 * @return The number of messages
	 */
	pending(type: T): number
	{
		return(this.received.get(type)?.length ?? 0);
	}
}
