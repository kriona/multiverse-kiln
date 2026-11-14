import type { Client } from 'colyseus';
import { StateView, type MapSchema } from '@colyseus/schema';
import { areaLight, canSee, CHUNK_SIZE, isInBounds, NEIGHBOR_SIDES, Player, secondOfDay, ServerMessageType, visionBudget, windowsAcrossSeams, type AreaCellRef, type AreaCellWindow, type AreaPayload, type AreaTime, type ChunksPayload, type MovePayload, type NeighborAreasPayload, type NeighborSide, type Sight, type WelcomePayload } from '@multiverse-kiln/shared';

import { chunksIn, chunksNear, type ChunkAreaShape } from '../logic/chunkArea.js';
import { stepSeconds } from '../logic/gameClock.js';
import { cellAt, cellCenter, findFreeCell, NO_PRESS, occupiedCells, stepOnGrid, wrapCell, type Cell, type DirectionPress, type GridStep, type IsCellFree, type Position } from '../logic/movement.js';
import { AreaOccupancy, type PlacedCell } from '../logic/occupancy.js';
import { linkAt, type AreaLink } from '../logic/areaGrid.js';
import { isGroupTogether } from '../logic/groupLinks.js';
import type { AreaChange } from '../world/areaChanges.js';
import { InputQueue } from './inputQueue.js';
import { PlayerSessions } from './playerSessions.js';
import { toChunkUpdates, toAreaPayload, type ActiveArea, type AreaCache, type AreaMemory } from './areaCache.js';

/**
 * Simulation ticks per second, in every room with areas
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

/**
 * How the area, its chunks and the cells the group sees in it are sent: after the next state patch, all
 * of them, so they reach the window in the order they were made. An area a player arrives in must follow
 * the patch with their position in it, and a window drops chunks and cells of an area it isn't drawing,
 * so anything about the new area sent at once would arrive before the area and be lost. The area sent
 * to a client as it joins is the exception (see sendArea)
 */
export const AREA_MESSAGE_OPTIONS = Object.freeze({ afterNextPatch: true });

const standingStill: MovePayload = { x: 0, y: 0 };

/**
 * Every cell is free for a ghost
 *
 * @return True
 */
const anyCell: IsCellFree = () => true;

/**
 * How a player shows in the area, and how far they see (see visionBudget)
 */
export interface Appearance extends Sight
{
	name: string;

	/**
	 * Whether the player is a ghost: only their own clients see them, and they hold no cell, so they
	 * pass through other players and nobody bumps into them
	 */
	ghost: boolean;
}

/**
 * How the players in a room see
 */
export interface RoomVision
{
	/**
	 * Whether everyone in the room is in one group, which sees whatever any of its members in an area
	 * sees there. Otherwise each player sees only what they see themselves
	 */
	shared: boolean;

	/**
	 * The game clock, for the time of day in areas where time flows normally
	 *
	 * @return Seconds of game time
	 */
	clockSeconds(): number;

	/**
	 * What the group has seen, in a group's room: its clients are sent only those cells of the area, and
	 * the links on them
	 */
	memory?: AreaMemory;
}

/**
 * Which areas a room's players walk: a lobby walks only the lobby areas (those below the lobby region),
 * and a group's room only the others, so a link or evacuation across the lobby region's edge takes no one
 */
export interface RoomSide
{
	/**
	 * Whether the room is a lobby
	 */
	lobby: boolean;

	/**
	 * Where players go when the area they are in is deleted or leaves the room's side of the edge
	 *
	 * @return The place, or undefined when there is nowhere to go
	 */
	fallback(): PlayerPosition | undefined;
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
 * Told that a player finished a step
 *
 * @param playerId The player's ID
 * @param seconds The game time the step took (stepSeconds)
 * @param time How the time of day works in the area the step was in
 */
export type WalkListener = (playerId: string, seconds: number, time: AreaTime) => void;

/**
 * Where a player looks from and how far they see
 */
export interface PlayerSight
{
	playerId: string;
	area: ActiveArea;
	cell: Cell;

	/**
	 * Their vision budget (see visionBudget)
	 */
	budget: number;
}

/**
 * The players in a room with areas (a universe's lobby or a group's game room): which
 * clients control them, which area each is in, how they move, and which of them each client sees
 *
 * Each client controls one player (see PlayerSessions), and can be switched to another (control()).
 * Players stay in the room until the room removes them (remove()), so a lobby removes a player once
 * their last client has left, and a group's room keeps every character of a player who has any window
 * in it. A room holds every area its players are in; a client sees, through its StateView, only the
 * players in its own player's area, or near it across a seam with a neighboring area, that its player
 * can see (see RoomVision and canSee), and no other player's ghost; what each client sees is brought up
 * to date every tick. Stepping onto an automatic area link, or asking to take the manual link the player
 * stands on, sends the player to the link's target cell once that area has loaded; a link that requires
 * the whole group sends every member (see WholeGroupLinks). Stepping past an area's edge across a seam
 * moves the player into the neighbor there, as walking within an area does (see Neighboring areas in
 * STRUCTURE-OVERVIEW.md). The room calls update() from its simulation tick and refreshChunks() every
 * CHUNK_REFRESH_INTERVAL_MS
 *
 * Only the chunks of each area near its players are loaded, and each player is sent the chunks near them
 * as they move, of their area and of the neighbors across its seams, which are loaded too. Changes the
 * world editor makes (applyChange) reach the players immediately
 */
export class AreaPlayers
{
	private readonly sessions = new PlayerSessions();
	private readonly clients = new Map<string, Client>();

	/**
	 * The area each player is in
	 */
	private readonly areaIds = new Map<string, string>();

	/**
	 * The players in each area, by the area's ID, kept with areaIds by putInArea() and takeOutOfArea()
	 */
	private readonly playerIdsByArea = new Map<string, Set<string>>();

	/**
	 * The players each client's view holds, by the view (see showOnly); a view missing here holds none
	 */
	private shownIn = new WeakMap<StateView, ReadonlySet<string>>();

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
	 * Players waiting for the area a link is taking them to, with that area's ID; they don't move until
	 * they arrive
	 */
	private readonly travelling = new Map<string, string>();

	/**
	 * Whether players are kept from starting steps and taking links (see setLocked)
	 */
	private locked = false;

	/**
	 * The chunks of their area each player's clients have been sent, by chunkKey()
	 */
	private readonly sentChunks = new Map<string, Set<string>>();

	/**
	 * The areas across the seams of their area each player's clients have been sent since their area was,
	 * with the chunks of each sent, by area ID then chunkKey()
	 */
	private readonly sentNeighbors = new Map<string, Map<string, Set<string>>>();

	/**
	 * Told of each step a player other than a ghost finishes (see onWalk)
	 */
	private walkListener?: WalkListener;

	/**
	 * Whether refreshing the views waits for the end of refreshingViewsOnce()
	 */
	private viewsHeld = false;

	/**
	 * Whether the views needed refreshing while they were held
	 */
	private viewsStale = false;


	/**
	 * @param players The room's synced players, which this adds to, moves and removes
	 * @param areas The room's areas
	 * @param side Which side of the lobby region's edge the room's players walk, and where they go when
	 * their area is deleted or leaves that side
	 * @param vision How the room's players see
	 * @param wholeGroupLinks How links that require the whole group work, in a group's room
	 */
	constructor(private readonly players: MapSchema<Player>, private readonly areas: AreaCache, private readonly side: RoomSide, private readonly vision: RoomVision, private readonly wholeGroupLinks?: WholeGroupLinks)
	{
		// A seam into a disabled area, or across the lobby region's edge, is an edge
		areas.setSeamFilter((loaded) => (loaded.area.enabled && (loaded.area.lobby === side.lobby)));
	}

	/**
	 * Listens for the steps players finish, during update(), so a group's room can pass game time
	 *
	 * @param listener Called with each step's player, the game time it took, and its area's time setting
	 */
	onWalk(listener: WalkListener): void
	{
		this.walkListener = listener;
	}

	/**
	 * The clients of the players who have been sent a chunk of an area, in it or across a seam from it,
	 * for telling them about cells of it
	 *
	 * @param areaId The area's ID
	 * @param key The chunk, by chunkKey()
	 * @return The clients
	 */
	clientsSentChunk(areaId: string, key: string): Client[]
	{
		const inArea = this.playersIn(areaId).filter((playerId) => (this.sentChunks.get(playerId)?.has(key) ?? false));
		const across = [...this.sentNeighbors]
			.filter(([, areas]) => (areas.get(areaId)?.has(key) ?? false))
			.map(([playerId]) => playerId);

		return([...new Set([...inArea, ...across])].flatMap((playerId) => this.getClients(playerId)));
	}

	/**
	 * The area and cell a cell past an area's edges is in, across its seams with the areas loaded
	 *
	 * @param areaId The area the cell is counted from
	 * @param column The cell's column
	 * @param row The cell's row
	 * @return The cell, or undefined past an edge
	 */
	locate(areaId: string, column: number, row: number): AreaCellRef | undefined
	{
		return(this.areas.locate(areaId, column, row));
	}

	/**
	 * Where each player in an area who isn't a ghost looks from and how far they see, leaving out those
	 * on their way to another area
	 *
	 * @return Their sights
	 */
	sights(): PlayerSight[]
	{
		const nowMilliseconds = Date.now();
		const sights: PlayerSight[] = [];

		for (const playerId of this.players.keys())
		{
			const area = this.areaOf(playerId);
			const sight = ((area && !this.isGhost(playerId) && !this.travelling.has(playerId)) ? this.sightOf(playerId, area, nowMilliseconds) : undefined);

			if (area && sight)
			{
				sights.push({
					playerId,
					area,
					...sight
				});
			}
		}

		return(sights);
	}

	/**
	 * Loads the chunks a new player needs to be placed in an area, around a cell. Call it before add() or
	 * join(), with what it returns
	 *
	 * @param area The area, as the cache holds it
	 * @param near The cell, the area's center by default
	 * @return The area, or undefined when the cache was holding another copy of it or reloaded or forgot
	 * it while the chunks loaded, as after an editor changed or disabled it: the caller looks for where
	 * the player starts again
	 */
	async prepareStart(area: ActiveArea, near: Cell = { column: 0, row: 0 }): Promise<ActiveArea | undefined>
	{
		const areaId = area.loaded.area.id;

		await this.loadAround(area, near);

		return(((this.areas.get(areaId) === area) ? area : undefined));
	}

	/**
	 * Loads an area's chunks near a cell, with the areas across its seams near the cell, the areas at
	 * their corners, and their chunks near it. A player placed there is then sent every area around them
	 * with their own, rather than each a chunk refresh or two later
	 *
	 * @param area The area
	 * @param near The cell
	 */
	private async loadAround(area: ActiveArea, near: Cell): Promise<void>
	{
		await Promise.all([
			this.areas.loadChunks(area.loaded.area.id, chunksNear([near], CHUNK_LOAD_RADIUS, chunkShapeOf(area))),
			this.loadSeamsNear(area, near)
		]);
	}

	/**
	 * Loads the areas across an area's seams within CHUNK_LOAD_RADIUS of a cell, the areas at their
	 * corners near it, and their chunks near it. One that can't be loaded is left to refreshChunks(),
	 * which loads it again and says why it can't
	 *
	 * @param area The area
	 * @param near The cell
	 */
	private async loadSeamsNear(area: ActiveArea, near: Cell): Promise<void>
	{
		if (!area.seams)
		{
			return;
		}

		const { bounds, sides } = area.loaded;
		const reaches: Record<NeighborSide, boolean> = {
			north: ((near.row - bounds.minRow) < CHUNK_LOAD_RADIUS),
			east: ((bounds.maxColumn - near.column) < CHUNK_LOAD_RADIUS),
			south: ((bounds.maxRow - near.row) < CHUNK_LOAD_RADIUS),
			west: ((near.column - bounds.minColumn) < CHUNK_LOAD_RADIUS)
		};
		const across = (side: NeighborSide): readonly NeighborSide[] => (((side === 'north') || (side === 'south')) ? ['east', 'west'] : ['north', 'south']);
		const nearSides = NEIGHBOR_SIDES.filter((side) => reaches[side]);

		try
		{
			// A corner is the neighbor of a side, so the sides load first
			const sideAreas = await Promise.all(nearSides.map(async (side) => ({ side, area: ((sides[side] === null) ? undefined : await this.areas.load(sides[side])) })));
			const cornerIds = new Set(sideAreas.flatMap(({ side, area: sideArea }) => across(side)
				.filter((corner) => reaches[corner])
				.map((corner) => sideArea?.loaded.sides[corner] ?? null)
				.filter((cornerId) => (cornerId !== null))));

			await Promise.all([...cornerIds].map((cornerId) => this.areas.load(cornerId)));

			const chunks = new Map<string, Set<string>>();

			for (const window of this.windowsNear(area, near, CHUNK_LOAD_RADIUS))
			{
				chunks.set(window.areaId, new Set([...(chunks.get(window.areaId) ?? []), ...chunksIn(window.bounds)]));
			}

			await Promise.all([...chunks].map(([areaId, keys]) => this.areas.loadChunks(areaId, keys)));
		}
		catch (error)
		{
			console.error(`Could not load the areas around area ${area.loaded.area.id}:`, error);
		}
	}

	/**
	 * Adds a player to the room, on the free cell nearest a cell of an area, before any client controls
	 * them. Does nothing for a player already here
	 *
	 * @param playerId The player's ID
	 * @param appearance How they show
	 * @param area Where they start, as prepareStart() returned it
	 * @param near The cell to start nearest
	 */
	add(playerId: string, appearance: Appearance, area: ActiveArea, near: Cell): void
	{
		if (this.place(playerId, appearance, area, near))
		{
			this.refreshViews();
		}
	}

	/**
	 * Puts a player new to the room on the free cell nearest a cell of an area, leaving the clients'
	 * views for the caller to refresh. Does nothing for a player already here
	 *
	 * @param playerId The player's ID
	 * @param appearance How they show
	 * @param area Where they start, as prepareStart() returned it
	 * @param near The cell to start nearest
	 * @param occupancy The cells the room's players hold, when placing several players at once: the
	 * player's cell is added to it. Without it, the occupancy is worked out from the players
	 * @return Whether the player was placed
	 */
	private place(playerId: string, appearance: Appearance, area: ActiveArea, near: Cell, occupancy?: AreaOccupancy): boolean
	{
		if (this.players.has(playerId))
		{
			return(false);
		}

		// Added before it has a cell, so the search below knows whether the player is a ghost
		const player = new Player({ areaId: area.loaded.area.id, x: 0, y: 0, name: appearance.name, ghost: appearance.ghost, darkvision: appearance.darkvision, lightSensitivity: appearance.lightSensitivity });

		this.players.set(playerId, player);

		const position = this.findArrivalCell(playerId, area, near, occupancy);

		if (!position)
		{
			this.players.delete(playerId);
			throw new Error(`No free cell for player ${playerId} in area ${area.loaded.area.id}`);
		}

		player.x = position.x;
		player.y = position.y;
		this.putInArea(playerId, area.loaded.area.id);

		if (occupancy && !player.ghost)
		{
			occupancy.hold(
				playerId,
				this.placedCells(area, occupiedCells(
					{
						x: player.x,
						y: player.y,
						step: undefined
					},
					area.grid
				))
			);
		}

		return(true);
	}

	/**
	 * Adds a joining client controlling a player. A player new to the room is first placed on the free
	 * cell nearest a cell of the start area; a player already here gets another window. Either way the
	 * client is told which player it controls and which area it is in. Without a start area, as in a
	 * lobby with no area, a new player is in no area until placeAll()
	 *
	 * @param client The joining client
	 * @param playerId The player the client controls
	 * @param appearance How a player new to the room shows
	 * @param startArea Where a player new to the room starts, as prepareStart() returned it, or undefined for nowhere
	 * @param near The cell of the start area to start nearest, its center by default
	 * @return Whether the player is new to the room
	 */
	join(client: Client, playerId: string, appearance: Appearance, startArea: ActiveArea | undefined, near: Cell = { column: 0, row: 0 }): boolean
	{
		const isNewPlayer = !this.players.has(playerId);

		// attach() refreshes the views, for the new player and the new client at once
		if (isNewPlayer && startArea)
		{
			this.place(playerId, appearance, startArea, near);
		}

		this.sessions.add(client.sessionId, playerId);
		this.clients.set(client.sessionId, client);
		this.attach(client, playerId, true);

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

		this.attach(client, playerId, false);

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

		// Out of every area first, so the views that hold the player let go of them before they are deleted
		this.takeOutOfArea(playerId);
		this.refreshViews();
		this.players.delete(playerId);
		this.steps.delete(playerId);
		this.presses.delete(playerId);
		this.travelling.delete(playerId);
		this.sentChunks.delete(playerId);
		this.sentNeighbors.delete(playerId);
	}

	/**
	 * Takes every player out of their area, keeping the clients that control them, as when a lobby loses
	 * its area. Players stay in no area until placeAll()
	 */
	clearArea(): void
	{
		this.stopAll();
		this.areaIds.clear();
		this.playerIdsByArea.clear();
		this.refreshViews();

		// Players placed again are new objects, which the views don't hold even where their IDs are the same
		this.shownIn = new WeakMap();
		this.players.clear();
		this.steps.clear();
		this.presses.clear();
		this.travelling.clear();
		this.sentChunks.clear();
		this.sentNeighbors.clear();
	}

	/**
	 * Puts every player that clients control on the free cell nearest a cell of an area, wherever they
	 * were, as when a lobby gets an area or moves to another, and sends their clients the area
	 *
	 * @param area The area, as prepareStart() returned it for the cell
	 * @param near The cell to start nearest
	 * @param appearanceOf How each player shows
	 */
	placeAll(area: ActiveArea, near: Cell, appearanceOf: (playerId: string) => Appearance): void
	{
		const playerIds = this.sessions.getPlayerIds();

		this.clearArea();

		// The area holds only the players placed here, so one occupancy, added to as each is placed,
		// serves every search, and the views are refreshed once they are all in
		const occupancy = new AreaOccupancy();

		for (const playerId of playerIds)
		{
			this.place(playerId, appearanceOf(playerId), area, near, occupancy);
		}

		this.refreshViews();

		for (const playerId of playerIds)
		{
			for (const client of this.getClients(playerId))
			{
				this.greet(client, playerId, false);
			}
		}
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
	 * Shows a client the players its player sees, and tells it which player it controls and which area
	 * it is in
	 *
	 * @param client The client, already recorded as controlling the player
	 * @param playerId The player
	 * @param joining Whether the client has just joined
	 */
	private attach(client: Client, playerId: string, joining: boolean): void
	{
		this.refreshViews();
		this.greet(client, playerId, joining);
	}

	/**
	 * Tells a client which player it controls and which area it is in
	 *
	 * @param client The client
	 * @param playerId The player
	 * @param joining Whether the client has just joined, so the area is sent at once (see sendArea)
	 */
	private greet(client: Client, playerId: string, joining: boolean): void
	{
		const area = this.areaOf(playerId);
		const welcome: WelcomePayload = { playerId };

		client.send(ServerMessageType.Welcome, welcome);

		if (area)
		{
			this.sendArea(playerId, area, [client], joining);
		}
	}

	/**
	 * Locks or unlocks the players' movement, as a group's room does at the end of time. While locked,
	 * Moves and TakeLink are ignored, and a step under way finishes without taking the automatic link it
	 * ends on
	 *
	 * @param locked Whether players are locked
	 */
	setLocked(locked: boolean): void
	{
		this.locked = locked;

		if (locked)
		{
			this.stopAll();
		}
	}

	/**
	 * Stops every player at the end of their current step, as when the room stops taking moves
	 */
	stopAll(): void
	{
		for (const playerId of this.players.keys())
		{
			this.stop(playerId);
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
	 * Queues a client's Move for the next tick, unless players are locked
	 *
	 * @param sessionId The client's session ID
	 * @param move The direction held
	 */
	queueMove(sessionId: string, move: MovePayload): void
	{
		const playerId = this.sessions.getPlayerId(sessionId);

		if ((playerId !== undefined) && !this.locked)
		{
			this.moveInputs.push(playerId, move);
		}
	}

	/**
	 * Takes the manual link the client's player is standing on, if there is one; does nothing while
	 * players are locked, or the player is mid-step or already travelling
	 *
	 * @param sessionId The client's session ID
	 */
	takeLink(sessionId: string): void
	{
		const playerId = this.sessions.getPlayerId(sessionId);

		if ((playerId === undefined) || this.locked || this.travelling.has(playerId) || this.steps.has(playerId))
		{
			return;
		}

		const player = this.players.get(playerId);
		const area = this.areaOf(playerId);

		if (!player || !area)
		{
			return;
		}

		const link = linkAt(area.layout, cellAt(player, area.grid));

		if (link?.mode === 'manual')
		{
			this.takeLinkFrom(playerId, link, area);
		}
	}

	/**
	 * Makes changes to many players, such as their appearances, refreshing the clients' views once at the
	 * end rather than after each change. Each refresh looks at every pair of players, so refreshing after
	 * each of a few hundred changes would stall the room
	 *
	 * @param changes Makes the changes
	 */
	refreshingViewsOnce(changes: () => void): void
	{
		if (this.viewsHeld)
		{
			changes();
			return;
		}

		this.viewsHeld = true;
		this.viewsStale = false;

		try
		{
			changes();
		}
		finally
		{
			this.viewsHeld = false;

			if (this.viewsStale)
			{
				this.refreshViews();
			}
		}
	}

	/**
	 * Changes how a player shows. A ghost becoming visible stops where they are, moving to the nearest
	 * free cell if another player holds theirs, and appears to the others in their area who can see
	 * them; a player becoming a ghost disappears from the others' view
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
		player.darkvision = appearance.darkvision;
		player.lightSensitivity = appearance.lightSensitivity;

		if (wasGhost === appearance.ghost)
		{
			return;
		}

		if (appearance.ghost)
		{
			this.refreshViews();
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

		this.refreshViews();
	}

	/**
	 * One simulation tick: applies queued inputs, then moves every player in their area, sends players
	 * who stepped onto an automatic link on their way, and shows each client the players its player
	 * now sees
	 *
	 * @param deltaSeconds Seconds since the previous tick
	 */
	update(deltaSeconds: number): void
	{
		// Players move one at a time, each seeing the cells the players before it have just taken or freed.
		// When two want the same cell, the one earlier in the map gets it
		const occupancy = this.occupancyOf();

		for (const [playerId, player] of this.players)
		{
			for (const move of this.moveInputs.drain(playerId))
			{
				this.heldDirections.set(playerId, move);
			}

			const area = this.areaOf(playerId);

			if (!area || this.travelling.has(playerId))
			{
				continue;
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
				(player.ghost ? anyCell : this.isFreeIn(occupancy, playerId, area))
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
				for (const step of mover.finishedSteps)
				{
					const into = wrapCell(step.to, area.grid);
					const stepArea = (isInBounds(area.loaded.bounds, into.column, into.row) ? area : (this.areaAcross(area, into) ?? area));

					this.walkListener?.(playerId, stepSeconds(step, area.grid.walkSeconds(into), area.grid.fullSpeedWalkSeconds), stepArea.loaded.time);
				}
			}

			// A step across a seam ends past the area's edge, in the neighbor the player now moves into
			const current = ((!mover.step && area.seams) ? this.crossSeam(playerId, player, area) : area);

			if (!player.ghost)
			{
				occupancy.hold(playerId, this.placedCells(current, occupiedCells({ x: player.x, y: player.y, step: this.steps.get(playerId) }, current.grid)));
			}

			const link = ((mover.stoppedAt && !this.locked && (current === area)) ? linkAt(area.layout, mover.stoppedAt) : undefined);

			if (link)
			{
				this.takeLinkFrom(playerId, link, area);
			}
		}

		this.refreshViews();
	}

	/**
	 * The area a cell past an area's edges is in, across its seams
	 *
	 * @param area The area
	 * @param cell The cell
	 * @return The area, or undefined past an edge
	 */
	private areaAcross(area: ActiveArea, cell: Cell): ActiveArea | undefined
	{
		const found = this.areas.locate(area.loaded.area.id, cell.column, cell.row);

		return(((found === undefined) ? undefined : this.areas.get(found.areaId)));
	}

	/**
	 * Moves a player who has just stepped past their area's edge across a seam into the neighbor, onto the
	 * same cell counted in the neighbor's columns and rows, as walking within an area: their press carries
	 * on, and their clients are sent the neighbor as their area. A player past an edge that no longer leads
	 * anywhere goes back onto the nearest free cell of their area
	 *
	 * @param playerId The player's ID
	 * @param player The player
	 * @param area The area they were in
	 * @return The area they are in now
	 */
	private crossSeam(playerId: string, player: Player, area: ActiveArea): ActiveArea
	{
		const cell = {
			column: Math.floor(player.x / area.grid.cellSize),
			row: Math.floor(player.y / area.grid.cellSize)
		};

		if (isInBounds(area.loaded.bounds, cell.column, cell.row))
		{
			return(area);
		}

		const found = this.areas.locate(area.loaded.area.id, cell.column, cell.row);
		const target = ((found === undefined) ? undefined : this.areas.get(found.areaId));

		if (!found || !target)
		{
			const position = this.findArrivalCell(playerId, area, cellAt(player, area.grid));

			if (position)
			{
				player.x = position.x;
				player.y = position.y;
			}

			return(area);
		}

		const center = cellCenter(found, target.grid);

		this.putInArea(playerId, target.loaded.area.id);
		player.x = center.x;
		player.y = center.y;
		this.sendArea(playerId, target, this.getClients(playerId));

		return(target);
	}

	/**
	 * Forgets the areas nobody has been in, on their way to or about to be placed in for a while, loads
	 * the chunks players have come near, drops the ones nobody is near, and sends each player the loaded
	 * chunks near them they haven't been sent. Runs outside the simulation tick; loading finishes later,
	 * and the chunks are sent once they arrive
	 */
	refreshChunks(): void
	{
		this.areas.forgetIdle(this.areasInUse());
		this.loadSeamAreas();

		// The chunks to keep and load in each area: those near its players, and those near the players
		// across its seams
		const keep = new Map<string, Set<string>>();
		const load = new Map<string, Set<string>>();
		const add = (chunks: Map<string, Set<string>>, areaId: string, keys: Iterable<string>): void =>
		{
			const found = (chunks.get(areaId) ?? new Set<string>());

			for (const key of keys)
			{
				found.add(key);
			}

			chunks.set(areaId, found);
		};

		for (const area of this.areas.all())
		{
			const areaId = area.loaded.area.id;
			const cells = this.playersIn(areaId)
				.filter((playerId) => !this.travelling.has(playerId))
				.map((playerId) => this.cellOf(playerId, area))
				.filter((cell) => (cell !== undefined));
			const chunkShape = chunkShapeOf(area);

			add(keep, areaId, chunksNear(cells, CHUNK_KEEP_RADIUS, chunkShape));
			add(load, areaId, chunksNear(cells, CHUNK_LOAD_RADIUS, chunkShape));

			for (const cell of (area.seams ? cells : []))
			{
				for (const window of this.windowsNear(area, cell, CHUNK_KEEP_RADIUS))
				{
					add(keep, window.areaId, chunksIn(window.bounds));
				}

				for (const window of this.windowsNear(area, cell, CHUNK_LOAD_RADIUS))
				{
					add(load, window.areaId, chunksIn(window.bounds));
				}
			}
		}

		for (const area of this.areas.all())
		{
			this.areas.dropChunks(area.loaded.area.id, (keep.get(area.loaded.area.id) ?? new Set()));
		}

		for (const [playerId, areaId] of this.areaIds)
		{
			const area = this.areas.get(areaId);

			if (area && !this.travelling.has(playerId))
			{
				this.sendNearbyChunks(playerId, area);
			}
		}

		for (const [areaId, keys] of load)
		{
			this.areas.loadChunks(areaId, keys).then((loaded) =>
			{
				if (loaded.length > 0)
				{
					this.sendChunksNear(areaId);
				}
			}, (error: unknown) =>
			{
				console.error(`Could not load chunks of area ${areaId}:`, error);
			});
		}
	}

	/**
	 * Sends the chunks that have just loaded of an area to the players near them: those in it, and those
	 * across its seams
	 *
	 * @param areaId The area's ID
	 */
	private sendChunksNear(areaId: string): void
	{
		for (const [playerId, playerAreaId] of this.areaIds)
		{
			const area = this.areas.get(playerAreaId);

			if (area && !this.travelling.has(playerId) && ((playerAreaId === areaId) || area.seams))
			{
				this.sendNearbyChunks(playerId, area);
			}
		}
	}

	/**
	 * Starts loading the areas across the seams of the areas players are in, and those at their corners,
	 * so players can walk, see and be seen across them. Until one has loaded, its seam is an edge
	 */
	private loadSeamAreas(): void
	{
		for (const areaId of this.seamAreaIds())
		{
			if (!this.areas.get(areaId))
			{
				this.areas.load(areaId).catch((error: unknown) =>
				{
					console.error(`Could not load the neighboring area ${areaId}:`, error);
				});
			}
		}
	}

	/**
	 * The areas across the seams of the areas players are in, and across theirs, which hold the corners
	 *
	 * @return Their IDs
	 */
	private seamAreaIds(): Set<string>
	{
		const found = new Set<string>();

		for (const areaId of this.playerIdsByArea.keys())
		{
			const area = this.areas.get(areaId);

			if (!area?.seams)
			{
				continue;
			}

			for (const sideId of Object.values(area.loaded.sides))
			{
				if (sideId === null)
				{
					continue;
				}

				found.add(sideId);

				for (const cornerId of Object.values(this.areas.get(sideId)?.loaded.sides ?? {}))
				{
					if (cornerId !== null)
					{
						found.add(cornerId);
					}
				}
			}
		}

		return(found);
	}

	/**
	 * The cells of the areas across an area's seams within a distance of one of its cells
	 *
	 * @param area The area
	 * @param cell The cell
	 * @param radius How many cells either side to reach
	 * @return The cells of each area within reach, in its own columns and rows
	 */
	private windowsNear(area: ActiveArea, cell: Cell, radius: number): AreaCellWindow[]
	{
		const areaId = area.loaded.area.id;

		return(windowsAcrossSeams((id) => ((id === areaId) ? { id, bounds: area.loaded.bounds, sides: area.loaded.sides } : this.areas.seamArea(id)), this.areas.slots(areaId), areaId, cell.column, cell.row, radius));
	}

	/**
	 * Brings a change the world editor has made to the players it affects, if this room has the area
	 * loaded or is loading it. A changed area nobody is in or on their way to is forgotten, to be read
	 * when it is next needed
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
		else if ((change.kind === 'tiles') || (change.kind === 'time'))
		{
			const inUse = this.areasInUse();

			// Which universe an area still loading is in isn't known yet, so every load under way reads again
			this.areas.noteChange();
			const areaIds = this.areas.all()
				.map((area) => area.loaded.area)
				.filter((area) => (area.universeId === change.universeId))
				.map((area) => area.id);

			await Promise.all(areaIds.map((areaId) => this.applyAreaChange(areaId, true, inUse)));
		}
		else if ((change.kind === 'area') || (change.kind === 'deleted'))
		{
			await this.applyAreaChange(change.areaId, false, this.areasInUse());
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

		for (const [playerId, neighbors] of this.sentNeighbors)
		{
			const sent = neighbors.get(areaId);
			const resend = changed.filter((key) => (sent?.has(key) ?? false));

			if (sent && (resend.length > 0))
			{
				this.sendChunks(playerId, area, resend, sent);
			}
		}
	}

	/**
	 * Reads an area again after its settings, bounds, links or tiles changed. Players its new bounds no
	 * longer hold are moved onto the nearest free cell inside them, and everyone in it is sent the area
	 * again. Players in an area that has been deleted, or has left the room's side of the lobby region's
	 * edge, go to the fallback place
	 *
	 * @param areaId The area's ID
	 * @param keepChunks Whether only the tiles changed, so the loaded chunks are still right
	 * @param inUse Whether an area is one players are in or on their way to; one that isn't is forgotten
	 * rather than read again
	 */
	private async applyAreaChange(areaId: string, keepChunks: boolean, inUse: (areaId: string) => boolean): Promise<void>
	{
		if (!this.areas.get(areaId))
		{
			// A load of the area under way reads it again
			this.areas.noteChange(areaId);
			return;
		}

		if (!inUse(areaId))
		{
			this.areas.forget(areaId);
			return;
		}

		const area = await this.areas.reload(areaId, keepChunks);
		const playerIds = this.playersIn(areaId).filter((playerId) => !this.travelling.has(playerId));

		// The players who see it across a seam are sent their own area again, with the areas around it as
		// they now are: one disabled or deleted is an edge, drawn as nothing
		for (const [playerId, neighbors] of this.sentNeighbors)
		{
			const playerArea = this.areaOf(playerId);

			if (neighbors.has(areaId) && playerArea && (playerArea.loaded.area.id !== areaId) && !this.travelling.has(playerId))
			{
				this.sendArea(playerId, playerArea, this.getClients(playerId));
			}
		}

		if (!area || (area.loaded.area.lobby !== this.side.lobby))
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

		await this.areas.loadChunks(areaId, chunksNear([...targets.values()], CHUNK_LOAD_RADIUS, chunkShapeOf(area)));

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

			// The step under way may lead outside the new bounds, so every player starts afresh from a cell center
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
	 * Sends everyone in an area to a cell of another, for an area that has been disabled. They arrive on
	 * the free cell nearest it, even when that area is disabled too, so nobody is left behind
	 *
	 * @param areaId The area they leave
	 * @param target Where they go
	 */
	evacuate(areaId: string, target: { areaId: string; column: number; row: number }): void
	{
		for (const playerId of this.playersIn(areaId).filter((each) => !this.travelling.has(each)))
		{
			this.travel(playerId, {
				column: 0,
				row: 0,
				targetAreaId: target.areaId,
				targetColumn: target.column,
				targetRow: target.row,
				mode: 'automatic',
				requiresWholeGroup: false
			}, true);
		}
	}

	/**
	 * Sends players to the fallback place, for when their area has been deleted or has left the room's
	 * side of the lobby region's edge
	 *
	 * @param playerIds The players
	 */
	private sendToFallback(playerIds: string[]): void
	{
		const fallback = this.side.fallback();

		if (fallback === undefined)
		{
			return;
		}

		for (const playerId of playerIds)
		{
			this.travel(playerId, {
				column: 0,
				row: 0,
				targetAreaId: fallback.areaId,
				targetColumn: fallback.column,
				targetRow: fallback.row,
				mode: 'automatic',
				requiresWholeGroup: false
			});
		}
	}

	/**
	 * Sends a player through a link they stand on. A link that requires the whole group sends every
	 * member of the group with them, or nobody while the group isn't together. A link nobody can go
	 * through, to a disabled area or across the lobby region's edge, takes nobody
	 *
	 * @param playerId The player's ID
	 * @param link The link
	 * @param area The area the link is in
	 */
	private takeLinkFrom(playerId: string, link: AreaLink, area: ActiveArea): void
	{
		if (area.loaded.closedTargetIds.has(link.targetAreaId))
		{
			return;
		}

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
	 * @param intoDisabled Whether they may arrive in a disabled area, as when they are sent out of one
	 */
	private travel(playerId: string, link: AreaLink, intoDisabled = false): void
	{
		const targetCell = { column: link.targetColumn, row: link.targetRow };

		this.travelling.set(playerId, link.targetAreaId);
		this.heldDirections.delete(playerId);
		this.presses.delete(playerId);
		this.steps.delete(playerId);
		this.moveInputs.remove(playerId);

		this.areas.load(link.targetAreaId)
			.then(async (target) =>
			{
				if (target)
				{
					await this.loadAround(target, targetCell);
				}

				this.arrive(playerId, link, this.areas.get(link.targetAreaId), intoDisabled);
			})
			.catch((error: unknown) =>
			{
				console.error(`Player ${playerId} could not take a link to area ${link.targetAreaId}:`, error);
				this.travelling.delete(playerId);
			});
	}

	/**
	 * Moves a travelling player into the area their link leads to, on the free cell nearest its target.
	 * Nobody arrives in an area across the lobby region's edge from the room's side
	 *
	 * @param playerId The player's ID
	 * @param link The link they took
	 * @param target The link's area, or undefined when it doesn't exist
	 * @param intoDisabled Whether they may arrive in it while it is disabled
	 */
	private arrive(playerId: string, link: AreaLink, target: ActiveArea | undefined, intoDisabled: boolean): void
	{
		// The player may have left the room while the area loaded
		if (!this.travelling.delete(playerId))
		{
			return;
		}

		const player = this.players.get(playerId);

		if (!player || !target || (!target.loaded.area.enabled && !intoDisabled) || (target.loaded.area.lobby !== this.side.lobby))
		{
			return;
		}

		const position = this.findArrivalCell(playerId, target, { column: link.targetColumn, row: link.targetRow });

		if (!position)
		{
			return;
		}

		this.putInArea(playerId, target.loaded.area.id);
		player.x = position.x;
		player.y = position.y;
		this.refreshViews();
		this.sendArea(playerId, target, this.getClients(playerId));
	}

	/**
	 * Sends a player's clients an area, with the loaded chunks near the player, and remembers those as
	 * sent. It follows the next state patch, so the window draws the area around where the player is in it
	 *
	 * @param playerId The player's ID
	 * @param area The area they are in
	 * @param clients The clients to send it to
	 * @param atOnce Whether to send it at once rather than after the next state patch: only to a client
	 * that has just joined, which has nothing about the area waiting to be sent and waits for the area
	 * before listening for the messages the room sends after it, such as the chat history
	 */
	private sendArea(playerId: string, area: ActiveArea, clients: Client[], atOnce = false): void
	{
		const near = this.loadedChunksNear(playerId, area);
		const payload = toAreaPayload(area, near, this.vision.memory);

		this.sentChunks.set(playerId, new Set(near));
		this.sentNeighbors.set(playerId, new Map());

		for (const client of clients)
		{
			client.send(ServerMessageType.Area, payload, (atOnce ? undefined : AREA_MESSAGE_OPTIONS));
		}

		this.sendNearbyNeighbors(playerId, area, clients, atOnce);
	}

	/**
	 * Sends a player the loaded chunks near them they haven't been sent, of their area and of the areas
	 * across its seams, and forgets having sent the ones they have moved away from, so those are sent again
	 * (with any changes) when the player comes back
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

		const kept = chunksNear([cell], CHUNK_KEEP_RADIUS, chunkShapeOf(area));

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

		if (area.seams)
		{
			this.sendNearbyNeighbors(playerId, area, this.getClients(playerId), false);
		}
	}

	/**
	 * Sends a player the areas across their area's seams near them that they haven't been sent, with their
	 * loaded chunks near the player, and the chunks near them of those already sent, forgetting having sent
	 * the ones they have moved away from
	 *
	 * @param playerId The player's ID
	 * @param area The area they are in
	 * @param clients The clients to send them to
	 * @param atOnce Whether to send new areas at once, as with the area itself (see sendArea)
	 */
	private sendNearbyNeighbors(playerId: string, area: ActiveArea, clients: Client[], atOnce: boolean): void
	{
		const cell = this.cellOf(playerId, area);
		const neighbors = this.sentNeighbors.get(playerId);

		if (!area.seams || !cell || !neighbors)
		{
			return;
		}

		const kept = new Map<string, Set<string>>();

		for (const window of this.windowsNear(area, cell, CHUNK_KEEP_RADIUS))
		{
			kept.set(window.areaId, new Set([...(kept.get(window.areaId) ?? []), ...chunksIn(window.bounds)]));
		}

		for (const [neighborId, sent] of neighbors)
		{
			for (const key of [...sent])
			{
				if (!(kept.get(neighborId)?.has(key) ?? false))
				{
					sent.delete(key);
				}
			}
		}

		const fresh = new Map<string, Set<string>>();

		for (const window of this.windowsNear(area, cell, CHUNK_LOAD_RADIUS))
		{
			const neighbor = this.areas.get(window.areaId);

			if (!neighbor)
			{
				continue;
			}

			const keys = (fresh.get(window.areaId) ?? new Set<string>());

			for (const key of chunksIn(window.bounds))
			{
				if (neighbor.loadedChunks.has(key) && !(neighbors.get(window.areaId)?.has(key) ?? false))
				{
					keys.add(key);
				}
			}

			fresh.set(window.areaId, keys);
		}

		const added: AreaPayload[] = [];

		for (const [neighborId, keys] of fresh)
		{
			const neighbor = this.areas.get(neighborId);

			if (!neighbor)
			{
				continue;
			}

			if (!neighbors.has(neighborId))
			{
				neighbors.set(neighborId, new Set(keys));
				added.push(toAreaPayload(neighbor, keys, this.vision.memory));
			}
			else if (keys.size > 0)
			{
				this.sendChunks(playerId, neighbor, [...keys], neighbors.get(neighborId));
			}
		}

		if (added.length > 0)
		{
			const payload: NeighborAreasPayload = {
				areaId: area.loaded.area.id,
				areas: added
			};

			for (const client of clients)
			{
				client.send(ServerMessageType.NeighborAreas, payload, (atOnce ? undefined : AREA_MESSAGE_OPTIONS));
			}
		}
	}

	/**
	 * Sends a player's clients some loaded chunks of their area, and remembers them as sent
	 *
	 * @param playerId The player's ID
	 * @param area The area the chunks are of: theirs, or one across its seams
	 * @param chunkKeys The chunks, by chunkKey()
	 * @param sentOf The chunks of the area the player has been sent, which this adds to; their own area's
	 * by default
	 */
	private sendChunks(playerId: string, area: ActiveArea, chunkKeys: string[], sentOf?: Set<string>): void
	{
		const sent = (sentOf ?? this.sentChunks.get(playerId) ?? new Set<string>());
		const payload: ChunksPayload = {
			areaId: area.loaded.area.id,
			chunks: toChunkUpdates(area, chunkKeys, this.vision.memory)
		};

		for (const key of chunkKeys)
		{
			sent.add(key);
		}

		if (sentOf === undefined)
		{
			this.sentChunks.set(playerId, sent);
		}

		for (const client of this.getClients(playerId))
		{
			client.send(ServerMessageType.Chunks, payload, AREA_MESSAGE_OPTIONS);
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

		return([...chunksNear([cell], CHUNK_LOAD_RADIUS, chunkShapeOf(area))].filter((key) => area.loadedChunks.has(key)));
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
	 * @param occupancy The cells the room's players hold, worked out from them by default
	 * @return The cell's center, or undefined when there is no free cell that near
	 */
	private findArrivalCell(playerId: string, area: ActiveArea, near: Cell, occupancy?: AreaOccupancy): Position | undefined
	{
		const { minColumn, minRow, maxColumn, maxRow } = area.grid.bounds;
		const searchDistance = Math.min(Math.max(maxColumn - minColumn, maxRow - minRow) + 1, CHUNK_LOAD_RADIUS);
		const isCellFree = (this.isGhost(playerId) ? anyCell : this.isFreeIn((occupancy ?? this.occupancyOf(playerId)), playerId, area));

		return(findFreeCell(near, area.grid, isCellFree, searchDistance));
	}

	/**
	 * Works out which cells the room's players hold right now, each in the area it is in, across seams
	 * included; ghosts hold none
	 *
	 * A cell has one holder, so a player standing where another is (such as a ghost becoming visible)
	 * would hide the other's hold on it. Leaving that player out keeps the other's
	 *
	 * @param exceptPlayerId A player whose cells to leave out
	 * @return The occupancy
	 */
	private occupancyOf(exceptPlayerId?: string): AreaOccupancy
	{
		const occupancy = new AreaOccupancy();

		for (const [playerId, player] of this.players)
		{
			const area = this.areaOf(playerId);

			if (area && !player.ghost && (playerId !== exceptPlayerId))
			{
				occupancy.hold(
					playerId,
					this.placedCells(area, occupiedCells(
						{
							x: player.x,
							y: player.y,
							step: this.steps.get(playerId)
						},
						area.grid
					))
				);
			}
		}

		return(occupancy);
	}

	/**
	 * Cells of an area, each placed in the area it is in: itself, or across a seam
	 *
	 * @param area The area
	 * @param cells The cells, in its columns and rows
	 * @return The cells, leaving out those past an edge
	 */
	private placedCells(area: ActiveArea, cells: readonly Cell[]): PlacedCell[]
	{
		return(cells
			.map((cell) => this.areas.locate(area.loaded.area.id, cell.column, cell.row))
			.filter((cell) => (cell !== undefined)));
	}

	/**
	 * Checks cells of an area from one player's point of view, across seams too
	 *
	 * @param occupancy The cells the room's players hold
	 * @param playerId The player's ID, whose own cells count as free
	 * @param area The area the cells are counted in
	 * @return A check for stepOnGrid and findFreeCell
	 */
	private isFreeIn(occupancy: AreaOccupancy, playerId: string, area: ActiveArea): IsCellFree
	{
		const areaId = area.loaded.area.id;

		return((cell) =>
		{
			const found = this.areas.locate(areaId, cell.column, cell.row);

			return((found === undefined) || occupancy.isFree(playerId, found));
		});
	}

	/**
	 * Shows every client the players its player sees, and only them
	 *
	 * Runs every tick, and immediately when players come, go, change area or stop being a ghost, or once
	 * refreshingViewsOnce() finishes when it holds the refresh
	 */
	private refreshViews(): void
	{
		if (this.viewsHeld)
		{
			this.viewsStale = true;
			return;
		}

		const seenByPlayer = new Map<string, Set<string>>();
		const nowMilliseconds = Date.now();

		for (const [sessionId, client] of this.clients)
		{
			const playerId = this.sessions.getPlayerId(sessionId);

			if (playerId === undefined)
			{
				continue;
			}

			let seen = seenByPlayer.get(playerId);

			if (!seen)
			{
				seen = this.seenBy(playerId, nowMilliseconds);
				seenByPlayer.set(playerId, seen);
			}

			this.showOnly(client, seen);
		}
	}

	/**
	 * Makes a client's view hold some players and no others
	 *
	 * Players who stay in view aren't removed and added again, which would make the client redraw them,
	 * and a player the view doesn't hold isn't removed, which would still send the client a removal. Only
	 * the players the view held and those it is to hold are looked at, not every player in the room
	 *
	 * @param client The client
	 * @param playerIds The players it sees, which nothing changes afterward, so the view can keep them as
	 * the players it holds
	 */
	private showOnly(client: Client, playerIds: ReadonlySet<string>): void
	{
		if (!client.view)
		{
			client.view = new StateView();
		}

		const view = client.view;
		const shown = this.shownIn.get(view);

		for (const playerId of (shown ?? []))
		{
			const player = this.players.get(playerId);

			if (player && !playerIds.has(playerId))
			{
				view.remove(player);
			}
		}

		for (const playerId of playerIds)
		{
			const player = this.players.get(playerId);

			if (player && !(shown?.has(playerId) ?? false))
			{
				view.add(player);
			}
		}

		this.shownIn.set(view, playerIds);
	}

	/**
	 * The players a player sees: themselves, and those near them who aren't ghosts and are in sight of
	 * them or, in a room whose vision is shared, are members of the group or in sight of one there. In an
	 * area without fog of war, everyone there who isn't a ghost. Players across a seam from their area count
	 * as near: seen without fog of war when neither area has it, and otherwise when in sight
	 *
	 * @param playerId The player's ID
	 * @param nowMilliseconds The real time, for areas whose time of day follows it
	 * @return Their IDs
	 */
	private seenBy(playerId: string, nowMilliseconds: number): Set<string>
	{
		const seen = new Set([playerId]);
		const area = this.areaOf(playerId);

		if (!area)
		{
			return(seen);
		}

		const near = this.playersNear(area);
		const others = near.filter((other) => ((other.playerId !== playerId) && !this.isGhost(other.playerId)));

		if (!area.loaded.fogOfWar && !area.seams)
		{
			for (const other of others)
			{
				seen.add(other.playerId);
			}

			return(seen);
		}

		const viewer = near.find((each) => (each.playerId === playerId));
		const lookers = [...(viewer ? [viewer] : []), ...(this.vision.shared ? others : [])];
		const lookerIds = new Set(lookers.map((looker) => looker.playerId));
		const sights = lookers
			.map((looker) =>
			{
				const sight = this.sightOf(looker.playerId, looker.area, nowMilliseconds);

				return((sight === undefined) ? undefined : { cell: looker.cell, budget: sight.budget });
			})
			.filter((sight) => (sight !== undefined));

		for (const other of others)
		{
			const fogless = (!area.loaded.fogOfWar && !other.area.loaded.fogOfWar);

			if (lookerIds.has(other.playerId) || fogless || sights.some((sight) => canSee(sight.cell, other.cell, sight.budget, area.vision)))
			{
				seen.add(other.playerId);
			}
		}

		return(seen);
	}

	/**
	 * The players in an area and across its seams near enough to be seen, each with their cell counted in
	 * the area's columns and rows: past its edges for those across a seam
	 *
	 * @param area The area
	 * @return The players, those in the area first
	 */
	private playersNear(area: ActiveArea): { playerId: string; area: ActiveArea; cell: Cell }[]
	{
		const areaId = area.loaded.area.id;
		const near: { playerId: string; area: ActiveArea; cell: Cell }[] = [];
		const { bounds } = area.loaded;

		for (const playerId of this.playersIn(areaId))
		{
			const cell = this.cellOf(playerId, area);

			if (cell)
			{
				near.push({ playerId, area, cell });
			}
		}

		// Each player once, in the place around the area nearest it
		const across = new Map<string, { playerId: string; area: ActiveArea; cell: Cell; distance: number }>();

		for (const slot of this.areas.slots(areaId))
		{
			const other = this.areas.get(slot.areaId);

			if (!other || (slot.areaId === areaId))
			{
				continue;
			}

			for (const playerId of this.playersIn(slot.areaId))
			{
				const own = this.cellOf(playerId, other);

				if (!own)
				{
					continue;
				}

				const cell = {
					column: own.column + slot.columnOffset,
					row: own.row + slot.rowOffset
				};
				const distance = Math.max(bounds.minColumn - cell.column, cell.column - bounds.maxColumn, bounds.minRow - cell.row, cell.row - bounds.maxRow);
				const known = across.get(playerId);

				if ((distance <= CHUNK_LOAD_RADIUS) && (!known || (distance < known.distance)))
				{
					across.set(playerId, { playerId, area: other, cell, distance });
				}
			}
		}

		for (const { playerId, area: other, cell } of across.values())
		{
			near.push({ playerId, area: other, cell });
		}

		return(near);
	}

	/**
	 * Where a player looks from and how far they see
	 *
	 * @param playerId The player's ID
	 * @param area The area they are in
	 * @param nowMilliseconds The real time, for areas whose time of day follows it
	 * @return Their cell and vision budget, or undefined when they aren't in the room
	 */
	private sightOf(playerId: string, area: ActiveArea, nowMilliseconds: number): { cell: Cell; budget: number } | undefined
	{
		const player = this.players.get(playerId);
		const cell = this.cellOf(playerId, area);

		if (!player || !cell)
		{
			return(undefined);
		}

		const second = secondOfDay(area.loaded.time, this.vision.clockSeconds(), nowMilliseconds, cell, area.loaded.bounds);

		return({
			cell,
			budget: visionBudget(areaLight(area.loaded.lightLevel, second), player)
		});
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
	 * The players in an area
	 *
	 * @param areaId The area's ID
	 * @return Their IDs
	 */
	private playersIn(areaId: string | undefined): string[]
	{
		return([...(((areaId !== undefined) ? this.playerIdsByArea.get(areaId) : undefined) ?? [])]);
	}

	/**
	 * Which areas players are in or on their way to, as they are now, and those across the seams of the
	 * areas they are in
	 *
	 * @return Whether an area is one of them
	 */
	private areasInUse(): (areaId: string) => boolean
	{
		const used = new Set([...this.travelling.values(), ...this.seamAreaIds()]);

		return((areaId) => (this.playerIdsByArea.has(areaId) || used.has(areaId)));
	}

	/**
	 * Records a player as in an area, and out of any area they were in
	 *
	 * @param playerId The player's ID
	 * @param areaId The area's ID
	 */
	private putInArea(playerId: string, areaId: string): void
	{
		const player = this.players.get(playerId);

		this.takeOutOfArea(playerId);
		this.areaIds.set(playerId, areaId);

		if (player)
		{
			player.areaId = areaId;
		}

		const playerIds = this.playerIdsByArea.get(areaId);

		if (playerIds)
		{
			playerIds.add(playerId);
		}
		else
		{
			this.playerIdsByArea.set(areaId, new Set([playerId]));
		}
	}

	/**
	 * Records a player as in no area
	 *
	 * @param playerId The player's ID
	 */
	private takeOutOfArea(playerId: string): void
	{
		const areaId = this.areaIds.get(playerId);

		if (areaId === undefined)
		{
			return;
		}

		const playerIds = this.playerIdsByArea.get(areaId);

		this.areaIds.delete(playerId);
		playerIds?.delete(playerId);

		if (playerIds?.size === 0)
		{
			this.playerIdsByArea.delete(areaId);
		}
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
 * An area's shape as chunksNear needs it
 *
 * @param area The area
 * @return Its bounds and whether it loops
 */
function chunkShapeOf(area: ActiveArea): ChunkAreaShape
{
	return({
		bounds: area.loaded.bounds,
		loopsEastWest: area.loaded.loopsEastWest,
		loopsNorthSouth: area.loaded.loopsNorthSouth
	});
}
