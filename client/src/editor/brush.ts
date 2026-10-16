/**
 * The draw tool's brush: which cells one dab covers
 */

/**
 * The shapes the brush comes in
 */
export const BRUSH_SHAPES = ['square', 'circle'] as const;

export type BrushShape = typeof BRUSH_SHAPES[number];

/**
 * A cell of a map
 */
export interface BrushCell
{
	column: number;
	row: number;
}

/**
 * The top-left cell of the square a brush covers, around the cell under the pointer
 *
 * @param column The column under the pointer
 * @param row The row under the pointer
 * @param size Cells across the brush
 * @return The top-left cell
 */
export function brushOrigin(column: number, row: number, size: number): BrushCell
{
	const reach = Math.floor((size - 1) / 2);

	return({
		column: column - reach,
		row: row - reach
	});
}

/**
 * The cells one dab of the brush covers. The pointer's cell is in the middle, or just right of and
 * below the middle for an even size
 *
 * @param column The column under the pointer
 * @param row The row under the pointer
 * @param size Cells across the brush, at least 1
 * @param shape The brush's shape; a circle covers the cells whose centers are inside it
 * @return The cells
 */
export function brushCells(column: number, row: number, size: number, shape: BrushShape): BrushCell[]
{
	const origin = brushOrigin(column, row, size);
	const radius = size / 2;
	const cells: BrushCell[] = [];

	for (let rowOffset = 0; rowOffset < size; rowOffset++)
	{
		for (let columnOffset = 0; columnOffset < size; columnOffset++)
		{
			const fromCenterX = (columnOffset + 0.5) - radius;
			const fromCenterY = (rowOffset + 0.5) - radius;

			if ((shape === 'square') || (((fromCenterX * fromCenterX) + (fromCenterY * fromCenterY)) <= (radius * radius)))
			{
				cells.push({
					column: origin.column + columnOffset,
					row: origin.row + rowOffset
				});
			}
		}
	}

	return(cells);
}

/**
 * The cells on a straight line between two cells, both ends included, so a quick drag leaves no gaps
 *
 * @param from Where the line starts
 * @param to Where it ends
 * @param spacing Cells between the points returned, at least 1; a large brush needn't dab every cell
 * @return The cells, from start to end
 */
export function cellsBetween(from: BrushCell, to: BrushCell, spacing: number): BrushCell[]
{
	const steps = Math.max(
		Math.abs(to.column - from.column),
		Math.abs(to.row - from.row)
	);
	const count = Math.max(1, Math.ceil(steps / spacing));
	const cells: BrushCell[] = [];

	for (let step = 0; step <= count; step++)
	{
		const progress = ((steps === 0) ? 1 : (step / count));

		cells.push({
			column: Math.round(from.column + ((to.column - from.column) * progress)),
			row: Math.round(from.row + ((to.row - from.row) * progress))
		});
	}

	return(cells);
}
