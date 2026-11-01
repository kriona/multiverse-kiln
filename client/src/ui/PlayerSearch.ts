import { parsePlayerSearch, type PlayerMatch } from '@multiverse-kiln/shared';

import { t } from '../localization';
import { ComboboxList, type ComboboxChoice } from './ComboboxList';
import { getElement } from './dom';
import { setFieldError, setFieldSuccess } from './fieldErrors';

/**
 * How long a pause in typing lasts before the players are searched for, in milliseconds
 */
const SEARCH_DELAY_MS = 250;

/**
 * How a PlayerSearch is set up
 */
export interface PlayerSearchOptions
{
	/**
	 * The search field (role="combobox"), with an ID, and a message line of its own (a
	 * field-message-slot, see setFieldError()) that says who was chosen
	 */
	searchId: string;

	/**
	 * The list the players found show in (role="listbox"), with an ID
	 */
	listboxId: string;

	/**
	 * Finds the players matching what was typed, such as those who could be added to a universe's editors
	 *
	 * @param query What was typed
	 * @return The players, best matches first
	 */
	search(query: string): Promise<PlayerMatch[]>;

	/**
	 * Whether to leave a player out of the list, such as one already added on the page but not saved
	 *
	 * @param playerId The player's ID
	 * @return True to leave them out
	 */
	exclude?(playerId: string): boolean;

	/**
	 * The fewest characters to type, not counting a leading @, before the players are searched for; 1
	 * unless set
	 */
	minLength?: number;
}

/**
 * A field that finds a player by typing their name or username, and offers the players found in a list
 * under it to choose from: what was typed is matched against usernames and names, or usernames only
 * when it starts with @ (parsePlayerSearch()). Choosing one puts their username in the field and their
 * name under it. Typing again takes the choice back
 */
export class PlayerSearch
{
	private readonly field: HTMLInputElement;
	private readonly list: ComboboxList;

	/**
	 * The players each search found, by what was searched for
	 */
	private readonly found = new Map<string, PlayerMatch[]>();

	/**
	 * The players the list offers, from the last search to answer
	 */
	private players: PlayerMatch[] = [];

	/**
	 * What is being searched for while its answer hasn't come, or undefined
	 */
	private pending: string | undefined;

	private chosen: PlayerMatch | undefined;
	private timer: number | undefined;

	/**
	 * @param options The elements, and how to find the players
	 */
	constructor(private readonly options: PlayerSearchOptions)
	{
		this.field = getElement(options.searchId, HTMLInputElement);
		this.list = new ComboboxList(this.field, getElement(options.listboxId, HTMLUListElement), {
			choices: () => this.choices(),
			onChoose: (choice) =>
			{
				const player = this.players.find((each) => (each.playerId === choice.value));

				if (player)
				{
					this.choose(player);
				}
			},
			emptyText: () => this.emptyText()
		});

		this.field.addEventListener('input', () =>
		{
			this.chosen = undefined;
			setFieldError(this.field, undefined);
			window.clearTimeout(this.timer);
			this.timer = window.setTimeout(() =>
			{
				void this.search();
			}, SEARCH_DELAY_MS);
		});
	}

	/**
	 * The player chosen
	 *
	 * @return The player, or undefined until one is chosen from the list
	 */
	get player(): PlayerMatch | undefined
	{
		return(this.chosen);
	}

	/**
	 * Empties the field and forgets the searches made, for when its form opens again
	 */
	reset(): void
	{
		window.clearTimeout(this.timer);
		this.found.clear();
		this.players = [];
		this.pending = undefined;
		this.chosen = undefined;
		this.field.value = '';
		this.list.close();
		setFieldError(this.field, undefined);
	}

	/**
	 * Searches for what is typed, unless it was searched for already, and shows the players found
	 */
	private async search(): Promise<void>
	{
		const query = this.query();

		if (query === undefined)
		{
			this.players = [];
			this.refreshList();
			return;
		}

		const known = this.found.get(query);

		if (known)
		{
			this.players = known;
			this.refreshList();
			return;
		}

		this.pending = query;
		this.refreshList();

		try
		{
			const players = await this.options.search(query);

			this.found.set(query, players);

			// The player may have typed on while the server answered
			if (this.query() === query)
			{
				this.players = players;
			}
		}
		catch (error)
		{
			console.error('Searching for players failed:', error);
		}
		finally
		{
			if (this.pending === query)
			{
				this.pending = undefined;
			}
		}

		this.refreshList();
	}

	/**
	 * What to search for: what is typed, keeping a leading @, which says to search usernames only
	 *
	 * @return The query, or undefined until at least minLength characters besides the @ are typed
	 */
	private query(): string | undefined
	{
		const query = this.field.value.trim();
		const typed = [...parsePlayerSearch(query).text].length;

		return(((typed === 0) || (typed < this.minLength())) ? undefined : query.toLowerCase());
	}

	/**
	 * The fewest characters to type before the players are searched for
	 *
	 * @return The number, at least 1
	 */
	private minLength(): number
	{
		return(Math.max(1, (this.options.minLength ?? 1)));
	}

	/**
	 * Shows the list again with the players found, while the field has focus
	 */
	private refreshList(): void
	{
		if (document.activeElement === this.field)
		{
			this.list.open();
		}
	}

	/**
	 * The players found, as the list offers them: each by name, with their username after it
	 *
	 * @return The choices
	 */
	private choices(): ComboboxChoice[]
	{
		// The players a longer search found aren't offered once too little is typed
		if (this.query() === undefined)
		{
			return([]);
		}

		return(this.players
			.filter((player) => !(this.options.exclude?.(player.playerId) ?? false))
			.map((player) => ({
				value: player.playerId,
				name: player.displayName,
				detail: `@${player.username}`
			})));
	}

	/**
	 * What the list says when it offers no one: to type, that the search is still going, or that no one
	 * was found
	 *
	 * @return The words
	 */
	private emptyText(): string
	{
		if (this.query() === undefined)
		{
			return(t({
				id: 'playerSearch.typeToSearch',
				defaultMessage: 'Type at least {min, plural, one {# character} other {# characters}} of a name, or @ and a username',
				description: 'Shown in the list under a field that finds a player, such as the one for adding an editor on the editor\'s Editors tab, until enough is typed to search; {min} is the fewest characters, e.g. 3, not counting the @ that starts a username'
			}, {
				min: this.minLength()
			}));
		}

		if (this.pending !== undefined)
		{
			return(t({
				id: 'playerSearch.searching',
				defaultMessage: 'Searching...',
				description: 'Shown in the list under a field that finds a player, such as the one for adding an editor on the editor\'s Editors tab, while the site looks for players matching what was typed'
			}));
		}

		return(t({
			id: 'playerSearch.noMatches',
			defaultMessage: 'No players match',
			description: 'Shown in the list under a field that finds a player, such as the one for adding an editor on the editor\'s Editors tab, when no player\'s name or username matches what was typed (or none who can be added)'
		}));
	}

	/**
	 * Chooses a player: puts their username in the field, and says under it who they are
	 *
	 * @param player The player
	 */
	private choose(player: PlayerMatch): void
	{
		this.list.close();
		this.chosen = player;
		this.field.value = `@${player.username}`;
		this.field.dispatchEvent(new Event('change', { bubbles: true }));
		setFieldSuccess(this.field, t({
			id: 'playerSearch.chosen',
			defaultMessage: '{name} (@{username})',
			description: 'Shown under a field that finds a player, such as the one for adding an editor on the editor\'s Editors tab, once one is chosen; {name} is their name and {username} their username'
		}, {
			name: player.displayName,
			username: player.username
		}));
	}
}
