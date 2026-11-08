import { defineMessages, MAX_ADMIN_ROWS_PER_PAGE, MAX_ADMIN_SEARCH_LENGTH, type MessageSource } from '@multiverse-kiln/shared';

import { showAdminRefusal } from '../AdminPage';
import { t } from '../localization';
import { describeEditorError } from '../network/editorApi';
import { announce } from './announcer';
import { getElement, setOptions, showMessage } from './dom';
import { formMessages } from './formMessages';

/**
 * Notes more than one admin page shows (see shared/src/localization.ts)
 */
export const adminNoteMessages = defineMessages({
	twoFactor: {
		id: 'admin.players.twoFactor',
		defaultMessage: '2FA',
		description: 'Note in the admin pages\' lists of players and server admins on an account with two-factor authentication on'
	}
});

/**
 * How long the list waits after the last key typed in its search before asking the server, in milliseconds
 */
const SEARCH_DELAY_MS = 250;

/**
 * What an admin list asks the server for
 */
export interface AdminListQuery
{
	/**
	 * The search, or undefined when it is empty
	 */
	search?: string;

	/**
	 * The yes-or-no filter, or undefined for Any
	 */
	filter?: boolean;

	offset: number;
	limit: number;
}

/**
 * A page of an admin list's rows, and how many match in all
 */
export interface AdminListPage<Row>
{
	rows: Row[];
	total: number;
}

/**
 * What an admin list loads and how it shows each row
 */
export interface AdminListOptions<Row>
{
	/**
	 * What the IDs of the list's elements start with: <prefix>-search, -filter, -rows, -loading, -empty,
	 * -list-error, -page, -previous and -next
	 */
	prefix: string;

	/**
	 * Loads a page of rows
	 *
	 * @param query The search, filter and page
	 * @return The page
	 */
	load: (query: AdminListQuery) => Promise<AdminListPage<Row>>;

	/**
	 * Makes a row's table row
	 *
	 * @param row The row
	 * @return The table row
	 */
	render: (row: Row) => HTMLTableRowElement;

	/**
	 * Which row a row is, kept when the list loads again, so keyboard focus stays on its controls (replaceRows())
	 *
	 * @param row The row
	 * @return Its key
	 */
	key?: (row: Row) => string;

	/**
	 * Shown when a page couldn't be loaded for any reason but the server refusing the admin page
	 */
	loadFailed: MessageSource;
}

/**
 * A list on an admin page, such as the login sessions, the players or the universes: a table the server fills a page
 * at a time, narrowed by a search and a yes-or-no filter, with Previous and Next under it. Screen
 * readers are told how many rows match after each search
 */
export class AdminList<Row>
{
	private readonly search: HTMLInputElement;
	private readonly filter: HTMLSelectElement;
	private readonly rows: HTMLTableSectionElement;
	private readonly loading: HTMLElement;
	private readonly empty: HTMLElement;
	private readonly error: HTMLElement;
	private readonly page: HTMLElement;
	private readonly previousButton: HTMLButtonElement;
	private readonly nextButton: HTMLButtonElement;

	/**
	 * How many matching rows come before the page shown
	 */
	private offset = 0;

	/**
	 * How many rows the page shown has
	 */
	private shownRows = 0;

	/**
	 * How many rows matched when the page shown was loaded
	 */
	private total = 0;

	/**
	 * Changes with every request for a page, so a page that arrives after a newer request is ignored
	 */
	private requestVersion = 0;

	private searchTimer: number | undefined;

	/**
	 * @param options What the list loads and how it shows each row
	 */
	constructor(private readonly options: AdminListOptions<Row>)
	{
		const { prefix } = options;

		this.search = getElement(`${prefix}-search`, HTMLInputElement);
		this.filter = getElement(`${prefix}-filter`, HTMLSelectElement);
		this.rows = getElement(`${prefix}-rows`, HTMLTableSectionElement);
		this.loading = getElement(`${prefix}-loading`, HTMLElement);
		this.empty = getElement(`${prefix}-empty`, HTMLElement);
		this.error = getElement(`${prefix}-list-error`, HTMLElement);
		this.page = getElement(`${prefix}-page`, HTMLElement);
		this.previousButton = getElement(`${prefix}-previous`, HTMLButtonElement);
		this.nextButton = getElement(`${prefix}-next`, HTMLButtonElement);

		this.search.maxLength = MAX_ADMIN_SEARCH_LENGTH;
		// Takes focus when the row that had it is gone and none are left
		this.empty.tabIndex = -1;
		setOptions(this.filter, [
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

		this.search.addEventListener('input', () =>
		{
			window.clearTimeout(this.searchTimer);
			this.searchTimer = window.setTimeout(() =>
			{
				void this.refresh(true, 0);
			}, SEARCH_DELAY_MS);
		});

		this.filter.addEventListener('change', () =>
		{
			void this.refresh(true, 0);
		});

		this.previousButton.addEventListener('click', () =>
		{
			void this.refresh(false, Math.max(0, (this.offset - MAX_ADMIN_ROWS_PER_PAGE)));
		});

		this.nextButton.addEventListener('click', () =>
		{
			void this.refresh(false, (this.offset + MAX_ADMIN_ROWS_PER_PAGE));
		});
	}

	/**
	 * Loads the first page
	 */
	async load(): Promise<void>
	{
		await this.refresh(false, 0);
	}

	/**
	 * Loads the page shown again, such as after a row was changed
	 */
	async reload(): Promise<void>
	{
		await this.refresh(false, this.offset);
	}

	/**
	 * Loads a page of the rows the search and filter ask for, and shows it
	 *
	 * @param announceMatches Whether to tell screen readers how many rows match, as after a search
	 * @param offset How many matching rows come before the page
	 */
	private async refresh(announceMatches: boolean, offset: number): Promise<void>
	{
		const version = ++this.requestVersion;
		const search = this.search.value.trim();
		let page: AdminListPage<Row>;

		this.previousButton.disabled = true;
		this.nextButton.disabled = true;

		try
		{
			page = await this.options.load({
				search: ((search === '') ? undefined : search),
				filter: ((this.filter.value === '') ? undefined : (this.filter.value === 'true')),
				offset,
				limit: MAX_ADMIN_ROWS_PER_PAGE
			});
		}
		catch (error)
		{
			if (version !== this.requestVersion)
			{
				return;
			}

			this.loading.hidden = true;

			if (!showAdminRefusal(error))
			{
				showMessage(this.error, describeEditorError(error, this.options.loadFailed));
				this.updatePageButtons();
			}

			return;
		}

		if (version !== this.requestVersion)
		{
			return;
		}

		// Rows can go between pages, such as sessions ending, leaving nothing on the last page. The rows and the
		// count are separate queries, so the count can still say rows remain from here on: each try starts at
		// least a page sooner, ending at the first page
		if ((page.rows.length === 0) && (offset > 0))
		{
			const lastPage = (Math.max(0, (Math.ceil(page.total / MAX_ADMIN_ROWS_PER_PAGE) - 1)) * MAX_ADMIN_ROWS_PER_PAGE);

			await this.refresh(announceMatches, Math.max(0, Math.min(lastPage, (offset - MAX_ADMIN_ROWS_PER_PAGE))));
			return;
		}

		this.offset = offset;
		this.shownRows = page.rows.length;
		this.total = page.total;
		showMessage(this.error, undefined);
		this.loading.hidden = true;
		this.empty.hidden = (page.rows.length > 0);
		replaceRows(this.rows, page.rows.map((row) =>
		{
			const element = this.options.render(row);

			if (this.options.key)
			{
				element.dataset.key = this.options.key(row);
			}

			return(element);
		}), (this.empty.hidden ? undefined : this.empty));
		this.page.textContent = ((page.total === 0)
			? ''
			: t({
				id: 'pager.range',
				defaultMessage: '{first, number}-{last, number} of {total, number}',
				description: 'Which items of a list a page shows, e.g. 1-500 of 1200'
			}, {
				first: (this.offset + 1),
				last: (this.offset + page.rows.length),
				total: page.total
			}));
		this.updatePageButtons();

		if (announceMatches)
		{
			announce(t({
				id: 'admin.matches',
				defaultMessage: '{total, plural, =0 {Nothing matches} one {# match} other {# matches}}',
				description: 'Read out by screen readers once an admin page\'s list of sessions, players or universes has been narrowed by its search or filter: how many rows match'
			}, {
				total: page.total
			}));
		}
	}

	/**
	 * Enables Previous when the page shown isn't the first, and Next when more rows matched after it
	 */
	private updatePageButtons(): void
	{
		this.previousButton.disabled = (this.offset === 0);
		this.nextButton.disabled = ((this.offset + this.shownRows) >= this.total);
	}
}

/**
 * The controls in a table row that can take keyboard focus
 */
const ROW_CONTROLS = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)';

/**
 * Replaces a table's rows. When keyboard focus was in one of them, as after a dialog opened from a row's
 * button closes, it moves to the same control of that row's new copy (rows are matched by their data-key
 * attribute), or when the row is gone, to the action of the row now in its place or of the last row, or
 * to the fallback when there are none, since removing the element with focus sends it to the top of the page
 *
 * @param body The table's body
 * @param rows The new rows
 * @param fallback What takes focus when the row that had it is gone and no row is left to take it
 */
export function replaceRows(body: HTMLTableSectionElement, rows: readonly HTMLTableRowElement[], fallback?: HTMLElement): void
{
	const focused = document.activeElement;
	const focusedRow = ((focused instanceof HTMLElement) ? focused.closest('tr') : null);

	if (!focused || !focusedRow || (focusedRow.parentElement !== body))
	{
		body.replaceChildren(...rows);
		return;
	}

	const rowIndex = [...body.rows].indexOf(focusedRow);
	const controlIndex = [...focusedRow.querySelectorAll(ROW_CONTROLS)].indexOf(focused);
	const key = focusedRow.dataset.key;
	const sameRow = ((key === undefined) ? undefined : rows.find((row) => (row.dataset.key === key)));
	let target: HTMLElement | undefined;

	body.replaceChildren(...rows);

	if (sameRow)
	{
		const controls = [...sameRow.querySelectorAll<HTMLElement>(ROW_CONTROLS)];

		target = controls[Math.min(Math.max(0, controlIndex), (controls.length - 1))];
	}
	else if (rows.length > 0)
	{
		const row = rows[Math.min(rowIndex, (rows.length - 1))];

		target = (row.querySelector<HTMLElement>(`.admin-actions :is(${ROW_CONTROLS})`) ?? row.querySelector<HTMLElement>(ROW_CONTROLS) ?? undefined);
	}

	(target ?? fallback)?.focus();
}

/**
 * What kind of note a tag is, which picks its color (.admin-tag-<tone> in admin.scss). Notes that mean the
 * same thing on different pages, such as Active and Connected, share one
 */
export type AdminNoteTone = 'online' | 'current' | 'remembered' | 'serverAdmin' | 'twoFactor' | 'password' | 'google' | 'discord' | 'warning';

/**
 * A short note about a row, such as Server admin
 */
export interface AdminNote
{
	/**
	 * The note, in the player's language
	 */
	text: string;

	tone: AdminNoteTone;
}

/**
 * A table cell of short notes about a row, each a tag of its own
 *
 * @param notes The notes
 * @return The cell
 */
export function notesCell(notes: readonly AdminNote[]): HTMLTableCellElement
{
	const cell = document.createElement('td');

	cell.append(...notes.map((note) =>
	{
		const tag = document.createElement('span');

		tag.className = `admin-tag admin-tag-${note.tone}`;
		tag.textContent = note.text;

		return(tag);
	}));

	return(cell);
}

/**
 * A table cell of plain text
 *
 * @param text The text
 * @return The cell
 */
export function textCell(text: string): HTMLTableCellElement
{
	const cell = document.createElement('td');

	cell.textContent = text;

	return(cell);
}
