/**
 * GET TILE_GRAPHICS_PATH/<ID>.png: an uploaded tile graphic, for anyone drawing a map with it
 *
 * An uploaded graphic never changes (a new upload gets a new ID), so browsers may keep it for good.
 * Colyseus's CORS hook (responseHeaders.ts) lets the allowed origins read it, which the client needs to
 * draw it into its tile atlas
 */
import type { Application, Request, Response } from 'express';
import { defineMessages, TILE_GRAPHICS_PATH } from '@multiverse-kiln/shared';

import { findTileGraphicStorageKey } from '../db/tileGraphicRepo.js';
import { getObject } from '../storage/objectStorage.js';
import { sendError } from './errors.js';

/**
 * How long browsers may keep a tile graphic: a year, the most HTTP caches honor
 */
const CACHE_SECONDS = 365 * 24 * 60 * 60;

/**
 * A graphic's file name: its ID, then .png
 */
const FILE_NAME = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.png$/;

const messages = defineMessages({
	noSuchTileGraphic: {
		id: 'error.noSuchTileGraphic',
		defaultMessage: 'The tileset doesn\'t exist.',
		description: 'Why an uploaded tileset couldn\'t be loaded: there is none with that address'
	}
});

/**
 * Adds the route that serves uploaded tile graphics
 *
 * @param app Express app to add the route to
 */
export function addTileGraphicRoute(app: Application): void
{
	app.get(`${TILE_GRAPHICS_PATH}/:file`, serveTileGraphic);
}

/**
 * GET TILE_GRAPHICS_PATH/:file: the graphic's PNG
 *
 * @param request The request
 * @param response The response
 */
async function serveTileGraphic(request: Request, response: Response): Promise<void>
{
	const graphicId = FILE_NAME.exec(String(request.params.file))?.[1];
	const storageKey = ((graphicId === undefined) ? undefined : await findTileGraphicStorageKey(graphicId));
	const image = ((storageKey === undefined) ? undefined : await getObject(storageKey));

	if (!image)
	{
		sendError(response, 404, messages.noSuchTileGraphic);
		return;
	}

	response.set('Cache-Control', `public, max-age=${CACHE_SECONDS}, immutable`);
	response.type('png').send(image);
}
