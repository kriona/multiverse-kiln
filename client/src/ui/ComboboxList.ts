import { t } from '../localization';

/**
 * Something a combobox offers
 */
export interface ComboboxChoice
{
	value: string;

	/**
	 * What the choice shows
	 */
	name: string;

	/**
	 * The language the name is in, when it isn't the page's, which translation tools then leave alone
	 */
	lang?: string;

	/**
	 * Text shown faintly after the name in the list, which searching matches too, or undefined for none
	 */
	detail?: string;

	/**
	 * More words searching matches, such as cities in a time zone. The one that matched shows in the list
	 */
	keywords?: readonly string[];
}

/**
 * How a ComboboxList is set up
 */
export interface ComboboxListOptions
{
	/**
	 * The choices the list can show now, in order
	 */
	choices: () => readonly ComboboxChoice[];

	/**
	 * What typed text the list matches the choices against; by default, the search field's text
	 */
	query?: () => string;

	/**
	 * Hears when the player chooses one
	 */
	onChoose: (choice: ComboboxChoice) => void;
}

/**
 * The list under a search field that follows the ARIA combobox pattern (role="combobox" on the field,
 * role="listbox" on the list): typing narrows the list down, the arrow keys move through it, Enter
 * chooses and Escape closes it. Clicking in the .field-label element around the field focuses it.
 * Used by ChipCombobox and SearchSelect
 */
export class ComboboxList
{
	/**
	 * The choices the list shows, matching what was typed
	 */
	private matches: ComboboxChoice[] = [];

	/**
	 * Which of the matches the arrow keys are on, or -1 for none
	 */
	private active = -1;

	/**
	 * @param search The search field, with an ID
	 * @param listbox The list, with an ID
	 * @param options The choices, and what to do when one is chosen
	 */
	constructor(private readonly search: HTMLInputElement, private readonly listbox: HTMLUListElement, private readonly options: ComboboxListOptions)
	{
		search.addEventListener('input', () =>
		{
			this.open();
		});
		search.addEventListener('click', () =>
		{
			this.open();
		});
		search.addEventListener('keydown', (event) =>
		{
			this.handleKey(event);
		});
		search.addEventListener('blur', () =>
		{
			this.close();
		});

		// Keeps focus in the field, so choosing from the list with a mouse doesn't close it first
		listbox.addEventListener('mousedown', (event) =>
		{
			event.preventDefault();
		});

		// The field's label can't wrap it, since it holds the list and chips' buttons too, so clicking
		// anywhere else around the field focuses it, as a label would
		search.closest('.field-label')?.addEventListener('click', (event) =>
		{
			if ((event.target instanceof Element) && !event.target.closest('button, input, [role="listbox"]'))
			{
				search.focus();
			}
		});
	}

	/**
	 * Whether the list is showing
	 *
	 * @return True when it is
	 */
	get isOpen(): boolean
	{
		return(!this.listbox.hidden);
	}

	/**
	 * Shows the choices that match what was typed, ignoring capitals and accents, with the first one
	 * active when something was typed
	 */
	open(): void
	{
		const query = normalize((this.options.query?.() ?? this.search.value).trim());

		this.matches = [];
		this.listbox.replaceChildren(...this.options.choices().flatMap((choice) =>
		{
			const keyword = ((query === '') ? undefined : matchingKeyword(choice, query));

			if ((query !== '') && (keyword === undefined) && !normalize(choice.name).includes(query) && !((choice.detail !== undefined) && normalize(choice.detail).includes(query)))
			{
				return([]);
			}

			const index = this.matches.length;

			this.matches.push(choice);

			return([this.createOption(choice, keyword, index)]);
		}));

		if (this.matches.length === 0)
		{
			const empty = document.createElement('li');

			empty.className = 'combobox-empty';
			empty.setAttribute('role', 'option');
			empty.setAttribute('aria-disabled', 'true');
			empty.textContent = t({
				id: 'combobox.noMatches',
				defaultMessage: 'Nothing matches',
				description: 'Shown in the list under a search field, such as the time zone or the languages on the profile page, when nothing matches what was typed'
			});
			this.listbox.append(empty);
		}

		this.listbox.hidden = false;
		this.search.setAttribute('aria-expanded', 'true');
		this.setActive(((query === '') || (this.matches.length === 0)) ? -1 : 0);
	}

	/**
	 * Hides the list
	 */
	close(): void
	{
		this.listbox.hidden = true;
		this.search.setAttribute('aria-expanded', 'false');
		this.setActive(-1);
	}

	/**
	 * Moves through the list with the arrow keys, chooses with Enter and closes the list with Escape
	 *
	 * @param event The key pressed in the search field
	 */
	private handleKey(event: KeyboardEvent): void
	{
		if ((event.key === 'ArrowDown') || (event.key === 'ArrowUp'))
		{
			event.preventDefault();

			if (!this.isOpen)
			{
				this.open();
			}

			const step = ((event.key === 'ArrowDown') ? 1 : -1);
			const count = this.matches.length;

			if (count > 0)
			{
				this.setActive(((this.active === -1) ? ((step === 1) ? 0 : (count - 1)) : ((this.active + step + count) % count)));
			}
		}
		else if ((event.key === 'Enter') && this.isOpen)
		{
			// Enter in the field chooses rather than submitting the form
			event.preventDefault();

			const match = this.matches[this.active];

			if (match)
			{
				this.options.onChoose(match);
			}
		}
		else if ((event.key === 'Escape') && this.isOpen)
		{
			event.preventDefault();
			event.stopPropagation();
			this.close();
		}
	}

	/**
	 * An option in the list
	 *
	 * @param choice What it chooses
	 * @param keyword The keyword that matched what was typed, to show before the detail, or undefined
	 * @param index Where it is among the matches
	 * @return The option
	 */
	private createOption(choice: ComboboxChoice, keyword: string | undefined, index: number): HTMLLIElement
	{
		const option = document.createElement('li');
		const name = document.createElement('span');
		const details = [...((keyword === undefined) ? [] : [keyword]), ...((choice.detail === undefined) ? [] : [choice.detail])];

		option.id = `${this.listbox.id}-${index}`;
		option.setAttribute('role', 'option');
		option.setAttribute('aria-selected', 'false');
		setChoiceName(name, choice);
		option.append(name);

		if (details.length > 0)
		{
			const detail = document.createElement('span');

			detail.className = 'combobox-detail';
			detail.textContent = details.join(' · ');
			option.append(' ', detail);
		}

		option.addEventListener('click', () =>
		{
			this.options.onChoose(choice);
		});
		option.addEventListener('mousemove', () =>
		{
			if (this.active !== index)
			{
				this.setActive(index);
			}
		});

		return(option);
	}

	/**
	 * Marks one of the matches as the one Enter chooses, and scrolls it into view
	 *
	 * @param index Which match, or -1 for none
	 */
	private setActive(index: number): void
	{
		const options = this.listbox.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled])');

		options[this.active]?.setAttribute('aria-selected', 'false');
		this.active = index;

		const option = options[index];

		if (option)
		{
			option.setAttribute('aria-selected', 'true');
			option.scrollIntoView({ block: 'nearest' });
			this.search.setAttribute('aria-activedescendant', option.id);
		}
		else
		{
			this.search.removeAttribute('aria-activedescendant');
		}
	}
}

/**
 * Shows a choice's name in an element, marked with its language when it has one
 *
 * @param element The element
 * @param choice The choice
 */
export function setChoiceName(element: HTMLElement, choice: ComboboxChoice): void
{
	element.textContent = choice.name;

	if (choice.lang)
	{
		element.lang = choice.lang;
		element.translate = false;
	}
}

/**
 * The first of a choice's keywords that contains what was typed, unless its name already does
 *
 * @param choice The choice
 * @param query What was typed, normalized
 * @return The keyword, or undefined when none matches or the name does
 */
function matchingKeyword(choice: ComboboxChoice, query: string): string | undefined
{
	if (normalize(choice.name).includes(query))
	{
		return(undefined);
	}

	return(choice.keywords?.find((keyword) => normalize(keyword).includes(query)));
}

/**
 * Text for comparing what was typed with a choice: lowercase, without accents
 *
 * @param text The text
 * @return The text to compare
 */
function normalize(text: string): string
{
	return(text
		.normalize('NFD')
		.replace(/\p{Mn}/gu, '')
		.toLocaleLowerCase());
}
