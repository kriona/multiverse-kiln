/**
 * Tiles: the only module that reads or writes the tiles table
 */
import { and, count, eq, isNull, or } from 'drizzle-orm';
import { compareNumbers, IMPASSABLE_WALK_SECONDS, MAX_WALK_SECONDS, sortRows, TILE_USED_IN, tileUsedIn,type EditorTile, type RowComparers, type Ruleset, type TileListPayload, type TileListQuery, type TileSettings, type TileSortColumn } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { tiles } from './schema.js';
import { listTileGraphics } from './tileGraphicRepo.js';

/**
 * A tile as the rest of the server sees it
 */
export interface TileRecord
{
	id: number;

	/**
	 * The default tile's key (DEFAULT_TILE_NAMES), for a default tile whose name the universe kept, so
	 * players read the name in their own language; null for the universe's own tiles and renamed ones
	 */
	key: string | null;

	/**
	 * The universe's name for it, or a default tile's English name
	 */
	name: string;

	indoors: boolean;
	outdoors: boolean;

	/**
	 * 0xRRGGBB
	 */
	color: number;

	/**
	 * The graphic the tile is drawn with (TILE_GRAPHICS), or null for its color or uploadedGraphic
	 */
	graphic: string | null;

	/**
	 * A graphic the universe's editors uploaded that the tile is drawn with, with its draw order, or null
	 */
	uploadedGraphic: { id: string; drawOrder: number } | null;

	visionCost: number;
	walkSeconds: number;
}

/**
 * What a new tile needs
 */
export type NewTile = Pick<typeof tiles.$inferInsert, 'ruleset' | 'universeId' | 'key' | 'name' | 'indoors' | 'outdoors' | 'color' | 'graphic' | 'uploadedGraphicId' | 'visionCost' | 'walkSeconds' | 'enabled'>;

/**
 * The settings of a tile a universe added, which always has a name of its own
 */
export type CustomTileSettings = TileSettings & { name: string };

/**
 * Whether a tile ID names one of a ruleset's default tiles or one a universe added
 */
export type TileKind = 'default' | 'custom';

const settingsColumns = {
	name: tiles.name,
	indoors: tiles.indoors,
	outdoors: tiles.outdoors,
	color: tiles.color,
	graphic: tiles.graphic,
	uploadedGraphicId: tiles.uploadedGraphicId,
	visionCost: tiles.visionCost,
	walkSeconds: tiles.walkSeconds,
	enabled: tiles.enabled
};

/**
 * The IDs of a ruleset's default tiles
 *
 * @param ruleset The ruleset
 * @param executor The database, or a transaction
 * @return Each default tile's ID, by its key (e.g. grass)
 */
export async function findDefaultTileIds(ruleset: Ruleset, executor: Executor = db): Promise<Map<string, number>>
{
	const rows = await executor
		.select({
			id: tiles.id,
			key: tiles.key
		})
		.from(tiles)
		.where(and(
			eq(tiles.ruleset, ruleset),
			isNull(tiles.universeId)
		));

	return(new Map(rows.filter((row) => (row.key !== null)).map((row) => [row.key as string, row.id])));
}

/**
 * Every tile a universe can paint with: its ruleset's default tiles and its own
 *
 * A default tile the universe has edited has the edited copy's settings, under the default tile's ID
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param executor The database, or a transaction
 * @return The tiles, by ID
 */
export async function loadUniverseTiles(universeId: string, ruleset: Ruleset, executor: Executor = db): Promise<TileRecord[]>
{
	const editorTiles = await loadNamedTiles(universeId, ruleset, executor);

	return(editorTiles.map(({ tile, englishName }) => ({
		id: tile.id,
		key: ((tile.name === null) ? tile.key : null),
		name: englishName,
		indoors: tile.indoors,
		outdoors: tile.outdoors,
		color: tile.color,
		graphic: tile.graphic,
		uploadedGraphic: ((tile.uploadedGraphic === null) ? null : { id: tile.uploadedGraphic.id, drawOrder: tile.uploadedGraphic.drawOrder }),
		visionCost: tile.visionCost,
		walkSeconds: tile.walkSeconds
	})));
}

/**
 * Every tile a universe can paint with, as the editor lists them: with whether each tile is custom
 * or edited, and a default tile's key in place of a name it kept
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param executor The database, or a transaction
 * @return The tiles, by ID
 */
export async function loadEditorTiles(universeId: string, ruleset: Ruleset, executor: Executor = db): Promise<EditorTile[]>
{
	return((await loadNamedTiles(universeId, ruleset, executor)).map(({ tile }) => tile));
}

/**
 * Every tile a universe can paint with, as the editor lists them, each with a name in English: the
 * universe's name for it, or a default tile's own
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param executor The database, or a transaction
 * @return The tiles, by ID
 */
async function loadNamedTiles(universeId: string, ruleset: Ruleset, executor: Executor): Promise<{ tile: EditorTile; englishName: string }[]>
{
	const rows = await executor
		.select({
			id: tiles.id,
			universeId: tiles.universeId,
			overridesTileId: tiles.overridesTileId,
			key: tiles.key,
			...settingsColumns
		})
		.from(tiles)
		.where(and(
			eq(tiles.ruleset, ruleset),
			or(
				isNull(tiles.universeId),
				eq(tiles.universeId, universeId)
			)
		))
		.orderBy(tiles.id);
	const copies = new Map(rows
		.filter((row) => (row.overridesTileId !== null))
		.map((row) => [row.overridesTileId, row]));
	const uploadedGraphics = new Map((await listTileGraphics(universeId, executor)).map((graphic) => [graphic.id, graphic]));

	return(rows
		.filter((row) => (row.overridesTileId === null))
		.map((row) =>
		{
			const copy = ((row.universeId === null) ? copies.get(row.id) : undefined);
			const settings = (copy ?? row);
			const custom = (row.universeId !== null);
			const tile: EditorTile = {
				id: row.id,
				key: (custom ? null : row.key),
				name: (custom ? row.name : (copy?.name ?? null)),
				indoors: settings.indoors,
				outdoors: settings.outdoors,
				color: settings.color,
				graphic: settings.graphic,
				uploadedGraphicId: settings.uploadedGraphicId,
				visionCost: settings.visionCost,
				walkSeconds: settings.walkSeconds,
				enabled: settings.enabled,
				custom,
				edited: (copy !== undefined),
				uploadedGraphic: (((settings.uploadedGraphicId === null) ? undefined : uploadedGraphics.get(settings.uploadedGraphicId)) ?? null)
			};

			return({
				tile,
				englishName: (copy?.name ?? row.name ?? '')
			});
		}));
}

/**
 * Compares English tile names, ignoring capitals and accents
 */
const nameCollator = new Intl.Collator('en', { sensitivity: 'base' });

/**
 * How the Tilesets tab's columns compare tiles (TileListQuery.sort)
 */
const tileComparers: RowComparers<{ tile: EditorTile; englishName: string }, TileSortColumn> = {
	name: (first, second) => nameCollator.compare(first.englishName, second.englishName),
	walkTime: (first, second) => compareNumbers(walkSortKey(first.tile), walkSortKey(second.tile)),
	visionCost: (first, second) => compareNumbers(first.tile.visionCost, second.tile.visionCost),
	usedIn: (first, second) => compareNumbers(TILE_USED_IN.indexOf(tileUsedIn(first.tile)), TILE_USED_IN.indexOf(tileUsedIn(second.tile)))
};

/**
 * A tile's walk time for sorting, with an impassable tile slower than any other
 *
 * @param tile The tile
 * @return Its walk time in seconds, or more than MAX_WALK_SECONDS when it is impassable
 */
function walkSortKey(tile: EditorTile): number
{
	return(((tile.walkSeconds === IMPASSABLE_WALK_SECONDS) ? (MAX_WALK_SECONDS + 1) : tile.walkSeconds));
}

/**
 * A page of a universe's tiles, as the Tilesets tab lists them
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param query The filters, the order, and which page
 * @param executor The database, or a transaction
 * @return The page, and how many tiles match in all
 */
export async function listEditorTiles(universeId: string, ruleset: Ruleset, query: TileListQuery, executor: Executor = db): Promise<TileListPayload>
{
	const name = query.name?.toLowerCase();

	// A default tile that kept its name matches by its English name, since the server doesn't have the translations
	const matching = (await loadNamedTiles(universeId, ruleset, executor)).filter(({ tile, englishName }) =>
	{
		return(
			((name === undefined) || englishName.toLowerCase().includes(name))
			&& ((query.passable === undefined) || ((tile.walkSeconds !== IMPASSABLE_WALK_SECONDS) === query.passable))
			&& ((query.usedIn === undefined) || (tileUsedIn(tile) === query.usedIn))
			&& ((query.enabled === undefined) || (tile.enabled === query.enabled))
			&& ((query.custom === undefined) || (tile.custom === query.custom))
			&& ((query.edited === undefined) || (tile.edited === query.edited))
		);
	});
	const offset = (query.offset ?? 0);
	const sorted = ((query.sort === undefined)
		? matching
		: sortRows(sortRows(matching, tileComparers, { column: 'name', direction: 'ascending' }), tileComparers, {
			column: query.sort,
			direction: (query.direction ?? 'ascending')
		}));

	return({
		tiles: sorted
			.slice(offset, offset + (query.limit ?? matching.length))
			.map(({ tile }) => tile),
		total: matching.length
	});
}

/**
 * Whether a tile ID is one of a ruleset's default tiles or one of a universe's own tiles
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param tileId The tile's ID
 * @param executor The database, or a transaction
 * @return The kind of tile, or undefined when the universe can't use a tile with that ID (an edited
 * copy's own ID included)
 */
export async function findTileKind(universeId: string, ruleset: Ruleset, tileId: number, executor: Executor = db): Promise<TileKind | undefined>
{
	const [row] = await executor
		.select({
			universeId: tiles.universeId
		})
		.from(tiles)
		.where(and(
			eq(tiles.id, tileId),
			eq(tiles.ruleset, ruleset),
			isNull(tiles.overridesTileId),
			or(isNull(tiles.universeId), eq(tiles.universeId, universeId))
		))
		.limit(1);

	if (!row)
	{
		return(undefined);
	}

	return(((row.universeId === null) ? 'default' : 'custom'));
}

/**
 * How many tiles a universe has added, not counting its edited copies of default tiles
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The number of tiles
 */
export async function countCustomTiles(universeId: string, executor: Executor = db): Promise<number>
{
	const [row] = await executor
		.select({
			total: count()
		})
		.from(tiles)
		.where(and(
			eq(tiles.universeId, universeId),
			isNull(tiles.overridesTileId)
		));

	return(row.total);
}

/**
 * Adds a tile to a universe
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param settings The tile's settings
 * @param executor The database, or a transaction
 * @return The new tile's ID
 */
export async function createCustomTile(universeId: string, ruleset: Ruleset, settings: CustomTileSettings, executor: Executor = db): Promise<number>
{
	return(createTile({ ruleset, universeId, key: null, ...settings }, executor));
}

/**
 * Changes one of a universe's own tiles
 *
 * @param universeId The universe's ID
 * @param tileId The tile's ID, from findTileKind() as custom
 * @param settings The tile's new settings
 * @param executor The database, or a transaction
 */
export async function updateCustomTile(universeId: string, tileId: number, settings: CustomTileSettings, executor: Executor = db): Promise<void>
{
	await executor
		.update(tiles)
		.set(settings)
		.where(and(
			eq(tiles.id, tileId),
			eq(tiles.universeId, universeId)
		));
}

/**
 * Stores a universe's edited copy of a default tile, replacing any copy it had
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param defaultTileId The default tile's ID, from findTileKind() as default
 * @param settings The copy's settings; a null name keeps the default tile's
 * @param executor The database, or a transaction
 */
export async function saveEditedDefaultTile(universeId: string, ruleset: Ruleset, defaultTileId: number, settings: TileSettings, executor: Executor = db): Promise<void>
{
	await executor
		.insert(tiles)
		.values({
			ruleset,
			universeId,
			overridesTileId: defaultTileId,
			...settings
		})
		.onConflictDoUpdate({
			target: [tiles.universeId, tiles.overridesTileId],
			set: settings
		});
}

/**
 * Discards a universe's edited copy of a default tile, so the universe sees the default again
 *
 * @param universeId The universe's ID
 * @param defaultTileId The default tile's ID
 * @param executor The database, or a transaction
 */
export async function restoreDefaultTile(universeId: string, defaultTileId: number, executor: Executor = db): Promise<void>
{
	await executor
		.delete(tiles)
		.where(and(
			eq(tiles.universeId, universeId),
			eq(tiles.overridesTileId, defaultTileId)
		));
}

/**
 * Deletes one of a universe's own tiles. Check that no map uses it first (isTileInUse in areaRepo)
 *
 * @param universeId The universe's ID
 * @param tileId The tile's ID, from findTileKind() as custom
 * @param executor The database, or a transaction
 */
export async function deleteCustomTile(universeId: string, tileId: number, executor: Executor = db): Promise<void>
{
	await executor
		.delete(tiles)
		.where(and(
			eq(tiles.id, tileId),
			eq(tiles.universeId, universeId)
		));
}

/**
 * Adds a tile
 *
 * @param tile The tile
 * @param executor The database, or a transaction
 * @return The new tile's ID
 */
export async function createTile(tile: NewTile, executor: Executor = db): Promise<number>
{
	const [created] = await executor
		.insert(tiles)
		.values(tile)
		.returning({ id: tiles.id });

	return(created.id);
}
