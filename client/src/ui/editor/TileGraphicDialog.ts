import { DISALLOWED_TEXT_CHARACTERS, MAX_TILE_GRAPHIC_BYTES, MAX_TILE_GRAPHIC_DRAW_ORDER, MAX_TILE_GRAPHIC_NAME_LENGTH, MIN_TILE_GRAPHIC_DRAW_ORDER, TILE_GRAPHIC_KEYS, TILE_GRAPHIC_SIZE, TILE_GRAPHICS, type TileGraphicUploadRequest } from '@multiverse-kiln/shared';

import { formatList, t } from '../../localization';
import { DUAL_GRID_COLUMNS } from '../../rendering/tileGraphics';
import { ChangeTracker } from '../changeTracker';
import { getElement, showMessage } from '../dom';
import { clearFieldErrors, reportFieldError, setFieldError } from '../fieldErrors';
import { formMessages } from '../formMessages';
import { tileGraphicName } from './tileSwatches';

/**
 * The draw order the field starts with: between the grass and forest that ship with the engine
 */
const DEFAULT_DRAW_ORDER = 35;

/**
 * A tileset chosen in the upload dialog, waiting for the Tilesets tab to be saved
 */
export interface StagedUpload
{
	/**
	 * What saving the tab sends
	 */
	request: TileGraphicUploadRequest;

	/**
	 * The image as a data URL, to show it until it is uploaded
	 */
	previewUrl: string;
}

/**
 * The dialog for uploading a tileset: a PNG Dual-Grid sheet the universe's tiles can be drawn with, its
 * name and draw order, and the uploader's confirmation that they have the rights to use it
 *
 * Like every change in the editor, the upload waits for the Tilesets tab to be saved; the dialog checks
 * what it can in the browser first, and the server checks the image again when it arrives
 */
export class TileGraphicDialog
{
	private readonly dialog = getElement('tile-graphic-dialog', HTMLDialogElement);
	private readonly form = getElement('tile-graphic-form', HTMLFormElement);
	private readonly file = getElement('tile-graphic-file', HTMLInputElement);
	private readonly format = getElement('tile-graphic-format', HTMLElement);
	private readonly name = getElement('tile-graphic-name', HTMLInputElement);
	private readonly drawOrder = getElement('tile-graphic-draw-order', HTMLInputElement);
	private readonly drawOrderHint = getElement('tile-graphic-draw-order-hint', HTMLElement);
	private readonly error = getElement('tile-graphic-error', HTMLElement);
	private readonly cancelButton = getElement('tile-graphic-cancel', HTMLButtonElement);
	private readonly submitButton = getElement('tile-graphic-submit', HTMLButtonElement);

	/**
	 * Whether the form has been filled in since it opened
	 */
	private readonly changes = new ChangeTracker({ root: this.form });

	/**
	 * Called with the tileset once it is chosen and checked
	 */
	private onStaged: (upload: StagedUpload) => void = () => undefined;

	constructor()
	{
		this.name.maxLength = MAX_TILE_GRAPHIC_NAME_LENGTH;
		this.drawOrder.min = String(MIN_TILE_GRAPHIC_DRAW_ORDER);
		this.drawOrder.max = String(MAX_TILE_GRAPHIC_DRAW_ORDER);
		this.format.textContent = t({
			id: 'editor.tileGraphic.formatHint',
			defaultMessage: 'A PNG of {size, number} by {size, number} pixels, at most {kilobytes, number} KB: {columns, number} frames across and {columns, number} down in the Dual-Grid layout.',
			description: 'Explains what picture a tileset upload needs; {size} is its width and height in pixels, {kilobytes} the largest file allowed, and {columns} how many frames it has across and down'
		}, {
			size: TILE_GRAPHIC_SIZE,
			kilobytes: MAX_TILE_GRAPHIC_BYTES / 1024,
			columns: DUAL_GRID_COLUMNS
		});
		this.drawOrderHint.textContent = t({
			id: 'editor.tileGraphic.drawOrderHint',
			defaultMessage: 'Where two kinds of tile meet, the higher number\'s edges are drawn over the other\'s. The tilesets that come with the game are {orders}.',
			description: 'Explains the draw order field of the tileset upload dialog; {orders} lists the game\'s own tilesets with their numbers, e.g. "Grass 30, Forest 40 and Mountains 50"'
		}, {
			orders: formatList(TILE_GRAPHIC_KEYS.map((graphic) => t({
				id: 'editor.tileGraphic.drawOrderExample',
				defaultMessage: '{name} {order, number}',
				description: 'One of the game\'s own tilesets with its draw order, in the list under the draw order field, e.g. "Grass 30"'
			}, {
				name: tileGraphicName(graphic),
				order: TILE_GRAPHICS[graphic].drawOrder
			})))
		});

		this.file.addEventListener('change', () =>
		{
			const chosen = this.file.files?.[0];

			setFieldError(this.file, undefined);

			// A name taken from the file saves typing; one already typed stays
			if (chosen && (this.name.value.trim() === ''))
			{
				this.name.value = chosen.name.replace(/\.png$/i, '').slice(0, MAX_TILE_GRAPHIC_NAME_LENGTH);
			}
		});

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

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.stage();
		});
	}

	/**
	 * Opens the dialog, empty
	 *
	 * @param onStaged Called with the tileset once it is chosen and checked
	 */
	open(onStaged: (upload: StagedUpload) => void): void
	{
		this.onStaged = onStaged;
		this.form.reset();
		this.drawOrder.value = String(DEFAULT_DRAW_ORDER);
		this.submitButton.disabled = false;
		showMessage(this.error, undefined);
		clearFieldErrors(this.form);
		this.dialog.showModal();
		this.changes.markSaved();
		this.file.focus();
	}

	/**
	 * Checks the form and the image, and hands the tileset to the tab to upload when it is saved
	 */
	private async stage(): Promise<void>
	{
		const file = this.file.files?.[0];
		const name = this.name.value.trim();

		if (!file)
		{
			return;
		}

		if ((file.type !== 'image/png') || (file.size > MAX_TILE_GRAPHIC_BYTES))
		{
			reportFieldError(this.file, this.format.textContent ?? '');
			return;
		}

		if ((name === '') || DISALLOWED_TEXT_CHARACTERS.test(name))
		{
			reportFieldError(this.name, t(formMessages.invalidText));
			return;
		}

		this.submitButton.disabled = true;
		showMessage(this.error, undefined);

		let previewUrl: string;

		try
		{
			previewUrl = await readDataUrl(file);
		}
		catch
		{
			showMessage(this.error, t({
				id: 'editor.tileGraphic.unreadable',
				defaultMessage: 'Could not read the image.',
				description: 'Shown in the tileset upload dialog when the chosen file couldn\'t be opened as a picture'
			}));
			this.submitButton.disabled = false;
			return;
		}

		if (!await hasSheetSize(previewUrl))
		{
			this.submitButton.disabled = false;
			reportFieldError(this.file, this.format.textContent ?? '');
			return;
		}

		this.changes.markSaved();
		this.dialog.close();
		this.onStaged({
			request: {
				name,
				drawOrder: this.drawOrder.valueAsNumber,
				image: previewUrl.replace(/^[^,]*,/, ''),
				rightsConfirmed: true
			},
			previewUrl
		});
	}
}

/**
 * A file's contents as a data URL: data:<type>;base64,<data>
 *
 * @param file The file
 * @return The data URL
 */
function readDataUrl(file: File): Promise<string>
{
	return(new Promise((resolve, reject) =>
	{
		const reader = new FileReader();

		reader.addEventListener('load', () =>
		{
			resolve(((typeof reader.result === 'string') ? reader.result : ''));
		});
		reader.addEventListener('error', () =>
		{
			reject(reader.error ?? new Error(`Could not read ${file.name}`));
		});
		reader.readAsDataURL(file);
	}));
}

/**
 * Whether an image is a tileset's size, TILE_GRAPHIC_SIZE pixels square
 *
 * @param url The image as a data URL
 * @return False when it isn't, or isn't an image the browser can open
 */
function hasSheetSize(url: string): Promise<boolean>
{
	return(new Promise((resolve) =>
	{
		const image = new Image();

		image.addEventListener('load', () =>
		{
			resolve((image.naturalWidth === TILE_GRAPHIC_SIZE) && (image.naturalHeight === TILE_GRAPHIC_SIZE));
		});
		image.addEventListener('error', () =>
		{
			resolve(false);
		});
		image.src = url;
	}));
}
