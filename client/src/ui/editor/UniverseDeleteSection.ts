import { canDeleteUniverse, defineMessages, MAX_PASSWORD_LENGTH, MAX_USERNAME_LENGTH, UNIVERSE_DELETION_PREVENTED, type EditableUniverse, type UniverseDeleteRequest, type UniverseDeletionPayload } from '@multiverse-kiln/shared';

import { currentLocale, t } from '../../localization';
import type { AdminApi } from '../../network/adminApi';
import { authFieldOf, type AuthApi } from '../../network/authApi';
import { describeEditorError, EditorApiError, type EditorApi } from '../../network/editorApi';
import { HOME_PAGE_URL, keepHomeNotice } from '../../pages';
import { abandonUnsavedWork } from '../changeTracker';
import { resetCodeInput } from '../codeInputs';
import { getElement, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { pageMessages } from '../pageMessages';
import { TwoFactorEmailCode, type EmailCodeUse } from '../TwoFactorEmailCode';

/**
 * The code an account without a password is emailed to delete a universe
 */
const DELETE_UNIVERSE_CODE: EmailCodeUse = {
	purpose: 'deleteUniverse',
	...defineMessages({
		intro: {
			id: 'editor.universeDelete.codeIntro',
			defaultMessage: 'To check it\'s you, we\'ll email a code to {email}.',
			description: 'In the second dialog that deletes a universe, for an account without a password, above the button that emails a code to the account\'s address; {email} is that address'
		},
		sent: {
			id: 'editor.universeDelete.codeSent',
			defaultMessage: 'We\'ve emailed a code to {email}. Enter it to delete the universe. It works once, for {minutes, plural, one {# minute} other {# minutes}}.',
			description: 'In the second dialog that deletes a universe, for an account without a password, once a code was sent to the account\'s address; {email} is that address'
		}
	})
};

/**
 * Delete Universe, under the settings card on the editor's Universe tab beside Export Universe, and the
 * two dialogs that delete the universe (see Deleting a universe in STRUCTURE-OVERVIEW.md): for its
 * creators, and for server admins with the site admin role. The first dialog says what deleting it
 * deletes. The second asks for the
 * password (and authenticator code with 2FA), or for an account without a password, a code emailed to its
 * address (when it has one) and the username, then deletes the universe and goes to Home. Deleting is
 * the exception to staging changes until Save: the universe is deleted as a whole, at once
 */
export class UniverseDeleteSection
{
	private readonly prevented = getElement('universe-delete-prevented', HTMLElement);
	private readonly openButton = getElement('universe-delete-open', HTMLButtonElement);
	private readonly dialog = getElement('universe-delete-dialog', HTMLDialogElement);
	private readonly form = getElement('universe-delete-form', HTMLFormElement);
	private readonly title = getElement('universe-delete-title', HTMLElement);
	private readonly intro = getElement('universe-delete-intro', HTMLElement);
	private readonly list = getElement('universe-delete-list', HTMLElement);
	private readonly adminNote = getElement('universe-delete-admin', HTMLElement);
	private readonly unsaved = getElement('universe-delete-unsaved', HTMLElement);
	private readonly status = getElement('universe-delete-status', HTMLElement);
	private readonly error = getElement('universe-delete-error', HTMLElement);
	private readonly submitButton = getElement('universe-delete-submit', HTMLButtonElement);
	private readonly cancelButton = getElement('universe-delete-cancel', HTMLButtonElement);
	private readonly confirmDialog = getElement('universe-delete-confirm-dialog', HTMLDialogElement);
	private readonly confirmForm = getElement('universe-delete-confirm-form', HTMLFormElement);
	private readonly confirmTitle = getElement('universe-delete-confirm-title', HTMLElement);
	private readonly question = getElement('universe-delete-confirm-question', HTMLElement);
	private readonly email = getElement('universe-delete-email', HTMLInputElement);
	private readonly passwordField = getElement('universe-delete-password-field', HTMLElement);
	private readonly password = getElement('universe-delete-password', HTMLInputElement);
	private readonly emailCodeInput = getElement('universe-delete-email-code', HTMLInputElement);
	private readonly usernameField = getElement('universe-delete-username-field', HTMLElement);
	private readonly username = getElement('universe-delete-username', HTMLInputElement);
	private readonly codeField = getElement('universe-delete-code-field', HTMLElement);
	private readonly code = getElement('universe-delete-code', HTMLInputElement);
	private readonly confirmError = getElement('universe-delete-confirm-error', HTMLElement);
	private readonly sendButton = getElement('universe-delete-send', HTMLButtonElement);
	private readonly confirmButton = getElement('universe-delete-confirm-submit', HTMLButtonElement);
	private readonly emailCode: TwoFactorEmailCode;

	/**
	 * The universe open in the editor
	 */
	private universe: EditableUniverse | undefined;

	/**
	 * What deleting the universe deletes, and how the player confirms it, once the first dialog loads it
	 */
	private deletion: UniverseDeletionPayload | undefined;

	/**
	 * @param api The editor's routes, which delete the universe as one of its creators
	 * @param authApi The auth routes, which email the code
	 * @param adminApi The admin routes, which delete the universe as a server admin
	 * @param hasUnsavedChanges Whether the editor has changes that haven't been saved, which deleting throws away
	 */
	constructor(private readonly api: EditorApi, authApi: AuthApi, private readonly adminApi: AdminApi, private readonly hasUnsavedChanges: () => boolean)
	{
		this.emailCode = new TwoFactorEmailCode(authApi, {
			note: getElement('universe-delete-email-note', HTMLElement),
			label: getElement('universe-delete-email-code-label', HTMLElement),
			input: this.emailCodeInput,
			sendButton: this.sendButton
		}, DELETE_UNIVERSE_CODE);
		this.password.maxLength = MAX_PASSWORD_LENGTH;
		this.username.maxLength = MAX_USERNAME_LENGTH;

		for (const field of [this.password, this.username, this.code])
		{
			field.addEventListener('input', () =>
			{
				setFieldError(field, undefined);
			});
		}

		this.openButton.addEventListener('click', () =>
		{
			this.openDialog();
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			this.continueToConfirm();
		});

		this.confirmForm.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.submit();
		});

		this.cancelButton.addEventListener('click', () =>
		{
			this.dialog.close();
		});

		getElement('universe-delete-confirm-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			this.confirmDialog.close();
		});

		this.confirmDialog.addEventListener('close', () =>
		{
			this.password.value = '';
		});
	}

	/**
	 * Shows Delete Universe for a role that may delete the universe, turned off with why when the site's
	 * admins kept its creators from deleting it and the player isn't a server admin
	 *
	 * @param universe The universe open in the editor
	 */
	open(universe: EditableUniverse): void
	{
		const allowed = canDeleteUniverse(universe.role);
		const prevented = (universe.deletionPrevented && !universe.serverAdmin);

		this.universe = universe;
		this.openButton.hidden = !allowed;
		this.openButton.disabled = prevented;
		showMessage(this.prevented, ((allowed && prevented) ? t(UNIVERSE_DELETION_PREVENTED) : undefined));
	}

	/**
	 * Turns off Delete Universe once the window can't change the universe any more, such as when it was
	 * deleted in another window or the player lost their role
	 */
	lock(): void
	{
		this.openButton.disabled = true;
	}

	/**
	 * Opens the first dialog, and loads what deleting the universe deletes
	 */
	private openDialog(): void
	{
		const universe = this.universe;

		if (!universe)
		{
			return;
		}

		const title = t({
			id: 'editor.universeDelete.title',
			defaultMessage: 'Delete {universe}',
			description: 'Title of both dialogs that delete a universe: the first, which says what it deletes, and the second, which checks it\'s the player; {universe} is its name'
		}, {
			universe: universe.name
		});

		this.title.textContent = title;
		this.confirmTitle.textContent = title;
		this.unsaved.hidden = !this.hasUnsavedChanges();
		this.password.value = '';
		this.username.value = '';
		resetCodeInput(this.code);
		clearFieldErrors(this.confirmForm);
		showMessage(this.error, undefined);
		showMessage(this.confirmError, undefined);
		this.dialog.showModal();
		void this.load(universe);
	}

	/**
	 * Loads what deleting the universe deletes into the first dialog, and readies the fields the second
	 * dialog confirms it with
	 *
	 * @param universe The universe
	 */
	private async load(universe: EditableUniverse): Promise<void>
	{
		this.deletion = undefined;
		this.submitButton.disabled = true;
		this.intro.textContent = '';
		this.list.hidden = true;
		this.adminNote.hidden = true;
		this.status.textContent = t(pageMessages.loading);

		let deletion: UniverseDeletionPayload;

		try
		{
			deletion = await this.api.getUniverseDeletion(universe.id);
		}
		catch (error)
		{
			this.status.textContent = '';
			showMessage(this.error, describeEditorError(error, {
				id: 'editor.universeDelete.loadFailed',
				defaultMessage: 'Could not check what deleting the universe deletes. Close this and try again.',
				description: 'Shown in the first dialog that deletes a universe when what it deletes couldn\'t be loaded'
			}));
			this.cancelButton.focus();
			return;
		}

		this.status.textContent = '';

		if (deletion.deletionPrevented && !deletion.asAdmin)
		{
			showMessage(this.error, t(UNIVERSE_DELETION_PREVENTED));
			this.cancelButton.focus();
			return;
		}

		this.deletion = deletion;
		this.intro.textContent = t({
			id: 'editor.universeDelete.intro',
			defaultMessage: '{universe} is deleted for everyone, and can\'t be brought back. Deleting it deletes:',
			description: 'In the first dialog that deletes a universe, above the list of what it deletes; {universe} is its name'
		}, {
			universe: universe.name
		});
		this.showList(deletion);
		this.adminNote.hidden = !deletion.asAdmin;
		this.readyConfirmFields(deletion);
		this.submitButton.disabled = false;

		// Cancel takes focus, so pressing Enter by habit doesn't go on without reading what is deleted
		this.cancelButton.focus();
	}

	/**
	 * Lists what deleting the universe deletes, leaving out what it has none of
	 *
	 * @param deletion What it deletes
	 */
	private showList(deletion: UniverseDeletionPayload): void
	{
		const items = [
			t({
				id: 'editor.universeDelete.world',
				defaultMessage: 'Its world and everything else in the editor',
				description: 'In the list of what deleting a universe deletes, in the first dialog that deletes it: the first item, followed by what the world holds'
			}),
			t({
				id: 'editor.universeDelete.worldContents',
				defaultMessage: 'Its areas and their maps, tilesets and uploads, items, races, classes, translations',
				description: 'In the list of what deleting a universe deletes, in the first dialog that deletes it: what its world holds, after the item for its world'
			})
		];

		if (this.universe?.hasDraft)
		{
			items.push(t({
				id: 'editor.universeDelete.draft',
				defaultMessage: 'Its draft',
				description: 'In the list of what deleting a universe deletes, in the first dialog that deletes it, when the universe has a draft (a copy editors change without players seeing it)'
			}));
		}

		items.push(t({
			id: 'editor.universeDelete.saves',
			defaultMessage: 'Its record of saves',
			description: 'In the list of what deleting a universe deletes, in the first dialog that deletes it: the record of every save made in its editor, which its Audit tab lists'
		}));

		if (deletion.characters > 0)
		{
			items.push(t({
				id: 'editor.universeDelete.characters',
				defaultMessage: '{characters, plural, one {# character} other {# characters}} that {players, plural, one {# player} other {# players}} made in it',
				description: 'In the list of what deleting a universe deletes, in the first dialog that deletes it: the characters players made in it; {characters} is how many, {players} how many players made them'
			}, {
				characters: deletion.characters,
				players: deletion.players
			}));
		}

		if (deletion.groups > 0)
		{
			items.push(t({
				id: 'editor.universeDelete.groups',
				defaultMessage: '{groups, plural, one {# group, which disbands} other {# groups, which disband}}',
				description: 'In the list of what deleting a universe deletes, in the first dialog that deletes it: the groups playing in it; {groups} is how many'
			}, {
				groups: deletion.groups
			}));
		}

		if (deletion.editors > 0)
		{
			items.push(t({
				id: 'editor.universeDelete.editors',
				defaultMessage: '{editors, plural, one {The role of # other editor, who is emailed that it was deleted} other {The roles of # other editors, who are emailed that it was deleted}}',
				description: 'In the list of what deleting a universe deletes, in the first dialog that deletes it: the roles (such as builder or beta tester) everyone else has in it; {editors} is how many others have one'
			}, {
				editors: deletion.editors
			}));
		}

		this.list.replaceChildren(...items.map((text) =>
		{
			const item = document.createElement('li');

			item.textContent = text;

			return(item);
		}));
		this.list.hidden = false;
	}

	/**
	 * Shows the fields the second dialog confirms the deletion with: the password, or the username and an
	 * emailed code, and the authenticator code with 2FA
	 *
	 * @param deletion How the player confirms it
	 */
	private readyConfirmFields(deletion: UniverseDeletionPayload): void
	{
		this.email.value = (deletion.email ?? '');
		this.passwordField.hidden = !deletion.hasPassword;
		this.usernameField.hidden = deletion.hasPassword;
		this.codeField.hidden = !deletion.twoFactor;

		// An account with neither a password nor an address has no code to be emailed, only the username to type
		this.emailCode.reset({
			email: deletion.email,
			hasPassword: (deletion.hasPassword || (deletion.email === null))
		});
		this.showButtons();
	}

	/**
	 * Shows Delete Universe in the second dialog, or Email me a code in its place until the code is sent,
	 * for an account without a password
	 */
	private showButtons(): void
	{
		this.confirmButton.hidden = this.emailCode.sending;
	}

	/**
	 * Closes the first dialog and opens the second, which checks it's the player
	 */
	private continueToConfirm(): void
	{
		if (!this.deletion || this.submitButton.disabled)
		{
			return;
		}

		this.dialog.close();
		showMessage(this.confirmError, undefined);
		this.confirmButton.disabled = false;
		this.question.textContent = t({
			id: 'editor.universeDelete.farewell',
			defaultMessage: 'Are you absolutely sure you want to delete {universe}? This is permanent (a very long time!) and cannot be undone.',
			description: 'In the second dialog that deletes a universe, above the password or other fields that check it\'s the player; {universe} is its name. Playful: the word permanent is joked about as a very long time, as in the last dialogs before deleting a character or an account'
		}, {
			universe: (this.universe?.name ?? '')
		});
		this.confirmDialog.showModal();
		this.firstConfirmField().focus();
	}

	/**
	 * The field the second dialog starts on
	 *
	 * @return The password field, Email me a code, the emailed code's field or the username field
	 */
	private firstConfirmField(): HTMLElement
	{
		if (this.deletion?.hasPassword)
		{
			return(this.password);
		}
		else if (this.emailCode.sending)
		{
			return(this.sendButton);
		}
		else if (this.emailCode.asked && !this.emailCodeInput.disabled)
		{
			return(this.emailCodeInput);
		}

		return(this.username);
	}

	/**
	 * Emails the code, or deletes the universe with what was typed in the second dialog
	 */
	private async submit(): Promise<void>
	{
		const deletion = this.deletion;
		const universe = this.universe;
		const sending = this.emailCode.sending;
		const button = (sending ? this.sendButton : this.confirmButton);

		if (!deletion || !universe || button.disabled)
		{
			return;
		}

		showMessage(this.confirmError, undefined);
		button.disabled = true;

		try
		{
			if (sending)
			{
				await this.emailCode.send();
				this.showButtons();
				return;
			}

			await this.emailCode.check();

			const request: UniverseDeleteRequest = {
				password: (deletion.hasPassword ? this.password.value : null),
				twoFactorCode: (deletion.twoFactor ? this.code.value : null),
				username: (deletion.hasPassword ? null : this.username.value),
				locale: currentLocale()
			};

			if (deletion.asAdmin)
			{
				await this.adminApi.deleteUniverse(universe.id, request);
			}
			else
			{
				await this.api.deleteUniverse(universe.id, request);
			}

			this.deleted(universe.name);
			return;
		}
		catch (error)
		{
			this.refused(error, sending);
		}
		finally
		{
			button.disabled = false;
		}
	}

	/**
	 * Shows why emailing the code or deleting the universe failed: under the field at fault, or in the
	 * first dialog again when what deleting it means changed, such as the site's admins keeping its
	 * creators from deleting it a moment ago
	 *
	 * @param error What the request threw
	 * @param sending Whether it was emailing the code
	 */
	private refused(error: unknown, sending: boolean): void
	{
		const universe = this.universe;

		if (universe && (error instanceof EditorApiError) && (error.status === 409))
		{
			const message = error.message;

			this.confirmDialog.close();
			this.dialog.showModal();
			void this.load(universe).then(() =>
			{
				showMessage(this.error, message);
			});
			return;
		}

		const field = authFieldOf(error);
		const input = ((field === 'password') ? this.password : ((field === 'code') ? this.emailCodeInput : ((field === 'twoFactorCode') ? this.code : ((field === 'username') ? this.username : undefined))));

		if (input && !input.disabled && (error instanceof EditorApiError))
		{
			reportFieldError(input, error.message);
		}
		else if (sending)
		{
			showMessage(this.confirmError, describeEditorError(error, {
				id: 'editor.universeDelete.codeFailed',
				defaultMessage: 'Could not email you a code.',
				description: 'Shown in the second dialog that deletes a universe, for an account without a password, when the code couldn\'t be emailed to the account\'s address'
			}));
		}
		else
		{
			showMessage(this.confirmError, describeEditorError(error, {
				id: 'editor.universeDelete.failed',
				defaultMessage: 'Could not delete the universe.',
				description: 'Shown in the second dialog that deletes a universe when it couldn\'t be deleted, followed by why'
			}));
		}
	}

	/**
	 * Goes to Home once the universe is deleted, which says so. Nothing the editor holds can be saved any
	 * more, so the browser doesn't ask before leaving
	 *
	 * @param universeName The universe's name
	 */
	private deleted(universeName: string): void
	{
		this.confirmDialog.close();
		abandonUnsavedWork();
		keepHomeNotice(t({
			id: 'editor.universeDelete.deleted',
			defaultMessage: '{universe} was deleted.',
			description: 'Shown on Home once the player deleted a universe in the world editor, which went there; {universe} is its name'
		}, {
			universe: universeName
		}));
		window.location.assign(HOME_PAGE_URL);
	}
}
