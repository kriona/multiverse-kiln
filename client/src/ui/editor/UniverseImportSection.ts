import { canImportUniverse, defineMessages, languageNameIn, MAX_UNIVERSE_IMPORT_BYTES, rulesetHasThemes, type EditableUniverse, type MessageDescriptor, type UniverseImportLeftOut, type UniverseImportPreview } from '@multiverse-kiln/shared';
import copyIcon from 'virtual:icon/ph:copy';

import { currentLocale, formatDateTime, formatList, t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { hasUnsavedWork } from '../changeTracker';
import { getElement, setButtonLabel, showMessage } from '../dom';
import { reportFieldError, setFieldError } from '../fieldErrors';
import { showToast } from '../toast';
import { startDraftLabel } from './StartDraftDialog';

/**
 * What the dialog says each part of a file it leaves out is, and why
 */
const LEFT_OUT_MESSAGES: Record<UniverseImportLeftOut, MessageDescriptor> = defineMessages({
	universeOnly: {
		id: 'editor.universeImport.leftOut.universeOnly',
		defaultMessage: 'Its editors, stage and two-factor setting, which belong to the universe rather than its draft',
		description: 'In the list of what a file chosen in the dialog importing it into the universe\'s draft leaves out: the parts of the universe a draft has no copy of'
	},
	settingsRole: {
		id: 'editor.universeImport.leftOut.settingsRole',
		defaultMessage: 'Its settings, races, classes, themes and Ruleset tab, which your role can\'t change',
		description: 'In the list of what a file chosen in the dialog importing it into the universe\'s draft leaves out, for a builder or translator: what only the universe\'s creators change'
	},
	worldRole: {
		id: 'editor.universeImport.leftOut.worldRole',
		defaultMessage: 'Its tilesets, tiles, items, areas and notes for translators, which your role can\'t change',
		description: 'In the list of what a file chosen in the dialog importing it into the universe\'s draft leaves out, for a translator: what only creators and builders change'
	},
	noTranslationRole: {
		id: 'editor.universeImport.leftOut.noTranslationRole',
		defaultMessage: 'Its text marked as needing no translation, which your role can\'t change',
		description: 'In the list of what a file chosen in the dialog importing it into the universe\'s draft leaves out, for a role that can\'t mark text as needing no translation'
	},
	translationLanguages: {
		id: 'editor.universeImport.leftOut.translationLanguages',
		defaultMessage: 'Its translations into languages the universe isn\'t translated into, or that you can\'t translate into',
		description: 'In the list of what a file chosen in the dialog importing it into the universe\'s draft leaves out: translations the player\'s role, or the universe\'s languages, don\'t take'
	},
	nameTaken: {
		id: 'editor.universeImport.leftOut.nameTaken',
		defaultMessage: 'Its name, which another universe has, so the draft keeps its own',
		description: 'In the list of what a file chosen in the dialog importing it into the universe\'s draft leaves out: the file\'s universe name, since names are unique among universes'
	},
	keptForSettings: {
		id: 'editor.universeImport.leftOut.keptForSettings',
		defaultMessage: 'Deleting the draft\'s lobby, starting areas and starting equipment that the file doesn\'t have, since your role can\'t change the settings naming them',
		description: 'In the list of what a file chosen in the dialog importing it into the universe\'s draft leaves out, for a builder: the draft\'s areas and items its settings name are kept, though the file doesn\'t have them'
	}
});

/**
 * What the dialog Import Universe opens while the live version is open says
 */
const draftMessages = defineMessages({
	openDraft: {
		id: 'editor.universeImport.needsDraft.open',
		defaultMessage: 'Files must be imported into the universe\'s draft. Open the draft to import into it.',
		description: 'In the dialog Import Universe opens on the editor\'s Universe tab while the editor shows the live version and the universe has a draft; Open Draft follows'
	},
	startDraft: {
		id: 'editor.universeImport.needsDraft.start',
		defaultMessage: 'Files must be imported into the universe\'s draft. The universe has no draft yet; you must start one to import changes.',
		description: 'In the dialog Import Universe opens on the editor\'s Universe tab, for a creator, while the universe has no draft; Start Draft follows, which starts one and then opens the dialog importing a file'
	},
	creatorsStart: {
		id: 'editor.universeImport.needsDraft.creatorsStart',
		defaultMessage: 'Files must be imported into the universe\'s draft. The universe has no draft yet, and only its creators can start one.',
		description: 'In the dialog Import Universe opens on the editor\'s Universe tab, for a builder or translator, while the universe has no draft, which only its creators can start'
	},
	starting: {
		id: 'editor.universeImport.startingDraft',
		defaultMessage: 'Starting the draft...',
		description: 'Shown at the left of the buttons in the dialog Import Universe opens while the universe has no draft, and read out, while Start Draft starts one'
	}
});

/**
 * What the editor does with the universe's draft, for importing into it
 */
export interface ImportDrafts
{
	/**
	 * Whether the player may start the universe's draft now
	 *
	 * @return True for a creator, while saving isn't turned off
	 */
	canStart(): boolean;

	/**
	 * Whether the editor's tabs have unsaved changes, which starting the draft saves first
	 *
	 * @return True when they have
	 */
	hasUnsavedChanges(): boolean;

	/**
	 * Starts the draft, saving the unsaved changes with it; the editor then opens the draft
	 *
	 * @return Whether it was started
	 */
	start(): Promise<boolean>;

	/**
	 * Opens the draft, after asking whether to throw away unsaved changes
	 *
	 * @return Whether it opens
	 */
	open(): boolean;

	/**
	 * Loads the draft again once a file is imported into it
	 */
	imported(): void;
}

/**
 * Import Universe, between Export Universe and Delete Universe under the settings card on the editor's
 * Universe tab, and the dialog it opens (see Importing a universe in STRUCTURE-OVERVIEW.md): for every
 * role that may change something in the universe, while its draft is open. The dialog reads the file
 * chosen and says what importing it replaces and leaves out, then imports it into the draft at once, as
 * applying the draft is saved at once once it is confirmed; the live version changes only once the
 * draft is applied. It waits until no other change is unsaved, since it replaces the draft they belong to.
 * While the live version is open, Import Universe first opens a dialog saying files go into the draft,
 * which opens the draft, or starts one, and then the import dialog
 */
export class UniverseImportSection
{
	private readonly openButton = getElement('universe-import', HTMLButtonElement);
	private readonly draftDialog = getElement('universe-import-draft-dialog', HTMLDialogElement);
	private readonly draftForm = getElement('universe-import-draft-form', HTMLFormElement);
	private readonly draftText = getElement('universe-import-draft-text', HTMLElement);
	private readonly draftUnsaved = getElement('universe-import-draft-unsaved', HTMLElement);
	private readonly draftStatus = getElement('universe-import-draft-status', HTMLElement);
	private readonly draftCancelButton = getElement('universe-import-draft-cancel', HTMLButtonElement);
	private readonly startButton = getElement('universe-import-draft-start', HTMLButtonElement);
	private readonly openDraftButton = getElement('universe-import-draft-open', HTMLButtonElement);
	private readonly dialog = getElement('universe-import-dialog', HTMLDialogElement);
	private readonly form = getElement('universe-import-form', HTMLFormElement);
	private readonly fileInput = getElement('universe-import-file', HTMLInputElement);
	private readonly preview = getElement('universe-import-preview', HTMLElement);
	private readonly source = getElement('universe-import-source', HTMLElement);
	private readonly match = getElement('universe-import-match', HTMLElement);
	private readonly parts = getElement('universe-import-parts', HTMLElement);
	private readonly leftOutHeading = getElement('universe-import-left-out-heading', HTMLElement);
	private readonly leftOut = getElement('universe-import-left-out', HTMLElement);
	private readonly rightsField = getElement('universe-import-rights-field', HTMLElement);
	private readonly rights = getElement('universe-import-rights', HTMLInputElement);
	private readonly unsaved = getElement('universe-import-unsaved', HTMLElement);
	private readonly status = getElement('universe-import-status', HTMLElement);
	private readonly error = getElement('universe-import-error', HTMLElement);
	private readonly cancelButton = getElement('universe-import-cancel', HTMLButtonElement);
	private readonly submitButton = getElement('universe-import-submit', HTMLButtonElement);

	/**
	 * The universe open in the editor
	 */
	private universe: EditableUniverse | undefined;

	/**
	 * Whether the window can no longer use the universe's editor, such as once it was deleted
	 */
	private locked = false;

	/**
	 * The file chosen and what importing it would do, once the server has read it
	 */
	private chosen: { file: File; preview: UniverseImportPreview } | undefined;

	/**
	 * Counts the files chosen, so a preview that arrives after another file was chosen is dropped
	 */
	private reading = 0;

	/**
	 * Whether the file is being imported, which can't be stopped once it is sent
	 */
	private importing = false;

	/**
	 * Whether the draft is being started from the dialog saying files go into the draft
	 */
	private startingDraft = false;

	/**
	 * Whether the import dialog opens once the editor opens the draft, which the dialog saying files go
	 * into the draft opened or started
	 */
	private importOnceDraftOpens = false;

	/**
	 * @param api The editor's routes, which import the file
	 * @param drafts What the editor does with the universe's draft
	 */
	constructor(private readonly api: EditorApi, private readonly drafts: ImportDrafts)
	{
		this.openButton.addEventListener('click', () =>
		{
			if (this.universe?.version === 'draft')
			{
				this.openDialog();
			}
			else
			{
				this.openDraftDialog();
			}
		});

		this.draftForm.addEventListener('submit', (event) =>
		{
			event.preventDefault();

			if (event.submitter === this.startButton)
			{
				void this.startDraft();
			}
			else
			{
				this.openDraft();
			}
		});

		this.draftCancelButton.addEventListener('click', () =>
		{
			this.draftDialog.close();
		});

		// Escape would leave the draft starting with no dialog to say how it went. The editor closing every
		// dialog as it opens the draft sends its own cancel, which mustn't be stopped
		this.draftDialog.addEventListener('cancel', (event) =>
		{
			if (this.startingDraft && event.isTrusted)
			{
				event.preventDefault();
			}
		});

		this.fileInput.addEventListener('change', () =>
		{
			void this.read();
		});

		this.rights.addEventListener('change', () =>
		{
			setFieldError(this.rights, undefined);
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.submit();
		});

		this.cancelButton.addEventListener('click', () =>
		{
			this.dialog.close();
		});

		// Escape would leave the import running with no dialog to say how it went. The editor closing every
		// dialog, such as when it opens another version, sends its own cancel, which mustn't be stopped
		this.dialog.addEventListener('cancel', (event) =>
		{
			if (this.importing && event.isTrusted)
			{
				event.preventDefault();
			}
		});
	}

	/**
	 * Shows Import Universe for a role that may import into the universe, and opens the import dialog
	 * once the draft opens, when the dialog saying files go into the draft opened or started it
	 *
	 * @param universe The universe open in the editor
	 */
	open(universe: EditableUniverse): void
	{
		this.universe = universe;
		this.openButton.hidden = !canImportUniverse(universe.role);
		this.updateButtons();

		if (this.importOnceDraftOpens && (universe.version === 'draft'))
		{
			this.importOnceDraftOpens = false;

			if (!this.openButton.hidden && !this.locked)
			{
				this.openDialog();
			}
		}
	}

	/**
	 * Turns off Import Universe once the window can't use the universe's editor any more, such as when it
	 * was deleted in another window or the player lost their role
	 */
	lock(): void
	{
		this.locked = true;
		this.updateButtons();
	}

	/**
	 * Turns Import Universe on while the window may use the editor, the import dialog's Import into Draft
	 * once a file is read and nothing else is unsaved, and the draft dialog's buttons while it isn't
	 * starting the draft
	 */
	private updateButtons(): void
	{
		const usable = (!this.locked && (this.universe?.version === 'draft'));

		this.openButton.disabled = this.locked;
		this.submitButton.disabled = (!usable || this.importing || (this.chosen === undefined) || hasUnsavedWork());
		this.cancelButton.disabled = this.importing;
		this.fileInput.disabled = this.importing;
		this.startButton.disabled = (this.locked || this.startingDraft);
		this.openDraftButton.disabled = this.locked;
		this.draftCancelButton.disabled = this.startingDraft;
	}

	/**
	 * Opens the dialog saying files go into the draft, with a button that opens it, or starts it when
	 * the universe has none and the player may start one
	 */
	private openDraftDialog(): void
	{
		const universe = this.universe;

		if (!universe)
		{
			return;
		}

		const canStart = (!universe.hasDraft && this.drafts.canStart());
		const unsaved = this.drafts.hasUnsavedChanges();

		this.draftText.textContent = t(universe.hasDraft ? draftMessages.openDraft : (canStart ? draftMessages.startDraft : draftMessages.creatorsStart));
		this.draftUnsaved.hidden = !(canStart && unsaved);
		this.draftStatus.textContent = '';
		this.startButton.hidden = !canStart;
		this.openDraftButton.hidden = !universe.hasDraft;
		setButtonLabel(this.startButton, copyIcon, startDraftLabel(unsaved));
		this.updateButtons();
		this.draftDialog.showModal();

		if (canStart)
		{
			this.startButton.focus();
		}
		else if (universe.hasDraft)
		{
			this.openDraftButton.focus();
		}
		else
		{
			this.draftCancelButton.focus();
		}
	}

	/**
	 * Starts the draft, saving the editor's unsaved changes with it, then opens the import dialog once the
	 * editor opens the draft. A save the server refuses says why on the Universe tab, which the dialog
	 * closes to show
	 */
	private async startDraft(): Promise<void>
	{
		if (this.startingDraft)
		{
			return;
		}

		this.startingDraft = true;
		this.importOnceDraftOpens = true;
		this.draftStatus.textContent = t(draftMessages.starting);
		this.updateButtons();

		let started: boolean;

		try
		{
			started = await this.drafts.start();
		}
		finally
		{
			this.startingDraft = false;
			this.draftStatus.textContent = '';
			this.updateButtons();
		}

		// Opening the draft closes it already; one that couldn't start says why on the Universe tab
		this.draftDialog.close();

		if (!started)
		{
			this.importOnceDraftOpens = false;
		}
	}

	/**
	 * Opens the draft, after asking about unsaved changes, then the import dialog once the editor has it open
	 */
	private openDraft(): void
	{
		this.importOnceDraftOpens = true;

		if (!this.drafts.open())
		{
			this.importOnceDraftOpens = false;
		}
	}

	/**
	 * Opens the dialog, with no file chosen
	 */
	private openDialog(): void
	{
		if (!this.universe)
		{
			return;
		}

		this.reading++;
		this.chosen = undefined;
		this.fileInput.value = '';
		this.rights.checked = false;
		this.preview.hidden = true;
		this.unsaved.hidden = !hasUnsavedWork();
		this.status.textContent = '';
		setFieldError(this.fileInput, undefined);
		setFieldError(this.rights, undefined);
		showMessage(this.error, undefined);
		this.updateButtons();
		this.dialog.showModal();
		this.fileInput.focus();
	}

	/**
	 * Has the server read the file chosen, and shows what importing it would do
	 */
	private async read(): Promise<void>
	{
		const universe = this.universe;
		const file = this.fileInput.files?.[0];
		const reading = ++this.reading;

		this.chosen = undefined;
		this.preview.hidden = true;
		setFieldError(this.fileInput, undefined);
		showMessage(this.error, undefined);
		this.updateButtons();

		if (!universe || !file)
		{
			return;
		}

		if (file.size > MAX_UNIVERSE_IMPORT_BYTES)
		{
			reportFieldError(this.fileInput, t({
				id: 'editor.universeImport.tooLarge',
				defaultMessage: 'The file can be at most {max, number} MB.',
				description: 'Shown under the field choosing the file in the dialog importing it into the universe\'s draft, when the file is too big; {max} is the most it can be, in megabytes'
			}, {
				max: MAX_UNIVERSE_IMPORT_BYTES / (1024 * 1024)
			}));
			return;
		}

		this.status.textContent = t({
			id: 'editor.universeImport.reading',
			defaultMessage: 'Reading the file...',
			description: 'Shown at the left of the buttons in the dialog importing a zip file into the universe\'s draft, and read out, while the server reads the file chosen'
		});

		try
		{
			const preview = await this.api.previewImport(universe.id, file, currentLocale());

			if (reading === this.reading)
			{
				this.chosen = { file, preview };
				this.showPreview(preview);
			}
		}
		catch (error)
		{
			if (reading === this.reading)
			{
				reportFieldError(this.fileInput, describeEditorError(error, {
					id: 'editor.universeImport.readFailed',
					defaultMessage: 'Could not read the file.',
					description: 'Shown under the field choosing the file in the dialog importing it into the universe\'s draft, when the server couldn\'t read it, followed by why'
				}));
			}
		}
		finally
		{
			if (reading === this.reading)
			{
				this.status.textContent = '';
				this.updateButtons();
			}
		}
	}

	/**
	 * Shows what importing the file chosen would do: what it is, what it replaces and what it leaves out
	 *
	 * @param preview What the server read
	 */
	private showPreview(preview: UniverseImportPreview): void
	{
		const { universe, counts } = preview;
		const items: string[] = [];

		this.source.textContent = t({
			id: 'editor.universeImport.source',
			defaultMessage: '{universe} ({version, select, draft {draft version} other {live version}}) originally exported {date} by {name} (@{username}).',
			description: 'In the dialog importing a zip file into the universe\'s draft, once a file is chosen: which universe and version it was exported from, when and by whom; {universe} is the universe\'s name, {version} is draft or live, {date} the date and time, {name} and {username} the exporting player\'s'
		}, {
			universe: universe.name,
			version: universe.version,
			date: formatDateTime(preview.exportedAt),
			name: preview.exportedBy.displayName,
			username: preview.exportedBy.username
		});
		this.match.textContent = describeMatch(preview);

		// Importing another universe's file replaces everything with things made anew, so it stands out
		this.match.className = (preview.sameUniverse ? 'hint' : 'notice');

		if (preview.parts.includes('settings'))
		{
			items.push(t({
				id: 'editor.universeImport.part.settings',
				defaultMessage: 'Settings, from the Universe, Lobby, Characters, Ruleset and Translations tabs, with {levels, plural, one {# difficulty level} other {# difficulty levels}}',
				description: 'In the list of what importing a zip file replaces in the universe\'s draft: the universe\'s settings; {levels} is how many difficulty levels the file has'
			}, {
				levels: counts.difficultyLevels
			}));
			items.push(t({
				id: 'editor.universeImport.part.races',
				defaultMessage: 'Races and classes, with {races, plural, one {# race} other {# races}} and {classes, plural, one {# class} other {# classes}} the file\'s universe added or changed',
				description: 'In the list of what importing a zip file replaces in the universe\'s draft; {races} and {classes} count those the file\'s universe added, or changed from the ruleset\'s'
			}, {
				races: counts.races,
				classes: counts.classes
			}));

			if (rulesetHasThemes(universe.ruleset))
			{
				items.push(t({
					id: 'editor.universeImport.part.themes',
					defaultMessage: 'Themes, with {count, plural, one {# theme} other {# themes}} the file\'s universe added or changed',
					description: 'In the list of what importing a zip file replaces in the universe\'s draft, for a ruleset with themes (Starfinder); {count} counts those the file\'s universe added, or changed from the ruleset\'s'
				}, {
					count: counts.themes
				}));
			}
		}

		if (preview.parts.includes('world'))
		{
			items.push(t({
				id: 'editor.universeImport.part.areas',
				defaultMessage: '{count, plural, one {# area} other {# areas}}, with their cells and links',
				description: 'In the list of what importing a zip file replaces in the universe\'s draft: its areas; {count} is how many the file has'
			}, {
				count: counts.areas
			}));
			items.push(t({
				id: 'editor.universeImport.part.tiles',
				defaultMessage: 'Tiles and tilesets, with {tiles, plural, one {# tile} other {# tiles}} the file\'s universe added or changed, and {uploads, plural, one {# tileset} other {# tilesets}} to upload',
				description: 'In the list of what importing a zip file replaces in the universe\'s draft; {tiles} counts the tiles the file\'s universe added, or changed from the ruleset\'s, and {uploads} its uploaded tilesets the draft doesn\'t have'
			}, {
				tiles: counts.tiles,
				uploads: counts.tileGraphics
			}));
			items.push(t({
				id: 'editor.universeImport.part.items',
				defaultMessage: 'Items, with {count, plural, one {# item} other {# items}} the file\'s universe added or changed',
				description: 'In the list of what importing a zip file replaces in the universe\'s draft; {count} counts the items the file\'s universe added, or changed from the ruleset\'s'
			}, {
				count: counts.items
			}));
			items.push(t({
				id: 'editor.universeImport.part.notes',
				defaultMessage: '{count, plural, one {# note for translators} other {# notes for translators}}',
				description: 'In the list of what importing a zip file replaces in the universe\'s draft: the notes its editors wrote for translators; {count} is how many the file has'
			}, {
				count: counts.translatorNotes
			}));
		}

		if (preview.parts.includes('noTranslation'))
		{
			items.push(t({
				id: 'editor.universeImport.part.noTranslation',
				defaultMessage: '{count, plural, one {# piece of text} other {# pieces of text}} marked as needing no translation',
				description: 'In the list of what importing a zip file replaces in the universe\'s draft: which text needs no translation, such as proper names; {count} is how many pieces of text the file marks'
			}, {
				count: counts.noTranslation
			}));
		}

		if (preview.parts.includes('translations'))
		{
			items.push(t({
				id: 'editor.universeImport.part.translations',
				defaultMessage: '{count, plural, one {# translation} other {# translations}} into {languages}',
				description: 'In the list of what importing a zip file replaces in the universe\'s draft: its translations; {count} is how many the file has, and {languages} lists the languages, such as "French and German"'
			}, {
				count: counts.translations,
				languages: formatList(preview.translationLanguages.map((language) => languageNameIn(language, currentLocale())), 'conjunction')
			}));
		}

		fillList(this.parts, items);
		fillList(this.leftOut, preview.leftOut.map((reason) => t(LEFT_OUT_MESSAGES[reason])));
		this.leftOutHeading.hidden = (preview.leftOut.length === 0);
		this.leftOut.hidden = (preview.leftOut.length === 0);
		this.rightsField.hidden = (preview.tilesetUploads === 0);
		this.preview.hidden = false;
	}

	/**
	 * Imports the file chosen into the draft, then closes the dialog and loads the draft again
	 */
	private async submit(): Promise<void>
	{
		const universe = this.universe;
		const chosen = this.chosen;

		if (!universe || !chosen || this.importing)
		{
			return;
		}

		if (hasUnsavedWork())
		{
			this.unsaved.hidden = false;
			this.updateButtons();
			return;
		}

		if ((chosen.preview.tilesetUploads > 0) && !this.rights.checked)
		{
			reportFieldError(this.rights, t({
				id: 'editor.universeImport.rightsNeeded',
				defaultMessage: 'Confirm you have the rights to use the tilesets\' images.',
				description: 'Shown under the checkbox in the dialog importing a zip file into the universe\'s draft, when it is left unchecked and the file uploads tilesets\' pictures'
			}));
			return;
		}

		this.importing = true;
		this.updateButtons();
		showMessage(this.error, undefined);
		this.status.textContent = t({
			id: 'editor.universeImport.importing',
			defaultMessage: 'Importing...',
			description: 'Shown at the left of the buttons in the dialog importing a zip file into the universe\'s draft, and read out, while it is imported'
		});

		try
		{
			await this.api.importUniverse(universe.id, chosen.file, this.rights.checked, currentLocale());
		}
		catch (error)
		{
			this.importing = false;
			this.status.textContent = '';
			showMessage(this.error, describeEditorError(error, {
				id: 'editor.universeImport.failed',
				defaultMessage: 'Could not import the file. Nothing was imported.',
				description: 'Shown in the dialog importing a zip file into the universe\'s draft when the server refused it, followed by why; it saves all of it or none of it'
			}));
			this.updateButtons();
			return;
		}

		this.importing = false;
		this.dialog.close();
		showToast(t({
			id: 'editor.universeImport.imported',
			defaultMessage: 'Imported into the draft.',
			description: 'Toast once a zip file is imported into the universe\'s draft (a copy players don\'t see until it is applied); the editor then shows the draft again'
		}), {
			kind: 'success'
		});
		this.drafts.imported();
	}
}

/**
 * What the import dialog says of whether a file is of this universe, and for another universe's, the
 * name the universe is given
 *
 * @param preview What the server read
 * @return The text
 */
function describeMatch(preview: UniverseImportPreview): string
{
	if (preview.sameUniverse)
	{
		return(t({
			id: 'editor.universeImport.sameUniverse',
			defaultMessage: 'The file is of this universe, so what it holds keeps its place: characters and groups go on naming the same areas, races, classes and items once the draft is applied.',
			description: 'In the dialog importing a zip file into the universe\'s draft, when the file was exported from this universe: its things are matched with the draft\'s rather than made anew'
		}));
	}

	if (preview.name === null)
	{
		return(t({
			id: 'editor.universeImport.otherUniverse',
			defaultMessage: 'This file is from another universe; everything in your universe will be replaced by the contents of this file.',
			description: 'Warning in the dialog importing a zip file into the universe\'s draft, when the file was exported from another universe, perhaps on another site, and the universe keeps its own name'
		}));
	}

	return(t({
		id: 'editor.universeImport.otherUniverseRenamed',
		defaultMessage: 'This file is from another universe; everything in your universe will be replaced by the contents of this file, and it will be named {name}.',
		description: 'Warning in the dialog importing a zip file into the universe\'s draft, when the file was exported from another universe, perhaps on another site; {name} is the name the universe is given, such as "Kilnhaven (copy)"'
	}, {
		name: preview.name
	}));
}

/**
 * Fills a list with items of text
 *
 * @param list The list
 * @param items The items' text
 */
function fillList(list: HTMLElement, items: readonly string[]): void
{
	list.replaceChildren(...items.map((text) =>
	{
		const item = document.createElement('li');

		item.textContent = text;

		return(item);
	}));
}
