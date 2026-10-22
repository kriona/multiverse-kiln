import { DISALLOWED_TEXT_CHARACTERS, MAX_GROUP_NAME_LENGTH, type CharacterSummary } from '@multiverse-kiln/shared';

import { t } from '../localization';
import { describeEditorError } from '../network/editorApi';
import type { GroupApi } from '../network/groupApi';
import { ChangeTracker } from './changeTracker';
import { getElement, showMessage } from './dom';
import { clearFieldErrors, reportFieldError } from './fieldErrors';

/**
 * The Create Group dialog (partials/group-dialogs.html): explains that the character the player is
 * playing becomes the group's anchor being, asks for an optional name, and makes the group
 */
export class CreateGroupDialog
{
	private readonly dialog = getElement('create-group-dialog', HTMLDialogElement);
	private readonly form = getElement('create-group-form', HTMLFormElement);
	private readonly explanation = getElement('create-group-explanation', HTMLElement);
	private readonly nameInput = getElement('create-group-name', HTMLInputElement);
	private readonly error = getElement('create-group-error', HTMLElement);
	private readonly submitButton = getElement('create-group-submit', HTMLButtonElement);
	private readonly tracker = new ChangeTracker({ root: this.form });

	/**
	 * The universe and the anchor being, while the dialog is open
	 */
	private current: { universeId: string; character: CharacterSummary } | undefined;

	/**
	 * @param api The group routes
	 * @param created Called with the new group's ID and its anchor being once it is made
	 */
	constructor(private readonly api: GroupApi, private readonly created: (groupId: string, characterId: string) => void)
	{
		this.nameInput.maxLength = MAX_GROUP_NAME_LENGTH;
		this.tracker.guardDialog(this.dialog);

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.submit();
		});

		getElement('create-group-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			if (this.tracker.confirmDiscard())
			{
				this.dialog.close();
			}
		});

		this.dialog.addEventListener('close', () =>
		{
			this.current = undefined;
		});
	}

	/**
	 * Opens the dialog to make a group around a character
	 *
	 * @param universeId The universe's ID
	 * @param character The anchor being
	 */
	open(universeId: string, character: CharacterSummary): void
	{
		this.current = { universeId, character };
		this.explanation.textContent = t({
			id: 'createGroup.explanation',
			defaultMessage: '{name} will be the group\'s anchor being: the game centers around them. Only {name} can invite others. If {name} leaves the group, it will be disbanded; though every character keeps their items and money.',
			description: 'In the Create Group dialog, what being the anchor being means; {name} is the name of the character the player is playing, who the group is made around'
		}, {
			name: character.name
		});
		this.nameInput.value = '';
		this.submitButton.disabled = false;
		clearFieldErrors(this.form);
		showMessage(this.error, undefined);
		this.tracker.markSaved();
		this.dialog.showModal();
		this.nameInput.focus();
	}

	/**
	 * Makes the group, then closes the dialog and goes into it
	 */
	private async submit(): Promise<void>
	{
		const current = this.current;
		const name = this.nameInput.value.trim();

		if (!current || this.submitButton.disabled)
		{
			return;
		}

		if (DISALLOWED_TEXT_CHARACTERS.test(name))
		{
			reportFieldError(this.nameInput, t({
				id: 'createGroup.nameInvalid',
				defaultMessage: 'The name has characters that aren\'t allowed.',
				description: 'Under the group name field when the name holds control characters or other characters that could make text display wrongly'
			}));
			return;
		}

		this.submitButton.disabled = true;
		showMessage(this.error, undefined);

		try
		{
			const groupId = await this.api.createGroup(current.universeId, { characterId: current.character.id, name });

			this.tracker.markSaved();
			this.dialog.close();
			this.created(groupId, current.character.id);
		}
		catch (error)
		{
			this.submitButton.disabled = false;
			showMessage(this.error, describeEditorError(error, {
				id: 'createGroup.failed',
				defaultMessage: 'Could not create the group.',
				description: 'Shown in the Create Group dialog when the group couldn\'t be made'
			}));
		}
	}
}
