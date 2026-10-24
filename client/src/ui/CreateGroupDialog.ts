import { DISALLOWED_TEXT_CHARACTERS, MAX_GROUP_NAME_LENGTH, type CharacterSummary, type DifficultyLevel } from '@multiverse-kiln/shared';

import { t } from '../localization';
import { describeEditorError } from '../network/editorApi';
import type { GroupApi } from '../network/groupApi';
import { ChangeTracker } from './changeTracker';
import { describeMobScale, difficultyName } from './difficultyNames';
import { getElement, setOptions, showMessage } from './dom';
import { clearFieldErrors, reportFieldError } from './fieldErrors';

/**
 * The Create Group dialog (partials/group-dialogs.html): explains that the character the player is
 * playing becomes the group's anchor being, asks for an optional name and a difficulty level, and makes
 * the group
 */
export class CreateGroupDialog
{
	private readonly dialog = getElement('create-group-dialog', HTMLDialogElement);
	private readonly form = getElement('create-group-form', HTMLFormElement);
	private readonly explanation = getElement('create-group-explanation', HTMLElement);
	private readonly nameInput = getElement('create-group-name', HTMLInputElement);
	private readonly difficulty = getElement('create-group-difficulty', HTMLSelectElement);
	private readonly difficultySummary = getElement('create-group-difficulty-summary', HTMLElement);
	private readonly permadeath = getElement('create-group-permadeath', HTMLElement);
	private readonly error = getElement('create-group-error', HTMLElement);
	private readonly submitButton = getElement('create-group-submit', HTMLButtonElement);
	private readonly tracker = new ChangeTracker({ root: this.form });

	/**
	 * The universe and the anchor being, while the dialog is open
	 */
	private current: { universeId: string; character: CharacterSummary } | undefined;

	/**
	 * The universe's difficulty levels, once they have loaded
	 */
	private levels: DifficultyLevel[] = [];

	/**
	 * Changes every time the dialog opens, so levels that arrive for an earlier opening are ignored
	 */
	private openVersion = 0;

	/**
	 * @param api The group routes
	 * @param created Called with the new group's ID and its anchor being once it is made
	 */
	constructor(private readonly api: GroupApi, private readonly created: (groupId: string, characterId: string) => void)
	{
		this.nameInput.maxLength = MAX_GROUP_NAME_LENGTH;
		this.tracker.guardDialog(this.dialog);

		this.difficulty.addEventListener('change', () =>
		{
			this.describeLevel();
		});

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
		this.levels = [];
		this.difficulty.replaceChildren();
		this.difficulty.disabled = true;
		this.describeLevel();
		this.submitButton.disabled = true;
		clearFieldErrors(this.form);
		showMessage(this.error, undefined);
		this.tracker.markSaved();
		this.dialog.showModal();
		this.nameInput.focus();
		void this.loadLevels(universeId);
	}

	/**
	 * Loads the universe's difficulty levels into the choice, starting on the default
	 *
	 * @param universeId The universe's ID
	 */
	private async loadLevels(universeId: string): Promise<void>
	{
		const version = ++this.openVersion;
		let levels: DifficultyLevel[];

		try
		{
			levels = await this.api.listDifficultyLevels(universeId);
		}
		catch (error)
		{
			if (version === this.openVersion)
			{
				showMessage(this.error, describeEditorError(error, {
					id: 'createGroup.difficultyFailed',
					defaultMessage: 'Could not load the difficulty levels.',
					description: 'Shown in the Create Group dialog when the difficulty levels to choose from couldn\'t be loaded'
				}));
			}

			return;
		}

		if ((version !== this.openVersion) || !this.current)
		{
			return;
		}

		this.levels = levels;
		setOptions(this.difficulty, levels.map((level) => ({
			value: String(level.id),
			label: difficultyName(level)
		})));
		this.difficulty.value = String(levels.find((level) => level.isDefault)?.id ?? levels[0]?.id ?? '');
		this.difficulty.disabled = false;
		this.submitButton.disabled = false;
		this.describeLevel();
		// The default level chosen isn't a change of the player's
		this.tracker.markSaved();
	}

	/**
	 * Shows what the chosen difficulty level does
	 */
	private describeLevel(): void
	{
		const level = this.chosenLevel();

		this.difficultySummary.textContent = ((level === undefined) ? '' : describeMobScale(level.mobScale));
		this.permadeath.hidden = !level?.permadeath;
		// A hidden warning would still be read out if the choice pointed at it
		this.difficulty.setAttribute('aria-describedby', (this.permadeath.hidden ? this.difficultySummary.id : `${this.difficultySummary.id} ${this.permadeath.id}`));
	}

	/**
	 * The difficulty level chosen
	 *
	 * @return The level, or undefined before the levels have loaded
	 */
	private chosenLevel(): DifficultyLevel | undefined
	{
		return(this.levels.find((level) => (String(level.id) === this.difficulty.value)));
	}

	/**
	 * Makes the group, then closes the dialog and goes into it
	 */
	private async submit(): Promise<void>
	{
		const current = this.current;
		const name = this.nameInput.value.trim();
		const level = this.chosenLevel();

		if (!current || !level || this.submitButton.disabled)
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
			const groupId = await this.api.createGroup(current.universeId, {
				characterId: current.character.id,
				name,
				difficultyLevelId: level.id
			});

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
