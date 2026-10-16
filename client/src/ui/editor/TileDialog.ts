import { canEditWorld, DISALLOWED_TEXT_CHARACTERS, IMPASSABLE_COST, MAX_TILE_NAME_LENGTH, type EditableUniverse, type EditorTile, type MessageDescriptor, type TileSettings } from '@multiverse-kiln/shared';
import restoreIcon from 'virtual:icon/ph:arrow-counter-clockwise';
import trashIcon from 'virtual:icon/ph:trash';

import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { getElement, setButtonLabel, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import { colorToHex, nightColor, parseHexColor } from './colors';
import { tileName } from './tileNames';

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
			setFieldError(this.color, undefined);
			this.updatePreview();
		});

		this.color.addEventListener('input', () =>
		{
			const color = parseHexColor(this.color.value);

			setFieldError(this.color, undefined);

			if (color !== undefined)
			{
				this.colorPicker.value = colorToHex(color);
				this.updatePreview();
			}
		});

		this.name.addEventListener('input', () =>
		{
			setFieldError(this.name, undefined);
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
		const name = (tile ? tileName(tile, universe.ruleset) : '');

		this.universe = universe;
		this.tile = tile;
		this.onChanged = onChanged;
		if (!tile)
		{
			this.title.textContent = t({
				id: 'editor.tile.addTitle',
				defaultMessage: 'Add Tile',
				description: 'Title of the tile editor when making a new tile'
			});
		}
		else if (editable)
		{
			this.title.textContent = t({
				id: 'editor.tile.editTitle',
				defaultMessage: 'Edit {tile}',
				description: 'Title of the tile editor for a tile the player can change; {tile} is its name'
			}, { tile: name });
		}
		else
		{
			this.title.textContent = name;
		}

		this.name.value = name;
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
		this.cancelButton.textContent = t(editable ? formMessages.cancel : formMessages.close);

		// Only the inputs are locked for a player who can't edit, so Close still works
		for (const input of [this.outdoors, this.indoors, this.colorPicker, this.color, this.visionCost, this.movementCost])
		{
			input.disabled = !editable;
		}

		this.removeButton.hidden = (!editable || !tile || (!tile.custom && !tile.edited));
		if (tile?.custom)
		{
			setButtonLabel(this.removeButton, trashIcon, t({
				id: 'editor.tile.delete',
				defaultMessage: 'Delete Tile',
				description: 'Button in the tile editor that deletes a tile made for this universe'
			}));
		}
		else
		{
			setButtonLabel(this.removeButton, restoreIcon, t({
				id: 'editor.tile.restore',
				defaultMessage: 'Restore Default',
				description: 'Button in the tile editor that undoes this universe\'s changes to one of the ruleset\'s tiles'
			}));
		}
		showMessage(this.error, undefined);
		clearFieldErrors(this.dialog);
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
			reportFieldError(this.name, t(formMessages.invalidText));
			return;
		}

		if (color === undefined)
		{
			reportFieldError(this.color, t({
				id: 'editor.tile.invalidColor',
				defaultMessage: 'Enter a hex color, such as #7AFF3D.',
				description: 'Shown by the color field when what was typed isn\'t a hexadecimal color'
			}));
			return;
		}

		// A default tile whose name wasn't changed keeps the ruleset's, which players read in their own language
		const defaultName = ((this.tile && !this.tile.custom) ? tileName({ key: this.tile.key, name: null }, universe.ruleset) : undefined);
		const settings: TileSettings = {
			name: ((name === defaultName) ? null : name),
			indoors: this.indoors.checked,
			color,
			visionCost: this.visionCost.valueAsNumber,
			movementCost: this.movementCost.valueAsNumber
		};

		await this.run({
			id: 'editor.tile.saveFailed',
			defaultMessage: 'Could not save the tile.',
			description: 'Shown in the tile editor when the tile couldn\'t be stored'
		}, async () =>
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

		const name = tileName(tile, universe.ruleset);
		let question: string;
		let failure: MessageDescriptor;

		if (tile.custom)
		{
			question = t({
				id: 'editor.tile.confirmDelete',
				defaultMessage: 'Delete {tile}? This can\'t be undone.',
				description: 'Asks before deleting a tile made for this universe; {tile} is its name'
			}, { tile: name });
			failure = {
				id: 'editor.tile.deleteFailed',
				defaultMessage: 'Could not delete the tile.',
				description: 'Shown in the tile editor when the tile couldn\'t be deleted'
			};
		}
		else
		{
			question = t({
				id: 'editor.tile.confirmRestore',
				defaultMessage: 'Restore {tile} to the ruleset\'s default? Your changes to it will be lost.',
				description: 'Asks before undoing this universe\'s changes to one of the ruleset\'s tiles; {tile} is its name'
			}, { tile: name });
			failure = {
				id: 'editor.tile.restoreFailed',
				defaultMessage: 'Could not restore the tile.',
				description: 'Shown in the tile editor when the ruleset\'s tile couldn\'t be restored'
			};
		}

		if (!window.confirm(question))
		{
			return;
		}

		await this.run(failure, () => this.api.deleteTile(universe.id, tile.id));
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
