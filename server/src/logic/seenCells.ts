import { chunkCoordinate, chunkKey, emptySeenChunk, markCellSeen, parseChunkKey } from '@multiverse-kiln/shared';

/**
 * The cells a group has seen in one chunk of an area's map
 */
export interface AreaSeenChunk
{
	areaId: string;
	chunkColumn: number;
	chunkRow: number;

	/**
	 * One bit per cell (see shared/src/seen.ts)
	 */
	cells: Uint8Array;
}

/**
 * The cells a group has seen in every area, part of its world state, and which chunks have changed
 * since they were last saved
 */
export class SeenCells
{
	/**
	 * Each area's seen chunks, by area ID, then by chunkKey()
	 */
	private readonly areas = new Map<string, Map<string, Uint8Array>>();

	/**
	 * The chunks seen since the last save, by area ID, then by chunkKey()
	 */
	private readonly changed = new Map<string, Set<string>>();

	/**
	 * @param saved The chunks saved before
	 */
	constructor(saved: Iterable<AreaSeenChunk> = [])
	{
		for (const chunk of saved)
		{
			this.chunksOf(chunk.areaId).set(chunkKey(chunk.chunkColumn, chunk.chunkRow), Uint8Array.from(chunk.cells));
		}
	}

	/**
	 * Marks cells of an area as seen
	 *
	 * @param areaId The area's ID
	 * @param cells The cells, as "column,row" (visionKey)
	 */
	mark(areaId: string, cells: Iterable<string>): void
	{
		const chunks = this.chunksOf(areaId);

		for (const cell of cells)
		{
			const [column, row] = cell.split(',').map(Number);
			const key = chunkKey(chunkCoordinate(column), chunkCoordinate(row));
			let bits = chunks.get(key);

			if (!bits)
			{
				bits = emptySeenChunk();
				chunks.set(key, bits);
			}

			if (markCellSeen(bits, column, row))
			{
				this.changedIn(areaId).add(key);
			}
		}
	}

	/**
	 * The seen cells of some chunks of an area
	 *
	 * @param areaId The area's ID
	 * @param chunkKeys The chunks, by chunkKey()
	 * @return Those with any cell seen
	 */
	get(areaId: string, chunkKeys: Iterable<string>): AreaSeenChunk[]
	{
		const chunks = this.areas.get(areaId);
		const found: AreaSeenChunk[] = [];

		for (const key of chunkKeys)
		{
			const bits = chunks?.get(key);

			if (bits)
			{
				found.push(toChunk(areaId, key, bits));
			}
		}

		return(found);
	}

	/**
	 * Forgets an area, for when it has been deleted
	 *
	 * @param areaId The area's ID
	 */
	forget(areaId: string): void
	{
		this.areas.delete(areaId);
		this.changed.delete(areaId);
	}

	/**
	 * The chunks seen since the last call, to save; they count as saved from then on
	 *
	 * @return Copies of the chunks
	 */
	takeChanged(): AreaSeenChunk[]
	{
		const taken: AreaSeenChunk[] = [];

		for (const [areaId, keys] of this.changed)
		{
			for (const key of keys)
			{
				const bits = this.areas.get(areaId)?.get(key);

				if (bits)
				{
					taken.push(toChunk(areaId, key, Uint8Array.from(bits)));
				}
			}
		}

		this.changed.clear();

		return(taken);
	}

	/**
	 * Counts chunks taken by takeChanged() as unsaved again, for when saving them failed
	 *
	 * @param chunks The chunks
	 */
	putBack(chunks: Iterable<AreaSeenChunk>): void
	{
		for (const chunk of chunks)
		{
			if (this.areas.has(chunk.areaId))
			{
				this.changedIn(chunk.areaId).add(chunkKey(chunk.chunkColumn, chunk.chunkRow));
			}
		}
	}

	/**
	 * An area's seen chunks, made if there are none
	 *
	 * @param areaId The area's ID
	 * @return The chunks, by chunkKey()
	 */
	private chunksOf(areaId: string): Map<string, Uint8Array>
	{
		let chunks = this.areas.get(areaId);

		if (!chunks)
		{
			chunks = new Map();
			this.areas.set(areaId, chunks);
		}

		return(chunks);
	}

	/**
	 * The chunks of an area seen since the last save, made if there are none
	 *
	 * @param areaId The area's ID
	 * @return Their keys
	 */
	private changedIn(areaId: string): Set<string>
	{
		let keys = this.changed.get(areaId);

		if (!keys)
		{
			keys = new Set();
			this.changed.set(areaId, keys);
		}

		return(keys);
	}
}

/**
 * A chunk's seen cells with where they are
 *
 * @param areaId The area's ID
 * @param key The chunk, by chunkKey()
 * @param cells The seen cells
 * @return The chunk
 */
function toChunk(areaId: string, key: string, cells: Uint8Array): AreaSeenChunk
{
	return({
		areaId,
		...parseChunkKey(key),
		cells
	});
}
