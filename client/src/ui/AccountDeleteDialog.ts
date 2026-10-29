import { MAX_PASSWORD_LENGTH, UNIVERSE_ROLE_NAMES, type AccountDeletionPayload, type UniverseDecision } from '@multiverse-kiln/shared';

import { currentLocale, t } from '../localization';
import { authFieldOf, type AuthApi } from '../network/authApi';
import { describeEditorError, EditorApiError } from '../network/editorApi';
import type { ProfileApi } from '../network/profileApi';
import { resetCodeInput } from './codeInputs';
import { getElement, showMessage } from './dom';
import { clearFieldErrors, reportFieldError, setFieldError } from './fieldErrors';
import { pageMessages } from './pageMessages';

/**
 * The value of a universe's choice that deletes it; the other choices are editors' player IDs
 */
const DELETE_UNIVERSE = 'delete';

/**
 * The dialog that deletes the player's account (profile.html; see Deleting an account in
 * STRUCTURE-OVERVIEW.md). It asks what becomes of each universe the player is the only creator of, then
 * for the password (and authenticator code with 2FA), or the username for an account without a password
 */
export class AccountDeleteDialog
{
	private readonly dialog = getElement('account-delete-dialog', HTMLDialogElement);
	private readonly form = getElement('account-delete-form', HTMLFormElement);
	private readonly status = getElement('account-delete-status', HTMLElement);
	private readonly universes = getElement('account-delete-universes', HTMLFieldSetElement);
	private readonly universeList = getElement('account-delete-universe-list', HTMLElement);
	private readonly email = getElement('account-delete-email', HTMLInputElement);
	private readonly passwordField = getElement('account-delete-password-field', HTMLElement);
	private readonly password = getElement('account-delete-password', HTMLInputElement);
	private readonly codeField = getElement('account-delete-code-field', HTMLElement);
	private readonly code = getElement('account-delete-code', HTMLInputElement);
	private readonly usernameField = getElement('account-delete-username-field', HTMLElement);
	private readonly username = getElement('account-delete-username', HTMLInputElement);
	private readonly error = getElement('account-delete-error', HTMLElement);
	private readonly submitButton = getElement('account-delete-submit', HTMLButtonElement);

	/**
	 * What deleting the account asks, once loaded
	 */
	private deletion: AccountDeletionPayload | undefined;

	/**
	 * Each universe's choice, by universe ID
	 */
	private readonly choices = new Map<string, HTMLSelectElement>();

	/**
	 * @param profileApi The profile routes, which say what deleting the account asks
	 * @param authApi The auth routes, which delete it
	 * @param deleted Called once the account is deleted
	 */
	constructor(private readonly profileApi: ProfileApi, private readonly authApi: AuthApi, private readonly deleted: () => void)
	{
		this.password.maxLength = MAX_PASSWORD_LENGTH;

		for (const field of [this.password, this.code, this.username])
		{
			field.addEventListener('input', () =>
			{
				setFieldError(field, undefined);
			});
		}

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.submit();
		});

		getElement('account-delete-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			this.dialog.close();
		});

		this.dialog.addEventListener('close', () =>
		{
			this.password.value = '';
		});
	}

	/**
	 * Opens the dialog, and loads what deleting the account asks
	 *
	 * @param email The account's address, which tells password managers which account the password is for
	 */
	open(email: string | null): void
	{
		this.email.value = (email ?? '');
		this.password.value = '';
		this.username.value = '';
		resetCodeInput(this.code);
		clearFieldErrors(this.form);
		showMessage(this.error, undefined);
		this.dialog.showModal();
		void this.load();
	}

	/**
	 * Loads the universes the player is the only creator of, and shows the fields that confirm the deletion
	 */
	private async load(): Promise<void>
	{
		this.deletion = undefined;
		this.submitButton.disabled = true;
		this.universes.hidden = true;

		for (const element of [this.passwordField, this.codeField, this.usernameField])
		{
			element.hidden = true;
		}

		this.status.textContent = t(pageMessages.loading);

		try
		{
			this.deletion = await this.profileApi.getAccountDeletion();
		}
		catch (error)
		{
			this.status.textContent = '';
			showMessage(this.error, describeEditorError(error, {
				id: 'profile.deleteLoadFailed',
				defaultMessage: 'Could not check what deleting your account needs. Close this and try again.',
				description: 'Shown in the dialog that deletes the player\'s account when the universes they alone create couldn\'t be loaded'
			}));
			return;
		}

		const deletion = this.deletion;

		this.status.textContent = '';
		this.showUniverses(deletion);
		this.passwordField.hidden = !deletion.hasPassword;
		this.codeField.hidden = !deletion.twoFactor;
		this.usernameField.hidden = deletion.hasPassword;
		this.submitButton.disabled = false;
		(this.choices.values().next().value ?? (deletion.hasPassword ? this.password : this.username)).focus();
	}

	/**
	 * Lists the universes the player is the only creator of, each with a choice of who creates it next
	 * or deleting it. Nothing is chosen at first, so deleting a universe is never a default
	 *
	 * @param deletion What deleting the account asks
	 */
	private showUniverses(deletion: AccountDeletionPayload): void
	{
		this.choices.clear();
		this.universes.hidden = (deletion.universes.length === 0);
		this.universeList.replaceChildren(...deletion.universes.map((universe) =>
		{
			const label = document.createElement('label');
			const name = document.createElement('span');
			const select = document.createElement('select');
			const placeholder = new Option(t({
				id: 'profile.deleteUniverseChoose',
				defaultMessage: 'Choose...',
				description: 'The first choice for a universe in the dialog that deletes the player\'s account, before they choose what becomes of it'
			}), '');

			placeholder.disabled = true;
			placeholder.selected = true;
			name.textContent = universe.name;
			name.translate = false;
			select.id = `account-delete-universe-${universe.id}`;
			select.append(placeholder, ...universe.editors.map((editor) => new Option(t({
				id: 'profile.deleteUniverseHandTo',
				defaultMessage: 'Make {name} (@{username}, {role}) its creator',
				description: 'A choice for a universe in the dialog that deletes the player\'s account: another of its editors becomes its creator; {name} and {username} are theirs, and {role} their role in it now, such as Builder'
			}, {
				name: editor.displayName,
				username: editor.username,
				role: t(UNIVERSE_ROLE_NAMES[editor.role])
			}), editor.playerId)), new Option(t({
				id: 'profile.deleteUniverseDelete',
				defaultMessage: 'Delete it',
				description: 'A choice for a universe in the dialog that deletes the player\'s account: the universe is deleted, with its world and every character in it'
			}), DELETE_UNIVERSE));
			select.addEventListener('change', () =>
			{
				setFieldError(select, undefined);
			});
			label.append(name, select);
			this.choices.set(universe.id, select);

			return(label);
		}));
	}

	/**
	 * What becomes of each universe, as chosen
	 *
	 * @return The decisions, or undefined when a universe has none, which is then reported
	 */
	private readDecisions(): UniverseDecision[] | undefined
	{
		const decisions: UniverseDecision[] = [];

		for (const universe of (this.deletion?.universes ?? []))
		{
			const select = this.choices.get(universe.id);

			if (!select || (select.value === ''))
			{
				if (select)
				{
					reportFieldError(select, t({
						id: 'profile.deleteUniverseUnchosen',
						defaultMessage: 'Choose what becomes of {universe}.',
						description: 'Shown under a universe\'s choice in the dialog that deletes the player\'s account when nothing was chosen for it; {universe} is its name'
					}, {
						universe: universe.name
					}));
					select.focus();
				}

				return(undefined);
			}

			decisions.push({
				universeId: universe.id,
				newCreatorId: ((select.value === DELETE_UNIVERSE) ? null : select.value)
			});
		}

		return(decisions);
	}

	/**
	 * Deletes the account with what was chosen and typed
	 */
	private async submit(): Promise<void>
	{
		const deletion = this.deletion;

		if (!deletion || this.submitButton.disabled)
		{
			return;
		}

		showMessage(this.error, undefined);

		const universes = this.readDecisions();

		if (!universes)
		{
			return;
		}

		this.submitButton.disabled = true;

		try
		{
			await this.authApi.deleteAccount({
				password: (deletion.hasPassword ? this.password.value : null),
				twoFactorCode: (deletion.twoFactor ? this.code.value : null),
				username: (deletion.hasPassword ? null : this.username.value),
				universes,
				locale: currentLocale()
			});
			this.dialog.close();
			this.deleted();
			return;
		}
		catch (error)
		{
			const field = authFieldOf(error);
			const input = ((field === 'password') ? this.password : ((field === 'twoFactorCode') ? this.code : ((field === 'username') ? this.username : undefined)));

			if (input && (error instanceof EditorApiError))
			{
				reportFieldError(input, error.message);
			}
			else
			{
				showMessage(this.error, describeEditorError(error, {
					id: 'profile.deleteFailed',
					defaultMessage: 'Could not delete your account.',
					description: 'Shown in the dialog that deletes the player\'s account when it couldn\'t be deleted'
				}));
			}

			// The universes changed since they were listed: list them again
			if ((error instanceof EditorApiError) && (error.status === 409))
			{
				const message = error.message;

				await this.load();
				showMessage(this.error, message);
				return;
			}
		}

		this.submitButton.disabled = false;
	}
}
