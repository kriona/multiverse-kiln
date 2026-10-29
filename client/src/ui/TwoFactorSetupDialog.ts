import { MAX_PASSWORD_LENGTH } from '@multiverse-kiln/shared';

import { currentLocale, t } from '../localization';
import { authFieldOf, type AuthApi } from '../network/authApi';
import { describeEditorError, EditorApiError } from '../network/editorApi';
import { announce } from './announcer';
import { ChangeTracker } from './changeTracker';
import { resetCodeInput } from './codeInputs';
import { getElement, showMessage } from './dom';
import { clearFieldErrors, reportFieldError, setFieldError } from './fieldErrors';
import { drawQrCode } from './qrCode';

/**
 * The dialog that turns on 2FA (profile.html): the player's password, then a QR code for their
 * authenticator app and the code the app shows. Once that is right, the account's recovery codes are
 * shown (RecoveryCodesDialog)
 *
 * The secret comes in the body of the setup request's answer, and is only drawn as a QR code and shown
 * as text in the dialog: it is never put in an address, a link or an image's source, and it is cleared
 * from the page when the dialog closes
 */
export class TwoFactorSetupDialog
{
	private readonly dialog = getElement('two-factor-dialog', HTMLDialogElement);
	private readonly form = getElement('two-factor-dialog-form', HTMLFormElement);
	private readonly passwordStep = getElement('two-factor-dialog-password-step', HTMLElement);
	private readonly scanStep = getElement('two-factor-dialog-scan-step', HTMLElement);
	private readonly email = getElement('two-factor-dialog-email', HTMLInputElement);
	private readonly password = getElement('two-factor-dialog-password', HTMLInputElement);
	private readonly qr = getElement('two-factor-dialog-qr', HTMLElement);
	private readonly secret = getElement('two-factor-dialog-secret', HTMLElement);
	private readonly copyStatus = getElement('two-factor-dialog-copy-status', HTMLElement);
	private readonly code = getElement('two-factor-dialog-code', HTMLInputElement);
	private readonly error = getElement('two-factor-dialog-error', HTMLElement);
	private readonly continueButton = getElement('two-factor-dialog-continue', HTMLButtonElement);
	private readonly enableButton = getElement('two-factor-dialog-enable', HTMLButtonElement);
	private readonly tracker = new ChangeTracker({ root: this.form });

	/**
	 * @param api The auth routes
	 * @param enabled Called with the recovery codes once 2FA is on
	 */
	constructor(private readonly api: AuthApi, private readonly enabled: (recoveryCodes: string[]) => void)
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

		getElement('two-factor-dialog-copy', HTMLButtonElement).addEventListener('click', () =>
		{
			void this.copySecret();
		});

		getElement('two-factor-dialog-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			if (this.tracker.confirmDiscard())
			{
				this.dialog.close();
			}
		});

		this.dialog.addEventListener('close', () =>
		{
			this.forgetSecret();
		});
	}

	/**
	 * Opens the dialog, asking for the password
	 *
	 * @param email The account's address, which tells password managers which account the password is for
	 */
	open(email: string | null): void
	{
		this.email.value = (email ?? '');
		this.password.value = '';
		resetCodeInput(this.code);
		this.forgetSecret();
		this.showStep('password');
		this.tracker.markSaved();
		this.dialog.showModal();
		this.password.focus();
	}

	/**
	 * Shows one of the dialog's steps, with its button
	 *
	 * @param step The step
	 */
	private showStep(step: 'password' | 'scan'): void
	{
		this.passwordStep.hidden = (step !== 'password');
		this.scanStep.hidden = (step !== 'scan');
		this.continueButton.hidden = (step !== 'password');
		this.enableButton.hidden = (step !== 'scan');
		clearFieldErrors(this.form);
		showMessage(this.error, undefined);
	}

	/**
	 * Clears the secret from the dialog
	 */
	private forgetSecret(): void
	{
		this.qr.replaceChildren();
		this.secret.textContent = '';
		this.copyStatus.textContent = '';
	}

	/**
	 * Takes the step the dialog shows: checks the password and shows the QR code, or turns 2FA on
	 */
	private async submit(): Promise<void>
	{
		const button = (this.scanStep.hidden ? this.continueButton : this.enableButton);

		if (button.disabled)
		{
			return;
		}

		button.disabled = true;
		showMessage(this.error, undefined);

		try
		{
			if (this.scanStep.hidden)
			{
				await this.showSecret();
			}
			else
			{
				const codes = await this.api.enableTwoFactor({
					code: this.code.value,
					locale: currentLocale()
				});

				this.tracker.markSaved();
				this.dialog.close();
				this.enabled(codes);
			}
		}
		catch (error)
		{
			const field = authFieldOf(error);
			const input = ((field === 'password') ? this.password : ((field === 'code') ? this.code : undefined));

			if (input && (error instanceof EditorApiError))
			{
				reportFieldError(input, error.message);
			}
			else
			{
				showMessage(this.error, describeEditorError(error, {
					id: 'profile.twoFactorSetupFailed',
					defaultMessage: 'Could not turn on two-factor authentication.',
					description: 'Shown in the dialog that sets up two-factor authentication when it couldn\'t be set up'
				}));
			}
		}
		finally
		{
			button.disabled = false;
		}
	}

	/**
	 * Gets a new secret, once the password is right, and shows it as a QR code and as text
	 */
	private async showSecret(): Promise<void>
	{
		const setup = await this.api.setUpTwoFactor({
			password: this.password.value
		});

		this.qr.replaceChildren(drawQrCode(setup.uri, t({
			id: 'profile.twoFactorQrLabel',
			defaultMessage: 'QR code for your authenticator app. If you can\'t scan it, use the key below it.',
			description: 'What screen readers say for the QR code in the dialog that sets up two-factor authentication'
		})));

		// In groups of four, as authenticator apps show keys
		this.secret.textContent = (setup.secret.match(/.{1,4}/g) ?? []).join(' ');
		this.password.value = '';
		this.showStep('scan');
		this.code.focus();
		announce(getElement('two-factor-dialog-scan-step', HTMLElement).querySelector('p')?.textContent ?? '');
	}

	/**
	 * Copies the secret to the clipboard, or selects it to copy by hand when the browser won't allow that
	 */
	private async copySecret(): Promise<void>
	{
		try
		{
			await navigator.clipboard.writeText(this.secret.textContent.replace(/\s/g, ''));
			this.copyStatus.textContent = t({
				id: 'profile.keyCopied',
				defaultMessage: 'Key copied.',
				description: 'Shown in the dialog that sets up two-factor authentication once Copy key has copied the secret key'
			});
		}
		catch (error)
		{
			console.warn('Could not copy the authenticator key:', error);
			this.copyStatus.textContent = t({
				id: 'profile.keyCopyFailed',
				defaultMessage: 'Your browser didn\'t allow copying. Select the key and copy it yourself.',
				description: 'Shown in the dialog that sets up two-factor authentication when the browser refused to copy the secret key'
			});
			window.getSelection()?.selectAllChildren(this.secret);
		}
	}
}
