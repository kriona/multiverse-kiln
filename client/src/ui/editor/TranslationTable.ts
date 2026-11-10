import { canEditVersionOpen, canEditWorld, canEditWorldOpen, canMarkNoTranslation, canonicalLanguage, canTranslate, DISALLOWED_TEXT_CHARACTERS, isCoin, isValidCoinAbbreviation, languageName, MAX_TRANSLATION_FILE_BYTES, MAX_UNIVERSE_TEXT_PER_PAGE, maxUniverseTextLength, sourceTextHash, TRANSLATION_FILE_EXTENSIONS, TRANSLATION_FILE_FORMATS, TRANSLATION_FILE_TYPES, translationFileFormatOf, UNIVERSE_TEXT_SORT_COLUMNS, universeTextFileKey, writeTranslationFile, type AuditSubject, type EditableUniverse, type ReadTranslationFile, type UniverseTextListPayload, type UniverseTextRef, type UniverseTextRow, type UniverseTextSortColumn } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { refreshUnsavedWork, watchUnsavedWork } from '../changeTracker';
import { getElement, namedOptions, setOptions, showMessage } from '../dom';
import { engineCoinName } from '../moneyField';
import { announceListPage, showPageRange } from '../pager';
import { TableSorter } from '../tableSorter';
import { describeTooLarge, describeUnreadable, describeWrongLanguage, downloadText, FILE_FORMAT_NAMES, readTranslationFileFrom } from '../translationFiles';
import type { EditorSave } from './editorSave';
import type { FollowsOtherSaves, OtherSave } from './otherSaves';
import type { SavableTab } from './SaveBar';
import { joinTags, type ChangeSource } from './stagedChanges';
import { TranslationDialog } from './TranslationDialog';

/**
 * How long the search waits after the last key before searching, in milliseconds
 */
const SEARCH_DELAY_MS = 250;

/**
 * Most characters of the source text the table shows; the dialog shows all of it
 */
const SHOWN_SOURCE_LENGTH = 200;

/**
 * What a save changes on the table, as the Audit tab names it
 */
const TEXT_SUBJECTS: ReadonlySet<AuditSubject> = new Set(['translations', 'translatorNotes', 'noTranslation']);

/**
 * A translation changed on the tab and not saved yet
 */
interface StagedTranslation
{
	ref: UniverseTextRef;
	language: string;

	/**
	 * The translation, or null to delete it
	 */
	text: string | null;

	/**
	 * The hash of the source text it was made from, as the table listed it
	 */
	sourceHash: string;

	/**
	 * The translation as the table listed it when it was first changed, or null for none, for the save
	 * to tell whether another translator saved one since
	 */
	loaded: string | null;
}

/**
 * A note for translators changed on the tab and not saved yet
 */
interface StagedNote
{
	ref: UniverseTextRef;

	/**
	 * The note, or null to delete it
	 */
	note: string | null;

	/**
	 * The note as the table listed it when it was first changed, or null for none
	 */
	loaded: string | null;
}

/**
 * A piece of text marked, and not saved yet, as needing no translation or as needing one again
 */
interface StagedMark
{
	ref: UniverseTextRef;
	noTranslation: boolean;
}

/**
 * The key a piece of text is staged under
 *
 * @param ref The piece of text
 * @return The key
 */
function refKey(ref: UniverseTextRef): string
{
	return(`${ref.kind}:${ref.thingId}:${ref.field}`);
}

/**
 * The key a translation is staged under
 *
 * @param ref The piece of text
 * @param language The translation's language
 * @return The key
 */
function translationKey(ref: UniverseTextRef, language: string): string
{
	return(`${language}|${refKey(ref)}`);
}

/**
 * Where a piece of universe text comes from, e.g. "Area: Waterdeep, name"
 *
 * @param row The text, with the name of what it belongs to
 * @return The description
 */
export function describeTextPlace(row: UniverseTextRef & { thingName: string }): string
{
	return(t({
		id: 'editor.translations.placeOf',
		defaultMessage: '{kind, select, universe {Universe: {name}, {field, select, name {name} shortDescription {1-sentence description} other {long description}}} area {Area: {name}, name} tile {Tile: {name}, name} item {Item: {name}, name} race {Race: {name}, name} class {Class: {name}, name} theme {Theme: {name}, name} coin {Coin: {coin}, {field, select, abbreviation {abbreviation} other {name}}} other {Difficulty level: {name}, name}}',
		description: 'Where a piece of universe text comes from, in the From column of the editor\'s Translations tab and in its dialog\'s title, e.g. "Area: Waterdeep, name": what kind of thing it belongs to, {name} its name in the universe\'s source language, and which of its text it is. For a coin, {coin} is the coin\'s name in the rules as it reads mid-sentence, such as copper pieces, and the text is the name the universe gives it (such as bronze kits) or the abbreviation amounts of it are written with (such as bk)'
	}, {
		kind: row.kind,
		name: row.thingName,
		coin: (isCoin(row.thingId) ? engineCoinName(row.thingId) : ''),
		field: row.field
	}));
}

/**
 * The Translations tab's table: every piece of the universe's text with its translation into a chosen
 * language and its note for translators, searched, filtered, sorted and paged by the server. A row opens
 * the translation dialog; the translations and notes changed there show in the table until the editor
 * is saved. The text exports as a translation file, and translations import from one, kept on the tab
 * the same way. Translators see only their languages, and builders write notes
 */
export class TranslationTable implements SavableTab, ChangeSource, FollowsOtherSaves
{
	private readonly none = getElement('translations-text-none', HTMLElement);
	private readonly list = getElement('translations-text-list', HTMLElement);
	private readonly language = getElement('translations-language', HTMLSelectElement);
	private readonly search = getElement('translations-search', HTMLInputElement);
	private readonly missing = getElement('translations-missing', HTMLInputElement);
	private readonly outOfDate = getElement('translations-out-of-date', HTMLInputElement);
	private readonly rows = getElement('translations-rows', HTMLTableSectionElement);
	private readonly empty = getElement('translations-empty', HTMLElement);
	private readonly error = getElement('translations-list-error', HTMLElement);
	private readonly page = getElement('translations-page', HTMLElement);
	private readonly previousButton = getElement('translations-previous', HTMLButtonElement);
	private readonly nextButton = getElement('translations-next', HTMLButtonElement);
	private readonly format = getElement('translations-format', HTMLSelectElement);
	private readonly importButton = getElement('translations-import', HTMLButtonElement);
	private readonly importFile = getElement('translations-import-file', HTMLInputElement);
	private readonly importStatus = getElement('translations-import-status', HTMLElement);
	private readonly dialog = new TranslationDialog();
	private readonly sorter: TableSorter<UniverseTextSortColumn>;

	/**
	 * The translations and notes changed since the last save
	 */
	private readonly translations = new Map<string, StagedTranslation>();
	private readonly notes = new Map<string, StagedNote>();
	private readonly marks = new Map<string, StagedMark>();

	/**
	 * The changes the save being sent holds
	 */
	private collected: { translations: StagedTranslation[]; notes: StagedNote[]; marks: StagedMark[] } = { translations: [], notes: [], marks: [] };

	private readonly listeners = new Set<(unsaved: boolean) => void>();

	/**
	 * Whether the changes were unsaved when the listeners were last told
	 */
	private toldUnsaved = false;

	/**
	 * Says when the table has changes that haven't been saved
	 */
	readonly changes: ChangeSource = this;

	private universe: EditableUniverse | undefined;

	/**
	 * The page of text shown, as it was last loaded
	 */
	private shown: UniverseTextRow[] = [];

	/**
	 * How many matching pieces of text come before the page shown
	 */
	private offset = 0;

	/**
	 * Changes with every request for a page, so a page that arrives after a newer request is ignored
	 */
	private requestVersion = 0;

	/**
	 * Whether the Translations tab is showing. A hidden table loads nothing: it waits to be shown
	 */
	private visible = false;

	/**
	 * Whether the page shown was asked to load while the table was hidden, so it loads once it shows
	 */
	private stale = false;

	private searchTimer: number | undefined;

	/**
	 * @param api The editor's API
	 */
	constructor(private readonly api: EditorApi)
	{
		watchUnsavedWork(this);
		this.sorter = new TableSorter(getElement('translations-table', HTMLTableElement), UNIVERSE_TEXT_SORT_COLUMNS, {
			column: 'place',
			direction: 'ascending'
		}, () =>
		{
			this.offset = 0;
			void this.refresh();
		});

		for (const filter of [this.language, this.missing, this.outOfDate])
		{
			filter.addEventListener('change', () =>
			{
				this.offset = 0;
				void this.refresh(true);
			});
		}

		this.search.addEventListener('input', () =>
		{
			window.clearTimeout(this.searchTimer);
			this.searchTimer = window.setTimeout(() =>
			{
				this.offset = 0;
				void this.refresh(true);
			}, SEARCH_DELAY_MS);
		});

		this.previousButton.addEventListener('click', () =>
		{
			this.offset = Math.max(0, this.offset - MAX_UNIVERSE_TEXT_PER_PAGE);
			void this.refresh(true);
		});

		this.nextButton.addEventListener('click', () =>
		{
			this.offset += MAX_UNIVERSE_TEXT_PER_PAGE;
			void this.refresh(true);
		});

		setOptions(this.format, namedOptions(TRANSLATION_FILE_FORMATS, FILE_FORMAT_NAMES));

		this.language.addEventListener('change', () =>
		{
			this.showFileButtons();
		});

		getElement('translations-export', HTMLButtonElement).addEventListener('click', () =>
		{
			void this.exportFile();
		});

		this.importButton.addEventListener('click', () =>
		{
			this.importFile.click();
		});

		this.importFile.addEventListener('change', () =>
		{
			const file = this.importFile.files?.[0];

			// Choosing the same file again imports it again
			this.importFile.value = '';

			if (file)
			{
				void this.importTranslations(file);
			}
		});
	}

	/**
	 * Lists a universe's text from the first page, in the first language the player may see, with no
	 * search or filters and nothing changed
	 *
	 * @param universe The universe
	 */
	open(universe: EditableUniverse): void
	{
		this.translations.clear();
		this.notes.clear();
		this.marks.clear();
		this.collected = { translations: [], notes: [], marks: [] };
		this.search.value = '';
		this.missing.checked = false;
		this.outOfDate.checked = false;
		showMessage(this.importStatus, undefined);
		this.sorter.reset();
		this.language.replaceChildren();
		this.notifyChanged();
		this.showLanguages(universe);
		this.offset = 0;
		void this.refresh();
	}

	/**
	 * Follows the universe's languages as they are saved, keeping the language chosen while it is still
	 * one of them, and the changes made. The table loads from the first page when the language chosen
	 * changes; otherwise it keeps the page it shows
	 *
	 * @param universe The universe as saved
	 */
	useUniverse(universe: EditableUniverse): void
	{
		if (this.showLanguages(universe))
		{
			this.offset = 0;
			void this.refresh();
		}
	}

	/**
	 * Offers the languages of a universe the player may see, keeping the language chosen while it is
	 * still one of them, and says when there are none
	 *
	 * @param universe The universe
	 * @return True when the language chosen changed
	 */
	private showLanguages(universe: EditableUniverse): boolean
	{
		const chosen = this.language.value;
		const languages = this.visibleLanguages(universe);

		this.universe = universe;
		this.language.replaceChildren(...languages.map((language) =>
		{
			const option = new Option(languageName(language), language);

			option.lang = language;

			return(option);
		}));
		this.language.value = (languages.includes(chosen) ? chosen : (languages[0] ?? ''));
		this.list.hidden = (languages.length === 0);
		this.showFileButtons();
		showMessage(this.none, ((languages.length > 0)
			? undefined
			: ((universe.role === 'translator')
				? t({
					id: 'editor.translations.noneOfYours',
					defaultMessage: 'The universe isn\'t translated into any of your languages yet. Its creators can add them above.',
					description: 'Shown on the editor\'s Translations tab to a translator when none of the languages they may translate into is one the universe is translated into'
				})
				: t({
					id: 'editor.translations.noLanguages',
					defaultMessage: 'The universe isn\'t translated into any language yet. Add one above, and save, to translate its text.',
					description: 'Shown on the editor\'s Translations tab in place of the table of the universe\'s text while the universe has no languages it is translated into'
				}))));

		return(this.language.value !== chosen);
	}

	/**
	 * The languages the player may see the translations of: every language the universe is translated
	 * into for those who may write notes, and a translator's own
	 *
	 * @param universe The universe
	 * @return The languages, by tag
	 */
	private visibleLanguages(universe: EditableUniverse): string[]
	{
		return(universe.translationLanguages.filter((language) => (canEditWorld(universe.role) || canTranslate(universe, language))));
	}

	/**
	 * Whether the player may translate, write notes or mark text as needing no translation
	 *
	 * @return True when they may
	 */
	canSave(): boolean
	{
		const universe = this.universe;

		return((universe !== undefined) && canEditVersionOpen(universe) && (canEditWorld(universe.role) || canMarkNoTranslation(universe) || universe.translationLanguages.some((language) => canTranslate(universe, language))));
	}

	/**
	 * Whether translations, notes or marks have been changed and not saved
	 *
	 * @return True when they have
	 */
	hasUnsavedChanges(): boolean
	{
		return((this.translations.size > 0) || (this.notes.size > 0) || (this.marks.size > 0));
	}

	/**
	 * Hears when the table starts or stops having unsaved changes
	 *
	 * @param listener Called with whether it has them
	 * @return Stops listening
	 */
	subscribe(listener: (unsaved: boolean) => void): () => void
	{
		this.listeners.add(listener);

		return(() =>
		{
			this.listeners.delete(listener);
		});
	}

	/**
	 * Tells the listeners and the page whether the table has unsaved changes, when that changes
	 */
	private notifyChanged(): void
	{
		const unsaved = this.hasUnsavedChanges();

		refreshUnsavedWork();

		if (unsaved === this.toldUnsaved)
		{
			return;
		}

		this.toldUnsaved = unsaved;

		for (const listener of [...this.listeners])
		{
			listener(unsaved);
		}
	}

	/**
	 * Adds the translations and notes changed to a save
	 *
	 * @param save The save
	 * @return True
	 */
	collect(save: EditorSave): boolean
	{
		const onRefused = (refusal: { error: unknown }): void =>
		{
			showMessage(this.error, describeEditorError(refusal.error, {
				id: 'editor.translations.textSaveFailed',
				defaultMessage: 'Could not save the translations and notes.',
				description: 'Shown on the editor\'s Translations tab when the server refused a translation or a note for translators, followed by why; nothing was saved'
			}));
		};

		showMessage(this.error, undefined);
		this.collected = {
			translations: [...this.translations.values()],
			notes: [...this.notes.values()],
			marks: [...this.marks.values()]
		};

		for (const staged of this.collected.marks)
		{
			save.add({
				kind: 'saveNoTranslation',
				text: staged.ref,
				noTranslation: staged.noTranslation
			}, onRefused);
		}

		for (const staged of this.collected.translations)
		{
			save.add({
				kind: 'saveTranslation',
				text: staged.ref,
				language: staged.language,
				translation: staged.text,
				sourceHash: staged.sourceHash,
				loaded: staged.loaded
			}, onRefused);
		}

		for (const staged of this.collected.notes)
		{
			save.add({
				kind: 'saveTranslatorNote',
				text: staged.ref,
				note: staged.note,
				loaded: staged.loaded
			}, onRefused);
		}

		return(true);
	}

	/**
	 * Takes the changes as saved, keeping any made while the save was sent, and loads the page afresh
	 */
	async saved(): Promise<void>
	{
		for (const staged of this.collected.translations)
		{
			const key = translationKey(staged.ref, staged.language);

			if (this.translations.get(key) === staged)
			{
				this.translations.delete(key);
			}
		}

		for (const staged of this.collected.notes)
		{
			const key = refKey(staged.ref);

			if (this.notes.get(key) === staged)
			{
				this.notes.delete(key);
			}
		}

		for (const staged of this.collected.marks)
		{
			const key = refKey(staged.ref);

			if (this.marks.get(key) === staged)
			{
				this.marks.delete(key);
			}
		}

		this.collected = { translations: [], notes: [], marks: [] };
		this.notifyChanged();
		await this.refresh();
	}

	/**
	 * Loads the page shown afresh, keeping the changes made since, for a save that may have changed the
	 * universe's text on another tab, such as renaming an area or a coin
	 */
	reload(): void
	{
		void this.refresh();
	}

	/**
	 * Loads the page shown afresh after another window saved, keeping the changes made here, since any
	 * save may change the universe's text. The save's details count translations rather than naming
	 * them, so the rows aren't marked
	 *
	 * @param save The save
	 * @return True when the save changed translations, notes or marks while the table has unsaved changes
	 */
	otherSaved(save: OtherSave): boolean
	{
		if (save.details.length === 0)
		{
			return(false);
		}

		void this.refresh();

		return(this.hasUnsavedChanges() && save.details.some((detail) => TEXT_SUBJECTS.has(detail.subject)));
	}

	/**
	 * Follows whether the Translations tab is showing, loading the page shown once it does if it was
	 * asked to load while the tab was hidden
	 *
	 * @param visible Whether it is showing
	 */
	setVisible(visible: boolean): void
	{
		this.visible = visible;

		if (visible && this.stale)
		{
			void this.refresh();
		}
	}

	/**
	 * Loads the page of text the language, search, filters, order and offset ask for, then shows it with
	 * the changes made since. While the tab is hidden it only notes that the page is out of date
	 *
	 * @param announcePage Whether to read out what the table shows, as after the player changed its page, search or filters
	 */
	private async refresh(announcePage = false): Promise<void>
	{
		const universe = this.universe;
		const version = ++this.requestVersion;
		const language = this.language.value;

		if (!this.visible)
		{
			this.stale = true;
			return;
		}

		this.stale = false;

		if (!universe || (language === ''))
		{
			this.shown = [];
			this.rows.replaceChildren();
			return;
		}

		let page: UniverseTextListPayload;

		try
		{
			page = await this.api.listTranslations(universe.id, {
				language,
				search: (this.search.value.trim() || undefined),
				missing: (this.missing.checked || undefined),
				outOfDate: (this.outOfDate.checked || undefined),
				sort: this.sorter.order.column,
				direction: this.sorter.order.direction,
				offset: this.offset,
				limit: MAX_UNIVERSE_TEXT_PER_PAGE
			});
		}
		catch (error)
		{
			if (version === this.requestVersion)
			{
				showMessage(this.empty, describeEditorError(error, {
					id: 'editor.translations.listFailed',
					defaultMessage: 'Could not list the universe\'s text.',
					description: 'Shown on the editor\'s Translations tab when the universe\'s text and its translations couldn\'t be loaded'
				}));
				this.rows.replaceChildren();

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

		this.shown = page.rows;
		this.render();
		showPageRange(this.page, this.offset, page.rows.length, page.total);
		this.previousButton.disabled = (this.offset === 0);
		this.nextButton.disabled = ((this.offset + page.rows.length) >= page.total);

		if (announcePage)
		{
			announceListPage(this.page, this.empty);
		}
	}

	/**
	 * Shows the page of text with the changes made since it was loaded
	 */
	private render(): void
	{
		this.rows.replaceChildren(...this.shown.map((row) => this.createRow(row)));
		showMessage(this.empty, ((this.shown.length === 0)
			? t({
				id: 'editor.translations.noneMatch',
				defaultMessage: 'No text matches.',
				description: 'Shown on the editor\'s Translations tab in place of the table of the universe\'s text when nothing matches the search and filters'
			})
			: undefined));
	}

	/**
	 * A piece of text as the table shows it: its translation, note and whether it needs a translation,
	 * with the changes made to them, and whether its translation is out of date
	 *
	 * @param row The text as the server listed it
	 * @return The text as shown
	 */
	private withChanges(row: UniverseTextRow): { translation: string | null; note: string | null; noTranslation: boolean; outOfDate: boolean }
	{
		const translation = this.translations.get(translationKey(row, this.language.value));
		const note = this.notes.get(refKey(row));
		const noTranslation = (this.marks.get(refKey(row))?.noTranslation ?? row.noTranslation);

		return({
			translation: ((translation === undefined) ? row.translation : translation.text),
			note: ((note === undefined) ? row.note : note.note),
			noTranslation,
			outOfDate: (!noTranslation && ((translation === undefined) ? row.outOfDate : false))
		});
	}

	/**
	 * A piece of text's row: where it comes from (opening the translation dialog), the source text, the
	 * note and the translation, saying when it is missing or out of date
	 *
	 * @param row The text
	 * @return The row
	 */
	private createRow(row: UniverseTextRow): HTMLTableRowElement
	{
		const shown = this.withChanges(row);
		const tableRow = document.createElement('tr');
		const placeButton = document.createElement('button');
		const translation = document.createElement('span');
		const tags = joinTags(shown.outOfDate
			? t({
				id: 'editor.translations.outOfDateTag',
				defaultMessage: 'out of date',
				description: 'After a translation on the editor\'s Translations tab made from source text that has changed since'
			})
			: undefined);
		const source = ((row.source.length > SHOWN_SOURCE_LENGTH) ? `${row.source.slice(0, SHOWN_SOURCE_LENGTH)}...` : row.source);

		placeButton.type = 'button';
		placeButton.className = 'link-button';
		placeButton.textContent = describeTextPlace(row);
		placeButton.addEventListener('click', () =>
		{
			this.openRow(row);
		});

		if (shown.noTranslation)
		{
			translation.className = 'translation-missing';
			translation.textContent = t({
				id: 'editor.translations.noTranslationTag',
				defaultMessage: 'needs no translation',
				description: 'In the Translation column of the editor\'s Translations tab, for text marked as staying the same in every language, such as a proper name'
			});
		}
		else if (shown.translation === null)
		{
			translation.className = 'translation-missing';
			translation.textContent = t({
				id: 'editor.translations.missingTag',
				defaultMessage: 'missing',
				description: 'In the Translation column of the editor\'s Translations tab, for text not yet translated into the language chosen'
			});
		}
		else
		{
			translation.textContent = shown.translation;
			translation.lang = this.language.value;
		}

		for (const content of [placeButton, source, (shown.note ?? ''), translation])
		{
			const cell = document.createElement('td');

			cell.append(content);
			tableRow.append(cell);
		}

		if (tags !== '')
		{
			const tagText = document.createElement('div');

			tagText.className = 'hint';
			tagText.textContent = tags;
			tableRow.lastElementChild?.append(tagText);
		}

		return(tableRow);
	}

	/**
	 * Shows Import only to those who may translate into the language chosen
	 */
	private showFileButtons(): void
	{
		const universe = this.universe;

		this.importButton.hidden = !((universe !== undefined) && (this.language.value !== '') && canTranslate(universe, this.language.value));
	}

	/**
	 * Saves the universe's text with its translations into the language chosen, as the table shows them
	 * with the changes made, as a file in the format chosen. Text that needs no translation is left out.
	 * The file is made in the browser
	 */
	private async exportFile(): Promise<void>
	{
		const universe = this.universe;
		const language = this.language.value;
		const format = TRANSLATION_FILE_FORMATS.find((each) => (each === this.format.value));

		if (!universe || (language === '') || (format === undefined))
		{
			return;
		}

		let rows: UniverseTextRow[];

		showMessage(this.error, undefined);

		try
		{
			rows = (await this.api.listAllTranslations(universe.id, language)).rows;
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, {
				id: 'editor.translations.exportFailed',
				defaultMessage: 'Could not export the universe\'s text.',
				description: 'Shown on the editor\'s Translations tab when the universe\'s text couldn\'t be loaded to export it as a translation file'
			}));
			return;
		}

		const entries = rows.flatMap((row) =>
		{
			const shown = this.withChanges(row);

			return((shown.noTranslation
				? []
				: [{
					id: universeTextFileKey(row),
					place: describeTextPlace(row),
					note: shown.note,
					source: row.source,
					translation: shown.translation,
					outOfDate: shown.outOfDate
				}]));
		});
		const text = writeTranslationFile(format, {
			title: universe.name,
			sourceLanguage: universe.sourceLanguage,
			language,
			entries
		});
		downloadText(text, TRANSLATION_FILE_TYPES[format], `${universe.slug}-${language}${TRANSLATION_FILE_EXTENSIONS[format][0]}`);
	}

	/**
	 * Reads translations into the language chosen from a file, in the format its name says (or the
	 * format chosen), keeping them on the tab until the editor is saved, and says how many were read.
	 * Each keeps the hash of the source text the file holds, so one made from text that has changed since
	 * is out of date. Translations the file marks as needing review, for text the universe no longer has
	 * or that needs no translation, or that are too long or hold characters that aren't allowed, are
	 * skipped, and one that comes back as the table shows it is left as it is. A file larger than
	 * MAX_TRANSLATION_FILE_BYTES is refused without being read
	 *
	 * @param file The file
	 */
	private async importTranslations(file: File): Promise<void>
	{
		const universe = this.universe;
		const language = this.language.value;
		const format = (translationFileFormatOf(file.name) ?? TRANSLATION_FILE_FORMATS.find((each) => (each === this.format.value)));

		showMessage(this.error, undefined);
		showMessage(this.importStatus, undefined);

		if (!universe || (language === '') || (format === undefined))
		{
			return;
		}

		if (file.size > MAX_TRANSLATION_FILE_BYTES)
		{
			showMessage(this.error, describeTooLarge());
			return;
		}

		let read: ReadTranslationFile;
		let rows: UniverseTextRow[];

		try
		{
			read = await readTranslationFileFrom(file, format);
		}
		catch (error)
		{
			showMessage(this.error, describeUnreadable(error, format));
			return;
		}

		const fileLanguage = ((read.language === null) ? undefined : (canonicalLanguage(read.language) ?? read.language));

		if ((fileLanguage !== undefined) && (fileLanguage.toLowerCase() !== language.toLowerCase()))
		{
			showMessage(this.error, describeWrongLanguage(languageName(fileLanguage), languageName(language)));
			return;
		}

		try
		{
			rows = (await this.api.listAllTranslations(universe.id, language)).rows;
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, {
				id: 'editor.translations.importFailed',
				defaultMessage: 'Could not import the translations.',
				description: 'Shown on the editor\'s Translations tab when the universe\'s text couldn\'t be loaded to match a translation file against it'
			}));
			return;
		}

		const byKey = new Map(rows.map((row) => [universeTextFileKey(row), row]));
		let imported = 0;
		let skipped = 0;

		for (const entry of read.translations)
		{
			const row = byKey.get(entry.id);

			if (entry.translation === null)
			{
				continue;
			}

			const markdown = (row?.field === 'longDescription');
			const text = (markdown ? entry.translation : entry.translation.trim());

			if (entry.needsReview || !row || this.withChanges(row).noTranslation || (text === '') || (text.length > maxUniverseTextLength(row.kind, row.field)) || DISALLOWED_TEXT_CHARACTERS.test((markdown ? text.replace(/[\t\n\r]/g, '') : text)) || ((row.field === 'abbreviation') && !isValidCoinAbbreviation(text)))
			{
				skipped++;
				continue;
			}

			// Unchanged, so one that is out of date stays out of date
			if (text === this.withChanges(row).translation)
			{
				continue;
			}

			this.translations.set(translationKey(row, language), {
				ref: {
					kind: row.kind,
					thingId: row.thingId,
					field: row.field
				},
				language,
				text,
				sourceHash: ((entry.source === null) ? row.sourceHash : sourceTextHash(entry.source)),
				loaded: this.loadedTranslation(row, language)
			});
			imported++;
		}

		this.notifyChanged();
		this.render();
		showMessage(this.importStatus, t({
			id: 'editor.translations.imported',
			defaultMessage: '{imported, plural, =0 {No new translations to import.} one {Imported # translation, to be saved with Save.} other {Imported # translations, to be saved with Save.}} {skipped, plural, =0 {} one {Skipped # that was marked for review, too long, or for text that isn\'t the universe\'s any more or needs no translation.} other {Skipped # that were marked for review, too long, or for text that isn\'t the universe\'s any more or needs no translation.}}',
			description: 'Shown on the editor\'s Translations tab after importing a translation file: {imported} is how many translations it read that changed something, and {skipped} how many it couldn\'t use'
		}, {
			imported,
			skipped
		}));
	}

	/**
	 * The translation a change to one is made from: as the table listed it, or as it was when an earlier
	 * change not yet saved was made
	 *
	 * @param row The text as the server listed it
	 * @param language The translation's language
	 * @return The translation, or null for none
	 */
	private loadedTranslation(row: UniverseTextRow, language: string): string | null
	{
		const staged = this.translations.get(translationKey(row, language));

		return(((staged === undefined) ? row.translation : staged.loaded));
	}

	/**
	 * Opens the translation dialog for a piece of text, keeping its changes in the table
	 *
	 * @param row The text as the server listed it
	 */
	private openRow(row: UniverseTextRow): void
	{
		const universe = this.universe;
		const language = this.language.value;

		if (!universe)
		{
			return;
		}

		const shown = this.withChanges(row);
		const ref: UniverseTextRef = {
			kind: row.kind,
			thingId: row.thingId,
			field: row.field
		};

		this.dialog.open({
			row,
			translation: shown.translation,
			note: shown.note,
			noTranslation: shown.noTranslation,
			outOfDate: shown.outOfDate,
			mayTranslate: (canTranslate(universe, language) && canEditVersionOpen(universe)),
			mayWriteNote: canEditWorldOpen(universe),
			mayMarkNoTranslation: (canMarkNoTranslation(universe) && canEditVersionOpen(universe)),
			apply: (translation, note, noTranslation) =>
			{
				if (noTranslation === row.noTranslation)
				{
					this.marks.delete(refKey(ref));
				}
				else if (noTranslation !== undefined)
				{
					this.marks.set(refKey(ref), { ref, noTranslation });
				}

				// Text put back as it is saved, and up to date, has nothing left to save
				if ((translation === row.translation) && !row.outOfDate)
				{
					this.translations.delete(translationKey(ref, language));
				}
				else if (translation !== undefined)
				{
					this.translations.set(translationKey(ref, language), { ref, language, text: translation, sourceHash: row.sourceHash, loaded: this.loadedTranslation(row, language) });
				}

				if (note === row.note)
				{
					this.notes.delete(refKey(ref));
				}
				else if (note !== undefined)
				{
					const staged = this.notes.get(refKey(ref));

					this.notes.set(refKey(ref), { ref, note, loaded: ((staged === undefined) ? row.note : staged.loaded) });
				}

				this.notifyChanged();
				this.render();
			}
		}, describeTextPlace(row), languageName(language));
	}
}
