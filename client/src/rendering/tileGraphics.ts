import Phaser from 'phaser';
import { isTileGraphic, TILE_GRAPHIC_KEYS, TILE_GRAPHICS, TILE_GRAPHICS_PATH, type AreaTile, type TileGraphic, type TileGraphicFormat } from '@multiverse-kiln/shared';

import forestUrl from '../assets/tilesets/forest.png';
import grassUrl from '../assets/tilesets/grass.png';
import hedgeUrl from '../assets/tilesets/hedge.png';
import mountainsUrl from '../assets/tilesets/mountains.png';
import stoneWallUrl from '../assets/tilesets/stoneWall.png';
import { serverHttpUrl } from '../network/serverConnection';

/**
 * Each graphic's image: a Dual-Grid sheet (see DUAL_GRID_COLUMNS) or a blob sheet (BLOB_SHEET_COLUMNS),
 * by its format in TILE_GRAPHICS
 */
export const TILE_GRAPHIC_URLS: Record<TileGraphic, string> = {
	grass: grassUrl,
	forest: forestUrl,
	mountains: mountainsUrl,
	stoneWall: stoneWallUrl,
	hedge: hedgeUrl
};

/**
 * How many frames wide a Dual-Grid sheet is; it is as many tall
 */
export const DUAL_GRID_COLUMNS = 4;

/**
 * Where to load a graphic the universe's editors uploaded
 *
 * @param graphicId The graphic's ID
 * @return Its address on the server
 */
export function uploadedTileGraphicUrl(graphicId: string): string
{
	return(serverHttpUrl(`${TILE_GRAPHICS_PATH}/${graphicId}.png`));
}

/**
 * The key a graphic's image is loaded under in a game's textures
 *
 * @param graphic The graphic
 * @return The texture key
 */
function tileGraphicTextureKey(graphic: TileGraphic): string
{
	return(`tile-graphic-${graphic}`);
}

/**
 * The key an uploaded graphic's image is loaded under in a game's textures. An uploaded graphic never
 * changes, so once loaded it serves every area that uses it
 *
 * @param graphicId The graphic's ID
 * @return The texture key
 */
function uploadedTileGraphicTextureKey(graphicId: string): string
{
	return(`tile-graphic-upload-${graphicId}`);
}

/**
 * Queues loading every tile graphic that ships with the engine and the scene's game doesn't have yet;
 * call it from the scene's preload()
 *
 * @param scene The scene
 */
export function preloadTileGraphics(scene: Phaser.Scene): void
{
	for (const graphic of TILE_GRAPHIC_KEYS)
	{
		const key = tileGraphicTextureKey(graphic);

		if (!scene.textures.exists(key))
		{
			scene.load.image(key, TILE_GRAPHIC_URLS[graphic]);
		}
	}
}

/**
 * Loads the uploaded graphics an area's tiles are drawn with that the scene's game doesn't have yet.
 * Until they arrive those tiles are drawn in their colors, so draw the area again once this resolves true
 *
 * They come from the game server, which lets the page's origin read them, as drawing them into a tile
 * atlas needs. One that fails to load leaves its tiles in their colors
 *
 * @param scene The scene, once it is running
 * @param tiles The area's tiles
 * @return Resolves true once any graphics have been loaded, or false when there were none to load
 */
export function loadUploadedTileGraphics(scene: Phaser.Scene, tiles: readonly AreaTile[]): Promise<boolean>
{
	const missing = new Set(tiles
		.map((tile) => tile.uploadedGraphic?.id)
		.filter((graphicId): graphicId is string => ((graphicId !== undefined) && !scene.textures.exists(uploadedTileGraphicTextureKey(graphicId)))));

	if (missing.size === 0)
	{
		return(Promise.resolve(false));
	}

	return(new Promise((resolve) =>
	{
		scene.load.setCORS('anonymous');

		for (const graphicId of missing)
		{
			scene.load.image(uploadedTileGraphicTextureKey(graphicId), uploadedTileGraphicUrl(graphicId));
		}

		scene.load.once(Phaser.Loader.Events.COMPLETE, () =>
		{
			resolve(true);
		});
		scene.load.start();
	}));
}

/**
 * The image a tile is drawn with, and where it goes among other tiles' images, once loaded
 *
 * @param scene A scene of the game that loaded it
 * @param tile The tile
 * @return The image, its format and its draw order (see TILE_GRAPHICS; 0 for a blob sheet), or
 * undefined for a tile drawn in its color, or whose graphic hasn't loaded
 */
export function tileGraphicImage(scene: Phaser.Scene, tile: Pick<AreaTile, 'graphic' | 'uploadedGraphic'>): { image: CanvasImageSource; format: TileGraphicFormat; drawOrder: number } | undefined
{
	let key: string;
	let format: TileGraphicFormat;
	let drawOrder = 0;

	if (tile.uploadedGraphic)
	{
		key = uploadedTileGraphicTextureKey(tile.uploadedGraphic.id);
		format = tile.uploadedGraphic.format;
		drawOrder = (tile.uploadedGraphic.drawOrder ?? 0);
	}
	else if (isTileGraphic(tile.graphic))
	{
		const graphic = TILE_GRAPHICS[tile.graphic];

		key = tileGraphicTextureKey(tile.graphic);
		format = graphic.format;

		if (graphic.format === 'dualGrid')
		{
			drawOrder = graphic.drawOrder;
		}
	}
	else
	{
		return(undefined);
	}

	if (!scene.textures.exists(key))
	{
		return(undefined);
	}

	return({
		image: scene.textures.get(key).getSourceImage() as CanvasImageSource,
		format,
		drawOrder
	});
}
