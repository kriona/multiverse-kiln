import { canEditItemsOpen, categoryItemTypes, DISALLOWED_TEXT_CHARACTERS, ITEM_KINDS, itemEquipsChoices, MAX_ITEM_DESCRIPTION_LENGTH, MAX_ITEM_NAME_LENGTH, type EditableUniverse, type EditorItem, type ItemSettings, type Ruleset } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { ChangeTracker } from '../changeTracker';
import { getElement, setOptions, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import { itemCategoryName, itemDescription, itemEquipsText, itemName, itemTypeName } from '../itemNames';
import { DescriptionField } from './descriptionField';
import { editorMessages } from './editorMessages';
import { FollowedDialog } from './otherSaves';
import { labelRemoveButton, type StagedEdit } from './stagedChanges';

/**
 * The item editor: a dialog for an item's name, description, kind, types, where it equips and whether it
 * is enabled
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
	private readonly description = new DescriptionField(getElement('item-description', HTMLTextAreaElement), MAX_ITEM_DESCRIPTION_LENGTH);
	private readonly category = getElement('item-category', HTMLSelectElement);
	private readonly typesField = getElement('item-types-field', HTMLFieldSetElement);
	private readonly types = getElement('item-types', HTMLElement);
	private readonly equips = getElement('item-equips', HTMLSelectElement);
	private readonly enabled = getElement('item-enabled', HTMLInputElement);
	private readonly error = getElement('item-error', HTMLElement);
	private readonly removeButton = getElement('item-remove', HTMLButtonElement);
	private readonly cancelButton = getElement('item-cancel', HTMLButtonElement);
	private readonly saveButton = getElement('item-save', HTMLButtonElement);

	/**
	 * Whether the item has changes that haven't been applied
	 */
	private readonly changes = new ChangeTracker({ root: this.form });

	/**
	 * How the dialog follows saves made in other windows to the item it shows
	 */
	readonly following = new FollowedDialog(this.dialog, this.title, this.changes);

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

		this.category.addEventListener('change', () =>
		{
			if (this.universe)
			{
				this.showTypes(this.universe.ruleset, []);
			}
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
		const canEdit = canEditItemsOpen(universe);
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

		setOptions(this.category, ITEM_KINDS[universe.ruleset].categories.map((category) => ({
			value: category,
			label: itemCategoryName(category, universe.ruleset)
		})));
		this.category.value = (item?.category ?? ITEM_KINDS[universe.ruleset].categories[0]);
		setOptions(this.equips, itemEquipsChoices(universe.ruleset).map((equips) => ({
			value: equips,
			label: itemEquipsText(equips, universe.ruleset)
		})));
		this.equips.value = (item?.equips ?? 'none');
		this.name.value = name;
		this.description.show((item ? itemDescription(item, universe.ruleset) : ''), ((item?.custom === false) ? itemDescription({ key: item.key, description: null }, universe.ruleset) : ''));
		this.enabled.checked = (item?.enabled ?? true);
		this.saveButton.hidden = !editable;
		this.cancelButton.textContent = t(editable ? formMessages.cancel : formMessages.close);

		// Only the inputs are locked for a player who can't edit, so Close still works
		for (const input of [this.name, this.description.field, this.category, this.equips, this.enabled])
		{
			input.disabled = !editable;
		}

		this.typesField.disabled = !editable;
		this.showTypes(universe.ruleset, (item?.types ?? []));

		this.removeButton.hidden = (!canEdit || !item || (!item.custom && !item.edited));
		labelRemoveButton(this.removeButton, edit, !item?.custom, (item?.custom
			? t({
				id: 'editor.item.delete',
				defaultMessage: 'Delete Item',
				description: 'Button in the item editor that deletes an item made for this universe'
			})
			: t(editorMessages.restore)));
		showMessage(this.error, undefined);
		clearFieldErrors(this.dialog);
		this.following.show();
		this.changes.markSaved();
	}

	/**
	 * Shows a checkbox for each type of the category chosen, hiding the types when it has none
	 *
	 * @param ruleset The universe's ruleset
	 * @param checked The types to check
	 */
	private showTypes(ruleset: Ruleset, checked: readonly string[]): void
	{
		const types = categoryItemTypes(ruleset, this.category.value);

		this.types.replaceChildren(...types.map((type) =>
		{
			const label = document.createElement('label');
			const input = document.createElement('input');

			input.type = 'checkbox';
			input.value = type;
			input.checked = checked.includes(type);
			label.className = 'checkbox';
			label.append(input, itemTypeName(type, ruleset));

			return(label);
		}));
		this.typesField.hidden = (types.length === 0);
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

		const description = this.description.read();

		if (description === undefined)
		{
			return;
		}

		// A default item whose name wasn't changed keeps the ruleset's, which players read in their own language
		const defaultName = ((this.item && !this.item.custom) ? itemName({ key: this.item.key, name: null }, universe.ruleset) : undefined);

		this.edit.apply({
			name: ((name === defaultName) ? null : name),
			description,
			category: this.category.value,
			types: [...this.types.querySelectorAll<HTMLInputElement>('input:checked')].map((input) => input.value),
			equips: this.equips.value,
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
