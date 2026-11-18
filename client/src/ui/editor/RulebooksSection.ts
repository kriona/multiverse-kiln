import { CORE_RULEBOOK, defineMessages, rulesetHasThemes, RULESET_RULEBOOKS, type EditableUniverse, type RulebookSettings, type Ruleset } from '@multiverse-kiln/shared';

import { currentLocale, t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { getElement, showMessage } from '../dom';
import { pageMessages } from '../pageMessages';
import { classDescription, className, raceDescription, raceName, themeDescription, themeName } from '../raceAndClassNames';
import { rulebookName } from '../rulebookNames';
import { createToggleSwitch } from '../toggleSwitch';
import { describeClass } from './ClassesSection';
import { editorMessages } from './editorMessages';
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
	contents: {
		id: 'editor.rulebooks.contents',
		defaultMessage: 'Contents',
		description: 'Button in a row of the Rulebooks table on the editor\'s Ruleset tab that opens a dialog listing the races, classes and themes the book brings'
	},
	loadFailed: {
		id: 'editor.rulebook.loadFailed',
		defaultMessage: 'Could not list what the book brings.',
		description: 'Shown in the dialog listing what a book of game rules brings when its races, classes and themes couldn\'t be loaded'
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

	/**
	 * The engine's description, or an empty string for a default without one
	 */
	description: string;

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
	 * Shows a universe's books. While they load, the card and the other tabs keep the books shown when
	 * the universe and version are the ones shown already, and wait for them otherwise
	 *
	 * @param universe The universe
	 * @param saved Its books as saved, or undefined while they haven't loaded
	 * @param editable Whether the player may turn books on and off
	 */
	open(universe: EditableUniverse, saved: RulebookSettings | undefined, editable: boolean): void
	{
		const sameVersion = ((this.universe?.id === universe.id) && (this.universe.version === universe.version));

		this.universe = universe;
		this.editable = (editable && (saved !== undefined));

		if (saved !== undefined)
		{
			this.saved = saved;
			this.choice.set(saved.rulebooks);
		}
		else if (!sameVersion)
		{
			this.saved = {
				rulebooks: [],
				barredRulebooks: []
			};
			this.choice.forget();
		}

		this.render();
	}

	/**
	 * Lets the other tabs show the core rulebook's things when the books couldn't be loaded and those of
	 * the universe and version shown aren't known
	 */
	loadFailed(): void
	{
		if (!this.choice.known())
		{
			this.choice.set([]);
		}
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
	 * A book's row: its name, its status and its Contents button. The status is an on/off switch named by
	 * the book, or Always on for the core rulebook
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
		const contents = document.createElement('button');

		heading.scope = 'row';
		heading.id = `rulebook-${rulebook}`;
		heading.textContent = rulebookName(ruleset, rulebook);
		actions.className = 'row-buttons';

		if (rulebook === CORE_RULEBOOK)
		{
			status.textContent = t(messages.alwaysOn);
		}
		else
		{
			status.append(createToggleSwitch({
				name: { labelledBy: heading.id },
				checked: this.choice.shows(rulebook),
				disabled: !this.editable,
				onChange: (checked) =>
				{
					this.toggle(rulebook, checked);
				}
			}));
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
	 * Turns a book on or off, keeping the books in the order the ruleset lists them
	 *
	 * @param rulebook The book's key
	 * @param on Whether to turn it on
	 */
	private toggle(rulebook: string, on: boolean): void
	{
		const universe = this.universe;

		if (!universe || !this.editable)
		{
			return;
		}

		const others = this.choice.rulebooks();

		this.choice.set(RULESET_RULEBOOKS[universe.ruleset].filter((each) => ((each === rulebook) ? on : others.includes(each))));
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
		this.dialogStatus.textContent = t(pageMessages.loading);
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
			const unnamed = <T extends { key: string | null }>(option: T): T & { name: null; description: null } => ({
				...option,
				name: null,
				description: null
			});

			this.contents.replaceChildren(...[
				contentsList('races', t(messages.races), inBook(races).map((race) => ({
					name: raceName(unnamed(race), ruleset),
					description: raceDescription(unnamed(race), ruleset),
					summary: describeRace(race, ruleset),
					notes: optionTags(race, true)
				}))),
				contentsList('classes', t(messages.classes), inBook(classes).map((characterClass) => ({
					name: className(unnamed(characterClass), ruleset),
					description: classDescription(unnamed(characterClass), ruleset),
					summary: describeClass(characterClass, ruleset),
					notes: optionTags(characterClass, true)
				}))),
				contentsList('themes', t(messages.themes), inBook(themes).map((theme) => ({
					name: themeName(unnamed(theme), ruleset),
					description: themeDescription(unnamed(theme), ruleset),
					summary: describeTheme(theme),
					notes: optionTags(theme, true)
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
 * One list in the Contents dialog: a heading and a table of names, descriptions, summaries and notes,
 * sorted by name
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

	const described = rows.some((row) => (row.description !== ''));

	for (const message of [editorMessages.name, ...(described ? [editorMessages.description] : []), messages.summary, messages.notes])
	{
		const cell = document.createElement('th');

		cell.scope = 'col';
		cell.textContent = t(message);
		headings.append(cell);
	}

	head.append(headings);
	body.append(...[...rows]
		.sort((first, second) => first.name.localeCompare(second.name, currentLocale()))
		.map(({ name, description, summary, notes }) =>
		{
			const row = document.createElement('tr');
			const nameCell = document.createElement('th');

			nameCell.scope = 'row';
			nameCell.textContent = name;
			row.append(nameCell);

			for (const text of [...(described ? [description] : []), summary, notes])
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
