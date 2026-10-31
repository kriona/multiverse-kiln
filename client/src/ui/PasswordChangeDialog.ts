import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@multiverse-kiln/shared';

import { currentLocale, t } from '../localization';
import { authFieldOf, type AuthApi } from '../network/authApi';
import { describeEditorError, EditorApiError } from '../network/editorApi';
import { ChangeTracker } from './changeTracker';
import { getElement, showMessage } from './dom';
import { clearFieldErrors, reportFieldError, setFieldError } from './fieldErrors';
import { showToast } from './toast';

/**
 * The dialog that changes the player's password (profile.html), given the current one. Every other
 * browser logged in to the account is logged out, and the account is emailed
 */
export class PasswordChangeDialog
{
	private readonly dialog = getElement('password-dialog', HTMLDialogElement);
	private readonly form = getElement('password-dialog-form', HTMLFormElement);
	private readonly email = getElement('password-dialog-email', HTMLInputElement);
	private readonly current = getElement('password-dialog-current', HTMLInputElement);
	private readonly next = getElement('password-dialog-new', HTMLInputElement);
	private readonly error = getElement('password-dialog-error', HTMLElement);
	private readonly submitButton = getElement('password-dialog-submit', HTMLButtonElement);
	private readonly tracker = new ChangeTracker({ root: this.form });

	/**
	 * @param api The auth routes
	 */
	constructor(private readonly api: AuthApi)
	{
		getElement('password-dialog-min', HTMLElement).textContent = new Intl.NumberFormat(currentLocale()).format(MIN_PASSWORD_LENGTH);

		// No minLength: the browser would explain it in its own language, and the server's message is in the page's
		this.next.maxLength = MAX_PASSWORD_LENGTH;
		this.tracker.guardDialog(this.dialog);

		for (const field of [this.current, this.next])
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

		getElement('password-dialog-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			if (this.tracker.confirmDiscard())
			{
				this.dialog.close();
			}
		});
	}

	/**
	 * Opens the dialog
	 *
	 * @param email The account's address, which tells password managers which account the new password is for
	 */
	open(email: string | null): void
	{
		this.email.value = (email ?? '');
		this.current.value = '';
		this.next.value = '';
		clearFieldErrors(this.form);
		showMessage(this.error, undefined);
		this.tracker.markSaved();
		this.dialog.showModal();
		this.current.focus();
	}

	/**
	 * Changes the password to the new one typed
	 */
	private async submit(): Promise<void>
	{
		if (this.submitButton.disabled)
		{
			return;
		}

		this.submitButton.disabled = true;
		showMessage(this.error, undefined);

		try
		{
			await this.api.changePassword({
				currentPassword: this.current.value,
				newPassword: this.next.value,
				locale: currentLocale()
			});
			this.tracker.markSaved();
			this.dialog.close();
			showToast(t({
				id: 'profile.passwordChanged',
				defaultMessage: 'Password changed. Every other browser logged in to your account was logged out.',
				description: 'Shown once the player has changed their password from their profile'
			}), {
				kind: 'success'
			});
		}
		catch (error)
		{
			const field = authFieldOf(error);
			const input = ((field === 'currentPassword') ? this.current : ((field === 'password') ? this.next : undefined));

			if (input && (error instanceof EditorApiError))
			{
				reportFieldError(input, error.message);
			}
			else
			{
				showMessage(this.error, describeEditorError(error, {
					id: 'profile.changePasswordFailed',
					defaultMessage: 'Could not change your password.',
					description: 'Shown in the dialog that changes the player\'s password when it couldn\'t be changed'
				}));
			}
		}
		finally
		{
			this.submitButton.disabled = false;
		}
	}
}
