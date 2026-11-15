import { CORE_RULEBOOK, defineMessages, rulesetHasThemes, RULESET_RULEBOOKS, type EditableUniverse, type MessageDescriptor, type RulebookSettings, type Ruleset } from '@multiverse-kiln/shared';

import { currentLocale, t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { getElement, showMessage } from '../dom';
import { className, raceName, themeName } from '../raceAndClassNames';
import { rulebookName } from '../rulebookNames';
import { describeClass } from './ClassesSection';
import { optionTags } from './optionRows';
import { describeRace } from './RacesSection';
import type { RulebookChoice } from './rulebookChoice';
import { describeTheme } from './ThemesSection';

/**
 * Text of the Rulebooks card and its Contents dialog (see src/localization.ts)
 */
const messages = defineMessages({
	alwaysOn: {
		id: 'editor.rulebooks.alwaysOn',
		defaultMessage: 'Always on',
		description: 'Status of the core rulebook in the Rulebooks table on the editor\'s Ruleset tab: it can\'t be turned off'
	},
	on: {
		id: 'editor.rulebooks.on',
		defaultMessage: 'On',
		description: 'Status of a book in the Rulebooks table on the editor\'s Ruleset tab: the universe uses its races, classes and items'
	},
	off: {
		id: 'editor.rulebooks.off',
		defaultMessage: 'Off',
		description: 'Status of a book in the Rulebooks table on the editor\'s Ruleset tab: the universe doesn\'t use its races, classes and items'
	},
	onWhenSaved: {
		id: 'editor.rulebooks.onWhenSaved',
		defaultMessage: 'On when saved',
		description: 'Status of a book in the Rulebooks table on the editor\'s Ruleset tab that was turned on, which isn\'t saved yet'
	},
	offWhenSaved: {
		id: 'editor.rulebooks.offWhenSaved',
		defaultMessage: 'Off when saved',
		description: 'Status of a book in the Rulebooks table on the editor\'s Ruleset tab that was turned off, which isn\'t saved yet'
	},
	enable: {
		id: 'editor.rulebooks.enable',
		defaultMessage: 'Enable',
		description: 'Button in a row of the Rulebooks table on the editor\'s Ruleset tab that turns the book on; saved with the Save button'
	},
	disable: {
		id: 'editor.rulebooks.disable',
		defaultMessage: 'Disable',
		description: 'Button in a row of the Rulebooks table on the editor\'s Ruleset tab that turns the book off; saved with the Save button'
	},
	contents: {
		id: 'editor.rulebooks.contents',
		defaultMessage: 'Contents',
		description: 'Button in a row of the Rulebooks table on the editor\'s Ruleset tab that opens a dialog listing the races and classes the book brings'
	},
	loading: {
		id: 'editor.rulebook.loading',
		defaultMessage: 'Loading...',
		description: 'Shown in the dialog listing what a book of game rules brings while its races and classes load'
	},
	loadFailed: {
		id: 'editor.rulebook.loadFailed',
		defaultMessage: 'Could not list what the book brings.',
		description: 'Shown in the dialog listing what a book of game rules brings when its races and classes couldn\'t be loaded'
	},
	races: {
		id: 'editor.rulebook.races',
		defaultMessage: 'Races',
		description: 'Heading of the list of races in the dialog listing what a book of game rules brings'
	},
	classes: {
		id: 'editor.rulebook.classes',
		defaultMessage: 'Classes',
		description: 'Heading of the list of character classes in the dialog listing what a book of game rules brings'
	},
	themes: {
		id: 'editor.rulebook.themes',
		defaultMessage: 'Themes',
		description: 'Heading of the list of themes (a Starfinder character\'s background) in the dialog listing what a book of game rules brings'
	},
	name: {
		id: 'form.name',
		defaultMessage: 'Name',
		description: 'Label of the field for the name of something being made or edited, such as a universe, region, area, tile, item, race, class, theme or difficulty level, and the heading of the column of names in the editor\'s lists of them; also names the setting in the list of what a save changed, on the editor\'s Audit tab'
	},
	summary: {
		id: 'editor.summary',
		defaultMessage: 'Summary',
		description: 'Heading of the table column describing each row\'s rules, in the editor\'s lists of races, classes, themes, items and difficulty levels (such as a race\'s size, an item\'s type, or how a difficulty level changes monsters and enemies)'
	},
	notes: {
		id: 'editor.notes',
		defaultMessage: 'Notes',
		description: 'Heading of the table column in the editor\'s lists of races, classes, themes and items that says whether each was added by the universe, edited from the ruleset\'s, disabled, or changed and not saved yet; also of the column on the editor\'s Editors tab with a translator\'s languages, what a builder may edit and their regions, and which row is the player\'s own'
	}
});

/**
 * One row of a list in the Contents dialog
 */
interface ContentsRow
{
	name: string;
	summary: string;
	notes: string;
}

/**
 * The Rulebooks card on the Ruleset tab: the ruleset's books, turned on and off with a button each, and
 * a dialog listing what each book brings. The books are saved with the rest of the tab
 */
export class RulebooksSection
{
	private readonly rows = getElement('rulebook-rows', HTMLTableSectionElement);
	private readonly dialog = getElement('rulebook-dialog', HTMLDialogElement);
	private readonly dialogTitle = getElement('rulebook-dialog-title', HTMLElement);
	private readonly dialogStatus = getElement('rulebook-dialog-status', HTMLElement);
	private readonly contents = getElement('rulebook-contents', HTMLElement);

	private universe: EditableUniverse | undefined;

	/**
	 * The books as last loaded or saved
	 */
	private saved: RulebookSettings = {
		rulebooks: [],
		barredRulebooks: []
	};

	/**
	 * Whether the player may turn books on and off
	 */
	private editable = false;

	/**
	 * Changes every time the dialog opens, so lists that arrive for an earlier opening are ignored
	 */
	private dialogVersion = 0;

	/**
	 * @param api The editor's API
	 * @param choice The books on, as the card shows them, which the other tabs follow
	 * @param onChange Called after a book is turned on or off
	 */
	constructor(private readonly api: EditorApi, private readonly choice: RulebookChoice, private readonly onChange: () => void)
	{
		getElement('rulebook-dialog-close', HTMLButtonElement).addEventListener('click', () =>
		{
			this.dialog.close();
		});
	}

	/**
	 * Shows a universe's books
	 *
	 * @param universe The universe
	 * @param saved Its books as saved, or undefined while they haven't loaded
	 * @param editable Whether the player may turn books on and off
	 */
	open(universe: EditableUniverse, saved: RulebookSettings | undefined, editable: boolean): void
	{
		this.universe = universe;
		this.saved = (saved ?? {
			rulebooks: [],
			barredRulebooks: []
		});
		this.editable = (editable && (saved !== undefined));
		this.choice.set(this.saved.rulebooks);
		this.render();
	}

	/**
	 * The books as the card shows them, to save. Books turned off keep their characters barred only when
	 * they were saved that way; the save asks again for each book it turns off
	 *
	 * @return The books
	 */
	read(): RulebookSettings
	{
		const rulebooks = [...this.choice.rulebooks()];

		return({
			rulebooks,
			barredRulebooks: this.saved.barredRulebooks.filter((rulebook) => !rulebooks.includes(rulebook))
		});
	}

	/**
	 * Takes the books as saved
	 *
	 * @param saved The books saved
	 */
	markSaved(saved: RulebookSettings): void
	{
		this.saved = saved;
		this.render();
	}

	/**
	 * Lists the ruleset's books, each with its status and buttons
	 */
	private render(): void
	{
		const universe = this.universe;

		if (!universe)
		{
			this.rows.replaceChildren();
			return;
		}

		this.rows.replaceChildren(...RULESET_RULEBOOKS[universe.ruleset].map((rulebook) => this.renderRow(universe.ruleset, rulebook)));
	}

	/**
	 * A book's row: its name, status, Enable or Disable button (none for the core rulebook) and Contents
	 * button, each button described by the book's name
	 *
	 * @param ruleset The universe's ruleset
	 * @param rulebook The book's key
	 * @return The row
	 */
	private renderRow(ruleset: Ruleset, rulebook: string): HTMLTableRowElement
	{
		const row = document.createElement('tr');
		const heading = document.createElement('th');
		const status = document.createElement('td');
		const actions = document.createElement('td');
		const on = this.choice.shows(rulebook);
		const contents = document.createElement('button');

		heading.scope = 'row';
		heading.id = `rulebook-${rulebook}`;
		heading.textContent = rulebookName(ruleset, rulebook);
		status.textContent = t(this.statusOf(rulebook, on));
		actions.className = 'row-buttons';

		if (rulebook !== CORE_RULEBOOK)
		{
			const toggle = document.createElement('button');

			toggle.type = 'button';
			toggle.className = 'secondary';
			toggle.textContent = t(on ? messages.disable : messages.enable);
			toggle.disabled = !this.editable;
			toggle.setAttribute('aria-describedby', heading.id);
			toggle.addEventListener('click', () =>
			{
				this.toggle(rulebook);
			});
			actions.append(toggle);
		}

		contents.type = 'button';
		contents.className = 'secondary';
		contents.textContent = t(messages.contents);
		contents.setAttribute('aria-describedby', heading.id);
		contents.addEventListener('click', () =>
		{
			void this.showContents(rulebook);
		});
		actions.append(contents);
		row.append(heading, status, actions);

		return(row);
	}

	/**
	 * A book's status, saying when it differs from what is saved
	 *
	 * @param rulebook The book's key
	 * @param on Whether the card has it on
	 * @return The status's message
	 */
	private statusOf(rulebook: string, on: boolean): MessageDescriptor
	{
		if (rulebook === CORE_RULEBOOK)
		{
			return(messages.alwaysOn);
		}

		if (on === this.saved.rulebooks.includes(rulebook))
		{
			return((on ? messages.on : messages.off));
		}

		return((on ? messages.onWhenSaved : messages.offWhenSaved));
	}

	/**
	 * Turns a book on or off, keeping the books in the order the ruleset lists them
	 *
	 * @param rulebook The book's key
	 */
	private toggle(rulebook: string): void
	{
		const universe = this.universe;

		if (!universe || !this.editable)
		{
			return;
		}

		const on = this.choice.rulebooks();
		const turnedOn = !on.includes(rulebook);

		this.choice.set(RULESET_RULEBOOKS[universe.ruleset].filter((each) => ((each === rulebook) ? turnedOn : on.includes(each))));
		this.render();

		// The row is drawn again, so the book's button takes focus back
		this.rows.querySelector<HTMLButtonElement>(`button[aria-describedby="rulebook-${rulebook}"]`)?.focus();
		this.onChange();
	}

	/**
	 * Opens the dialog listing a book's races, classes and themes, as the universe saved them. Its items
	 * aren't listed, since a book can bring hundreds
	 *
	 * @param rulebook The book's key
	 */
	private async showContents(rulebook: string): Promise<void>
	{
		const universe = this.universe;

		if (!universe)
		{
			return;
		}

		const version = ++this.dialogVersion;
		const { ruleset } = universe;

		this.dialogTitle.textContent = rulebookName(ruleset, rulebook);
		this.dialogStatus.textContent = t(messages.loading);
		this.contents.replaceChildren();
		this.dialog.showModal();

		try
		{
			// The server lists themes only for a ruleset with them
			const [races, classes, themes] = await Promise.all([
				this.api.listRaces(universe.id),
				this.api.listClasses(universe.id),
				(rulesetHasThemes(ruleset) ? this.api.listThemes(universe.id) : Promise.resolve([]))
			]);

			if (version !== this.dialogVersion)
			{
				return;
			}

			const inBook = <T extends { rulebook: string | null }>(options: readonly T[]): T[] => options.filter((option) => (option.rulebook === rulebook));
			const unnamed = <T extends { key: string | null }>(option: T): T & { name: null } => ({ ...option, name: null });

			this.contents.replaceChildren(...[
				contentsList('races', t(messages.races), inBook(races).map((race) => ({
					name: raceName(unnamed(race), ruleset),
					summary: describeRace(race, ruleset),
					notes: optionTags(race)
				}))),
				contentsList('classes', t(messages.classes), inBook(classes).map((characterClass) => ({
					name: className(unnamed(characterClass), ruleset),
					summary: describeClass(characterClass, ruleset),
					notes: optionTags(characterClass)
				}))),
				contentsList('themes', t(messages.themes), inBook(themes).map((theme) => ({
					name: themeName(unnamed(theme), ruleset),
					summary: describeTheme(theme),
					notes: optionTags(theme)
				})))
			].filter((list): list is HTMLElement => (list !== undefined)));
			this.dialogStatus.textContent = '';
		}
		catch (error)
		{
			if (version === this.dialogVersion)
			{
				showMessage(this.dialogStatus, describeEditorError(error, messages.loadFailed));
			}
		}
	}
}

/**
 * One list in the Contents dialog: a heading and a table of names, summaries and notes, sorted by name
 *
 * @param list Which list it is, e.g. races, which names its heading's ID
 * @param heading The list's heading, e.g. Races
 * @param rows Its rows
 * @return The list, or undefined when it has no rows
 */
function contentsList(list: string, heading: string, rows: readonly ContentsRow[]): HTMLElement | undefined
{
	if (rows.length === 0)
	{
		return(undefined);
	}

	const section = document.createElement('section');
	const title = document.createElement('h3');
	const table = document.createElement('table');
	const head = document.createElement('thead');
	const headings = document.createElement('tr');
	const body = document.createElement('tbody');
	const id = `rulebook-contents-${list}`;

	title.id = id;
	title.textContent = heading;
	table.className = 'item-table';
	table.setAttribute('aria-labelledby', id);

	for (const message of [messages.name, messages.summary, messages.notes])
	{
		const cell = document.createElement('th');

		cell.scope = 'col';
		cell.textContent = t(message);
		headings.append(cell);
	}

	head.append(headings);
	body.append(...[...rows]
		.sort((first, second) => first.name.localeCompare(second.name, currentLocale()))
		.map(({ name, summary, notes }) =>
		{
			const row = document.createElement('tr');
			const nameCell = document.createElement('th');

			nameCell.scope = 'row';
			nameCell.textContent = name;
			row.append(nameCell);

			for (const text of [summary, notes])
			{
				const cell = document.createElement('td');

				cell.textContent = text;
				row.append(cell);
			}

			return(row);
		}));
	table.append(head, body);
	section.append(title, table);

	return(section);
}
