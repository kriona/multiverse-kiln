import type { Client } from 'colyseus';
import { StateView, type MapSchema } from '@colyseus/schema';
import { Player, ServerMessageType, type MovePayload, type WelcomePayload } from '@multiverse-kiln/shared';

import { cellAt, findFreeCell, NO_PRESS, occupiedCells, stepOnGrid, type Cell, type DirectionPress, type GridStep, type Position } from '../logic/movement.js';
import { CellOccupancy } from '../logic/occupancy.js';
import { linkAt, type ZoneLink } from '../logic/zoneGrid.js';
import { InputQueue } from './inputQueue.js';
import { PlayerSessions } from './playerSessions.js';
import type { ActiveZone, ZoneCache } from './zoneCache.js';

/**
 * Simulation ticks per second, in every room with a map
 */
export const SIMULATION_TICK_RATE = 30;

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
	 * @param players The room's synced players, which this adds to, moves and removes
	 * @param zones The room's zones
	 */
	constructor(private readonly players: MapSchema<Player>, private readonly zones: ZoneCache)
	{
	}

	/**
	 * Adds a joining client. A player new to the room is placed on the free cell nearest the start
	 * zone's center; a player already here gets another window. Either way the client is told which
	 * player it controls and which zone it is in
	 *
	 * @param client The joining client
	 * @param playerId The player the client controls
	 * @param name The player's name
	 * @param startZone Where a player new to the room starts
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
			client.send(ServerMessageType.Zone, zone.payload);
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

		const link = linkAt(zone.loaded.map, cellAt(player, zone.grid));

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

			const link = (mover.stoppedAt ? linkAt(zone.loaded.map, mover.stoppedAt) : undefined);

			if (link)
			{
				this.travel(playerId, link);
			}
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
	 * Sends a player through a link: they stop, and arrive once the link's zone has loaded
	 *
	 * The load happens outside the tick. A player whose link leads nowhere they can go stays where they are
	 *
	 * @param playerId The player's ID
	 * @param link The link
	 */
	private travel(playerId: string, link: ZoneLink): void
	{
		this.travelling.add(playerId);
		this.heldDirections.delete(playerId);
		this.presses.delete(playerId);
		this.steps.delete(playerId);
		this.moveInputs.remove(playerId);

		this.zones.load(link.targetZoneId).then((target) =>
		{
			this.arrive(playerId, link, target);
		}, (error: unknown) =>
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

		for (const client of this.getClients(playerId))
		{
			client.send(ServerMessageType.Zone, target.payload);
		}
	}

	/**
	 * The center of the free cell nearest a cell of a zone, searching the whole zone if need be
	 *
	 * @param playerId The player arriving, whose own cells count as free
	 * @param zone The zone
	 * @param near The cell to start from
	 * @return The cell's center, or undefined when the zone has no free cell
	 */
	private findArrivalCell(playerId: string, zone: ActiveZone, near: Cell): Position | undefined
	{
		const { minColumn, minRow, maxColumn, maxRow } = zone.grid.bounds;
		const searchDistance = Math.max(maxColumn - minColumn, maxRow - minRow) + 1;

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
