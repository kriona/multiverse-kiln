import { EMAIL_CODE_LIFETIME_MINUTES } from '@multiverse-kiln/shared';

import { currentLocale, t } from '../localization';
import type { AuthApi } from '../network/authApi';
import { announce } from './announcer';
import { resetCodeInput } from './codeInputs';
import { setFieldError } from './fieldErrors';

/**
 * What changing an account's 2FA checks it's the player with: its password, or for an account without
 * one, a code emailed to its address
 */
export interface TwoFactorAccount
{
	/**
	 * The account's address, which tells password managers which account the password is for, and which
	 * an account without a password is sent the code at
	 */
	email: string | null;

	hasPassword: boolean;
}

/**
 * Whether an account can have 2FA: one with a password, or an address to email a code to, which
 * changing it checks it's the player with
 *
 * @param account The account
 * @return Whether it can
 */
export function canHaveTwoFactor(account: TwoFactorAccount): boolean
{
	return((account.hasPassword || (account.email !== null)));
}

/**
 * The elements of a 2FA dialog that ask for an emailed code
 */
export interface TwoFactorEmailCodeElements
{
	/**
	 * Says the code will be emailed, then that it was
	 */
	note: HTMLElement;

	/**
	 * The code's field and its label, shown once the code is sent
	 */
	label: HTMLElement;
	input: HTMLInputElement;

	/**
	 * Email me a code, shown in place of the dialog's own submit button until the code is sent
	 */
	sendButton: HTMLButtonElement;
}

/**
 * The part of the dialogs that turn 2FA on or off and make new recovery codes that checks it's the
 * player with a code emailed to the account's address (purpose 'changeTwoFactor'), for an account
 * without a password: Email me a code, then the code's field. A right code works once, so it is checked
 * only once while the dialog is open, and isn't checked again when something else is wrong
 */
export class TwoFactorEmailCode
{
	/**
	 * Where the code is sent, or null while the account has a password, which is asked for instead
	 */
	private email: string | null = null;

	private sent = false;
	private checked = false;

	/**
	 * @param api The auth routes
	 * @param elements The dialog's elements for the code
	 */
	constructor(private readonly api: AuthApi, private readonly elements: TwoFactorEmailCodeElements)
	{
		elements.input.addEventListener('input', () =>
		{
			setFieldError(elements.input, undefined);
		});
	}

	/**
	 * Whether the dialog asks for an emailed code, rather than the password
	 *
	 * @return True for an account without a password
	 */
	get asked(): boolean
	{
		return((this.email !== null));
	}

	/**
	 * Whether the code is still to be sent, so the dialog's submit button sends it
	 *
	 * @return True until the code is sent, for an account without a password
	 */
	get sending(): boolean
	{
		return((this.asked && !this.sent));
	}

	/**
	 * Starts over, as the dialog opens
	 *
	 * @param account What the dialog checks it's the player with
	 */
	reset(account: TwoFactorAccount): void
	{
		const { note, input } = this.elements;

		this.email = (account.hasPassword ? null : (account.email ?? ''));
		this.sent = false;
		this.checked = false;
		resetCodeInput(input);
		input.disabled = false;
		note.hidden = !this.asked;
		note.textContent = (this.asked
			? t({
				id: 'profile.twoFactorEmailCodeIntro',
				defaultMessage: 'To check it\'s you, we\'ll email a code to {email}.',
				description: 'In the dialogs that turn two-factor authentication on or off or make new recovery codes, for an account without a password, which logs in only with Google or Discord; {email} is the account\'s address'
			}, {
				email: (this.email ?? '')
			})
			: '');
		this.show();
	}

	/**
	 * Emails the code, then asks for it
	 */
	async send(): Promise<void>
	{
		const { note, input } = this.elements;
		const email = (this.email ?? '');

		await this.api.sendCode({
			purpose: 'changeTwoFactor',
			email,
			locale: currentLocale()
		});
		this.sent = true;
		note.textContent = t({
			id: 'profile.twoFactorEmailCodeSent',
			defaultMessage: 'We\'ve emailed a code to {email}. Enter it to go on. It works once, for {minutes, plural, one {# minute} other {# minutes}}.',
			description: 'In the dialogs that turn two-factor authentication on or off or make new recovery codes, for an account without a password, once a code was sent to the account\'s address; {email} is that address'
		}, {
			email,
			minutes: EMAIL_CODE_LIFETIME_MINUTES
		});
		this.show();
		announce(note.textContent);
		input.focus();
	}

	/**
	 * Checks the code typed, the first time the dialog's step needs it. An account with a password has
	 * nothing to check
	 */
	async check(): Promise<void>
	{
		if (!this.asked || this.checked)
		{
			return;
		}

		await this.api.checkCode({
			purpose: 'changeTwoFactor',
			email: (this.email ?? ''),
			code: this.elements.input.value
		});
		this.checked = true;
		this.elements.input.disabled = true;
	}

	/**
	 * Shows Email me a code until the code is sent, and its field after
	 */
	private show(): void
	{
		this.elements.label.hidden = (!this.asked || !this.sent);
		this.elements.sendButton.hidden = !this.sending;
	}
}
