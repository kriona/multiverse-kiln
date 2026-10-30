import { EMAIL_CODE_LIFETIME_MINUTES, LOGIN_PROVIDER_NAMES, MAX_PASSWORD_LENGTH, type LoginProvider } from '@multiverse-kiln/shared';

import { currentLocale, t } from '../localization';
import { authFieldOf, type AuthApi } from '../network/authApi';
import { describeEditorError, EditorApiError } from '../network/editorApi';
import { announce } from './announcer';
import { ChangeTracker } from './changeTracker';
import { resetCodeInput } from './codeInputs';
import { getElement, showMessage } from './dom';
import { clearFieldErrors, reportFieldError, setFieldError } from './fieldErrors';

/**
 * What checking it's the player asks of an account, before linking a login or changing its email
 * address: its password, or without one, a code emailed to its address, and its 2FA code
 */
export interface AccountCheck
{
	email: string | null;
	hasPassword: boolean;
	twoFactor: boolean;
}

/**
 * The dialog that checks it's the player before linking a Google or Discord login from their profile
 * (profile.html; see Login in STRUCTURE-OVERVIEW.md): the account's password, or for an account
 * without one, a code emailed to its address, and with 2FA its authenticator or recovery code. Then
 * the browser goes to the provider
 */
export class ProviderLinkDialog
{
	private readonly dialog = getElement('provider-link-dialog', HTMLDialogElement);
	private readonly form = getElement('provider-link-dialog-form', HTMLFormElement);
	private readonly title = getElement('provider-link-dialog-title', HTMLElement);
	private readonly intro = getElement('provider-link-dialog-intro', HTMLElement);
	private readonly email = getElement('provider-link-dialog-email', HTMLInputElement);
	private readonly passwordField = getElement('provider-link-dialog-password-field', HTMLElement);
	private readonly password = getElement('provider-link-dialog-password', HTMLInputElement);
	private readonly emailCodeLabel = getElement('provider-link-dialog-email-code-label', HTMLElement);
	private readonly emailCode = getElement('provider-link-dialog-email-code', HTMLInputElement);
	private readonly codeField = getElement('provider-link-dialog-code-field', HTMLElement);
	private readonly code = getElement('provider-link-dialog-code', HTMLInputElement);
	private readonly error = getElement('provider-link-dialog-error', HTMLElement);
	private readonly sendButton = getElement('provider-link-dialog-send', HTMLButtonElement);
	private readonly submitButton = getElement('provider-link-dialog-submit', HTMLButtonElement);
	private readonly tracker = new ChangeTracker({ root: this.form });

	/**
	 * The provider being linked, and the account it is linked to, while the dialog is open
	 */
	private provider: LoginProvider = 'google';
	private account: AccountCheck = {
		email: null,
		hasPassword: true,
		twoFactor: false
	};

	/**
	 * Whether the emailed code was sent, and whether it was found right, for an account without a password.
	 * A right code works once, so it isn't checked again when something else is wrong
	 */
	private codeSent = false;
	private codeChecked = false;

	/**
	 * @param api The auth routes
	 * @param started Called with the provider's page to send the browser to, once the link has started
	 */
	constructor(private readonly api: AuthApi, private readonly started: (url: string) => void)
	{
		this.password.maxLength = MAX_PASSWORD_LENGTH;
		this.tracker.guardDialog(this.dialog);

		for (const field of [this.password, this.emailCode, this.code])
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

		getElement('provider-link-dialog-cancel', HTMLButtonElement).addEventListener('click', () =>
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
	 * Opens the dialog
	 *
	 * @param provider The provider to link
	 * @param account What linking asks of the account
	 */
	open(provider: LoginProvider, account: AccountCheck): void
	{
		const providerName = LOGIN_PROVIDER_NAMES[provider];

		this.provider = provider;
		this.account = account;
		this.codeSent = false;
		this.codeChecked = false;
		this.title.textContent = t({
			id: 'profile.linkTitle',
			defaultMessage: 'Link a {provider} login',
			description: 'Title of the dialog on the player\'s own profile that links a Google or Discord login to their account; {provider} is Google or Discord'
		}, {
			provider: providerName
		});
		this.intro.textContent = (account.hasPassword
			? t({
				id: 'profile.linkIntroPassword',
				defaultMessage: 'To check it\'s you, enter your password. Then you\'ll go to {provider} to choose the account to link.',
				description: 'In the dialog on the player\'s own profile that links a Google or Discord login, for an account with a password; {provider} is Google or Discord'
			}, {
				provider: providerName
			})
			: t({
				id: 'profile.linkIntroCode',
				defaultMessage: 'To check it\'s you, we\'ll email a code to {email}. Then you\'ll go to {provider} to choose the account to link.',
				description: 'In the dialog on the player\'s own profile that links a Google or Discord login, for an account without a password; {email} is the account\'s address, and {provider} is Google or Discord'
			}, {
				email: (account.email ?? ''),
				provider: providerName
			}));
		this.email.value = (account.email ?? '');
		this.password.value = '';
		resetCodeInput(this.emailCode);
		this.emailCode.disabled = false;
		resetCodeInput(this.code);
		this.passwordField.hidden = !account.hasPassword;
		this.codeField.hidden = !account.twoFactor;
		this.showStep();
		clearFieldErrors(this.form);
		showMessage(this.error, undefined);
		this.tracker.markSaved();
		this.dialog.showModal();
		(account.hasPassword ? this.password : (account.twoFactor ? this.code : this.sendButton)).focus();
	}

	/**
	 * Shows the emailed code's field and the button that continues once the code was sent, or only the
	 * button that sends it before then, for an account without a password
	 */
	private showStep(): void
	{
		const sending = (!this.account.hasPassword && !this.codeSent);

		this.emailCodeLabel.hidden = (this.account.hasPassword || !this.codeSent);
		this.sendButton.hidden = !sending;
		this.submitButton.hidden = sending;
	}

	/**
	 * Sends the emailed code, or checks what was typed and goes to the provider
	 */
	private async submit(): Promise<void>
	{
		const sending = (!this.account.hasPassword && !this.codeSent);
		const button = (sending ? this.sendButton : this.submitButton);

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
				await this.sendCode();
			}
			else
			{
				await this.startLink();
			}
		}
		catch (error)
		{
			const field = authFieldOf(error);
			const input = ((field === 'password') ? this.password : ((field === 'code') ? this.emailCode : ((field === 'twoFactorCode') ? this.code : undefined)));

			if (input && (error instanceof EditorApiError))
			{
				reportFieldError(input, error.message);
			}
			else
			{
				showMessage(this.error, describeEditorError(error, {
					id: 'profile.linkFailed',
					defaultMessage: 'Could not link the login.',
					description: 'Shown on the player\'s own profile page, or in its dialog that links a Google or Discord login, when checking it\'s the player or going to Google or Discord failed'
				}));
			}
		}
		finally
		{
			button.disabled = false;
		}
	}

	/**
	 * Emails a code to the account's address, then asks for it
	 */
	private async sendCode(): Promise<void>
	{
		const email = (this.account.email ?? '');

		await this.api.sendCode({
			purpose: 'linkLogin',
			email,
			locale: currentLocale()
		});
		this.codeSent = true;
		this.intro.textContent = t({
			id: 'profile.linkCodeSent',
			defaultMessage: 'We\'ve emailed a code to {email}. Enter it to go on. It works once, for {minutes, plural, one {# minute} other {# minutes}}.',
			description: 'In the dialog on the player\'s own profile that links a Google or Discord login, once a code was sent to the account\'s address; {email} is that address'
		}, {
			email,
			minutes: EMAIL_CODE_LIFETIME_MINUTES
		});
		this.showStep();
		announce(this.intro.textContent);
		this.emailCode.focus();
	}

	/**
	 * Checks the emailed code, if the account has no password, then starts the link with the password
	 * and authenticator code, and goes to the provider
	 */
	private async startLink(): Promise<void>
	{
		if (!this.account.hasPassword && !this.codeChecked)
		{
			await this.api.checkCode({
				purpose: 'linkLogin',
				email: (this.account.email ?? ''),
				code: this.emailCode.value
			});
			this.codeChecked = true;
			this.emailCode.disabled = true;
		}

		const url = await this.api.startProviderLogin({
			provider: this.provider,
			rememberMe: false,
			link: {
				password: (this.account.hasPassword ? this.password.value : null),
				twoFactorCode: (this.account.twoFactor ? this.code.value : null),
				locale: currentLocale()
			}
		});

		this.tracker.markSaved();
		this.started(url);
	}
}
