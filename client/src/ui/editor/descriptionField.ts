import { DISALLOWED_TEXT_CHARACTERS } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';

/**
 * The description field of the item, race, class and theme editors: a sentence or two, written as one paragraph.
 * A default's field starts with the engine's description, which it shows as its placeholder once emptied
 */
export class DescriptionField
{
	/**
	 * The engine's description of the default being edited, or an empty string for something the
	 * universe added
	 */
	private engineDescription = '';

	/**
	 * @param field The field
	 * @param maxLength Most characters the description may have
	 */
	constructor(readonly field: HTMLTextAreaElement, maxLength: number)
	{
		field.maxLength = maxLength;
		field.addEventListener('input', () =>
		{
			setFieldError(field, undefined);
		});

		// A description is one paragraph, so Enter doesn't start a new line; while an input method is
		// composing, Enter confirms the composition instead
		field.addEventListener('keydown', (event) =>
		{
			if ((event.key === 'Enter') && !event.isComposing)
			{
				event.preventDefault();
			}
		});
	}

	/**
	 * Shows a description
	 *
	 * @param description The description as players read it, or an empty string for none
	 * @param engineDescription The engine's description of the default being edited, or an empty string
	 * for something the universe added
	 */
	show(description: string, engineDescription: string): void
	{
		this.engineDescription = engineDescription;
		this.field.value = description;
		this.field.placeholder = engineDescription;
	}

	/**
	 * The description the field holds, reporting one with characters that aren't allowed
	 *
	 * @return The description, null to keep the engine's (an emptied field, or one left as the engine
	 * wrote it) or for none, or undefined when it can't be saved
	 */
	read(): string | null | undefined
	{
		const description = this.field.value.replace(/\s*[\r\n]+\s*/g, ' ').trim();

		if (DISALLOWED_TEXT_CHARACTERS.test(description))
		{
			reportFieldError(this.field, t(formMessages.invalidText));
			return(undefined);
		}

		return((((description === '') || (description === this.engineDescription)) ? null : description));
	}
}
