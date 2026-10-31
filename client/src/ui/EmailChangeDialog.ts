import { EMAIL_CODE_LIFETIME_MINUTES, MAX_EMAIL_LENGTH, MAX_PASSWORD_LENGTH } from '@multiverse-kiln/shared';

import { currentLocale, t } from '../localization';
import { authFieldOf, type AuthApi } from '../network/authApi';
import { describeEditorError, EditorApiError } from '../network/editorApi';
import { announce } from './announcer';
import { ChangeTracker } from './changeTracker';
import { resetCodeInput } from './codeInputs';
import { getElement, showMessage } from './dom';
import { clearFieldErrors, reportFieldError, setFieldError } from './fieldErrors';
import type { AccountCheck } from './ProviderLinkDialog';

/**
 * The steps of changing the address: emailing a code to the current address (only for an account
 * without a password), the new address, then the code emailed to it with the password and 2FA code
 */
type EmailChangeStep = 'confirm' | 'address' | 'code';

/**
 * The dialog that changes the player's email address (profile.html): the new address, then the code
 * emailed to it (see Email codes in STRUCTURE-OVERVIEW.md). It checks it's the player, not just someone
 * using their session: with the password, or for an account without one, a code emailed to its current
 * address first, and with 2FA, the authenticator code. Both addresses are told once it changes, and
 * every other browser logged in to the account is logged out
 */
export class EmailChangeDialog
{
	private readonly dialog = getElement('email-dialog', HTMLDialogElement);
	private readonly form = getElement('email-dialog-form', HTMLFormElement);
	private readonly intro = getElement('email-dialog-intro', HTMLElement);
	private readonly username = getElement('email-dialog-username', HTMLInputElement);
	private readonly currentCodeLabel = getElement('email-dialog-current-code-label', HTMLElement);
	private readonly currentCode = getElement('email-dialog-current-code', HTMLInputElement);
	private readonly addressLabel = getElement('email-dialog-address-label', HTMLElement);
	private readonly address = getElement('email-dialog-address', HTMLInputElement);
	private readonly codeLabel = getElement('email-dialog-code-label', HTMLElement);
	private readonly code = getElement('email-dialog-code', HTMLInputElement);
	private readonly passwordField = getElement('email-dialog-password-field', HTMLElement);
	private readonly password = getElement('email-dialog-password', HTMLInputElement);
	private readonly twoFactorField = getElement('email-dialog-two-factor-field', HTMLElement);
	private readonly twoFactorCode = getElement('email-dialog-two-factor-code', HTMLInputElement);
	private readonly error = getElement('email-dialog-error', HTMLElement);
	private readonly emailMeButton = getElement('email-dialog-email-me', HTMLButtonElement);
	private readonly sendButton = getElement('email-dialog-send', HTMLButtonElement);
	private readonly confirmButton = getElement('email-dialog-confirm', HTMLButtonElement);
	private readonly tracker = new ChangeTracker({ root: this.form });

	/**
	 * The account whose address changes, while the dialog is open
	 */
	private account: AccountCheck = {
		email: null,
		hasPassword: true,
		twoFactor: false
	};

	private step: EmailChangeStep = 'address';

	/**
	 * The address the code was sent to, once it has been
	 */
	private sentTo: string | undefined;

	/**
	 * Whether the code sent to the current address, and the one sent to the new address, were found
	 * right. A right code works once, so it isn't checked again when something else is wrong
	 */
	private currentCodeChecked = false;
	private codeChecked = false;

	/**
	 * @param api The auth routes
	 * @param changed Called with the new address once the account has it
	 */
	constructor(private readonly api: AuthApi, private readonly changed: (email: string) => void)
	{
		this.address.maxLength = MAX_EMAIL_LENGTH;
		this.password.maxLength = MAX_PASSWORD_LENGTH;
		this.tracker.guardDialog(this.dialog);

		for (const field of [this.currentCode, this.address, this.code, this.password, this.twoFactorCode])
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

		getElement('email-dialog-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			if (this.tracker.confirmDiscard())
			{
				this.dialog.close();
			}
		});

		this.dialog.addEventListener('close', () =>
		{
			this.password.value = '';
		});
	}

	/**
	 * Opens the dialog: for an account without a password, at emailing a code to its current address,
	 * and otherwise at the new address
	 *
	 * @param account The account, with its address now, if it has one
	 */
	open(account: AccountCheck): void
	{
		this.account = account;
		this.sentTo = undefined;
		this.currentCodeChecked = false;
		this.codeChecked = false;
		this.username.value = (account.email ?? '');
		this.address.value = '';
		this.password.value = '';
		resetCodeInput(this.currentCode);
		resetCodeInput(this.code);
		resetCodeInput(this.twoFactorCode);
		this.currentCode.disabled = false;
		this.code.disabled = false;

		if (this.confirming())
		{
			this.intro.textContent = t({
				id: 'profile.changeEmailIntroConfirm',
				defaultMessage: 'Your email address is {email}. To check it\'s you, we\'ll email it a code first. Every other browser logged in to your account is logged out when the address changes.',
				description: 'In the dialog that changes the player\'s email address, for an account without a password, before a code is sent to its current address; {email} is that address'
			}, {
				email: (account.email ?? '')
			});
			this.showStep('confirm');
		}
		else
		{
			this.intro.textContent = ((account.email === null)
				? t({
					id: 'profile.changeEmailIntroNone',
					defaultMessage: 'Enter an email address, and we\'ll send it a code to check it\'s yours.',
					description: 'In the dialog that changes the player\'s email address, when the account has none yet'
				})
				: t({
					id: 'profile.changeEmailIntro',
					defaultMessage: 'Your email address is {email}. Enter the new one, and we\'ll send it a code to check it\'s yours. Every other browser logged in to your account is logged out when the address changes.',
					description: 'In the dialog that changes the player\'s email address; {email} is the address the account has now'
				}, {
					email: account.email
				}));
			this.showStep('address');
		}

		clearFieldErrors(this.form);
		showMessage(this.error, undefined);
		this.tracker.markSaved();
		this.dialog.showModal();
		((this.step === 'confirm') ? this.emailMeButton : this.address).focus();
	}

	/**
	 * Whether the account checks it's the player with a code sent to its current address: it has no
	 * password, but has an address
	 *
	 * @return Whether it does
	 */
	private confirming(): boolean
	{
		return(!this.account.hasPassword && (this.account.email !== null));
	}

	/**
	 * Shows the fields and button of one step
	 *
	 * @param step The step
	 */
	private showStep(step: EmailChangeStep): void
	{
		this.step = step;
		this.emailMeButton.hidden = (step !== 'confirm');
		this.currentCodeLabel.hidden = ((step !== 'address') || !this.confirming());
		this.currentCode.required = !this.currentCodeLabel.hidden;
		this.addressLabel.hidden = (step !== 'address');
		this.address.required = (step === 'address');
		this.sendButton.hidden = (step !== 'address');
		this.codeLabel.hidden = (step !== 'code');
		this.code.required = (step === 'code');
		this.passwordField.hidden = ((step !== 'code') || !this.account.hasPassword);
		this.twoFactorField.hidden = ((step !== 'code') || !this.account.twoFactor);
		this.confirmButton.hidden = (step !== 'code');
	}

	/**
	 * Takes the step showing: emails the code to the current address, sends the code to the new
	 * address, or checks what was typed and changes the address
	 */
	private async submit(): Promise<void>
	{
		const button = ((this.step === 'confirm') ? this.emailMeButton : ((this.step === 'address') ? this.sendButton : this.confirmButton));

		if (button.disabled)
		{
			return;
		}

		button.disabled = true;
		showMessage(this.error, undefined);

		try
		{
			if (this.step === 'confirm')
			{
				await this.sendCurrentCode();
			}
			else if (this.step === 'address')
			{
				await this.sendCode();
			}
			else
			{
				await this.changeAddress(this.sentTo ?? '');
			}
		}
		catch (error)
		{
			// A refusal about a field showing goes under it; any other, such as a taken address once the code is in, under the form
			const input = this.fieldFor(authFieldOf(error));

			if (input && !input.disabled && (error instanceof EditorApiError))
			{
				reportFieldError(input, error.message);
			}
			else
			{
				showMessage(this.error, describeEditorError(error, {
					id: 'profile.changeEmailFailed',
					defaultMessage: 'Could not change your email address.',
					description: 'Shown in the dialog that changes the player\'s email address when sending the code or changing the address failed'
				}));
			}
		}
		finally
		{
			button.disabled = false;
		}
	}

	/**
	 * The field showing in this step that a refusal is about
	 *
	 * @param field The field the refusal names, if any
	 * @return The field's input, or undefined when it isn't one this step shows
	 */
	private fieldFor(field: string | undefined): HTMLInputElement | undefined
	{
		if (this.step === 'address')
		{
			return(((field === 'email') ? this.address : ((field === 'code') ? this.currentCode : undefined)));
		}

		if (this.step === 'code')
		{
			return(((field === 'code') ? this.code : ((field === 'password') ? this.password : ((field === 'twoFactorCode') ? this.twoFactorCode : undefined))));
		}

		return(undefined);
	}

	/**
	 * Emails a code to the account's current address, then asks for it with the new address
	 */
	private async sendCurrentCode(): Promise<void>
	{
		const email = (this.account.email ?? '');

		await this.api.sendCode({
			purpose: 'confirmEmailChange',
			email,
			locale: currentLocale()
		});
		this.intro.textContent = t({
			id: 'profile.changeEmailConfirmSent',
			defaultMessage: 'We\'ve emailed a code to {email}. Enter it, and the new address, and we\'ll send that a code too. It works once, for {minutes, plural, one {# minute} other {# minutes}}.',
			description: 'In the dialog that changes the email address of an account without a password, once a code was sent to its current address; {email} is that address'
		}, {
			email,
			minutes: EMAIL_CODE_LIFETIME_MINUTES
		});
		this.showStep('address');
		announce(this.intro.textContent);
		this.currentCode.focus();
	}

	/**
	 * Checks the code sent to the current address, if the account needs one, then emails a code to the
	 * address typed and asks for it
	 */
	private async sendCode(): Promise<void>
	{
		const email = this.address.value.trim();

		if (email === '')
		{
			reportFieldError(this.address, t({
				id: 'profile.newEmailMissing',
				defaultMessage: 'Enter the new email address.',
				description: 'Shown under the new email address field, in the dialog that changes it, when it is empty'
			}));
			return;
		}

		// Checked before the new address's code, which takes the same cookie (see confirmedChangeToken() on the server)
		if (this.confirming() && !this.currentCodeChecked)
		{
			await this.api.checkCode({
				purpose: 'confirmEmailChange',
				email: (this.account.email ?? ''),
				code: this.currentCode.value
			});
			this.currentCodeChecked = true;
			this.currentCode.disabled = true;
		}

		await this.api.sendCode({
			purpose: 'changeEmail',
			email,
			locale: currentLocale()
		});
		this.sentTo = email;
		this.intro.textContent = t({
			id: 'profile.changeEmailCodeSent',
			defaultMessage: 'If {email} isn\'t another account\'s address, we\'ve emailed it a code. Enter the code from the email. It works once, for {minutes, plural, one {# minute} other {# minutes}}.',
			description: 'In the dialog that changes the player\'s email address, once a code was sent to the new address; {email} is that address. The page can\'t say whether it belongs to another account, so it can\'t say a code was sent'
		}, {
			email,
			minutes: EMAIL_CODE_LIFETIME_MINUTES
		});
		this.showStep('code');
		announce(this.intro.textContent);
		this.code.focus();
	}

	/**
	 * Checks the code typed, then makes the address it was sent to the account's, with the password and
	 * authenticator code
	 *
	 * @param email The address the code was sent to
	 */
	private async changeAddress(email: string): Promise<void>
	{
		if (!this.codeChecked)
		{
			await this.api.checkCode({
				purpose: 'changeEmail',
				email,
				code: this.code.value
			});
			this.codeChecked = true;
			this.code.disabled = true;
		}

		await this.api.changeEmail({
			email,
			locale: currentLocale(),
			currentPassword: (this.account.hasPassword ? this.password.value : null),
			twoFactorCode: (this.account.twoFactor ? this.twoFactorCode.value : null)
		});
		this.tracker.markSaved();
		this.dialog.close();
		this.changed(email);
	}
}
