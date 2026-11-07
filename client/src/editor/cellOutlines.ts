/**
 * A cell to outline, in a color
 */
export interface OutlinedCell
{
	column: number;
	row: number;
	color: number;
}

/**
 * A straight run of cell edges in one color: along a row boundary (horizontal) or a column boundary
 * (vertical), from start up to end, in cells
 */
export interface OutlineRun
{
	color: number;
	vertical: boolean;

	/**
	 * The boundary the run lies on: the row of the cells below it, or the column of the cells to its right
	 */
	line: number;

	start: number;
	end: number;
}

/**
 * The edges of every cell, joined into as few straight runs as possible: one line across a row of
 * cells next to each other instead of an outline for each. Drawn, they outline each cell as outlining
 * it on its own does, so a large block of cells takes a line per row and column of it, not four per cell
 *
 * @param cells The cells, each in its color
 * @return The runs, by color
 */
export function outlineRuns(cells: readonly OutlinedCell[]): OutlineRun[]
{
	const edgesByColor = new Map<number, { horizontal: Map<number, number[]>; vertical: Map<number, number[]> }>();

	/**
	 * Adds a cell edge to a boundary's list
	 *
	 * @param lines The edges on each boundary
	 * @param line The boundary
	 * @param at Where along it the edge starts
	 */
	const addEdge = (lines: Map<number, number[]>, line: number, at: number): void =>
	{
		const edges = lines.get(line);

		if (edges)
		{
			edges.push(at);
		}
		else
		{
			lines.set(line, [at]);
		}
	};

	for (const { column, row, color } of cells)
	{
		let edges = edgesByColor.get(color);

		if (!edges)
		{
			edges = { horizontal: new Map(), vertical: new Map() };
			edgesByColor.set(color, edges);
		}

		addEdge(edges.horizontal, row, column);
		addEdge(edges.horizontal, row + 1, column);
		addEdge(edges.vertical, column, row);
		addEdge(edges.vertical, column + 1, row);
	}

	const runs: OutlineRun[] = [];

	for (const [color, { horizontal, vertical }] of edgesByColor)
	{
		for (const [lines, isVertical] of [[horizontal, false], [vertical, true]] as const)
		{
			for (const [line, starts] of lines)
			{
				starts.sort((a, b) => (a - b));

				let start = starts[0];
				let end = start + 1;

				for (const at of starts.slice(1))
				{
					// Two cells next to each other share an edge, which is in the list twice
					if (at <= end)
					{
						end = Math.max(end, at + 1);
					}
					else
					{
						runs.push({ color, vertical: isVertical, line, start, end });
						start = at;
						end = at + 1;
					}
				}

				runs.push({ color, vertical: isVertical, line, start, end });
			}
		}
	}

	return(runs);
}
