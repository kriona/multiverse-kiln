import { DISALLOWED_TEXT_CHARACTERS, MAX_TRANSLATOR_NOTE_LENGTH, maxUniverseTextLength, type UniverseTextRow } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { ChangeTracker } from '../changeTracker';
import { getElement, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import { showMarkdown } from '../markdown';

/**
 * What the translation dialog shows and does with a piece of universe text, keeping its changes on the
 * Translations tab until the editor is saved
 */
export interface TranslationEdit
{
	/**
	 * The text as the server listed it
	 */
	readonly row: UniverseTextRow;

	/**
	 * The translation and note as the tab shows them, with its changes, and whether the text needs no
	 * translation
	 */
	readonly translation: string | null;
	readonly note: string | null;
	readonly noTranslation: boolean;

	/**
	 * Whether the translation shown was made from source text that has changed since
	 */
	readonly outOfDate: boolean;

	/**
	 * Whether the player may translate into the language, write notes, and mark text as needing no translation
	 */
	readonly mayTranslate: boolean;
	readonly mayWriteNote: boolean;
	readonly mayMarkNoTranslation: boolean;

	/**
	 * Keeps the dialog's changes on the tab
	 *
	 * @param translation The translation to save with the current source text's hash (null to delete
	 * it), or undefined to leave it as it is
	 * @param note The note to save (null to delete it), or undefined to leave it as it is
	 * @param noTranslation Whether the text needs no translation, or undefined to leave it as it is
	 */
	apply(translation: string | null | undefined, note: string | null | undefined, noTranslation: boolean | undefined): void;
}

/**
 * The dialog that translates one piece of universe text into one language on the Translations tab: the
 * source text (rendered, for a long description, with a preview of the translation), the note for
 * translators, and the translation. Apply keeps the changes on the tab; Still Correct keeps an
 * out-of-date translation as it is, marked up to date
 */
export class TranslationDialog
{
	private readonly dialog = getElement('translation-dialog', HTMLDialogElement);
	private readonly form = getElement('translation-form', HTMLFormElement);
	private readonly title = getElement('translation-dialog-title', HTMLElement);
	private readonly source = getElement('translation-source', HTMLElement);
	private readonly outOfDate = getElement('translation-out-of-date', HTMLElement);
	private readonly note = getElement('translation-note', HTMLTextAreaElement);
	private readonly noTranslation = getElement('translation-no-translation', HTMLInputElement);
	private readonly textField = getElement('translation-text-field', HTMLElement);
	private readonly text = getElement('translation-text', HTMLInputElement);
	private readonly longField = getElement('translation-long-field', HTMLElement);
	private readonly long = getElement('translation-long', HTMLTextAreaElement);
	private readonly preview = getElement('translation-preview', HTMLElement);
	private readonly error = getElement('translation-dialog-error', HTMLElement);
	private readonly confirmButton = getElement('translation-confirm', HTMLButtonElement);
	private readonly applyButton = getElement('translation-apply', HTMLButtonElement);

	/**
	 * Whether the dialog has changes that haven't been applied
	 */
	private readonly changes = new ChangeTracker({ root: this.form });

	/**
	 * The piece of text shown
	 */
	private edit: TranslationEdit | undefined;

	constructor()
	{
		this.note.maxLength = MAX_TRANSLATOR_NOTE_LENGTH;
		this.changes.guardDialog(this.dialog);

		this.long.addEventListener('input', () =>
		{
			showMarkdown(this.preview, this.long.value);
		});

		this.noTranslation.addEventListener('change', () =>
		{
			this.showTranslationState();
		});

		getElement('translation-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			if (this.changes.confirmDiscard())
			{
				this.dialog.close();
			}
		});

		this.confirmButton.addEventListener('click', () =>
		{
			this.apply(true);
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			this.apply(false);
		});
	}

	/**
	 * Opens the dialog for a piece of universe text
	 *
	 * @param edit The text, with what the player may change and where the changes go
	 * @param place Where the text comes from, e.g. "Area: Waterdeep, name"
	 * @param language The language's name
	 */
	open(edit: TranslationEdit, place: string, language: string): void
	{
		const { row } = edit;
		const markdown = (row.field === 'longDescription');
		const input = this.translationInput(markdown);

		this.edit = edit;
		this.title.textContent = t({
			id: 'editor.translations.dialogTitle',
			defaultMessage: '{place} in {language}',
			description: 'Title of the dialog that translates a piece of universe text; {place} is where it comes from, such as Area: Waterdeep, name, and {language} the name of the language it is translated into'
		}, {
			place,
			language
		});
		this.source.classList.toggle('markdown', markdown);

		if (markdown)
		{
			showMarkdown(this.source, row.source);
		}
		else
		{
			this.source.textContent = row.source;
		}

		this.textField.hidden = markdown;
		this.longField.hidden = !markdown;
		input.maxLength = maxUniverseTextLength(row.kind, row.field);
		input.value = (edit.translation ?? '');
		input.readOnly = !edit.mayTranslate;
		showMarkdown(this.preview, this.long.value);
		this.note.value = (edit.note ?? '');
		this.note.readOnly = !edit.mayWriteNote;
		this.noTranslation.checked = edit.noTranslation;
		this.noTranslation.disabled = !edit.mayMarkNoTranslation;
		this.applyButton.hidden = !(edit.mayTranslate || edit.mayWriteNote || edit.mayMarkNoTranslation);
		this.showTranslationState();
		showMessage(this.error, undefined);
		clearFieldErrors(this.dialog);
		this.dialog.showModal();
		this.changes.markSaved();
		(edit.mayTranslate ? input : this.note).focus();
	}

	/**
	 * Shows the translation as text that needs one or not: text that needs none can't be translated
	 * here, and isn't out of date
	 */
	private showTranslationState(): void
	{
		const edit = this.edit;

		if (!edit)
		{
			return;
		}

		const needed = !this.noTranslation.checked;

		this.text.disabled = !needed;
		this.long.disabled = !needed;
		this.outOfDate.hidden = !(needed && edit.outOfDate);
		this.confirmButton.hidden = !(needed && edit.outOfDate && edit.mayTranslate);
	}

	/**
	 * The field the translation is typed in: a text area for a long description, which is markdown, and
	 * a line for everything else
	 *
	 * @param markdown Whether the text is a long description
	 * @return The field
	 */
	private translationInput(markdown: boolean): HTMLInputElement | HTMLTextAreaElement
	{
		return((markdown ? this.long : this.text));
	}

	/**
	 * Keeps the dialog's changes on the tab and closes it, unless a field holds characters that aren't allowed
	 *
	 * @param confirm Whether to keep the translation even when it hasn't changed, marking it up to date
	 */
	private apply(confirm: boolean): void
	{
		const edit = this.edit;

		if (!edit)
		{
			return;
		}

		const markdown = (edit.row.field === 'longDescription');
		const input = this.translationInput(markdown);
		const typed = (markdown ? input.value : input.value.trim());
		const translation = ((typed.trim() === '') ? null : typed);
		const note = (this.note.value.trim() || null);

		for (const [field, text] of [[input, typed], [this.note, (note ?? '')]] as const)
		{
			if (DISALLOWED_TEXT_CHARACTERS.test(((field === input) && !markdown) ? text : text.replace(/[\t\n\r]/g, '')))
			{
				reportFieldError(field, t(formMessages.invalidText));
				return;
			}
		}

		const noTranslation = this.noTranslation.checked;
		const translationChanged = (edit.mayTranslate && !noTranslation && (confirm || (translation !== edit.translation)));
		const noteChanged = (edit.mayWriteNote && (note !== edit.note));
		const markChanged = (edit.mayMarkNoTranslation && (noTranslation !== edit.noTranslation));

		edit.apply((translationChanged ? translation : undefined), (noteChanged ? note : undefined), (markChanged ? noTranslation : undefined));
		this.changes.markSaved();
		this.dialog.close();
	}
}
