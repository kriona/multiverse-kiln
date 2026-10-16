import { canEditWorld, DISALLOWED_TEXT_CHARACTERS, IMPASSABLE_COST, MAX_TILE_NAME_LENGTH, type EditableUniverse, type EditorTile, type TileSettings } from '@multiverse-kiln/shared';

import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { getElement, showMessage } from '../dom';
import { colorToHex, nightColor, parseHexColor } from './colors';

/**
 * Settings a new tile starts with
 */
const NEW_TILE: TileSettings = {
	name: '',
	indoors: false,
	color: 0x808080,
	visionCost: 0,
	movementCost: 0
};

/**
 * The tile editor: a dialog for a tile's name, indoors or outdoors, color, vision cost and movement cost
 *
 * Saving a default tile stores the universe's edited copy of it. The dialog can also delete a custom
 * tile, or restore an edited default tile
 */
export class TileDialog
{
	private readonly dialog = getElement('tile-dialog', HTMLDialogElement);
	private readonly form = getElement('tile-form', HTMLFormElement);
	private readonly fields = getElement('tile-fields', HTMLFieldSetElement);
	private readonly title = getElement('tile-dialog-title', HTMLElement);
	private readonly name = getElement('tile-name', HTMLInputElement);
	private readonly outdoors = getElement('tile-outdoors', HTMLInputElement);
	private readonly indoors = getElement('tile-indoors', HTMLInputElement);
	private readonly colorPicker = getElement('tile-color-picker', HTMLInputElement);
	private readonly color = getElement('tile-color', HTMLInputElement);
	private readonly visionCost = getElement('tile-vision', HTMLInputElement);
	private readonly movementCost = getElement('tile-movement', HTMLInputElement);
	private readonly dayPreview = getElement('tile-preview-day', HTMLElement);
	private readonly nightPreview = getElement('tile-preview-night', HTMLElement);
	private readonly error = getElement('tile-error', HTMLElement);
	private readonly removeButton = getElement('tile-remove', HTMLButtonElement);
	private readonly cancelButton = getElement('tile-cancel', HTMLButtonElement);
	private readonly saveButton = getElement('tile-save', HTMLButtonElement);

	private universe: EditableUniverse | undefined;

	/**
	 * The tile being edited, or undefined for a new one
	 */
	private tile: EditorTile | undefined;

	/**
	 * Called after the tile is saved, deleted or restored
	 */
	private onChanged: () => void = () => undefined;

	/**
	 * @param api The editor's API
	 */
	constructor(private readonly api: EditorApi)
	{
		this.name.maxLength = MAX_TILE_NAME_LENGTH;
		this.movementCost.max = String(IMPASSABLE_COST);

		this.colorPicker.addEventListener('input', () =>
		{
			this.color.value = this.colorPicker.value;
			this.color.setCustomValidity('');
			this.updatePreview();
		});

		this.color.addEventListener('input', () =>
		{
			const color = parseHexColor(this.color.value);

			this.color.setCustomValidity('');

			if (color !== undefined)
			{
				this.colorPicker.value = colorToHex(color);
				this.updatePreview();
			}
		});

		this.name.addEventListener('input', () =>
		{
			this.name.setCustomValidity('');
		});

		this.cancelButton.addEventListener('click', () =>
		{
			this.dialog.close();
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
	 * Opens the dialog for a tile, or for a new one
	 *
	 * @param universe The universe the tile belongs to
	 * @param tile The tile, or undefined to add one
	 * @param onChanged Called after the tile is saved, deleted or restored
	 */
	open(universe: EditableUniverse, tile: EditorTile | undefined, onChanged: () => void): void
	{
		const settings = (tile ?? NEW_TILE);
		const editable = canEditWorld(universe.role);

		this.universe = universe;
		this.tile = tile;
		this.onChanged = onChanged;
		this.title.textContent = (tile ? (editable ? `Edit ${tile.name}` : tile.name) : 'Add Tile');
		this.name.value = settings.name;
		this.outdoors.checked = !settings.indoors;
		this.indoors.checked = settings.indoors;
		this.color.value = colorToHex(settings.color);
		this.colorPicker.value = colorToHex(settings.color);
		this.visionCost.value = String(settings.visionCost);
		this.movementCost.value = String(settings.movementCost);
		this.fields.disabled = false;
		this.name.disabled = !editable;
		this.saveButton.hidden = !editable;
		this.saveButton.disabled = false;
		this.cancelButton.textContent = (editable ? 'Cancel' : 'Close');

		// Only the inputs are locked for a player who can't edit, so Close still works
		for (const input of [this.outdoors, this.indoors, this.colorPicker, this.color, this.visionCost, this.movementCost])
		{
			input.disabled = !editable;
		}

		this.removeButton.hidden = (!editable || !tile || (!tile.custom && !tile.edited));
		this.removeButton.textContent = (tile?.custom ? 'Delete Tile' : 'Restore Default');
		showMessage(this.error, undefined);
		this.updatePreview();
		this.dialog.showModal();
	}

	/**
	 * Shows the tile's color by day and by night
	 */
	private updatePreview(): void
	{
		const color = (parseHexColor(this.color.value) ?? 0);

		this.dayPreview.style.backgroundColor = colorToHex(color);
		this.nightPreview.style.backgroundColor = colorToHex(nightColor(color));
	}

	/**
	 * Saves the tile as the form shows it
	 */
	private async save(): Promise<void>
	{
		const universe = this.universe;
		const name = this.name.value.trim();
		const color = parseHexColor(this.color.value);

		if (!universe)
		{
			return;
		}

		if ((name === '') || DISALLOWED_TEXT_CHARACTERS.test(name))
		{
			this.name.setCustomValidity('Use letters, numbers, spaces or punctuation.');
			this.name.reportValidity();
			return;
		}

		if (color === undefined)
		{
			this.color.setCustomValidity('Enter a hex color, such as #7AFF3D.');
			this.color.reportValidity();
			return;
		}

		const settings: TileSettings = {
			name,
			indoors: this.indoors.checked,
			color,
			visionCost: this.visionCost.valueAsNumber,
			movementCost: this.movementCost.valueAsNumber
		};

		await this.run('save the tile', async () =>
		{
			if (this.tile)
			{
				await this.api.saveTile(universe.id, this.tile.id, settings);
			}
			else
			{
				await this.api.createTile(universe.id, settings);
			}
		});
	}

	/**
	 * Deletes a custom tile, or restores an edited default tile
	 */
	private async remove(): Promise<void>
	{
		const universe = this.universe;
		const tile = this.tile;

		if (!universe || !tile)
		{
			return;
		}

		const question = (tile.custom ? `Delete ${tile.name}? This can't be undone.` : `Restore ${tile.name} to the ruleset's default? Your changes to it will be lost.`);

		if (!window.confirm(question))
		{
			return;
		}

		await this.run((tile.custom ? 'delete the tile' : 'restore the tile'), () => this.api.deleteTile(universe.id, tile.id));
	}

	/**
	 * Makes a change, closing the dialog when it succeeds and explaining in it when it doesn't
	 *
	 * @param action What is being done, for the error message
	 * @param change The change
	 */
	private async run(action: string, change: () => Promise<void>): Promise<void>
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
			showMessage(this.error, describeEditorError(error, action));
		}
		finally
		{
			this.fields.disabled = false;
		}
	}
}
