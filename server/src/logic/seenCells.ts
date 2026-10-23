import { CHUNK_SIZE, cellIndexInChunk, chunkCoordinate, chunkKey, DEFAULT_TILE_CELL, parseChunkKey, UNSEEN_CELL } from '@multiverse-kiln/shared';

/**
 * Bytes in a chunk's seen cells: one bit per cell, in the order of cellIndexInChunk()
 */
export const SEEN_CHUNK_BYTES = (CHUNK_SIZE * CHUNK_SIZE) / 8;

/**
 * The cells a group has seen in one chunk of an area's map
 */
export interface AreaSeenChunk
{
	areaId: string;
	chunkColumn: number;
	chunkRow: number;

	/**
	 * One bit per cell (SEEN_CHUNK_BYTES)
	 */
	cells: Uint8Array;
}

/**
 * A cell of a map
 */
export interface SeenCell
{
	column: number;
	row: number;
}

/**
 * The cells a group has seen in every area, part of its world state, and which chunks have changed
 * since they were last saved
 *
 * A chunk with no cell seen isn't kept
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
	 * Adds the chunks saved before
	 *
	 * @param saved The chunks
	 */
	load(saved: Iterable<AreaSeenChunk>): void
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
	 * @return The cells that hadn't been seen before
	 */
	mark(areaId: string, cells: Iterable<string>): SeenCell[]
	{
		const chunks = this.chunksOf(areaId);
		const fresh: SeenCell[] = [];

		for (const cell of cells)
		{
			const [column, row] = cell.split(',').map(Number);
			const key = chunkKey(chunkCoordinate(column), chunkCoordinate(row));
			const index = cellIndexInChunk(column, row);
			let bits = chunks.get(key);

			if (!bits)
			{
				bits = new Uint8Array(SEEN_CHUNK_BYTES);
				chunks.set(key, bits);
			}

			if (!isBitSet(bits, index))
			{
				bits[index >> 3] |= 1 << (index & 7);
				this.changedIn(areaId).add(key);
				fresh.push({ column, row });
			}
		}

		return(fresh);
	}

	/**
	 * Whether a cell of an area has been seen
	 *
	 * @param areaId The area's ID
	 * @param column The cell's column
	 * @param row The cell's row
	 * @return True when it has
	 */
	has(areaId: string, column: number, row: number): boolean
	{
		const bits = this.areas.get(areaId)?.get(chunkKey(chunkCoordinate(column), chunkCoordinate(row)));

		return((bits !== undefined) && isBitSet(bits, cellIndexInChunk(column, row)));
	}

	/**
	 * A chunk's cells as the group knows them: each cell it hasn't seen is UNSEEN_CELL
	 *
	 * @param areaId The area's ID
	 * @param key The chunk, by chunkKey()
	 * @param cells The chunk's cells, or null when every cell is the default tile
	 * @return The cells; null when every cell is the default tile and has been seen
	 */
	mask(areaId: string, key: string, cells: readonly number[] | null): number[] | null
	{
		const bits = this.areas.get(areaId)?.get(key);

		if (bits && (countBits(bits) === (CHUNK_SIZE * CHUNK_SIZE)))
		{
			return((cells ? [...cells] : null));
		}

		return(Array.from({ length: CHUNK_SIZE * CHUNK_SIZE }, (_value, index) => ((bits && isBitSet(bits, index)) ? (cells?.[index] ?? DEFAULT_TILE_CELL) : UNSEEN_CELL)));
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
					taken.push({
						areaId,
						...parseChunkKey(key),
						cells: Uint8Array.from(bits)
					});
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
 * Whether a cell's bit is set
 *
 * @param bits A chunk's seen cells
 * @param index The cell's index in its chunk (cellIndexInChunk)
 * @return True when it is
 */
function isBitSet(bits: Uint8Array, index: number): boolean
{
	return((bits[index >> 3] & (1 << (index & 7))) !== 0);
}

/**
 * How many cells of a chunk have been seen
 *
 * @param bits The chunk's seen cells
 * @return The number of bits set
 */
function countBits(bits: Uint8Array): number
{
	let count = 0;

	for (let byte of bits)
	{
		while (byte !== 0)
		{
			count += byte & 1;
			byte >>= 1;
		}
	}

	return(count);
}
