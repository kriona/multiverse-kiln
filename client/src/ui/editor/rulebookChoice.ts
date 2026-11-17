import { isRulebookOn } from '@multiverse-kiln/shared';

/**
 * The optional books a universe has on, as its Ruleset tab shows them before they are saved. The
 * Characters and Items tabs, item selection and a class's starting areas by race show only what these
 * books bring, and what the universe added
 */
export class RulebookChoice
{
	/**
	 * The optional books on, or undefined until the Ruleset tab loads the version open's
	 */
	private on: readonly string[] | undefined;

	private readonly listeners = new Set<() => void>();

	/**
	 * Whether the books on are known for the universe and version open
	 *
	 * @return True when they are
	 */
	known(): boolean
	{
		return(this.on !== undefined);
	}

	/**
	 * The optional books on
	 *
	 * @return Their keys, none while they aren't known
	 */
	rulebooks(): readonly string[]
	{
		return((this.on ?? []));
	}

	/**
	 * Whether what a book brings shows
	 *
	 * @param rulebook The book, or null for something the universe added
	 * @return True when it shows; only the core rulebook's and the universe's things show while the books aren't known
	 */
	shows(rulebook: string | null): boolean
	{
		return(isRulebookOn(this.rulebooks(), rulebook));
	}

	/**
	 * Changes the books on, telling the listeners when they differ or weren't known
	 *
	 * @param rulebooks The optional books on
	 */
	set(rulebooks: readonly string[]): void
	{
		const on = this.on;

		if ((on !== undefined) && (rulebooks.length === on.length) && rulebooks.every((rulebook) => on.includes(rulebook)))
		{
			return;
		}

		this.on = [...rulebooks];
		this.tell();
	}

	/**
	 * Forgets the books on, for another universe or version, until set() gives its books
	 */
	forget(): void
	{
		if (this.on !== undefined)
		{
			this.on = undefined;
			this.tell();
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

	/**
	 * Tells the listeners the books on changed
	 */
	private tell(): void
	{
		for (const listener of this.listeners)
		{
			listener();
		}
	}
}
