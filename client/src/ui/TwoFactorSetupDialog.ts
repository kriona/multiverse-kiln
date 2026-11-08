import { MAX_PASSWORD_LENGTH, type TwoFactorSetupPayload } from '@multiverse-kiln/shared';

import { currentLocale, t } from '../localization';
import { authFieldOf, type AuthApi } from '../network/authApi';
import { describeEditorError, EditorApiError } from '../network/editorApi';
import { announce } from './announcer';
import { ChangeTracker } from './changeTracker';
import { resetCodeInput } from './codeInputs';
import { getElement, showMessage } from './dom';
import { clearFieldErrors, reportFieldError, setFieldError } from './fieldErrors';
import { drawQrCode } from './qrCode';
import { TwoFactorEmailCode, type TwoFactorAccount } from './TwoFactorEmailCode';

/**
 * The dialog that turns on 2FA (partials/two-factor-dialogs.html, on the profile, Home and the login
 * page): the player's password, or for an account without one, a code emailed to its address, then a QR
 * code for their authenticator app and the code the app shows. Once that is right, the account's
 * recovery codes are shown (RecoveryCodesDialog). On the login page, a server admin without 2FA turns it
 * on to finish logging in, starting at the QR code, since the login showed it's them (openAtLogin())
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
	private readonly passwordIntro = getElement('two-factor-dialog-intro-password', HTMLElement);
	private readonly providerIntro = getElement('two-factor-dialog-intro-provider', HTMLElement);
	private readonly loginIntro = getElement('two-factor-dialog-intro-login', HTMLElement);
	private readonly scanIntro = getElement('two-factor-dialog-scan-intro', HTMLElement);
	private readonly email = getElement('two-factor-dialog-email', HTMLInputElement);
	private readonly passwordField = getElement('two-factor-dialog-password-field', HTMLElement);
	private readonly password = getElement('two-factor-dialog-password', HTMLInputElement);
	private readonly emailCodeInput = getElement('two-factor-dialog-email-code', HTMLInputElement);
	private readonly qr = getElement('two-factor-dialog-qr', HTMLElement);
	private readonly secret = getElement('two-factor-dialog-secret', HTMLElement);
	private readonly copyStatus = getElement('two-factor-dialog-copy-status', HTMLElement);
	private readonly code = getElement('two-factor-dialog-code', HTMLInputElement);
	private readonly error = getElement('two-factor-dialog-error', HTMLElement);
	private readonly continueButton = getElement('two-factor-dialog-continue', HTMLButtonElement);
	private readonly enableButton = getElement('two-factor-dialog-enable', HTMLButtonElement);
	private readonly cancelButton = getElement('two-factor-dialog-cancel', HTMLButtonElement);
	private readonly skipButton = getElement('two-factor-dialog-skip', HTMLButtonElement);
	private readonly sendButton = getElement('two-factor-dialog-send', HTMLButtonElement);
	private readonly tracker = new ChangeTracker({ root: this.form });
	private readonly emailCode: TwoFactorEmailCode;

	/**
	 * Called when the dialog closes without turning 2FA on, while it offers to skip setting it up or
	 * finishes a login
	 */
	private skipped: (() => void) | undefined;

	/**
	 * Whether the dialog finishes a server admin's login (openAtLogin())
	 */
	private atLogin = false;

	/**
	 * @param api The auth routes
	 * @param enabled Called with the recovery codes once 2FA is on
	 */
	constructor(private readonly api: AuthApi, private readonly enabled: (recoveryCodes: string[]) => void)
	{
		this.emailCode = new TwoFactorEmailCode(api, {
			note: getElement('two-factor-dialog-email-note', HTMLElement),
			label: getElement('two-factor-dialog-email-code-label', HTMLElement),
			input: this.emailCodeInput,
			sendButton: this.sendButton
		});
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

		for (const button of [this.cancelButton, this.skipButton])
		{
			button.addEventListener('click', () =>
			{
				if (this.tracker.confirmDiscard())
				{
					this.dialog.close();
				}
			});
		}

		this.dialog.addEventListener('close', () =>
		{
			const skipped = this.skipped;

			this.skipped = undefined;
			this.forgetSecret();
			skipped?.();
		});
	}

	/**
	 * Opens the dialog, asking for the password, or for an account without one, offering to email a code
	 *
	 * @param account The account's address, and whether it has a password
	 * @param skipped When given, Skip Setup takes Cancel's place, and this is called when the dialog closes
	 * without turning 2FA on, however it closes
	 */
	open(account: TwoFactorAccount, skipped?: () => void): void
	{
		this.skipped = skipped;
		this.atLogin = false;
		this.loginIntro.hidden = true;
		this.cancelButton.hidden = (skipped !== undefined);
		this.skipButton.hidden = (skipped === undefined);
		this.passwordIntro.hidden = !account.hasPassword;
		this.providerIntro.hidden = account.hasPassword;
		this.passwordField.hidden = !account.hasPassword;
		this.email.value = (account.email ?? '');
		this.password.value = '';
		this.emailCode.reset(account);
		resetCodeInput(this.code);
		this.forgetSecret();
		this.showStep('password');
		this.tracker.markSaved();
		this.dialog.showModal();
		(account.hasPassword ? this.password : this.sendButton).focus();
	}

	/**
	 * Opens the dialog at the QR code, for a server admin without 2FA whose login waits for them to turn
	 * it on
	 *
	 * @param setup The secret for the authenticator app (AuthApi.setUpTwoFactorAtLogin())
	 * @param canceled Called when the dialog closes without turning 2FA on, however it closes
	 */
	openAtLogin(setup: TwoFactorSetupPayload, canceled: () => void): void
	{
		this.skipped = canceled;
		this.atLogin = true;
		this.loginIntro.hidden = false;
		this.cancelButton.hidden = false;
		this.skipButton.hidden = true;
		this.password.value = '';
		resetCodeInput(this.code);
		this.showSecretOf(setup);
		this.showStep('scan');
		this.tracker.markSaved();
		this.dialog.showModal();
		this.code.focus();
		announce(`${this.loginIntro.textContent} ${this.scanIntro.textContent}`);
	}

	/**
	 * Shows one of the dialog's steps, with its button: in the first, Email me a code until the code is
	 * sent, for an account without a password
	 *
	 * @param step The step
	 */
	private showStep(step: 'password' | 'scan'): void
	{
		this.passwordStep.hidden = (step !== 'password');
		this.scanStep.hidden = (step !== 'scan');
		this.sendButton.hidden = ((step !== 'password') || !this.emailCode.sending);
		this.continueButton.hidden = ((step !== 'password') || this.emailCode.sending);
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
	 * Takes the step the dialog shows: emails a code, checks the password or the emailed code and shows
	 * the QR code, or turns 2FA on
	 */
	private async submit(): Promise<void>
	{
		const sending = (this.scanStep.hidden && this.emailCode.sending);
		const button = (sending ? this.sendButton : (this.scanStep.hidden ? this.continueButton : this.enableButton));

		if (button.disabled)
		{
			return;
		}

		button.disabled = true;
		showMessage(this.error, undefined);

		try
		{
			if (sending)
			{
				await this.emailCode.send();
				this.continueButton.hidden = false;
			}
			else if (this.scanStep.hidden)
			{
				await this.showSecret();
			}
			else
			{
				const request = {
					code: this.code.value,
					locale: currentLocale()
				};
				const codes = await (this.atLogin ? this.api.enableTwoFactorAtLogin(request) : this.api.enableTwoFactor(request));

				this.tracker.markSaved();
				this.skipped = undefined;
				this.dialog.close();
				this.enabled(codes);
			}
		}
		catch (error)
		{
			// The emailed code and the app's code are both 'code', each in its own step
			const field = authFieldOf(error);
			const codeInput = (this.scanStep.hidden ? this.emailCodeInput : this.code);
			const input = ((field === 'password') ? this.password : ((field === 'code') ? codeInput : undefined));

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
	 * Gets a new secret, once the password or the emailed code is right, and shows it as a QR code and
	 * as text
	 */
	private async showSecret(): Promise<void>
	{
		await this.emailCode.check();

		const setup = await this.api.setUpTwoFactor({
			password: (this.emailCode.asked ? null : this.password.value)
		});

		this.showSecretOf(setup);
		this.password.value = '';
		this.showStep('scan');
		this.code.focus();
		announce(this.scanIntro.textContent);
	}

	/**
	 * Shows a secret as a QR code and as text
	 *
	 * @param setup The secret
	 */
	private showSecretOf(setup: TwoFactorSetupPayload): void
	{
		this.qr.replaceChildren(drawQrCode(setup.uri, t({
			id: 'profile.twoFactorQrLabel',
			defaultMessage: 'QR code for your authenticator app. If you can\'t scan it, use the key below it.',
			description: 'What screen readers say for the QR code in the dialog that sets up two-factor authentication'
		})));

		// In groups of four, as authenticator apps show keys
		this.secret.textContent = (setup.secret.match(/.{1,4}/g) ?? []).join(' ');
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
