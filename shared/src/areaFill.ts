/**
 * The world editor's fill tool: which cells of an area one fill paints
 */

import { isInBounds, type AreaBounds } from './areaCells.js';

/**
 * Fills of more cells than this ask the editor first
 */
export const FILL_CONFIRM_CELLS = 1000;

/**
 * The cells a fill would paint
 */
export interface AreaFill
{
	/**
	 * Each cell's column and row, the cell filled from first
	 */
	cells: Array<[number, number]>;

	/**
	 * False when the fill reached a cell whose value isn't known yet, such as one in a chunk that hasn't
	 * loaded: the cells are then only those it reached before, and the fill should be worked out again
	 * once every cell is known
	 */
	complete: boolean;
}

/**
 * The cells a fill from one cell paints: that cell and every cell joined to it to the north, east,
 * south or west holding the same tile, within the area's bounds. It never wraps around the area's edges,
 * so a looping area's far side, and any area beside it, is left alone
 *
 * @param bounds The area's bounds
 * @param column The column of the cell filled from
 * @param row The row of the cell filled from
 * @param valueAt A cell's value, or undefined when it isn't known yet
 * @param sameTile Whether two values show the same tile, such as the area's default tile stored either way
 * @return The cells, none when the cell filled from is outside the area
 */
export function areaFill(bounds: AreaBounds, column: number, row: number, valueAt: (column: number, row: number) => number | undefined, sameTile: (first: number, second: number) => boolean): AreaFill
{
	const width = (bounds.maxColumn - bounds.minColumn) + 1;
	const height = (bounds.maxRow - bounds.minRow) + 1;
	const filled: AreaFill = {
		cells: [],
		complete: true
	};

	if (!isInBounds(bounds, column, row))
	{
		return(filled);
	}

	const target = valueAt(column, row);

	if (target === undefined)
	{
		filled.complete = false;
		return(filled);
	}

	// Each cell is queued once, by its index in the bounds, row by row from the top left
	const queued = new Uint8Array(width * height);
	const pending: number[] = [((row - bounds.minRow) * width) + (column - bounds.minColumn)];

	queued[pending[0]] = 1;

	/**
	 * Queues a cell beside one filled, unless it is outside the area or already queued
	 *
	 * @param nextColumn The cell's column
	 * @param nextRow The cell's row
	 */
	const queue = (nextColumn: number, nextRow: number): void =>
	{
		if (!isInBounds(bounds, nextColumn, nextRow))
		{
			return;
		}

		const index = ((nextRow - bounds.minRow) * width) + (nextColumn - bounds.minColumn);

		if (queued[index] === 0)
		{
			queued[index] = 1;
			pending.push(index);
		}
	};

	for (let next = 0; next < pending.length; next++)
	{
		const index = pending[next];
		const cellColumn = bounds.minColumn + (index % width);
		const cellRow = bounds.minRow + Math.floor(index / width);
		const value = valueAt(cellColumn, cellRow);

		if (value === undefined)
		{
			filled.complete = false;
			continue;
		}

		if (!sameTile(value, target))
		{
			continue;
		}

		filled.cells.push([cellColumn, cellRow]);
		queue(cellColumn, cellRow - 1);
		queue(cellColumn + 1, cellRow);
		queue(cellColumn, cellRow + 1);
		queue(cellColumn - 1, cellRow);
	}

	return(filled);
}
