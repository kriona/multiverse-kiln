import { canEditWorld, ITEM_KINDS, ITEM_SORT_COLUMNS, MAX_ITEMS_PER_PAGE, type EditableUniverse, type EditorItem, type ItemListPayload, type ItemListQuery, type ItemSettings, type ItemSortColumn, type Ruleset } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { getElement, setOptions, showMessage, type SelectOption } from '../dom';
import { formMessages } from '../formMessages';
import { createItemIcon, itemCategoryName, itemName, itemTypeName } from '../itemNames';
import { TableSorter } from '../tableSorter';
import { editorMessages } from './editorMessages';
import { ItemDialog } from './ItemDialog';
import type { EditorSave, SavedIds } from './editorSave';
import type { SavableTab } from './SaveBar';
import { describeRefusedChange, joinTags, listChange, listRef, markStagedRow, StagedChanges, stagedPage, stagedTag, type StagedChange, type StagedState } from './stagedChanges';

/**
 * How long the name filter waits after the last key before searching, in milliseconds
 */
const SEARCH_DELAY_MS = 250;

/**
 * The Items tab: every item the universe can give characters, filtered, sorted by a column (by the
 * server, before paging) and a page at a time, opening the item editor. Changes wait on the page until the tab is saved: changed items show their changes on the
 * page they are on, and items added since show at the top of the first page, whatever the filters
 */
export class ItemsTab implements SavableTab
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
	private readonly error = getElement('item-list-error', HTMLElement);
	private readonly page = getElement('item-page', HTMLElement);
	private readonly previousButton = getElement('item-previous', HTMLButtonElement);
	private readonly nextButton = getElement('item-next', HTMLButtonElement);
	private readonly dialog = new ItemDialog();
	private readonly sorter: TableSorter<ItemSortColumn>;

	/**
	 * The changes made since the items were last saved
	 */
	readonly changes = new StagedChanges<ItemSettings>();

	/**
	 * The changes the save being sent holds
	 */
	private collected: readonly StagedChange<ItemSettings>[] = [];

	private universe: EditableUniverse | undefined;

	/**
	 * The page of items shown, as it was last loaded
	 */
	private items: EditorItem[] = [];

	/**
	 * Every item loaded since the universe was opened, by ID, to name an item whose change failed to save
	 * when it isn't on the page shown
	 */
	private readonly known = new Map<number, EditorItem>();

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
		this.sorter = new TableSorter(getElement('item-table', HTMLTableElement), ITEM_SORT_COLUMNS, {
			column: 'name',
			direction: 'ascending'
		}, () =>
		{
			this.offset = 0;
			void this.refresh();
		});

		for (const filter of [this.enabledFilter, this.customFilter, this.editedFilter])
		{
			setOptions(filter, [
				{
					value: '',
					label: t(formMessages.filterAny)
				},
				{
					value: 'true',
					label: t(formMessages.filterYes)
				},
				{
					value: 'false',
					label: t(formMessages.filterNo)
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
		this.items = [];
		this.known.clear();
		this.changes.clear();
		showMessage(this.error, undefined);
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
		this.sorter.reset();
		this.addButton.hidden = !canEditWorld(universe.role);
		void this.refresh();
	}

	/**
	 * Whether the player may change the items
	 *
	 * @return True for a creator or builder
	 */
	canSave(): boolean
	{
		return((this.universe !== undefined) && canEditWorld(this.universe.role));
	}

	/**
	 * Adds the changes to a save, in the order they were made
	 *
	 * @param save The save
	 * @return True
	 */
	collect(save: EditorSave): boolean
	{
		const universe = this.universe;

		showMessage(this.error, undefined);

		if (universe)
		{
			this.collected = this.changes.collect(save, (change) => listChange('Item', change), (change, refusal) =>
			{
				const item = this.itemWithChanges(change.id);

				showMessage(this.error, describeRefusedChange(change, refusal, (item ? itemName(item, universe.ruleset) : ''), !item?.custom));
			});
		}

		return(true);
	}

	/**
	 * Takes the changes as saved, and loads the page afresh
	 *
	 * @param ids The IDs the save gave the items it made
	 */
	async saved(ids: SavedIds): Promise<void>
	{
		this.changes.markSaved(this.collected, (id) => ids.number(listRef('Item', id)));
		this.collected = [];
		await this.refresh();
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
	 * Loads the page of items the filters and offset ask for, then shows it with the changes made since
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
			sort: this.sorter.order.column,
			direction: this.sorter.order.direction,
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

		this.items = page.items;

		for (const item of page.items)
		{
			this.known.set(item.id, item);
		}

		this.render();
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
	 * Shows the page of items with the changes made since it was loaded, and on the first page the items
	 * added since, first
	 */
	private render(): void
	{
		const universe = this.universe;

		if (!universe)
		{
			return;
		}

		const shown = stagedPage(this.items, this.changes, (this.offset === 0), (id, settings) => ({
			id,
			key: null,
			...settings,
			custom: true,
			edited: false
		}));

		this.rows.replaceChildren(...shown.map(({ item, state }) => this.createRow(item, state, universe)));
		showMessage(this.empty, ((shown.length === 0)
			? t({
				id: 'editor.items.none',
				defaultMessage: 'No items match.',
				description: 'Shown instead of the list of items when no item matches the search or filters: on the Items tab and in the dialog for choosing items'
			})
			: undefined));
	}

	/**
	 * An item as the list shows it, with its changes, wherever it is
	 *
	 * @param itemId The item's ID
	 * @return The item, or undefined when it isn't known
	 */
	private itemWithChanges(itemId: number): EditorItem | undefined
	{
		const known = this.known.get(itemId);
		const settings = this.changes.settingsOf(itemId);

		if (!known)
		{
			return((settings === undefined) ? undefined : { id: itemId, key: null, ...settings, custom: true, edited: false });
		}

		return({ ...known, ...settings });
	}

	/**
	 * An item's row in the table: its icon, name (opening the item editor), type, and whether it is
	 * custom, edited, disabled or not saved yet
	 *
	 * @param item The item
	 * @param state How it differs from what is saved
	 * @param universe The universe whose item it is
	 * @return The row
	 */
	private createRow(item: EditorItem, state: StagedState, universe: EditableUniverse): HTMLTableRowElement
	{
		const row = document.createElement('tr');
		const nameButton = document.createElement('button');
		const tags = [
			(item.custom
				? t(editorMessages.customTag)
				: undefined),
			(item.edited
				? t(editorMessages.editedTag)
				: undefined),
			(item.enabled
				? undefined
				: t(editorMessages.disabledTag)),
			stagedTag(state, !item.custom)
		];
		const cells = [
			createItemIcon(item.type, universe.ruleset),
			nameButton,
			itemTypeName(item.type, universe.ruleset),
			joinTags(...tags)
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

		return(markStagedRow(row, state, !item.custom));
	}

	/**
	 * Opens the item editor, showing its changes in the list
	 *
	 * @param item The item, or undefined to add one
	 */
	private openItem(item: EditorItem | undefined): void
	{
		if (this.universe)
		{
			this.dialog.open(this.universe, item, this.changes.edit(item?.id), () =>
			{
				this.render();
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
		label: t(formMessages.filterAny)
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
