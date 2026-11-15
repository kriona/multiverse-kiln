import { isRulebookOn } from '@multiverse-kiln/shared';

/**
 * The optional books a universe has on, as its Ruleset tab shows them before they are saved. The
 * Characters and Items tabs, item selection and a class's starting areas by race show only what these
 * books bring, and what the universe added
 */
export class RulebookChoice
{
	/**
	 * The optional books on; none until the Ruleset tab loads them, leaving only the core rulebook
	 */
	private on: readonly string[] = [];

	private readonly listeners = new Set<() => void>();

	/**
	 * The optional books on
	 *
	 * @return Their keys
	 */
	rulebooks(): readonly string[]
	{
		return(this.on);
	}

	/**
	 * Whether what a book brings shows
	 *
	 * @param rulebook The book, or null for something the universe added
	 * @return True when it shows
	 */
	shows(rulebook: string | null): boolean
	{
		return(isRulebookOn(this.on, rulebook));
	}

	/**
	 * Changes the books on, telling the listeners when they differ
	 *
	 * @param rulebooks The optional books on
	 */
	set(rulebooks: readonly string[]): void
	{
		if ((rulebooks.length === this.on.length) && rulebooks.every((rulebook) => this.on.includes(rulebook)))
		{
			return;
		}

		this.on = [...rulebooks];

		for (const listener of this.listeners)
		{
			listener();
		}
	}

	/**
	 * Hears when the books on change
	 *
	 * @param listener Called after they change
	 * @return Stops listening
	 */
	subscribe(listener: () => void): () => void
	{
		this.listeners.add(listener);

		return(() =>
		{
			this.listeners.delete(listener);
		});
	}
}
