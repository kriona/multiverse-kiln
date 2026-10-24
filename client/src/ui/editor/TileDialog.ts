import { canEditWorld, defaultWalkSeconds, DISALLOWED_TEXT_CHARACTERS, IMPASSABLE_WALK_SECONDS, isTileGraphic, MAX_TILE_NAME_LENGTH, MAX_WALK_SECONDS, type EditableUniverse, type EditorTile, type TileSettings } from '@multiverse-kiln/shared';

import { formatDuration, t } from '../../localization';
import { ChangeTracker } from '../changeTracker';
import { getElement, setOptions, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import { tileName } from '../tileNames';
import { colorToHex, parseHexColor } from './colors';
import { editorMessages } from './editorMessages';
import { labelRemoveButton, type StagedEdit } from './stagedChanges';
import { showTileSwatch, tileGraphicOptions } from './tileSwatches';

/**
 * Settings a new tile starts with
 */
const NEW_TILE: TileSettings = {
	name: '',
	indoors: false,
	outdoors: true,
	color: 0x808080,
	graphic: null,
	visionCost: 0,
	walkSeconds: defaultWalkSeconds(false)
};

/**
 * The tile editor: a dialog for a tile's name, whether indoor and outdoor areas use it, color, graphic,
 * vision cost and walk time
 *
 * Applying keeps the changes on the Tilesets tab until it is saved; for a default tile, saving stores the
 * universe's edited copy of it. The dialog can also delete a custom tile, or restore an edited default
 * tile, when the tab is saved
 */
export class TileDialog
{
	private readonly dialog = getElement('tile-dialog', HTMLDialogElement);
	private readonly form = getElement('tile-form', HTMLFormElement);
	private readonly title = getElement('tile-dialog-title', HTMLElement);
	private readonly name = getElement('tile-name', HTMLInputElement);
	private readonly outdoors = getElement('tile-outdoors', HTMLInputElement);
	private readonly indoors = getElement('tile-indoors', HTMLInputElement);
	private readonly colorPicker = getElement('tile-color-picker', HTMLInputElement);
	private readonly color = getElement('tile-color', HTMLInputElement);
	private readonly graphic = getElement('tile-graphic', HTMLSelectElement);
	private readonly visionCost = getElement('tile-vision', HTMLInputElement);
	private readonly walkSeconds = getElement('tile-walk', HTMLInputElement);
	private readonly walkReadout = getElement('tile-walk-readout', HTMLElement);
	private readonly dayPreview = getElement('tile-preview-day', HTMLElement);
	private readonly nightPreview = getElement('tile-preview-night', HTMLElement);
	private readonly error = getElement('tile-error', HTMLElement);
	private readonly removeButton = getElement('tile-remove', HTMLButtonElement);
	private readonly cancelButton = getElement('tile-cancel', HTMLButtonElement);
	private readonly saveButton = getElement('tile-save', HTMLButtonElement);

	/**
	 * Whether the tile has changes that haven't been applied
	 */
	private readonly changes = new ChangeTracker({ root: this.form });

	private universe: EditableUniverse | undefined;

	/**
	 * The tile being edited, or undefined for a new one
	 */
	private tile: EditorTile | undefined;

	/**
	 * Where the dialog's changes go
	 */
	private edit: StagedEdit<TileSettings> | undefined;

	/**
	 * The walk seconds a new tile gets for where it is used, while the walk time field still holds it
	 */
	private defaultWalk = NEW_TILE.walkSeconds;

	/**
	 * Called after the tile's changes are applied, or it is marked to delete or restore
	 */
	private onChanged: () => void = () => undefined;

	constructor()
	{
		this.name.maxLength = MAX_TILE_NAME_LENGTH;
		this.walkSeconds.max = String(MAX_WALK_SECONDS);

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

		this.graphic.addEventListener('change', () =>
		{
			this.updatePreview();
		});

		this.name.addEventListener('input', () =>
		{
			setFieldError(this.name, undefined);
		});

		for (const choice of [this.outdoors, this.indoors])
		{
			choice.addEventListener('change', () =>
			{
				this.updateDefaultWalk();
			});
		}

		this.walkSeconds.addEventListener('input', () =>
		{
			this.updateWalkReadout();
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
	 * Opens the dialog for a tile, or for a new one
	 *
	 * @param universe The universe the tile belongs to
	 * @param tile The tile, or undefined to add one
	 * @param edit Where the dialog's changes go
	 * @param onChanged Called after the tile's changes are applied, or it is marked to delete or restore
	 */
	open(universe: EditableUniverse, tile: EditorTile | undefined, edit: StagedEdit<TileSettings>, onChanged: () => void): void
	{
		const settings = (tile ?? NEW_TILE);
		const canEdit = canEditWorld(universe.role);
		const editable = (canEdit && !edit.removed);
		const name = (tile ? tileName(tile, universe.ruleset) : '');

		this.universe = universe;
		this.tile = tile;
		this.edit = edit;
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
			}, {
				tile: name
			});
		}
		else
		{
			this.title.textContent = name;
		}

		this.name.value = name;
		this.outdoors.checked = settings.outdoors;
		this.indoors.checked = settings.indoors;
		this.color.value = colorToHex(settings.color);
		this.colorPicker.value = colorToHex(settings.color);
		setOptions(this.graphic, tileGraphicOptions());
		this.graphic.value = (isTileGraphic(settings.graphic) ? settings.graphic : '');
		this.visionCost.value = String(settings.visionCost);
		this.walkSeconds.value = String(settings.walkSeconds);
		this.defaultWalk = settings.walkSeconds;
		this.updateWalkReadout();
		this.name.disabled = !editable;
		this.saveButton.hidden = !editable;
		this.cancelButton.textContent = t(editable ? formMessages.cancel : formMessages.close);

		// Only the inputs are locked for a player who can't edit, so Close still works
		for (const input of [this.outdoors, this.indoors, this.colorPicker, this.color, this.graphic, this.visionCost, this.walkSeconds])
		{
			input.disabled = !editable;
		}

		this.removeButton.hidden = (!canEdit || !tile || (!tile.custom && !tile.edited));
		labelRemoveButton(this.removeButton, edit, !tile?.custom, (tile?.custom
			? t({
				id: 'editor.tile.delete',
				defaultMessage: 'Delete Tile',
				description: 'Button in the tile editor that deletes a tile made for this universe'
			})
			: t(editorMessages.restore)));
		showMessage(this.error, undefined);
		clearFieldErrors(this.dialog);
		this.updatePreview();
		this.dialog.showModal();
		this.changes.markSaved();
	}

	/**
	 * Gives a new tile the walk time for where it is used: outdoor tiles take minutes and indoor ones
	 * seconds. A walk time the player typed, and an existing tile's, stay as they are
	 */
	private updateDefaultWalk(): void
	{
		if (this.tile || (this.walkSeconds.valueAsNumber !== this.defaultWalk))
		{
			return;
		}

		this.defaultWalk = defaultWalkSeconds(!this.outdoors.checked);
		this.walkSeconds.value = String(this.defaultWalk);
		this.updateWalkReadout();
	}

	/**
	 * Shows the walk time in hours, minutes and seconds under its field, or that the tile can't be
	 * entered. Shows nothing while the field holds no whole number of seconds the tile can take
	 */
	private updateWalkReadout(): void
	{
		const seconds = this.walkSeconds.valueAsNumber;

		if (!Number.isInteger(seconds) || (seconds < IMPASSABLE_WALK_SECONDS) || (seconds > MAX_WALK_SECONDS))
		{
			this.walkReadout.textContent = '';
		}
		else if (seconds === IMPASSABLE_WALK_SECONDS)
		{
			this.walkReadout.textContent = t({
				id: 'editor.tile.walkImpassable',
				defaultMessage: 'Can\'t be entered',
				description: 'Under the walk time field of the tile editor when it is 0, which makes the tile impassable'
			});
		}
		else
		{
			this.walkReadout.textContent = formatDuration(seconds);
		}
	}

	/**
	 * Shows the tile by day and by night: its graphic, or its color
	 */
	private updatePreview(): void
	{
		const tile = {
			color: (parseHexColor(this.color.value) ?? 0),
			graphic: this.graphicValue()
		};

		showTileSwatch(this.dayPreview, tile);
		showTileSwatch(this.nightPreview, tile, true);
	}

	/**
	 * The graphic chosen
	 *
	 * @return Its key, or null to draw the tile in its color
	 */
	private graphicValue(): string | null
	{
		return(((this.graphic.value === '') ? null : this.graphic.value));
	}

	/**
	 * Keeps the tile as the form shows it, until the tab is saved
	 */
	private apply(): void
	{
		const universe = this.universe;
		const name = this.name.value.trim();
		const color = parseHexColor(this.color.value);

		if (!universe || !this.edit)
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
		this.edit.apply({
			name: ((name === defaultName) ? null : name),
			indoors: this.indoors.checked,
			outdoors: this.outdoors.checked,
			color,
			graphic: this.graphicValue(),
			visionCost: this.visionCost.valueAsNumber,
			walkSeconds: this.walkSeconds.valueAsNumber
		});
		this.close();
	}

	/**
	 * Marks a custom tile to delete, or an edited default tile to restore, when the tab is saved; or takes
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
