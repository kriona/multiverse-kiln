import { MAX_MAP_SIDE, type MapBounds } from '@multiverse-kiln/shared';

import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { getElement, showMessage } from '../dom';

/**
 * The zone a resize is for, and what happens once it is resized
 */
interface ResizeTarget
{
	universeId: string;
	zoneId: string;
	bounds: MapBounds;

	/**
	 * Called with the new bounds once the map has been resized
	 */
	onResized: (bounds: MapBounds) => void;
}

/**
 * Edit Size: how far a map reaches from its center cell in each direction, with the total size, and a
 * warning before a smaller map discards painted cells or links
 */
export class ResizeDialog
{
	private readonly dialog = getElement('resize-dialog', HTMLDialogElement);
	private readonly form = getElement('resize-form', HTMLFormElement);
	private readonly north = getElement('resize-north', HTMLInputElement);
	private readonly east = getElement('resize-east', HTMLInputElement);
	private readonly south = getElement('resize-south', HTMLInputElement);
	private readonly west = getElement('resize-west', HTMLInputElement);
	private readonly total = getElement('resize-total', HTMLElement);
	private readonly warning = getElement('resize-warning', HTMLElement);
	private readonly submit = getElement('resize-submit', HTMLButtonElement);

	private target: ResizeTarget | undefined;

	/**
	 * The bounds the player has agreed may discard cells and links, so submitting them again goes ahead
	 */
	private confirmedBounds: string | undefined;

	/**
	 * @param api The editor's API
	 */
	constructor(private readonly api: EditorApi)
	{
		for (const input of [this.north, this.east, this.south, this.west])
		{
			input.max = String(MAX_MAP_SIDE - 1);

			input.addEventListener('input', () =>
			{
				this.updateTotal();
			});
		}

		getElement('resize-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			this.dialog.close();
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.resize();
		});
	}

	/**
	 * Opens the dialog with a map's bounds
	 *
	 * @param target The zone and what to do once it is resized
	 */
	open(target: ResizeTarget): void
	{
		this.target = target;
		this.north.value = String(-target.bounds.minRow);
		this.south.value = String(target.bounds.maxRow);
		this.west.value = String(-target.bounds.minColumn);
		this.east.value = String(target.bounds.maxColumn);
		this.updateTotal();
		this.dialog.showModal();
	}

	/**
	 * The bounds the inputs describe
	 *
	 * @return The bounds
	 */
	private bounds(): MapBounds
	{
		return({
			minColumn: -this.west.valueAsNumber,
			minRow: -this.north.valueAsNumber,
			maxColumn: this.east.valueAsNumber,
			maxRow: this.south.valueAsNumber
		});
	}

	/**
	 * Shows the total size, and forgets any agreement to discard, since the bounds have changed
	 */
	private updateTotal(): void
	{
		const bounds = this.bounds();
		const width = (bounds.maxColumn - bounds.minColumn) + 1;
		const height = (bounds.maxRow - bounds.minRow) + 1;
		const valid = (Number.isInteger(width) && Number.isInteger(height));
		const tooLarge = (valid && ((width > MAX_MAP_SIDE) || (height > MAX_MAP_SIDE)));

		this.confirmedBounds = undefined;
		this.submit.textContent = 'Resize';
		this.submit.disabled = (!valid || tooLarge);
		this.total.textContent = (valid ? `${height} tall x ${width} wide` : '');
		showMessage(this.warning, (tooLarge ? `A map can be at most ${MAX_MAP_SIDE} cells in each direction.` : undefined));
	}

	/**
	 * Resizes the map. If that would discard anything, explains what and waits for the player to submit again
	 */
	private async resize(): Promise<void>
	{
		const target = this.target;
		const bounds = this.bounds();
		const key = JSON.stringify(bounds);

		if (!target)
		{
			return;
		}

		this.submit.disabled = true;

		try
		{
			const conflict = await this.api.resizeZone(target.universeId, target.zoneId, bounds, (this.confirmedBounds === key));

			if (conflict)
			{
				this.confirmedBounds = key;
				this.submit.textContent = 'Resize and discard';
				showMessage(this.warning, `The smaller map would discard ${describeCount(conflict.discardedCells, 'painted cell')} and ${describeCount(conflict.discardedLinks, 'link')}. Resize anyway?`);
				return;
			}

			this.dialog.close();
			target.onResized(bounds);
		}
		catch (error)
		{
			showMessage(this.warning, describeEditorError(error, 'resize the map'));
		}
		finally
		{
			this.submit.disabled = false;
		}
	}
}

/**
 * A count with its noun, made plural when needed
 *
 * @param count How many
 * @param noun The noun for one
 * @return e.g. "1 link" or "3 links"
 */
function describeCount(count: number, noun: string): string
{
	return(`${count} ${noun}${(count === 1) ? '' : 's'}`);
}
