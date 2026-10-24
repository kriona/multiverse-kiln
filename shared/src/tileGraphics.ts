/**
 * The tile graphics that ship with the engine, which a tile can be drawn with in place of its color
 */

/**
 * Each graphic, by the key tiles store
 *
 * Every graphic is a Dual-Grid sheet (see the tile editor in STRUCTURE-OVERVIEW.md). Where tiles meet,
 * the one with the higher draw order has its edges drawn over the other's, since a sheet's edges are
 * drawn to overlap the ground below it: grass over dirt, dirt over water. Tiles without a graphic are
 * drawn below every graphic
 */
export const TILE_GRAPHICS = {
	grass: {
		drawOrder: 30
	}
} as const satisfies Record<string, { drawOrder: number }>;

export type TileGraphic = keyof typeof TILE_GRAPHICS;

/**
 * Every graphic's key
 */
export const TILE_GRAPHIC_KEYS = Object.keys(TILE_GRAPHICS) as TileGraphic[];

/**
 * Whether a stored graphic key is one the engine has; a graphic the engine no longer ships leaves its
 * tiles drawn in their colors
 *
 * @param graphic The key
 * @return True when it names a graphic in TILE_GRAPHICS
 */
export function isTileGraphic(graphic: string | null): graphic is TileGraphic
{
	return(((graphic !== null) && Object.hasOwn(TILE_GRAPHICS, graphic)));
}
