import { canManageEditors, EDITOR_ROLE_NAMES, MAX_UNIVERSE_EDITS_PER_PAGE, type EditableUniverse, type Ruleset, type UniverseEdit, type UniverseEditListPayload } from '@multiverse-kiln/shared';

import { formatDateTime, t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { getElement, showMessage } from '../dom';
import { playerCell } from '../playerCell';
import { describeDetail, describeFieldChange } from './auditDetails';

/**
 * The Audit tab: every save made in the universe's editor, newest first, with who saved, the role they
 * saved with, when, and each thing it changed, with the value it gave each setting it changed. Each
 * save records itself, so the tab only lists them. Only for roles that may manage the universe's editors
 */
export class AuditTab
{
	private readonly rows = getElement('audit-rows', HTMLTableSectionElement);
	private readonly empty = getElement('audit-empty', HTMLElement);
	private readonly page = getElement('audit-page', HTMLElement);
	private readonly previousButton = getElement('audit-previous', HTMLButtonElement);
	private readonly nextButton = getElement('audit-next', HTMLButtonElement);

	private universe: EditableUniverse | undefined;

	/**
	 * How many saves come before the page shown
	 */
	private offset = 0;

	/**
	 * Changes with every request for a page, so a page that arrives after a newer request is ignored
	 */
	private requestVersion = 0;

	/**
	 * @param api The editor's API
	 */
	constructor(private readonly api: EditorApi)
	{
		this.previousButton.addEventListener('click', () =>
		{
			this.offset = Math.max(0, this.offset - MAX_UNIVERSE_EDITS_PER_PAGE);
			void this.refresh();
		});

		this.nextButton.addEventListener('click', () =>
		{
			this.offset += MAX_UNIVERSE_EDITS_PER_PAGE;
			void this.refresh();
		});
	}

	/**
	 * Lists a universe's saves from the newest, for a role that may see them
	 *
	 * @param universe The universe
	 */
	open(universe: EditableUniverse): void
	{
		this.universe = universe;
		this.offset = 0;
		this.rows.replaceChildren();
		showMessage(this.empty, undefined);
		this.page.textContent = '';
		this.previousButton.disabled = true;
		this.nextButton.disabled = true;
		void this.refresh();
	}

	/**
	 * Lists the saves again from the newest, after the editor saved
	 */
	reload(): void
	{
		this.offset = 0;
		void this.refresh();
	}

	/**
	 * Loads the page of saves the offset asks for, and shows it
	 */
	private async refresh(): Promise<void>
	{
		const universe = this.universe;
		const version = ++this.requestVersion;

		if (!universe || !canManageEditors(universe.role))
		{
			return;
		}

		let page: UniverseEditListPayload;

		try
		{
			page = await this.api.listEdits(universe.id, {
				offset: this.offset,
				limit: MAX_UNIVERSE_EDITS_PER_PAGE
			});
		}
		catch (error)
		{
			if (version === this.requestVersion)
			{
				this.rows.replaceChildren();
				showMessage(this.empty, describeEditorError(error, {
					id: 'editor.audit.listFailed',
					defaultMessage: 'Could not list the saves.',
					description: 'Shown on the editor\'s Audit tab when the record of saves made in the universe\'s editor couldn\'t be loaded'
				}));
			}

			return;
		}

		if (version !== this.requestVersion)
		{
			return;
		}

		this.rows.replaceChildren(...page.edits.map((edit) => createRow(edit, universe.ruleset)));
		showMessage(this.empty, ((page.total > 0)
			? undefined
			: t({
				id: 'editor.audit.none',
				defaultMessage: 'Nothing has been saved in this universe\'s editor yet.',
				description: 'Shown on the editor\'s Audit tab instead of the list of saves when nobody has saved a change to the universe yet'
			})));
		this.page.textContent = ((page.total === 0)
			? ''
			: t({
				id: 'pager.range',
				defaultMessage: '{first, number}-{last, number} of {total, number}',
				description: 'Which items of a list a page shows, e.g. 1-500 of 1200'
			}, {
				first: this.offset + 1,
				last: this.offset + page.edits.length,
				total: page.total
			}));
		this.previousButton.disabled = (this.offset === 0);
		this.nextButton.disabled = ((this.offset + page.edits.length) >= page.total);
	}
}

/**
 * A save's row: when it was made, the player who made it (linking to their profile), the role they
 * made it with, and what it changed
 *
 * @param edit The save
 * @param ruleset The universe's ruleset
 * @return The row
 */
function createRow(edit: UniverseEdit, ruleset: Ruleset): HTMLTableRowElement
{
	const row = document.createElement('tr');
	const saved = document.createElement('td');
	const role = document.createElement('td');
	let player: HTMLTableCellElement;

	saved.textContent = formatDateTime(edit.savedAt);

	if (edit.player === null)
	{
		player = document.createElement('td');
		player.textContent = t({
			id: 'editor.audit.deletedPlayer',
			defaultMessage: 'Deleted account',
			description: 'In the Player column of the editor\'s Audit tab, in place of the player who made a save, once they have deleted their account'
		});
	}
	else
	{
		player = playerCell(edit.player.displayName, edit.player.username);
	}

	role.textContent = t(EDITOR_ROLE_NAMES[edit.role]);

	const changes = createChangesCell(edit, ruleset);

	if (edit.draft)
	{
		const note = document.createElement('p');

		note.className = 'hint';
		note.textContent = t({
			id: 'editor.audit.draftSave',
			defaultMessage: 'Saved to the draft',
			description: 'At the top of the Changes column of the editor\'s Audit tab, for a save made to the universe\'s draft (a copy players don\'t see until it is applied) rather than its live version'
		});
		changes.prepend(note);
	}

	row.append(saved, player, role, changes);

	return(row);
}

/**
 * A save's Changes cell: each thing it changed on its own line, by name, with a line under it for each
 * setting it changed and the value it changed it to
 *
 * @param edit The save
 * @param ruleset The universe's ruleset, which names its default tiles, items, races, classes and themes
 * @return The cell
 */
function createChangesCell(edit: UniverseEdit, ruleset: Ruleset): HTMLTableCellElement
{
	const cell = document.createElement('td');

	if ((edit.details === null) || (edit.details.length === 0))
	{
		cell.textContent = t({
			id: 'editor.audit.notCounted',
			defaultMessage: 'Not recorded',
			description: 'In the Changes column of the editor\'s Audit tab, for a save made before the site recorded what each save changed'
		});
		return(cell);
	}

	cell.append(createList(edit.details.map((detail) =>
	{
		const item = document.createElement('li');

		item.textContent = describeDetail(detail, ruleset);

		if (detail.fields.length > 0)
		{
			item.append(createList(detail.fields.map((change) =>
			{
				const line = document.createElement('li');

				line.textContent = describeFieldChange(change, detail, ruleset);

				return(line);
			})));
		}

		return(item);
	})));

	return(cell);
}

/**
 * A list of the Changes column's lines
 *
 * @param items The lines
 * @return The list
 */
function createList(items: readonly HTMLLIElement[]): HTMLUListElement
{
	const list = document.createElement('ul');

	list.className = 'audit-details';
	list.append(...items);

	return(list);
}
