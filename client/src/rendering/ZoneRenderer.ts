import type Phaser from 'phaser';
import { CHUNK_SIZE, chunkCoordinate, chunkKey, GRID_CELL_SIZE, isInBounds, positiveModulo, tileIdAt, type ZonePayload, type ZoneTiles } from '@multiverse-kiln/shared';

/**
 * Color of a void cell, and of a cell whose tile the client wasn't told about
 */
const VOID_COLOR = 0x000000;

/**
 * How much darker each tile's right and bottom edge is drawn, so the cells show as a grid
 */
const EDGE_SHADE = 0.8;

/**
 * How far beyond the camera's view, in world units, pieces of the map are drawn, so they are ready before they scroll in
 */
const DRAW_MARGIN = GRID_CELL_SIZE * 4;

/**
 * Width and height of one drawn piece of the map, in world units
 */
const PIECE_SIZE = CHUNK_SIZE * GRID_CELL_SIZE;

/**
 * Tilemap index of an empty cell: nothing is drawn, so the background shows
 */
const EMPTY_INDEX = -1;

/**
 * Draws a zone's tiles, a chunk-sized piece at a time around the camera
 *
 * Tiles are drawn as their colors. Pieces are laid out in world units the way the camera sees them,
 * and each one is filled from the zone's cells: on a zone that loops, a piece past an edge is filled
 * from the far side, so the map carries on seamlessly. Pieces that fall out of view are dropped
 */
export class ZoneRenderer
{
	/**
	 * Gives each zone's tile texture a key of its own, so a zone's texture can be removed while the next one is made
	 */
	private static nextTextureId = 0;

	/**
	 * Width of the zone in world units: how far apart the copies of a looping zone are
	 */
	readonly width: number;

	/**
	 * Height of the zone in world units
	 */
	readonly height: number;

	private readonly tiles: ZoneTiles;
	private readonly textureKey: string;

	/**
	 * Where each tile is in the tile texture, by tile ID
	 */
	private readonly tileIndexes = new Map<number, number>();

	/**
	 * Where the void color is in the tile texture
	 */
	private readonly voidIndex: number;

	/**
	 * The pieces drawn now, by chunkKey() of their position in world units divided by PIECE_SIZE
	 */
	private readonly pieces = new Map<string, Phaser.Tilemaps.Tilemap>();

	/**
	 * @param scene Scene to draw in
	 * @param zone The zone
	 */
	constructor(private readonly scene: Phaser.Scene, private readonly zone: ZonePayload)
	{
		const { bounds } = zone;

		this.width = ((bounds.maxColumn - bounds.minColumn) + 1) * GRID_CELL_SIZE;
		this.height = ((bounds.maxRow - bounds.minRow) + 1) * GRID_CELL_SIZE;
		this.tiles = {
			bounds,
			defaultTileId: zone.defaultTileId,
			chunks: new Map(zone.chunks.map((chunk) => [chunkKey(chunk.chunkColumn, chunk.chunkRow), chunk.cells]))
		};
		this.textureKey = `zone-tiles-${ZoneRenderer.nextTextureId++}`;

		zone.tiles.forEach((tile, index) =>
		{
			this.tileIndexes.set(tile.id, index);
		});

		this.voidIndex = zone.tiles.length;
		this.createTexture();
	}

	/**
	 * Draws the pieces of the map the camera can see, or nearly, and drops the rest
	 *
	 * @param view The camera's view of the world
	 */
	update(view: Phaser.Geom.Rectangle): void
	{
		const wanted = new Set<string>();
		const columns = this.pieceRange(view.x, view.right, this.zone.bounds.minColumn, this.zone.bounds.maxColumn, this.zone.loopsEastWest);
		const rows = this.pieceRange(view.y, view.bottom, this.zone.bounds.minRow, this.zone.bounds.maxRow, this.zone.loopsNorthSouth);

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
				piece.destroy();
				this.pieces.delete(key);
			}
		}
	}

	/**
	 * Removes everything this has drawn, and its texture
	 */
	destroy(): void
	{
		for (const piece of this.pieces.values())
		{
			piece.destroy();
		}

		this.pieces.clear();
		this.scene.textures.remove(this.textureKey);
	}

	/**
	 * Makes the texture the pieces are drawn from: one cell-sized square of each tile's color, then the void color
	 */
	private createTexture(): void
	{
		const colors = [...this.zone.tiles.map((tile) => tile.color), VOID_COLOR];
		const texture = this.scene.textures.createCanvas(this.textureKey, colors.length * GRID_CELL_SIZE, GRID_CELL_SIZE);

		if (!texture)
		{
			throw new Error(`Could not create the tile texture ${this.textureKey}`);
		}

		const { context } = texture;

		colors.forEach((color, index) =>
		{
			const left = index * GRID_CELL_SIZE;

			context.fillStyle = toCssColor(shade(color, EDGE_SHADE));
			context.fillRect(left, 0, GRID_CELL_SIZE, GRID_CELL_SIZE);
			context.fillStyle = toCssColor(color);
			context.fillRect(left, 0, GRID_CELL_SIZE - 1, GRID_CELL_SIZE - 1);
		});

		texture.refresh();
	}

	/**
	 * The pieces along one axis that cover a stretch of the world, plus the margin
	 *
	 * Along an axis that doesn't loop, only pieces that hold some of the zone are drawn
	 *
	 * @param start Where the view starts, in world units
	 * @param end Where the view ends, in world units
	 * @param minCell The zone's first column or row
	 * @param maxCell The zone's last column or row
	 * @param loops Whether the zone loops along this axis
	 * @return The first and last piece, which may be an empty range
	 */
	private pieceRange(start: number, end: number, minCell: number, maxCell: number, loops: boolean): { first: number; last: number }
	{
		const first = Math.floor((start - DRAW_MARGIN) / PIECE_SIZE);
		const last = Math.floor((end + DRAW_MARGIN) / PIECE_SIZE);

		if (loops)
		{
			return({ first, last });
		}

		return({
			first: Math.max(first, chunkCoordinate(minCell)),
			last: Math.min(last, chunkCoordinate(maxCell))
		});
	}

	/**
	 * Draws one piece of the map
	 *
	 * @param pieceColumn The piece's column: its position in world units divided by PIECE_SIZE
	 * @param pieceRow The piece's row
	 * @return The piece's tilemap
	 */
	private drawPiece(pieceColumn: number, pieceRow: number): Phaser.Tilemaps.Tilemap
	{
		const map = this.scene.make.tilemap({
			tileWidth: GRID_CELL_SIZE,
			tileHeight: GRID_CELL_SIZE,
			width: CHUNK_SIZE,
			height: CHUNK_SIZE
		});
		const tileset = map.addTilesetImage(this.textureKey, this.textureKey, GRID_CELL_SIZE, GRID_CELL_SIZE, 0, 0);
		const layer = (tileset ? map.createBlankLayer('ground', tileset, pieceColumn * PIECE_SIZE, pieceRow * PIECE_SIZE) : null);

		if (!layer)
		{
			map.destroy();
			throw new Error(`Could not make a tile layer from ${this.textureKey}`);
		}

		const indexes: number[][] = [];

		for (let rowOffset = 0; rowOffset < CHUNK_SIZE; rowOffset++)
		{
			const row: number[] = [];

			for (let columnOffset = 0; columnOffset < CHUNK_SIZE; columnOffset++)
			{
				row.push(this.indexAt((pieceColumn * CHUNK_SIZE) + columnOffset, (pieceRow * CHUNK_SIZE) + rowOffset));
			}

			indexes.push(row);
		}

		layer.putTilesAt(indexes, 0, 0);
		layer.setDepth(-1);

		return(map);
	}

	/**
	 * What to draw for a cell as the camera sees it
	 *
	 * @param column The cell's column, which on a looping zone may be past an edge
	 * @param row The cell's row, likewise
	 * @return Its index in the tile texture, or EMPTY_INDEX for a cell off the map
	 */
	private indexAt(column: number, row: number): number
	{
		const { bounds, loopsEastWest, loopsNorthSouth } = this.zone;
		const wrappedColumn = (loopsEastWest ? bounds.minColumn + positiveModulo(column - bounds.minColumn, (bounds.maxColumn - bounds.minColumn) + 1) : column);
		const wrappedRow = (loopsNorthSouth ? bounds.minRow + positiveModulo(row - bounds.minRow, (bounds.maxRow - bounds.minRow) + 1) : row);

		if (!isInBounds(bounds, wrappedColumn, wrappedRow))
		{
			return(EMPTY_INDEX);
		}

		const tileId = tileIdAt(this.tiles, wrappedColumn, wrappedRow);

		return(((tileId === undefined) ? this.voidIndex : (this.tileIndexes.get(tileId) ?? this.voidIndex)));
	}
}

/**
 * A color made darker
 *
 * @param color 0xRRGGBB
 * @param factor How much of each channel to keep, from 0 to 1
 * @return The darker color
 */
function shade(color: number, factor: number): number
{
	const red = Math.round(((color >> 16) & 0xff) * factor);
	const green = Math.round(((color >> 8) & 0xff) * factor);
	const blue = Math.round((color & 0xff) * factor);

	return((red << 16) | (green << 8) | blue);
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
