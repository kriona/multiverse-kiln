import { SITE_NAME } from '@multiverse-kiln/shared';

import { t } from '../localization';
import { announce } from './announcer';
import { getElement } from './dom';

/**
 * The dialog that shows the player's new recovery codes for 2FA (profile.html), the only time they are
 * shown: after turning 2FA on, and after making new ones. The player can copy them or save them as a
 * text file
 */
export class RecoveryCodesDialog
{
	private readonly dialog = getElement('recovery-codes-dialog', HTMLDialogElement);
	private readonly list = getElement('recovery-codes-list', HTMLOListElement);
	private readonly status = getElement('recovery-codes-status', HTMLElement);

	/**
	 * The codes shown
	 */
	private codes: string[] = [];

	/**
	 * The player's username, which the saved file names
	 */
	private username = '';

	/**
	 * Sets up the dialog's buttons
	 */
	constructor()
	{
		getElement('recovery-codes-copy', HTMLButtonElement).addEventListener('click', () =>
		{
			void this.copy();
		});

		getElement('recovery-codes-download', HTMLButtonElement).addEventListener('click', () =>
		{
			this.download();
		});

		getElement('recovery-codes-done', HTMLButtonElement).addEventListener('click', () =>
		{
			this.dialog.close();
		});

		this.dialog.addEventListener('close', () =>
		{
			// Not left in the page once the dialog closes
			this.codes = [];
			this.list.replaceChildren();
		});
	}

	/**
	 * Shows the codes
	 *
	 * @param codes The codes
	 * @param username The player's username
	 */
	open(codes: readonly string[], username: string): void
	{
		this.codes = [...codes];
		this.username = username;
		this.status.textContent = '';
		this.list.replaceChildren(...codes.map((code) =>
		{
			const item = document.createElement('li');

			item.textContent = code;

			return(item);
		}));
		this.dialog.showModal();
		getElement('recovery-codes-done', HTMLButtonElement).focus();
	}

	/**
	 * The codes as text, one to a line, under a line saying what they are
	 *
	 * @return The text
	 */
	private text(): string
	{
		const heading = t({
			id: 'profile.recoveryCodesFileHeading',
			defaultMessage: 'Recovery codes for {username} on {siteName}. Each works once.',
			description: 'First line of the text copied or saved from the dialog showing the player\'s new recovery codes, above the codes; {username} is the player\'s username and {siteName} the site\'s name'
		}, {
			username: this.username,
			siteName: SITE_NAME
		});

		return(`${heading}\r\n\r\n${this.codes.join('\r\n')}\r\n`);
	}

	/**
	 * Copies the codes to the clipboard, or says to copy them by hand when the browser won't allow that
	 */
	private async copy(): Promise<void>
	{
		try
		{
			await navigator.clipboard.writeText(this.text());
			this.status.textContent = t({
				id: 'profile.recoveryCodesCopied',
				defaultMessage: 'Codes copied.',
				description: 'Shown in the dialog with the player\'s new recovery codes once Copy has copied them to the clipboard'
			});
		}
		catch (error)
		{
			console.warn('Could not copy the recovery codes:', error);
			this.status.textContent = t({
				id: 'profile.recoveryCodesCopyFailed',
				defaultMessage: 'Your browser didn\'t allow copying. Select the codes and copy them yourself.',
				description: 'Shown in the dialog with the player\'s new recovery codes when the browser refused to copy them'
			});
		}

		announce(this.status.textContent);
	}

	/**
	 * Saves the codes as a text file. The file is made in the browser, so the codes go nowhere else
	 */
	private download(): void
	{
		const url = URL.createObjectURL(new Blob([this.text()], { type: 'text/plain;charset=utf-8' }));
		const link = document.createElement('a');

		link.href = url;
		link.download = `${SITE_NAME} recovery codes (${this.username}).txt`;
		link.click();
		URL.revokeObjectURL(url);
	}
}
