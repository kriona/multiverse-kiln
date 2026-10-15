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
	 * @param playerId Player the input came from
	 * @param input Validated input
	 */
	push(playerId: string, input: T): void
	{
		let queue = this.queues.get(playerId);

		if (!queue)
		{
			queue = [];
			this.queues.set(playerId, queue);
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
	 * @param playerId Player to drain
	 * @return Inputs in the order they arrived; empty when there are none
	 */
	drain(playerId: string): T[]
	{
		const queue = this.queues.get(playerId);

		if (!queue)
		{
			return([]);
		}

		this.queues.delete(playerId);

		return(queue);
	}

	/**
	 * Discards a player's queue (when they leave)
	 *
	 * @param playerId Player to remove
	 */
	remove(playerId: string): void
	{
		this.queues.delete(playerId);
	}
}
