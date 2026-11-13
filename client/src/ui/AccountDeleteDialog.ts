import { EMAIL_CODE_LIFETIME_MINUTES, LAST_SERVER_ADMIN_DELETION, MAX_PASSWORD_LENGTH, MAX_USERNAME_LENGTH, UNHANDABLE_TWO_FACTOR_UNIVERSE_DELETION, UNHANDABLE_UNIVERSE_DELETION, UNIVERSE_ROLE_NAMES, type AccountDeletionPayload, type UniverseDecision } from '@multiverse-kiln/shared';

import { currentLocale, t } from '../localization';
import { authFieldOf, type AuthApi } from '../network/authApi';
import { describeEditorError, EditorApiError } from '../network/editorApi';
import type { ProfileApi } from '../network/profileApi';
import { announce } from './announcer';
import { BotCheck } from './botCheck';
import { resetCodeInput } from './codeInputs';
import { getElement, showMessage } from './dom';
import { clearFieldErrors, reportFieldError, setFieldError } from './fieldErrors';
import { pageMessages } from './pageMessages';

/**
 * The value of a universe's choice that deletes it; the other choices are editors' player IDs
 */
const DELETE_UNIVERSE = 'delete';

/**
 * The two dialogs that delete the player's account (profile.html; see Deleting an account in
 * STRUCTURE-OVERVIEW.md). The first says what deleting it does and asks what becomes of each universe
 * the player is the only creator of. The second asks for the password (and authenticator code with
 * 2FA), or for an account without a password, a code emailed to its address (when it has one) and the
 * username, then deletes the account
 */
export class AccountDeleteDialog
{
	private readonly dialog = getElement('account-delete-dialog', HTMLDialogElement);
	private readonly form = getElement('account-delete-form', HTMLFormElement);
	private readonly status = getElement('account-delete-status', HTMLElement);
	private readonly anchors = getElement('account-delete-anchors', HTMLElement);
	private readonly universes = getElement('account-delete-universes', HTMLFieldSetElement);
	private readonly universeList = getElement('account-delete-universe-list', HTMLElement);
	private readonly error = getElement('account-delete-error', HTMLElement);
	private readonly submitButton = getElement('account-delete-submit', HTMLButtonElement);
	private readonly cancelButton = getElement('account-delete-cancel', HTMLButtonElement);
	private readonly confirmDialog = getElement('account-delete-confirm-dialog', HTMLDialogElement);
	private readonly confirmForm = getElement('account-delete-confirm-form', HTMLFormElement);
	private readonly email = getElement('account-delete-email', HTMLInputElement);
	private readonly passwordField = getElement('account-delete-password-field', HTMLElement);
	private readonly password = getElement('account-delete-password', HTMLInputElement);
	private readonly codeField = getElement('account-delete-code-field', HTMLElement);
	private readonly code = getElement('account-delete-code', HTMLInputElement);
	private readonly emailCodeField = getElement('account-delete-email-code-field', HTMLElement);
	private readonly emailCodeIntro = getElement('account-delete-email-code-intro', HTMLElement);
	private readonly sendCodeButton = getElement('account-delete-send-code', HTMLButtonElement);
	private readonly emailCodeLabel = getElement('account-delete-email-code-label', HTMLElement);
	private readonly emailCode = getElement('account-delete-email-code', HTMLInputElement);
	private readonly usernameField = getElement('account-delete-username-field', HTMLElement);
	private readonly username = getElement('account-delete-username', HTMLInputElement);
	private readonly confirmError = getElement('account-delete-confirm-error', HTMLElement);
	private readonly botCheck = new BotCheck(this.confirmError);
	private readonly confirmButton = getElement('account-delete-confirm-submit', HTMLButtonElement);
	private readonly mistakeButton = getElement('account-delete-confirm-cancel', HTMLButtonElement);

	/**
	 * What deleting the account asks, once loaded
	 */
	private deletion: AccountDeletionPayload | undefined;

	/**
	 * What becomes of each universe, as chosen in the first dialog
	 */
	private decisions: UniverseDecision[] = [];

	/**
	 * The account's address, while the dialog is open
	 */
	private accountEmail: string | null = null;

	/**
	 * Whether the code was emailed, and whether it was found right, for an account without a password.
	 * A right code works once, so it isn't checked again when something else is wrong
	 */
	private codeSent = false;
	private codeChecked = false;

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
		this.username.maxLength = MAX_USERNAME_LENGTH;

		for (const field of [this.password, this.code, this.emailCode, this.username])
		{
			field.addEventListener('input', () =>
			{
				setFieldError(field, undefined);
			});
		}

		this.sendCodeButton.addEventListener('click', () =>
		{
			void this.sendCode();
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

		this.mistakeButton.addEventListener('click', () =>
		{
			this.confirmDialog.close();
		});

		this.confirmDialog.addEventListener('close', () =>
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
		this.accountEmail = email;
		this.codeSent = false;
		this.codeChecked = false;
		this.email.value = (email ?? '');
		this.password.value = '';
		this.username.value = '';
		resetCodeInput(this.code);
		resetCodeInput(this.emailCode);
		this.emailCode.disabled = false;
		this.emailCodeLabel.hidden = true;
		this.sendCodeButton.hidden = false;
		clearFieldErrors(this.form);
		clearFieldErrors(this.confirmForm);
		showMessage(this.error, undefined);
		showMessage(this.confirmError, undefined);
		this.dialog.showModal();
		void this.load();
	}

	/**
	 * Loads what deleting the account does and the universes the player is the only creator of, and
	 * readies the fields the second dialog confirms the deletion with
	 */
	private async load(): Promise<void>
	{
		this.deletion = undefined;
		this.submitButton.disabled = true;
		this.anchors.hidden = true;
		this.universes.hidden = true;

		for (const element of [this.passwordField, this.codeField, this.emailCodeField, this.usernameField])
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
		this.anchors.hidden = !deletion.anchorsGroups;

		const unhandable = deletion.universes.find((universe) => ((universe.deletionPrevented || universe.twoFactorRequired) && (universe.editors.length === 0)));

		if (deletion.lastServerAdmin)
		{
			showMessage(this.error, t(LAST_SERVER_ADMIN_DELETION));
			this.cancelButton.focus();
			return;
		}
		else if (unhandable)
		{
			showMessage(this.error, t((unhandable.deletionPrevented ? UNHANDABLE_UNIVERSE_DELETION : UNHANDABLE_TWO_FACTOR_UNIVERSE_DELETION), {
				universe: unhandable.name
			}));
			this.cancelButton.focus();
			return;
		}

		this.showUniverses(deletion);
		this.passwordField.hidden = !deletion.hasPassword;
		this.codeField.hidden = !deletion.twoFactor;
		this.emailCodeField.hidden = !this.needsEmailCode();
		this.usernameField.hidden = deletion.hasPassword;

		if (!this.codeSent)
		{
			this.emailCodeIntro.textContent = t({
				id: 'profile.deleteCodeIntro',
				defaultMessage: 'To check it\'s you, we\'ll email a code to {email}.',
				description: 'In the dialog that deletes an account without a password, above the button that emails a code to the account\'s address; {email} is that address'
			}, {
				email: (this.accountEmail ?? '')
			});
		}

		this.submitButton.disabled = false;
		(this.choices.values().next().value ?? this.cancelButton).focus();
	}

	/**
	 * Checks each universe has a choice, then closes the first dialog and opens the second, which
	 * checks it's the player
	 */
	private continueToConfirm(): void
	{
		if (!this.deletion || this.submitButton.disabled)
		{
			return;
		}

		showMessage(this.error, undefined);

		const decisions = this.readDecisions();

		if (!decisions)
		{
			return;
		}

		this.decisions = decisions;
		this.dialog.close();
		showMessage(this.confirmError, undefined);
		this.confirmButton.disabled = false;
		this.confirmDialog.showModal();
		this.firstConfirmField().focus();
	}

	/**
	 * The field the second dialog starts on
	 *
	 * @return The password field, the button that emails a code, the emailed code's field or the
	 * username field
	 */
	private firstConfirmField(): HTMLElement
	{
		if (this.deletion?.hasPassword)
		{
			return(this.password);
		}
		else if (this.needsEmailCode() && !this.codeSent)
		{
			return(this.sendCodeButton);
		}
		else if (this.needsEmailCode() && !this.codeChecked)
		{
			return(this.emailCode);
		}

		return(this.username);
	}

	/**
	 * Whether the account checks it's the player with a code emailed to its address: it has no password,
	 * but has an address
	 *
	 * @return Whether it does
	 */
	private needsEmailCode(): boolean
	{
		return((this.deletion !== undefined) && !this.deletion.hasPassword && (this.accountEmail !== null));
	}

	/**
	 * Emails a code to the account's address, then asks for it
	 */
	private async sendCode(): Promise<void>
	{
		const email = (this.accountEmail ?? '');

		if (this.sendCodeButton.disabled)
		{
			return;
		}

		this.sendCodeButton.disabled = true;
		showMessage(this.confirmError, undefined);

		try
		{
			await this.botCheck.send((botCheckToken) => this.authApi.sendCode({
				purpose: 'deleteAccount',
				email,
				locale: currentLocale(),
				botCheckToken
			}));
			this.codeSent = true;
			this.emailCodeIntro.textContent = t({
				id: 'profile.deleteCodeSent',
				defaultMessage: 'We\'ve emailed a code to {email}. Enter it to delete your account. It works once, for {minutes, plural, one {# minute} other {# minutes}}.',
				description: 'In the dialog that deletes an account without a password, once a code was sent to the account\'s address; {email} is that address'
			}, {
				email,
				minutes: EMAIL_CODE_LIFETIME_MINUTES
			});
			this.sendCodeButton.hidden = true;
			this.emailCodeLabel.hidden = false;
			announce(this.emailCodeIntro.textContent);
			this.emailCode.focus();
		}
		catch (error)
		{
			showMessage(this.confirmError, describeEditorError(error, {
				id: 'profile.deleteCodeFailed',
				defaultMessage: 'Could not email you a code.',
				description: 'Shown in the dialog that deletes an account without a password when the code couldn\'t be emailed to the account\'s address'
			}));
		}
		finally
		{
			this.sendCodeButton.disabled = false;
		}
	}

	/**
	 * Lists the universes the player is the only creator of, each with a choice of who creates it next
	 * or deleting it, unless the site's admins kept it from being deleted. Nothing is chosen at first, so
	 * deleting a universe is never a default
	 *
	 * @param deletion What deleting the account asks
	 */
	private showUniverses(deletion: AccountDeletionPayload): void
	{
		this.choices.clear();
		this.universes.hidden = (deletion.universes.length === 0);
		this.universeList.replaceChildren(...deletion.universes.map((universe) =>
		{
			const item = document.createElement('div');
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
			item.className = 'account-delete-universe';
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
			}), editor.playerId)));
			select.addEventListener('change', () =>
			{
				setFieldError(select, undefined);
			});
			label.append(name, select);
			item.append(label);
			this.choices.set(universe.id, select);

			if (universe.deletionPrevented || universe.twoFactorRequired)
			{
				const hint = document.createElement('p');

				hint.id = `account-delete-universe-${universe.id}-hint`;
				hint.className = 'hint';
				hint.textContent = (universe.deletionPrevented
					? t({
						id: 'profile.deleteUniversePrevented',
						defaultMessage: 'The site\'s admins disabled this universe and kept it from being deleted, so another of its editors has to become its creator.',
						description: 'Under a universe\'s choice in the dialog that deletes the player\'s account, which then has no choice to delete it: the site\'s admins disabled the universe and kept it from being deleted'
					})
					: t({
						id: 'profile.deleteUniverseNeedsTwoFactor',
						defaultMessage: 'This universe requires its editors to have two-factor authentication on, so another of its editors has to become its creator. Turn it on to delete the universe instead.',
						description: 'Under a universe\'s choice in the dialog that deletes the player\'s account, which then has no choice to delete it: the universe requires its editors to have two-factor authentication on, and the player doesn\'t'
					}));
				select.setAttribute('aria-describedby', hint.id);
				item.append(hint);
			}
			else
			{
				select.append(new Option(t({
					id: 'profile.deleteUniverseDelete',
					defaultMessage: 'Delete it',
					description: 'A choice for a universe in the dialog that deletes the player\'s account: the universe is deleted, with its world and every character in it'
				}), DELETE_UNIVERSE));
			}

			return(item);
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
	 * Deletes the account with what was chosen in the first dialog and typed in the second
	 */
	private async submit(): Promise<void>
	{
		const deletion = this.deletion;

		if (!deletion || this.confirmButton.disabled)
		{
			return;
		}

		showMessage(this.confirmError, undefined);
		this.confirmButton.disabled = true;

		try
		{
			if (this.needsEmailCode() && this.codeSent && !this.codeChecked)
			{
				await this.authApi.checkCode({
					purpose: 'deleteAccount',
					email: (this.accountEmail ?? ''),
					code: this.emailCode.value
				});
				this.codeChecked = true;
				this.emailCode.disabled = true;
			}

			await this.botCheck.send((botCheckToken) => this.authApi.deleteAccount({
				password: (deletion.hasPassword ? this.password.value : null),
				twoFactorCode: (deletion.twoFactor ? this.code.value : null),
				username: (deletion.hasPassword ? null : this.username.value),
				universes: this.decisions,
				locale: currentLocale(),
				botCheckToken
			}));
			this.confirmDialog.close();
			this.deleted();
			return;
		}
		catch (error)
		{
			// The universes changed since they were listed, or the player was made the only server admin:
			// back to the first dialog, which lists them again
			if ((error instanceof EditorApiError) && (error.status === 409))
			{
				const message = error.message;

				this.confirmDialog.close();
				this.dialog.showModal();
				await this.load();
				showMessage(this.error, message);
				return;
			}

			const field = authFieldOf(error);
			const input = ((field === 'password') ? this.password : ((field === 'twoFactorCode') ? this.code : ((field === 'username') ? this.username : ((field === 'code') ? this.emailCode : undefined))));

			if (input && !input.disabled && (error instanceof EditorApiError))
			{
				reportFieldError(input, error.message);
			}
			else
			{
				showMessage(this.confirmError, describeEditorError(error, {
					id: 'profile.deleteFailed',
					defaultMessage: 'Could not delete your account.',
					description: 'Shown in the dialog that deletes the player\'s account when it couldn\'t be deleted'
				}));
			}
		}

		this.confirmButton.disabled = false;
	}
}
