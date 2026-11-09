import { defineMessages } from '@multiverse-kiln/shared';
import copyIcon from 'virtual:icon/ph:copy';

import { t } from '../../localization';
import { getElement, setButtonLabel } from '../dom';

/**
 * The buttons that start a draft, in the dialog explaining drafts and the one Import Universe opens
 */
const startDraftMessages = defineMessages({
	saveAndStart: {
		id: 'editor.startDraft.saveAndStart',
		defaultMessage: 'Save Changes And Start Draft',
		description: 'Button in the dialog explaining drafts, and in the one Import Universe opens while the universe has none, when the editor has unsaved changes: saves them to the live version, then starts a draft (a copy of the universe editors change without players seeing it) with them'
	},
	start: {
		id: 'editor.draft.start',
		defaultMessage: 'Start Draft',
		description: 'Button that starts a draft of the universe when the editor is saved: a copy editors change without players seeing it, in the editor\'s toolbar, the dialog explaining drafts and the one Import Universe opens while the universe has none'
	}
});

/**
 * What a button starting a draft says
 *
 * @param hasUnsavedChanges Whether the editor has unsaved changes, which starting the draft saves first
 * @return The button's text
 */
export function startDraftLabel(hasUnsavedChanges: boolean): string
{
	return(t(hasUnsavedChanges ? startDraftMessages.saveAndStart : startDraftMessages.start));
}

/**
 * The dialog the toolbar's Start Draft button opens: explains what a draft is and that applying one
 * overwrites the whole universe, then starts one (see Universe versions in STRUCTURE-OVERVIEW.md). With
 * unsaved changes, its button saves them too, in the same save, so the draft starts with them
 */
export class StartDraftDialog
{
	private readonly dialog = getElement('start-draft-dialog', HTMLDialogElement);
	private readonly form = getElement('start-draft-form', HTMLFormElement);
	private readonly unsaved = getElement('start-draft-unsaved', HTMLElement);
	private readonly cancelButton = getElement('start-draft-cancel', HTMLButtonElement);
	private readonly submitButton = getElement('start-draft-submit', HTMLButtonElement);

	/**
	 * @param start Stages starting the draft and saves the editor, with any unsaved changes
	 */
	constructor(private readonly start: () => void)
	{
		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			this.dialog.close();
			this.start();
		});

		this.cancelButton.addEventListener('click', () =>
		{
			this.dialog.close();
		});
	}

	/**
	 * Opens the dialog
	 *
	 * @param hasUnsavedChanges Whether the editor has changes that haven't been saved, which starting the
	 * draft saves first
	 */
	open(hasUnsavedChanges: boolean): void
	{
		this.unsaved.hidden = !hasUnsavedChanges;
		setButtonLabel(this.submitButton, copyIcon, startDraftLabel(hasUnsavedChanges));
		this.dialog.showModal();

		// Cancel takes focus, so pressing Enter by habit doesn't start a draft without reading what it means
		this.cancelButton.focus();
	}
}
