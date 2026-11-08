import { MAX_PASSWORD_LENGTH } from '@multiverse-kiln/shared';

import { currentLocale, formatList, t } from '../localization';
import { authFieldOf, type AuthApi } from '../network/authApi';
import { describeEditorError, EditorApiError } from '../network/editorApi';
import { ChangeTracker } from './changeTracker';
import { resetCodeInput } from './codeInputs';
import { getElement, showMessage } from './dom';
import { clearFieldErrors, reportFieldError, setFieldError } from './fieldErrors';
import { TwoFactorEmailCode, type TwoFactorAccount } from './TwoFactorEmailCode';

/**
 * What the dialog changes: turning 2FA off, or making new recovery codes
 */
export type TwoFactorChange = 'turnOff' | 'newCodes';

/**
 * The dialog that turns off 2FA or makes new recovery codes (profile.html), each of which needs the
 * player's password, or for an account without one, a code emailed to its address, and an
 * authenticator or recovery code
 */
export class TwoFactorConfirmDialog
{
	private readonly dialog = getElement('two-factor-confirm-dialog', HTMLDialogElement);
	private readonly form = getElement('two-factor-confirm-form', HTMLFormElement);
	private readonly title = getElement('two-factor-confirm-title', HTMLElement);
	private readonly intro = getElement('two-factor-confirm-intro', HTMLElement);
	private readonly universes = getElement('two-factor-confirm-universes', HTMLElement);
	private readonly email = getElement('two-factor-confirm-email', HTMLInputElement);
	private readonly passwordField = getElement('two-factor-confirm-password-field', HTMLElement);
	private readonly password = getElement('two-factor-confirm-password', HTMLInputElement);
	private readonly emailCodeInput = getElement('two-factor-confirm-email-code', HTMLInputElement);
	private readonly code = getElement('two-factor-confirm-code', HTMLInputElement);
	private readonly error = getElement('two-factor-confirm-error', HTMLElement);
	private readonly sendButton = getElement('two-factor-confirm-send', HTMLButtonElement);
	private readonly offButton = getElement('two-factor-confirm-off', HTMLButtonElement);
	private readonly codesButton = getElement('two-factor-confirm-codes', HTMLButtonElement);
	private readonly tracker = new ChangeTracker({ root: this.form });
	private readonly emailCode: TwoFactorEmailCode;

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
		this.emailCode = new TwoFactorEmailCode(api, {
			note: getElement('two-factor-confirm-email-note', HTMLElement),
			label: getElement('two-factor-confirm-email-code-label', HTMLElement),
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
	 * @param account The account's address, and whether it has a password
	 * @param serverAdmin Whether the player is a server admin, who is warned that turning 2FA off takes away the admin pages
	 * @param universes The names of the universes the player edits that require 2FA, which turning it off keeps them from saving to
	 */
	open(change: TwoFactorChange, account: TwoFactorAccount, serverAdmin: boolean, universes: readonly string[]): void
	{
		this.change = change;
		showMessage(this.universes, undefined);

		if (change === 'turnOff')
		{
			this.title.textContent = t({
				id: 'profile.twoFactorDisableTitle',
				defaultMessage: 'Turn off two-factor authentication',
				description: 'Title of the dialog that turns off two-factor authentication'
			});
			this.intro.textContent = this.turnOffIntro(account.hasPassword, serverAdmin);

			if (universes.length > 0)
			{
				showMessage(this.universes, t({
					id: 'profile.twoFactorDisableUniverses',
					defaultMessage: '{count, plural, one {{universes} requires its editors to have it on, so you won\'t be able to save changes to it until you turn it back on.} other {{universes} require their editors to have it on, so you won\'t be able to save changes to them until you turn it back on.}}',
					description: 'In the dialog that turns off two-factor authentication, after what turning it off means, for a player with a role in universes whose creators require their editors to have it on; {universes} is a list of their names, {count} how many there are'
				}, {
					count: universes.length,
					universes: formatList(universes, 'conjunction')
				}));
			}
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

		this.passwordField.hidden = !account.hasPassword;
		this.email.value = (account.email ?? '');
		this.password.value = '';
		this.emailCode.reset(account);
		this.showButtons();
		resetCodeInput(this.code);
		clearFieldErrors(this.form);
		showMessage(this.error, undefined);
		this.tracker.markSaved();
		this.dialog.showModal();
		(account.hasPassword ? this.password : this.sendButton).focus();
	}

	/**
	 * What turning 2FA off means for the account
	 *
	 * @param hasPassword Whether the account has a password, or logs in only with Google or Discord
	 * @param serverAdmin Whether the player is a server admin, who is warned that it takes away the admin pages
	 * @return The dialog's first paragraph
	 */
	private turnOffIntro(hasPassword: boolean, serverAdmin: boolean): string
	{
		if (!hasPassword)
		{
			return((serverAdmin
				? t({
					id: 'profile.twoFactorDisableIntroProviderAdmin',
					defaultMessage: 'Logging in with Google or Discord won\'t ask for a code from the app any more. Your recovery codes stop working, and every trusted browser is forgotten. You are one of the site\'s admins: you won\'t be able to use the admin pages until you turn it back on.',
					description: 'In the dialog that turns off two-factor authentication, for one of the site\'s admins whose account has no password (it logs in only with Google or Discord); admins need it on to use the admin pages'
				})
				: t({
					id: 'profile.twoFactorDisableIntroProvider',
					defaultMessage: 'Logging in with Google or Discord won\'t ask for a code from the app any more. Your recovery codes stop working, and every trusted browser is forgotten.',
					description: 'In the dialog that turns off two-factor authentication, for an account without a password, which logs in only with Google or Discord'
				})));
		}

		return((serverAdmin
			? t({
				id: 'profile.twoFactorDisableIntroAdmin',
				defaultMessage: 'Logging in will need only your password again. Your recovery codes stop working, and every trusted browser is forgotten. You are one of the site\'s admins: you won\'t be able to use the admin pages until you turn it back on.',
				description: 'In the dialog that turns off two-factor authentication, for one of the site\'s admins, who need it on to use the admin pages'
			})
			: t({
				id: 'profile.twoFactorDisableIntro',
				defaultMessage: 'Logging in will need only your password again. Your recovery codes stop working, and every trusted browser is forgotten.',
				description: 'In the dialog that turns off two-factor authentication'
			})));
	}

	/**
	 * Shows the button that makes the change, or Email me a code in its place until the code is sent,
	 * for an account without a password
	 */
	private showButtons(): void
	{
		this.sendButton.hidden = !this.emailCode.sending;
		this.offButton.hidden = ((this.change !== 'turnOff') || this.emailCode.sending);
		this.codesButton.hidden = ((this.change !== 'newCodes') || this.emailCode.sending);
	}

	/**
	 * Emails a code, or turns 2FA off or makes new recovery codes, with the password (or the emailed
	 * code) and authenticator code typed
	 */
	private async submit(): Promise<void>
	{
		const sending = this.emailCode.sending;
		const button = (sending ? this.sendButton : ((this.change === 'turnOff') ? this.offButton : this.codesButton));

		if (button.disabled)
		{
			return;
		}

		button.disabled = true;
		showMessage(this.error, undefined);

		try
		{
			const password = (this.emailCode.asked ? null : this.password.value);

			if (sending)
			{
				await this.emailCode.send();
				this.showButtons();
			}
			else if (this.change === 'turnOff')
			{
				await this.emailCode.check();
				await this.api.disableTwoFactor({
					password,
					code: this.code.value,
					locale: currentLocale()
				});
				this.tracker.markSaved();
				this.dialog.close();
				this.turnedOff();
			}
			else
			{
				await this.emailCode.check();

				const codes = await this.api.replaceRecoveryCodes({
					password,
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
			const input = ((field === 'password') ? this.password : ((field === 'code') ? this.emailCodeInput : ((field === 'twoFactorCode') ? this.code : undefined)));

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
