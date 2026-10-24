import { MAX_ITEM_QUANTITY, type EditableUniverse, type EditorItem } from '@multiverse-kiln/shared';
import removeIcon from 'virtual:icon/ph:x';

import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { ChangeTracker } from '../changeTracker';
import { getElement, setButtonLabel, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import { createItemIcon, itemName, itemTypeName } from '../itemNames';
import { editorMessages } from './editorMessages';

/**
 * Most items the dialog lists at once; typing narrows them down
 */
const MAX_RESULTS = 20;

/**
 * How long the search waits after the last key before asking the server, in milliseconds
 */
const SEARCH_DELAY_MS = 250;

/**
 * An item chosen in the dialog, and how many of it
 */
export interface ChosenItem
{
	item: EditorItem;
	quantity: number;
}

/**
 * Selection: Item (see STRUCTURE-OVERVIEW.md): a dialog for choosing items by typing part of their
 * names, each with a quantity (for example, 20 arrows)
 *
 * Disabled items can be chosen, and are marked; characters are only given enabled items
 */
export class ItemSelectDialog
{
	private readonly dialog = getElement('item-select-dialog', HTMLDialogElement);
	private readonly form = getElement('item-select-form', HTMLFormElement);
	private readonly search = getElement('item-select-search', HTMLInputElement);
	private readonly results = getElement('item-select-results', HTMLFieldSetElement);
	private readonly none = getElement('item-select-none', HTMLElement);
	private readonly chosenList = getElement('item-select-chosen', HTMLUListElement);
	private readonly nothing = getElement('item-select-nothing', HTMLElement);
	private readonly error = getElement('item-select-error', HTMLElement);

	/**
	 * The items chosen, in the order they were chosen. Each quantity is read from its field on submit
	 */
	private chosen: ChosenItem[] = [];

	/**
	 * Whether the items chosen differ from those the dialog opened with
	 */
	private readonly changes = new ChangeTracker({
		root: this.form,
		state: () => this.chosen.map(({ item }) => item.id)
	});

	private universe: EditableUniverse | undefined;

	/**
	 * Each chosen item's quantity field, by the item's ID
	 */
	private readonly quantityFields = new Map<number, HTMLInputElement>();

	/**
	 * Settles the promise open() returned: with the items chosen, or undefined when the dialog closed without choosing
	 */
	private settle: ((chosen: ChosenItem[] | undefined) => void) | undefined;

	/**
	 * Changes with every search, so results that arrive after a newer search are ignored
	 */
	private searchVersion = 0;

	private searchTimer: number | undefined;

	/**
	 * @param api The editor's API
	 */
	constructor(private readonly api: EditorApi)
	{
		this.search.setAttribute('data-untracked', '');

		this.search.addEventListener('input', () =>
		{
			window.clearTimeout(this.searchTimer);
			this.searchTimer = window.setTimeout(() =>
			{
				void this.showResults();
			}, SEARCH_DELAY_MS);
		});

		this.changes.guardDialog(this.dialog);

		getElement('item-select-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			if (this.changes.confirmDiscard())
			{
				this.dialog.close();
			}
		});

		this.dialog.addEventListener('close', () =>
		{
			window.clearTimeout(this.searchTimer);
			this.finish(undefined);
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			this.submit();
		});
	}

	/**
	 * Opens the dialog
	 *
	 * @param universe The universe whose items to choose from
	 * @param chosen The items chosen now, which start out chosen
	 * @return The items chosen, or undefined when the dialog was closed without choosing
	 */
	async open(universe: EditableUniverse, chosen: readonly ChosenItem[]): Promise<ChosenItem[] | undefined>
	{
		this.finish(undefined);
		this.universe = universe;
		this.chosen = chosen.map((choice) => ({ ...choice }));
		this.search.value = '';
		this.results.replaceChildren();
		this.none.hidden = true;
		showMessage(this.error, undefined);
		clearFieldErrors(this.dialog);
		this.showChosen();
		this.dialog.showModal();
		this.changes.markSaved();
		this.search.focus();

		const result = new Promise<ChosenItem[] | undefined>((resolve) =>
		{
			this.settle = resolve;
		});

		void this.showResults();

		return(result);
	}

	/**
	 * Settles the promise open() returned, once
	 *
	 * @param chosen The items chosen, or undefined for none
	 */
	private finish(chosen: ChosenItem[] | undefined): void
	{
		const settle = this.settle;

		this.settle = undefined;
		settle?.(chosen);
	}

	/**
	 * Lists the items whose names hold what is typed in the search field, up to MAX_RESULTS
	 */
	private async showResults(): Promise<void>
	{
		const universe = this.universe;
		const version = ++this.searchVersion;

		if (!universe)
		{
			return;
		}

		let items: EditorItem[];

		try
		{
			items = (await this.api.listItems(universe.id, {
				name: (this.search.value.trim() || undefined),
				limit: MAX_RESULTS
			})).items;
		}
		catch (error)
		{
			if (version === this.searchVersion)
			{
				showMessage(this.error, describeEditorError(error, {
					id: 'editor.itemSelect.loadFailed',
					defaultMessage: 'Could not load the items.',
					description: 'Shown in the dialog for choosing items when the universe\'s items couldn\'t be loaded'
				}));
			}

			return;
		}

		if ((version !== this.searchVersion) || !this.dialog.open)
		{
			return;
		}

		showMessage(this.error, undefined);
		this.results.replaceChildren(...items.map((item) => this.createChoice(item, universe)));
		this.results.hidden = (items.length === 0);
		this.none.hidden = (items.length > 0);
	}

	/**
	 * One item's choice: a checkbox with the item's icon, name, type and whether it is disabled
	 *
	 * @param item The item
	 * @param universe The universe whose item it is
	 * @return The choice's label, holding its checkbox
	 */
	private createChoice(item: EditorItem, universe: EditableUniverse): HTMLLabelElement
	{
		const label = document.createElement('label');
		const input = document.createElement('input');
		const text = document.createElement('span');
		const name = document.createElement('span');
		const description = document.createElement('span');
		const notes = [itemTypeName(item.type, universe.ruleset)];

		if (!item.enabled)
		{
			notes.push(t(editorMessages.disabled));
		}

		label.className = 'checkbox described-choice';
		input.type = 'checkbox';
		input.value = String(item.id);
		input.checked = this.chosen.some((choice) => (choice.item.id === item.id));
		input.setAttribute('data-untracked', '');
		text.className = 'choice-text';
		name.textContent = itemName(item, universe.ruleset);
		description.className = 'choice-description';
		description.textContent = notes.join(' - ');
		text.append(name, description);
		label.append(input, createItemIcon(item.type, universe.ruleset), text);

		input.addEventListener('change', () =>
		{
			if (input.checked)
			{
				this.choose(item);
			}
			else
			{
				this.unchoose(item.id);
			}
		});

		return(label);
	}

	/**
	 * Adds an item to the items chosen, one of it
	 *
	 * @param item The item
	 */
	private choose(item: EditorItem): void
	{
		if (!this.chosen.some((choice) => (choice.item.id === item.id)))
		{
			this.readQuantities();
			this.chosen.push({ item, quantity: 1 });
			this.showChosen();
			this.changes.check();
		}
	}

	/**
	 * Takes an item out of the items chosen, and unchecks it in the results
	 *
	 * @param itemId The item's ID
	 */
	private unchoose(itemId: number): void
	{
		this.readQuantities();
		this.chosen = this.chosen.filter((choice) => (choice.item.id !== itemId));
		this.showChosen();
		this.changes.check();

		for (const input of this.results.querySelectorAll('input'))
		{
			if (input.value === String(itemId))
			{
				input.checked = false;
			}
		}
	}

	/**
	 * Remembers the quantities typed so far, so redrawing the list keeps them
	 */
	private readQuantities(): void
	{
		for (const choice of this.chosen)
		{
			const field = this.quantityFields.get(choice.item.id);

			if (field && Number.isInteger(field.valueAsNumber))
			{
				choice.quantity = field.valueAsNumber;
			}
		}
	}

	/**
	 * Lists the items chosen, each with its quantity field and a button that takes it out
	 */
	private showChosen(): void
	{
		const universe = this.universe;

		this.quantityFields.clear();
		this.chosenList.replaceChildren();
		this.nothing.hidden = (this.chosen.length > 0);

		if (!universe)
		{
			return;
		}

		for (const { item, quantity } of this.chosen)
		{
			const row = document.createElement('li');
			const label = document.createElement('label');
			const name = document.createElement('span');
			const field = document.createElement('input');
			const removeButton = document.createElement('button');
			const displayName = itemName(item, universe.ruleset);

			name.textContent = displayName;
			field.id = `item-select-quantity-${item.id}`;
			field.type = 'number';
			field.min = '1';
			field.max = String(MAX_ITEM_QUANTITY);
			field.step = '1';
			field.required = true;
			field.value = String(quantity);
			field.setAttribute('aria-label', t({
				id: 'editor.itemSelect.quantity',
				defaultMessage: 'How many of {item}',
				description: 'Name of the quantity field beside a chosen item in the dialog for choosing items, for screen readers; {item} is the item\'s name'
			}, {
				item: displayName
			}));
			field.addEventListener('input', () =>
			{
				setFieldError(field, undefined);
			});
			label.className = 'item-quantity';
			label.append(createItemIcon(item.type, universe.ruleset), name, field);
			removeButton.type = 'button';
			removeButton.className = 'secondary';
			setButtonLabel(removeButton, removeIcon, t({
				id: 'editor.itemSelect.remove',
				defaultMessage: 'Remove',
				description: 'Button beside a chosen item in the dialog for choosing items that takes it out of the items chosen'
			}));
			removeButton.setAttribute('aria-label', t({
				id: 'editor.itemSelect.removeItem',
				defaultMessage: 'Remove {item}',
				description: 'Name of the Remove button beside a chosen item, for screen readers; {item} is the item\'s name'
			}, {
				item: displayName
			}));
			removeButton.addEventListener('click', () =>
			{
				this.unchoose(item.id);
				this.search.focus();
			});
			row.append(label, removeButton);
			this.chosenList.append(row);
			this.quantityFields.set(item.id, field);
		}
	}

	/**
	 * Chooses the items listed, with their quantities, once every quantity is a whole number in range
	 */
	private submit(): void
	{
		for (const choice of this.chosen)
		{
			const field = this.quantityFields.get(choice.item.id);
			const quantity = (field ? field.valueAsNumber : choice.quantity);

			if (!Number.isInteger(quantity) || (quantity < 1) || (quantity > MAX_ITEM_QUANTITY))
			{
				if (field)
				{
					reportFieldError(field, t(formMessages.wholeNumber, {
						min: 1,
						max: MAX_ITEM_QUANTITY
					}));
				}

				return;
			}

			choice.quantity = quantity;
		}

		this.finish(this.chosen.map((choice) => ({ ...choice })));
		this.changes.markSaved();
		this.dialog.close();
	}
}
