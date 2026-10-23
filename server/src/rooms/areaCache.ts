import { chunkKey, createVisionMap, GRID_CELL_SIZE, parseChunkKey, type AreaChunk, type AreaChunkUpdate, type AreaPayload, type VisionMap } from '@multiverse-kiln/shared';

import type { LoadedArea } from '../db/areaRepo.js';
import type { Grid } from '../logic/movement.js';
import { createAreaGrid, type AreaMap } from '../logic/areaGrid.js';

/**
 * An area a room has loaded, ready to play in: its settings, links and tiles, and the chunks of its
 * map loaded so far
 */
export interface ActiveArea
{
	loaded: LoadedArea;

	/**
	 * The map as movement sees it; a cell whose chunk hasn't loaded can't be entered
	 */
	map: AreaMap;

	grid: Grid;

	/**
	 * The map as vision sees it; a cell whose chunk hasn't loaded is seen as the default tile
	 */
	vision: VisionMap;

	/**
	 * The loaded chunks that aren't all the default tile, by chunkKey()
	 */
	chunks: Map<string, number[]>;

	/**
	 * Every loaded chunk, by chunkKey()
	 */
	loadedChunks: Set<string>;
}

/**
 * Reads an area's settings, links and tiles by ID; undefined when there is no such area
 */
export type AreaLoader = (areaId: string) => Promise<LoadedArea | undefined>;

/**
 * Reads some of an area's stored chunks
 */
export type ChunkReader = (areaId: string, chunks: { chunkColumn: number; chunkRow: number }[]) => Promise<AreaChunk[]>;

/**
 * The areas a room has loaded, so each is read from the database once however many players use it,
 * and the chunks of their maps near the players
 *
 * Loading happens outside the simulation tick: the tick only reads what is already here (get), a
 * player waits while the area they are heading for loads (load), and chunks arrive while players
 * move toward them (loadChunks). An area's map can be up to MAX_MAP_SIDE across, so only the chunks
 * near players are kept
 */
export class AreaCache
{
	private readonly areas = new Map<string, ActiveArea>();
	private readonly loading = new Map<string, Promise<ActiveArea | undefined>>();

	/**
	 * The reads under way for each area's chunks, by chunkKey(), so no chunk is asked for twice at once
	 * and a caller wanting a chunk that is on its way can wait for it
	 */
	private readonly pendingChunks = new Map<string, Map<string, Promise<string[]>>>();

	/**
	 * @param loadArea Reads an area's settings, links and tiles
	 * @param readChunks Reads some of an area's stored chunks
	 */
	constructor(private readonly loadArea: AreaLoader, private readonly readChunks: ChunkReader)
	{
	}

	/**
	 * An area that has already been loaded
	 *
	 * @param areaId The area's ID
	 * @return The area, or undefined when it hasn't been loaded
	 */
	get(areaId: string): ActiveArea | undefined
	{
		return(this.areas.get(areaId));
	}

	/**
	 * Every area loaded
	 *
	 * @return The areas
	 */
	all(): ActiveArea[]
	{
		return([...this.areas.values()]);
	}

	/**
	 * An area, loading it first if it isn't here yet, with none of its chunks. Several calls for the same
	 * area share one load
	 *
	 * @param areaId The area's ID
	 * @return The area, or undefined when there is no such area
	 */
	async load(areaId: string): Promise<ActiveArea | undefined>
	{
		const area = this.areas.get(areaId);

		if (area)
		{
			return(area);
		}

		let loading = this.loading.get(areaId);

		if (!loading)
		{
			loading = this.read(areaId).finally(() =>
			{
				this.loading.delete(areaId);
			});
			this.loading.set(areaId, loading);
		}

		return(loading);
	}

	/**
	 * Loads chunks of a loaded area's map, and waits for any of them already on their way
	 *
	 * @param areaId The area's ID
	 * @param chunkKeys The chunks wanted, by chunkKey()
	 * @return The chunks this call read; empty when the area was reloaded or dropped meanwhile
	 */
	async loadChunks(areaId: string, chunkKeys: Iterable<string>): Promise<string[]>
	{
		const area = this.areas.get(areaId);

		if (!area)
		{
			return([]);
		}

		let pending = this.pendingChunks.get(areaId);

		if (!pending)
		{
			pending = new Map();
			this.pendingChunks.set(areaId, pending);
		}

		const missing = [...chunkKeys].filter((key) => !area.loadedChunks.has(key));
		const others = new Set(missing
			.map((key) => pending.get(key))
			.filter((read) => (read !== undefined)));
		const wanted = missing.filter((key) => !pending.has(key));
		const read = ((wanted.length > 0) ? this.readInto(area, wanted) : undefined);

		if (read)
		{
			const reads = pending;

			for (const key of wanted)
			{
				reads.set(key, read);
			}

			void read
				.finally(() =>
				{
					for (const key of wanted)
					{
						if (reads.get(key) === read)
						{
							reads.delete(key);
						}
					}
				})
				.catch(() => undefined);
		}

		// Another caller's read failing is that caller's to report; this one only waits for it
		await Promise.allSettled(others);

		return((read ? await read : []));
	}

	/**
	 * Reads chunks of an area and adds them to it
	 *
	 * @param area The area
	 * @param chunkKeys The chunks, by chunkKey(), none of them loaded
	 * @return The chunks read; empty when the area was reloaded or dropped meanwhile
	 */
	private async readInto(area: ActiveArea, chunkKeys: string[]): Promise<string[]>
	{
		const areaId = area.loaded.area.id;
		const stored = await this.readChunks(areaId, chunkKeys.map((key) => parseChunkKey(key)));

		// The area may have been reloaded, with other bounds or cells, while the chunks were read
		if (this.areas.get(areaId) !== area)
		{
			return([]);
		}

		for (const chunk of stored)
		{
			area.chunks.set(chunkKey(chunk.chunkColumn, chunk.chunkRow), chunk.cells);
		}

		for (const key of chunkKeys)
		{
			area.loadedChunks.add(key);
		}

		return(chunkKeys);
	}

	/**
	 * Reads chunks of a loaded area's map again, after an editor has changed them. Chunks that aren't
	 * loaded are left for when players come near them
	 *
	 * @param areaId The area's ID
	 * @param chunkKeys The changed chunks, by chunkKey()
	 * @return The loaded chunks that were read again
	 */
	async reloadChunks(areaId: string, chunkKeys: Iterable<string>): Promise<string[]>
	{
		const area = this.areas.get(areaId);
		const changed = [...chunkKeys].filter((key) => (area?.loadedChunks.has(key) ?? false));

		if (!area || (changed.length === 0))
		{
			return([]);
		}

		const stored = await this.readChunks(areaId, changed.map((key) => parseChunkKey(key)));

		if (this.areas.get(areaId) !== area)
		{
			return([]);
		}

		const cells = new Map(stored.map((chunk) => [chunkKey(chunk.chunkColumn, chunk.chunkRow), chunk.cells]));

		for (const key of changed)
		{
			const chunk = cells.get(key);

			if (chunk)
			{
				area.chunks.set(key, chunk);
			}
			else
			{
				area.chunks.delete(key);
			}
		}

		return(changed);
	}

	/**
	 * Forgets an area's chunks that no player is near
	 *
	 * @param areaId The area's ID
	 * @param keep The chunks to keep, by chunkKey()
	 */
	dropChunks(areaId: string, keep: ReadonlySet<string>): void
	{
		const area = this.areas.get(areaId);

		for (const key of [...(area?.loadedChunks ?? [])])
		{
			if (!keep.has(key))
			{
				area?.loadedChunks.delete(key);
				area?.chunks.delete(key);
			}
		}
	}

	/**
	 * Reads a loaded area's settings, links and tiles again, after an editor has changed them
	 *
	 * @param areaId The area's ID
	 * @param keepChunks Whether the loaded chunks are still right (only the tiles changed); otherwise
	 * they are dropped, to load again as players need them
	 * @return The area as it now is; undefined when it wasn't loaded, or no longer exists (and is forgotten)
	 */
	async reload(areaId: string, keepChunks: boolean): Promise<ActiveArea | undefined>
	{
		const before = this.areas.get(areaId);

		if (!before)
		{
			return(undefined);
		}

		const loaded = await this.loadArea(areaId);

		if (this.areas.get(areaId) !== before)
		{
			return(this.areas.get(areaId));
		}

		if (!loaded)
		{
			this.areas.delete(areaId);
			return(undefined);
		}

		const area = activate(loaded, (keepChunks ? before.chunks : new Map<string, number[]>()), (keepChunks ? before.loadedChunks : new Set<string>()));

		this.areas.set(areaId, area);

		return(area);
	}

	/**
	 * Forgets an area, such as one that has been deleted
	 *
	 * @param areaId The area's ID
	 */
	forget(areaId: string): void
	{
		this.areas.delete(areaId);
	}

	/**
	 * Reads an area and gets it ready to play in
	 *
	 * @param areaId The area's ID
	 * @return The area, or undefined when there is no such area
	 */
	private async read(areaId: string): Promise<ActiveArea | undefined>
	{
		const loaded = await this.loadArea(areaId);

		if (!loaded)
		{
			return(undefined);
		}

		const area = activate(loaded, new Map(), new Set());

		this.areas.set(areaId, area);

		return(area);
	}
}

/**
 * Gets a loaded area ready to play in
 *
 * @param loaded The area's settings, links and tiles
 * @param chunks Its loaded chunks that aren't all the default tile
 * @param loadedChunks Every loaded chunk
 * @return The area
 */
function activate(loaded: LoadedArea, chunks: Map<string, number[]>, loadedChunks: Set<string>): ActiveArea
{
	const map: AreaMap = {
		tiles: {
			bounds: loaded.bounds,
			defaultTileId: loaded.defaultTileId,
			chunks
		},
		indoors: loaded.area.indoors,
		loopsEastWest: loaded.loopsEastWest,
		loopsNorthSouth: loaded.loopsNorthSouth,
		tileWalkSeconds: new Map(loaded.tiles.map((tile) => [tile.id, tile.walkSeconds])),
		links: loaded.links,
		loadedChunks
	};

	return({
		loaded,
		map,
		grid: createAreaGrid(map, GRID_CELL_SIZE),
		vision: createVisionMap(map.tiles, loaded.loopsEastWest, loaded.loopsNorthSouth, new Map(loaded.tiles.map((tile) => [tile.id, tile.visionCost]))),
		chunks,
		loadedChunks
	});
}

/**
 * What a group remembers of the areas, in a group's room: the cells it has seen (see SeenCells). Its
 * clients are sent only those
 */
export interface AreaMemory
{
	/**
	 * A chunk's cells with each cell the group hasn't seen as UNSEEN_CELL
	 *
	 * @param areaId The area's ID
	 * @param key The chunk, by chunkKey()
	 * @param cells The chunk's cells, or null when every cell is the default tile
	 * @return The cells; null when every cell is the default tile and has been seen
	 */
	mask(areaId: string, key: string, cells: readonly number[] | null): number[] | null;

	/**
	 * Whether the group has seen a cell
	 *
	 * @param areaId The area's ID
	 * @param column The cell's column
	 * @param row The cell's row
	 * @return True when it has
	 */
	has(areaId: string, column: number, row: number): boolean;
}

/**
 * What a client is told about an area: its settings, tiles and some chunks of its map, and where its
 * links are but not where they lead. In a group's room, only what the group has seen of the map
 *
 * @param area The area
 * @param chunkKeys The loaded chunks to include, by chunkKey(); chunks that are all the default tile
 * (and all seen) are left out
 * @param memory What the group has seen, in a group's room
 * @return The payload
 */
export function toAreaPayload(area: ActiveArea, chunkKeys: Iterable<string>, memory?: AreaMemory): AreaPayload
{
	const { loaded } = area;

	return({
		areaId: loaded.area.id,
		name: loaded.area.name,
		ruleset: loaded.ruleset,
		indoors: loaded.area.indoors,
		time: loaded.time,
		displayTime: loaded.displayTime,
		lightLevel: loaded.lightLevel,
		fullVision: loaded.fullVision,
		bounds: loaded.bounds,
		loopsEastWest: loaded.loopsEastWest,
		loopsNorthSouth: loaded.loopsNorthSouth,
		defaultTileId: loaded.defaultTileId,
		// A default tile's English name stays on the server; the client names it in the player's language
		tiles: loaded.tiles.map((tile) => ({
			id: tile.id,
			key: tile.key,
			name: ((tile.key === null) ? tile.name : null),
			color: tile.color,
			visionCost: tile.visionCost
		})),
		chunks: toChunkUpdates(area, chunkKeys, memory)
			.filter((chunk): chunk is AreaChunk => (chunk.cells !== null)),
		links: loaded.links
			.filter((link) => (memory?.has(loaded.area.id, link.column, link.row) ?? true))
			.map((link) => ({
				column: link.column,
				row: link.row,
				mode: link.mode
			}))
	});
}

/**
 * Loaded chunks of an area as clients are sent them
 *
 * @param area The area
 * @param chunkKeys The chunks, by chunkKey()
 * @param memory What the group has seen, in a group's room
 * @return Each chunk, with null cells when it is all the default tile (and all seen)
 */
export function toChunkUpdates(area: ActiveArea, chunkKeys: Iterable<string>, memory?: AreaMemory): AreaChunkUpdate[]
{
	return([...chunkKeys].map((key) =>
	{
		const cells = (area.chunks.get(key) ?? null);

		return({
			...parseChunkKey(key),
			cells: (memory ? memory.mask(area.loaded.area.id, key, cells) : (cells ? [...cells] : null))
		});
	}));
}
