import { canEditWorld, EDITOR_CHARACTER_SORT_COLUMNS, MAX_CHARACTERS_PER_PAGE, type EditableUniverse, type EditorCharacter, type EditorCharacterListPayload, type EditorCharacterListQuery, type EditorCharacterSortColumn, type EditorClass, type EditorRace } from '@multiverse-kiln/shared';

import { formatDateTime, t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { characterMessages } from '../characterMessages';
import { getElement, setOptions, showMessage } from '../dom';
import { formMessages } from '../formMessages';
import { announceListPage, showPageRange } from '../pager';
import { playerCell } from '../playerCell';
import { characterDescription, className, raceName } from '../raceAndClassNames';
import { TableSorter } from '../tableSorter';
import { joinTags } from './stagedChanges';

/**
 * How long the search waits after the last key before asking the server, in milliseconds
 */
const SEARCH_DELAY_MS = 250;

/**
 * The Character List tab: every character players have made in the universe, with their race and
 * class, player, when they were made and whether they are in a group or waiting to be deleted. The
 * server searches, filters, sorts and pages them. Characters belong to their players, so the tab only
 * lists them and has nothing to save
 */
export class CharacterListTab
{
	private readonly search = getElement('character-list-search', HTMLInputElement);
	private readonly raceFilter = getElement('character-list-race', HTMLSelectElement);
	private readonly classFilter = getElement('character-list-class', HTMLSelectElement);
	private readonly groupFilter = getElement('character-list-in-group', HTMLSelectElement);
	private readonly rows = getElement('character-list-rows', HTMLTableSectionElement);
	private readonly empty = getElement('character-list-empty', HTMLElement);
	private readonly page = getElement('character-list-page', HTMLElement);
	private readonly previousButton = getElement('character-list-previous', HTMLButtonElement);
	private readonly nextButton = getElement('character-list-next', HTMLButtonElement);
	private readonly sorter: TableSorter<EditorCharacterSortColumn>;

	private universe: EditableUniverse | undefined;

	/**
	 * How many matching characters come before the page shown
	 */
	private offset = 0;

	/**
	 * Changes with every request for a page, so a page that arrives after a newer request is ignored
	 */
	private requestVersion = 0;

	/**
	 * Changes every time a universe is opened, so races and classes that arrive for an earlier one are ignored
	 */
	private openVersion = 0;

	private searchTimer: number | undefined;

	/**
	 * @param api The editor's API
	 */
	constructor(private readonly api: EditorApi)
	{
		this.sorter = new TableSorter(getElement('character-list-table', HTMLTableElement), EDITOR_CHARACTER_SORT_COLUMNS, {
			column: 'name',
			direction: 'ascending'
		}, () =>
		{
			this.reload(false);
		});

		setOptions(this.groupFilter, [
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

		for (const filter of [this.raceFilter, this.classFilter, this.groupFilter])
		{
			filter.addEventListener('change', () =>
			{
				this.reload(true);
			});
		}

		this.search.addEventListener('input', () =>
		{
			window.clearTimeout(this.searchTimer);
			this.searchTimer = window.setTimeout(() =>
			{
				this.reload(true);
			}, SEARCH_DELAY_MS);
		});

		this.previousButton.addEventListener('click', () =>
		{
			this.offset = Math.max(0, this.offset - MAX_CHARACTERS_PER_PAGE);
			void this.refresh(true);
		});

		this.nextButton.addEventListener('click', () =>
		{
			this.offset += MAX_CHARACTERS_PER_PAGE;
			void this.refresh(true);
		});
	}

	/**
	 * Lists a universe's characters from the first page, with no search or filters, for a role that may
	 * see them
	 *
	 * @param universe The universe
	 */
	open(universe: EditableUniverse): void
	{
		const version = ++this.openVersion;

		this.universe = universe;
		this.offset = 0;
		window.clearTimeout(this.searchTimer);
		this.search.value = '';
		this.groupFilter.value = '';
		this.showOptions(this.raceFilter, []);
		this.showOptions(this.classFilter, []);
		this.sorter.reset();
		this.rows.replaceChildren();
		showMessage(this.empty, undefined);
		this.page.textContent = '';

		if (!canEditWorld(universe.role))
		{
			return;
		}

		void this.loadFilters(universe, version);
		void this.refresh();
	}

	/**
	 * Fills the race and class filters with the universe's races and classes, disabled ones included,
	 * since characters may still have them
	 *
	 * @param universe The universe
	 * @param version The open they are for
	 */
	private async loadFilters(universe: EditableUniverse, version: number): Promise<void>
	{
		let races: EditorRace[];
		let classes: EditorClass[];

		try
		{
			[races, classes] = await Promise.all([
				this.api.listRaces(universe.id),
				this.api.listClasses(universe.id)
			]);
		}
		catch
		{
			// The list still works without these filters, and says when it can't load
			return;
		}

		if (version !== this.openVersion)
		{
			return;
		}

		this.showOptions(this.raceFilter, races.map((race) => ({
			id: race.id,
			name: raceName(race, universe.ruleset)
		})));
		this.showOptions(this.classFilter, classes.map((characterClass) => ({
			id: characterClass.id,
			name: className(characterClass, universe.ruleset)
		})));
	}

	/**
	 * Offers Any and then each race or class by name, keeping the one chosen if it is still offered
	 *
	 * @param select The filter
	 * @param options The races or classes
	 */
	private showOptions(select: HTMLSelectElement, options: { id: number; name: string }[]): void
	{
		const chosen = select.value;
		const sorted = [...options].sort((first, second) => first.name.localeCompare(second.name));

		setOptions(select, [
			{
				value: '',
				label: t(formMessages.filterAny)
			},
			...sorted.map(({ id, name }) => ({
				value: String(id),
				label: name
			}))
		]);
		select.value = (sorted.some(({ id }) => (String(id) === chosen)) ? chosen : '');
	}

	/**
	 * Loads the first page again, after the search, a filter or the order changed
	 *
	 * @param announcePage Whether to read out what the list shows, as after the search or a filter changed
	 */
	private reload(announcePage: boolean): void
	{
		this.offset = 0;
		void this.refresh(announcePage);
	}

	/**
	 * Whether the player has narrowed the list with the search or a filter
	 *
	 * @return True when they have
	 */
	private isFiltered(): boolean
	{
		return((this.search.value.trim() !== '') || [this.raceFilter, this.classFilter, this.groupFilter].some((filter) => (filter.value !== '')));
	}

	/**
	 * Loads the page of characters the search, filters, order and offset ask for, and shows it
	 *
	 * @param announcePage Whether to read out what the list shows, as after the player changed its page or filters
	 */
	private async refresh(announcePage = false): Promise<void>
	{
		const universe = this.universe;
		const version = ++this.requestVersion;

		if (!universe)
		{
			return;
		}

		const query: EditorCharacterListQuery = {
			search: (this.search.value.trim() || undefined),
			raceId: optionId(this.raceFilter),
			classId: optionId(this.classFilter),
			inGroup: ((this.groupFilter.value === '') ? undefined : (this.groupFilter.value === 'true')),
			sort: this.sorter.order.column,
			direction: this.sorter.order.direction,
			offset: this.offset,
			limit: MAX_CHARACTERS_PER_PAGE
		};
		let page: EditorCharacterListPayload;

		try
		{
			page = await this.api.listCharacters(universe.id, query);
		}
		catch (error)
		{
			if (version === this.requestVersion)
			{
				this.rows.replaceChildren();
				showMessage(this.empty, describeEditorError(error, {
					id: 'editor.characterList.listFailed',
					defaultMessage: 'Could not list the characters.',
					description: 'Shown on the editor\'s Character List tab when the universe\'s characters couldn\'t be loaded'
				}));

				if (announcePage)
				{
					announceListPage(this.page, this.empty);
				}
			}

			return;
		}

		if (version !== this.requestVersion)
		{
			return;
		}

		// Characters deleted since the last page was loaded can leave nothing to show on it
		if ((page.characters.length === 0) && (this.offset > 0))
		{
			this.offset = Math.max(0, this.offset - MAX_CHARACTERS_PER_PAGE);
			void this.refresh(announcePage);
			return;
		}

		this.rows.replaceChildren(...page.characters.map((character) => this.createRow(character, universe)));
		this.showEmpty(page.total);
		showPageRange(this.page, this.offset, page.characters.length, page.total);
		this.previousButton.disabled = (this.offset === 0);
		this.nextButton.disabled = ((this.offset + page.characters.length) >= page.total);

		if (announcePage)
		{
			announceListPage(this.page, this.empty);
		}
	}

	/**
	 * Says when there are no characters to list: none match, or nobody has made one yet
	 *
	 * @param total How many characters match
	 */
	private showEmpty(total: number): void
	{
		if (total > 0)
		{
			showMessage(this.empty, undefined);
		}
		else if (this.isFiltered())
		{
			showMessage(this.empty, t({
				id: 'editor.characterList.none',
				defaultMessage: 'No characters match.',
				description: 'Shown on the editor\'s Character List tab instead of the list of characters when no character matches the search or filters'
			}));
		}
		else
		{
			showMessage(this.empty, t({
				id: 'editor.characterList.noneMade',
				defaultMessage: 'Nobody has made a character in this universe yet.',
				description: 'Shown on the editor\'s Character List tab instead of the list of characters when the universe has none'
			}));
		}
	}

	/**
	 * A character's row: their name, race and class, player (linking to their profile), when they were
	 * made, and whether they are in a group or waiting to be deleted
	 *
	 * @param character The character
	 * @param universe The universe they are in
	 * @return The row
	 */
	private createRow(character: EditorCharacter, universe: EditableUniverse): HTMLTableRowElement
	{
		const row = document.createElement('tr');
		const name = document.createElement('td');
		const description = document.createElement('td');
		const created = document.createElement('td');
		const notes = document.createElement('td');

		// Names players write aren't translated
		name.textContent = character.name;
		name.translate = false;
		description.textContent = characterDescription(character, universe.ruleset);
		created.textContent = formatDateTime(character.createdAt);
		notes.textContent = joinTags(
			(character.inGroup
				? t(characterMessages.inGroup)
				: undefined),
			((character.deleteAt === null)
				? undefined
				: t(characterMessages.leaving, {
					deleteAt: Date.parse(character.deleteAt)
				}))
		);

		row.append(name, description, playerCell(character.player.displayName, character.player.username), created, notes);

		return(row);
	}
}

/**
 * The race or class a filter has chosen
 *
 * @param select The filter
 * @return Its ID, or undefined for Any
 */
function optionId(select: HTMLSelectElement): number | undefined
{
	return(((select.value === '') ? undefined : Number(select.value)));
}
