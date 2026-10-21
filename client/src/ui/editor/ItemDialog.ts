import { canEditWorld, DISALLOWED_TEXT_CHARACTERS, ITEM_KINDS, MAX_ITEM_NAME_LENGTH, type EditableUniverse, type EditorItem, type ItemSettings, type MessageDescriptor, type Ruleset } from '@multiverse-kiln/shared';
import restoreIcon from 'virtual:icon/ph:arrow-counter-clockwise';
import trashIcon from 'virtual:icon/ph:trash';

import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { ChangeTracker } from '../changeTracker';
import { getElement, setButtonLabel, setOptions, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import { itemCategoryName, itemName, itemTypeName } from '../itemNames';

/**
 * The item editor: a dialog for an item's name, type and whether it is enabled
 *
 * Saving a default item stores the universe's edited copy of it. The dialog can also delete a custom
 * item, or restore an edited default item
 */
export class ItemDialog
{
	private readonly dialog = getElement('item-dialog', HTMLDialogElement);
	private readonly form = getElement('item-form', HTMLFormElement);
	private readonly fields = getElement('item-fields', HTMLFieldSetElement);
	private readonly title = getElement('item-dialog-title', HTMLElement);
	private readonly name = getElement('item-name', HTMLInputElement);
	private readonly type = getElement('item-type', HTMLSelectElement);
	private readonly enabled = getElement('item-enabled', HTMLInputElement);
	private readonly error = getElement('item-error', HTMLElement);
	private readonly removeButton = getElement('item-remove', HTMLButtonElement);
	private readonly cancelButton = getElement('item-cancel', HTMLButtonElement);
	private readonly saveButton = getElement('item-save', HTMLButtonElement);

	/**
	 * Whether the item has changes that haven't been saved
	 */
	private readonly changes = new ChangeTracker({ root: this.form });

	private universe: EditableUniverse | undefined;

	/**
	 * The item being edited, or undefined for a new one
	 */
	private item: EditorItem | undefined;

	/**
	 * Called after the item is saved, deleted or restored
	 */
	private onChanged: () => void = () => undefined;

	/**
	 * @param api The editor's API
	 */
	constructor(private readonly api: EditorApi)
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
			void this.remove();
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.save();
		});
	}

	/**
	 * Opens the dialog for an item, or for a new one
	 *
	 * @param universe The universe the item belongs to
	 * @param item The item, or undefined to add one
	 * @param onChanged Called after the item is saved, deleted or restored
	 */
	open(universe: EditableUniverse, item: EditorItem | undefined, onChanged: () => void): void
	{
		const editable = canEditWorld(universe.role);
		const name = (item ? itemName(item, universe.ruleset) : '');

		this.universe = universe;
		this.item = item;
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
		this.fields.disabled = false;
		this.saveButton.hidden = !editable;
		this.saveButton.disabled = false;
		this.cancelButton.textContent = t(editable ? formMessages.cancel : formMessages.close);

		// Only the inputs are locked for a player who can't edit, so Close still works
		for (const input of [this.name, this.type, this.enabled])
		{
			input.disabled = !editable;
		}

		this.removeButton.hidden = (!editable || !item || (!item.custom && !item.edited));
		if (item?.custom)
		{
			setButtonLabel(this.removeButton, trashIcon, t({
				id: 'editor.item.delete',
				defaultMessage: 'Delete Item',
				description: 'Button in the item editor that deletes an item made for this universe'
			}));
		}
		else
		{
			setButtonLabel(this.removeButton, restoreIcon, t({
				id: 'editor.item.restore',
				defaultMessage: 'Restore Default',
				description: 'Button in the item editor that undoes this universe\'s changes to one of the ruleset\'s items'
			}));
		}
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
	 * Saves the item as the form shows it
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

		// A default item whose name wasn't changed keeps the ruleset's, which players read in their own language
		const defaultName = ((this.item && !this.item.custom) ? itemName({ key: this.item.key, name: null }, universe.ruleset) : undefined);
		const settings: ItemSettings = {
			name: ((name === defaultName) ? null : name),
			type: this.type.value,
			enabled: this.enabled.checked
		};

		await this.run({
			id: 'editor.item.saveFailed',
			defaultMessage: 'Could not save the item.',
			description: 'Shown in the item editor when the item couldn\'t be stored'
		}, async () =>
		{
			if (this.item)
			{
				await this.api.saveItem(universe.id, this.item.id, settings);
			}
			else
			{
				await this.api.createItem(universe.id, settings);
			}
		});
	}

	/**
	 * Deletes a custom item, or restores an edited default item
	 */
	private async remove(): Promise<void>
	{
		const universe = this.universe;
		const item = this.item;

		if (!universe || !item)
		{
			return;
		}

		const name = itemName(item, universe.ruleset);
		let question: string;
		let failure: MessageDescriptor;

		if (item.custom)
		{
			question = t({
				id: 'editor.item.confirmDelete',
				defaultMessage: 'Delete {item}? This can\'t be undone.',
				description: 'Asks before deleting an item made for this universe; {item} is its name'
			}, {
				item: name
			});
			failure = {
				id: 'editor.item.deleteFailed',
				defaultMessage: 'Could not delete the item.',
				description: 'Shown in the item editor when the item couldn\'t be deleted'
			};
		}
		else
		{
			question = t({
				id: 'editor.item.confirmRestore',
				defaultMessage: 'Restore {item} to the ruleset\'s default? Your changes to it will be lost.',
				description: 'Asks before undoing this universe\'s changes to one of the ruleset\'s items; {item} is its name'
			}, {
				item: name
			});
			failure = {
				id: 'editor.item.restoreFailed',
				defaultMessage: 'Could not restore the item.',
				description: 'Shown in the item editor when the ruleset\'s item couldn\'t be restored'
			};
		}

		if (!window.confirm(question))
		{
			return;
		}

		await this.run(failure, () => this.api.deleteItem(universe.id, item.id));
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
