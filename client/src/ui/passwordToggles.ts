/**
 * Makes each show password button on the page (button.password-toggle, its aria-controls naming the
 * password field) show the password as it is typed while pressed, and hide it again. Submitting the
 * field's form hides it too, so the browser and password managers see a password field when they offer
 * to save it
 */
export function startPasswordToggles(): void
{
	for (const button of document.querySelectorAll<HTMLButtonElement>('button.password-toggle'))
	{
		const field = document.getElementById(button.getAttribute('aria-controls') ?? '');

		if (!(field instanceof HTMLInputElement))
		{
			throw new Error(`Show password button ${button.id} doesn't control a field`);
		}

		button.addEventListener('click', () =>
		{
			showPassword(button, field, (field.type === 'password'));
		});

		field.form?.addEventListener('submit', () =>
		{
			showPassword(button, field, false);
		});
	}
}

/**
 * Shows or hides a password field's password
 *
 * @param button The field's show password button
 * @param field The password field
 * @param shown Whether to show the password
 */
function showPassword(button: HTMLButtonElement, field: HTMLInputElement, shown: boolean): void
{
	field.type = (shown ? 'text' : 'password');
	button.setAttribute('aria-pressed', String(shown));
}
