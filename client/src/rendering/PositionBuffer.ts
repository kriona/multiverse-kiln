/**
 * A position received from the server, and when it arrived
 */
interface Snapshot
{
	time: number;
	x: number;
	y: number;
}

/**
 * A point in world units
 */
export interface Point
{
	x: number;
	y: number;
}

/**
 * Recent server positions of one entity, for drawing it smoothly between patches
 *
 * The server sends positions in steps, one patch at a time. Drawing each one as it arrives looks jerky,
 * so the client draws entities slightly in the past and interpolates between the two snapshots either
 * side of that moment
 */
export class PositionBuffer
{
	private readonly snapshots: Snapshot[] = [];

	/**
	 * @param expectedIntervalMs Normal time between snapshots (the server's patch interval)
	 * @param maxSnapshots Most snapshots kept; older ones are discarded
	 */
	constructor(private readonly expectedIntervalMs: number, private readonly maxSnapshots: number = 20)
	{
	}

	/**
	 * Records a position from the server
	 *
	 * The server only sends patches while something changes, so after an entity has stood still the
	 * previous snapshot can be seconds old. Interpolating from it would compress the first step of
	 * movement into a jump, so a copy of it is inserted one interval before the new snapshot instead
	 *
	 * @param time When the position arrived, in milliseconds (performance.now())
	 * @param x X position
	 * @param y Y position
	 */
	push(time: number, x: number, y: number): void
	{
		const last = this.snapshots.at(-1);

		if (last && ((time - last.time) > (this.expectedIntervalMs * 2)))
		{
			this.snapshots.push({ time: time - this.expectedIntervalMs, x: last.x, y: last.y });
		}

		this.snapshots.push({ time, x, y });

		while (this.snapshots.length > this.maxSnapshots)
		{
			this.snapshots.shift();
		}
	}

	/**
	 * Forgets every position, so the next one is drawn straight away instead of being reached smoothly,
	 * as when the entity moves to another zone
	 */
	clear(): void
	{
		this.snapshots.length = 0;
	}

	/**
	 * Works out where the entity was at a given time
	 *
	 * @param time Time to sample, in milliseconds (performance.now() minus the interpolation delay)
	 * @return The interpolated position, the nearest snapshot outside the buffered range, or undefined when empty
	 */
	sample(time: number): Point | undefined
	{
		const first = this.snapshots.at(0);

		if (!first)
		{
			return(undefined);
		}

		if (time <= first.time)
		{
			return({ x: first.x, y: first.y });
		}

		for (let i = this.snapshots.length - 1; i >= 0; i--)
		{
			const before = this.snapshots[i];

			if (before.time <= time)
			{
				const after = this.snapshots.at(i + 1);

				if (!after)
				{
					return({ x: before.x, y: before.y });
				}

				const fraction = (time - before.time) / (after.time - before.time);

				return({
					x: before.x + ((after.x - before.x) * fraction),
					y: before.y + ((after.y - before.y) * fraction)
				});
			}
		}

		return({ x: first.x, y: first.y });
	}
}
