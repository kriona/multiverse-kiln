/**
 * The cells of an area a group has seen, part of its world state (see World state in
 * STRUCTURE-OVERVIEW.md)
 *
 * Each chunk of the map keeps one bit per cell, in the order of cellIndexInChunk(), and a chunk with no
 * cell seen isn't kept. The group's room marks cells as its members see them and sends each client the
 * chunks it is sent the map of; the client marks what it sees itself as well, with the same vision
 */
import { CHUNK_SIZE, cellIndexInChunk } from './maps.js';

/**
 * Bytes in a chunk's seen cells: one bit per cell
 */
export const SEEN_CHUNK_BYTES = (CHUNK_SIZE * CHUNK_SIZE) / 8;

/**
 * A new chunk of seen cells, with none seen
 *
 * @return The chunk's bits
 */
export function emptySeenChunk(): Uint8Array
{
	return(new Uint8Array(SEEN_CHUNK_BYTES));
}

/**
 * Whether a cell has been seen
 *
 * @param bits The seen cells of the cell's chunk
 * @param column The cell's column
 * @param row The cell's row
 * @return True when it has
 */
export function isCellSeen(bits: Uint8Array, column: number, row: number): boolean
{
	const index = cellIndexInChunk(column, row);

	return((bits[index >> 3] & (1 << (index & 7))) !== 0);
}

/**
 * Marks a cell as seen
 *
 * @param bits The seen cells of the cell's chunk, which this changes
 * @param column The cell's column
 * @param row The cell's row
 * @return True when the cell hadn't been seen before
 */
export function markCellSeen(bits: Uint8Array, column: number, row: number): boolean
{
	const index = cellIndexInChunk(column, row);
	const mask = 1 << (index & 7);

	if ((bits[index >> 3] & mask) !== 0)
	{
		return(false);
	}

	bits[index >> 3] |= mask;

	return(true);
}

/**
 * Adds the cells another copy of a chunk has seen to this one
 *
 * @param bits The seen cells to add to, which this changes
 * @param other The seen cells to add
 */
export function mergeSeenChunk(bits: Uint8Array, other: Uint8Array): void
{
	for (let index = 0; index < SEEN_CHUNK_BYTES; index++)
	{
		bits[index] |= (other[index] ?? 0);
	}
}

/**
 * A chunk's seen cells as messages carry them
 *
 * @param bits The seen cells
 * @return Base64
 */
export function encodeSeenChunk(bits: Uint8Array): string
{
	let binary = '';

	for (const byte of bits)
	{
		binary += String.fromCharCode(byte);
	}

	return(btoa(binary));
}

/**
 * A chunk's seen cells from a message
 *
 * @param encoded Base64, from encodeSeenChunk()
 * @return The seen cells; a chunk that is too short has its missing cells unseen
 */
export function decodeSeenChunk(encoded: string): Uint8Array
{
	const binary = atob(encoded);
	const bits = emptySeenChunk();

	for (let index = 0; index < Math.min(binary.length, SEEN_CHUNK_BYTES); index++)
	{
		bits[index] = binary.charCodeAt(index);
	}

	return(bits);
}
