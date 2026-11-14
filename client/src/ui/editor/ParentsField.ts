import { placeKey, samePlace, type PlaceRef } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { getElement } from '../dom';
import { SearchSelect } from '../SearchSelect';

/**
 * A region or area that can be added as a parent, with what it is inside
 */
export interface ParentChoice
{
	place: PlaceRef;
	name: string;

	/**
	 * The names of the places it is inside, shown faintly after its name
	 */
	detail: string | undefined;

	/**
	 * Why it is listed but can't be chosen, shown after the detail, or undefined when it can be
	 */
	refusal?: string;
}

/**
 * A region's or area's parents in its editor: each in the order they were added, with a Remove button,
 * and Add Parent, a search listing the regions (and areas) it can be put inside
 */
export class ParentsField
{
	private readonly list: HTMLUListElement;
	private readonly add: SearchSelect;
	private parents: PlaceRef[] = [];
	private names: (place: PlaceRef) => string = (place) => place.id;
	private choices: readonly ParentChoice[] = [];
	private disabled = false;

	/**
	 * @param prefix What the field's IDs start with: area or region
	 * @param onChange Called when a parent is added or removed
	 */
	constructor(prefix: string, private readonly onChange: () => void)
	{
		this.list = getElement(`${prefix}-parent-list`, HTMLUListElement);
		this.add = new SearchSelect({
			searchId: `${prefix}-parent-add`,
			listboxId: `${prefix}-parent-add-options`,
			choices: [],
			onChange: () =>
			{
				const key = this.add.value;
				const chosen = this.choices.find((choice) => (placeKey(choice.place) === key));

				this.add.value = '';

				if (chosen && (chosen.refusal === undefined) && !this.parents.some((parent) => samePlace(parent, chosen.place)))
				{
					this.parents = [...this.parents, chosen.place];
					this.render();
					this.onChange();
				}
			}
		});
		this.add.field.placeholder = t({
			id: 'editor.place.addParent',
			defaultMessage: 'Add Parent',
			description: 'Shown in the empty field under a region\'s or area\'s parents in its editor, where typing part of a name lists the regions (and areas, for an area) it can be put inside, to add one'
		});
	}

	/**
	 * Shows a place's parents and what can be added
	 *
	 * @param parents Its parents, in order
	 * @param names Names a place
	 * @param choices What it can be put inside besides them
	 */
	set(parents: readonly PlaceRef[], names: (place: PlaceRef) => string, choices: readonly ParentChoice[]): void
	{
		this.parents = [...parents];
		this.names = names;
		this.setChoices(choices);
		this.render();
	}

	/**
	 * Changes what can be added, keeping the parents
	 *
	 * @param choices What the place can be put inside
	 */
	setChoices(choices: readonly ParentChoice[]): void
	{
		this.choices = choices;
		this.offerChoices();
	}

	/**
	 * The parents as the field shows them
	 *
	 * @return The parents, in order
	 */
	get value(): PlaceRef[]
	{
		return([...this.parents]);
	}

	/**
	 * Whether the field takes changes
	 *
	 * @param disabled True to show the parents read-only
	 */
	setDisabled(disabled: boolean): void
	{
		this.disabled = disabled;
		this.add.field.disabled = disabled;
		this.add.field.hidden = disabled;
		this.render();
	}

	/**
	 * Replaces a new place's ID once it is saved
	 *
	 * @param from The ID it had on the page
	 * @param to Its saved ID
	 */
	replaceId(from: string, to: string): void
	{
		this.replaceIds(new Map([[from, to]]));
	}

	/**
	 * Replaces new places' IDs once they are saved
	 *
	 * @param savedIds Their saved IDs, by the IDs they had on the page
	 */
	replaceIds(savedIds: ReadonlyMap<string, string>): void
	{
		this.parents = this.parents.map((parent) => ({ ...parent, id: (savedIds.get(parent.id) ?? parent.id) }));
		this.render();
	}

	/**
	 * Lists the parents, each with a Remove button
	 */
	private render(): void
	{
		this.list.replaceChildren(...this.parents.map((parent) =>
		{
			const item = document.createElement('li');
			const name = document.createElement('span');
			const remove = document.createElement('button');

			name.textContent = this.names(parent);
			remove.type = 'button';
			remove.className = 'secondary';
			remove.hidden = this.disabled;
			remove.textContent = t({
				id: 'editor.place.removeParent',
				defaultMessage: 'Remove',
				description: 'Button beside one of a region\'s or area\'s parents in its editor, which takes it out of that parent'
			});
			remove.setAttribute('aria-label', t({
				id: 'editor.place.removeParentLabel',
				defaultMessage: 'Remove {parent}',
				description: 'Name of the button that takes a region or area out of one of its parents, for screen readers; {parent} is the parent\'s name'
			}, {
				parent: this.names(parent)
			}));
			remove.addEventListener('click', () =>
			{
				this.parents = this.parents.filter((each) => !samePlace(each, parent));
				this.render();
				this.onChange();
			});
			item.append(name, remove);

			return(item);
		}));
		this.offerChoices();
	}

	/**
	 * Offers the choices Add Parent can add, leaving out the parents shown. Those that can't be chosen are
	 * listed, saying why
	 */
	private offerChoices(): void
	{
		this.add.setChoices(this.choices
			.filter((choice) => !this.parents.some((parent) => samePlace(parent, choice.place)))
			.map((choice) => ({
				value: placeKey(choice.place),
				name: choice.name,
				detail: ((choice.refusal === undefined) ? choice.detail : [choice.detail, choice.refusal].filter((each) => (each !== undefined)).join(' · ')),
				disabled: (choice.refusal !== undefined)
			})));
	}
}
