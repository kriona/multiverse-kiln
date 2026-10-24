/**
 * Uploaded tile graphics: the only module that reads or writes the tile_graphics table. The images
 * themselves are in object storage (src/storage/)
 */
import { and, asc, count, eq } from 'drizzle-orm';
import type { UploadedTileGraphic } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { tileGraphics } from './schema.js';

/**
 * What a new uploaded tile graphic needs
 */
export interface NewTileGraphic
{
	universeId: string;
	name: string;
	drawOrder: number;
	storageKey: string;

	/**
	 * The player who uploaded it and confirmed they have the rights to use it
	 */
	uploadedBy: string;
}

/**
 * Where an uploaded tile graphic's image is stored
 *
 * @param universeId The universe's ID
 * @param graphicId The graphic's ID
 * @return Its key in object storage
 */
export function tileGraphicStorageKey(universeId: string, graphicId: string): string
{
	return(`tile-graphics/${universeId}/${graphicId}.png`);
}

/**
 * Adds an uploaded tile graphic, whose image is already stored
 *
 * @param graphicId Its ID, which its storage key was made from
 * @param graphic The graphic
 * @param executor The database, or a transaction
 */
export async function createTileGraphic(graphicId: string, graphic: NewTileGraphic, executor: Executor = db): Promise<void>
{
	await executor
		.insert(tileGraphics)
		.values({
			id: graphicId,
			...graphic
		});
}

/**
 * The tile graphics a universe's editors uploaded
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The graphics, by name
 */
export async function listTileGraphics(universeId: string, executor: Executor = db): Promise<UploadedTileGraphic[]>
{
	return(executor
		.select({
			id: tileGraphics.id,
			name: tileGraphics.name,
			drawOrder: tileGraphics.drawOrder
		})
		.from(tileGraphics)
		.where(eq(tileGraphics.universeId, universeId))
		.orderBy(asc(tileGraphics.name), asc(tileGraphics.createdAt)));
}

/**
 * How many tile graphics a universe's editors have uploaded
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The number of graphics
 */
export async function countTileGraphics(universeId: string, executor: Executor = db): Promise<number>
{
	const [row] = await executor
		.select({
			total: count()
		})
		.from(tileGraphics)
		.where(eq(tileGraphics.universeId, universeId));

	return(row.total);
}

/**
 * Whether a universe's editors uploaded a tile graphic, so its tiles can be drawn with it
 *
 * @param universeId The universe's ID
 * @param graphicId The graphic's ID
 * @param executor The database, or a transaction
 * @return True when the graphic belongs to the universe
 */
export async function isUniverseTileGraphic(universeId: string, graphicId: string, executor: Executor = db): Promise<boolean>
{
	const rows = await executor
		.select({
			id: tileGraphics.id
		})
		.from(tileGraphics)
		.where(and(
			eq(tileGraphics.id, graphicId),
			eq(tileGraphics.universeId, universeId)
		))
		.limit(1);

	return(rows.length > 0);
}

/**
 * Where an uploaded tile graphic's image is stored, for serving it
 *
 * @param graphicId The graphic's ID
 * @param executor The database, or a transaction
 * @return Its key in object storage, or undefined when there is no such graphic
 */
export async function findTileGraphicStorageKey(graphicId: string, executor: Executor = db): Promise<string | undefined>
{
	const [row] = await executor
		.select({
			storageKey: tileGraphics.storageKey
		})
		.from(tileGraphics)
		.where(eq(tileGraphics.id, graphicId))
		.limit(1);

	return(row?.storageKey);
}

/**
 * Deletes one of a universe's uploaded tile graphics. Tiles drawn with it are drawn in their colors
 * after (the tiles table sets their uploaded_graphic_id to null); delete its image from storage too
 *
 * @param universeId The universe's ID
 * @param graphicId The graphic's ID
 * @param executor The database, or a transaction
 * @return Where its image is stored, or undefined when the universe has no such graphic
 */
export async function deleteTileGraphic(universeId: string, graphicId: string, executor: Executor = db): Promise<string | undefined>
{
	const [row] = await executor
		.delete(tileGraphics)
		.where(and(
			eq(tileGraphics.id, graphicId),
			eq(tileGraphics.universeId, universeId)
		))
		.returning({
			storageKey: tileGraphics.storageKey
		});

	return(row?.storageKey);
}
