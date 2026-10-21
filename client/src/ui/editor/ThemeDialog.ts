import { canEditUniverseSettings, DISALLOWED_TEXT_CHARACTERS, MAX_THEME_NAME_LENGTH, NEW_SF1E_THEME_RULES, SF1E_ABILITIES, SF1E_ABILITY_NAMES, SF1E_THEME_ABILITY_BONUS, type EditableUniverse, type EditorTheme, type MessageDescriptor, type Sf1eAbility, type ThemeSettings } from '@multiverse-kiln/shared';
import restoreIcon from 'virtual:icon/ph:arrow-counter-clockwise';
import trashIcon from 'virtual:icon/ph:trash';

import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { ChangeTracker } from '../changeTracker';
import { getElement, namedOptions, setButtonLabel, setOptions, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import { themeName } from '../raceAndClassNames';

/**
 * The theme editor: a dialog for a theme's name, whether it is enabled, and the ability it raises
 *
 * Saving a default theme stores the universe's edited copy of it. The dialog can also delete a custom
 * theme, or restore an edited default theme
 */
export class ThemeDialog
{
	private readonly dialog = getElement('theme-dialog', HTMLDialogElement);
	private readonly form = getElement('theme-form', HTMLFormElement);
	private readonly fields = getElement('theme-fields', HTMLFieldSetElement);
	private readonly title = getElement('theme-dialog-title', HTMLElement);
	private readonly name = getElement('theme-name', HTMLInputElement);
	private readonly enabled = getElement('theme-enabled', HTMLInputElement);
	private readonly ability = getElement('theme-ability', HTMLSelectElement);
	private readonly error = getElement('theme-error', HTMLElement);
	private readonly removeButton = getElement('theme-remove', HTMLButtonElement);
	private readonly cancelButton = getElement('theme-cancel', HTMLButtonElement);
	private readonly saveButton = getElement('theme-save', HTMLButtonElement);

	/**
	 * Whether the theme has changes that haven't been saved
	 */
	private readonly changes: ChangeTracker;

	private universe: EditableUniverse | undefined;

	/**
	 * The theme being edited, or undefined for a new one
	 */
	private theme: EditorTheme | undefined;

	/**
	 * Called after the theme is saved, deleted or restored
	 */
	private onChanged: () => void = () => undefined;

	/**
	 * @param api The editor's API
	 */
	constructor(private readonly api: EditorApi)
	{
		this.name.maxLength = MAX_THEME_NAME_LENGTH;
		setOptions(this.ability, namedOptions(SF1E_ABILITIES, SF1E_ABILITY_NAMES));
		getElement('theme-ability-hint', HTMLElement).textContent = t({
			id: 'editor.theme.abilityHint',
			defaultMessage: 'Characters with the theme get +{bonus, number} to this ability.',
			description: 'Explains the theme editor\'s Ability raised field; {bonus} is how much the ability score goes up'
		}, {
			bonus: SF1E_THEME_ABILITY_BONUS
		});
		this.changes = new ChangeTracker({ root: this.form });
		this.changes.guardDialog(this.dialog);

		this.name.addEventListener('input', () =>
		{
			setFieldError(this.name, undefined);
		});

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
	 * Opens the dialog for a theme, or for a new one
	 *
	 * @param universe The universe the theme belongs to
	 * @param theme The theme, or undefined to add one
	 * @param onChanged Called after the theme is saved, deleted or restored
	 */
	open(universe: EditableUniverse, theme: EditorTheme | undefined, onChanged: () => void): void
	{
		const editable = canEditUniverseSettings(universe.role);
		const name = (theme ? themeName(theme, universe.ruleset) : '');

		this.universe = universe;
		this.theme = theme;
		this.onChanged = onChanged;

		if (!theme)
		{
			this.title.textContent = t({
				id: 'editor.theme.addTitle',
				defaultMessage: 'Add Theme',
				description: 'Title of the theme editor when making a new theme (a character background, such as ace pilot)'
			});
		}
		else if (editable)
		{
			this.title.textContent = t({
				id: 'editor.theme.editTitle',
				defaultMessage: 'Edit {theme}',
				description: 'Title of the theme editor for a theme the player can change; {theme} is its name, e.g. Ace Pilot'
			}, {
				theme: name
			});
		}
		else
		{
			this.title.textContent = name;
		}

		this.name.value = name;
		this.enabled.checked = (theme?.enabled ?? true);
		this.ability.value = (theme?.rules ?? NEW_SF1E_THEME_RULES).ability;
		this.fields.disabled = false;
		this.saveButton.hidden = !editable;
		this.saveButton.disabled = false;
		this.cancelButton.textContent = t(editable ? formMessages.cancel : formMessages.close);

		// Only the inputs are locked for a player who can't edit, so Close still works
		for (const input of [this.name, this.enabled, this.ability])
		{
			input.disabled = !editable;
		}

		this.removeButton.hidden = (!editable || !theme || (!theme.custom && !theme.edited));
		if (theme?.custom)
		{
			setButtonLabel(this.removeButton, trashIcon, t({
				id: 'editor.theme.delete',
				defaultMessage: 'Delete Theme',
				description: 'Button in the theme editor that deletes a theme made for this universe'
			}));
		}
		else
		{
			setButtonLabel(this.removeButton, restoreIcon, t({
				id: 'editor.theme.restore',
				defaultMessage: 'Restore Default',
				description: 'Button in the theme editor that undoes this universe\'s changes to one of the ruleset\'s themes'
			}));
		}

		showMessage(this.error, undefined);
		clearFieldErrors(this.dialog);
		this.dialog.showModal();
		this.changes.markSaved();
	}

	/**
	 * Saves the theme as the form shows it
	 */
	private async save(): Promise<void>
	{
		const universe = this.universe;
		const name = this.name.value.trim();

		if (!universe)
		{
			return;
		}

		if ((name === '') || DISALLOWED_TEXT_CHARACTERS.test(name))
		{
			reportFieldError(this.name, t(formMessages.invalidText));
			return;
		}

		// A default theme whose name wasn't changed keeps the ruleset's, which players read in their own language
		const defaultName = ((this.theme && !this.theme.custom) ? themeName({ key: this.theme.key, name: null }, universe.ruleset) : undefined);
		const settings: ThemeSettings = {
			name: ((name === defaultName) ? null : name),
			enabled: this.enabled.checked,
			rules: {
				ability: this.ability.value as Sf1eAbility
			}
		};

		await this.run({
			id: 'editor.theme.saveFailed',
			defaultMessage: 'Could not save the theme.',
			description: 'Shown in the theme editor when the theme couldn\'t be stored'
		}, async () =>
		{
			if (this.theme)
			{
				await this.api.saveTheme(universe.id, this.theme.id, settings);
			}
			else
			{
				await this.api.createTheme(universe.id, settings);
			}
		});
	}

	/**
	 * Deletes a custom theme, or restores an edited default theme
	 */
	private async remove(): Promise<void>
	{
		const universe = this.universe;
		const theme = this.theme;

		if (!universe || !theme)
		{
			return;
		}

		const name = themeName(theme, universe.ruleset);
		let question: string;
		let failure: MessageDescriptor;

		if (theme.custom)
		{
			question = t({
				id: 'editor.theme.confirmDelete',
				defaultMessage: 'Delete {theme}? This can\'t be undone.',
				description: 'Asks before deleting a theme made for this universe; {theme} is its name'
			}, {
				theme: name
			});
			failure = {
				id: 'editor.theme.deleteFailed',
				defaultMessage: 'Could not delete the theme.',
				description: 'Shown in the theme editor when the theme couldn\'t be deleted'
			};
		}
		else
		{
			question = t({
				id: 'editor.theme.confirmRestore',
				defaultMessage: 'Restore {theme} to the ruleset\'s default? Your changes to it will be lost.',
				description: 'Asks before undoing this universe\'s changes to one of the ruleset\'s themes; {theme} is its name'
			}, {
				theme: name
			});
			failure = {
				id: 'editor.theme.restoreFailed',
				defaultMessage: 'Could not restore the theme.',
				description: 'Shown in the theme editor when the ruleset\'s theme couldn\'t be restored'
			};
		}

		if (!window.confirm(question))
		{
			return;
		}

		await this.run(failure, () => this.api.deleteTheme(universe.id, theme.id));
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
