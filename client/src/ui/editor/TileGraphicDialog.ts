import { BLOB_FRAME_MASKS, BLOB_SHEET_COLUMNS, BLOB_SHEET_MASKS, defineMessages, DISALLOWED_TEXT_CHARACTERS, GRID_CELL_SIZE, MAX_TILE_GRAPHIC_BYTES, MAX_TILE_GRAPHIC_DRAW_ORDER, MAX_TILE_GRAPHIC_NAME_LENGTH, MIN_TILE_GRAPHIC_DRAW_ORDER, SORTED_BLOB_SHEET, TILE_GRAPHIC_FORMATS, TILE_GRAPHIC_KEYS, TILE_GRAPHIC_SIZES, TILE_GRAPHICS, type TileGraphicFormat, type TileGraphicUploadRequest } from '@multiverse-kiln/shared';

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

const messages = defineMessages({
	unreadable: {
		id: 'editor.tileGraphic.unreadable',
		defaultMessage: 'Could not read the image.',
		description: 'Shown in the tileset upload dialog when the chosen file couldn\'t be opened as a picture'
	}
});

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
 * The dialog for uploading a tileset: a PNG sheet the universe's tiles can be drawn with, in the
 * Dual-Grid layout, which blends with the ground, or the blob layout, drawn over it (chosen to match the image's size when it is
 * picked), its name, a Dual-Grid sheet's draw order, and the uploader's confirmation that they have the
 * rights to use it
 *
 * A blob sheet sorted by mask (SORTED_BLOB_SHEET, told apart by its size) is rearranged into the game's
 * order (BLOB_SHEET_MASKS) before it is staged, so the areas drawn and the server only ever see the game's order
 *
 * Like every change in the editor, the upload waits for the Tilesets tab to be saved; the dialog checks
 * what it can in the browser first, and the server checks the image again when it arrives
 */
export class TileGraphicDialog
{
	private readonly dialog = getElement('tile-graphic-dialog', HTMLDialogElement);
	private readonly form = getElement('tile-graphic-form', HTMLFormElement);
	private readonly dualGridFormat = getElement('tile-graphic-format-dual-grid', HTMLInputElement);
	private readonly blobFormat = getElement('tile-graphic-format-blob', HTMLInputElement);
	private readonly file = getElement('tile-graphic-file', HTMLInputElement);
	private readonly format = getElement('tile-graphic-format', HTMLElement);
	private readonly name = getElement('tile-graphic-name', HTMLInputElement);
	private readonly drawOrderLabel = getElement('tile-graphic-draw-order-label', HTMLElement);
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
		this.drawOrderHint.textContent = t({
			id: 'editor.tileGraphic.drawOrderHint',
			defaultMessage: 'Where two kinds of tile meet, the higher number\'s edges are drawn over the other\'s. The tilesets that come with the game are {orders}.',
			description: 'Explains the draw order field of the tileset upload dialog; {orders} lists the game\'s own tilesets with their numbers, e.g. "Grass 30, Forest 40 and Mountains 50"'
		}, {
			orders: formatList(TILE_GRAPHIC_KEYS.flatMap((graphic) =>
			{
				const shipped = TILE_GRAPHICS[graphic];

				// Blob graphics are drawn over the ground, so they have no draw order
				if (shipped.format !== 'dualGrid')
				{
					return([]);
				}

				return([t({
					id: 'editor.tileGraphic.drawOrderExample',
					defaultMessage: '{name} {order, number}',
					description: 'One of the game\'s own tilesets with its draw order, in the list under the draw order field, e.g. "Grass 30"'
				}, {
					name: tileGraphicName(graphic),
					order: shipped.drawOrder
				})]);
			}))
		});

		this.file.addEventListener('change', () =>
		{
			const chosen = this.file.files?.[0];

			setFieldError(this.file, undefined);

			if (!chosen)
			{
				return;
			}

			// A name taken from the file saves typing; one already typed stays
			if (this.name.value.trim() === '')
			{
				this.name.value = chosen.name.replace(/\.png$/i, '').slice(0, MAX_TILE_GRAPHIC_NAME_LENGTH);
			}

			void this.matchFormat(chosen);
		});

		for (const radio of [this.dualGridFormat, this.blobFormat])
		{
			radio.addEventListener('change', () =>
			{
				setFieldError(this.file, undefined);
				this.showFormat();
			});
		}

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
		this.showFormat();
		this.submitButton.disabled = false;
		showMessage(this.error, undefined);
		clearFieldErrors(this.form);
		this.dialog.showModal();
		this.changes.markSaved();
		this.dualGridFormat.focus();
	}

	/**
	 * The layout chosen for the tileset
	 *
	 * @return The format
	 */
	private chosenFormat(): TileGraphicFormat
	{
		return((this.blobFormat.checked ? 'blob' : 'dualGrid'));
	}

	/**
	 * Explains what picture the chosen layout needs, and shows the draw order only for a Dual-Grid sheet
	 */
	private showFormat(): void
	{
		const format = this.chosenFormat();
		const { width, height } = TILE_GRAPHIC_SIZES[format];

		if (format === 'blob')
		{
			this.format.textContent = t({
				id: 'editor.tileGraphic.blobFormatHint',
				defaultMessage: 'A PNG of at most {kilobytes, number} KB in the 47-tile blob layout: {width, number} by {height, number} pixels, {columns, number} frames across and {columns, number} down like the game\'s own tilesets, with 2 places empty, or {sortedWidth, number} by {sortedHeight, number} pixels, {sortedColumns, number} frames across and {sortedRows, number} down, sorted by the neighbors they join, with the last place empty. These tiles are drawn over the ground, so they have no draw order.',
				description: 'Explains what picture a tileset upload in the 47-tile layout needs, for things drawn over the ground such as hedges. It takes either of 2 arrangements of the frames: {width} and {height} are the size in pixels of the game\'s own, and {columns} how many frames it has across and down; {sortedWidth}, {sortedHeight}, {sortedColumns} and {sortedRows} the same for the other, whose frames go in order of which neighboring cells they join up with. {kilobytes} is the largest file allowed'
			}, {
				kilobytes: MAX_TILE_GRAPHIC_BYTES / 1024,
				width,
				height,
				columns: BLOB_SHEET_COLUMNS,
				sortedWidth: SORTED_BLOB_SHEET.width,
				sortedHeight: SORTED_BLOB_SHEET.height,
				sortedColumns: SORTED_BLOB_SHEET.columns,
				sortedRows: SORTED_BLOB_SHEET.height / GRID_CELL_SIZE
			});
		}
		else
		{
			this.format.textContent = t({
				id: 'editor.tileGraphic.formatHint',
				defaultMessage: 'A PNG of {size, number} by {size, number} pixels, at most {kilobytes, number} KB: {columns, number} frames across and {columns, number} down in the Dual-Grid layout.',
				description: 'Explains what picture a tileset upload in the 15-tile layout needs, for ground and other tiles that blend with it; {size} is its width and height in pixels, {kilobytes} the largest file allowed, and {columns} how many frames it has across and down'
			}, {
				size: width,
				kilobytes: MAX_TILE_GRAPHIC_BYTES / 1024,
				columns: DUAL_GRID_COLUMNS
			});
		}

		this.drawOrderLabel.hidden = (format === 'blob');
		this.drawOrderHint.hidden = (format === 'blob');
		this.drawOrder.disabled = (format === 'blob');
	}

	/**
	 * Chooses the layout whose size a chosen image is, when it is one of them
	 *
	 * @param file The image
	 */
	private async matchFormat(file: File): Promise<void>
	{
		let size: { width: number; height: number } | undefined;

		try
		{
			size = await imageSize(await readDataUrl(file));
		}
		catch
		{
			return;
		}

		// Another file may have been chosen meanwhile
		if ((size === undefined) || (this.file.files?.[0] !== file))
		{
			return;
		}

		const format = (isSortedBlobSheet(size) ? 'blob' : TILE_GRAPHIC_FORMATS.find((candidate) => ((TILE_GRAPHIC_SIZES[candidate].width === size.width) && (TILE_GRAPHIC_SIZES[candidate].height === size.height))));

		if ((format !== undefined) && (format !== this.chosenFormat()))
		{
			this.dualGridFormat.checked = (format === 'dualGrid');
			this.blobFormat.checked = (format === 'blob');
			this.showFormat();
		}
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
			showMessage(this.error, t(messages.unreadable));
			this.submitButton.disabled = false;
			return;
		}

		const format = this.chosenFormat();
		const size = await imageSize(previewUrl);
		const sorted = ((format === 'blob') && (size !== undefined) && isSortedBlobSheet(size));

		if (!sorted && ((size?.width !== TILE_GRAPHIC_SIZES[format].width) || (size.height !== TILE_GRAPHIC_SIZES[format].height)))
		{
			this.submitButton.disabled = false;
			reportFieldError(this.file, this.format.textContent ?? '');
			return;
		}

		if (sorted)
		{
			const reordered = await rearrangeSheet(previewUrl, SORTED_BLOB_REARRANGEMENT);

			if (reordered === undefined)
			{
				showMessage(this.error, t(messages.unreadable));
				this.submitButton.disabled = false;
				return;
			}

			previewUrl = reordered;
		}

		this.changes.markSaved();
		this.dialog.close();
		this.onStaged({
			request: {
				name,
				format,
				drawOrder: ((format === 'blob') ? null : this.drawOrder.valueAsNumber),
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
 * Opens an image
 *
 * @param url The image as a data URL
 * @return The loaded image, or undefined when it isn't an image the browser can open
 */
function loadImage(url: string): Promise<HTMLImageElement | undefined>
{
	return(new Promise((resolve) =>
	{
		const image = new Image();

		image.addEventListener('load', () =>
		{
			resolve(image);
		});
		image.addEventListener('error', () =>
		{
			resolve(undefined);
		});
		image.src = url;
	}));
}

/**
 * An image's width and height in pixels
 *
 * @param url The image as a data URL
 * @return Its size, or undefined when it isn't an image the browser can open
 */
async function imageSize(url: string): Promise<{ width: number; height: number } | undefined>
{
	const image = await loadImage(url);

	if (!image)
	{
		return(undefined);
	}

	return({
		width: image.naturalWidth,
		height: image.naturalHeight
	});
}

/**
 * Whether an image is the size of a blob sheet sorted by mask (SORTED_BLOB_SHEET)
 *
 * @param size The image's width and height in pixels
 * @return True when it is that size
 */
function isSortedBlobSheet(size: { width: number; height: number }): boolean
{
	return(((size.width === SORTED_BLOB_SHEET.width) && (size.height === SORTED_BLOB_SHEET.height)));
}

/**
 * How to rearrange a sheet laid out another way into the game's order
 */
interface SheetRearrangement
{
	/**
	 * How many frames wide the sheet as uploaded is
	 */
	sourceColumns: number;

	/**
	 * The size and frames across of the game's sheet
	 */
	width: number;
	height: number;
	columns: number;

	/**
	 * For each frame of the game's sheet, the place in the uploaded sheet it is taken from, or null for
	 * a place left empty
	 */
	sourceFrames: readonly (number | null)[];
}

/**
 * A blob sheet sorted by mask (SORTED_BLOB_SHEET)
 */
const SORTED_BLOB_REARRANGEMENT: SheetRearrangement = {
	sourceColumns: SORTED_BLOB_SHEET.columns,
	width: TILE_GRAPHIC_SIZES.blob.width,
	height: TILE_GRAPHIC_SIZES.blob.height,
	columns: BLOB_SHEET_COLUMNS,
	sourceFrames: BLOB_SHEET_MASKS.map((mask) => ((mask === null) ? null : BLOB_FRAME_MASKS.indexOf(mask)))
};

/**
 * Rearranges a sheet laid out another way into the game's order
 *
 * @param url The sheet as a data URL
 * @param rearrangement Where each of the game's frames is in the sheet
 * @return The rearranged sheet as a PNG data URL, or undefined when the image can't be opened
 */
async function rearrangeSheet(url: string, rearrangement: SheetRearrangement): Promise<string | undefined>
{
	const image = await loadImage(url);
	const canvas = document.createElement('canvas');

	canvas.width = rearrangement.width;
	canvas.height = rearrangement.height;

	const context = canvas.getContext('2d');

	if (!image || !context)
	{
		return(undefined);
	}

	context.imageSmoothingEnabled = false;

	rearrangement.sourceFrames.forEach((source, frame) =>
	{
		if (source === null)
		{
			return;
		}

		const sourceLeft = (source % rearrangement.sourceColumns) * GRID_CELL_SIZE;
		const sourceTop = Math.floor(source / rearrangement.sourceColumns) * GRID_CELL_SIZE;
		const left = (frame % rearrangement.columns) * GRID_CELL_SIZE;
		const top = Math.floor(frame / rearrangement.columns) * GRID_CELL_SIZE;

		context.drawImage(image, sourceLeft, sourceTop, GRID_CELL_SIZE, GRID_CELL_SIZE, left, top, GRID_CELL_SIZE, GRID_CELL_SIZE);
	});

	return(canvas.toDataURL('image/png'));
}
