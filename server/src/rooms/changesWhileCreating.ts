/**
 * The changes a room hears of while it is being created, held until it has loaded what they change
 *
 * A room's onCreate reads what it starts from (a group's members, the universe's stage, what bars
 * characters, the lobby's area) across several awaits, and a change published during them may or may
 * not be in what it read. So the room follows changes from the start of onCreate, before its first
 * read, and passes each to apply(), which holds it until created() and then applies it in the order it
 * was heard. Each change says what is true after it, so applying one the room has read already leaves
 * the room as it was, and what the room holds once created is from after every change published since
 * its first read
 */
export class ChangesWhileCreating
{
	/**
	 * The changes heard so far, in order; undefined once the room has been created
	 */
	private held: (() => void)[] | undefined = [];

	/**
	 * Applies a change now when the room has been created, or holds it until it has
	 *
	 * @param change Applies the change to the room
	 */
	apply(change: () => void): void
	{
		if (this.held)
		{
			this.held.push(change);
			return;
		}

		change();
	}

	/**
	 * Applies the changes held, in the order they were heard, and every later one as it is heard. Call
	 * it at the end of onCreate, once everything the changes apply to has loaded
	 */
	created(): void
	{
		const held = this.held;

		if (!held)
		{
			return;
		}

		// A change heard while those held are applied waits its turn behind them
		for (let change = held.shift(); change; change = held.shift())
		{
			change();
		}

		this.held = undefined;
	}
}
