import { chunkKey, MAX_CHUNKS_PER_REQUEST, type ChunkRange } from '@multiverse-kiln/shared';

import type { EditorApi } from '../network/editorApi';
import type { EditorMap } from './EditorMap';

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
	 * @param api The editor's API
	 * @param universeId The area's universe
	 * @param areaId The area
	 * @param map Where the chunks go
	 * @param onLoaded Called with the keys of the chunks each block newly loaded
	 * @param onError Called when a block couldn't be loaded; it will be asked for again next time the view reaches it
	 */
	constructor(
		private readonly api: EditorApi,
		private readonly universeId: string,
		private readonly areaId: string,
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
			const { chunks } = await this.api.loadChunks(this.universeId, this.areaId, range);

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
