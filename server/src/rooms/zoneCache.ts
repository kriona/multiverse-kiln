import { GRID_CELL_SIZE, parseChunkKey, type ZonePayload } from '@multiverse-kiln/shared';

import type { LoadedZone } from '../db/zoneRepo.js';
import type { Grid } from '../logic/movement.js';
import { createZoneGrid } from '../logic/zoneGrid.js';

/**
 * A zone a room has loaded, ready to play in
 */
export interface ActiveZone
{
	loaded: LoadedZone;
	grid: Grid;

	/**
	 * What clients are sent when their player enters the zone, built once
	 */
	payload: ZonePayload;
}

/**
 * Loads a zone by ID; undefined when there is no such zone
 */
export type ZoneLoader = (zoneId: string) => Promise<LoadedZone | undefined>;

/**
 * The zones a room has loaded, so each is read from the database once however many players use it
 *
 * Loading happens outside the simulation tick: the tick only reads zones that are already here (get),
 * and a player waits while the zone they are heading for loads (load)
 */
export class ZoneCache
{
	private readonly zones = new Map<string, ActiveZone>();
	private readonly loading = new Map<string, Promise<ActiveZone | undefined>>();

	/**
	 * @param loadZone Reads a zone from the database
	 */
	constructor(private readonly loadZone: ZoneLoader)
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
	 * A zone, loading it first if it isn't here yet. Several calls for the same zone share one load
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

		const zone: ActiveZone = {
			loaded,
			grid: createZoneGrid(loaded.map, GRID_CELL_SIZE),
			payload: toZonePayload(loaded)
		};

		this.zones.set(zoneId, zone);

		return(zone);
	}
}

/**
 * What a client is told about a zone: its whole map and where its links are, but not where they lead
 *
 * @param loaded The zone
 * @return The payload
 */
export function toZonePayload(loaded: LoadedZone): ZonePayload
{
	const { zone, map, tiles } = loaded;

	return({
		zoneId: zone.id,
		name: zone.name,
		indoors: zone.indoors,
		bounds: map.tiles.bounds,
		loopsEastWest: map.loopsEastWest,
		loopsNorthSouth: map.loopsNorthSouth,
		defaultTileId: map.tiles.defaultTileId,
		tiles: tiles.map((tile) => ({
			id: tile.id,
			name: tile.name,
			color: tile.color
		})),
		chunks: [...map.tiles.chunks].map(([key, cells]) => ({
			...parseChunkKey(key),
			cells: [...cells]
		})),
		links: map.links.map((link) => ({
			column: link.column,
			row: link.row,
			mode: link.mode
		}))
	});
}
