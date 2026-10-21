import { canEditWorld, ITEM_KINDS, MAX_ITEMS_PER_PAGE, type EditableUniverse, type EditorItem, type ItemListPayload, type ItemListQuery, type Ruleset } from '@multiverse-kiln/shared';

import { formatList, t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { getElement, setOptions, showMessage, type SelectOption } from '../dom';
import { createItemIcon, itemCategoryName, itemName, itemTypeName } from '../itemNames';
import { ItemDialog } from './ItemDialog';

/**
 * How long the name filter waits after the last key before searching, in milliseconds
 */
const SEARCH_DELAY_MS = 250;

/**
 * The Items tab: every item the universe can give characters, filtered and a page at a time, opening the item editor
 */
export class ItemsTab
{
	private readonly nameFilter = getElement('item-filter-name', HTMLInputElement);
	private readonly categoryFilter = getElement('item-filter-category', HTMLSelectElement);
	private readonly typeFilter = getElement('item-filter-type', HTMLSelectElement);
	private readonly enabledFilter = getElement('item-filter-enabled', HTMLSelectElement);
	private readonly customFilter = getElement('item-filter-custom', HTMLSelectElement);
	private readonly editedFilter = getElement('item-filter-edited', HTMLSelectElement);
	private readonly addButton = getElement('item-add', HTMLButtonElement);
	private readonly rows = getElement('item-rows', HTMLTableSectionElement);
	private readonly empty = getElement('item-empty', HTMLElement);
	private readonly page = getElement('item-page', HTMLElement);
	private readonly previousButton = getElement('item-previous', HTMLButtonElement);
	private readonly nextButton = getElement('item-next', HTMLButtonElement);
	private readonly dialog: ItemDialog;

	private universe: EditableUniverse | undefined;

	/**
	 * How many matching items come before the page shown
	 */
	private offset = 0;

	/**
	 * Changes with every request for a page, so a page that arrives after a newer request is ignored
	 */
	private requestVersion = 0;

	private searchTimer: number | undefined;

	/**
	 * @param api The editor's API
	 */
	constructor(private readonly api: EditorApi)
	{
		this.dialog = new ItemDialog(api);

		for (const filter of [this.enabledFilter, this.customFilter, this.editedFilter])
		{
			setOptions(filter, [
				{
					value: '',
					label: t({
						id: 'editor.items.filterAny',
						defaultMessage: 'Any',
						description: 'Choice of a yes-or-no item filter that shows every item'
					})
				},
				{
					value: 'true',
					label: t({
						id: 'editor.items.filterYes',
						defaultMessage: 'Yes',
						description: 'Choice of a yes-or-no item filter, e.g. Enabled: Yes'
					})
				},
				{
					value: 'false',
					label: t({
						id: 'editor.items.filterNo',
						defaultMessage: 'No',
						description: 'Choice of a yes-or-no item filter, e.g. Enabled: No'
					})
				}
			]);
		}

		for (const filter of [this.enabledFilter, this.customFilter, this.editedFilter, this.typeFilter])
		{
			filter.addEventListener('change', () =>
			{
				this.offset = 0;
				void this.refresh();
			});
		}

		this.categoryFilter.addEventListener('change', () =>
		{
			if (this.universe)
			{
				this.showTypeOptions(this.universe.ruleset);
			}

			this.offset = 0;
			void this.refresh();
		});

		this.nameFilter.addEventListener('input', () =>
		{
			window.clearTimeout(this.searchTimer);
			this.searchTimer = window.setTimeout(() =>
			{
				this.offset = 0;
				void this.refresh();
			}, SEARCH_DELAY_MS);
		});

		this.previousButton.addEventListener('click', () =>
		{
			this.offset = Math.max(0, this.offset - MAX_ITEMS_PER_PAGE);
			void this.refresh();
		});

		this.nextButton.addEventListener('click', () =>
		{
			this.offset += MAX_ITEMS_PER_PAGE;
			void this.refresh();
		});

		this.addButton.addEventListener('click', () =>
		{
			this.openItem(undefined);
		});
	}

	/**
	 * Lists a universe's items from the first page, with no filters
	 *
	 * @param universe The universe
	 */
	open(universe: EditableUniverse): void
	{
		const kinds = ITEM_KINDS[universe.ruleset];

		this.universe = universe;
		this.offset = 0;
		this.nameFilter.value = '';
		setOptions(this.categoryFilter, [
			anyOption(),
			...kinds.categories.map((category) => ({
				value: category,
				label: itemCategoryName(category, universe.ruleset)
			}))
		]);
		this.categoryFilter.value = '';
		this.showTypeOptions(universe.ruleset);
		this.enabledFilter.value = '';
		this.customFilter.value = '';
		this.editedFilter.value = '';
		this.addButton.hidden = !canEditWorld(universe.role);
		void this.refresh();
	}

	/**
	 * Offers the types in the category chosen, or every type when none is, keeping the type chosen if
	 * it is still offered
	 *
	 * @param ruleset The universe's ruleset
	 */
	private showTypeOptions(ruleset: Ruleset): void
	{
		const category = this.categoryFilter.value;
		const chosen = this.typeFilter.value;
		const types = Object.entries(ITEM_KINDS[ruleset].types)
			.filter(([, typeCategory]) => ((category === '') || (typeCategory === category)))
			.map(([type]) => type);

		setOptions(this.typeFilter, [
			anyOption(),
			...types.map((type) => ({
				value: type,
				label: itemTypeName(type, ruleset)
			}))
		]);
		this.typeFilter.value = (types.includes(chosen) ? chosen : '');
	}

	/**
	 * Loads and shows the page of items the filters and offset ask for
	 */
	private async refresh(): Promise<void>
	{
		const universe = this.universe;
		const version = ++this.requestVersion;

		if (!universe)
		{
			return;
		}

		const query: ItemListQuery = {
			name: (this.nameFilter.value.trim() || undefined),
			category: (this.categoryFilter.value || undefined),
			type: (this.typeFilter.value || undefined),
			enabled: filterValue(this.enabledFilter),
			custom: filterValue(this.customFilter),
			edited: filterValue(this.editedFilter),
			offset: this.offset,
			limit: MAX_ITEMS_PER_PAGE
		};
		let page: ItemListPayload;

		try
		{
			page = await this.api.listItems(universe.id, query);
		}
		catch (error)
		{
			if (version === this.requestVersion)
			{
				showMessage(this.empty, describeEditorError(error, {
					id: 'editor.items.listFailed',
					defaultMessage: 'Could not list the items.',
					description: 'Shown on the Items tab when the items couldn\'t be loaded'
				}));
			}

			return;
		}

		if (version !== this.requestVersion)
		{
			return;
		}

		// Deleting the last item of the last page leaves nothing to show there
		if ((page.items.length === 0) && (this.offset > 0))
		{
			this.offset = Math.max(0, this.offset - MAX_ITEMS_PER_PAGE);
			void this.refresh();
			return;
		}

		this.rows.replaceChildren(...page.items.map((item) => this.createRow(item, universe)));
		showMessage(this.empty, ((page.items.length === 0)
			? t({
				id: 'editor.items.none',
				defaultMessage: 'No items match.',
				description: 'Shown instead of the table when no item matches the filters'
			})
			: undefined));
		this.page.textContent = ((page.total === 0)
			? ''
			: t({
				id: 'pager.range',
				defaultMessage: '{first, number}-{last, number} of {total, number}',
				description: 'Which items of a list a page shows, e.g. 1-500 of 1200'
			}, {
				first: this.offset + 1,
				last: this.offset + page.items.length,
				total: page.total
			}));
		this.previousButton.disabled = (this.offset === 0);
		this.nextButton.disabled = ((this.offset + page.items.length) >= page.total);
	}

	/**
	 * An item's row in the table: its icon, name (opening the item editor), type, and whether it is
	 * custom, edited or disabled
	 *
	 * @param item The item
	 * @param universe The universe whose item it is
	 * @return The row
	 */
	private createRow(item: EditorItem, universe: EditableUniverse): HTMLTableRowElement
	{
		const row = document.createElement('tr');
		const nameButton = document.createElement('button');
		const tags = [
			(item.custom
				? t({
					id: 'editor.items.customTag',
					defaultMessage: 'custom',
					description: 'In the last column of the item table, for an item made for this universe'
				})
				: undefined),
			(item.edited
				? t({
					id: 'editor.items.editedTag',
					defaultMessage: 'edited',
					description: 'In the last column of the item table, for one of the ruleset\'s items that this universe changed'
				})
				: undefined),
			(item.enabled
				? undefined
				: t({
					id: 'editor.items.disabledTag',
					defaultMessage: 'disabled',
					description: 'In the last column of the item table, for an item characters can\'t be given'
				}))
		].filter((tag) => (tag !== undefined));
		const cells = [
			createItemIcon(item.type, universe.ruleset),
			nameButton,
			itemTypeName(item.type, universe.ruleset),
			formatList(tags)
		];

		nameButton.type = 'button';
		nameButton.className = 'link-button';
		nameButton.textContent = itemName(item, universe.ruleset);
		nameButton.addEventListener('click', () =>
		{
			this.openItem(item);
		});

		for (const content of cells)
		{
			const cell = document.createElement('td');

			cell.append(content);
			row.append(cell);
		}

		return(row);
	}

	/**
	 * Opens the item editor, refreshing the list after a change
	 *
	 * @param item The item, or undefined to add one
	 */
	private openItem(item: EditorItem | undefined): void
	{
		if (this.universe)
		{
			this.dialog.open(this.universe, item, () =>
			{
				void this.refresh();
			});
		}
	}
}

/**
 * The choice of a kind or type filter that shows every item
 *
 * @return The choice
 */
function anyOption(): SelectOption
{
	return({
		value: '',
		label: t({
			id: 'editor.items.anyKind',
			defaultMessage: 'Any',
			description: 'Choice of the item kind or type filter that shows items of every kind or type'
		})
	});
}

/**
 * A yes/no/any filter's value
 *
 * @param select The filter
 * @return true, false, or undefined for any
 */
function filterValue(select: HTMLSelectElement): boolean | undefined
{
	return(((select.value === '') ? undefined : (select.value === 'true')));
}
