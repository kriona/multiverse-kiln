import { MAX_PLAYER_NAME_LENGTH, MAX_TRANSLATOR_LANGUAGES, MIN_PLAYER_SEARCH_LENGTH, PROFILE_LANGUAGES, UNIVERSE_ROLE_NAMES, UNIVERSE_ROLES, type EditorRoleSettings, type PlayerMatch, type UniverseEditorSummary, type UniverseRole } from '@multiverse-kiln/shared';
import undoIcon from 'virtual:icon/ph:arrow-u-up-left';
import removeIcon from 'virtual:icon/ph:user-minus';

import { t } from '../../localization';
import type { EditorApi } from '../../network/editorApi';
import { ChangeTracker } from '../changeTracker';
import { ChipCombobox } from '../ChipCombobox';
import { getElement, namedOptions, setButtonLabel, setOptions, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import { languageChoices } from '../languagePicker';
import { PlayerSearch } from '../PlayerSearch';

/**
 * What the editor dialog does with the editor it shows, keeping its changes on the Editors tab until
 * the tab is saved
 */
export interface EditorDialogEdit
{
	/**
	 * Whether the editor will be removed when the tab is saved
	 */
	readonly removed: boolean;

	/**
	 * Whether a player has a role in the universe, or is staged to be given one, so the search leaves
	 * them out
	 *
	 * @param playerId The player's ID
	 * @return True when they have
	 */
	isEditor(playerId: string): boolean;

	/**
	 * Keeps the dialog's choices: adds the player, or changes the editor's role
	 *
	 * @param player The player, for a new editor
	 * @param settings Their role and languages
	 */
	apply(player: PlayerMatch, settings: EditorRoleSettings): void;

	/**
	 * Removes the editor when the tab is saved, or takes that back
	 */
	toggleRemoved(): void;
}

/**
 * The editor dialog on the Editors tab: adds a player, found by name or username, with a role, or changes an editor's
 * role, and a translator's languages. Applying keeps the changes on the tab until it is saved. It can
 * also mark an editor to remove when the tab is saved
 */
export class EditorDialog
{
	private readonly dialog = getElement('editor-dialog', HTMLDialogElement);
	private readonly form = getElement('editor-form', HTMLFormElement);
	private readonly title = getElement('editor-dialog-title', HTMLElement);
	private readonly usernameField = getElement('editor-player-field', HTMLElement);
	private readonly username = getElement('editor-player', HTMLInputElement);
	private readonly role = getElement('editor-role-select', HTMLSelectElement);
	private readonly languagesField = getElement('editor-languages-field', HTMLElement);
	private readonly languagesSearch = getElement('editor-languages-search', HTMLInputElement);
	private readonly error = getElement('editor-dialog-error', HTMLElement);
	private readonly removeButton = getElement('editor-remove', HTMLButtonElement);
	private readonly cancelButton = getElement('editor-cancel', HTMLButtonElement);
	private readonly languages: ChipCombobox;
	private readonly playerSearch: PlayerSearch;

	/**
	 * Whether the dialog has changes that haven't been applied
	 */
	private readonly changes: ChangeTracker;

	/**
	 * The editor shown, or undefined while adding one
	 */
	private editor: UniverseEditorSummary | undefined;

	/**
	 * The universe whose editors these are
	 */
	private universeId = '';

	/**
	 * Where the dialog's changes go
	 */
	private edit: EditorDialogEdit | undefined;

	/**
	 * Called after the changes are applied, or the editor is marked to remove
	 */
	private onChanged: () => void = () => undefined;

	/**
	 * @param api The editor's API, which finds the players to add
	 */
	constructor(private readonly api: EditorApi)
	{
		// The longest name, or an @ and a username
		this.username.maxLength = MAX_PLAYER_NAME_LENGTH + 1;
		setOptions(this.role, namedOptions(UNIVERSE_ROLES, UNIVERSE_ROLE_NAMES));
		this.languages = new ChipCombobox({
			searchId: 'editor-languages-search',
			listboxId: 'editor-languages-options',
			chosenId: 'editor-languages-chosen',
			choices: languageChoices(PROFILE_LANGUAGES),
			max: MAX_TRANSLATOR_LANGUAGES,
			tooMany: t({
				id: 'editor.editors.languagesTooMany',
				defaultMessage: 'A translator can have up to {max, plural, one {# language} other {# languages}}.',
				description: 'Shown under the field for choosing the languages a translator may translate a universe into, in the editor dialog on the editor\'s Editors tab, when more than {max}, a number, are chosen'
			}, {
				max: MAX_TRANSLATOR_LANGUAGES
			}),
			onChange: () =>
			{
				this.changes.check();
			}
		});
		this.playerSearch = new PlayerSearch({
			searchId: 'editor-player',
			listboxId: 'editor-player-options',
			search: (query) => this.api.searchPlayers(this.universeId, { query }),
			exclude: (playerId) => (this.edit?.isEditor(playerId) ?? false),
			minLength: MIN_PLAYER_SEARCH_LENGTH
		});
		this.changes = new ChangeTracker({
			root: this.form,
			state: () => this.languages.values
		});
		this.changes.guardDialog(this.dialog);

		this.role.addEventListener('change', () =>
		{
			this.showLanguages();
		});

		this.cancelButton.addEventListener('click', () =>
		{
			if (this.changes.confirmDiscard())
			{
				this.dialog.close();
			}
		});

		this.removeButton.addEventListener('click', () =>
		{
			this.edit?.toggleRemoved();
			this.close();
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			this.apply();
		});
	}

	/**
	 * Opens the dialog for an editor, or for adding one
	 *
	 * @param universeId The universe's ID
	 * @param editor The editor as the tab shows them, or undefined to add one
	 * @param edit Where the dialog's changes go
	 * @param onChanged Called after the changes are applied, or the editor is marked to remove
	 */
	open(universeId: string, editor: UniverseEditorSummary | undefined, edit: EditorDialogEdit, onChanged: () => void): void
	{
		const editable = !edit.removed;

		this.universeId = universeId;
		this.editor = editor;
		this.edit = edit;
		this.onChanged = onChanged;

		if (!editor)
		{
			this.title.textContent = t({
				id: 'editor.editors.addTitle',
				defaultMessage: 'Add Editor',
				description: 'Title of the dialog on the editor\'s Editors tab for giving a player a role in the universe'
			});
		}
		else
		{
			this.title.textContent = t({
				id: 'editor.editors.editTitle',
				defaultMessage: 'Edit {username}',
				description: 'Title of the dialog on the editor\'s Editors tab for changing an editor\'s role; {username} is their username'
			}, {
				username: editor.username
			});
		}

		this.usernameField.hidden = (editor !== undefined);
		this.playerSearch.reset();
		this.role.value = (editor?.role ?? 'builder');
		this.languages.values = (editor?.languages ?? []);
		this.role.disabled = !editable;
		this.languagesSearch.disabled = !editable;
		this.showLanguages();

		getElement('editor-apply', HTMLButtonElement).hidden = !editable;
		this.cancelButton.textContent = t(editable ? formMessages.cancel : formMessages.close);
		this.removeButton.hidden = (editor === undefined);
		this.removeButton.classList.toggle('danger', !edit.removed);

		if (edit.removed)
		{
			setButtonLabel(this.removeButton, undoIcon, t({
				id: 'editor.editors.undoRemove',
				defaultMessage: 'Undo Remove',
				description: 'Button in the dialog on the editor\'s Editors tab for an editor who will lose their role when the tab is saved: keeps them instead'
			}));
		}
		else
		{
			setButtonLabel(this.removeButton, removeIcon, t({
				id: 'editor.editors.remove',
				defaultMessage: 'Remove Editor',
				description: 'Button in the dialog on the editor\'s Editors tab that takes the editor\'s role in the universe away when the tab is saved'
			}));
		}

		showMessage(this.error, undefined);
		clearFieldErrors(this.dialog);
		this.dialog.showModal();
		this.changes.markSaved();
		(editor ? this.role : this.username).focus();
	}

	/**
	 * Shows the languages field for a translator
	 */
	private showLanguages(): void
	{
		this.languagesField.hidden = (this.role.value !== 'translator');
	}

	/**
	 * Keeps the dialog's choices, until the tab is saved
	 */
	private apply(): void
	{
		const edit = this.edit;
		const role = this.role.value as UniverseRole;
		const languages = ((role === 'translator') ? this.languages.values : []);

		if (!edit)
		{
			return;
		}

		if ((role === 'translator') && (languages.length === 0))
		{
			reportFieldError(this.languagesSearch, t({
				id: 'editor.editors.languagesNeeded',
				defaultMessage: 'Choose the languages they may translate into.',
				description: 'Shown under the languages field in the dialog on the editor\'s Editors tab when the role chosen is translator but no language is'
			}));
			return;
		}

		const player = (this.editor ?? this.playerSearch.player);

		if (!player)
		{
			reportFieldError(this.username, t({
				id: 'editor.editors.choosePlayer',
				defaultMessage: 'Search for the player by name or username, and choose them from the list.',
				description: 'Shown under the field for finding a player in the dialog for adding an editor on the editor\'s Editors tab, when Apply is pressed before a player is chosen from the list'
			}));
			return;
		}

		edit.apply(player, {
			role,
			languages
		});
		this.close();
	}

	/**
	 * Closes the dialog once its change is made, and shows the change in the list
	 */
	private close(): void
	{
		this.changes.markSaved();
		this.dialog.close();
		this.onChanged();
	}
}
