/**
 * How area maps are laid out: cells, chunks and what a cell holds
 *
 * A map is a grid of cells centered on column 0, row 0, reaching out in every direction. Its cells are
 * stored in square chunks of CHUNK_SIZE x CHUNK_SIZE, and only chunks that differ from the area's
 * default tile are stored at all, so a large, mostly empty map takes little space
 */

/**
 * Cells along each side of a chunk
 */
export const CHUNK_SIZE = 32;

/**
 * Most cells along each side of a map (width and height)
 */
export const MAX_MAP_SIDE = 50000;

/**
 * Cell value meaning the area's default tile
 */
export const DEFAULT_TILE_CELL = 0;

/**
 * Cell value meaning there is nothing there: drawn black, and nobody can enter it
 */
export const VOID_CELL = -1;

/**
 * Cell value a group's room sends in place of a cell the group hasn't seen, so its tile never reaches
 * the client before then: drawn black, and seen past as if it were open ground. It is never stored
 */
export const UNSEEN_CELL = -2;

/**
 * Walk seconds of a tile nobody can enter
 */
export const IMPASSABLE_WALK_SECONDS = 0;

/**
 * Seconds of game time walking a square of a new indoor tile takes. In an indoor area, a player
 * crosses a tile this quick or quicker on screen at full speed, and a slower one at a matching
 * fraction of it: 20 seconds moves at half speed
 */
export const DEFAULT_INDOOR_WALK_SECONDS = 10;

/**
 * Seconds of game time walking a square of a new outdoor tile takes: 10 minutes. In an outdoor area,
 * a player crosses a tile this quick or quicker on screen at full speed, and a slower one at a
 * matching fraction of it: 20 minutes moves at half speed
 */
export const DEFAULT_OUTDOOR_WALK_SECONDS = 600;

/**
 * The walk seconds a player crosses at full speed on screen in an area, which is also what a new tile
 * for that kind of area takes
 *
 * @param indoors Whether the area is indoors
 * @return DEFAULT_INDOOR_WALK_SECONDS or DEFAULT_OUTDOOR_WALK_SECONDS
 */
export function defaultWalkSeconds(indoors: boolean): number
{
	return((indoors ? DEFAULT_INDOOR_WALK_SECONDS : DEFAULT_OUTDOOR_WALK_SECONDS));
}

/**
 * The most seconds of game time walking a square of a tile can take
 */
export const MAX_WALK_SECONDS = 3600;

/**
 * The cells a map covers, inclusive at both ends
 */
export interface MapBounds
{
	minColumn: number;
	minRow: number;
	maxColumn: number;
	maxRow: number;
}

/**
 * The tiles of an area's map: one layer of cells
 */
export interface AreaTiles
{
	bounds: MapBounds;

	/**
	 * Tile ID of every cell holding DEFAULT_TILE_CELL, including every cell of a chunk that isn't stored
	 */
	defaultTileId: number;

	/**
	 * The stored chunks, keyed by chunkKey(). Each holds CHUNK_SIZE * CHUNK_SIZE cell values, row by row:
	 * a tile ID, DEFAULT_TILE_CELL or VOID_CELL, or on a client in a group's room UNSEEN_CELL
	 */
	chunks: ReadonlyMap<string, readonly number[]>;
}

/**
 * The chunk column or row a cell column or row falls in
 *
 * @param coordinate A cell's column or row
 * @return The chunk's column or row
 */
export function chunkCoordinate(coordinate: number): number
{
	return(Math.floor(coordinate / CHUNK_SIZE));
}

/**
 * The key a chunk is stored under in AreaTiles.chunks
 *
 * @param chunkColumn The chunk's column, from chunkCoordinate()
 * @param chunkRow The chunk's row, from chunkCoordinate()
 * @return The key
 */
export function chunkKey(chunkColumn: number, chunkRow: number): string
{
	return(`${chunkColumn},${chunkRow}`);
}

/**
 * The chunk a key from chunkKey() names
 *
 * @param key The key
 * @return The chunk's column and row
 */
export function parseChunkKey(key: string): { chunkColumn: number; chunkRow: number }
{
	const [chunkColumn, chunkRow] = key.split(',').map(Number);

	return({ chunkColumn, chunkRow });
}

/**
 * Where a cell's value sits in its chunk's array
 *
 * @param column The cell's column
 * @param row The cell's row
 * @return The index, row by row from the chunk's top left
 */
export function cellIndexInChunk(column: number, row: number): number
{
	return((positiveModulo(row, CHUNK_SIZE) * CHUNK_SIZE) + positiveModulo(column, CHUNK_SIZE));
}

/**
 * Whether a cell is inside a map's bounds
 *
 * @param bounds The map's bounds
 * @param column The cell's column
 * @param row The cell's row
 * @return True when the cell is on the map
 */
export function isInBounds(bounds: MapBounds, column: number, row: number): boolean
{
	return((column >= bounds.minColumn) && (column <= bounds.maxColumn) && (row >= bounds.minRow) && (row <= bounds.maxRow));
}

/**
 * The tile in a cell
 *
 * @param tiles The area's tiles
 * @param column The cell's column
 * @param row The cell's row
 * @return The tile's ID, or undefined for a void or unseen cell or one outside the map
 */
export function tileIdAt(tiles: AreaTiles, column: number, row: number): number | undefined
{
	if (!isInBounds(tiles.bounds, column, row))
	{
		return(undefined);
	}

	const chunk = tiles.chunks.get(chunkKey(chunkCoordinate(column), chunkCoordinate(row)));
	const value = (chunk?.[cellIndexInChunk(column, row)] ?? DEFAULT_TILE_CELL);

	if ((value === VOID_CELL) || (value === UNSEEN_CELL))
	{
		return(undefined);
	}

	return(((value === DEFAULT_TILE_CELL) ? tiles.defaultTileId : value));
}

/**
 * The copy of a coordinate on a looping map that is nearest another: on a map that repeats every
 * `period` world units, value + k * period for whichever whole k lands closest to reference
 *
 * Used to keep positions continuous as players cross a looping edge, and to draw a player on the far
 * side of the edge next to the camera rather than a whole map away
 *
 * @param value The coordinate
 * @param reference The coordinate to be near
 * @param period How far apart the copies are: the map's width or height in world units
 * @return The nearest copy of value
 */
export function nearestCopy(value: number, reference: number, period: number): number
{
	return(value + (Math.round((reference - value) / period) * period));
}

/**
 * The remainder of a division, always from 0 up to the divisor, even for a negative value
 *
 * @param value The value to divide
 * @param divisor The divisor
 * @return The remainder
 */
export function positiveModulo(value: number, divisor: number): number
{
	return(((value % divisor) + divisor) % divisor);
}
