import { defineMessages, type EditorItem, type Ruleset } from '@multiverse-kiln/shared';

import { t } from '../localization';
import { getElement } from './dom';
import { ITEM_SETTING_NAMES, itemCategoryName, itemDescription, itemEquipsText, itemName, itemTypesText } from './itemNames';
import { rulebookName } from './rulebookNames';

/**
 * The label of what opens the Inspect dialog: an item in the menu beside an item on a character's sheet,
 * and the button beside an item in the dialog for choosing items
 */
export const INSPECT_MESSAGES = defineMessages({
	inspect: {
		id: 'characterSheet.inspect',
		defaultMessage: 'Inspect',
		description: 'Item in the menu beside an item on a character\'s sheet, and button beside an item in the dialog for choosing items, that opens a dialog showing what the item is: its kind, types, book, where it equips and description'
	}
});

/**
 * What Inspect shows of an item: what a character's sheet and item selection both know of it
 */
export type InspectedItem = Pick<EditorItem, 'key' | 'name' | 'description' | 'category' | 'types' | 'equips' | 'rulebook'>;

/**
 * The dialog showing what an item is (pages that use it include partials/character-sheet.html): its
 * name, kind, types, book, where it equips and description. It is opened from an item's menu on a
 * character's sheet and from item selection, over whatever dialog is open, and gives focus back to what
 * opened it when it closes. Rules details such as weight and damage aren't tracked yet; once items have
 * them, it shows them too
 */
export class ItemInspectDialog
{
	private readonly dialog = getElement('item-inspect-dialog', HTMLDialogElement);
	private readonly title = getElement('item-inspect-title', HTMLElement);
	private readonly details = getElement('item-inspect-details', HTMLDListElement);
	private readonly description = getElement('item-inspect-description', HTMLElement);

	/**
	 * Sets up the dialog's Close button
	 */
	constructor()
	{
		getElement('item-inspect-close', HTMLButtonElement).addEventListener('click', () =>
		{
			this.dialog.close();
		});
	}

	/**
	 * Opens the dialog on an item
	 *
	 * @param item The item
	 * @param ruleset The universe's ruleset
	 */
	open(item: InspectedItem, ruleset: Ruleset): void
	{
		const name = itemName(item, ruleset);
		const description = itemDescription(item, ruleset);
		const entries: [string, string][] = [
			[t(ITEM_SETTING_NAMES.category), itemCategoryName(item.category, ruleset)],
			[t(ITEM_SETTING_NAMES.types), ((item.types.length === 0)
				? t({
					id: 'itemInspect.noTypes',
					defaultMessage: 'None',
					description: 'In the Inspect dialog, which shows what an item is, in place of its types when it has none'
				})
				: itemTypesText(item.types, ruleset))],
			[t({
				id: 'itemInspect.book',
				defaultMessage: 'Book',
				description: 'In the Inspect dialog, which shows what an item is, the label of the book of game rules it comes from, such as the Core Rulebook'
			}), ((item.rulebook === null)
				? t({
					id: 'itemInspect.universeItem',
					defaultMessage: 'Made for this universe',
					description: 'In the Inspect dialog, which shows what an item is, in place of the book it comes from, for an item the universe\'s creators added rather than one from a book of game rules'
				})
				: rulebookName(ruleset, item.rulebook))],
			[t(ITEM_SETTING_NAMES.equips), itemEquipsText(item.equips, ruleset)]
		];

		this.title.textContent = name;
		this.details.replaceChildren(...entries.flatMap(([term, value]) =>
		{
			const termElement = document.createElement('dt');
			const valueElement = document.createElement('dd');

			termElement.textContent = term;
			valueElement.textContent = value;

			return([termElement, valueElement]);
		}));
		this.description.textContent = description;
		this.description.hidden = (description === '');
		this.dialog.showModal();
		this.title.focus();
	}
}

/**
 * The page's Inspect dialog, made the first time an item is inspected
 */
let shared: ItemInspectDialog | undefined;

/**
 * Opens the page's Inspect dialog on an item
 *
 * @param item The item
 * @param ruleset The universe's ruleset
 */
export function inspectItem(item: InspectedItem, ruleset: Ruleset): void
{
	shared ??= new ItemInspectDialog();
	shared.open(item, ruleset);
}
