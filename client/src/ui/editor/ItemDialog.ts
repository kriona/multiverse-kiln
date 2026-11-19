import { canEditItemsOpen, categoryItemTypes, DISALLOWED_TEXT_CHARACTERS, ITEM_KINDS, itemEquipsChoices, MAX_ITEM_DESCRIPTION_LENGTH, MAX_ITEM_NAME_LENGTH, MAX_ITEMS_PER_PAGE, type EditableUniverse, type EditorItem, type ItemSettings, type Ruleset } from '@multiverse-kiln/shared';

import { currentLocale, t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { ChangeTracker } from '../changeTracker';
import type { ComboboxChoice } from '../ComboboxList';
import { SearchSelect } from '../SearchSelect';
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
	private readonly looksLikeField = getElement('item-looks-like-field', HTMLElement);

	/**
	 * The default item an item the universe added looks like on avatars, typed to find among hundreds
	 */
	private readonly looksLike = new SearchSelect({
		searchId: 'item-looks-like',
		listboxId: 'item-looks-like-options',
		choices: [],
		onChange: () =>
		{
			this.looksLikeItemId = ((this.looksLike.value === '') ? null : Number(this.looksLike.value));
			this.changes.check();
		}
	});

	/**
	 * The default item chosen in the Looks like field, by ID, or null for none. Kept apart from the field,
	 * whose choices load after the dialog opens
	 */
	private looksLikeItemId: number | null = null;

	/**
	 * The Looks like field's choices for each ruleset, the default items, loaded the first time they're needed
	 */
	private readonly looksLikeChoices = new Map<Ruleset, Promise<ComboboxChoice[]>>();

	/**
	 * Changes every time the dialog opens, so choices that arrive for an earlier opening are ignored
	 */
	private openVersion = 0;

	private readonly enabled = getElement('item-enabled', HTMLInputElement);
	private readonly error = getElement('item-error', HTMLElement);
	private readonly removeButton = getElement('item-remove', HTMLButtonElement);
	private readonly cancelButton = getElement('item-cancel', HTMLButtonElement);
	private readonly saveButton = getElement('item-save', HTMLButtonElement);

	/**
	 * Whether the item has changes that haven't been applied
	 */
	private readonly changes = new ChangeTracker({
		root: this.form,
		state: () => this.looksLikeItemId
	});

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
	 * @param api The editor's API, which loads the default items an item the universe added can look like
	 */
	open(universe: EditableUniverse, item: EditorItem | undefined, edit: StagedEdit<ItemSettings>, onChanged: () => void, api: EditorApi): void
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

		this.looksLikeItemId = (item?.looksLikeItemId ?? null);
		this.looksLikeField.hidden = (item?.custom === false);
		this.looksLike.field.disabled = true;
		this.looksLike.setChoices([]);
		this.looksLike.value = '';

		const version = ++this.openVersion;

		if (!this.looksLikeField.hidden)
		{
			void this.loadLooksLikeChoices(universe, api, version, editable);
		}

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
	 * Fills the Looks like field with the ruleset's default items, by their engine names, choosing the item's
	 *
	 * @param universe The universe
	 * @param api The editor's API
	 * @param version The dialog's opening, so choices that arrive after it opens again are ignored
	 * @param editable Whether the player can change the field
	 */
	private async loadLooksLikeChoices(universe: EditableUniverse, api: EditorApi, version: number, editable: boolean): Promise<void>
	{
		const { ruleset } = universe;
		let loading = this.looksLikeChoices.get(ruleset);

		if (loading === undefined)
		{
			loading = api
				.listItems(universe.id, {
					custom: false,
					limit: MAX_ITEMS_PER_PAGE
				})
				.then(({ items }) =>
				{
					const collator = new Intl.Collator(currentLocale());

					return(items
						.map((item) => ({
							value: String(item.id),
							name: itemName({ key: item.key, name: null }, ruleset),
							detail: itemCategoryName(item.category, ruleset)
						}))
						.sort((a, b) => collator.compare(a.name, b.name)));
				});
			this.looksLikeChoices.set(ruleset, loading);
		}

		try
		{
			const choices = await loading;

			if (version === this.openVersion)
			{
				this.looksLike.setChoices([{
					value: '',
					name: t(editorMessages.looksLikeNone)
				}, ...choices]);
				this.looksLike.value = ((this.looksLikeItemId === null) ? '' : String(this.looksLikeItemId));
				this.looksLike.field.disabled = !editable;
			}
		}
		catch (error)
		{
			// Loaded again the next time the dialog opens
			this.looksLikeChoices.delete(ruleset);

			if (version === this.openVersion)
			{
				showMessage(this.error, describeEditorError(error, {
					id: 'editor.item.looksLikeFailed',
					defaultMessage: 'Could not load the items it can look like.',
					description: 'Shown in the item editor when the game\'s own items, which the Looks like field chooses from, couldn\'t be loaded'
				}));
			}
		}
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
			looksLikeItemId: ((this.item?.custom === false) ? null : this.looksLikeItemId),
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
