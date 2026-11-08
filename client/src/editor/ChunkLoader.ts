import { chunkCoordinate, chunkKey, MAX_CHUNKS_PER_REQUEST, type AreaChunk, type ChunkCoordinates, type ChunkListPayload, type ChunkRange, type MapBounds } from '@multiverse-kiln/shared';

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
 * A request for a range of chunks that hasn't been answered yet
 */
interface PendingLoad
{
	/**
	 * The chunks asked for
	 */
	range: ChunkRange;

	/**
	 * Whether another editor saved painting in the range while the request was on its way, so the
	 * answer may hold the cells from before that save
	 */
	stale: boolean;
}

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

	/**
	 * The requests for chunks to load into the map that haven't been answered yet
	 */
	private readonly pending = new Set<PendingLoad>();

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

				const chunks = await this.fetch(range);

				if (!this.stopped)
				{
					this.onLoaded(this.map.load(range, chunks));
				}
			}
		}
	}

	/**
	 * Loads some of the map's chunks again as they are stored now, such as the chunks another editor
	 * painted, without changing the map. Only chunks on the map that have loaded are asked for, the
	 * chunks in one block in one request. A chunk still loading is asked for again once its answer
	 * comes, since the server may have read it before the painting was saved
	 *
	 * @param chunks The chunks
	 * @return Each chunk asked for, by chunkKey(), with its stored cells, or undefined for one that is all
	 * the default tile; empty once the loader has stopped
	 */
	async reload(chunks: readonly ChunkCoordinates[]): Promise<Map<string, number[] | undefined>>
	{
		const area = this.map.chunkRange;
		const blocks = new Map<string, ChunkRange>();
		const reloaded = new Map<string, number[] | undefined>();

		for (const { chunkColumn, chunkRow } of chunks)
		{
			const onMap = ((chunkColumn >= area.minChunkColumn) && (chunkColumn <= area.maxChunkColumn) && (chunkRow >= area.minChunkRow) && (chunkRow <= area.maxChunkRow));

			if (!onMap)
			{
				continue;
			}

			if (!this.map.isLoaded(chunkColumn, chunkRow))
			{
				this.markStale(chunkColumn, chunkRow);
				continue;
			}

			const key = chunkKey(Math.floor(chunkColumn / BLOCK_SIDE), Math.floor(chunkRow / BLOCK_SIDE));
			const block = blocks.get(key);

			reloaded.set(chunkKey(chunkColumn, chunkRow), undefined);
			blocks.set(key, ((block === undefined)
				? {
					minChunkColumn: chunkColumn,
					minChunkRow: chunkRow,
					maxChunkColumn: chunkColumn,
					maxChunkRow: chunkRow
				}
				: {
					minChunkColumn: Math.min(block.minChunkColumn, chunkColumn),
					minChunkRow: Math.min(block.minChunkRow, chunkRow),
					maxChunkColumn: Math.max(block.maxChunkColumn, chunkColumn),
					maxChunkRow: Math.max(block.maxChunkRow, chunkRow)
				}));
		}

		const answers = await Promise.all([...blocks.values()].map((range) => this.source(range)));

		if (this.stopped)
		{
			return(new Map());
		}

		for (const chunk of answers.flatMap((answer) => answer.chunks))
		{
			const key = chunkKey(chunk.chunkColumn, chunk.chunkRow);

			if (reloaded.has(key))
			{
				reloaded.set(key, chunk.cells);
			}
		}

		return(reloaded);
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
	 * Marks the requests still on their way for a chunk as stale, for when another editor saved painting
	 * in it
	 *
	 * @param chunkColumn The chunk's column
	 * @param chunkRow The chunk's row
	 */
	private markStale(chunkColumn: number, chunkRow: number): void
	{
		for (const load of this.pending)
		{
			const { range } = load;

			if ((chunkColumn >= range.minChunkColumn) && (chunkColumn <= range.maxChunkColumn) && (chunkRow >= range.minChunkRow) && (chunkRow <= range.maxChunkRow))
			{
				load.stale = true;
			}
		}
	}

	/**
	 * Asks for the stored chunks in a range to load into the map, asking again while another editor saves
	 * painting in the range before the answer comes
	 *
	 * @param range The chunks
	 * @return The stored chunks in the range
	 */
	private async fetch(range: ChunkRange): Promise<AreaChunk[]>
	{
		for (;;)
		{
			const load: PendingLoad = {
				range,
				stale: false
			};

			this.pending.add(load);

			try
			{
				const { chunks } = await this.source(range);

				if (!load.stale || this.stopped)
				{
					return(chunks);
				}
			}
			finally
			{
				this.pending.delete(load);
			}
		}
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
			const chunks = await this.fetch(range);

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
