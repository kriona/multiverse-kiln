/**
 * Per-player queues of inputs received between simulation ticks
 *
 * Message handlers push validated inputs; the simulation tick drains them in the order they arrived.
 * Each queue is bounded, so a client sending faster than the tick rate can't grow it without limit
 */
export class InputQueue<T>
{
	private readonly queues = new Map<string, T[]>();

	/**
	 * @param maxLength Most inputs kept per player; when full, the oldest is dropped
	 */
	constructor(private readonly maxLength: number)
	{
	}

	/**
	 * Adds an input to the end of a player's queue
	 *
	 * @param sessionId Player the input came from
	 * @param input Validated input
	 */
	push(sessionId: string, input: T): void
	{
		let queue = this.queues.get(sessionId);

		if (!queue)
		{
			queue = [];
			this.queues.set(sessionId, queue);
		}

		queue.push(input);

		if (queue.length > this.maxLength)
		{
			queue.shift();
		}
	}

	/**
	 * Removes and returns every queued input for a player
	 *
	 * @param sessionId Player to drain
	 * @return Inputs in the order they arrived; empty when there are none
	 */
	drain(sessionId: string): T[]
	{
		const queue = this.queues.get(sessionId);

		if (!queue)
		{
			return([]);
		}

		this.queues.delete(sessionId);

		return(queue);
	}

	/**
	 * Discards a player's queue (when they leave)
	 *
	 * @param sessionId Player to remove
	 */
	remove(sessionId: string): void
	{
		this.queues.delete(sessionId);
	}
}
