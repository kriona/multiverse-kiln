/**
 * Changes the world editor makes to area maps and the area tree
 *
 * Pure functions: no Colyseus, database, network or timers (CLAUDE.md architecture rule 4)
 */
import { CHUNK_SIZE, DEFAULT_TILE_CELL, cellIndexInChunk, chunkCoordinate, chunkKey, isInBounds, type CellChange, type MapBounds } from '@multiverse-kiln/shared';

/**
 * The chunks a set of cell changes falls in
 *
 * @param changes The changes
 * @return Each chunk's key (see chunkKey) with its column and row
 */
export function chunksOfChanges(changes: readonly CellChange[]): Map<string, { chunkColumn: number; chunkRow: number }>
{
	const chunks = new Map<string, { chunkColumn: number; chunkRow: number }>();

	for (const [column, row] of changes)
	{
		const chunkColumn = chunkCoordinate(column);
		const chunkRow = chunkCoordinate(row);

		chunks.set(chunkKey(chunkColumn, chunkRow), { chunkColumn, chunkRow });
	}

	return(chunks);
}

/**
 * Applies cell changes to the chunks they fall in. A cell listed twice takes the later value
 *
 * @param stored The stored chunks among those the changes fall in, by chunkKey(); a chunk that isn't
 * here is all the default tile
 * @param changes The changes
 * @return The new cells of every chunk the changes fall in, by chunkKey()
 */
export function applyCellChanges(stored: ReadonlyMap<string, readonly number[]>, changes: readonly CellChange[]): Map<string, number[]>
{
	const changed = new Map<string, number[]>();

	for (const [column, row, value] of changes)
	{
		const key = chunkKey(chunkCoordinate(column), chunkCoordinate(row));
		let cells = changed.get(key);

		if (!cells)
		{
			cells = [...(stored.get(key) ?? defaultChunk())];
			changed.set(key, cells);
		}

		cells[cellIndexInChunk(column, row)] = value;
	}

	return(changed);
}

/**
 * Whether every cell of a chunk is the default tile, so the chunk needn't be stored
 *
 * @param cells The chunk's cells
 * @return True when every cell is DEFAULT_TILE_CELL
 */
export function isDefaultChunk(cells: readonly number[]): boolean
{
	return(cells.every((cell) => (cell === DEFAULT_TILE_CELL)));
}

/**
 * Whether a chunk lies entirely inside a map's bounds
 *
 * @param chunkColumn The chunk's column
 * @param chunkRow The chunk's row
 * @param bounds The map's bounds
 * @return True when every cell of the chunk is on the map
 */
export function isChunkInside(chunkColumn: number, chunkRow: number, bounds: MapBounds): boolean
{
	const firstColumn = chunkColumn * CHUNK_SIZE;
	const firstRow = chunkRow * CHUNK_SIZE;

	return(isInBounds(bounds, firstColumn, firstRow) && isInBounds(bounds, firstColumn + CHUNK_SIZE - 1, firstRow + CHUNK_SIZE - 1));
}

/**
 * Resets the cells of a chunk that fall outside a map's bounds to the default tile, so that growing
 * the map again later shows default cells there rather than what was painted before
 *
 * @param chunkColumn The chunk's column
 * @param chunkRow The chunk's row
 * @param cells The chunk's cells
 * @param bounds The map's new bounds
 * @return The chunk's new cells, and how many cells outside the bounds weren't the default tile
 */
export function clipChunk(chunkColumn: number, chunkRow: number, cells: readonly number[], bounds: MapBounds): { cells: number[]; discarded: number }
{
	const clipped = [...cells];
	let discarded = 0;

	for (let rowOffset = 0; rowOffset < CHUNK_SIZE; rowOffset++)
	{
		for (let columnOffset = 0; columnOffset < CHUNK_SIZE; columnOffset++)
		{
			const column = (chunkColumn * CHUNK_SIZE) + columnOffset;
			const row = (chunkRow * CHUNK_SIZE) + rowOffset;
			const index = cellIndexInChunk(column, row);

			if (!isInBounds(bounds, column, row) && (clipped[index] !== DEFAULT_TILE_CELL))
			{
				clipped[index] = DEFAULT_TILE_CELL;
				discarded++;
			}
		}
	}

	return({ cells: clipped, discarded });
}

/**
 * Whether giving an area a new parent would make it its own ancestor
 *
 * @param parents Every area's parent in the universe (null for a top-level area), by area ID
 * @param areaId The area being changed
 * @param parentAreaId Its new parent
 * @return True when the area is the new parent or one of the new parent's ancestors
 */
export function wouldCreateCycle(parents: ReadonlyMap<string, string | null>, areaId: string, parentAreaId: string): boolean
{
	const visited = new Set<string>();
	let current: string | null | undefined = parentAreaId;

	while ((current !== null) && (current !== undefined) && !visited.has(current))
	{
		if (current === areaId)
		{
			return(true);
		}

		visited.add(current);
		current = parents.get(current);
	}

	return(false);
}

/**
 * A chunk whose cells are all the default tile
 *
 * @return The cells
 */
function defaultChunk(): number[]
{
	return(new Array<number>(CHUNK_SIZE * CHUNK_SIZE).fill(DEFAULT_TILE_CELL));
}
