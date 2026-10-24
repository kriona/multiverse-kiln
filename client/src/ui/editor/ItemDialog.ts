import { canEditWorld, DISALLOWED_TEXT_CHARACTERS, ITEM_KINDS, MAX_ITEM_NAME_LENGTH, type EditableUniverse, type EditorItem, type ItemSettings, type Ruleset } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { ChangeTracker } from '../changeTracker';
import { getElement, setOptions, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import { itemCategoryName, itemName, itemTypeName } from '../itemNames';
import { labelRemoveButton, type StagedEdit } from './stagedChanges';

/**
 * The item editor: a dialog for an item's name, type and whether it is enabled
 *
 * Applying keeps the changes on the Items tab until it is saved; for a default item, saving stores the
 * universe's edited copy of it. The dialog can also delete a custom item, or restore an edited default
 * item, when the tab is saved
 */
export class ItemDialog
{
	private readonly dialog = getElement('item-dialog', HTMLDialogElement);
	private readonly form = getElement('item-form', HTMLFormElement);
	private readonly title = getElement('item-dialog-title', HTMLElement);
	private readonly name = getElement('item-name', HTMLInputElement);
	private readonly type = getElement('item-type', HTMLSelectElement);
	private readonly enabled = getElement('item-enabled', HTMLInputElement);
	private readonly error = getElement('item-error', HTMLElement);
	private readonly removeButton = getElement('item-remove', HTMLButtonElement);
	private readonly cancelButton = getElement('item-cancel', HTMLButtonElement);
	private readonly saveButton = getElement('item-save', HTMLButtonElement);

	/**
	 * Whether the item has changes that haven't been applied
	 */
	private readonly changes = new ChangeTracker({ root: this.form });

	private universe: EditableUniverse | undefined;

	/**
	 * The item being edited, or undefined for a new one
	 */
	private item: EditorItem | undefined;

	/**
	 * Where the dialog's changes go
	 */
	private edit: StagedEdit<ItemSettings> | undefined;

	/**
	 * Called after the item's changes are applied, or it is marked to delete or restore
	 */
	private onChanged: () => void = () => undefined;

	constructor()
	{
		this.name.maxLength = MAX_ITEM_NAME_LENGTH;

		this.name.addEventListener('input', () =>
		{
			setFieldError(this.name, undefined);
		});

		this.changes.guardDialog(this.dialog);

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
	 * Opens the dialog for an item, or for a new one
	 *
	 * @param universe The universe the item belongs to
	 * @param item The item, or undefined to add one
	 * @param edit Where the dialog's changes go
	 * @param onChanged Called after the item's changes are applied, or it is marked to delete or restore
	 */
	open(universe: EditableUniverse, item: EditorItem | undefined, edit: StagedEdit<ItemSettings>, onChanged: () => void): void
	{
		const canEdit = canEditWorld(universe.role);
		const editable = (canEdit && !edit.removed);
		const name = (item ? itemName(item, universe.ruleset) : '');

		this.universe = universe;
		this.item = item;
		this.edit = edit;
		this.onChanged = onChanged;
		if (!item)
		{
			this.title.textContent = t({
				id: 'editor.item.addTitle',
				defaultMessage: 'Add Item',
				description: 'Title of the item editor when making a new item'
			});
		}
		else if (editable)
		{
			this.title.textContent = t({
				id: 'editor.item.editTitle',
				defaultMessage: 'Edit {item}',
				description: 'Title of the item editor for an item the player can change; {item} is its name'
			}, {
				item: name
			});
		}
		else
		{
			this.title.textContent = name;
		}

		this.showTypeOptions(universe.ruleset);
		this.name.value = name;
		this.type.value = (item?.type ?? Object.keys(ITEM_KINDS[universe.ruleset].types)[0]);
		this.enabled.checked = (item?.enabled ?? true);
		this.saveButton.hidden = !editable;
		this.cancelButton.textContent = t(editable ? formMessages.cancel : formMessages.close);

		// Only the inputs are locked for a player who can't edit, so Close still works
		for (const input of [this.name, this.type, this.enabled])
		{
			input.disabled = !editable;
		}

		this.removeButton.hidden = (!canEdit || !item || (!item.custom && !item.edited));
		labelRemoveButton(this.removeButton, edit, !item?.custom, (item?.custom
			? t({
				id: 'editor.item.delete',
				defaultMessage: 'Delete Item',
				description: 'Button in the item editor that deletes an item made for this universe'
			})
			: t({
				id: 'editor.item.restore',
				defaultMessage: 'Restore Default',
				description: 'Button in the item editor that undoes this universe\'s changes to one of the ruleset\'s items'
			})));
		showMessage(this.error, undefined);
		clearFieldErrors(this.dialog);
		this.dialog.showModal();
		this.changes.markSaved();
	}

	/**
	 * Offers the ruleset's item types, grouped by category
	 *
	 * @param ruleset The universe's ruleset
	 */
	private showTypeOptions(ruleset: Ruleset): void
	{
		const kinds = ITEM_KINDS[ruleset];

		setOptions(this.type, []);

		for (const category of kinds.categories)
		{
			const group = document.createElement('optgroup');

			group.label = itemCategoryName(category, ruleset);
			group.append(...Object.entries(kinds.types)
				.filter(([, typeCategory]) => (typeCategory === category))
				.map(([type]) => new Option(itemTypeName(type, ruleset), type)));
			this.type.append(group);
		}
	}

	/**
	 * Keeps the item as the form shows it, until the tab is saved
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

		// A default item whose name wasn't changed keeps the ruleset's, which players read in their own language
		const defaultName = ((this.item && !this.item.custom) ? itemName({ key: this.item.key, name: null }, universe.ruleset) : undefined);

		this.edit.apply({
			name: ((name === defaultName) ? null : name),
			type: this.type.value,
			enabled: this.enabled.checked
		});
		this.close();
	}

	/**
	 * Marks a custom item to delete, or an edited default item to restore, when the tab is saved; or takes
	 * that back
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
