import { chunkCoordinate, chunkKey, MAX_CHUNKS_PER_REQUEST, type ChunkListPayload, type ChunkRange, type MapBounds } from '@multiverse-kiln/shared';

import type { EditorMap } from './EditorMap';

/**
 * Loads the stored chunks in a range of an area's map, such as from the editor's API
 */
export type ChunkSource = (range: ChunkRange) => Promise<ChunkListPayload>;

/**
 * Chunks along each side of the blocks the loader asks for: a block is as large as one request may be
 */
const BLOCK_SIDE = Math.floor(Math.sqrt(MAX_CHUNKS_PER_REQUEST));

/**
 * Loads an area's chunks into an EditorMap as the editor's view reaches them
 *
 * The map is split into square blocks of chunks, and each block is asked for once, the first time
 * the view touches it. Loaded chunks are kept: maps are only loaded where someone looks, and the
 * editor needs every chunk it has painted
 */
export class ChunkLoader
{
	/**
	 * Blocks asked for, loaded or still on their way, by chunkKey() of the block
	 */
	private readonly requested = new Set<string>();

	private stopped = false;

	/**
	 * @param source Loads the area's stored chunks
	 * @param map Where the chunks go
	 * @param onLoaded Called with the keys of the chunks each block newly loaded
	 * @param onError Called when a block couldn't be loaded; it will be asked for again next time the view reaches it
	 */
	constructor(
		private readonly source: ChunkSource,
		private readonly map: EditorMap,
		private readonly onLoaded: (chunkKeys: string[]) => void,
		private readonly onError: (error: unknown) => void
	)
	{
	}

	/**
	 * Asks for the blocks a range of chunks touches that haven't been asked for yet
	 *
	 * @param view The chunks the editor can see, or nearly
	 */
	request(view: ChunkRange): void
	{
		const area = this.map.chunkRange;
		const minChunkColumn = Math.max(view.minChunkColumn, area.minChunkColumn);
		const maxChunkColumn = Math.min(view.maxChunkColumn, area.maxChunkColumn);
		const minChunkRow = Math.max(view.minChunkRow, area.minChunkRow);
		const maxChunkRow = Math.min(view.maxChunkRow, area.maxChunkRow);

		for (let blockRow = Math.floor(minChunkRow / BLOCK_SIDE); blockRow <= Math.floor(maxChunkRow / BLOCK_SIDE); blockRow++)
		{
			for (let blockColumn = Math.floor(minChunkColumn / BLOCK_SIDE); blockColumn <= Math.floor(maxChunkColumn / BLOCK_SIDE); blockColumn++)
			{
				const key = chunkKey(blockColumn, blockRow);

				if (!this.requested.has(key))
				{
					this.requested.add(key);
					void this.loadBlock(key, {
						minChunkColumn: Math.max(blockColumn * BLOCK_SIDE, area.minChunkColumn),
						minChunkRow: Math.max(blockRow * BLOCK_SIDE, area.minChunkRow),
						maxChunkColumn: Math.min(((blockColumn + 1) * BLOCK_SIDE) - 1, area.maxChunkColumn),
						maxChunkRow: Math.min(((blockRow + 1) * BLOCK_SIDE) - 1, area.maxChunkRow)
					});
				}
			}
		}
	}

	/**
	 * Loads every chunk of the map that isn't wholly inside some bounds, such as the chunks a smaller map
	 * would cut off, a block at a time
	 *
	 * @param bounds The bounds
	 * @return Resolves once they have all loaded, or the loader has stopped; rejects when a block couldn't be loaded
	 */
	async loadOutside(bounds: MapBounds): Promise<void>
	{
		const area = this.map.chunkRange;
		const inner = {
			minChunkColumn: chunkCoordinate(bounds.minColumn - 1) + 1,
			minChunkRow: chunkCoordinate(bounds.minRow - 1) + 1,
			maxChunkColumn: chunkCoordinate(bounds.maxColumn + 1) - 1,
			maxChunkRow: chunkCoordinate(bounds.maxRow + 1) - 1
		};

		for (let blockRow = Math.floor(area.minChunkRow / BLOCK_SIDE); blockRow <= Math.floor(area.maxChunkRow / BLOCK_SIDE); blockRow++)
		{
			for (let blockColumn = Math.floor(area.minChunkColumn / BLOCK_SIDE); blockColumn <= Math.floor(area.maxChunkColumn / BLOCK_SIDE); blockColumn++)
			{
				const range = {
					minChunkColumn: Math.max(blockColumn * BLOCK_SIDE, area.minChunkColumn),
					minChunkRow: Math.max(blockRow * BLOCK_SIDE, area.minChunkRow),
					maxChunkColumn: Math.min(((blockColumn + 1) * BLOCK_SIDE) - 1, area.maxChunkColumn),
					maxChunkRow: Math.min(((blockRow + 1) * BLOCK_SIDE) - 1, area.maxChunkRow)
				};
				const insideOnly = (
					(range.minChunkColumn >= inner.minChunkColumn) &&
					(range.maxChunkColumn <= inner.maxChunkColumn) &&
					(range.minChunkRow >= inner.minChunkRow) &&
					(range.maxChunkRow <= inner.maxChunkRow)
				);

				if (this.stopped || insideOnly || this.isRangeLoaded(range))
				{
					continue;
				}

				const { chunks } = await this.source(range);

				if (!this.stopped)
				{
					this.onLoaded(this.map.load(range, chunks));
				}
			}
		}
	}

	/**
	 * Whether every chunk in a range has loaded
	 *
	 * @param range The chunks
	 * @return True when they all have
	 */
	private isRangeLoaded(range: ChunkRange): boolean
	{
		for (let chunkRow = range.minChunkRow; chunkRow <= range.maxChunkRow; chunkRow++)
		{
			for (let chunkColumn = range.minChunkColumn; chunkColumn <= range.maxChunkColumn; chunkColumn++)
			{
				if (!this.map.isLoaded(chunkColumn, chunkRow))
				{
					return(false);
				}
			}
		}

		return(true);
	}

	/**
	 * Stops taking in chunks, for when the editor moves on to another area or map
	 */
	stop(): void
	{
		this.stopped = true;
	}

	/**
	 * Loads one block of chunks
	 *
	 * @param key The block's key
	 * @param range The chunks in the block that are on the map
	 */
	private async loadBlock(key: string, range: ChunkRange): Promise<void>
	{
		try
		{
			const { chunks } = await this.source(range);

			if (!this.stopped)
			{
				this.onLoaded(this.map.load(range, chunks));
			}
		}
		catch (error)
		{
			this.requested.delete(key);

			if (!this.stopped)
			{
				this.onError(error);
			}
		}
	}
}
