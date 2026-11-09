import type { CellChange, AreaBounds } from '@multiverse-kiln/shared';

/**
 * Most steps the editor can undo
 */
const MAX_STEPS = 200;

/**
 * One undoable change to an area's cells: everything a single click or drag painted, or one change of
 * the area's size, with the cells a smaller area cut off set to the default tile
 */
export interface EditStep
{
	/**
	 * The cells and the values they were given
	 */
	changes: CellChange[];

	/**
	 * The same cells and the values they had before
	 */
	inverse: CellChange[];

	/**
	 * For a change of the area's size, its bounds before and after
	 */
	bounds?: {
		before: AreaBounds;
		after: AreaBounds;
	};
}

/**
 * A cell another editor saved, with its value as saved before and now
 */
export interface SavedCell
{
	column: number;
	row: number;
	before: number;
	after: number;
}

/**
 * Bounds that hold no cells, for extendBounds() to grow
 *
 * @return The bounds, with minimums above maximums
 */
function emptyBounds(): AreaBounds
{
	return({
		minColumn: Infinity,
		minRow: Infinity,
		maxColumn: -Infinity,
		maxRow: -Infinity
	});
}

/**
 * Grows bounds to hold a cell
 *
 * @param bounds The bounds, changed in place
 * @param column The cell's column
 * @param row The cell's row
 */
function extendBounds(bounds: AreaBounds, column: number, row: number): void
{
	bounds.minColumn = Math.min(bounds.minColumn, column);
	bounds.minRow = Math.min(bounds.minRow, row);
	bounds.maxColumn = Math.max(bounds.maxColumn, column);
	bounds.maxRow = Math.max(bounds.maxRow, row);
}

/**
 * Whether two bounds share a cell
 *
 * @param a One bounds
 * @param b The other
 * @return True when they do, false when they don't or either holds no cells
 */
function boundsOverlap(a: AreaBounds, b: AreaBounds): boolean
{
	return((a.minColumn <= b.maxColumn) && (b.minColumn <= a.maxColumn) && (a.minRow <= b.maxRow) && (b.minRow <= a.maxRow));
}

/**
 * Undo and redo for the area editor's cells
 */
export class EditHistory
{
	private readonly undoSteps: EditStep[] = [];
	private readonly redoSteps: EditStep[] = [];

	/**
	 * Each step's cells' bounds, for rebasing to skip the steps that changed none of the cells saved
	 */
	private readonly cellBounds = new WeakMap<EditStep, AreaBounds>();

	/**
	 * Whether there is a step to undo
	 *
	 * @return True when there is
	 */
	get canUndo(): boolean
	{
		return(this.undoSteps.length > 0);
	}

	/**
	 * Whether there is a step to redo
	 *
	 * @return True when there is
	 */
	get canRedo(): boolean
	{
		return(this.redoSteps.length > 0);
	}

	/**
	 * Records a step just made, which can no longer be followed by the steps that were undone
	 *
	 * @param step The step
	 */
	push(step: EditStep): void
	{
		this.undoSteps.push(step);
		this.redoSteps.length = 0;

		if (this.undoSteps.length > MAX_STEPS)
		{
			this.undoSteps.shift();
		}
	}

	/**
	 * Takes the latest step to undo; apply its inverse
	 *
	 * @return The step, or undefined when there is none
	 */
	undo(): EditStep | undefined
	{
		const step = this.undoSteps.pop();

		if (step)
		{
			this.redoSteps.push(step);
		}

		return(step);
	}

	/**
	 * Takes the latest step undone to make again; apply its changes
	 *
	 * @return The step, or undefined when there is none
	 */
	redo(): EditStep | undefined
	{
		const step = this.redoSteps.pop();

		if (step)
		{
			this.undoSteps.push(step);
		}

		return(step);
	}

	/**
	 * Follows cells another editor saved: wherever a step holds a cell's value as it was saved before, it
	 * holds the value saved now, so undoing back to the saved area gives the cells as they are saved
	 *
	 * @param cells Each cell's value as saved before and now
	 */
	rebase(cells: readonly SavedCell[]): void
	{
		if (cells.length === 0)
		{
			return;
		}

		const byColumn = new Map<number, Map<number, SavedCell>>();
		const savedBounds = emptyBounds();

		for (const cell of cells)
		{
			let column = byColumn.get(cell.column);

			if (!column)
			{
				column = new Map();
				byColumn.set(cell.column, column);
			}

			column.set(cell.row, cell);
			extendBounds(savedBounds, cell.column, cell.row);
		}

		for (const step of [...this.undoSteps, ...this.redoSteps])
		{
			if (!boundsOverlap(this.cellBoundsOf(step), savedBounds))
			{
				continue;
			}

			for (const list of [step.changes, step.inverse])
			{
				for (let index = 0; index < list.length; index++)
				{
					const [column, row, value] = list[index];
					const saved = byColumn.get(column)?.get(row);

					if (saved && (saved.before === value))
					{
						list[index] = [column, row, saved.after];
					}
				}
			}
		}
	}

	/**
	 * The smallest bounds holding every cell a step changes, worked out the first time it's asked for.
	 * Rebasing only changes the cells' values, so the bounds stay right for as long as the step is kept
	 *
	 * @param step The step
	 * @return Its cells' bounds, with minimums above maximums when it changes no cells
	 */
	private cellBoundsOf(step: EditStep): AreaBounds
	{
		let bounds = this.cellBounds.get(step);

		if (!bounds)
		{
			bounds = emptyBounds();

			for (const list of [step.changes, step.inverse])
			{
				for (const [column, row] of list)
				{
					extendBounds(bounds, column, row);
				}
			}

			this.cellBounds.set(step, bounds);
		}

		return(bounds);
	}

	/**
	 * Forgets every step, for when another area opens
	 */
	clear(): void
	{
		this.undoSteps.length = 0;
		this.redoSteps.length = 0;
	}
}
