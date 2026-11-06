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
 *   tile (BLOB_SHEET_MASKS), for things such as hedges and walls, and for art centered on a cell, which a
 *   Dual-Grid sheet can't draw. A blob tile is drawn over the ground, with the area's default tile
 *   drawn under it
 */
export const TILE_GRAPHIC_FORMATS = ['dualGrid', 'blob'] as const;

export type TileGraphicFormat = typeof TILE_GRAPHIC_FORMATS[number];

/**
 * Width and height in pixels of each format's sheet: a Dual-Grid sheet is 4 frames by 4, and a blob
 * sheet 7 by 7 (BLOB_SHEET_COLUMNS), each frame a cell
 */
export const TILE_GRAPHIC_SIZES: Record<TileGraphicFormat, { width: number; height: number }> = {
	dualGrid: {
		width: 128,
		height: 128
	},
	blob: {
		width: 224,
		height: 224
	}
};

/**
 * The corners each frame of a Dual-Grid sheet fills, in the sheet's order: left to right, top to bottom,
 * 4 frames to a row. A frame's corners are summed from top-left 1, top-right 2, bottom-left 4 and
 * bottom-right 8, so frame 0 fills none of them and is never drawn, and the last fills all 4. By rows:
 *
 * - none, bottom-right, bottom-left, top-right
 * - bottom half, top-left and bottom-right, top half, top-right and bottom-left
 * - all but bottom-right, all but bottom-left, all but top-left, all but top-right
 * - right half, left half, top-left, all 4
 */
export const DUAL_GRID_FRAME_CORNERS: readonly number[] = [0, 8, 4, 2, 12, 9, 3, 6, 7, 11, 14, 13, 10, 5, 1, 15];

/**
 * Each set of corners' frame in a Dual-Grid sheet, by the corners' sum
 */
const DUAL_GRID_FRAMES: readonly number[] = Array.from({ length: DUAL_GRID_FRAME_CORNERS.length }, (_, corners) => DUAL_GRID_FRAME_CORNERS.indexOf(corners));

/**
 * The frame of a Dual-Grid sheet drawn on a corner where 4 cells meet
 *
 * @param corners The sum of the corners holding the tile (see DUAL_GRID_FRAME_CORNERS)
 * @return The frame's index in the sheet
 */
export function dualGridFrame(corners: number): number
{
	return(DUAL_GRID_FRAMES[corners & 15]);
}

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
	woodWall: {
		format: 'blob'
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
 * The 47 masks a blob frame can be drawn for, in ascending order: 0 is a cell alone and 255 the tile on
 * every side
 */
export const BLOB_FRAME_MASKS: readonly number[] = [...new Set(Array.from({ length: 256 }, (_, neighbors) => reduceBlobMask(neighbors)))]
	.sort((a, b) => (a - b));

/**
 * The mask (BLOB_NEIGHBORS) each frame of a blob sheet is drawn for, in the sheet's order: left to
 * right, top to bottom, 7 frames to a row (BLOB_SHEET_COLUMNS). The sheet's shapes join up across its
 * frames, like the tiles drawn on a map; the 2 null places, at the start of the last row, are empty
 */
export const BLOB_SHEET_MASKS: readonly (number | null)[] = [
	28, 124, 112, 16, 247, 223, 95,
	31, 255, 241, 17, 253, 127, 125,
	7, 199, 193, 1, 93, 117, 245,
	4, 68, 64, 0, 87, 213, 215,
	116, 92, 23, 209, 20, 84, 80,
	197, 71, 29, 113, 21, 85, 81,
	null, null, 221, 119, 5, 69, 65
];

/**
 * How many frames wide a blob sheet is; it is as many tall
 */
export const BLOB_SHEET_COLUMNS = 7;

/**
 * A blob sheet laid out the other common way, which the tileset upload dialog rearranges into the
 * game's order: 8 frames to a row and 6 rows, holding the masks of BLOB_FRAME_MASKS in its order, with
 * the last place empty
 */
export const SORTED_BLOB_SHEET = {
	columns: 8,
	width: 256,
	height: 192
} as const;

/**
 * Each mask's frame in a blob sheet, by reduced mask
 */
const BLOB_FRAMES = new Map(BLOB_SHEET_MASKS.flatMap((mask, frame) => ((mask === null) ? [] : [[mask, frame] as const])));

/**
 * The frame of a blob sheet a cell is drawn with
 *
 * @param neighbors The bits (BLOB_NEIGHBORS) of the neighbors holding the same tile
 * @return The frame's index in the sheet
 */
export function blobFrame(neighbors: number): number
{
	return(BLOB_FRAMES.get(reduceBlobMask(neighbors)) ?? BLOB_SHEET_MASKS.indexOf(255));
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
