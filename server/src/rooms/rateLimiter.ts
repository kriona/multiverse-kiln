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

/**
 * Most chat messages a player may send to a room in CHAT_RATE_WINDOW_MS; more are dropped
 */
const CHAT_RATE_LIMIT = 5;

const CHAT_RATE_WINDOW_MS = 3000;

/**
 * Makes the limit on how fast a player may send to a room's chat, which every room with a chat uses
 *
 * @return A limiter keyed by player ID
 */
export function createChatLimiter(): RateLimiter
{
	return(new RateLimiter(CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_MS));
}
