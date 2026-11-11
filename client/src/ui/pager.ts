import { t } from '../localization';
import { announce } from './announcer';

/**
 * Shows which rows of a list a page holds in the list's pager: "1-20 of 45" on screen, which screen readers
 * get as "1 to 20 of 45", since they can read the dash as minus. Shows nothing when no rows match
 *
 * @param page The pager's element for the range, between Previous and Next
 * @param offset How many matching rows come before the page
 * @param shown How many rows the page holds
 * @param total How many rows match in all
 */
export function showPageRange(page: HTMLElement, offset: number, shown: number, total: number): void
{
	if (total === 0)
	{
		page.replaceChildren();
		return;
	}

	const range = {
		first: (offset + 1),
		last: (offset + shown),
		total
	};
	const visible = document.createElement('span');
	const spoken = document.createElement('span');

	visible.textContent = t({
		id: 'pager.range',
		defaultMessage: '{first, number}-{last, number} of {total, number}',
		description: 'Which items of a list a page shows, e.g. 1-500 of 1200'
	}, range);
	visible.setAttribute('aria-hidden', 'true');
	spoken.className = 'visually-hidden';
	spoken.textContent = t({
		id: 'pager.rangeSpoken',
		defaultMessage: '{first, number} to {last, number} of {total, number}',
		description: 'Which items of a list a page shows, e.g. 1 to 500 of 1200, read out by screen readers in place of the 1-500 of 1200 shown between a list\'s Previous and Next buttons, and when the page or the list\'s search or filters change'
	}, range);
	page.replaceChildren(visible, spoken);
}

/**
 * Reads out what a paged list shows once the player has moved to another page or changed its search or
 * filters: the message shown in place of its rows, such as that none match, or else which rows the page
 * holds, e.g. 21 to 40 of 45
 *
 * @param page The pager's element for the range, filled by showPageRange()
 * @param empty The message shown in place of the rows, hidden while there are rows
 */
export function announceListPage(page: HTMLElement, empty: HTMLElement): void
{
	const text = (empty.hidden ? page.querySelector('.visually-hidden')?.textContent : empty.textContent);

	if (text)
	{
		announce(text);
	}
}
