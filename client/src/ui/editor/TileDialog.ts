import { canEditWorld, defaultWalkSeconds, DISALLOWED_TEXT_CHARACTERS, IMPASSABLE_WALK_SECONDS, MAX_TILE_NAME_LENGTH, MAX_WALK_SECONDS, type EditableUniverse, type EditorTile, type TileSettings } from '@multiverse-kiln/shared';
import trashIcon from 'virtual:icon/ph:trash';

import { formatDuration, t } from '../../localization';
import type { EditorApi } from '../../network/editorApi';
import { ChangeTracker } from '../changeTracker';
import { askToConfirm } from '../confirmDialog';
import { getElement, setButtonLabel, setOptions, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import { tileName } from '../tileNames';
import { colorToHex, parseHexColor } from './colors';
import { editorMessages } from './editorMessages';
import { labelRemoveButton, type StagedEdit } from './stagedChanges';
import { TileDeleteDialog } from './TileDeleteDialog';
import { TileGraphicDialog, type StagedUpload } from './TileGraphicDialog';
import { parseTileGraphicValue, showTileSwatch, tileGraphicOptions, tileGraphicValue, type ShownUpload } from './tileSwatches';

/**
 * The Tilesets tab's uploaded tilesets and the changes to them waiting for the tab to be saved, as the
 * tile editor uses them
 */
export interface TilesetUploads
{
	/**
	 * The uploaded tilesets, with those that saving the tab will upload or delete
	 */
	list(): readonly ShownUpload[];

	/**
	 * Stages a tileset to upload when the tab is saved
	 *
	 * @param upload The tileset
	 * @return The ID it has until then
	 */
	stage(upload: StagedUpload): string;

	/**
	 * Marks an uploaded tileset to delete when the tab is saved, takes the mark back, or discards one
	 * that isn't uploaded yet
	 *
	 * @param id The tileset's ID
	 */
	toggleDelete(id: string): void;
}

/**
 * The Tilesets tab's tiles marked to delete, as the tile editor uses them
 */
export interface TileDeletions
{
	/**
	 * Whether a tile is marked to delete, so it can't replace another
	 *
	 * @param tileId The tile's ID
	 * @return True when it is
	 */
	isRemoved(tileId: number): boolean;

	/**
	 * Keeps the tile to paint the maps with in place of a tile marked to delete, until the tab is saved
	 *
	 * @param tileId The tile marked to delete
	 * @param replacementId The tile to paint the maps with, or undefined when no map uses it or the mark is taken back
	 */
	setReplacement(tileId: number, replacementId: number | undefined): void;
}

/**
 * Settings a new tile starts with
 */
const NEW_TILE: TileSettings = {
	name: '',
	indoors: false,
	outdoors: true,
	color: 0x808080,
	graphic: null,
	uploadedGraphicId: null,
	visionCost: 0,
	walkSeconds: defaultWalkSeconds(false)
};

/**
 * The tile editor: a dialog for a tile's name, whether indoor and outdoor areas use it, color, graphic,
 * vision cost and walk time
 *
 * Applying keeps the changes on the Tilesets tab until it is saved; for a default tile, saving stores the
 * universe's edited copy of it. The dialog can also delete a custom tile, or restore an edited default
 * tile, when the tab is saved. Tilesets uploaded from it (TileGraphicDialog), and uploaded tilesets
 * deleted from it, also wait for the tab to be saved (TilesetUploads)
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
	private readonly uploadButton = getElement('tile-graphic-upload', HTMLButtonElement);
	private readonly deleteGraphicButton = getElement('tile-graphic-delete', HTMLButtonElement);
	private readonly uploadDialog: TileGraphicDialog;
	private readonly deleteDialog: TileDeleteDialog;
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

	/**
	 * Whether the player can change the tile, and so upload and delete tilesets
	 */
	private editable = false;

	/**
	 * @param api The editor's API, for which maps use a tile being deleted
	 * @param uploads The tab's uploaded tilesets, which the graphic list offers, and their staged changes
	 * @param deletions The tab's tiles marked to delete, and the tiles chosen to replace them on the maps
	 */
	constructor(api: EditorApi, private readonly uploads: TilesetUploads, private readonly deletions: TileDeletions)
	{
		this.uploadDialog = new TileGraphicDialog();
		this.deleteDialog = new TileDeleteDialog(api);
		this.name.maxLength = MAX_TILE_NAME_LENGTH;
		this.walkSeconds.max = String(MAX_WALK_SECONDS);

		this.uploadButton.addEventListener('click', () =>
		{
			this.uploadGraphic();
		});

		setButtonLabel(this.deleteGraphicButton, trashIcon, t({
			id: 'editor.tile.deleteGraphic',
			defaultMessage: 'Delete Tileset Image',
			description: 'Button in the tile editor, shown when an uploaded tileset is chosen, that marks that uploaded picture to delete, after asking; tiles drawn with it go back to their colors'
		}));

		this.deleteGraphicButton.addEventListener('click', () =>
		{
			void this.deleteGraphic();
		});

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
		setOptions(this.graphic, tileGraphicOptions(this.uploads.list()));
		this.graphic.value = tileGraphicValue(settings);

		// A tileset marked to delete isn't offered, so its tiles show as they will once it is: in their colors
		if (this.graphic.selectedIndex === -1)
		{
			this.graphic.value = tileGraphicValue({ graphic: null, uploadedGraphicId: null });
		}
		this.visionCost.value = String(settings.visionCost);
		this.walkSeconds.value = String(settings.walkSeconds);
		this.defaultWalk = settings.walkSeconds;
		this.updateWalkReadout();
		this.name.disabled = !editable;
		this.saveButton.hidden = !editable;
		this.uploadButton.hidden = !editable;
		this.editable = editable;
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
			...parseTileGraphicValue(this.graphic.value)
		};

		const uploads = this.uploads.list();

		showTileSwatch(this.dayPreview, tile, uploads);
		showTileSwatch(this.nightPreview, tile, uploads, true);

		// Only an uploaded tileset can be deleted
		this.deleteGraphicButton.hidden = (!this.editable || (tile.uploadedGraphicId === null));
	}

	/**
	 * Marks the uploaded tileset chosen to delete when the tab is saved, after asking, and takes it off
	 * the graphic list; the tile goes back to its color. One not uploaded yet is discarded instead. Saving
	 * deletes its image, and every tile drawn with it is drawn in its color after
	 */
	private async deleteGraphic(): Promise<void>
	{
		const { uploadedGraphicId } = parseTileGraphicValue(this.graphic.value);
		const upload = this.uploads.list().find((candidate) => (candidate.id === uploadedGraphicId));

		if (!upload)
		{
			return;
		}

		const confirmed = await askToConfirm({
			title: t({
				id: 'editor.tileGraphicDelete.title',
				defaultMessage: 'Delete Tileset Image',
				description: 'Title of the dialog that asks before deleting an uploaded tileset (a picture tiles can be drawn with)'
			}),
			question: t({
				id: 'editor.tile.deleteGraphicConfirm',
				defaultMessage: 'Delete the uploaded tileset "{name}"? Every tile drawn with it will be drawn in its color instead.',
				description: 'Asked before marking an uploaded tileset (a picture tiles can be drawn with) to delete from the tile editor; {name} is the name it was given. Nothing is deleted until the tab is saved'
			}, {
				name: upload.name
			}),
			confirmLabel: t({
				id: 'editor.tileGraphicDelete.submit',
				defaultMessage: 'Delete',
				description: 'Button in the dialog that asks before deleting an uploaded tileset: marks it to delete when the Tilesets tab is saved'
			}),
			confirmIcon: trashIcon
		});

		// The tile editor may have closed, or another graphic been chosen, while the dialog was open
		if (!confirmed || !this.dialog.open || (parseTileGraphicValue(this.graphic.value).uploadedGraphicId !== upload.id))
		{
			return;
		}

		this.uploads.toggleDelete(upload.id);
		this.refreshGraphicChoices(tileGraphicValue({ graphic: null, uploadedGraphicId: null }));
	}

	/**
	 * Opens the dialog for uploading a tileset; once one is chosen, the graphic list offers it, to upload
	 * when the tab is saved, and chooses it
	 */
	private uploadGraphic(): void
	{
		this.uploadDialog.open((upload) =>
		{
			const id = this.uploads.stage(upload);

			this.refreshGraphicChoices(tileGraphicValue({ graphic: null, uploadedGraphicId: id }));
		});
	}

	/**
	 * Lists the graphics again, after the uploaded tilesets change, and chooses one
	 *
	 * @param value The choice's value (tileGraphicValue)
	 */
	private refreshGraphicChoices(value: string): void
	{
		setOptions(this.graphic, tileGraphicOptions(this.uploads.list()));
		this.graphic.value = value;
		this.updatePreview();
		this.graphic.focus();
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
			...parseTileGraphicValue(this.graphic.value),
			visionCost: this.visionCost.valueAsNumber,
			walkSeconds: this.walkSeconds.valueAsNumber
		});
		this.close();
	}

	/**
	 * Marks a custom tile to delete, or an edited default tile to restore, when the tab is saved; or takes
	 * that back. Deleting a custom tile asks first (TileDeleteDialog), and when maps use it, which tile to
	 * paint them with instead
	 */
	private remove(): void
	{
		const edit = this.edit;
		const tile = this.tile;
		const universe = this.universe;

		if (!edit || !tile || !universe)
		{
			return;
		}

		if (edit.removed)
		{
			edit.undoRemove();
			this.deletions.setReplacement(tile.id, undefined);
			this.close();
			return;
		}

		// Restoring an edited default tile loses only the universe's changes to it, and keeps it on the maps
		if (!tile.custom)
		{
			edit.remove();
			this.close();
			return;
		}

		this.deleteDialog.open(universe, tile, (tileId) => this.deletions.isRemoved(tileId), (replacementId) =>
		{
			edit.remove();
			this.deletions.setReplacement(tile.id, replacementId);
			this.close();
		});
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
