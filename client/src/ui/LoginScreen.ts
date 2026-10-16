import { DISALLOWED_TEXT_CHARACTERS, MAX_PLAYER_NAME_LENGTH } from '@multiverse-kiln/shared';

import { t } from '../localization';
import { getElement } from './dom';
import { reportFieldError, setFieldError } from './fieldErrors';

/**
 * The login screen: the player types their name
 */
export class LoginScreen
{
	private readonly form = getElement('login-form', HTMLFormElement);
	private readonly nameInput = getElement('login-name', HTMLInputElement);
	private readonly submitButton = getElement('login-submit', HTMLButtonElement);

	/**
	 * @param onLogin Called with the trimmed name when the player submits a valid one
	 */
	constructor(onLogin: (name: string) => void)
	{
		this.nameInput.maxLength = MAX_PLAYER_NAME_LENGTH;

		this.nameInput.addEventListener('input', () =>
		{
			setFieldError(this.nameInput, undefined);
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();

			const name = this.nameInput.value.trim();

			if ((name === '') || DISALLOWED_TEXT_CHARACTERS.test(name))
			{
				reportFieldError(this.nameInput, t({
					id: 'login.invalidName',
					defaultMessage: 'Enter a name of letters, numbers, spaces or punctuation.',
					description: 'Shown by the login field when the name typed is empty or has characters that aren\'t allowed'
				}));
				return;
			}

			// Stays disabled until the server answers, which hides this screen
			this.submitButton.disabled = true;
			onLogin(name);
		});
	}

	/**
	 * Gets the screen ready to be shown
	 */
	reset(): void
	{
		this.submitButton.disabled = false;
		setFieldError(this.nameInput, undefined);
		this.nameInput.focus();
	}

	/**
	 * Explains why the server didn't log the player in, and lets them try again
	 *
	 * @param message What went wrong
	 */
	showError(message: string): void
	{
		this.reset();
		reportFieldError(this.nameInput, message);
	}
}
