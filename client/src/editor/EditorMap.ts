import { cellIndexInChunk, CHUNK_SIZE, chunkCoordinate, chunkKey, DEFAULT_TILE_CELL, isInBounds, type CellChange, type ChunkRange, type MapBounds, type AreaChunk } from '@multiverse-kiln/shared';

/**
 * The cells of an area's map as the editor holds them: the chunks loaded so far, which the editor
 * changes as the player paints
 *
 * A chunk the server doesn't store is all the default tile, but the editor only knows that once it
 * has asked for it, so a cell whose chunk hasn't loaded has no value yet and can't be painted
 */
export class EditorMap
{
	/**
	 * The loaded chunks that hold anything but the default tile, by chunkKey(); shared with the
	 * renderer, which draws from it
	 */
	readonly chunks = new Map<string, number[]>();

	/**
	 * Every chunk loaded, whether stored or not, by chunkKey()
	 */
	private readonly loaded = new Set<string>();

	/**
	 * @param bounds The map's bounds
	 */
	constructor(private currentBounds: MapBounds)
	{
	}

	/**
	 * The map's bounds
	 *
	 * @return The bounds
	 */
	get bounds(): MapBounds
	{
		return(this.currentBounds);
	}

	/**
	 * Grows the map. The loaded chunks stay right: cells outside the old bounds were always the default tile
	 *
	 * @param bounds The new bounds, holding all of the old ones
	 */
	grow(bounds: MapBounds): void
	{
		this.currentBounds = bounds;
	}

	/**
	 * Every chunk the map covers, inclusive at both ends
	 *
	 * @return The range
	 */
	get chunkRange(): ChunkRange
	{
		return({
			minChunkColumn: chunkCoordinate(this.bounds.minColumn),
			minChunkRow: chunkCoordinate(this.bounds.minRow),
			maxChunkColumn: chunkCoordinate(this.bounds.maxColumn),
			maxChunkRow: chunkCoordinate(this.bounds.maxRow)
		});
	}

	/**
	 * Whether a chunk has loaded
	 *
	 * @param chunkColumn The chunk's column
	 * @param chunkRow The chunk's row
	 * @return True once it has
	 */
	isLoaded(chunkColumn: number, chunkRow: number): boolean
	{
		return(this.loaded.has(chunkKey(chunkColumn, chunkRow)));
	}

	/**
	 * Takes in the chunks the server sent for a range. Chunks in the range that are already loaded are
	 * left alone, so a load that arrives after the player has painted doesn't undo the painting
	 *
	 * @param range The range that was asked for
	 * @param chunks The stored chunks in it
	 * @return The keys of the chunks that were newly loaded
	 */
	load(range: ChunkRange, chunks: readonly AreaChunk[]): string[]
	{
		const stored = new Map(chunks.map((chunk) => [chunkKey(chunk.chunkColumn, chunk.chunkRow), chunk.cells]));
		const newlyLoaded: string[] = [];

		for (let chunkRow = range.minChunkRow; chunkRow <= range.maxChunkRow; chunkRow++)
		{
			for (let chunkColumn = range.minChunkColumn; chunkColumn <= range.maxChunkColumn; chunkColumn++)
			{
				const key = chunkKey(chunkColumn, chunkRow);
				const cells = stored.get(key);

				if (this.loaded.has(key))
				{
					continue;
				}

				this.loaded.add(key);
				newlyLoaded.push(key);

				if (cells)
				{
					this.chunks.set(key, [...cells]);
				}
			}
		}

		return(newlyLoaded);
	}

	/**
	 * A cell's value
	 *
	 * @param column The cell's column
	 * @param row The cell's row
	 * @return A tile ID, DEFAULT_TILE_CELL or VOID_CELL; undefined for a cell off the map or whose chunk hasn't loaded
	 */
	valueAt(column: number, row: number): number | undefined
	{
		const key = chunkKey(chunkCoordinate(column), chunkCoordinate(row));

		if (!isInBounds(this.bounds, column, row) || !this.loaded.has(key))
		{
			return(undefined);
		}

		return(this.chunks.get(key)?.[cellIndexInChunk(column, row)] ?? DEFAULT_TILE_CELL);
	}

	/**
	 * Changes cells. Every cell must be on the map and in a loaded chunk
	 *
	 * @param changes The cells and their new values
	 * @return The keys of the chunks that changed
	 */
	apply(changes: readonly CellChange[]): Set<string>
	{
		const touched = new Set<string>();

		for (const [column, row, value] of changes)
		{
			const key = chunkKey(chunkCoordinate(column), chunkCoordinate(row));
			let cells = this.chunks.get(key);

			if (!cells)
			{
				cells = new Array<number>(CHUNK_SIZE * CHUNK_SIZE).fill(DEFAULT_TILE_CELL);
				this.chunks.set(key, cells);
			}

			cells[cellIndexInChunk(column, row)] = value;
			touched.add(key);
		}

		return(touched);
	}
}
