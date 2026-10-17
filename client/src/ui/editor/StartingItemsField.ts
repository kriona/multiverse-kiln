import type { EditableUniverse, EditorItem, ItemQuantity } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { createItemIcon, itemName } from '../itemNames';
import type { ChosenItem, ItemSelectDialog } from './ItemSelectDialog';

/**
 * The page's parts of a starting equipment field
 */
export interface StartingItemsElements
{
	/**
	 * Lists the items
	 */
	list: HTMLUListElement;

	/**
	 * Shown instead of the list when there are no items
	 */
	none: HTMLElement;

	/**
	 * Opens the dialog for choosing the items
	 */
	choose: HTMLButtonElement;
}

/**
 * Starting equipment in a form: the items and how many of each, with a button that chooses them. Used
 * for the universe's equipment and each race's and class's
 */
export class StartingItemsField
{
	/**
	 * The items the field shows, which may not be saved yet
	 */
	private chosen: ItemQuantity[] = [];

	/**
	 * The items in the field, by ID, for their names
	 */
	private readonly items = new Map<number, EditorItem>();

	private universe: EditableUniverse | undefined;

	/**
	 * Changes every time the field is filled, so items that arrive for an earlier filling are ignored
	 */
	private version = 0;

	/**
	 * @param api The editor's API
	 * @param itemSelect The dialog for choosing items
	 * @param elements The field's parts of the page
	 * @param onChange Called after the player chooses other items
	 * @param onError Called with a message when the items' names couldn't be loaded
	 */
	constructor(private readonly api: EditorApi, private readonly itemSelect: ItemSelectDialog, private readonly elements: StartingItemsElements, private readonly onChange: () => void, private readonly onError: (message: string) => void)
	{
		elements.choose.addEventListener('click', () =>
		{
			void this.choose();
		});
	}

	/**
	 * The items the field shows
	 *
	 * @return The items and how many of each
	 */
	get value(): ItemQuantity[]
	{
		return(this.chosen);
	}

	/**
	 * Shows some starting equipment, loading the items' names
	 *
	 * @param universe The universe the items belong to
	 * @param startingItems The items and how many of each
	 */
	async show(universe: EditableUniverse, startingItems: ItemQuantity[]): Promise<void>
	{
		const version = ++this.version;

		this.universe = universe;
		this.chosen = startingItems;
		this.items.clear();
		this.render();

		// Choosing needs every item, or the items not loaded would be dropped from the equipment
		this.elements.choose.disabled = (startingItems.length > 0);

		if (startingItems.length === 0)
		{
			return;
		}

		try
		{
			const { items } = await this.api.listItems(universe.id, { ids: startingItems.map(({ itemId }) => itemId) });

			if (version === this.version)
			{
				for (const item of items)
				{
					this.items.set(item.id, item);
				}

				this.render();
				this.elements.choose.disabled = false;
			}
		}
		catch (error)
		{
			if (version === this.version)
			{
				this.onError(describeEditorError(error, {
					id: 'editor.startingItems.loadFailed',
					defaultMessage: 'Could not load the starting equipment.',
					description: 'Shown in the editor when the items characters start with (the universe\'s, a race\'s or a class\'s) couldn\'t be loaded'
				}));
			}
		}
	}

	/**
	 * Lists the items: each one's icon, how many and its name, or a note that there are none
	 */
	private render(): void
	{
		const { list, none } = this.elements;
		const ruleset = this.universe?.ruleset;

		list.replaceChildren();
		list.hidden = (this.chosen.length === 0);
		none.hidden = (this.chosen.length > 0);

		if (ruleset === undefined)
		{
			return;
		}

		for (const { itemId, quantity } of this.chosen)
		{
			const item = this.items.get(itemId);
			const row = document.createElement('li');

			if (item)
			{
				row.append(createItemIcon(item.type, ruleset));
			}

			row.append(t({
				id: 'editor.startingItems.item',
				defaultMessage: '{quantity, number} {item}',
				description: 'One line of a list of starting equipment in the editor, e.g. 20 Arrows; {item} is the item\'s name. Change only to reorder the two'
			}, {
				quantity,
				item: ((item === undefined) ? '' : itemName(item, ruleset))
			}));
			list.append(row);
		}
	}

	/**
	 * Lets the player choose other items, which the field shows until the form is saved
	 */
	private async choose(): Promise<void>
	{
		if (!this.universe)
		{
			return;
		}

		const current: ChosenItem[] = this.chosen.flatMap(({ itemId, quantity }) =>
		{
			const item = this.items.get(itemId);

			return((item ? [{ item, quantity }] : []));
		});
		const chosen = await this.itemSelect.open(this.universe, current);

		this.elements.choose.focus();

		if (chosen)
		{
			++this.version;

			for (const { item } of chosen)
			{
				this.items.set(item.id, item);
			}

			this.chosen = chosen.map(({ item, quantity }) => ({
				itemId: item.id,
				quantity
			}));
			this.render();
			this.onChange();
		}
	}
}
