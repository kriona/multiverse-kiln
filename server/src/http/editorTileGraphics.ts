/**
 * The world editor's routes for the tile graphics a universe's editors upload (listed in
 * shared/src/editor.ts). The images are checked and re-encoded (src/images/tileSheets.ts), then kept in
 * object storage; anyone can load them from TILE_GRAPHICS_PATH (see tileGraphics.ts)
 */
import { randomUUID } from 'crypto';
import type express from 'express';
import type { Request, Response } from 'express';
import { canEditWorld, MAX_TILE_GRAPHIC_BYTES, MAX_UPLOADED_TILE_GRAPHICS, TILE_GRAPHIC_SIZES, type CreatedPayload, type TileGraphicListPayload } from '@multiverse-kiln/shared';

import { countTileGraphics, createTileGraphic, deleteTileGraphic, listTileGraphics, tileGraphicStorageKey } from '../db/tileGraphicRepo.js';
import { inTransaction } from '../db/transactions.js';
import { lockUniverse } from '../db/universeRepo.js';
import { prepareTileSheet } from '../images/tileSheets.js';
import { deleteObject, putObject } from '../storage/objectStorage.js';
import { areaChanges } from '../world/areaChanges.js';
import { playerIdOf, requireRole, universeContextOf } from './editorAccess.js';
import { tileGraphicIdParameter, tileGraphicUploadRequest } from './editorPayloads.js';
import { sendError, sendInvalidRequest } from './errors.js';

/**
 * Adds the tile graphic routes to a universe's router
 *
 * @param router The router for routes under /:universeId
 */
export function addTileGraphicRoutes(router: express.Router): void
{
	router.get('/tile-graphics', listTileGraphicsRoute);
	router.post('/tile-graphics', requireRole(canEditWorld), uploadTileGraphic);
	router.delete('/tile-graphics/:graphicId', requireRole(canEditWorld), deleteTileGraphicRoute);
}

/**
 * DELETE /:universeId/tile-graphics/:graphicId: deletes an uploaded tile graphic and its image. Tiles
 * drawn with it are drawn in their colors after, so the rooms are told the tiles changed
 *
 * The row goes first: once it is gone nothing serves the image, so an image left behind if the server
 * stops in between does no harm
 *
 * @param request The request
 * @param response The response
 */
async function deleteTileGraphicRoute(request: Request, response: Response): Promise<void>
{
	const graphicId = tileGraphicIdParameter.safeParse(request.params.graphicId);
	const { universe } = universeContextOf(request);
	const storageKey = (graphicId.success ? await deleteTileGraphic(universe.id, graphicId.data) : undefined);

	if (storageKey === undefined)
	{
		sendError(response, 404, {
			id: 'error.noSuchUploadedGraphicToDelete',
			defaultMessage: 'The uploaded tileset doesn\'t exist. It may have been deleted already.',
			description: 'Why an uploaded tileset couldn\'t be deleted: there is no such tileset in this universe, perhaps because another editor deleted it'
		});
		return;
	}

	await deleteObject(storageKey);
	areaChanges.publish({ kind: 'tiles', universeId: universe.id });
	response.sendStatus(204);
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
 * POST /:universeId/tile-graphics: checks an uploaded tile graphic, re-encodes it and stores it
 *
 * The image is stored before its row is added, and deleted again if the row can't be, so a stored
 * image without a row only remains if the server stops in between
 *
 * @param request The request
 * @param response The response
 */
async function uploadTileGraphic(request: Request, response: Response): Promise<void>
{
	const body = tileGraphicUploadRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { universe } = universeContextOf(request);

	if (await countTileGraphics(universe.id) >= MAX_UPLOADED_TILE_GRAPHICS)
	{
		sendLimitReached(response);
		return;
	}

	const sheet = await prepareTileSheet(Buffer.from(body.data.image, 'base64'), body.data.format);

	if (!sheet.ok)
	{
		switch (sheet.problem)
		{
			case 'tooLarge':
				sendError(response, 400, {
					id: 'error.tileGraphicTooLarge',
					defaultMessage: 'The image can be at most {max, number} KB.',
					description: 'Why an uploaded tileset was refused: the file is too big; {max} is the most it can be, in kilobytes'
				}, {
					max: MAX_TILE_GRAPHIC_BYTES / 1024
				});
				return;

			case 'notPng':
				sendError(response, 400, {
					id: 'error.tileGraphicNotPng',
					defaultMessage: 'The file isn\'t a PNG image.',
					description: 'Why an uploaded tileset was refused: it isn\'t a PNG picture, or is damaged'
				});
				return;

			case 'wrongSize':
				sendError(response, 400, {
					id: 'error.tileGraphicWrongSize',
					defaultMessage: 'A tileset in this layout must be {width, number} by {height, number} pixels.',
					description: 'Why an uploaded tileset was refused: the picture is the wrong size for the layout chosen for it (15 tiles for ground, or 47 for walls); {width} and {height} are the size it must be, in pixels'
				}, {
					width: TILE_GRAPHIC_SIZES[body.data.format].width,
					height: TILE_GRAPHIC_SIZES[body.data.format].height
				});
				return;
		}
	}

	const graphicId = randomUUID();
	const storageKey = tileGraphicStorageKey(universe.id, graphicId);

	await putObject(storageKey, sheet.png, 'image/png');

	let created: boolean;

	try
	{
		created = await inTransaction(async (transaction) =>
		{
			await lockUniverse(universe.id, transaction);

			// Counted again under the lock, since another upload may have finished meanwhile
			if (await countTileGraphics(universe.id, transaction) >= MAX_UPLOADED_TILE_GRAPHICS)
			{
				return(false);
			}

			await createTileGraphic(graphicId, {
				universeId: universe.id,
				name: body.data.name,
				format: body.data.format,
				drawOrder: body.data.drawOrder,
				storageKey,
				uploadedBy: playerIdOf(request)
			}, transaction);

			return(true);
		});
	}
	catch (error)
	{
		await deleteObject(storageKey);
		throw error;
	}

	if (!created)
	{
		await deleteObject(storageKey);
		sendLimitReached(response);
		return;
	}

	const payload: CreatedPayload<string> = { id: graphicId };

	response.status(201).json(payload);
}

/**
 * Refuses an upload because the universe has as many uploaded tile graphics as allowed
 *
 * @param response The response
 */
function sendLimitReached(response: Response): void
{
	sendError(response, 409, {
		id: 'error.tileGraphicLimit',
		defaultMessage: 'A universe can have at most {max, plural, one {# uploaded tileset} other {# uploaded tilesets}}.',
		description: 'Why a tileset wasn\'t uploaded: the universe has as many uploaded tilesets as allowed'
	}, {
		max: MAX_UPLOADED_TILE_GRAPHICS
	});
}
