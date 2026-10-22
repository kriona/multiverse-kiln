import { CHUNK_SIZE, chunkCoordinate, chunkKey, decodeSeenChunk, emptySeenChunk, GameServerMessageType, isCellSeen, markCellSeen, mergeSeenChunk, parseChunkKey, type SeenPayload } from '@multiverse-kiln/shared';

import type { GameRoom } from './serverConnection';

/**
 * The cells of each area a group has seen, for drawing its map: what the group's room sends, from the
 * moment the room is joined, and what the map marks as the players it shows see
 */
export class SeenCellsStore
{
	/**
	 * Each area's seen chunks, by area ID, then by chunkKey()
	 */
	private readonly areas = new Map<string, Map<string, Uint8Array>>();

	private readonly listeners = new Set<() => void>();

	/**
	 * Starts listening to the room, which must be done as soon as it is joined: it sends the first of
	 * these straight after the first area
	 *
	 * @param room The group's room
	 */
	constructor(room: GameRoom)
	{
		room.onMessage(GameServerMessageType.Seen, (payload: SeenPayload) =>
		{
			this.receive(payload);
		});
	}

	/**
	 * Whether the group has seen a cell
	 *
	 * @param areaId The cell's area
	 * @param column The cell's column
	 * @param row The cell's row
	 * @return True when it has
	 */
	has(areaId: string, column: number, row: number): boolean
	{
		const bits = this.areas.get(areaId)?.get(chunkKey(chunkCoordinate(column), chunkCoordinate(row)));

		return((bits !== undefined) && isCellSeen(bits, column, row));
	}

	/**
	 * Marks a cell as seen
	 *
	 * @param areaId The cell's area
	 * @param column The cell's column
	 * @param row The cell's row
	 */
	mark(areaId: string, column: number, row: number): void
	{
		const chunks = this.chunksOf(areaId);
		const key = chunkKey(chunkCoordinate(column), chunkCoordinate(row));
		let bits = chunks.get(key);

		if (!bits)
		{
			bits = emptySeenChunk();
			chunks.set(key, bits);
		}

		markCellSeen(bits, column, row);
	}

	/**
	 * How many cells of an area the group has seen
	 *
	 * @param areaId The area's ID
	 * @param isOnMap Whether a cell is on the area's map, so cells cut off by a smaller map aren't counted
	 * @return The number of cells
	 */
	count(areaId: string, isOnMap: (column: number, row: number) => boolean): number
	{
		let seen = 0;

		for (const [key, bits] of this.chunksOf(areaId))
		{
			const { chunkColumn, chunkRow } = parseChunkKey(key);

			for (let row = chunkRow * CHUNK_SIZE; row < (chunkRow + 1) * CHUNK_SIZE; row++)
			{
				for (let column = chunkColumn * CHUNK_SIZE; column < (chunkColumn + 1) * CHUNK_SIZE; column++)
				{
					if (isCellSeen(bits, column, row) && isOnMap(column, row))
					{
						seen++;
					}
				}
			}
		}

		return(seen);
	}

	/**
	 * Listens for seen cells arriving from the room
	 *
	 * @param listener Called after each arrives
	 * @return Stops listening
	 */
	onChange(listener: () => void): () => void
	{
		this.listeners.add(listener);

		return(() =>
		{
			this.listeners.delete(listener);
		});
	}

	/**
	 * Adds the seen cells the room sent
	 *
	 * @param payload The message
	 */
	private receive(payload: SeenPayload): void
	{
		const chunks = this.chunksOf(payload.areaId);

		for (const chunk of payload.chunks)
		{
			const key = chunkKey(chunk.chunkColumn, chunk.chunkRow);
			const bits = chunks.get(key);
			const received = decodeSeenChunk(chunk.cells);

			if (bits)
			{
				mergeSeenChunk(bits, received);
			}
			else
			{
				chunks.set(key, received);
			}
		}

		for (const listener of [...this.listeners])
		{
			listener();
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
}
