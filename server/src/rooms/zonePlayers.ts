import type { Client } from 'colyseus';
import { StateView, type MapSchema } from '@colyseus/schema';
import { CHUNK_SIZE, Player, ServerMessageType, type ChunksPayload, type MovePayload, type WelcomePayload } from '@multiverse-kiln/shared';

import { chunksNear, type ChunkAreaMap } from '../logic/chunkArea.js';
import { cellAt, findFreeCell, NO_PRESS, occupiedCells, stepOnGrid, type Cell, type DirectionPress, type GridStep, type Position } from '../logic/movement.js';
import { CellOccupancy } from '../logic/occupancy.js';
import { linkAt, type ZoneLink } from '../logic/zoneGrid.js';
import type { ZoneChange } from '../world/zoneChanges.js';
import { InputQueue } from './inputQueue.js';
import { PlayerSessions } from './playerSessions.js';
import { toChunkUpdates, toZonePayload, type ActiveZone, type ZoneCache } from './zoneCache.js';

/**
 * Simulation ticks per second, in every room with a map
 */
export const SIMULATION_TICK_RATE = 30;

/**
 * Milliseconds between checks for the chunks players have come near or moved away from
 *
 * A player crosses about 7 cells a second, and chunks are loaded CHUNK_LOAD_RADIUS cells ahead, so
 * they have arrived long before the player reaches them unless the database is slow
 */
export const CHUNK_REFRESH_INTERVAL_MS = 250;

/**
 * How many cells around a player their zone's chunks are loaded and sent to them: about four of the
 * client's views across
 */
const CHUNK_LOAD_RADIUS = CHUNK_SIZE * 2;

/**
 * How many cells around a player loaded chunks are kept. Wider than CHUNK_LOAD_RADIUS, so a player
 * pacing at the edge of it doesn't make the same chunks load and drop over and over
 */
const CHUNK_KEEP_RADIUS = CHUNK_SIZE * 3;

/**
 * Most Move inputs kept per player between ticks
 */
const MAX_QUEUED_MOVES = 8;

const standingStill: MovePayload = { x: 0, y: 0 };

/**
 * A player leaving the room, from ZonePlayers.leave()
 */
export interface LeftPlayer
{
	playerId: string;

	/**
	 * Whether the client was the player's last, so the player has left the room
	 */
	wasLastClient: boolean;
}

/**
 * The players on the map of a room with zones (a universe's lobby or a group's game room): which
 * clients control them, which zone each is in, how they move, and which of them each client sees
 *
 * Every window of the same browser controls the same player. A room holds every zone its players are
 * in; a client sees only the players in its own player's zone, through its StateView. Stepping onto an
 * automatic zone link, or asking to take the manual link the player stands on, sends the player to
 * the link's target cell once that zone has loaded. The room calls update() from its simulation tick
 * and refreshChunks() every CHUNK_REFRESH_INTERVAL_MS
 *
 * Only the chunks of each zone's map near its players are loaded, and each player is sent the chunks
 * near them as they move. Changes the world editor makes (applyChange) reach the players straight away
 */
export class ZonePlayers
{
	private readonly sessions = new PlayerSessions();
	private readonly clients = new Map<string, Client>();

	/**
	 * The zone each player is in
	 */
	private readonly zoneIds = new Map<string, string>();

	private readonly moveInputs = new InputQueue<MovePayload>(MAX_QUEUED_MOVES);

	/**
	 * The direction each player is holding, from their latest Move
	 */
	private readonly heldDirections = new Map<string, MovePayload>();

	/**
	 * The step each moving player is taking
	 */
	private readonly steps = new Map<string, GridStep>();

	/**
	 * How long each player has held its direction, for the step repeat delay
	 */
	private readonly presses = new Map<string, DirectionPress>();

	/**
	 * Players waiting for the zone a link is taking them to; they don't move until they arrive
	 */
	private readonly travelling = new Set<string>();

	/**
	 * The chunks of their zone each player's clients have been sent, by chunkKey()
	 */
	private readonly sentChunks = new Map<string, Set<string>>();

	/**
	 * @param players The room's synced players, which this adds to, moves and removes
	 * @param zones The room's zones
	 * @param fallbackZoneId The zone players go to when the zone they are in is deleted
	 */
	constructor(private readonly players: MapSchema<Player>, private readonly zones: ZoneCache, private readonly fallbackZoneId: () => string | undefined)
	{
	}

	/**
	 * Loads the chunks a new player needs to be placed in a zone, around its center. Call it before join()
	 *
	 * @param zone The zone
	 */
	async prepareStart(zone: ActiveZone): Promise<void>
	{
		await this.zones.loadChunks(zone.loaded.zone.id, chunksNear([{ column: 0, row: 0 }], CHUNK_LOAD_RADIUS, areaOf(zone)));
	}

	/**
	 * Adds a joining client. A player new to the room is placed on the free cell nearest the start
	 * zone's center; a player already here gets another window. Either way the client is told which
	 * player it controls and which zone it is in
	 *
	 * @param client The joining client
	 * @param playerId The player the client controls
	 * @param name The player's name
	 * @param startZone Where a player new to the room starts, with prepareStart() done
	 * @return Whether the player is new to the room
	 */
	join(client: Client, playerId: string, name: string, startZone: ActiveZone): boolean
	{
		const isNewPlayer = this.sessions.add(client.sessionId, playerId);

		if (isNewPlayer)
		{
			const position = this.findArrivalCell(playerId, startZone, { column: 0, row: 0 });

			if (!position)
			{
				this.sessions.remove(client.sessionId);
				throw new Error(`No free cell for player ${playerId} in zone ${startZone.loaded.zone.id}`);
			}

			this.players.set(playerId, new Player({ x: position.x, y: position.y, name }));
			this.zoneIds.set(playerId, startZone.loaded.zone.id);
			this.showToZone(playerId);
		}

		const zone = this.zoneOf(playerId);

		this.clients.set(client.sessionId, client);
		client.view = new StateView();

		for (const otherId of this.playersIn(this.zoneIds.get(playerId)))
		{
			this.show(otherId, client);
		}

		const welcome: WelcomePayload = { playerId };

		client.send(ServerMessageType.Welcome, welcome);

		if (zone)
		{
			this.sendZone(playerId, zone, [client]);
		}

		return(isNewPlayer);
	}

	/**
	 * Removes a leaving client, stopping its player, and removes the player once its last client has left
	 *
	 * @param client The leaving client
	 * @return The client's player, or undefined when the client wasn't added
	 */
	leave(client: Client): LeftPlayer | undefined
	{
		const left = this.sessions.remove(client.sessionId);

		this.clients.delete(client.sessionId);

		if (!left)
		{
			return(undefined);
		}

		// A window can close while its keys are held, and its last Move may still be queued; the player
		// stops at the end of its current step instead of running on without it
		this.moveInputs.remove(left.playerId);
		this.heldDirections.delete(left.playerId);

		if (left.wasLastClient)
		{
			this.hideFromZone(left.playerId);
			this.players.delete(left.playerId);
			this.zoneIds.delete(left.playerId);
			this.steps.delete(left.playerId);
			this.presses.delete(left.playerId);
			this.travelling.delete(left.playerId);
			this.sentChunks.delete(left.playerId);
		}

		return(left);
	}

	/**
	 * Queues a client's Move for the next tick
	 *
	 * @param sessionId The client's session ID
	 * @param move The direction held
	 */
	queueMove(sessionId: string, move: MovePayload): void
	{
		const playerId = this.sessions.getPlayerId(sessionId);

		if (playerId !== undefined)
		{
			this.moveInputs.push(playerId, move);
		}
	}

	/**
	 * Takes the manual link the client's player is standing on, if there is one; does nothing while the
	 * player is mid-step or already travelling
	 *
	 * @param sessionId The client's session ID
	 */
	takeLink(sessionId: string): void
	{
		const playerId = this.sessions.getPlayerId(sessionId);

		if ((playerId === undefined) || this.travelling.has(playerId) || this.steps.has(playerId))
		{
			return;
		}

		const player = this.players.get(playerId);
		const zone = this.zoneOf(playerId);

		if (!player || !zone)
		{
			return;
		}

		const link = linkAt(zone.map, cellAt(player, zone.grid));

		if (link?.mode === 'manual')
		{
			this.travel(playerId, link);
		}
	}

	/**
	 * One simulation tick: applies queued inputs, then moves every player in their zone, and sends
	 * players who stepped onto an automatic link on their way
	 *
	 * @param deltaSeconds Seconds since the previous tick
	 */
	update(deltaSeconds: number): void
	{
		const occupancies = new Map<string, CellOccupancy>();

		// Players move one at a time, each seeing the cells the players before it have just taken or freed.
		// When two want the same cell, the one earlier in the map gets it
		for (const [playerId, player] of this.players)
		{
			for (const move of this.moveInputs.drain(playerId))
			{
				this.heldDirections.set(playerId, move);
			}

			const zoneId = this.zoneIds.get(playerId);
			const zone = this.zoneOf(playerId);

			if ((zoneId === undefined) || !zone || this.travelling.has(playerId))
			{
				continue;
			}

			let occupancy = occupancies.get(zoneId);

			if (!occupancy)
			{
				occupancy = this.occupancyOf(zoneId);
				occupancies.set(zoneId, occupancy);
			}

			const mover = stepOnGrid(
				{
					x: player.x,
					y: player.y,
					step: this.steps.get(playerId),
					press: this.presses.get(playerId) ?? NO_PRESS
				},
				this.heldDirections.get(playerId) ?? standingStill,
				deltaSeconds,
				zone.grid,
				occupancy.isFreeFor(playerId)
			);

			player.x = mover.x;
			player.y = mover.y;
			this.presses.set(playerId, mover.press);

			if (mover.step)
			{
				this.steps.set(playerId, mover.step);
			}
			else
			{
				this.steps.delete(playerId);
			}

			occupancy.hold(playerId, occupiedCells(mover, zone.grid));

			const link = (mover.stoppedAt ? linkAt(zone.map, mover.stoppedAt) : undefined);

			if (link)
			{
				this.travel(playerId, link);
			}
		}
	}

	/**
	 * Loads the chunks players have come near, drops the ones nobody is near, and sends each player the
	 * loaded chunks near them they haven't been sent. Runs outside the simulation tick; loading finishes
	 * later, and the chunks are sent once they arrive
	 */
	refreshChunks(): void
	{
		for (const zone of this.zones.all())
		{
			const zoneId = zone.loaded.zone.id;
			const playerIds = this.playersIn(zoneId).filter((playerId) => !this.travelling.has(playerId));
			const cells = playerIds
				.map((playerId) => this.cellOf(playerId, zone))
				.filter((cell) => (cell !== undefined));
			const area = areaOf(zone);

			this.zones.dropChunks(zoneId, chunksNear(cells, CHUNK_KEEP_RADIUS, area));

			for (const playerId of playerIds)
			{
				this.sendNearbyChunks(playerId, zone);
			}

			this.zones.loadChunks(zoneId, chunksNear(cells, CHUNK_LOAD_RADIUS, area)).then((loaded) =>
			{
				const current = this.zones.get(zoneId);

				if ((loaded.length > 0) && current)
				{
					for (const playerId of this.playersIn(zoneId))
					{
						this.sendNearbyChunks(playerId, current);
					}
				}
			}, (error: unknown) =>
			{
				console.error(`Could not load chunks of zone ${zoneId}:`, error);
			});
		}
	}

	/**
	 * Brings a change the world editor has made to the players it affects, if this room has the zone loaded
	 *
	 * Runs outside the simulation tick
	 *
	 * @param change The change
	 */
	async applyChange(change: ZoneChange): Promise<void>
	{
		if (change.kind === 'cells')
		{
			await this.applyCellChange(change.zoneId, change.chunkKeys);
		}
		else if (change.kind === 'tiles')
		{
			for (const zone of this.zones.all().filter((each) => (each.loaded.zone.universeId === change.universeId)))
			{
				await this.applyZoneChange(zone.loaded.zone.id, true);
			}
		}
		else
		{
			await this.applyZoneChange(change.zoneId, false);
		}
	}

	/**
	 * The player a client controls
	 *
	 * @param sessionId The client's session ID
	 * @return The player's ID, or undefined when the client isn't in the room
	 */
	getPlayerId(sessionId: string): string | undefined
	{
		return(this.sessions.getPlayerId(sessionId));
	}

	/**
	 * The clients controlling a player
	 *
	 * @param playerId The player's ID
	 * @return The clients; empty when the player isn't in the room
	 */
	getClients(playerId: string): Client[]
	{
		return(this.sessions
			.getSessionIds(playerId)
			.map((sessionId) => this.clients.get(sessionId))
			.filter((client) => (client !== undefined)));
	}

	/**
	 * The zone a player is in
	 *
	 * @param playerId The player's ID
	 * @return The zone's ID, or undefined when the player isn't in the room
	 */
	getZoneId(playerId: string): string | undefined
	{
		return(this.zoneIds.get(playerId));
	}

	/**
	 * Reads changed chunks of a zone again, and sends them to the players who had been sent them
	 *
	 * @param zoneId The zone's ID
	 * @param chunkKeys The changed chunks, by chunkKey()
	 */
	private async applyCellChange(zoneId: string, chunkKeys: string[]): Promise<void>
	{
		const changed = await this.zones.reloadChunks(zoneId, chunkKeys);
		const zone = this.zones.get(zoneId);

		if (!zone || (changed.length === 0))
		{
			return;
		}

		for (const playerId of this.playersIn(zoneId))
		{
			const sent = this.sentChunks.get(playerId);
			const resend = changed.filter((key) => (sent?.has(key) ?? false));

			if (resend.length > 0)
			{
				this.sendChunks(playerId, zone, resend);
			}
		}
	}

	/**
	 * Reads a zone again after its settings, bounds, links or tiles changed. Players its new bounds no
	 * longer hold are moved onto the nearest free cell inside them, and everyone in it is sent the zone
	 * again. Players in a zone that has been deleted go to the fallback zone
	 *
	 * @param zoneId The zone's ID
	 * @param keepChunks Whether only the tiles changed, so the loaded chunks are still right
	 */
	private async applyZoneChange(zoneId: string, keepChunks: boolean): Promise<void>
	{
		if (!this.zones.get(zoneId))
		{
			return;
		}

		const zone = await this.zones.reload(zoneId, keepChunks);
		const playerIds = this.playersIn(zoneId).filter((playerId) => !this.travelling.has(playerId));

		if (!zone)
		{
			this.sendToFallback(playerIds);
			return;
		}

		const { bounds } = zone.loaded;
		const targets = new Map<string, Cell>();

		for (const playerId of playerIds)
		{
			const player = this.players.get(playerId);

			if (player)
			{
				const cell = cellAt(player, zone.grid);

				targets.set(playerId, {
					column: Math.min(Math.max(cell.column, bounds.minColumn), bounds.maxColumn),
					row: Math.min(Math.max(cell.row, bounds.minRow), bounds.maxRow)
				});
			}
		}

		await this.zones.loadChunks(zoneId, chunksNear([...targets.values()], CHUNK_LOAD_RADIUS, areaOf(zone)));

		const current = this.zones.get(zoneId);

		if (!current)
		{
			return;
		}

		for (const [playerId, target] of targets)
		{
			const player = this.players.get(playerId);

			if (!player || (this.zoneIds.get(playerId) !== zoneId) || this.travelling.has(playerId))
			{
				continue;
			}

			const cell = cellAt(player, current.grid);

			// The step under way may lead off the new map, so every player starts afresh from a cell center
			this.steps.delete(playerId);
			this.presses.delete(playerId);

			if ((cell.column !== target.column) || (cell.row !== target.row))
			{
				const position = this.findArrivalCell(playerId, current, target);

				if (position)
				{
					player.x = position.x;
					player.y = position.y;
				}
			}
			else
			{
				player.x = (cell.column + 0.5) * current.grid.cellSize;
				player.y = (cell.row + 0.5) * current.grid.cellSize;
			}

			this.sendZone(playerId, current, this.getClients(playerId));
		}
	}

	/**
	 * Sends players to the center of the fallback zone, for when their zone has been deleted
	 *
	 * @param playerIds The players
	 */
	private sendToFallback(playerIds: string[]): void
	{
		const fallbackZoneId = this.fallbackZoneId();

		if (fallbackZoneId === undefined)
		{
			return;
		}

		for (const playerId of playerIds)
		{
			this.travel(playerId, {
				column: 0,
				row: 0,
				targetZoneId: fallbackZoneId,
				targetColumn: 0,
				targetRow: 0,
				mode: 'automatic',
				requiresWholeGroup: false
			});
		}
	}

	/**
	 * Sends a player through a link: they stop, and arrive once the link's zone and the chunks around
	 * its target have loaded
	 *
	 * The load happens outside the tick. A player whose link leads nowhere they can go stays where they are
	 *
	 * @param playerId The player's ID
	 * @param link The link
	 */
	private travel(playerId: string, link: ZoneLink): void
	{
		const targetCell = { column: link.targetColumn, row: link.targetRow };

		this.travelling.add(playerId);
		this.heldDirections.delete(playerId);
		this.presses.delete(playerId);
		this.steps.delete(playerId);
		this.moveInputs.remove(playerId);

		this.zones.load(link.targetZoneId)
			.then(async (target) =>
			{
				if (target)
				{
					await this.zones.loadChunks(target.loaded.zone.id, chunksNear([targetCell], CHUNK_LOAD_RADIUS, areaOf(target)));
				}

				this.arrive(playerId, link, this.zones.get(link.targetZoneId));
			})
			.catch((error: unknown) =>
			{
				console.error(`Player ${playerId} could not take a link to zone ${link.targetZoneId}:`, error);
				this.travelling.delete(playerId);
			});
	}

	/**
	 * Moves a travelling player into the zone their link leads to, on the free cell nearest its target
	 *
	 * @param playerId The player's ID
	 * @param link The link they took
	 * @param target The link's zone, or undefined when it doesn't exist
	 */
	private arrive(playerId: string, link: ZoneLink, target: ActiveZone | undefined): void
	{
		// The player may have left the room while the zone loaded
		if (!this.travelling.delete(playerId))
		{
			return;
		}

		const player = this.players.get(playerId);

		if (!player || !target || !target.loaded.zone.enabled)
		{
			return;
		}

		const position = this.findArrivalCell(playerId, target, { column: link.targetColumn, row: link.targetRow });

		if (!position)
		{
			return;
		}

		this.hideFromZone(playerId);
		this.zoneIds.set(playerId, target.loaded.zone.id);
		player.x = position.x;
		player.y = position.y;
		this.showToZone(playerId);
		this.sendZone(playerId, target, this.getClients(playerId));
	}

	/**
	 * Sends a player's clients a zone, with the loaded chunks near the player, and remembers those as sent
	 *
	 * @param playerId The player's ID
	 * @param zone The zone they are in
	 * @param clients The clients to send it to
	 */
	private sendZone(playerId: string, zone: ActiveZone, clients: Client[]): void
	{
		const near = this.loadedChunksNear(playerId, zone);
		const payload = toZonePayload(zone, near);

		this.sentChunks.set(playerId, new Set(near));

		for (const client of clients)
		{
			client.send(ServerMessageType.Zone, payload);
		}
	}

	/**
	 * Sends a player the loaded chunks near them they haven't been sent, and forgets having sent the ones
	 * they have moved away from, so those are sent again (with any changes) when the player comes back
	 *
	 * @param playerId The player's ID
	 * @param zone The zone they are in
	 */
	private sendNearbyChunks(playerId: string, zone: ActiveZone): void
	{
		const sent = this.sentChunks.get(playerId);
		const cell = this.cellOf(playerId, zone);

		if (!sent || !cell)
		{
			return;
		}

		const kept = chunksNear([cell], CHUNK_KEEP_RADIUS, areaOf(zone));

		for (const key of [...sent])
		{
			if (!kept.has(key))
			{
				sent.delete(key);
			}
		}

		const fresh = this.loadedChunksNear(playerId, zone).filter((key) => !sent.has(key));

		if (fresh.length > 0)
		{
			this.sendChunks(playerId, zone, fresh);
		}
	}

	/**
	 * Sends a player's clients some loaded chunks of their zone, and remembers them as sent
	 *
	 * @param playerId The player's ID
	 * @param zone The zone they are in
	 * @param chunkKeys The chunks, by chunkKey()
	 */
	private sendChunks(playerId: string, zone: ActiveZone, chunkKeys: string[]): void
	{
		const sent = (this.sentChunks.get(playerId) ?? new Set<string>());
		const payload: ChunksPayload = {
			zoneId: zone.loaded.zone.id,
			chunks: toChunkUpdates(zone, chunkKeys)
		};

		for (const key of chunkKeys)
		{
			sent.add(key);
		}

		this.sentChunks.set(playerId, sent);

		for (const client of this.getClients(playerId))
		{
			client.send(ServerMessageType.Chunks, payload);
		}
	}

	/**
	 * The loaded chunks of a zone near a player
	 *
	 * @param playerId The player's ID
	 * @param zone The zone they are in
	 * @return The chunks' keys
	 */
	private loadedChunksNear(playerId: string, zone: ActiveZone): string[]
	{
		const cell = this.cellOf(playerId, zone);

		if (!cell)
		{
			return([]);
		}

		return([...chunksNear([cell], CHUNK_LOAD_RADIUS, areaOf(zone))].filter((key) => zone.loadedChunks.has(key)));
	}

	/**
	 * The cell a player is in
	 *
	 * @param playerId The player's ID
	 * @param zone The zone they are in
	 * @return The cell, or undefined when the player isn't in the room
	 */
	private cellOf(playerId: string, zone: ActiveZone): Cell | undefined
	{
		const player = this.players.get(playerId);

		return((player ? cellAt(player, zone.grid) : undefined));
	}

	/**
	 * The center of the free cell nearest a cell of a zone, searching as far as its chunks are loaded around the cell
	 *
	 * @param playerId The player arriving, whose own cells count as free
	 * @param zone The zone
	 * @param near The cell to start from
	 * @return The cell's center, or undefined when there is no free cell that near
	 */
	private findArrivalCell(playerId: string, zone: ActiveZone, near: Cell): Position | undefined
	{
		const { minColumn, minRow, maxColumn, maxRow } = zone.grid.bounds;
		const searchDistance = Math.min(Math.max(maxColumn - minColumn, maxRow - minRow) + 1, CHUNK_LOAD_RADIUS);

		return(findFreeCell(near, zone.grid, this.occupancyOf(zone.loaded.zone.id).isFreeFor(playerId), searchDistance));
	}

	/**
	 * Works out which cells the players in a zone hold right now
	 *
	 * @param zoneId The zone's ID
	 * @return The zone's occupancy
	 */
	private occupancyOf(zoneId: string): CellOccupancy
	{
		const occupancy = new CellOccupancy();
		const zone = this.zones.get(zoneId);

		if (!zone)
		{
			return(occupancy);
		}

		for (const playerId of this.playersIn(zoneId))
		{
			const player = this.players.get(playerId);

			if (player)
			{
				occupancy.hold(
					playerId,
					occupiedCells(
						{
							x: player.x,
							y: player.y,
							step: this.steps.get(playerId)
						},
						zone.grid
					)
				);
			}
		}

		return(occupancy);
	}

	/**
	 * Shows a player to everyone else in their zone, and everyone else in it to them
	 *
	 * @param playerId The player's ID
	 */
	private showToZone(playerId: string): void
	{
		for (const otherId of this.playersIn(this.zoneIds.get(playerId)))
		{
			if (otherId !== playerId)
			{
				this.showToPlayer(playerId, otherId);
				this.showToPlayer(otherId, playerId);
			}
		}
	}

	/**
	 * Hides a player from everyone else in their zone, and everyone else in it from them
	 *
	 * @param playerId The player's ID
	 */
	private hideFromZone(playerId: string): void
	{
		const player = this.players.get(playerId);

		for (const otherId of this.playersIn(this.zoneIds.get(playerId)))
		{
			const other = this.players.get(otherId);

			if ((otherId === playerId) || !player || !other)
			{
				continue;
			}

			for (const client of this.getClients(otherId))
			{
				client.view?.remove(player);
			}

			for (const client of this.getClients(playerId))
			{
				client.view?.remove(other);
			}
		}
	}

	/**
	 * Shows a player to every client of another player
	 *
	 * @param playerId The player to show
	 * @param viewerId The player whose clients see them
	 */
	private showToPlayer(playerId: string, viewerId: string): void
	{
		for (const client of this.getClients(viewerId))
		{
			this.show(playerId, client);
		}
	}

	/**
	 * Shows a player to one client
	 *
	 * @param playerId The player to show
	 * @param client The client
	 */
	private show(playerId: string, client: Client): void
	{
		const player = this.players.get(playerId);

		if (player)
		{
			client.view?.add(player);
		}
	}

	/**
	 * The players in a zone
	 *
	 * @param zoneId The zone's ID
	 * @return Their IDs
	 */
	private playersIn(zoneId: string | undefined): string[]
	{
		return([...this.zoneIds]
			.filter(([, playerZoneId]) => (playerZoneId === zoneId))
			.map(([playerId]) => playerId));
	}

	/**
	 * The zone a player is in
	 *
	 * @param playerId The player's ID
	 * @return The zone, or undefined when the player isn't in the room
	 */
	private zoneOf(playerId: string): ActiveZone | undefined
	{
		const zoneId = this.zoneIds.get(playerId);

		return(((zoneId !== undefined) ? this.zones.get(zoneId) : undefined));
	}
}

/**
 * A zone's map as chunksNear needs it
 *
 * @param zone The zone
 * @return Its bounds and whether it loops
 */
function areaOf(zone: ActiveZone): ChunkAreaMap
{
	return({
		bounds: zone.loaded.bounds,
		loopsEastWest: zone.loaded.loopsEastWest,
		loopsNorthSouth: zone.loaded.loopsNorthSouth
	});
}
