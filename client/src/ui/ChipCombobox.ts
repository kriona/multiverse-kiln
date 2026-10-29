import removeIcon from 'virtual:icon/ph:x';

import { t } from '../localization';
import { announce } from './announcer';
import { ComboboxList, setChoiceName, type ComboboxChoice } from './ComboboxList';
import { getElement } from './dom';
import { reportFieldError, setFieldError } from './fieldErrors';

/**
 * How a ChipCombobox is set up
 */
export interface ChipComboboxOptions
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
	 * The list the chosen ones show in, as chips
	 */
	chosenId: string;

	/**
	 * What can be chosen, in the order the list shows them
	 */
	choices: readonly ComboboxChoice[];

	/**
	 * Most that can be chosen
	 */
	max: number;

	/**
	 * What to say when the player tries to choose more than max, in the player's language
	 */
	tooMany: string;

	/**
	 * Hears when the player chooses or removes one
	 */
	onChange: () => void;
}

/**
 * A field that chooses several things from a long list: typing narrows the list down, choosing one
 * adds it as a chip above the field, and each chip has a button that takes it out again
 */
export class ChipCombobox
{
	private readonly search: HTMLInputElement;
	private readonly chosenList: HTMLUListElement;
	private readonly list: ComboboxList;

	/**
	 * The values chosen, in the order they were chosen
	 */
	private readonly chosen = new Set<string>();

	/**
	 * @param options The elements, the choices and what to do when they change
	 */
	constructor(private readonly options: ChipComboboxOptions)
	{
		this.search = getElement(options.searchId, HTMLInputElement);
		this.chosenList = getElement(options.chosenId, HTMLUListElement);
		this.list = new ComboboxList(this.search, getElement(options.listboxId, HTMLUListElement), {
			choices: () => options.choices.filter((choice) => !this.chosen.has(choice.value)),
			onChoose: (choice) =>
			{
				this.choose(choice);
			}
		});

		this.search.addEventListener('input', () =>
		{
			setFieldError(this.search, undefined);
		});
		this.search.addEventListener('keydown', (event) =>
		{
			if ((event.key === 'Escape') && !event.defaultPrevented && (this.search.value !== ''))
			{
				event.preventDefault();
				this.search.value = '';
			}
		});
		this.renderChosen();
	}

	/**
	 * The values chosen, in the order they were chosen
	 *
	 * @return The values
	 */
	get values(): string[]
	{
		return([...this.chosen]);
	}

	/**
	 * Chooses exactly these values, in this order, leaving out any that aren't choices
	 *
	 * @param values The values
	 */
	set values(values: readonly string[])
	{
		this.chosen.clear();

		for (const value of values)
		{
			if (this.options.choices.some((choice) => (choice.value === value)))
			{
				this.chosen.add(value);
			}
		}

		this.renderChosen();
	}

	/**
	 * Adds a choice as a chip, unless as many as can be are chosen already
	 *
	 * @param choice The choice
	 */
	private choose(choice: ComboboxChoice): void
	{
		this.list.close();

		if (this.chosen.size >= this.options.max)
		{
			reportFieldError(this.search, this.options.tooMany);
			return;
		}

		this.chosen.add(choice.value);
		this.search.value = '';
		this.renderChosen();
		announce(t({
			id: 'chips.added',
			defaultMessage: '{name} added',
			description: 'Read out by screen readers after the player chooses something from a search field that adds choices as chips, such as a language on the profile page; {name} is what was chosen'
		}, {
			name: choice.name
		}));
		this.options.onChange();
	}

	/**
	 * Takes a choice out, and puts focus back in the search field
	 *
	 * @param choice The choice
	 */
	private remove(choice: ComboboxChoice): void
	{
		this.chosen.delete(choice.value);
		setFieldError(this.search, undefined);
		this.renderChosen();
		this.search.focus();
		announce(t({
			id: 'chips.removed',
			defaultMessage: '{name} removed',
			description: 'Read out by screen readers after the player takes a chip out of a search field that adds choices as chips, such as a language on the profile page; {name} is what was taken out'
		}, {
			name: choice.name
		}));
		this.options.onChange();
	}

	/**
	 * Shows a chip for each value chosen, in the order they were chosen, with a button that takes it out
	 */
	private renderChosen(): void
	{
		const chosen = [...this.chosen].flatMap((value) => this.options.choices.filter((choice) => (choice.value === value)));

		this.chosenList.replaceChildren(...chosen.map((choice) =>
		{
			const chip = document.createElement('li');
			const name = document.createElement('span');
			const removeButton = document.createElement('button');
			const template = document.createElement('template');

			chip.className = 'chip';
			setChoiceName(name, choice);
			removeButton.type = 'button';
			removeButton.className = 'chip-remove';
			removeButton.setAttribute('aria-label', t({
				id: 'chips.remove',
				defaultMessage: 'Remove {name}',
				description: 'Name of the button on a chip that takes it out, for screen readers, in a search field that adds choices as chips, such as the languages on the profile page; {name} is the chip\'s text'
			}, {
				name: choice.name
			}));
			template.innerHTML = removeIcon;
			removeButton.append(template.content);
			removeButton.addEventListener('click', () =>
			{
				this.remove(choice);
			});
			chip.append(name, removeButton);

			return(chip);
		}));
		this.chosenList.hidden = (chosen.length === 0);
	}
}
