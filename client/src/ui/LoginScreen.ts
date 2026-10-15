import { DISALLOWED_TEXT_CHARACTERS, MAX_PLAYER_NAME_LENGTH } from '@multiverse-kiln/shared';

import { getElement } from './dom';

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
			this.nameInput.setCustomValidity('');
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();

			const name = this.nameInput.value.trim();

			if ((name === '') || DISALLOWED_TEXT_CHARACTERS.test(name))
			{
				this.nameInput.setCustomValidity('Enter a name of letters, numbers, spaces or punctuation.');
				this.nameInput.reportValidity();
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
		this.nameInput.focus();
	}
}
