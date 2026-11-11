import { MAX_AREA_SIDE, type AreaBounds } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { describeEditorError } from '../../network/editorApi';
import { announce } from '../announcer';
import { ChangeTracker } from '../changeTracker';
import { getElement, setButtonText, showMessage } from '../dom';

/**
 * The sides of an area, as the dialog's fields and Extend Size buttons name them
 */
type Side = 'north' | 'east' | 'south' | 'west';

const sides: Side[] = [
	'north',
	'east',
	'south',
	'west'
];

/**
 * What a smaller area would cut off
 */
export interface ResizeLoss
{
	/**
	 * Cells painted with something other than the default tile
	 */
	cells: number;

	/**
	 * The area's links on the cells
	 */
	links: number;
}

/**
 * The area a resize is for, and what happens when it is resized
 */
interface ResizeTarget
{
	bounds: AreaBounds;

	/**
	 * Finds out what new bounds would cut off
	 */
	check: (bounds: AreaBounds) => Promise<ResizeLoss>;

	/**
	 * Called with the new bounds when the player resizes the area
	 */
	onResize: (bounds: AreaBounds) => void;
}

/**
 * Edit Size: how far an area reaches from its center cell in each direction, with the total size, Extend
 * Size buttons that add a number of cells to one side's field, and a warning before a smaller area cuts
 * off painted cells or links
 */
export class ResizeDialog
{
	private readonly dialog = getElement('resize-dialog', HTMLDialogElement);
	private readonly form = getElement('resize-form', HTMLFormElement);
	private readonly north = getElement('resize-north', HTMLInputElement);
	private readonly east = getElement('resize-east', HTMLInputElement);
	private readonly south = getElement('resize-south', HTMLInputElement);
	private readonly west = getElement('resize-west', HTMLInputElement);
	private readonly extendBy = getElement('resize-extend-by', HTMLInputElement);
	private readonly total = getElement('resize-total', HTMLElement);
	private readonly warning = getElement('resize-warning', HTMLElement);
	private readonly submit = getElement('resize-submit', HTMLButtonElement);

	/**
	 * Whether the sides have changed from the area's bounds. Extend by is left out, since it only sets how
	 * far the Extend Size buttons reach
	 */
	private readonly changes = new ChangeTracker({ root: this.form });

	private target: ResizeTarget | undefined;

	/**
	 * The bounds the player has agreed may cut off cells and links, so submitting them again goes ahead
	 */
	private confirmedBounds: string | undefined;

	/**
	 * Sets up the dialog's fields and buttons
	 */
	constructor()
	{
		for (const input of [this.north, this.east, this.south, this.west])
		{
			input.max = String(MAX_AREA_SIDE - 1);

			input.addEventListener('input', () =>
			{
				this.updateTotal();
			});
		}

		this.extendBy.max = String(MAX_AREA_SIDE - 1);

		for (const side of sides)
		{
			getElement(`resize-extend-${side}`, HTMLButtonElement).addEventListener('click', () =>
			{
				this.extend(side);
			});
		}

		this.changes.guardDialog(this.dialog);

		getElement('resize-cancel', HTMLButtonElement).addEventListener('click', () =>
		{
			if (this.changes.confirmDiscard())
			{
				this.dialog.close();
			}
		});

		this.form.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.resize();
		});
	}

	/**
	 * Opens the dialog with an area's bounds
	 *
	 * @param target The area and what to do when it is resized
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
		this.changes.markSaved();
	}

	/**
	 * Adds the number of cells in Extend by to one side's field, and reads out the new total size
	 *
	 * @param side The side
	 */
	private extend(side: Side): void
	{
		const field = this.sideField(side);
		const cells = this.extendBy.valueAsNumber;
		const current = field.valueAsNumber;

		// reportValidity() shows the field's problem; an empty field has none to show
		if (!this.extendBy.reportValidity() || !Number.isInteger(cells))
		{
			this.extendBy.focus();
			return;
		}

		field.value = String((Number.isInteger(current) ? current : 0) + cells);
		this.updateTotal();
		this.changes.check();

		// The warning is an alert, read out by itself
		if (this.warning.hidden)
		{
			announce(this.total.textContent ?? '');
		}
	}

	/**
	 * The field for how far the area reaches on one side
	 *
	 * @param side The side
	 * @return The field
	 */
	private sideField(side: Side): HTMLInputElement
	{
		if (side === 'north')
		{
			return(this.north);
		}
		else if (side === 'east')
		{
			return(this.east);
		}
		else if (side === 'south')
		{
			return(this.south);
		}

		return(this.west);
	}

	/**
	 * The bounds the inputs describe
	 *
	 * @return The bounds
	 */
	private bounds(): AreaBounds
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
		const tooLarge = (valid && ((width > MAX_AREA_SIDE) || (height > MAX_AREA_SIDE)));

		this.confirmedBounds = undefined;
		setButtonText(this.submit, t({
			id: 'editor.resize.submit',
			defaultMessage: 'Resize',
			description: 'Button that changes the area to the size given'
		}));
		this.submit.disabled = (!valid || tooLarge);
		this.total.textContent = (valid
			? t({
				id: 'editor.resize.total',
				defaultMessage: '{height, number} tall x {width, number} wide',
				description: 'The size of the area the dialog\'s fields describe, in cells'
			}, {
				height,
				width
			})
			: '');
		showMessage(this.warning, (tooLarge
			? t({
				id: 'editor.area.tooLarge',
				defaultMessage: 'An area can be at most {max, number} cells in each direction.',
				description: 'Shown when the size asked for an area is larger than allowed; {max} is the most cells on a side'
			}, {
				max: MAX_AREA_SIDE
			})
			: undefined));
	}

	/**
	 * Resizes the area. If that would cut anything off, explains what and waits for the player to submit again
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
			if (this.confirmedBounds !== key)
			{
				const loss = await target.check(bounds);

				if ((loss.cells > 0) || (loss.links > 0))
				{
					this.confirmedBounds = key;
					setButtonText(this.submit, t({
						id: 'editor.resize.discard',
						defaultMessage: 'Resize and Discard',
						description: 'Button that makes the area smaller after the player was warned it loses painting or links'
					}));
					showMessage(this.warning, t({
						id: 'editor.resize.cutOffWarning',
						defaultMessage: 'The smaller area cuts off {cells, plural, one {# painted cell} other {# painted cells}} and {links, plural, one {# link} other {# links}}. Undo brings the cells back, but the links are deleted when the area is saved. Resize anyway?',
						description: 'Warns before making an area smaller cuts off cells painted with something other than the default tile, and area links'
					}, {
						cells: loss.cells,
						links: loss.links
					}));
					return;
				}
			}

			this.dialog.close();
			target.onResize(bounds);
		}
		catch (error)
		{
			showMessage(this.warning, describeEditorError(error, {
				id: 'editor.resize.failed',
				defaultMessage: 'Could not resize the area.',
				description: 'Shown in the Edit Size dialog when the area\'s size couldn\'t be changed'
			}));
		}
		finally
		{
			this.submit.disabled = false;
		}
	}
}
