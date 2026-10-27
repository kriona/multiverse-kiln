/**
 * The tile graphics that ship with the engine, which a tile can be drawn with in place of its color
 */

/**
 * How a graphic's sheet is laid out and drawn (see the tile editor in STRUCTURE-OVERVIEW.md)
 *
 * - dualGrid: 16 frames drawn on the corners where 4 cells meet, for the ground and for anything whose
 *   look is made of edges and corners, such as the tops of walls. Where tiles meet, the one with the
 *   higher draw order has its edges drawn over the other's
 * - blob: the 47-Tile Blob Set, one frame per cell picked from which of its 8 neighbors hold the same
 *   tile (BLOB_FRAME_MASKS), for things such as hedges, and for art centered on a cell, which a
 *   Dual-Grid sheet can't draw. A blob tile is drawn over the ground, with the area's default tile
 *   drawn under it
 */
export const TILE_GRAPHIC_FORMATS = ['dualGrid', 'blob'] as const;

export type TileGraphicFormat = typeof TILE_GRAPHIC_FORMATS[number];

/**
 * Width and height in pixels of each format's sheet: a Dual-Grid sheet is 4 frames by 4, and a blob
 * sheet 8 by 6 (BLOB_SHEET_COLUMNS), each frame a cell
 */
export const TILE_GRAPHIC_SIZES: Record<TileGraphicFormat, { width: number; height: number }> = {
	dualGrid: {
		width: 128,
		height: 128
	},
	blob: {
		width: 256,
		height: 192
	}
};

/**
 * Each graphic, by the key tiles store
 *
 * A Dual-Grid graphic's draw order decides whose edges overlap whose, since a sheet's edges are drawn
 * to overlap the ground below it: grass over dirt, dirt over water. Tiles without a graphic are drawn
 * below every graphic
 */
export const TILE_GRAPHICS = {
	grass: {
		format: 'dualGrid',
		drawOrder: 30
	},
	forest: {
		format: 'dualGrid',
		drawOrder: 40
	},
	mountains: {
		format: 'dualGrid',
		drawOrder: 50
	},
	stoneWall: {
		format: 'dualGrid',
		drawOrder: 60
	},
	hedge: {
		format: 'blob'
	}
} as const satisfies Record<string, { format: 'dualGrid'; drawOrder: number } | { format: 'blob' }>;

export type TileGraphic = keyof typeof TILE_GRAPHICS;

/**
 * The bits of a cell's 8 neighbors in a blob frame's mask, clockwise from north
 */
export const BLOB_NEIGHBORS = [
	{ bit: 1, column: 0, row: -1 },
	{ bit: 2, column: 1, row: -1 },
	{ bit: 4, column: 1, row: 0 },
	{ bit: 8, column: 1, row: 1 },
	{ bit: 16, column: 0, row: 1 },
	{ bit: 32, column: -1, row: 1 },
	{ bit: 64, column: -1, row: 0 },
	{ bit: 128, column: -1, row: -1 }
] as const;

/**
 * Each diagonal neighbor's bit, with the bits of the 2 neighbors beside it: a diagonal only changes
 * the frame when both of those hold the tile too, as an inside corner
 */
const BLOB_DIAGONALS = [
	{ bit: 2, sides: 1 | 4 },
	{ bit: 8, sides: 4 | 16 },
	{ bit: 32, sides: 16 | 64 },
	{ bit: 128, sides: 64 | 1 }
] as const;

/**
 * A blob mask with the diagonals that don't change the frame cleared
 *
 * @param neighbors The bits (BLOB_NEIGHBORS) of the neighbors holding the same tile
 * @return The mask the frame is drawn for
 */
export function reduceBlobMask(neighbors: number): number
{
	let mask = neighbors & 0xff;

	for (const { bit, sides } of BLOB_DIAGONALS)
	{
		if ((mask & sides) !== sides)
		{
			mask &= ~bit;
		}
	}

	return(mask);
}

/**
 * The 47 masks a blob sheet has frames for, in the sheet's order: left to right, top to bottom, 8
 * frames to a row (BLOB_SHEET_COLUMNS). The last, 255, is the tile on every side
 */
export const BLOB_FRAME_MASKS: readonly number[] = [...new Set(Array.from({ length: 256 }, (_, neighbors) => reduceBlobMask(neighbors)))]
	.sort((a, b) => (a - b));

/**
 * How many frames wide a blob sheet is; it is 6 frames tall, and its last place is empty
 */
export const BLOB_SHEET_COLUMNS = 8;

/**
 * Each mask's frame in a blob sheet, by reduced mask
 */
const BLOB_FRAMES = new Map(BLOB_FRAME_MASKS.map((mask, frame) => [mask, frame]));

/**
 * The frame of a blob sheet a cell is drawn with
 *
 * @param neighbors The bits (BLOB_NEIGHBORS) of the neighbors holding the same tile
 * @return The frame's index in the sheet
 */
export function blobFrame(neighbors: number): number
{
	return(BLOB_FRAMES.get(reduceBlobMask(neighbors)) ?? (BLOB_FRAME_MASKS.length - 1));
}

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
