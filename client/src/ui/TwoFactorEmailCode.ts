import { defineMessages, EMAIL_CODE_LIFETIME_MINUTES, type EmailCodePurpose, type MessageDescriptor } from '@multiverse-kiln/shared';

import { currentLocale, t } from '../localization';
import type { AuthApi } from '../network/authApi';
import { announce } from './announcer';
import { resetCodeInput } from './codeInputs';
import { setFieldError } from './fieldErrors';

/**
 * What changing an account's 2FA, or deleting a universe, checks it's the player with: its password, or
 * for an account without one, a code emailed to its address
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
 * What a dialog emails a code for, and what it says about the code
 */
export interface EmailCodeUse
{
	purpose: EmailCodePurpose;

	/**
	 * Says the code will be emailed, taking the address as {email}
	 */
	intro: MessageDescriptor;

	/**
	 * Says it was, taking the address as {email} and how many minutes it works for as {minutes}
	 */
	sent: MessageDescriptor;
}

/**
 * The code that turning 2FA on or off and making new recovery codes email
 */
const CHANGE_TWO_FACTOR: EmailCodeUse = {
	purpose: 'changeTwoFactor',
	...defineMessages({
		intro: {
			id: 'profile.twoFactorEmailCodeIntro',
			defaultMessage: 'To check it\'s you, we\'ll email a code to {email}.',
			description: 'In the dialogs that turn two-factor authentication on or off or make new recovery codes, for an account without a password, which logs in only with Google or Discord; {email} is the account\'s address'
		},
		sent: {
			id: 'profile.twoFactorEmailCodeSent',
			defaultMessage: 'We\'ve emailed a code to {email}. Enter it to go on. It works once, for {minutes, plural, one {# minute} other {# minutes}}.',
			description: 'In the dialogs that turn two-factor authentication on or off or make new recovery codes, for an account without a password, once a code was sent to the account\'s address; {email} is that address'
		}
	})
};

/**
 * The part of a dialog that checks it's the player with a code emailed to the account's address, for an
 * account without a password: Email me a code, then the code's field. The dialogs that turn 2FA on or
 * off and make new recovery codes use it (purpose 'changeTwoFactor'), and so does deleting a universe. A
 * right code works once, so it is checked only once while the dialog is open, and isn't checked again
 * when something else is wrong
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
	 * @param use What the code is for, and what the dialog says about it: changing 2FA when left out
	 */
	constructor(private readonly api: AuthApi, private readonly elements: TwoFactorEmailCodeElements, private readonly use: EmailCodeUse = CHANGE_TWO_FACTOR)
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
			? t(this.use.intro, {
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
			purpose: this.use.purpose,
			email,
			locale: currentLocale()
		});
		this.sent = true;
		note.textContent = t(this.use.sent, {
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
			purpose: this.use.purpose,
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
