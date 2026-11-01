import { MAX_ADMIN_ROWS_PER_PAGE, MAX_ADMIN_SEARCH_LENGTH, type MessageSource } from '@multiverse-kiln/shared';

import { showAdminRefusal } from '../AdminPage';
import { t } from '../localization';
import { describeEditorError } from '../network/editorApi';
import { playerPageUrl } from '../pages';
import { announce } from './announcer';
import { getElement, setOptions, showMessage } from './dom';
import { formMessages } from './formMessages';

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
	 * Shown when a page couldn't be loaded for any reason but the server refusing the admin page
	 */
	loadFailed: MessageSource;
}

/**
 * A list on an admin page, such as the login sessions or the players: a table the server fills a page
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
				this.offset = 0;
				void this.refresh(true);
			}, SEARCH_DELAY_MS);
		});

		this.filter.addEventListener('change', () =>
		{
			this.offset = 0;
			void this.refresh(true);
		});

		this.previousButton.addEventListener('click', () =>
		{
			this.offset = Math.max(0, (this.offset - MAX_ADMIN_ROWS_PER_PAGE));
			void this.refresh(false);
		});

		this.nextButton.addEventListener('click', () =>
		{
			this.offset += MAX_ADMIN_ROWS_PER_PAGE;
			void this.refresh(false);
		});
	}

	/**
	 * Loads the first page
	 */
	async load(): Promise<void>
	{
		await this.refresh(false);
	}

	/**
	 * Loads the page the search, filter and offset ask for, and shows it
	 *
	 * @param announceMatches Whether to tell screen readers how many rows match, as after a search
	 */
	private async refresh(announceMatches: boolean): Promise<void>
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
				offset: this.offset,
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
				this.previousButton.disabled = (this.offset === 0);
			}

			return;
		}

		if (version !== this.requestVersion)
		{
			return;
		}

		// Rows can go between pages, such as sessions ending, leaving nothing on the last page
		if ((page.rows.length === 0) && (this.offset > 0))
		{
			this.offset = (Math.max(0, (Math.ceil(page.total / MAX_ADMIN_ROWS_PER_PAGE) - 1)) * MAX_ADMIN_ROWS_PER_PAGE);
			await this.refresh(announceMatches);
			return;
		}

		showMessage(this.error, undefined);
		this.loading.hidden = true;
		this.rows.replaceChildren(...page.rows.map((row) => this.options.render(row)));
		this.empty.hidden = (page.rows.length > 0);
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
		this.previousButton.disabled = (this.offset === 0);
		this.nextButton.disabled = ((this.offset + page.rows.length) >= page.total);

		if (announceMatches)
		{
			announce(t({
				id: 'admin.matches',
				defaultMessage: '{total, plural, =0 {Nothing matches} one {# match} other {# matches}}',
				description: 'Read out by screen readers once an admin page\'s list of sessions or players has been narrowed by its search or filter: how many rows match'
			}, {
				total: page.total
			}));
		}
	}
}

/**
 * A table cell naming a player: their name, linking to their profile, and their username
 *
 * @param displayName The player's name
 * @param username Their username
 * @return The cell
 */
export function playerCell(displayName: string, username: string): HTMLTableCellElement
{
	const cell = document.createElement('td');
	const link = document.createElement('a');
	const handle = document.createElement('span');

	link.href = playerPageUrl(username);
	link.textContent = displayName;
	link.translate = false;
	handle.className = 'admin-username';
	handle.textContent = `@${username}`;
	handle.translate = false;
	cell.append(link, ' ', handle);

	return(cell);
}

/**
 * A table cell of short notes about a row, such as Server admin, each a tag of its own
 *
 * @param notes The notes, in the player's language
 * @return The cell
 */
export function notesCell(notes: readonly string[]): HTMLTableCellElement
{
	const cell = document.createElement('td');

	cell.append(...notes.map((note) =>
	{
		const tag = document.createElement('span');

		tag.className = 'admin-tag';
		tag.textContent = note;

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
