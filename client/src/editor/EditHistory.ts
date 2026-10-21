import type { CellChange, MapBounds } from '@multiverse-kiln/shared';

/**
 * Most steps the editor can undo
 */
const MAX_STEPS = 200;

/**
 * One undoable change to a map: everything a single click or drag painted, or one change of the map's
 * size, with the cells a smaller map cut off set to the default tile
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
	 * For a change of the map's size, its bounds before and after
	 */
	bounds?: {
		before: MapBounds;
		after: MapBounds;
	};
}

/**
 * Undo and redo for the map editor
 */
export class EditHistory
{
	private readonly undoSteps: EditStep[] = [];
	private readonly redoSteps: EditStep[] = [];

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
	 * Forgets every step, for when another map opens
	 */
	clear(): void
	{
		this.undoSteps.length = 0;
		this.redoSteps.length = 0;
	}
}
