import { canEditUniverseSettings, DISALLOWED_TEXT_CHARACTERS, MAX_THEME_NAME_LENGTH, NEW_SF1E_THEME_RULES, SF1E_ABILITIES, SF1E_ABILITY_NAMES, SF1E_THEME_ABILITY_BONUS, type EditableUniverse, type EditorTheme, type Sf1eAbility, type ThemeSettings } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { ChangeTracker } from '../changeTracker';
import { getElement, namedOptions, setOptions, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import { themeName } from '../raceAndClassNames';
import { editorMessages } from './editorMessages';
import { labelRemoveButton, type StagedEdit } from './stagedChanges';

/**
 * The theme editor: a dialog for a theme's name, whether it is enabled, and the ability it raises
 *
 * Applying keeps the changes on the Characters tab until it is saved; for a default theme, saving stores
 * the universe's edited copy of it. The dialog can also delete a custom theme, or restore an edited
 * default theme, when the tab is saved
 */
export class ThemeDialog
{
	private readonly dialog = getElement('theme-dialog', HTMLDialogElement);
	private readonly form = getElement('theme-form', HTMLFormElement);
	private readonly title = getElement('theme-dialog-title', HTMLElement);
	private readonly name = getElement('theme-name', HTMLInputElement);
	private readonly enabled = getElement('theme-enabled', HTMLInputElement);
	private readonly ability = getElement('theme-ability', HTMLSelectElement);
	private readonly error = getElement('theme-error', HTMLElement);
	private readonly removeButton = getElement('theme-remove', HTMLButtonElement);
	private readonly cancelButton = getElement('theme-cancel', HTMLButtonElement);
	private readonly saveButton = getElement('theme-save', HTMLButtonElement);

	/**
	 * Whether the theme has changes that haven't been applied
	 */
	private readonly changes: ChangeTracker;

	private universe: EditableUniverse | undefined;

	/**
	 * The theme being edited, or undefined for a new one
	 */
	private theme: EditorTheme | undefined;

	/**
	 * Where the dialog's changes go
	 */
	private edit: StagedEdit<ThemeSettings> | undefined;

	/**
	 * Called after the theme's changes are applied, or it is marked to delete or restore
	 */
	private onChanged: () => void = () => undefined;

	constructor()
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
			this.remove();
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			this.apply();
		});
	}

	/**
	 * Opens the dialog for a theme, or for a new one
	 *
	 * @param universe The universe the theme belongs to
	 * @param theme The theme, or undefined to add one
	 * @param edit Where the dialog's changes go
	 * @param onChanged Called after the theme's changes are applied, or it is marked to delete or restore
	 */
	open(universe: EditableUniverse, theme: EditorTheme | undefined, edit: StagedEdit<ThemeSettings>, onChanged: () => void): void
	{
		const canEdit = canEditUniverseSettings(universe.role);
		const editable = (canEdit && !edit.removed);
		const name = (theme ? themeName(theme, universe.ruleset) : '');

		this.universe = universe;
		this.theme = theme;
		this.edit = edit;
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
		this.saveButton.hidden = !editable;
		this.cancelButton.textContent = t(editable ? formMessages.cancel : formMessages.close);

		// Only the inputs are locked for a player who can't edit, so Close still works
		for (const input of [this.name, this.enabled, this.ability])
		{
			input.disabled = !editable;
		}

		this.removeButton.hidden = (!canEdit || !theme || (!theme.custom && !theme.edited));
		labelRemoveButton(this.removeButton, edit, !theme?.custom, (theme?.custom
			? t({
				id: 'editor.theme.delete',
				defaultMessage: 'Delete Theme',
				description: 'Button in the theme editor that deletes a theme made for this universe'
			})
			: t(editorMessages.restore)));

		showMessage(this.error, undefined);
		clearFieldErrors(this.dialog);
		this.dialog.showModal();
		this.changes.markSaved();
	}

	/**
	 * Keeps the theme as the form shows it, until the tab is saved
	 */
	private apply(): void
	{
		const universe = this.universe;
		const name = this.name.value.trim();

		if (!universe || !this.edit)
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

		this.edit.apply({
			name: ((name === defaultName) ? null : name),
			enabled: this.enabled.checked,
			rules: {
				ability: this.ability.value as Sf1eAbility
			}
		});
		this.close();
	}

	/**
	 * Marks a custom theme to delete, or an edited default theme to restore, when the tab is saved; or
	 * takes that back
	 */
	private remove(): void
	{
		if (!this.edit)
		{
			return;
		}

		if (this.edit.removed)
		{
			this.edit.undoRemove();
		}
		else
		{
			this.edit.remove();
		}

		this.close();
	}

	/**
	 * Closes the dialog once its change is made, and shows the change in the list
	 */
	private close(): void
	{
		this.changes.markSaved();
		this.dialog.close();
		this.onChanged();
	}
}
