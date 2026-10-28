import ascendingIcon from 'virtual:icon/ph:caret-up';
import descendingIcon from 'virtual:icon/ph:caret-down';
import unsortedIcon from 'virtual:icon/ph:caret-up-down';
import type { SortDirection, SortOrder } from '@multiverse-kiln/shared';

import { t } from '../localization';
import { announce } from './announcer';

/**
 * A heading that sorts its table, with the button in it and the icon showing which way it sorts
 */
interface SortHeading
{
	heading: HTMLTableCellElement;
	button: HTMLButtonElement;
	icon: HTMLElement;
}

/**
 * Sorts a table by the column whose heading the player clicks: going up, then going down when clicked
 * again. Each heading that can sort holds a button and names its column in data-sort:
 *
 * <th scope="col" data-sort="name"><button type="button" class="sort-button" data-message="...">Name</button></th>
 *
 * The heading sorted by gets aria-sort and an arrow, the others an arrow both ways, and screen readers are
 * told how the table is sorted. The table's owner does the sorting, so a list paged on the server can be
 * sorted there
 */
export class TableSorter<Column extends string>
{
	private readonly headings = new Map<Column, SortHeading>();
	private current: SortOrder<Column>;

	/**
	 * @param table The table
	 * @param columns The columns it can be sorted by, which its data-sort headings name
	 * @param defaultOrder How it is sorted until a heading is clicked, and after reset()
	 * @param onSort Called with the new order when the player sorts the table
	 */
	constructor(table: HTMLTableElement, columns: readonly Column[], private readonly defaultOrder: SortOrder<Column>, private readonly onSort: (order: SortOrder<Column>) => void)
	{
		this.current = defaultOrder;

		for (const heading of table.querySelectorAll<HTMLTableCellElement>('thead th[data-sort]'))
		{
			const column = columns.find((candidate) => (candidate === heading.dataset.sort));
			const button = heading.querySelector('button');

			if ((column === undefined) || !button)
			{
				throw new Error(`The heading sorting by ${heading.dataset.sort ?? ''} needs a button and one of the table's columns in data-sort`);
			}

			const icon = document.createElement('span');

			icon.className = 'sort-icon';
			button.append(icon);
			button.addEventListener('click', () =>
			{
				this.sortBy(column);
			});
			this.headings.set(column, { heading, button, icon });
		}

		this.show();
	}

	/**
	 * How the table is sorted
	 *
	 * @return The column and direction
	 */
	get order(): SortOrder<Column>
	{
		return(this.current);
	}

	/**
	 * Goes back to the default order, without calling onSort
	 */
	reset(): void
	{
		this.current = this.defaultOrder;
		this.show();
	}

	/**
	 * Sorts by a column: going up, or the other way when the table is sorted by it already
	 *
	 * @param column The column
	 */
	private sortBy(column: Column): void
	{
		const direction: SortDirection = (((this.current.column === column) && (this.current.direction === 'ascending')) ? 'descending' : 'ascending');

		this.current = { column, direction };
		this.show();
		announce(t({
			id: 'table.sorted',
			defaultMessage: '{direction, select, ascending {Sorted by {column}, ascending} other {Sorted by {column}, descending}}',
			description: 'Read out by screen readers when a table\'s column heading is clicked to sort it; {column} is the heading'
		}, {
			column: (this.headings.get(column)?.button.textContent?.trim() ?? ''),
			direction
		}));
		this.onSort(this.current);
	}

	/**
	 * Shows which column the table is sorted by, and which way
	 */
	private show(): void
	{
		for (const [column, { heading, icon }] of this.headings)
		{
			const sorted = (column === this.current.column);

			if (sorted)
			{
				heading.setAttribute('aria-sort', this.current.direction);
			}
			else
			{
				heading.removeAttribute('aria-sort');
			}

			icon.innerHTML = (sorted
				? ((this.current.direction === 'ascending') ? ascendingIcon : descendingIcon)
				: unsortedIcon);
			icon.classList.toggle('unsorted', !sorted);
		}
	}
}
