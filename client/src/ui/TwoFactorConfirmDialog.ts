import { MAX_PASSWORD_LENGTH } from '@multiverse-kiln/shared';

import { currentLocale, t } from '../localization';
import { authFieldOf, type AuthApi } from '../network/authApi';
import { describeEditorError, EditorApiError } from '../network/editorApi';
import { ChangeTracker } from './changeTracker';
import { resetCodeInput } from './codeInputs';
import { getElement, showMessage } from './dom';
import { clearFieldErrors, reportFieldError, setFieldError } from './fieldErrors';

/**
 * What the dialog changes: turning 2FA off, or making new recovery codes
 */
export type TwoFactorChange = 'turnOff' | 'newCodes';

/**
 * The dialog that turns off 2FA or makes new recovery codes (profile.html), each of which needs the
 * player's password and an authenticator or recovery code
 */
export class TwoFactorConfirmDialog
{
	private readonly dialog = getElement('two-factor-confirm-dialog', HTMLDialogElement);
	private readonly form = getElement('two-factor-confirm-form', HTMLFormElement);
	private readonly title = getElement('two-factor-confirm-title', HTMLElement);
	private readonly intro = getElement('two-factor-confirm-intro', HTMLElement);
	private readonly email = getElement('two-factor-confirm-email', HTMLInputElement);
	private readonly password = getElement('two-factor-confirm-password', HTMLInputElement);
	private readonly code = getElement('two-factor-confirm-code', HTMLInputElement);
	private readonly error = getElement('two-factor-confirm-error', HTMLElement);
	private readonly offButton = getElement('two-factor-confirm-off', HTMLButtonElement);
	private readonly codesButton = getElement('two-factor-confirm-codes', HTMLButtonElement);
	private readonly tracker = new ChangeTracker({ root: this.form });

	/**
	 * What the dialog changes while it is open
	 */
	private change: TwoFactorChange = 'turnOff';

	/**
	 * @param api The auth routes
	 * @param turnedOff Called once 2FA is off
	 * @param codesMade Called with the new recovery codes once they are made
	 */
	constructor(private readonly api: AuthApi, private readonly turnedOff: () => void, private readonly codesMade: (recoveryCodes: string[]) => void)
	{
		this.password.maxLength = MAX_PASSWORD_LENGTH;
		this.tracker.guardDialog(this.dialog);

		for (const field of [this.password, this.code])
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

		getElement('two-factor-confirm-cancel', HTMLButtonElement).addEventListener('click', () =>
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
	 * @param change What it changes
	 * @param email The account's address, which tells password managers which account the password is for
	 */
	open(change: TwoFactorChange, email: string | null): void
	{
		this.change = change;

		if (change === 'turnOff')
		{
			this.title.textContent = t({
				id: 'profile.twoFactorDisableTitle',
				defaultMessage: 'Turn off two-factor authentication',
				description: 'Title of the dialog that turns off two-factor authentication'
			});
			this.intro.textContent = t({
				id: 'profile.twoFactorDisableIntro',
				defaultMessage: 'Logging in will need only your password again. Your recovery codes stop working, and every trusted browser is forgotten.',
				description: 'In the dialog that turns off two-factor authentication'
			});
		}
		else
		{
			this.title.textContent = t({
				id: 'profile.recoveryCodesNewTitle',
				defaultMessage: 'Make new recovery codes',
				description: 'Title of the dialog that makes new recovery codes for two-factor authentication'
			});
			this.intro.textContent = t({
				id: 'profile.recoveryCodesNewIntro',
				defaultMessage: 'Your old recovery codes stop working once the new ones are made.',
				description: 'In the dialog that makes new recovery codes for two-factor authentication'
			});
		}

		this.offButton.hidden = (change !== 'turnOff');
		this.codesButton.hidden = (change !== 'newCodes');
		this.email.value = (email ?? '');
		this.password.value = '';
		resetCodeInput(this.code);
		clearFieldErrors(this.form);
		showMessage(this.error, undefined);
		this.tracker.markSaved();
		this.dialog.showModal();
		this.password.focus();
	}

	/**
	 * Turns 2FA off, or makes new recovery codes, with the password and code typed
	 */
	private async submit(): Promise<void>
	{
		const button = ((this.change === 'turnOff') ? this.offButton : this.codesButton);

		if (button.disabled)
		{
			return;
		}

		button.disabled = true;
		showMessage(this.error, undefined);

		try
		{
			if (this.change === 'turnOff')
			{
				await this.api.disableTwoFactor({
					password: this.password.value,
					code: this.code.value,
					locale: currentLocale()
				});
				this.tracker.markSaved();
				this.dialog.close();
				this.turnedOff();
			}
			else
			{
				const codes = await this.api.replaceRecoveryCodes({
					password: this.password.value,
					code: this.code.value,
					locale: currentLocale()
				});

				this.tracker.markSaved();
				this.dialog.close();
				this.codesMade(codes);
			}
		}
		catch (error)
		{
			const field = authFieldOf(error);
			const input = ((field === 'password') ? this.password : ((field === 'twoFactorCode') ? this.code : undefined));

			if (input && (error instanceof EditorApiError))
			{
				reportFieldError(input, error.message);
			}
			else if (this.change === 'turnOff')
			{
				showMessage(this.error, describeEditorError(error, {
					id: 'profile.twoFactorDisableFailed',
					defaultMessage: 'Could not turn off two-factor authentication.',
					description: 'Shown in the dialog that turns off two-factor authentication when it couldn\'t be turned off'
				}));
			}
			else
			{
				showMessage(this.error, describeEditorError(error, {
					id: 'profile.recoveryCodesFailed',
					defaultMessage: 'Could not make new recovery codes.',
					description: 'Shown in the dialog that makes new recovery codes when they couldn\'t be made'
				}));
			}
		}
		finally
		{
			button.disabled = false;
		}
	}
}
