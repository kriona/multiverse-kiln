import { canManageEditors, loadedFor, type EditableUniverse, type UniverseSettingsUpdate } from '@multiverse-kiln/shared';

import { describeEditorError } from '../../network/editorApi';
import { currentPageAddress, twoFactorSetupPageUrl } from '../../pages';
import { ChangeTracker, type FormSnapshot } from '../changeTracker';
import { getElement, showMessage } from '../dom';
import type { EditorSave } from './editorSave';
import type { SavableTab } from './SaveBar';

/**
 * The Security section of the Editors tab: whether the universe's editors need 2FA on to save changes
 * to it. Only creators (and site admins) change it, and only with 2FA on themselves, so no one turns it
 * on and keeps themself from saving. Changes wait on the page until the tab is saved
 */
export class EditorsSettingsSection implements SavableTab
{
	private readonly form = getElement('editors-form', HTMLFormElement);
	private readonly fields = getElement('editors-fields', HTMLFieldSetElement);
	private readonly requireTwoFactor = getElement('editors-require-two-factor', HTMLInputElement);
	private readonly ownTwoFactor = getElement('editors-two-factor-own', HTMLElement);
	private readonly setupLink = getElement('editors-two-factor-link', HTMLAnchorElement);
	private readonly error = getElement('editors-settings-error', HTMLElement);

	/**
	 * Whether the form has changes that haven't been saved
	 */
	readonly changes = new ChangeTracker({ root: this.form });

	private universe: EditableUniverse | undefined;

	/**
	 * The settings the save being sent holds, and the form as it collected them
	 */
	private collected: { update: UniverseSettingsUpdate; form: FormSnapshot } | undefined;

	/**
	 * @param onSaved Called with the settings saved, once they are
	 */
	constructor(private readonly onSaved: (update: UniverseSettingsUpdate) => void)
	{
	}

	/**
	 * Shows a universe's settings, read-only unless the player's role may change them and they have
	 * 2FA on; a creator without it is told to turn it on first
	 *
	 * @param universe The universe
	 */
	open(universe: EditableUniverse): void
	{
		this.universe = universe;
		this.requireTwoFactor.checked = universe.requireTwoFactor;
		this.fields.disabled = !this.canSave();
		this.ownTwoFactor.hidden = (!canManageEditors(universe.role) || universe.twoFactor);

		// Back to the editor once 2FA is on
		this.setupLink.href = twoFactorSetupPageUrl(currentPageAddress());
		showMessage(this.error, undefined);
		this.changes.markSaved();
	}

	/**
	 * Whether the player may change the settings
	 *
	 * @return True for a creator with 2FA on
	 */
	canSave(): boolean
	{
		return((this.universe !== undefined) && canManageEditors(this.universe.role) && this.universe.twoFactor);
	}

	/**
	 * Adds the settings as the form shows them to a save
	 *
	 * @param save The save
	 * @return True
	 */
	collect(save: EditorSave): boolean
	{
		const update: UniverseSettingsUpdate = {
			requireTwoFactor: this.requireTwoFactor.checked
		};

		showMessage(this.error, undefined);
		this.collected = {
			update,
			form: this.changes.snapshot()
		};
		save.add({ kind: 'universe', update, loaded: loadedFor(this.universe, update) }, (refusal) =>
		{
			showMessage(this.error, describeEditorError(refusal.error, {
				id: 'editor.editors.settingsSaveFailed',
				defaultMessage: 'Could not save whether editors need two-factor authentication.',
				description: 'Shown on the editor\'s Editors tab when the server refused the setting that requires the universe\'s editors to have two-factor authentication on, followed by why; nothing was saved'
			}));
		});

		return(true);
	}

	/**
	 * Takes the settings as saved. Changes made while the save was sent stay unsaved
	 */
	saved(): void
	{
		const collected = this.collected;

		this.collected = undefined;

		if (this.universe && collected)
		{
			this.universe = { ...this.universe, ...collected.update };
			this.changes.markSaved(collected.form);
			this.onSaved(collected.update);
		}
	}
}
