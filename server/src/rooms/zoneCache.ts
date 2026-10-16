import { chunkKey, GRID_CELL_SIZE, parseChunkKey, type ZoneChunk, type ZoneChunkUpdate, type ZonePayload } from '@multiverse-kiln/shared';

import type { LoadedZone } from '../db/zoneRepo.js';
import type { Grid } from '../logic/movement.js';
import { createZoneGrid, type ZoneMap } from '../logic/zoneGrid.js';

/**
 * A zone a room has loaded, ready to play in: its settings, links and tiles, and the chunks of its
 * map loaded so far
 */
export interface ActiveZone
{
	loaded: LoadedZone;

	/**
	 * The map as movement sees it; a cell whose chunk hasn't loaded can't be entered
	 */
	map: ZoneMap;

	grid: Grid;

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
 * Reads a zone's settings, links and tiles by ID; undefined when there is no such zone
 */
export type ZoneLoader = (zoneId: string) => Promise<LoadedZone | undefined>;

/**
 * Reads some of a zone's stored chunks
 */
export type ChunkReader = (zoneId: string, chunks: { chunkColumn: number; chunkRow: number }[]) => Promise<ZoneChunk[]>;

/**
 * The zones a room has loaded, so each is read from the database once however many players use it,
 * and the chunks of their maps near the players
 *
 * Loading happens outside the simulation tick: the tick only reads what is already here (get), a
 * player waits while the zone they are heading for loads (load), and chunks arrive while players
 * move toward them (loadChunks). A zone's map can be up to MAX_MAP_SIDE across, so only the chunks
 * near players are kept
 */
export class ZoneCache
{
	private readonly zones = new Map<string, ActiveZone>();
	private readonly loading = new Map<string, Promise<ActiveZone | undefined>>();

	/**
	 * The reads under way for each zone's chunks, by chunkKey(), so no chunk is asked for twice at once
	 * and a caller wanting a chunk that is on its way can wait for it
	 */
	private readonly pendingChunks = new Map<string, Map<string, Promise<string[]>>>();

	/**
	 * @param loadZone Reads a zone's settings, links and tiles
	 * @param readChunks Reads some of a zone's stored chunks
	 */
	constructor(private readonly loadZone: ZoneLoader, private readonly readChunks: ChunkReader)
	{
	}

	/**
	 * A zone that has already been loaded
	 *
	 * @param zoneId The zone's ID
	 * @return The zone, or undefined when it hasn't been loaded
	 */
	get(zoneId: string): ActiveZone | undefined
	{
		return(this.zones.get(zoneId));
	}

	/**
	 * Every zone loaded
	 *
	 * @return The zones
	 */
	all(): ActiveZone[]
	{
		return([...this.zones.values()]);
	}

	/**
	 * A zone, loading it first if it isn't here yet, with none of its chunks. Several calls for the same
	 * zone share one load
	 *
	 * @param zoneId The zone's ID
	 * @return The zone, or undefined when there is no such zone
	 */
	async load(zoneId: string): Promise<ActiveZone | undefined>
	{
		const zone = this.zones.get(zoneId);

		if (zone)
		{
			return(zone);
		}

		let loading = this.loading.get(zoneId);

		if (!loading)
		{
			loading = this.read(zoneId).finally(() =>
			{
				this.loading.delete(zoneId);
			});
			this.loading.set(zoneId, loading);
		}

		return(loading);
	}

	/**
	 * Loads chunks of a loaded zone's map, and waits for any of them already on their way
	 *
	 * @param zoneId The zone's ID
	 * @param chunkKeys The chunks wanted, by chunkKey()
	 * @return The chunks this call read; empty when the zone was reloaded or dropped meanwhile
	 */
	async loadChunks(zoneId: string, chunkKeys: Iterable<string>): Promise<string[]>
	{
		const zone = this.zones.get(zoneId);

		if (!zone)
		{
			return([]);
		}

		let pending = this.pendingChunks.get(zoneId);

		if (!pending)
		{
			pending = new Map();
			this.pendingChunks.set(zoneId, pending);
		}

		const missing = [...chunkKeys].filter((key) => !zone.loadedChunks.has(key));
		const others = new Set(missing
			.map((key) => pending.get(key))
			.filter((read) => (read !== undefined)));
		const wanted = missing.filter((key) => !pending.has(key));
		const read = ((wanted.length > 0) ? this.readInto(zone, wanted) : undefined);

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
	 * Reads chunks of a zone and adds them to it
	 *
	 * @param zone The zone
	 * @param chunkKeys The chunks, by chunkKey(), none of them loaded
	 * @return The chunks read; empty when the zone was reloaded or dropped meanwhile
	 */
	private async readInto(zone: ActiveZone, chunkKeys: string[]): Promise<string[]>
	{
		const zoneId = zone.loaded.zone.id;
		const stored = await this.readChunks(zoneId, chunkKeys.map((key) => parseChunkKey(key)));

		// The zone may have been reloaded, with other bounds or cells, while the chunks were read
		if (this.zones.get(zoneId) !== zone)
		{
			return([]);
		}

		for (const chunk of stored)
		{
			zone.chunks.set(chunkKey(chunk.chunkColumn, chunk.chunkRow), chunk.cells);
		}

		for (const key of chunkKeys)
		{
			zone.loadedChunks.add(key);
		}

		return(chunkKeys);
	}

	/**
	 * Reads chunks of a loaded zone's map again, after an editor has changed them. Chunks that aren't
	 * loaded are left for when players come near them
	 *
	 * @param zoneId The zone's ID
	 * @param chunkKeys The changed chunks, by chunkKey()
	 * @return The loaded chunks that were read again
	 */
	async reloadChunks(zoneId: string, chunkKeys: Iterable<string>): Promise<string[]>
	{
		const zone = this.zones.get(zoneId);
		const changed = [...chunkKeys].filter((key) => (zone?.loadedChunks.has(key) ?? false));

		if (!zone || (changed.length === 0))
		{
			return([]);
		}

		const stored = await this.readChunks(zoneId, changed.map((key) => parseChunkKey(key)));

		if (this.zones.get(zoneId) !== zone)
		{
			return([]);
		}

		const cells = new Map(stored.map((chunk) => [chunkKey(chunk.chunkColumn, chunk.chunkRow), chunk.cells]));

		for (const key of changed)
		{
			const chunk = cells.get(key);

			if (chunk)
			{
				zone.chunks.set(key, chunk);
			}
			else
			{
				zone.chunks.delete(key);
			}
		}

		return(changed);
	}

	/**
	 * Forgets a zone's chunks that no player is near
	 *
	 * @param zoneId The zone's ID
	 * @param keep The chunks to keep, by chunkKey()
	 */
	dropChunks(zoneId: string, keep: ReadonlySet<string>): void
	{
		const zone = this.zones.get(zoneId);

		for (const key of [...(zone?.loadedChunks ?? [])])
		{
			if (!keep.has(key))
			{
				zone?.loadedChunks.delete(key);
				zone?.chunks.delete(key);
			}
		}
	}

	/**
	 * Reads a loaded zone's settings, links and tiles again, after an editor has changed them
	 *
	 * @param zoneId The zone's ID
	 * @param keepChunks Whether the loaded chunks are still right (only the tiles changed); otherwise
	 * they are dropped, to load again as players need them
	 * @return The zone as it now is; undefined when it wasn't loaded, or no longer exists (and is forgotten)
	 */
	async reload(zoneId: string, keepChunks: boolean): Promise<ActiveZone | undefined>
	{
		const before = this.zones.get(zoneId);

		if (!before)
		{
			return(undefined);
		}

		const loaded = await this.loadZone(zoneId);

		if (this.zones.get(zoneId) !== before)
		{
			return(this.zones.get(zoneId));
		}

		if (!loaded)
		{
			this.zones.delete(zoneId);
			return(undefined);
		}

		const zone = activate(loaded, (keepChunks ? before.chunks : new Map<string, number[]>()), (keepChunks ? before.loadedChunks : new Set<string>()));

		this.zones.set(zoneId, zone);

		return(zone);
	}

	/**
	 * Forgets a zone, such as one that has been deleted
	 *
	 * @param zoneId The zone's ID
	 */
	forget(zoneId: string): void
	{
		this.zones.delete(zoneId);
	}

	/**
	 * Reads a zone and gets it ready to play in
	 *
	 * @param zoneId The zone's ID
	 * @return The zone, or undefined when there is no such zone
	 */
	private async read(zoneId: string): Promise<ActiveZone | undefined>
	{
		const loaded = await this.loadZone(zoneId);

		if (!loaded)
		{
			return(undefined);
		}

		const zone = activate(loaded, new Map(), new Set());

		this.zones.set(zoneId, zone);

		return(zone);
	}
}

/**
 * Gets a loaded zone ready to play in
 *
 * @param loaded The zone's settings, links and tiles
 * @param chunks Its loaded chunks that aren't all the default tile
 * @param loadedChunks Every loaded chunk
 * @return The zone
 */
function activate(loaded: LoadedZone, chunks: Map<string, number[]>, loadedChunks: Set<string>): ActiveZone
{
	const map: ZoneMap = {
		tiles: {
			bounds: loaded.bounds,
			defaultTileId: loaded.defaultTileId,
			chunks
		},
		loopsEastWest: loaded.loopsEastWest,
		loopsNorthSouth: loaded.loopsNorthSouth,
		tileMovementCosts: new Map(loaded.tiles.map((tile) => [tile.id, tile.movementCost])),
		links: loaded.links,
		loadedChunks
	};

	return({
		loaded,
		map,
		grid: createZoneGrid(map, GRID_CELL_SIZE),
		chunks,
		loadedChunks
	});
}

/**
 * What a client is told about a zone: its settings, tiles and some chunks of its map, and where its
 * links are but not where they lead
 *
 * @param zone The zone
 * @param chunkKeys The loaded chunks to include, by chunkKey(); chunks that are all the default tile are left out
 * @return The payload
 */
export function toZonePayload(zone: ActiveZone, chunkKeys: Iterable<string>): ZonePayload
{
	const { loaded } = zone;

	return({
		zoneId: loaded.zone.id,
		name: loaded.zone.name,
		indoors: loaded.zone.indoors,
		bounds: loaded.bounds,
		loopsEastWest: loaded.loopsEastWest,
		loopsNorthSouth: loaded.loopsNorthSouth,
		defaultTileId: loaded.defaultTileId,
		tiles: loaded.tiles.map((tile) => ({
			id: tile.id,
			name: tile.name,
			color: tile.color
		})),
		chunks: toChunkUpdates(zone, chunkKeys)
			.filter((chunk): chunk is ZoneChunk => (chunk.cells !== null)),
		links: loaded.links.map((link) => ({
			column: link.column,
			row: link.row,
			mode: link.mode
		}))
	});
}

/**
 * Loaded chunks of a zone as clients are sent them
 *
 * @param zone The zone
 * @param chunkKeys The chunks, by chunkKey()
 * @return Each chunk, with null cells when it is all the default tile
 */
export function toChunkUpdates(zone: ActiveZone, chunkKeys: Iterable<string>): ZoneChunkUpdate[]
{
	return([...chunkKeys].map((key) =>
	{
		const cells = zone.chunks.get(key);

		return({ ...parseChunkKey(key), cells: (cells ? [...cells] : null) });
	}));
}
