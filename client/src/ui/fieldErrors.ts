import { announce } from './announcer';

/**
 * A field the player fills in: one that takes typed text, or a choice
 */
type TextField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/**
 * Shows what is wrong with what was typed in a field, in a message under the field, and takes the
 * player to it: focus moves to the field, which screen readers read out with the message, or the
 * message is read out when the field has focus already
 *
 * @param field The field, which needs an ID
 * @param message What is wrong, in the player's language
 */
export function reportFieldError(field: TextField, message: string): void
{
	setFieldError(field, message);

	if (document.activeElement === field)
	{
		announce(message, true);
	}
	else
	{
		field.focus();
	}
}

/**
 * Shows or clears the message under a field saying what is wrong with it. While it shows, the field
 * is marked invalid for screen readers (aria-invalid), describes itself with the message
 * (aria-describedby), and stops its form being submitted (setCustomValidity)
 *
 * The message goes after the field's label when the label wraps the field, since text inside a label
 * becomes part of the field's name. A page can give a field a message line of its own instead, with
 * the ID `<field ID>-error` and the class field-message-slot, which keeps its space while empty so the
 * page doesn't move as messages come and go (see setFieldSuccess())
 *
 * @param field The field, which needs an ID
 * @param message What is wrong, or undefined to clear it
 */
export function setFieldError(field: TextField, message: string | undefined): void
{
	const errorId = `${field.id}-error`;
	const describedBy = (field.getAttribute('aria-describedby') ?? '')
		.split(' ')
		.filter((id) => ((id !== '') && (id !== errorId)));
	let error = document.getElementById(errorId);

	field.setCustomValidity((message ?? ''));
	error?.classList.remove('field-success');

	if (message === undefined)
	{
		if (error?.classList.contains('field-message-slot'))
		{
			error.textContent = '';
		}
		else
		{
			error?.remove();
		}

		field.removeAttribute('aria-invalid');
		setDescribedBy(field, describedBy);
		return;
	}

	if (!error)
	{
		error = document.createElement('p');
		error.id = errorId;
		error.className = 'field-error';
		// A password field's label shares a row with its show password button (see passwordToggles.ts)
		(field.closest('.password-field') ?? field.closest('label') ?? field).after(error);
	}

	error.textContent = message;
	field.setAttribute('aria-invalid', 'true');
	setDescribedBy(field, [...describedBy, errorId]);
}

/**
 * Shows that what was typed in a field is fine, such as a username no one has, in the field's message
 * line (a field-message-slot; see setFieldError()), and reads it out. Typing in the field, or an error,
 * replaces it
 *
 * @param field The field, which has a message line
 * @param message What is fine, in the player's language
 */
export function setFieldSuccess(field: TextField, message: string): void
{
	setFieldError(field, undefined);

	const line = document.getElementById(`${field.id}-error`);

	if (line)
	{
		line.textContent = message;
		line.classList.add('field-success');
		announce(message);
	}
}

/**
 * Clears the messages of every field in a form or dialog, for when it opens again
 *
 * @param container The form or dialog
 */
export function clearFieldErrors(container: HTMLElement): void
{
	for (const field of container.querySelectorAll<TextField>('input[aria-invalid], textarea[aria-invalid], select[aria-invalid]'))
	{
		setFieldError(field, undefined);
	}

	for (const line of container.querySelectorAll('.field-message-slot'))
	{
		line.textContent = '';
		line.classList.remove('field-success');
	}
}

/**
 * Sets the elements that describe a field
 *
 * @param field The field
 * @param ids The elements' IDs, removing the attribute when there are none
 */
function setDescribedBy(field: TextField, ids: readonly string[]): void
{
	if (ids.length > 0)
	{
		field.setAttribute('aria-describedby', ids.join(' '));
	}
	else
	{
		field.removeAttribute('aria-describedby');
	}
}
