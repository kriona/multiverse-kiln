import type Phaser from 'phaser';
import { isTileGraphic, TILE_GRAPHIC_KEYS, type TileGraphic } from '@multiverse-kiln/shared';

import forestUrl from '../assets/tilesets/forest.png';
import grassUrl from '../assets/tilesets/grass.png';
import mountainsUrl from '../assets/tilesets/mountains.png';

/**
 * Each graphic's image, a Dual-Grid sheet (see DUAL_GRID_COLUMNS)
 */
export const TILE_GRAPHIC_URLS: Record<TileGraphic, string> = {
	grass: grassUrl,
	forest: forestUrl,
	mountains: mountainsUrl
};

/**
 * How many frames wide a Dual-Grid sheet is; it is as many tall
 */
export const DUAL_GRID_COLUMNS = 4;

/**
 * The key a graphic's image is loaded under in a game's textures
 *
 * @param graphic The graphic
 * @return The texture key
 */
export function tileGraphicTextureKey(graphic: TileGraphic): string
{
	return(`tile-graphic-${graphic}`);
}

/**
 * Queues loading every tile graphic a scene's game doesn't have yet; call it from the scene's preload()
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
 * The image of a tile's graphic, once loaded
 *
 * @param scene A scene of the game that loaded it
 * @param graphic The tile's graphic
 * @return The image, or undefined for a tile drawn in its color, or a graphic that didn't load
 */
export function tileGraphicImage(scene: Phaser.Scene, graphic: string | null): CanvasImageSource | undefined
{
	if (!isTileGraphic(graphic))
	{
		return(undefined);
	}

	const key = tileGraphicTextureKey(graphic);

	if (!scene.textures.exists(key))
	{
		return(undefined);
	}

	return(scene.textures.get(key).getSourceImage() as CanvasImageSource);
}
