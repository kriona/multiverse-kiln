/**
 * Allows each key at most a number of events in any window of time. A key is kept only while its events
 * could still count
 */
export class RateLimiter
{
	private readonly eventTimes = new Map<string, number[]>();

	/**
	 * When the keys whose events are all out of the window are next dropped
	 */
	private nextSweep = 0;

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

		this.sweep(now);

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
	 * How many keys are kept
	 */
	get size(): number
	{
		return(this.eventTimes.size);
	}

	/**
	 * Drops the keys whose events are all out of the window, at most once a window
	 *
	 * @param now The current time in milliseconds
	 */
	private sweep(now: number): void
	{
		if (now < this.nextSweep)
		{
			return;
		}

		const cutoff = now - this.windowMs;

		this.nextSweep = now + this.windowMs;

		for (const [key, times] of this.eventTimes)
		{
			if (!times.some((time) => (time > cutoff)))
			{
				this.eventTimes.delete(key);
			}
		}
	}
}

/**
 * Most chat messages a player may send to one chat in CHAT_RATE_WINDOW_MS; more are dropped
 */
const CHAT_RATE_LIMIT = 5;

const CHAT_RATE_WINDOW_MS = 3000;

/**
 * Every chat's limit, shared by the rooms rather than kept by each, so that a player closing their last
 * window and opening another, or the room closing and opening again, doesn't start their limit over
 */
const chatRates = new RateLimiter(CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_MS);

/**
 * Records a chat message a player sends if it is within the limit on how fast a player may send to one
 * chat, which every room with a chat uses
 *
 * @param chat Which chat the message is for, the same for every room that opens for it, such as
 * 'editors <universe ID>'
 * @param playerId The sending player's ID
 * @return Whether the message is allowed; a refused message doesn't count toward the limit
 */
export function tryTakeChatMessage(chat: string, playerId: string): boolean
{
	return(chatRates.tryTake(`${chat} ${playerId}`));
}
