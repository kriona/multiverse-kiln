import { canExportUniverse, universeExportFileName, type EditableUniverse } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { announce } from '../announcer';
import { getElement, showMessage } from '../dom';

/**
 * Export Universe, left of Delete Universe under the settings card on the editor's Universe tab, and the
 * dialog it opens (see Exporting a universe in STRUCTURE-OVERVIEW.md): for every role that may change
 * something in the universe. The dialog says what the export holds, and its Export Universe downloads a
 * zip archive of what the player's role may change in the version open, as it is saved
 */
export class UniverseExportSection
{
	private readonly section = getElement('universe-actions', HTMLElement);
	private readonly openButton = getElement('universe-export', HTMLButtonElement);
	private readonly dialog = getElement('universe-export-dialog', HTMLDialogElement);
	private readonly form = getElement('universe-export-form', HTMLFormElement);
	private readonly title = getElement('universe-export-title', HTMLElement);
	private readonly status = getElement('universe-export-status', HTMLElement);
	private readonly error = getElement('universe-export-error', HTMLElement);
	private readonly submitButton = getElement('universe-export-submit', HTMLButtonElement);

	/**
	 * The universe open in the editor
	 */
	private universe: EditableUniverse | undefined;

	/**
	 * Whether the window can no longer use the universe's editor, such as once it was deleted
	 */
	private locked = false;

	/**
	 * Whether an export is being made, which the server allows one of at a time
	 */
	private exporting = false;

	/**
	 * Counts the exports started and the times the dialog closed, so an export whose dialog was closed
	 * before it arrived isn't downloaded
	 */
	private run = 0;

	/**
	 * @param api The editor's routes, which export the universe
	 */
	constructor(private readonly api: EditorApi)
	{
		this.openButton.addEventListener('click', () =>
		{
			this.openDialog();
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.export();
		});

		getElement('universe-export-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			this.dialog.close();
		});

		this.dialog.addEventListener('close', () =>
		{
			this.run++;
			this.status.textContent = '';
		});
	}

	/**
	 * Shows Export Universe for a role that may export the universe
	 *
	 * @param universe The universe open in the editor
	 */
	open(universe: EditableUniverse): void
	{
		this.universe = universe;
		this.section.hidden = !canExportUniverse(universe.role);
	}

	/**
	 * Turns off Export Universe once the window can't use the universe's editor any more, such as when it
	 * was deleted in another window or the player lost their role
	 */
	lock(): void
	{
		this.locked = true;
		this.updateButtons();
	}

	/**
	 * Turns Export Universe off for good once the window is locked, and the dialog's while an export is
	 * being made
	 */
	private updateButtons(): void
	{
		this.openButton.disabled = this.locked;
		this.submitButton.disabled = (this.locked || this.exporting);
	}

	/**
	 * Opens the dialog, titled with the universe's name
	 */
	private openDialog(): void
	{
		const universe = this.universe;

		if (!universe)
		{
			return;
		}

		this.title.textContent = t({
			id: 'editor.universeExport.title',
			defaultMessage: 'Export {universe}',
			description: 'Title of the dialog Export Universe opens on the editor\'s Universe tab; {universe} is the universe\'s name'
		}, {
			universe: universe.name
		});
		this.status.textContent = '';
		showMessage(this.error, undefined);
		this.updateButtons();
		this.dialog.showModal();
		this.submitButton.focus();
	}

	/**
	 * Makes the export and downloads it, then closes the dialog, or says why the server refused it
	 */
	private async export(): Promise<void>
	{
		const universe = this.universe;

		if (!universe || this.exporting || this.locked)
		{
			return;
		}

		const run = ++this.run;

		this.exporting = true;
		this.updateButtons();
		showMessage(this.error, undefined);
		this.status.textContent = t({
			id: 'editor.universeExport.exporting',
			defaultMessage: 'Exporting...',
			description: 'Shown at the left of the buttons in the dialog Export Universe opens on the editor\'s Universe tab, and read out, while the universe\'s zip file is being made and downloaded'
		});

		try
		{
			const archive = await this.api.exportUniverse(universe.id);

			if (run !== this.run)
			{
				return;
			}

			const url = URL.createObjectURL(archive);
			const link = document.createElement('a');

			link.href = url;
			link.download = universeExportFileName(universe.name, universe.version, new Date());
			link.click();
			URL.revokeObjectURL(url);
			this.dialog.close();
			announce(t({
				id: 'editor.universeExport.exported',
				defaultMessage: 'Exported. The zip file is in your downloads.',
				description: 'Read out once the dialog Export Universe opens on the editor\'s Universe tab has downloaded the universe\'s zip file and closed'
			}));
		}
		catch (error)
		{
			if (run === this.run)
			{
				this.status.textContent = '';
				showMessage(this.error, describeEditorError(error, {
					id: 'editor.universeExport.failed',
					defaultMessage: 'Could not export the universe.',
					description: 'Shown in the dialog Export Universe opens on the editor\'s Universe tab when the universe\'s zip file couldn\'t be made or downloaded'
				}));
			}
		}
		finally
		{
			this.exporting = false;
			this.updateButtons();
		}
	}
}
