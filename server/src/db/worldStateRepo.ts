/**
 * Groups' world state: the only module that reads or writes the group_seen_chunks table. It reads
 * areas only to leave out areas that have been deleted
 */
import { eq, sql, type SQL } from 'drizzle-orm';

import { db, type Executor } from './client.js';
import { groupSeenChunks } from './schema.js';

/**
 * Most chunks saved in one statement, keeping it well under Postgres's limit on parameters
 */
const SAVE_BATCH_SIZE = 1000;

/**
 * The cells a group has seen in one chunk of an area's map
 */
export interface SeenChunk
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
 * Every chunk a group has seen any cell of, in every area
 *
 * @param groupId The group's ID
 * @param executor The database, or a transaction
 * @return The chunks
 */
export async function loadSeenChunks(groupId: string, executor: Executor = db): Promise<SeenChunk[]>
{
	return(executor
		.select({
			areaId: groupSeenChunks.areaId,
			chunkColumn: groupSeenChunks.chunkColumn,
			chunkRow: groupSeenChunks.chunkRow,
			cells: groupSeenChunks.cells
		})
		.from(groupSeenChunks)
		.where(eq(groupSeenChunks.groupId, groupId)));
}

/**
 * Saves the cells a group has seen in some chunks, in place of what was saved for them before. Chunks
 * of areas that have since been deleted are left out
 *
 * @param groupId The group's ID
 * @param chunks The chunks
 * @param executor The database, or a transaction
 */
export async function saveSeenChunks(groupId: string, chunks: readonly SeenChunk[], executor: Executor = db): Promise<void>
{
	for (let start = 0; start < chunks.length; start += SAVE_BATCH_SIZE)
	{
		const batch = chunks.slice(start, start + SAVE_BATCH_SIZE);

		await executor.execute(sql`
			INSERT INTO ${groupSeenChunks} (group_id, area_id, chunk_column, chunk_row, cells)
			SELECT ${groupId}, chunk.area_id, chunk.chunk_column, chunk.chunk_row, chunk.cells
			FROM unnest(
				${arrayOf(batch.map((chunk) => sql`${chunk.areaId}`), 'uuid')},
				${arrayOf(batch.map((chunk) => sql`${chunk.chunkColumn}`), 'integer')},
				${arrayOf(batch.map((chunk) => sql`${chunk.chunkRow}`), 'integer')},
				${arrayOf(batch.map((chunk) => sql`${Buffer.from(chunk.cells)}`), 'bytea')}
			) AS chunk (area_id, chunk_column, chunk_row, cells)
			WHERE EXISTS (SELECT 1 FROM areas WHERE areas.id = chunk.area_id)
			ON CONFLICT (group_id, area_id, chunk_column, chunk_row) DO UPDATE SET cells = excluded.cells
		`);
	}
}

/**
 * A Postgres array of values, each its own parameter
 *
 * @param values The values
 * @param type The array's element type
 * @return SQL for the array
 */
function arrayOf(values: SQL[], type: string): SQL
{
	return(sql`ARRAY[${sql.join(values, sql`, `)}]::${sql.raw(type)}[]`);
}
