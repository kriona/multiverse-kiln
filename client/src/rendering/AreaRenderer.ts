import Phaser from 'phaser';
import { CHUNK_SIZE, chunkCoordinate, chunkKey, GRID_CELL_SIZE, isInBounds, isTileGraphic, parseChunkKey, positiveModulo, TILE_GRAPHICS, tileIdAt, type AreaPayload, type AreaTile, type AreaTiles } from '@multiverse-kiln/shared';

import { DUAL_GRID_COLUMNS, tileGraphicImage } from './tileGraphics';

/**
 * Color of a void cell, of a cell whose tile the client wasn't told about, and of a cell the group
 * hasn't seen (UNSEEN_CELL)
 */
const VOID_COLOR = 0x000000;

/**
 * How dark the line along each cell's right and bottom edge is, so the cells show as a grid
 */
const GRID_LINE_ALPHA = 0.2;

/**
 * How far beyond the camera's view, in world units, pieces of the map are drawn, so they are ready before they scroll in
 */
const DRAW_MARGIN = GRID_CELL_SIZE * 4;

/**
 * Width and height of one drawn piece of the map, in world units
 */
const PIECE_SIZE = CHUNK_SIZE * GRID_CELL_SIZE;

/**
 * Half a cell: how far up and left of the cells the frames are drawn, each centered on a corner where 4 cells meet
 */
const HALF_CELL = GRID_CELL_SIZE / 2;

/**
 * Tilemap index of an empty cell: nothing is drawn, so the background shows
 */
const EMPTY_INDEX = -1;

/**
 * How many frames wide and tall the atlas of drawn frames is
 */
const ATLAS_COLUMNS = 32;

/**
 * The atlas frame holding the grid's lines; the frames for corners follow it
 */
const GRID_FRAME = 0;

/**
 * The 4 cells around a corner, in the order of their bits in a frame's number (top-left 1, top-right 2,
 * bottom-left 4, bottom-right 8), as offsets from the corner's column and row: the corner at column c
 * and row r is the top-left corner of cell (c, r)
 */
const CORNER_CELLS = [
	{ column: -1, row: -1 },
	{ column: 0, row: -1 },
	{ column: -1, row: 0 },
	{ column: 0, row: 0 }
] as const;

/**
 * Depth of the map's tiles
 */
const GROUND_DEPTH = -1;

/**
 * Depth of the grid's lines: over the tiles, under the fog
 */
const GRID_DEPTH = -0.9;

/**
 * Something a cell can be drawn as: a tile, or the void
 */
interface Drawable
{
	/**
	 * Where it is drawn among the others: one with a higher rank has its edges drawn over a lower one's
	 */
	rank: number;

	/**
	 * 0xRRGGBB, drawn when there is no image
	 */
	color: number;

	/**
	 * Its Dual-Grid sheet, or undefined to draw it in its color
	 */
	image: CanvasImageSource | undefined;
}

/**
 * One drawn piece of the map
 */
interface Piece
{
	map: Phaser.Tilemaps.Tilemap;

	/**
	 * The layer of frames, drawn half a cell up and left of the cells, so single corners can be redrawn in place
	 */
	ground: Phaser.Tilemaps.TilemapLayer;

	/**
	 * The chunks its cells came from, by chunkKey(), so it can be redrawn when one of them changes
	 */
	chunks: Set<string>;
}

/**
 * Draws an area's tiles with the Dual-Grid System, a chunk-sized piece at a time around the camera
 *
 * Each frame is drawn on a corner where 4 cells meet, half a cell up and left of the cells, and is made
 * from the tiles of those 4 cells: the lowest-ranked tile fills it, and each tile above it draws its
 * sheet's frame for the corners it, or a tile above it, holds (see TILE_GRAPHICS). A tile without a
 * graphic fills its quarter of the frame in its color. Each combination is drawn once into an atlas as
 * it first appears, so a piece is one layer of frames, with the grid's lines in a layer over it
 *
 * Pieces are laid out in world units the way the camera sees them, and each one is filled from the
 * area's cells: on an area that loops, a piece past an edge is filled from the far side, so the map
 * carries on seamlessly. Past an edge that doesn't loop, the cells on the edge carry on under it and are
 * then cut off, so the map ends square. Pieces that fall out of view are dropped
 */
export class AreaRenderer
{
	/**
	 * Gives each area's atlas a key of its own, so an area's atlas can be removed while the next one is made
	 */
	private static nextTextureId = 0;

	/**
	 * Width of the area in world units: how far apart the copies of a looping area are
	 */
	readonly width: number;

	/**
	 * Height of the area in world units
	 */
	readonly height: number;

	private readonly tiles: AreaTiles;
	private readonly textureKey: string;
	private readonly atlas: Phaser.Textures.CanvasTexture;

	/**
	 * What each cell can be drawn as; the void is first
	 */
	private readonly drawables: Drawable[];

	/**
	 * Where each tile is in drawables, by tile ID
	 */
	private readonly drawableIndexes = new Map<number, number>();

	/**
	 * Each frame drawn into the atlas so far, by frameKey(), with its place in the atlas
	 */
	private readonly frames = new Map<string, number>();

	/**
	 * Where in the atlas the next frame goes
	 */
	private nextFrame = GRID_FRAME + 1;

	/**
	 * Whether frames have been drawn into the atlas since it was last sent to the GPU
	 */
	private atlasChanged = false;

	/**
	 * Whether a frame was wanted after the atlas had filled up, so the atlas must start over
	 */
	private atlasFull = false;

	/**
	 * The pieces drawn now, by chunkKey() of their position in world units divided by PIECE_SIZE
	 */
	private readonly pieces = new Map<string, Piece>();

	/**
	 * The camera's view at the last update, for redrawing pieces between updates
	 */
	private lastView: Phaser.Geom.Rectangle | undefined;

	/**
	 * @param scene Scene to draw in, whose game has loaded the tile graphics (preloadTileGraphics)
	 * @param area The area
	 * @param chunks The area's stored chunks, by chunkKey(), when someone else holds them and changes
	 * them (calling refreshChunks); otherwise they are taken from area.chunks
	 */
	constructor(private readonly scene: Phaser.Scene, private readonly area: AreaPayload, chunks?: ReadonlyMap<string, readonly number[]>)
	{
		const { bounds } = area;

		this.width = ((bounds.maxColumn - bounds.minColumn) + 1) * GRID_CELL_SIZE;
		this.height = ((bounds.maxRow - bounds.minRow) + 1) * GRID_CELL_SIZE;
		this.tiles = {
			bounds,
			defaultTileId: area.defaultTileId,
			chunks: (chunks ?? new Map(area.chunks.map((chunk) => [chunkKey(chunk.chunkColumn, chunk.chunkRow), chunk.cells])))
		};
		this.textureKey = `area-tiles-${AreaRenderer.nextTextureId++}`;
		this.drawables = this.rankDrawables(area.tiles);

		const atlas = scene.textures.createCanvas(this.textureKey, ATLAS_COLUMNS * GRID_CELL_SIZE, ATLAS_COLUMNS * GRID_CELL_SIZE);

		if (!atlas)
		{
			throw new Error(`Could not create the tile atlas ${this.textureKey}`);
		}

		this.atlas = atlas;
		this.atlas.setFilter(Phaser.Textures.FilterMode.NEAREST);
		this.atlas.context.imageSmoothingEnabled = false;
		this.drawGridFrame();
		this.atlas.refresh();
	}

	/**
	 * Draws the pieces of the map the camera can see, or nearly, and drops the rest
	 *
	 * @param view The camera's view of the world
	 */
	update(view: Phaser.Geom.Rectangle): void
	{
		this.lastView = view;
		this.drawPieces(view);

		if (this.atlasFull)
		{
			// Starting over leaves room for the frames the view needs, whatever was drawn for views before
			this.clearAtlas();
			this.drawPieces(view);
		}

		this.sendAtlas();
	}

	/**
	 * Redraws the pieces showing chunks that have changed
	 *
	 * @param chunkKeys The changed chunks, by chunkKey()
	 */
	refreshChunks(chunkKeys: Iterable<string>): void
	{
		const changed = new Set(chunkKeys);

		for (const [key, piece] of this.pieces)
		{
			if ([...piece.chunks].some((chunk) => changed.has(chunk)))
			{
				piece.map.destroy();
				this.pieces.delete(key);
			}
		}

		if (this.lastView)
		{
			this.update(this.lastView);
		}
	}

	/**
	 * Redraws single cells whose tiles have changed, in place, in every piece showing them; cheaper than
	 * refreshChunks() for a few cells, such as those a group has just seen
	 *
	 * @param cells The cells, on the map
	 */
	refreshCells(cells: readonly { column: number; row: number }[]): void
	{
		const { bounds, loopsEastWest, loopsNorthSouth } = this.area;
		const columns = (bounds.maxColumn - bounds.minColumn) + 1;
		const rows = (bounds.maxRow - bounds.minRow) + 1;
		const corners = new Map<string, { column: number; row: number }>();

		// A cell is part of the frames on its 4 corners
		for (const { column, row } of cells)
		{
			for (const offset of CORNER_CELLS)
			{
				const corner = {
					column: column - offset.column,
					row: row - offset.row
				};

				corners.set(`${corner.column},${corner.row}`, corner);
			}
		}

		for (const [key, piece] of this.pieces)
		{
			const { chunkColumn, chunkRow } = parseChunkKey(key);
			const firstColumn = chunkColumn * CHUNK_SIZE;
			const firstRow = chunkRow * CHUNK_SIZE;

			for (const { column, row } of corners.values())
			{
				for (const drawnRow of copiesIn(row, firstRow, rows, loopsNorthSouth))
				{
					for (const drawnColumn of copiesIn(column, firstColumn, columns, loopsEastWest))
					{
						piece.ground.putTileAt(this.frameAt(drawnColumn, drawnRow, piece.chunks), drawnColumn - firstColumn, drawnRow - firstRow);
					}
				}
			}
		}

		if (this.atlasFull)
		{
			this.clearAtlas();

			if (this.lastView)
			{
				this.drawPieces(this.lastView);
			}
		}

		this.sendAtlas();
	}

	/**
	 * Removes everything this has drawn, and its atlas
	 */
	destroy(): void
	{
		for (const piece of this.pieces.values())
		{
			piece.map.destroy();
		}

		this.pieces.clear();
		this.scene.textures.remove(this.textureKey);
	}

	/**
	 * What each cell can be drawn as, ranked: the void lowest, then the tiles drawn in their colors, then
	 * the tiles with graphics by their draw order. Ties go by tile ID, so the ranking is the same each time
	 *
	 * @param tiles The tiles the area's map can use
	 * @return The void, then each tile, with its index in drawableIndexes
	 */
	private rankDrawables(tiles: readonly AreaTile[]): Drawable[]
	{
		const ranked = tiles
			.map((tile) => ({
				tile,
				image: tileGraphicImage(this.scene, tile.graphic),
				drawOrder: (isTileGraphic(tile.graphic) ? TILE_GRAPHICS[tile.graphic].drawOrder : 0)
			}))
			.sort((a, b) => (
				(Number(a.image !== undefined) - Number(b.image !== undefined))
				|| (a.drawOrder - b.drawOrder)
				|| (a.tile.id - b.tile.id)
			));
		const drawables: Drawable[] = [{ rank: 0, color: VOID_COLOR, image: undefined }];

		for (const { tile, image } of ranked)
		{
			this.drawableIndexes.set(tile.id, drawables.length);
			drawables.push({
				rank: drawables.length,
				color: tile.color,
				image
			});
		}

		return(drawables);
	}

	/**
	 * Draws the pieces of the map in or near a view, and drops the rest
	 *
	 * @param view The camera's view of the world
	 */
	private drawPieces(view: Phaser.Geom.Rectangle): void
	{
		const wanted = new Set<string>();
		const columns = this.pieceRange(view.x, view.right, this.area.bounds.minColumn, this.area.bounds.maxColumn, this.area.loopsEastWest);
		const rows = this.pieceRange(view.y, view.bottom, this.area.bounds.minRow, this.area.bounds.maxRow, this.area.loopsNorthSouth);

		for (let pieceRow = rows.first; pieceRow <= rows.last; pieceRow++)
		{
			for (let pieceColumn = columns.first; pieceColumn <= columns.last; pieceColumn++)
			{
				const key = chunkKey(pieceColumn, pieceRow);

				wanted.add(key);

				if (!this.pieces.has(key))
				{
					this.pieces.set(key, this.drawPiece(pieceColumn, pieceRow));
				}
			}
		}

		for (const [key, piece] of this.pieces)
		{
			if (!wanted.has(key))
			{
				piece.map.destroy();
				this.pieces.delete(key);
			}
		}
	}

	/**
	 * Empties the atlas and drops every piece, so the pieces drawn next fill it with only the frames they need
	 */
	private clearAtlas(): void
	{
		for (const piece of this.pieces.values())
		{
			piece.map.destroy();
		}

		this.pieces.clear();
		this.frames.clear();
		this.nextFrame = GRID_FRAME + 1;
		this.atlasFull = false;
		this.atlas.clear();
		this.drawGridFrame();
	}

	/**
	 * Sends the atlas to the GPU when frames have been drawn into it
	 */
	private sendAtlas(): void
	{
		if (this.atlasChanged)
		{
			this.atlas.refresh();
			this.atlasChanged = false;
		}
	}

	/**
	 * Draws the grid's lines into the atlas: a dark line along a cell's right and bottom edges, over
	 * nothing, so the frames under it show through
	 */
	private drawGridFrame(): void
	{
		const { left, top } = atlasPosition(GRID_FRAME);
		const { context } = this.atlas;

		context.fillStyle = `rgba(0, 0, 0, ${GRID_LINE_ALPHA})`;
		context.fillRect(left + GRID_CELL_SIZE - 1, top, 1, GRID_CELL_SIZE);
		context.fillRect(left, top + GRID_CELL_SIZE - 1, GRID_CELL_SIZE - 1, 1);
		this.atlasChanged = true;
	}

	/**
	 * The pieces along one axis that cover a stretch of the world, plus the margin
	 *
	 * Along an axis that doesn't loop, only pieces that hold some of the area's corners are drawn
	 *
	 * @param start Where the view starts, in world units
	 * @param end Where the view ends, in world units
	 * @param minCell The area's first column or row
	 * @param maxCell The area's last column or row
	 * @param loops Whether the area loops along this axis
	 * @return The first and last piece, which may be an empty range
	 */
	private pieceRange(start: number, end: number, minCell: number, maxCell: number, loops: boolean): { first: number; last: number }
	{
		const first = Math.floor(((start - DRAW_MARGIN) + HALF_CELL) / PIECE_SIZE);
		const last = Math.floor(((end + DRAW_MARGIN) + HALF_CELL) / PIECE_SIZE);

		if (loops)
		{
			return({ first, last });
		}

		// The last cell's far edge is a corner too
		return({
			first: Math.max(first, chunkCoordinate(minCell)),
			last: Math.min(last, chunkCoordinate(maxCell + 1))
		});
	}

	/**
	 * Draws one piece of the map: its frames, and the grid's lines over the cells under them
	 *
	 * @param pieceColumn The piece's column: its position in world units divided by PIECE_SIZE
	 * @param pieceRow The piece's row
	 * @return The piece
	 */
	private drawPiece(pieceColumn: number, pieceRow: number): Piece
	{
		const map = this.scene.make.tilemap({
			tileWidth: GRID_CELL_SIZE,
			tileHeight: GRID_CELL_SIZE,
			width: CHUNK_SIZE,
			height: CHUNK_SIZE
		});
		const left = pieceColumn * PIECE_SIZE;
		const top = pieceRow * PIECE_SIZE;
		const tileset = map.addTilesetImage(this.textureKey, this.textureKey, GRID_CELL_SIZE, GRID_CELL_SIZE, 0, 0);
		const ground = (tileset ? map.createBlankLayer('ground', tileset, left - HALF_CELL, top - HALF_CELL) : null);
		const grid = (tileset ? map.createBlankLayer('grid', tileset, left, top) : null);

		if (!ground || !grid)
		{
			map.destroy();
			throw new Error(`Could not make a tile layer from ${this.textureKey}`);
		}

		const frames: number[][] = [];
		const lines: number[][] = [];
		const chunks = new Set<string>();

		for (let rowOffset = 0; rowOffset < CHUNK_SIZE; rowOffset++)
		{
			const frameRow: number[] = [];
			const lineRow: number[] = [];
			const row = (pieceRow * CHUNK_SIZE) + rowOffset;

			for (let columnOffset = 0; columnOffset < CHUNK_SIZE; columnOffset++)
			{
				const column = (pieceColumn * CHUNK_SIZE) + columnOffset;

				frameRow.push(this.frameAt(column, row, chunks));
				lineRow.push((this.isOnMap(column, row) ? GRID_FRAME : EMPTY_INDEX));
			}

			frames.push(frameRow);
			lines.push(lineRow);
		}

		ground.putTilesAt(frames, 0, 0);
		ground.setDepth(GROUND_DEPTH);
		grid.putTilesAt(lines, 0, 0);
		grid.setDepth(GRID_DEPTH);

		return({ map, ground, chunks });
	}

	/**
	 * Whether a cell as the camera sees it is on the map, once wrapped on an area that loops
	 *
	 * @param column The cell's column, which on a looping area may be past an edge
	 * @param row The cell's row, likewise
	 * @return True when the cell is part of the area
	 */
	private isOnMap(column: number, row: number): boolean
	{
		const { bounds } = this.area;

		return(isInBounds(bounds, this.wrapColumn(column), this.wrapRow(row)));
	}

	/**
	 * The atlas frame drawn on a corner as the camera sees it, drawing it into the atlas the first time
	 * its combination of tiles appears
	 *
	 * @param column The corner's column: it is the top-left corner of the cell in that column and row
	 * @param row The corner's row
	 * @param chunks Collects the keys of the chunks the corner's cells are drawn from
	 * @return Its index in the atlas, or EMPTY_INDEX for a corner with no cell of the map around it
	 */
	private frameAt(column: number, row: number, chunks: Set<string>): number
	{
		const { bounds } = this.area;
		const drawables: number[] = [];
		let cutOff = 0;

		CORNER_CELLS.forEach((offset, bit) =>
		{
			const wrappedColumn = this.wrapColumn(column + offset.column);
			const wrappedRow = this.wrapRow(row + offset.row);

			// Past an edge that doesn't loop, the cell on the edge carries on, and its quarter is cut off
			const cellColumn = Phaser.Math.Clamp(wrappedColumn, bounds.minColumn, bounds.maxColumn);
			const cellRow = Phaser.Math.Clamp(wrappedRow, bounds.minRow, bounds.maxRow);

			if ((cellColumn !== wrappedColumn) || (cellRow !== wrappedRow))
			{
				cutOff |= (1 << bit);
			}

			chunks.add(chunkKey(chunkCoordinate(cellColumn), chunkCoordinate(cellRow)));

			const tileId = tileIdAt(this.tiles, cellColumn, cellRow);

			drawables.push(((tileId === undefined) ? 0 : (this.drawableIndexes.get(tileId) ?? 0)));
		});

		if (cutOff === 0b1111)
		{
			return(EMPTY_INDEX);
		}

		const key = `${drawables.join(',')}/${cutOff}`;
		const known = this.frames.get(key);

		if (known !== undefined)
		{
			return(known);
		}

		if (this.nextFrame >= (ATLAS_COLUMNS * ATLAS_COLUMNS))
		{
			this.atlasFull = true;
			return(EMPTY_INDEX);
		}

		const frame = this.nextFrame++;

		this.drawFrame(frame, drawables, cutOff);
		this.frames.set(key, frame);

		return(frame);
	}

	/**
	 * Draws a corner's frame into the atlas: each of its tiles from the lowest-ranked up, over the
	 * corners it or a higher-ranked tile holds, then cuts off the quarters past the map's edges
	 *
	 * @param frame Where it goes in the atlas
	 * @param corners What each of the corner's 4 cells is drawn as, by its index in drawables, in CORNER_CELLS order
	 * @param cutOff The bits of the quarters past the map's edges
	 */
	private drawFrame(frame: number, corners: readonly number[], cutOff: number): void
	{
		const { left, top } = atlasPosition(frame);
		const { context } = this.atlas;
		const ranks = corners.map((index) => this.drawables[index].rank);
		const layers = [...new Set(corners)].sort((a, b) => (this.drawables[a].rank - this.drawables[b].rank));

		for (const index of layers)
		{
			const drawable = this.drawables[index];
			const mask = ranks.reduce((bits, rank, bit) => ((rank >= drawable.rank) ? (bits | (1 << bit)) : bits), 0);

			if (drawable.image)
			{
				const sourceLeft = (mask % DUAL_GRID_COLUMNS) * GRID_CELL_SIZE;
				const sourceTop = Math.floor(mask / DUAL_GRID_COLUMNS) * GRID_CELL_SIZE;

				context.drawImage(drawable.image, sourceLeft, sourceTop, GRID_CELL_SIZE, GRID_CELL_SIZE, left, top, GRID_CELL_SIZE, GRID_CELL_SIZE);
			}
			else
			{
				context.fillStyle = toCssColor(drawable.color);
				forEachQuarter(mask, (quarterLeft, quarterTop) =>
				{
					context.fillRect(left + quarterLeft, top + quarterTop, HALF_CELL, HALF_CELL);
				});
			}
		}

		forEachQuarter(cutOff, (quarterLeft, quarterTop) =>
		{
			context.clearRect(left + quarterLeft, top + quarterTop, HALF_CELL, HALF_CELL);
		});

		this.atlasChanged = true;
	}

	/**
	 * A column as the camera sees it, on the map: wrapped on an area that loops east-west
	 *
	 * @param column The column, which on a looping area may be past an edge
	 * @return The column on the map, or the same column on an area that doesn't loop
	 */
	private wrapColumn(column: number): number
	{
		const { bounds, loopsEastWest } = this.area;

		return((loopsEastWest ? bounds.minColumn + positiveModulo(column - bounds.minColumn, (bounds.maxColumn - bounds.minColumn) + 1) : column));
	}

	/**
	 * A row as the camera sees it, on the map: wrapped on an area that loops north-south
	 *
	 * @param row The row, which on a looping area may be past an edge
	 * @return The row on the map, or the same row on an area that doesn't loop
	 */
	private wrapRow(row: number): number
	{
		const { bounds, loopsNorthSouth } = this.area;

		return((loopsNorthSouth ? bounds.minRow + positiveModulo(row - bounds.minRow, (bounds.maxRow - bounds.minRow) + 1) : row));
	}
}

/**
 * Where a frame is in the atlas
 *
 * @param frame The frame's index
 * @return Its top-left pixel
 */
function atlasPosition(frame: number): { left: number; top: number }
{
	return({
		left: (frame % ATLAS_COLUMNS) * GRID_CELL_SIZE,
		top: Math.floor(frame / ATLAS_COLUMNS) * GRID_CELL_SIZE
	});
}

/**
 * Calls back with the top-left pixel, within a frame, of each quarter whose bit is set
 *
 * @param mask The quarters' bits, in CORNER_CELLS order
 * @param callback Called for each quarter
 */
function forEachQuarter(mask: number, callback: (left: number, top: number) => void): void
{
	CORNER_CELLS.forEach((offset, bit) =>
	{
		if ((mask & (1 << bit)) !== 0)
		{
			callback((offset.column + 1) * HALF_CELL, (offset.row + 1) * HALF_CELL);
		}
	});
}

/**
 * Where a column or row of corners is drawn within one piece: itself, or on an area that loops, each
 * copy of it the piece shows
 *
 * @param value The column or row
 * @param first The piece's first column or row
 * @param period How many columns or rows the area has
 * @param loops Whether the area loops along this axis
 * @return The columns or rows the piece draws it at
 */
function copiesIn(value: number, first: number, period: number, loops: boolean): number[]
{
	const last = first + CHUNK_SIZE - 1;

	if (!loops)
	{
		return((((value >= first) && (value <= last)) ? [value] : []));
	}

	const copies: number[] = [];

	for (let copy = first + positiveModulo(value - first, period); copy <= last; copy += period)
	{
		copies.push(copy);
	}

	return(copies);
}

/**
 * A color as CSS writes it
 *
 * @param color 0xRRGGBB
 * @return The color, e.g. #7aff3d
 */
function toCssColor(color: number): string
{
	return(`#${color.toString(16).padStart(6, '0')}`);
}
