/**
 * Allows each key at most a number of events in any window of time
 */
export class RateLimiter
{
	private readonly eventTimes = new Map<string, number[]>();

	/**
	 * @param maxEvents Most events allowed in one window
	 * @param windowMs Length of the window in milliseconds
	 * @param now Returns the current time in milliseconds
	 */
	constructor(private readonly maxEvents: number, private readonly windowMs: number, private readonly now: () => number = Date.now)
	{
	}

	/**
	 * Records an event for a key if it is within the limit
	 *
	 * @param key Who the event is for
	 * @return Whether the event is allowed; a refused event doesn't count toward the limit
	 */
	tryTake(key: string): boolean
	{
		const now = this.now();
		const times = (this.eventTimes.get(key) ?? []).filter((time) => (time > now - this.windowMs));

		if (times.length >= this.maxEvents)
		{
			this.eventTimes.set(key, times);
			return(false);
		}

		times.push(now);
		this.eventTimes.set(key, times);

		return(true);
	}

	/**
	 * Forgets a key's events
	 *
	 * @param key Who the events were for
	 */
	forget(key: string): void
	{
		this.eventTimes.delete(key);
	}
}
