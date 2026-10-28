/**
 * The world editor's route for the tile graphics a universe's editors upload (listed in
 * shared/src/editor.ts), and saving uploads and deletions (see editorChanges.ts). The images are checked
 * and re-encoded (src/images/tileSheets.ts), then kept in object storage; anyone can load them from
 * TILE_GRAPHICS_PATH (see tileGraphics.ts)
 */
import { randomUUID } from 'crypto';
import type express from 'express';
import type { Request, Response } from 'express';
import { MAX_TILE_GRAPHIC_BYTES, MAX_UPLOADED_TILE_GRAPHICS, TILE_GRAPHIC_SIZES, type NewRef, type TileGraphicListPayload, type TileGraphicUploadRequest } from '@multiverse-kiln/shared';

import { countTileGraphics, createTileGraphic, deleteTileGraphic, listTileGraphics, tileGraphicStorageKey } from '../db/tileGraphicRepo.js';
import { prepareTileSheet } from '../images/tileSheets.js';
import { putObject } from '../storage/objectStorage.js';
import { universeContextOf } from './editorAccess.js';
import { ChangeRefusal, recordRef, refuse, type ChangeContext, type PreparedUpload } from './editorChangeContext.js';

/**
 * Adds the tile graphic route to a universe's router
 *
 * @param router The router for routes under /:universeId
 */
export function addTileGraphicRoutes(router: express.Router): void
{
	router.get('/tile-graphics', listTileGraphicsRoute);
}

/**
 * GET /:universeId/tile-graphics: the tile graphics the universe's editors uploaded
 *
 * @param request The request
 * @param response The response
 */
async function listTileGraphicsRoute(request: Request, response: Response): Promise<void>
{
	const { universe } = universeContextOf(request);
	const payload: TileGraphicListPayload = {
		graphics: await listTileGraphics(universe.id)
	};

	response.json(payload);
}

/**
 * Checks an uploaded tile graphic, re-encodes it and stores its image, before the save's transaction
 * starts. The save deletes the image again if it doesn't commit, so a stored image without a row only
 * remains if the server stops in between
 *
 * @param universeId The universe's ID
 * @param upload The upload
 * @return Where the image is stored, and the ID its row will have
 */
export async function prepareUpload(universeId: string, upload: TileGraphicUploadRequest): Promise<PreparedUpload>
{
	const sheet = await prepareTileSheet(Buffer.from(upload.image, 'base64'), upload.format);

	if (!sheet.ok)
	{
		switch (sheet.problem)
		{
			case 'tooLarge':
				throw new ChangeRefusal({
					status: 400,
					message: {
						id: 'error.tileGraphicTooLarge',
						defaultMessage: 'The image can be at most {max, number} KB.',
						description: 'Why an uploaded tileset was refused: the file is too big; {max} is the most it can be, in kilobytes'
					},
					values: {
						max: MAX_TILE_GRAPHIC_BYTES / 1024
					}
				});

			case 'notPng':
				throw new ChangeRefusal({
					status: 400,
					message: {
						id: 'error.tileGraphicNotPng',
						defaultMessage: 'The file isn\'t a PNG image.',
						description: 'Why an uploaded tileset was refused: it isn\'t a PNG picture, or is damaged'
					}
				});

			case 'wrongSize':
				throw new ChangeRefusal({
					status: 400,
					message: {
						id: 'error.tileGraphicWrongSize',
						defaultMessage: 'A tileset in this layout must be {width, number} by {height, number} pixels.',
						description: 'Why an uploaded tileset was refused: the picture is the wrong size for the layout chosen for it (15 tiles for ground, or 47 for walls); {width} and {height} are the size it must be, in pixels'
					},
					values: {
						width: TILE_GRAPHIC_SIZES[upload.format].width,
						height: TILE_GRAPHIC_SIZES[upload.format].height
					}
				});
		}
	}

	const graphicId = randomUUID();
	const storageKey = tileGraphicStorageKey(universeId, graphicId);

	await putObject(storageKey, sheet.png, 'image/png');

	return({ graphicId, storageKey });
}

/**
 * Adds the row of a tile graphic whose image prepareUpload() stored
 *
 * @param context The save
 * @param ref The graphic's ref
 * @param upload The upload
 */
export async function uploadTileGraphicChange(context: ChangeContext, ref: NewRef, upload: TileGraphicUploadRequest): Promise<void>
{
	const { universe, transaction } = context;
	const prepared = context.uploads.get(ref);

	if (!prepared)
	{
		throw new Error(`The upload ${ref} wasn't prepared`);
	}

	if (await countTileGraphics(universe.id, transaction) >= MAX_UPLOADED_TILE_GRAPHICS)
	{
		refuse(409, {
			id: 'error.tileGraphicLimit',
			defaultMessage: 'A universe can have at most {max, plural, one {# uploaded tileset} other {# uploaded tilesets}}.',
			description: 'Why a tileset wasn\'t uploaded: the universe has as many uploaded tilesets as allowed'
		}, {
			max: MAX_UPLOADED_TILE_GRAPHICS
		});
	}

	await createTileGraphic(prepared.graphicId, {
		universeId: universe.id,
		name: upload.name,
		format: upload.format,
		drawOrder: upload.drawOrder,
		storageKey: prepared.storageKey,
		uploadedBy: context.playerId
	}, transaction);
	recordRef(context, ref, prepared.graphicId);
}

/**
 * Deletes an uploaded tile graphic; its image is removed once the save commits. Tiles drawn with it are
 * drawn in their colors after, so the rooms are told the tiles changed
 *
 * @param context The save
 * @param graphicId The graphic's ID
 */
export async function deleteTileGraphicChange(context: ChangeContext, graphicId: string): Promise<void>
{
	const { universe, transaction } = context;
	const storageKey = await deleteTileGraphic(universe.id, graphicId, transaction);

	if (storageKey === undefined)
	{
		refuse(404, {
			id: 'error.noSuchUploadedGraphicToDelete',
			defaultMessage: 'The uploaded tileset doesn\'t exist. It may have been deleted already.',
			description: 'Why an uploaded tileset couldn\'t be deleted: there is no such tileset in this universe, perhaps because another editor deleted it'
		});
	}

	context.deletedImages.push(storageKey);
	context.published.push({ kind: 'tiles', universeId: universe.id });
}
