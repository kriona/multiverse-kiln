/**
 * What a window found out about itself as it joined, once it has looked itself up again
 */
export interface Rechecked<Kind extends string, Found>
{
	/**
	 * What the last lookup found, during which no change the room follows was published
	 */
	found: Found;

	/**
	 * Every kind of change published while the window was joining
	 */
	missed: ReadonlySet<Kind>;
}

/**
 * A joining window's lookup of itself
 */
interface Lookup<Found>
{
	/**
	 * The count of changes when it last started
	 */
	start: number;

	/**
	 * Looks the window up again
	 */
	lookUp: () => Promise<Found>;
}

/**
 * The changes to who may be in a room, and with what access, published while windows are joining it
 *
 * A window's onAuth looks up whether its player may be in the room before Colyseus lists the window
 * among the room's clients, and the room's listeners only reach its clients, so a change published
 * during that lookup misses the window: a window could join with a session that just ended, or a role
 * just taken away. The room notes every such change it hears of here, onAuth marks where each window's
 * lookup starts, and onJoin, once the window is listed, looks it up again when a change was noted since
 * (recheck())
 *
 * Changes are counted rather than kept, and windows are held weakly, so a window that never finishes
 * joining leaves nothing behind
 */
export class JoinChanges<Kind extends string, Found>
{
	private count = 0;

	/**
	 * The count when each kind of change was last noted
	 */
	private readonly lastNoted = new Map<Kind, number>();

	private readonly lookups = new WeakMap<object, Lookup<Found>>();

	/**
	 * Notes that a change the room follows was published
	 *
	 * @param kind What changed
	 */
	note(kind: Kind): void
	{
		this.count++;
		this.lastNoted.set(kind, this.count);
	}

	/**
	 * Marks where a window's lookup of itself starts, at the start of onAuth: the changes noted from then
	 * on are the ones it may miss
	 *
	 * @param window The joining client
	 * @param lookUp Looks the window up again, finding what onAuth finds
	 */
	startLookup(window: object, lookUp: () => Promise<Found>): void
	{
		this.lookups.set(window, {
			start: this.count,
			lookUp
		});
	}

	/**
	 * Looks a window up again when a change was noted since its lookup started, as many times as it
	 * takes for one lookup to have no change noted during it. Called once the window is among the room's
	 * clients, and acted on as soon as it resolves, so a change published from then on reaches the window
	 * through the room's listeners instead
	 *
	 * @param window The joining client
	 * @return What the last lookup found, and the kinds of change noted while the window joined; undefined
	 * when none was, and what onAuth found still holds
	 */
	async recheck(window: object): Promise<Rechecked<Kind, Found> | undefined>
	{
		const lookup = this.lookups.get(window);

		if (!lookup)
		{
			throw new Error('A window was rechecked without its lookup being started');
		}

		let missed = this.missedSince(lookup.start);

		if (missed.length === 0)
		{
			return(undefined);
		}

		const allMissed = new Set(missed);
		let found: Found;

		do
		{
			lookup.start = this.count;
			found = await lookup.lookUp();
			missed = this.missedSince(lookup.start);

			for (const kind of missed)
			{
				allMissed.add(kind);
			}
		}
		while (missed.length > 0);

		return({
			found,
			missed: allMissed
		});
	}

	/**
	 * The kinds of change noted since a count
	 *
	 * @param start The count
	 * @return Them
	 */
	private missedSince(start: number): Kind[]
	{
		return([...this.lastNoted]
			.filter(([, noted]) => (noted > start))
			.map(([kind]) => kind));
	}
}
