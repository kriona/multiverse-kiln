import { ComboboxList, type ComboboxChoice } from './ComboboxList';
import { getElement } from './dom';

/**
 * How a SearchSelect is set up
 */
export interface SearchSelectOptions
{
	/**
	 * The search field (role="combobox"), with an ID
	 */
	searchId: string;

	/**
	 * The list the matching choices show in (role="listbox"), with an ID
	 */
	listboxId: string;

	/**
	 * What can be chosen, in the order they're listed. The one whose value is '' is chosen when the
	 * field is left empty, and leaves the field empty when chosen
	 */
	choices: readonly ComboboxChoice[];

	/**
	 * Hears when the player chooses one
	 */
	onChange: () => void;
}

/**
 * A field that chooses one thing from a long list by typing: the field shows the choice, and typing in
 * it narrows the list down. Leaving the field puts the choice's name back, or chooses '' when the field
 * was emptied
 */
export class SearchSelect
{
	private readonly search: HTMLInputElement;
	private readonly list: ComboboxList;
	private choices: ComboboxChoice[];

	/**
	 * The value chosen
	 */
	private chosen = '';

	/**
	 * @param options The elements, the choices and what to do when the choice changes
	 */
	constructor(private readonly options: SearchSelectOptions)
	{
		this.choices = [...options.choices];
		this.search = getElement(options.searchId, HTMLInputElement);
		this.list = new ComboboxList(this.search, getElement(options.listboxId, HTMLUListElement), {
			choices: () => this.choices,

			// The field shows the choice until the player types, and the whole list shows until then
			query: () => ((this.search.value === this.chosenName()) ? '' : this.search.value),
			onChoose: (choice) =>
			{
				this.list.close();
				this.choose(choice.value);
			}
		});

		this.search.addEventListener('focus', () =>
		{
			this.search.select();
		});
		this.search.addEventListener('keydown', (event) =>
		{
			if ((event.key === 'Escape') && !event.defaultPrevented && (this.search.value !== this.chosenName()))
			{
				event.preventDefault();
				this.showChosen();
			}
		});
		this.search.addEventListener('blur', () =>
		{
			if (this.search.value.trim() === '')
			{
				this.choose('');
			}
			else
			{
				this.showChosen();
			}
		});
	}

	/**
	 * The value chosen
	 *
	 * @return The value, or '' for the empty choice
	 */
	get value(): string
	{
		return(this.chosen);
	}

	/**
	 * Chooses a value. One that isn't a choice is added to the end of the list under its own name, so a
	 * value saved earlier stays chosen
	 *
	 * @param value The value
	 */
	set value(value: string)
	{
		if (!this.choices.some((choice) => (choice.value === value)))
		{
			this.choices.push({
				value,
				name: value
			});
		}

		this.chosen = value;
		this.showChosen();
	}

	/**
	 * The field, for showing a problem with the choice
	 *
	 * @return The search field
	 */
	get field(): HTMLInputElement
	{
		return(this.search);
	}

	/**
	 * Chooses a value, and tells the listener when it changed
	 *
	 * @param value The value
	 */
	private choose(value: string): void
	{
		const changed = (value !== this.chosen);

		this.chosen = value;
		this.showChosen();

		if (changed)
		{
			this.options.onChange();
		}
	}

	/**
	 * Shows the chosen choice's name in the field
	 */
	private showChosen(): void
	{
		this.search.value = this.chosenName();
	}

	/**
	 * The chosen choice's name, which the empty choice leaves out so the field shows its placeholder
	 *
	 * @return The name, or '' for the empty choice
	 */
	private chosenName(): string
	{
		if (this.chosen === '')
		{
			return('');
		}

		return((this.choices.find((choice) => (choice.value === this.chosen))?.name ?? ''));
	}
}
