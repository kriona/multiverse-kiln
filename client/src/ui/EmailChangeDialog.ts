import { EMAIL_CODE_LIFETIME_MINUTES, MAX_EMAIL_LENGTH } from '@multiverse-kiln/shared';

import { currentLocale, t } from '../localization';
import { authFieldOf, type AuthApi } from '../network/authApi';
import { describeEditorError, EditorApiError } from '../network/editorApi';
import { announce } from './announcer';
import { ChangeTracker } from './changeTracker';
import { resetCodeInput } from './codeInputs';
import { getElement, showMessage } from './dom';
import { clearFieldErrors, reportFieldError, setFieldError } from './fieldErrors';

/**
 * The dialog that changes the player's email address (profile.html): the new address, then the code
 * emailed to it (see Email codes in STRUCTURE-OVERVIEW.md). Both addresses are told once it changes
 */
export class EmailChangeDialog
{
	private readonly dialog = getElement('email-dialog', HTMLDialogElement);
	private readonly form = getElement('email-dialog-form', HTMLFormElement);
	private readonly intro = getElement('email-dialog-intro', HTMLElement);
	private readonly addressLabel = getElement('email-dialog-address-label', HTMLElement);
	private readonly address = getElement('email-dialog-address', HTMLInputElement);
	private readonly codeLabel = getElement('email-dialog-code-label', HTMLElement);
	private readonly code = getElement('email-dialog-code', HTMLInputElement);
	private readonly error = getElement('email-dialog-error', HTMLElement);
	private readonly sendButton = getElement('email-dialog-send', HTMLButtonElement);
	private readonly confirmButton = getElement('email-dialog-confirm', HTMLButtonElement);
	private readonly tracker = new ChangeTracker({ root: this.form });

	/**
	 * The address the code was sent to, once it has been
	 */
	private sentTo: string | undefined;

	/**
	 * @param api The auth routes
	 * @param changed Called with the new address once the account has it
	 */
	constructor(private readonly api: AuthApi, private readonly changed: (email: string) => void)
	{
		this.address.maxLength = MAX_EMAIL_LENGTH;
		this.tracker.guardDialog(this.dialog);

		for (const field of [this.address, this.code])
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
	}

	/**
	 * Opens the dialog, asking for the new address
	 *
	 * @param currentEmail The account's address now, if it has one
	 */
	open(currentEmail: string | null): void
	{
		this.intro.textContent = ((currentEmail === null)
			? t({
				id: 'profile.changeEmailIntroNone',
				defaultMessage: 'Enter an email address, and we\'ll send it a code to check it\'s yours.',
				description: 'In the dialog that changes the player\'s email address, when the account has none yet'
			})
			: t({
				id: 'profile.changeEmailIntro',
				defaultMessage: 'Your email address is {email}. Enter the new one, and we\'ll send it a code to check it\'s yours.',
				description: 'In the dialog that changes the player\'s email address; {email} is the address the account has now'
			}, {
				email: currentEmail
			}));
		this.sentTo = undefined;
		this.address.value = '';
		resetCodeInput(this.code);
		this.showStep('address');
		clearFieldErrors(this.form);
		showMessage(this.error, undefined);
		this.tracker.markSaved();
		this.dialog.showModal();
		this.address.focus();
	}

	/**
	 * Shows the field and button of one step: the new address, or the code sent to it
	 *
	 * @param step The step
	 */
	private showStep(step: 'address' | 'code'): void
	{
		this.addressLabel.hidden = (step !== 'address');
		this.address.required = (step === 'address');
		this.sendButton.hidden = (step !== 'address');
		this.codeLabel.hidden = (step !== 'code');
		this.code.required = (step === 'code');
		this.confirmButton.hidden = (step !== 'code');
	}

	/**
	 * Sends the code to the address typed, or checks the code typed and changes the address
	 */
	private async submit(): Promise<void>
	{
		const button = ((this.sentTo === undefined) ? this.sendButton : this.confirmButton);

		if (button.disabled)
		{
			return;
		}

		button.disabled = true;
		showMessage(this.error, undefined);

		try
		{
			if (this.sentTo === undefined)
			{
				await this.sendCode();
			}
			else
			{
				await this.changeAddress(this.sentTo);
			}
		}
		catch (error)
		{
			// A refusal about the field showing goes under it; any other, such as a taken address once the code is in, under the form
			const field = authFieldOf(error);
			const input = (((field === 'email') && (this.sentTo === undefined)) ? this.address : (((field === 'code') && (this.sentTo !== undefined)) ? this.code : undefined));

			if (input && (error instanceof EditorApiError))
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
	 * Emails a code to the address typed, then asks for it
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
	 * Checks the code typed, then makes the address it was sent to the account's
	 *
	 * @param email The address the code was sent to
	 */
	private async changeAddress(email: string): Promise<void>
	{
		await this.api.checkCode({
			purpose: 'changeEmail',
			email,
			code: this.code.value
		});
		await this.api.changeEmail({
			email,
			locale: currentLocale()
		});
		this.tracker.markSaved();
		this.dialog.close();
		this.changed(email);
	}
}
