import type { Client } from 'colyseus';
import { StateView, type MapSchema } from '@colyseus/schema';
import { CHUNK_SIZE, Player, ServerMessageType, type ChunksPayload, type MovePayload, type WelcomePayload } from '@multiverse-kiln/shared';

import { chunksNear, type ChunkAreaMap } from '../logic/chunkArea.js';
import { cellAt, findFreeCell, NO_PRESS, occupiedCells, stepOnGrid, type Cell, type DirectionPress, type GridStep, type IsCellFree, type Position } from '../logic/movement.js';
import { CellOccupancy } from '../logic/occupancy.js';
import { linkAt, type AreaLink } from '../logic/areaGrid.js';
import { isGroupTogether } from '../logic/groupLinks.js';
import type { AreaChange } from '../world/areaChanges.js';
import { InputQueue } from './inputQueue.js';
import { PlayerSessions } from './playerSessions.js';
import { toChunkUpdates, toAreaPayload, type ActiveArea, type AreaCache } from './areaCache.js';

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
 * How many cells around a player their area's chunks are loaded and sent to them: about four of the
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
 * Every cell is free for a ghost
 *
 * @return True
 */
const anyCell: IsCellFree = () => true;

/**
 * How a player shows on the map
 */
export interface Appearance
{
	name: string;

	/**
	 * Whether the player is a ghost: only their own clients see them, and they hold no cell, so they
	 * pass through other players and nobody bumps into them
	 */
	ghost: boolean;
}

/**
 * A player leaving the room, from AreaPlayers.leave()
 */
export interface LeftPlayer
{
	playerId: string;

	/**
	 * Whether the client was the player's last, so no client controls the player any more
	 */
	wasLastClient: boolean;
}

/**
 * Where a player is: an area and a cell in it
 */
export interface PlayerPosition extends Cell
{
	areaId: string;
}

/**
 * How a group's room handles links that require the whole group. A room without it (a lobby) treats
 * them as ordinary links
 */
export interface WholeGroupLinks
{
	/**
	 * Every member of the group, present or not
	 *
	 * @return Their player IDs
	 */
	members(): readonly string[];

	/**
	 * Called when a player tries to take such a link while the group isn't together
	 *
	 * @param playerId The player who tried
	 */
	refuse(playerId: string): void;
}

/**
 * The players on the map of a room with areas (a universe's lobby or a group's game room): which
 * clients control them, which area each is in, how they move, and which of them each client sees
 *
 * Each client controls one player (see PlayerSessions), and can be switched to another (control()).
 * Players stay in the room until the room removes them (remove()), so a lobby removes a player once
 * their last client has left, and a group's room keeps every character of a player who has any window
 * in it. A room holds every area its players are in; a client sees only the players in its own
 * player's area, through its StateView, and no other player's ghost. Stepping onto an automatic area
 * link, or asking to take the manual link the player stands on, sends the player to the link's target
 * cell once that area has loaded; a link that requires the whole group sends every member (see
 * WholeGroupLinks). The room calls update() from its simulation tick and refreshChunks() every
 * CHUNK_REFRESH_INTERVAL_MS
 *
 * Only the chunks of each area's map near its players are loaded, and each player is sent the chunks
 * near them as they move. Changes the world editor makes (applyChange) reach the players straight away
 */
export class AreaPlayers
{
	private readonly sessions = new PlayerSessions();
	private readonly clients = new Map<string, Client>();

	/**
	 * The area each player is in
	 */
	private readonly areaIds = new Map<string, string>();

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
	 * Players waiting for the area a link is taking them to; they don't move until they arrive
	 */
	private readonly travelling = new Set<string>();

	/**
	 * The chunks of their area each player's clients have been sent, by chunkKey()
	 */
	private readonly sentChunks = new Map<string, Set<string>>();

	/**
	 * @param players The room's synced players, which this adds to, moves and removes
	 * @param areas The room's areas
	 * @param fallbackAreaId The area players go to when the area they are in is deleted
	 * @param wholeGroupLinks How links that require the whole group work, in a group's room
	 */
	constructor(private readonly players: MapSchema<Player>, private readonly areas: AreaCache, private readonly fallbackAreaId: () => string | undefined, private readonly wholeGroupLinks?: WholeGroupLinks)
	{
	}

	/**
	 * Loads the chunks a new player needs to be placed in an area, around a cell. Call it before add() or join()
	 *
	 * @param area The area
	 * @param near The cell, the area's center by default
	 */
	async prepareStart(area: ActiveArea, near: Cell = { column: 0, row: 0 }): Promise<void>
	{
		await this.areas.loadChunks(area.loaded.area.id, chunksNear([near], CHUNK_LOAD_RADIUS, chunkMapOf(area)));
	}

	/**
	 * Adds a player to the room, on the free cell nearest a cell of an area, before any client controls
	 * them. Does nothing for a player already here
	 *
	 * @param playerId The player's ID
	 * @param appearance How they show
	 * @param area Where they start, with prepareStart() done
	 * @param near The cell to start nearest
	 */
	add(playerId: string, appearance: Appearance, area: ActiveArea, near: Cell): void
	{
		if (this.players.has(playerId))
		{
			return;
		}

		// Added before it has a cell, so the search below knows whether the player is a ghost
		const player = new Player({ x: 0, y: 0, name: appearance.name, ghost: appearance.ghost });

		this.players.set(playerId, player);

		const position = this.findArrivalCell(playerId, area, near);

		if (!position)
		{
			this.players.delete(playerId);
			throw new Error(`No free cell for player ${playerId} in area ${area.loaded.area.id}`);
		}

		player.x = position.x;
		player.y = position.y;
		this.areaIds.set(playerId, area.loaded.area.id);
		this.showToArea(playerId);
	}

	/**
	 * Adds a joining client controlling a player. A player new to the room is first placed on the free
	 * cell nearest the start area's center; a player already here gets another window. Either way the
	 * client is told which player it controls and which area it is in
	 *
	 * @param client The joining client
	 * @param playerId The player the client controls
	 * @param appearance How a player new to the room shows
	 * @param startArea Where a player new to the room starts, with prepareStart() done
	 * @return Whether the player is new to the room
	 */
	join(client: Client, playerId: string, appearance: Appearance, startArea: ActiveArea): boolean
	{
		const isNewPlayer = !this.players.has(playerId);

		if (isNewPlayer)
		{
			this.add(playerId, appearance, startArea, { column: 0, row: 0 });
		}

		this.sessions.add(client.sessionId, playerId);
		this.clients.set(client.sessionId, client);
		this.attach(client, playerId);

		return(isNewPlayer);
	}

	/**
	 * Switches a client to controlling another player in the room. The player it controlled stops, and
	 * the client is told which player it controls and which area it is in, as on joining
	 *
	 * @param client The client
	 * @param playerId The player to control
	 * @return False when the client or the player isn't in the room
	 */
	control(client: Client, playerId: string): boolean
	{
		const previousId = this.sessions.getPlayerId(client.sessionId);

		if ((previousId === undefined) || !this.players.has(playerId))
		{
			return(false);
		}

		if (previousId !== playerId)
		{
			this.stop(previousId);
			this.sessions.move(client.sessionId, playerId);
		}

		this.attach(client, playerId);

		return(true);
	}

	/**
	 * Removes a leaving client, stopping its player. The player stays in the room until remove()
	 *
	 * @param client The leaving client
	 * @return The client's player, or undefined when the client wasn't added
	 */
	leave(client: Client): LeftPlayer | undefined
	{
		const left = this.sessions.remove(client.sessionId);

		this.clients.delete(client.sessionId);

		if (left)
		{
			this.stop(left.playerId);
		}

		return(left);
	}

	/**
	 * Takes a player out of the room, with any clients still controlling them
	 *
	 * @param playerId The player's ID
	 */
	remove(playerId: string): void
	{
		for (const sessionId of this.sessions.removePlayer(playerId))
		{
			this.clients.delete(sessionId);
		}

		this.stop(playerId);
		this.hideFromArea(playerId);
		this.players.delete(playerId);
		this.areaIds.delete(playerId);
		this.steps.delete(playerId);
		this.presses.delete(playerId);
		this.travelling.delete(playerId);
		this.sentChunks.delete(playerId);
	}

	/**
	 * Where a player is
	 *
	 * @param playerId The player's ID
	 * @return Their area and cell, or undefined when they aren't in the room
	 */
	getPosition(playerId: string): PlayerPosition | undefined
	{
		const area = this.areaOf(playerId);
		const cell = (area ? this.cellOf(playerId, area) : undefined);

		if (!area || !cell)
		{
			return(undefined);
		}

		return({
			areaId: area.loaded.area.id,
			...cell
		});
	}

	/**
	 * Whether a player is in the room
	 *
	 * @param playerId The player's ID
	 * @return True when they are
	 */
	has(playerId: string): boolean
	{
		return(this.players.has(playerId));
	}

	/**
	 * Shows a client the players in its player's area, and only them, and tells it which player it
	 * controls and which area it is in
	 *
	 * @param client The client, already recorded as controlling the player
	 * @param playerId The player
	 */
	private attach(client: Client, playerId: string): void
	{
		const area = this.areaOf(playerId);
		const visible = new Set(this.playersIn(this.areaIds.get(playerId)).filter((otherId) => ((otherId === playerId) || !this.isGhost(otherId))));

		if (!client.view)
		{
			client.view = new StateView();
		}

		// Players who stay in view aren't removed and added again, which would make the client redraw them
		for (const [otherId, other] of this.players)
		{
			if (!visible.has(otherId) && client.view.has(other))
			{
				client.view.remove(other);
			}
		}

		for (const otherId of visible)
		{
			this.show(otherId, client);
		}

		const welcome: WelcomePayload = { playerId };

		client.send(ServerMessageType.Welcome, welcome);

		if (area)
		{
			this.sendArea(playerId, area, [client]);
		}
	}

	/**
	 * Stops a player at the end of their current step: a window can close or switch players while its
	 * keys are held, and its last Move may still be queued
	 *
	 * @param playerId The player's ID
	 */
	private stop(playerId: string): void
	{
		this.moveInputs.remove(playerId);
		this.heldDirections.delete(playerId);
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
		const area = this.areaOf(playerId);

		if (!player || !area)
		{
			return;
		}

		const link = linkAt(area.map, cellAt(player, area.grid));

		if (link?.mode === 'manual')
		{
			this.takeLinkFrom(playerId, link);
		}
	}

	/**
	 * Changes how a player shows. A ghost becoming visible stops where they are, moving to the nearest
	 * free cell if another player holds theirs, and appears to the others in their area; a player becoming
	 * a ghost disappears from the others' view
	 *
	 * @param playerId The player's ID
	 * @param appearance How they show now
	 */
	setAppearance(playerId: string, appearance: Appearance): void
	{
		const player = this.players.get(playerId);

		if (!player)
		{
			return;
		}

		const wasGhost = player.ghost;

		player.name = appearance.name;
		player.ghost = appearance.ghost;

		if (wasGhost === appearance.ghost)
		{
			return;
		}

		if (appearance.ghost)
		{
			this.hideFromOthers(playerId);
			return;
		}

		const area = this.areaOf(playerId);

		// A travelling player is placed on a free cell when they arrive
		if (area && !this.travelling.has(playerId))
		{
			const position = this.findArrivalCell(playerId, area, cellAt(player, area.grid));

			this.steps.delete(playerId);
			this.presses.delete(playerId);

			if (position)
			{
				player.x = position.x;
				player.y = position.y;
			}
		}

		for (const otherId of this.playersIn(this.areaIds.get(playerId)))
		{
			if (otherId !== playerId)
			{
				this.showToPlayer(playerId, otherId);
			}
		}
	}

	/**
	 * One simulation tick: applies queued inputs, then moves every player in their area, and sends
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

			const areaId = this.areaIds.get(playerId);
			const area = this.areaOf(playerId);

			if ((areaId === undefined) || !area || this.travelling.has(playerId))
			{
				continue;
			}

			let occupancy = occupancies.get(areaId);

			if (!occupancy)
			{
				occupancy = this.occupancyOf(areaId);
				occupancies.set(areaId, occupancy);
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
				area.grid,
				(player.ghost ? anyCell : occupancy.isFreeFor(playerId))
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

			if (!player.ghost)
			{
				occupancy.hold(playerId, occupiedCells(mover, area.grid));
			}

			const link = (mover.stoppedAt ? linkAt(area.map, mover.stoppedAt) : undefined);

			if (link)
			{
				this.takeLinkFrom(playerId, link);
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
		for (const area of this.areas.all())
		{
			const areaId = area.loaded.area.id;
			const playerIds = this.playersIn(areaId).filter((playerId) => !this.travelling.has(playerId));
			const cells = playerIds
				.map((playerId) => this.cellOf(playerId, area))
				.filter((cell) => (cell !== undefined));
			const chunkMap = chunkMapOf(area);

			this.areas.dropChunks(areaId, chunksNear(cells, CHUNK_KEEP_RADIUS, chunkMap));

			for (const playerId of playerIds)
			{
				this.sendNearbyChunks(playerId, area);
			}

			this.areas.loadChunks(areaId, chunksNear(cells, CHUNK_LOAD_RADIUS, chunkMap)).then((loaded) =>
			{
				const current = this.areas.get(areaId);

				if ((loaded.length > 0) && current)
				{
					for (const playerId of this.playersIn(areaId))
					{
						this.sendNearbyChunks(playerId, current);
					}
				}
			}, (error: unknown) =>
			{
				console.error(`Could not load chunks of area ${areaId}:`, error);
			});
		}
	}

	/**
	 * Brings a change the world editor has made to the players it affects, if this room has the area loaded
	 *
	 * Runs outside the simulation tick
	 *
	 * @param change The change
	 */
	async applyChange(change: AreaChange): Promise<void>
	{
		if (change.kind === 'cells')
		{
			await this.applyCellChange(change.areaId, change.chunkKeys);
		}
		else if (change.kind === 'tiles')
		{
			for (const area of this.areas.all().filter((each) => (each.loaded.area.universeId === change.universeId)))
			{
				await this.applyAreaChange(area.loaded.area.id, true);
			}
		}
		else
		{
			await this.applyAreaChange(change.areaId, false);
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
	 * The area a player is in
	 *
	 * @param playerId The player's ID
	 * @return The area's ID, or undefined when the player isn't in the room
	 */
	getAreaId(playerId: string): string | undefined
	{
		return(this.areaIds.get(playerId));
	}

	/**
	 * Reads changed chunks of an area again, and sends them to the players who had been sent them
	 *
	 * @param areaId The area's ID
	 * @param chunkKeys The changed chunks, by chunkKey()
	 */
	private async applyCellChange(areaId: string, chunkKeys: string[]): Promise<void>
	{
		const changed = await this.areas.reloadChunks(areaId, chunkKeys);
		const area = this.areas.get(areaId);

		if (!area || (changed.length === 0))
		{
			return;
		}

		for (const playerId of this.playersIn(areaId))
		{
			const sent = this.sentChunks.get(playerId);
			const resend = changed.filter((key) => (sent?.has(key) ?? false));

			if (resend.length > 0)
			{
				this.sendChunks(playerId, area, resend);
			}
		}
	}

	/**
	 * Reads an area again after its settings, bounds, links or tiles changed. Players its new bounds no
	 * longer hold are moved onto the nearest free cell inside them, and everyone in it is sent the area
	 * again. Players in an area that has been deleted go to the fallback area
	 *
	 * @param areaId The area's ID
	 * @param keepChunks Whether only the tiles changed, so the loaded chunks are still right
	 */
	private async applyAreaChange(areaId: string, keepChunks: boolean): Promise<void>
	{
		if (!this.areas.get(areaId))
		{
			return;
		}

		const area = await this.areas.reload(areaId, keepChunks);
		const playerIds = this.playersIn(areaId).filter((playerId) => !this.travelling.has(playerId));

		if (!area)
		{
			this.sendToFallback(playerIds);
			return;
		}

		const { bounds } = area.loaded;
		const targets = new Map<string, Cell>();

		for (const playerId of playerIds)
		{
			const player = this.players.get(playerId);

			if (player)
			{
				const cell = cellAt(player, area.grid);

				targets.set(playerId, {
					column: Math.min(Math.max(cell.column, bounds.minColumn), bounds.maxColumn),
					row: Math.min(Math.max(cell.row, bounds.minRow), bounds.maxRow)
				});
			}
		}

		await this.areas.loadChunks(areaId, chunksNear([...targets.values()], CHUNK_LOAD_RADIUS, chunkMapOf(area)));

		const current = this.areas.get(areaId);

		if (!current)
		{
			return;
		}

		for (const [playerId, target] of targets)
		{
			const player = this.players.get(playerId);

			if (!player || (this.areaIds.get(playerId) !== areaId) || this.travelling.has(playerId))
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

			this.sendArea(playerId, current, this.getClients(playerId));
		}
	}

	/**
	 * Sends players to the center of the fallback area, for when their area has been deleted
	 *
	 * @param playerIds The players
	 */
	private sendToFallback(playerIds: string[]): void
	{
		const fallbackAreaId = this.fallbackAreaId();

		if (fallbackAreaId === undefined)
		{
			return;
		}

		for (const playerId of playerIds)
		{
			this.travel(playerId, {
				column: 0,
				row: 0,
				targetAreaId: fallbackAreaId,
				targetColumn: 0,
				targetRow: 0,
				mode: 'automatic',
				requiresWholeGroup: false
			});
		}
	}

	/**
	 * Sends a player through a link they stand on. A link that requires the whole group sends every
	 * member of the group with them, or nobody while the group isn't together
	 *
	 * @param playerId The player's ID
	 * @param link The link
	 */
	private takeLinkFrom(playerId: string, link: AreaLink): void
	{
		if (!link.requiresWholeGroup || !this.wholeGroupLinks)
		{
			this.travel(playerId, link);
			return;
		}

		const members = this.wholeGroupLinks.members();
		const together = isGroupTogether(members, playerId, (memberId) => ({
			areaId: this.areaIds.get(memberId),
			travelling: this.travelling.has(memberId)
		}));

		if (!together)
		{
			this.wholeGroupLinks.refuse(playerId);
			return;
		}

		for (const memberId of members)
		{
			this.travel(memberId, link);
		}
	}

	/**
	 * Sends a player through a link: they stop, and arrive once the link's area and the chunks around
	 * its target have loaded
	 *
	 * The load happens outside the tick. A player whose link leads nowhere they can go stays where they are
	 *
	 * @param playerId The player's ID
	 * @param link The link
	 */
	private travel(playerId: string, link: AreaLink): void
	{
		const targetCell = { column: link.targetColumn, row: link.targetRow };

		this.travelling.add(playerId);
		this.heldDirections.delete(playerId);
		this.presses.delete(playerId);
		this.steps.delete(playerId);
		this.moveInputs.remove(playerId);

		this.areas.load(link.targetAreaId)
			.then(async (target) =>
			{
				if (target)
				{
					await this.areas.loadChunks(target.loaded.area.id, chunksNear([targetCell], CHUNK_LOAD_RADIUS, chunkMapOf(target)));
				}

				this.arrive(playerId, link, this.areas.get(link.targetAreaId));
			})
			.catch((error: unknown) =>
			{
				console.error(`Player ${playerId} could not take a link to area ${link.targetAreaId}:`, error);
				this.travelling.delete(playerId);
			});
	}

	/**
	 * Moves a travelling player into the area their link leads to, on the free cell nearest its target
	 *
	 * @param playerId The player's ID
	 * @param link The link they took
	 * @param target The link's area, or undefined when it doesn't exist
	 */
	private arrive(playerId: string, link: AreaLink, target: ActiveArea | undefined): void
	{
		// The player may have left the room while the area loaded
		if (!this.travelling.delete(playerId))
		{
			return;
		}

		const player = this.players.get(playerId);

		if (!player || !target || !target.loaded.area.enabled)
		{
			return;
		}

		const position = this.findArrivalCell(playerId, target, { column: link.targetColumn, row: link.targetRow });

		if (!position)
		{
			return;
		}

		this.hideFromArea(playerId);
		this.areaIds.set(playerId, target.loaded.area.id);
		player.x = position.x;
		player.y = position.y;
		this.showToArea(playerId);
		this.sendArea(playerId, target, this.getClients(playerId));
	}

	/**
	 * Sends a player's clients an area, with the loaded chunks near the player, and remembers those as sent
	 *
	 * @param playerId The player's ID
	 * @param area The area they are in
	 * @param clients The clients to send it to
	 */
	private sendArea(playerId: string, area: ActiveArea, clients: Client[]): void
	{
		const near = this.loadedChunksNear(playerId, area);
		const payload = toAreaPayload(area, near);

		this.sentChunks.set(playerId, new Set(near));

		for (const client of clients)
		{
			client.send(ServerMessageType.Area, payload);
		}
	}

	/**
	 * Sends a player the loaded chunks near them they haven't been sent, and forgets having sent the ones
	 * they have moved away from, so those are sent again (with any changes) when the player comes back
	 *
	 * @param playerId The player's ID
	 * @param area The area they are in
	 */
	private sendNearbyChunks(playerId: string, area: ActiveArea): void
	{
		const sent = this.sentChunks.get(playerId);
		const cell = this.cellOf(playerId, area);

		if (!sent || !cell)
		{
			return;
		}

		const kept = chunksNear([cell], CHUNK_KEEP_RADIUS, chunkMapOf(area));

		for (const key of [...sent])
		{
			if (!kept.has(key))
			{
				sent.delete(key);
			}
		}

		const fresh = this.loadedChunksNear(playerId, area).filter((key) => !sent.has(key));

		if (fresh.length > 0)
		{
			this.sendChunks(playerId, area, fresh);
		}
	}

	/**
	 * Sends a player's clients some loaded chunks of their area, and remembers them as sent
	 *
	 * @param playerId The player's ID
	 * @param area The area they are in
	 * @param chunkKeys The chunks, by chunkKey()
	 */
	private sendChunks(playerId: string, area: ActiveArea, chunkKeys: string[]): void
	{
		const sent = (this.sentChunks.get(playerId) ?? new Set<string>());
		const payload: ChunksPayload = {
			areaId: area.loaded.area.id,
			chunks: toChunkUpdates(area, chunkKeys)
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
	 * The loaded chunks of an area near a player
	 *
	 * @param playerId The player's ID
	 * @param area The area they are in
	 * @return The chunks' keys
	 */
	private loadedChunksNear(playerId: string, area: ActiveArea): string[]
	{
		const cell = this.cellOf(playerId, area);

		if (!cell)
		{
			return([]);
		}

		return([...chunksNear([cell], CHUNK_LOAD_RADIUS, chunkMapOf(area))].filter((key) => area.loadedChunks.has(key)));
	}

	/**
	 * The cell a player is in
	 *
	 * @param playerId The player's ID
	 * @param area The area they are in
	 * @return The cell, or undefined when the player isn't in the room
	 */
	private cellOf(playerId: string, area: ActiveArea): Cell | undefined
	{
		const player = this.players.get(playerId);

		return((player ? cellAt(player, area.grid) : undefined));
	}

	/**
	 * The center of the free cell nearest a cell of an area, searching as far as its chunks are loaded around
	 * the cell. Other players don't hold cells for a ghost, so a ghost needs only a cell they can stand in
	 *
	 * @param playerId The player arriving, whose own cells count as free
	 * @param area The area
	 * @param near The cell to start from
	 * @return The cell's center, or undefined when there is no free cell that near
	 */
	private findArrivalCell(playerId: string, area: ActiveArea, near: Cell): Position | undefined
	{
		const { minColumn, minRow, maxColumn, maxRow } = area.grid.bounds;
		const searchDistance = Math.min(Math.max(maxColumn - minColumn, maxRow - minRow) + 1, CHUNK_LOAD_RADIUS);
		const isCellFree = (this.isGhost(playerId) ? anyCell : this.occupancyOf(area.loaded.area.id, playerId).isFreeFor(playerId));

		return(findFreeCell(near, area.grid, isCellFree, searchDistance));
	}

	/**
	 * Works out which cells the players in an area hold right now; ghosts hold none
	 *
	 * A cell has one holder, so a player standing where another is (such as a ghost becoming visible)
	 * would hide the other's hold on it. Leaving that player out keeps the other's
	 *
	 * @param areaId The area's ID
	 * @param exceptPlayerId A player whose cells to leave out
	 * @return The area's occupancy
	 */
	private occupancyOf(areaId: string, exceptPlayerId?: string): CellOccupancy
	{
		const occupancy = new CellOccupancy();
		const area = this.areas.get(areaId);

		if (!area)
		{
			return(occupancy);
		}

		for (const playerId of this.playersIn(areaId))
		{
			const player = this.players.get(playerId);

			if (player && !player.ghost && (playerId !== exceptPlayerId))
			{
				occupancy.hold(
					playerId,
					occupiedCells(
						{
							x: player.x,
							y: player.y,
							step: this.steps.get(playerId)
						},
						area.grid
					)
				);
			}
		}

		return(occupancy);
	}

	/**
	 * Shows a player to everyone else in their area, and everyone else in it to them
	 *
	 * @param playerId The player's ID
	 */
	private showToArea(playerId: string): void
	{
		for (const otherId of this.playersIn(this.areaIds.get(playerId)))
		{
			if (otherId !== playerId)
			{
				this.showToPlayer(playerId, otherId);
				this.showToPlayer(otherId, playerId);
			}
		}
	}

	/**
	 * Hides a player from everyone else in their area, and everyone else in it from them
	 *
	 * @param playerId The player's ID
	 */
	private hideFromArea(playerId: string): void
	{
		this.hideFromOthers(playerId);

		for (const otherId of this.playersIn(this.areaIds.get(playerId)))
		{
			if (otherId !== playerId)
			{
				this.hideFromPlayer(otherId, playerId);
			}
		}
	}

	/**
	 * Hides a player from everyone else in their area
	 *
	 * @param playerId The player's ID
	 */
	private hideFromOthers(playerId: string): void
	{
		for (const otherId of this.playersIn(this.areaIds.get(playerId)))
		{
			if (otherId !== playerId)
			{
				this.hideFromPlayer(playerId, otherId);
			}
		}
	}

	/**
	 * Hides a player from every client of another player that sees them
	 *
	 * @param playerId The player to hide
	 * @param viewerId The player whose clients stop seeing them
	 */
	private hideFromPlayer(playerId: string, viewerId: string): void
	{
		const player = this.players.get(playerId);

		if (!player)
		{
			return;
		}

		for (const client of this.getClients(viewerId))
		{
			// Removing a player a view doesn't hold would still send its clients a removal
			if (client.view?.has(player))
			{
				client.view.remove(player);
			}
		}
	}

	/**
	 * Shows a player to every client of another player, unless the player is a ghost
	 *
	 * @param playerId The player to show
	 * @param viewerId The player whose clients see them
	 */
	private showToPlayer(playerId: string, viewerId: string): void
	{
		if (this.isGhost(playerId))
		{
			return;
		}

		for (const client of this.getClients(viewerId))
		{
			this.show(playerId, client);
		}
	}

	/**
	 * Whether a player is a ghost
	 *
	 * @param playerId The player's ID
	 * @return True when they are in the room as a ghost
	 */
	private isGhost(playerId: string): boolean
	{
		return(this.players.get(playerId)?.ghost ?? false);
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

		if (player && !client.view?.has(player))
		{
			client.view?.add(player);
		}
	}

	/**
	 * The players in an area
	 *
	 * @param areaId The area's ID
	 * @return Their IDs
	 */
	private playersIn(areaId: string | undefined): string[]
	{
		return([...this.areaIds]
			.filter(([, playerAreaId]) => (playerAreaId === areaId))
			.map(([playerId]) => playerId));
	}

	/**
	 * The area a player is in
	 *
	 * @param playerId The player's ID
	 * @return The area, or undefined when the player isn't in the room
	 */
	private areaOf(playerId: string): ActiveArea | undefined
	{
		const areaId = this.areaIds.get(playerId);

		return(((areaId !== undefined) ? this.areas.get(areaId) : undefined));
	}
}

/**
 * An area's map as chunksNear needs it
 *
 * @param area The area
 * @return Its bounds and whether it loops
 */
function chunkMapOf(area: ActiveArea): ChunkAreaMap
{
	return({
		bounds: area.loaded.bounds,
		loopsEastWest: area.loaded.loopsEastWest,
		loopsNorthSouth: area.loaded.loopsNorthSouth
	});
}
