import { canEditUniverseSettings, DIFFICULTY_LEVEL_NAMES, DISALLOWED_TEXT_CHARACTERS, MAX_DIFFICULTY_NAME_LENGTH, MAX_MOB_SCALE, MIN_MOB_SCALE, MIN_SCALED_HIT_CHANCE, type DifficultyLevel, type DifficultyLevelSettings, type EditableUniverse, type MessageDescriptor } from '@multiverse-kiln/shared';
import trashIcon from 'virtual:icon/ph:trash';

import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { ChangeTracker } from '../changeTracker';
import { difficultyName } from '../difficultyNames';
import { getElement, setButtonLabel, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';

/**
 * The difficulty level editor: a dialog for a level's name, whether it is the default, how much it
 * changes mobs, and whether death is permanent. It can also delete a level that isn't the default
 */
export class DifficultyDialog
{
	private readonly dialog = getElement('difficulty-dialog', HTMLDialogElement);
	private readonly form = getElement('difficulty-form', HTMLFormElement);
	private readonly fields = getElement('difficulty-fields', HTMLFieldSetElement);
	private readonly title = getElement('difficulty-dialog-title', HTMLElement);
	private readonly isDefault = getElement('difficulty-default', HTMLInputElement);
	private readonly name = getElement('difficulty-name', HTMLInputElement);
	private readonly mobScale = getElement('difficulty-mob-scale', HTMLInputElement);
	private readonly permadeath = getElement('difficulty-permadeath', HTMLInputElement);
	private readonly error = getElement('difficulty-error', HTMLElement);
	private readonly removeButton = getElement('difficulty-remove', HTMLButtonElement);
	private readonly cancelButton = getElement('difficulty-cancel', HTMLButtonElement);
	private readonly saveButton = getElement('difficulty-save', HTMLButtonElement);

	/**
	 * Whether the level has changes that haven't been saved
	 */
	private readonly changes: ChangeTracker;

	private universe: EditableUniverse | undefined;

	/**
	 * The level being edited, or undefined for a new one
	 */
	private level: DifficultyLevel | undefined;

	/**
	 * Called after the level is saved or deleted
	 */
	private onChanged: () => void = () => undefined;

	/**
	 * @param api The editor's API
	 */
	constructor(private readonly api: EditorApi)
	{
		this.name.maxLength = MAX_DIFFICULTY_NAME_LENGTH;
		this.mobScale.min = String(MIN_MOB_SCALE);
		this.mobScale.max = String(MAX_MOB_SCALE);
		getElement('difficulty-mob-scale-hint', HTMLElement).textContent = t({
			id: 'editor.difficultyLevel.mobScaleHint',
			defaultMessage: 'How much harder mobs are, from {min, number}% (easier) to {max, number}% (harder); 0 leaves them as the universe made them. It scales their hit points (never below 1) and how often they hit and are hit (a chance to hit of at least {floor, number}% stays at least {floor, number}%).',
			description: 'Explains the difficulty level editor\'s Mob scale field; {min} and {max} are the lowest and highest percentages allowed, e.g. -1000 and 1000, and {floor} is the lowest a chance to hit can be brought down to, e.g. 5'
		}, {
			min: MIN_MOB_SCALE,
			max: MAX_MOB_SCALE,
			floor: MIN_SCALED_HIT_CHANCE
		});
		this.changes = new ChangeTracker({ root: this.form });
		this.changes.guardDialog(this.dialog);

		for (const input of [this.name, this.mobScale])
		{
			input.addEventListener('input', () =>
			{
				setFieldError(input, undefined);
			});
		}

		this.cancelButton.addEventListener('click', () =>
		{
			if (this.changes.confirmDiscard())
			{
				this.dialog.close();
			}
		});

		this.removeButton.addEventListener('click', () =>
		{
			void this.remove();
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.save();
		});
	}

	/**
	 * Opens the dialog for a level, or for a new one
	 *
	 * @param universe The universe the level belongs to
	 * @param level The level, or undefined to add one
	 * @param onChanged Called after the level is saved or deleted
	 */
	open(universe: EditableUniverse, level: DifficultyLevel | undefined, onChanged: () => void): void
	{
		const editable = canEditUniverseSettings(universe.role);
		const name = (level ? difficultyName(level) : '');

		this.universe = universe;
		this.level = level;
		this.onChanged = onChanged;

		if (!level)
		{
			this.title.textContent = t({
				id: 'editor.difficultyLevel.addTitle',
				defaultMessage: 'Add Difficulty',
				description: 'Title of the difficulty level editor when making a new level'
			});
		}
		else if (editable)
		{
			this.title.textContent = t({
				id: 'editor.difficultyLevel.editTitle',
				defaultMessage: 'Edit {level}',
				description: 'Title of the difficulty level editor for a level the player can change; {level} is its name, e.g. Hard'
			}, {
				level: name
			});
		}
		else
		{
			this.title.textContent = name;
		}

		this.name.value = name;
		this.isDefault.checked = (level?.isDefault ?? false);
		this.mobScale.value = String(level?.mobScale ?? 0);
		this.permadeath.checked = (level?.permadeath ?? false);
		this.fields.disabled = false;
		this.saveButton.hidden = !editable;
		this.saveButton.disabled = false;
		this.cancelButton.textContent = t(editable ? formMessages.cancel : formMessages.close);

		// Only the inputs are locked for a player who can't edit, so Close still works
		for (const input of [this.name, this.mobScale, this.permadeath])
		{
			input.disabled = !editable;
		}

		// The default stops being it only when another level becomes the default
		this.isDefault.disabled = (!editable || (level?.isDefault ?? false));
		this.removeButton.hidden = (!editable || !level || level.isDefault);
		setButtonLabel(this.removeButton, trashIcon, t({
			id: 'editor.difficultyLevel.delete',
			defaultMessage: 'Delete Difficulty',
			description: 'Button in the difficulty level editor that deletes the level'
		}));

		showMessage(this.error, undefined);
		clearFieldErrors(this.dialog);
		this.dialog.showModal();
		this.changes.markSaved();
	}

	/**
	 * Saves the level as the form shows it
	 */
	private async save(): Promise<void>
	{
		const universe = this.universe;
		const name = this.name.value.trim();
		const mobScale = Number(this.mobScale.value);

		if (!universe)
		{
			return;
		}

		if ((name === '') || DISALLOWED_TEXT_CHARACTERS.test(name))
		{
			reportFieldError(this.name, t(formMessages.invalidText));
			return;
		}

		if ((this.mobScale.value.trim() === '') || !Number.isInteger(mobScale) || (mobScale < MIN_MOB_SCALE) || (mobScale > MAX_MOB_SCALE))
		{
			reportFieldError(this.mobScale, t(formMessages.wholeNumber, {
				min: MIN_MOB_SCALE,
				max: MAX_MOB_SCALE
			}));
			return;
		}

		// A default level whose name wasn't changed keeps it, so players read it in their own language
		const key = (this.level?.key ?? null);
		const defaultMessage = ((key === null) ? undefined : DIFFICULTY_LEVEL_NAMES[key]);
		const settings: DifficultyLevelSettings = {
			name: (((defaultMessage !== undefined) && (name === t(defaultMessage))) ? null : name),
			isDefault: this.isDefault.checked,
			mobScale,
			permadeath: this.permadeath.checked
		};

		await this.run({
			id: 'editor.difficultyLevel.saveFailed',
			defaultMessage: 'Could not save the difficulty level.',
			description: 'Shown in the difficulty level editor when the level couldn\'t be stored'
		}, async () =>
		{
			if (this.level)
			{
				await this.api.saveDifficultyLevel(universe.id, this.level.id, settings);
			}
			else
			{
				await this.api.createDifficultyLevel(universe.id, settings);
			}
		});
	}

	/**
	 * Deletes the level, after asking
	 */
	private async remove(): Promise<void>
	{
		const universe = this.universe;
		const level = this.level;

		if (!universe || !level)
		{
			return;
		}

		const question = t({
			id: 'editor.difficultyLevel.confirmDelete',
			defaultMessage: 'Delete {level}? Groups playing at it will play at the default difficulty instead. This can\'t be undone.',
			description: 'Asks before deleting a difficulty level; {level} is its name'
		}, {
			level: difficultyName(level)
		});

		if (!window.confirm(question))
		{
			return;
		}

		await this.run({
			id: 'editor.difficultyLevel.deleteFailed',
			defaultMessage: 'Could not delete the difficulty level.',
			description: 'Shown in the difficulty level editor when the level couldn\'t be deleted'
		}, () => this.api.deleteDifficultyLevel(universe.id, level.id));
	}

	/**
	 * Makes a change, closing the dialog when it succeeds and explaining in it when it doesn't
	 *
	 * @param failure What failed, as a sentence, for the error message
	 * @param change The change
	 */
	private async run(failure: MessageDescriptor, change: () => Promise<void>): Promise<void>
	{
		this.fields.disabled = true;
		showMessage(this.error, undefined);

		try
		{
			await change();
			this.dialog.close();
			this.onChanged();
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, failure));
		}
		finally
		{
			this.fields.disabled = false;
		}
	}
}
