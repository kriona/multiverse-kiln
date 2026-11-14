import assert from 'assert';
import { LobbyState, NO_NEIGHBORS, PLAIN_SIGHT, type AreaChunk, type AreaNeighbors, type MovePayload } from '@multiverse-kiln/shared';

import type { LoadedArea } from '../src/db/areaRepo.js';
import type { AreaLink } from '../src/logic/areaGrid.js';
import type { Cell } from '../src/logic/movement.js';
import { AREA_IDLE_MS, AreaCache } from '../src/rooms/areaCache.js';
import { AreaPlayers, type Appearance } from '../src/rooms/areaPlayers.js';

const PLAYER_ID = 'player';

const APPEARANCE: Appearance = {
	name: 'Player',
	ghost: false,
	...PLAIN_SIGHT
};

/**
 * An area 200 cells across, all grass
 *
 * @param areaId The area's ID
 * @return The area's settings
 */
function loadedArea(areaId: string): LoadedArea
{
	return({
		area: {
			id: areaId,
			universeId: 'universe',
			parentAreaId: undefined,
			name: 'Field',
			enabled: true,
			indoors: false,
			passageOfTime: 'flows_normally',
			lobby: false
		},
		ruleset: 'pf1e',
		time: { passage: 'flows_normally' },
		displayTime: 'precise',
		lightLevel: null,
		fogOfWar: true,
		bounds: { minColumn: -100, minRow: -100, maxColumn: 99, maxRow: 99 },
		defaultTileId: 1,
		loopsEastWest: false,
		loopsNorthSouth: false,
		neighbors: { ...NO_NEIGHBORS },
		sides: { ...NO_NEIGHBORS },
		links: [],
		closedTargetIds: new Set(),
		tiles: [
			{ id: 1, key: 'grass', name: 'Grass', indoors: false, outdoors: true, color: 0x00ff00, graphic: 'grass', uploadedGraphic: null, visionCost: 0, walkSeconds: 10 }
		]
	});
}

/**
 * A room's areas over a fake database that counts the areas it reads, and whose chunk reads can be
 * held until the test lets them finish
 */
class FakeRoom
{
	/**
	 * The areas read so far, by ID
	 */
	readonly areaReads: string[] = [];

	/**
	 * Whether chunk reads wait for finishReads()
	 */
	holdReads = false;

	/**
	 * Whether area reads wait for finishAreaReads(), each with the area as it was when it began
	 */
	holdAreaReads = false;

	/**
	 * The areas an editor has disabled, by ID
	 */
	readonly disabledAreas = new Set<string>();

	/**
	 * The neighbors of the areas that have them, by area ID
	 */
	readonly neighbors = new Map<string, AreaNeighbors>();

	/**
	 * Where the edges of the areas that have neighbors lead, by area ID, for those whose edges don't lead
	 * only to their neighbors, such as an area looping through its own seams
	 */
	readonly sides = new Map<string, AreaNeighbors>();

	/**
	 * The links of the areas that have them, by area ID
	 */
	readonly links = new Map<string, AreaLink[]>();

	/**
	 * Every member of the player's group, for links that require the whole group
	 */
	groupMembers: string[] = [PLAYER_ID];

	/**
	 * The players told the whole group has to be there to take a link
	 */
	readonly refused: string[] = [];

	/**
	 * The cache's clock, in milliseconds
	 */
	time = 0;

	private readonly heldReads: (() => void)[] = [];

	private readonly heldAreaReads: (() => void)[] = [];

	readonly cache = new AreaCache(
		(areaId) =>
		{
			const loaded = loadedArea(areaId);
			const neighbors = this.neighbors.get(areaId);

			loaded.area.enabled = !this.disabledAreas.has(areaId);

			if (neighbors)
			{
				loaded.neighbors = { ...neighbors };
				loaded.sides = { ...(this.sides.get(areaId) ?? neighbors) };
			}
			loaded.links = [...(this.links.get(areaId) ?? [])];
			this.areaReads.push(areaId);

			if (!this.holdAreaReads)
			{
				return(Promise.resolve(loaded));
			}

			return(new Promise((resolve) =>
			{
				this.heldAreaReads.push(() => resolve(loaded));
			}));
		},
		() => new Promise<AreaChunk[]>((resolve) =>
		{
			if (this.holdReads)
			{
				this.heldReads.push(() => resolve([]));
			}
			else
			{
				resolve([]);
			}
		}),
		() => this.time
	);

	readonly players = new AreaPlayers(new LobbyState().players, this.cache, { lobby: false, fallback: () => Promise.resolve(undefined) }, {
		shared: false,
		clockSeconds: () => 0
	}, {
		members: () => this.groupMembers,
		refuse: (playerId) =>
		{
			this.refused.push(playerId);
		}
	});

	/**
	 * Loads areas, as players passing through them would have
	 *
	 * @param areaIds The areas' IDs
	 */
	async loadAreas(...areaIds: string[]): Promise<void>
	{
		for (const areaId of areaIds)
		{
			await this.cache.load(areaId);
		}

		this.areaReads.length = 0;
	}

	/**
	 * Puts the player in an area
	 *
	 * @param areaId The area's ID
	 * @param near The cell to put them on, its center when left out
	 */
	async addPlayer(areaId: string, near: Cell = { column: 0, row: 0 }): Promise<void>
	{
		const loaded = await this.cache.load(areaId);

		assert.ok(loaded);

		const area = await this.players.prepareStart(loaded, near);

		assert.ok(area);
		this.players.add(PLAYER_ID, APPEARANCE, area, near);
	}

	/**
	 * Has the player take one step east, then runs ticks until any link they stepped onto has taken them
	 * on their way
	 */
	async stepEast(): Promise<void>
	{
		const inputs = (this.players as unknown as { moveInputs: { push: (playerId: string, move: MovePayload) => void } }).moveInputs;

		inputs.push(PLAYER_ID, { x: 1, y: 0 });
		this.players.update(1 / 30);
		inputs.push(PLAYER_ID, { x: 0, y: 0 });

		for (let tick = 0; tick < 30; tick++)
		{
			this.players.update(1 / 30);
			await settle();
		}
	}

	/**
	 * Lets every chunk read held so far finish
	 */
	finishReads(): void
	{
		for (const finish of this.heldReads.splice(0))
		{
			finish();
		}
	}

	/**
	 * Lets the area reads held finish, and any they lead to, until none are left
	 */
	async finishAreaReads(): Promise<void>
	{
		while (this.heldAreaReads.length > 0)
		{
			for (const finish of this.heldAreaReads.splice(0))
			{
				finish();
			}

			await settle();
		}
	}
}

/**
 * Waits for the promises under way to settle
 */
async function settle(): Promise<void>
{
	await new Promise((resolve) => setImmediate(resolve));
}

describe('AreaPlayers', () =>
{
	it('reads again only the areas players are in when the universe\'s tiles change, and forgets the rest', async () =>
	{
		const room = new FakeRoom();

		await room.loadAreas('home', 'left1', 'left2');
		await room.addPlayer('home');

		await room.players.applyChange({ kind: 'tiles', universeId: 'universe' });

		assert.deepStrictEqual(room.areaReads, ['home']);
		assert.ok(room.cache.get('home'));
		assert.strictEqual(room.cache.get('left1'), undefined);
		assert.strictEqual(room.cache.get('left2'), undefined);
	});

	it('forgets idle areas while keeping the ones players are in or on their way to', async () =>
	{
		const room = new FakeRoom();

		await room.loadAreas('home', 'away', 'left');
		await room.addPlayer('home');

		room.holdReads = true;
		room.players.evacuate('home', { areaId: 'away', column: 0, row: 0 });
		await settle();

		room.time = AREA_IDLE_MS;
		room.players.refreshChunks();

		assert.ok(room.cache.get('home'));
		assert.ok(room.cache.get('away'));
		assert.strictEqual(room.cache.get('left'), undefined);

		room.finishReads();
		await settle();

		assert.strictEqual(room.players.getAreaId(PLAYER_ID), 'away');
	});

	describe('starting near the corner of four areas', () =>
	{
		/**
		 * A room whose areas are a 2 x 2 grid: home and east on top, south below home, and corner below east
		 *
		 * @return The room
		 */
		function gridRoom(): FakeRoom
		{
			const room = new FakeRoom();

			room.neighbors.set('home', { ...NO_NEIGHBORS, east: 'east', south: 'south' });
			room.neighbors.set('east', { ...NO_NEIGHBORS, west: 'home', south: 'corner' });
			room.neighbors.set('south', { ...NO_NEIGHBORS, north: 'home', east: 'corner' });
			room.neighbors.set('corner', { ...NO_NEIGHBORS, north: 'east', west: 'south' });

			return(room);
		}

		it('loads the three areas around the corner, and their chunks near it, before the player is placed', async () =>
		{
			const room = gridRoom();
			const home = await room.cache.load('home');

			assert.ok(home);
			assert.ok(await room.players.prepareStart(home, { column: 99, row: 99 }));

			for (const areaId of ['east', 'south', 'corner'])
			{
				assert.ok(((room.cache.get(areaId)?.loadedChunks.size ?? 0) > 0), areaId);
			}
		});

		it('leaves the areas around it for later when the player starts far from its edges', async () =>
		{
			const room = gridRoom();
			const home = await room.cache.load('home');

			assert.ok(home);
			assert.ok(await room.players.prepareStart(home, { column: 0, row: 0 }));
			assert.deepStrictEqual(room.areaReads, ['home']);
		});
	});

	describe('stepping across a seam onto a link', () =>
	{
		/**
		 * A link to the center of the area cave
		 *
		 * @param cell The cell holding it
		 * @param changes How it differs from an automatic link that doesn't require the whole group
		 * @return The link
		 */
		function caveLink(cell: Cell, changes: Partial<AreaLink> = {}): AreaLink
		{
			return({
				...cell,
				targetAreaId: 'cave',
				targetColumn: 0,
				targetRow: 0,
				mode: 'automatic',
				requiresWholeGroup: false,
				...changes
			});
		}

		/**
		 * A room whose area home has the area east to its east, with the player on home's east edge
		 *
		 * @param eastLinks The links of east
		 * @return The room
		 */
		async function seamRoom(eastLinks: AreaLink[]): Promise<FakeRoom>
		{
			const room = new FakeRoom();

			room.neighbors.set('home', { ...NO_NEIGHBORS, east: 'east' });
			room.neighbors.set('east', { ...NO_NEIGHBORS, west: 'home' });
			room.links.set('east', eastLinks);
			await room.addPlayer('home', { column: 99, row: 3 });

			return(room);
		}

		it('takes an automatic link on the neighbor\'s cell the step lands on', async () =>
		{
			const room = await seamRoom([caveLink({ column: -100, row: 3 })]);

			await room.stepEast();

			assert.strictEqual(room.players.getAreaId(PLAYER_ID), 'cave');
		});

		it('leaves a manual link on the neighbor\'s cell for the player to take', async () =>
		{
			const room = await seamRoom([caveLink({ column: -100, row: 3 }, { mode: 'manual' })]);

			await room.stepEast();

			assert.deepStrictEqual(room.players.getPosition(PLAYER_ID), { areaId: 'east', column: -100, row: 3 });
		});

		it('takes a link requiring the whole group there when the group is together in the neighbor', async () =>
		{
			const room = await seamRoom([caveLink({ column: -100, row: 3 }, { requiresWholeGroup: true })]);

			await room.stepEast();

			assert.strictEqual(room.players.getAreaId(PLAYER_ID), 'cave');
			assert.deepStrictEqual(room.refused, []);
		});

		it('refuses a link requiring the whole group there while the group isn\'t together', async () =>
		{
			const room = await seamRoom([caveLink({ column: -100, row: 3 }, { requiresWholeGroup: true })]);

			room.groupMembers = [PLAYER_ID, 'absent'];
			await room.stepEast();

			assert.strictEqual(room.players.getAreaId(PLAYER_ID), 'east');
			assert.deepStrictEqual(room.refused, [PLAYER_ID]);
		});

		it('takes an automatic link on the cell a step through an area\'s seam back onto itself lands on', async () =>
		{
			const room = new FakeRoom();

			room.neighbors.set('home', { ...NO_NEIGHBORS, north: 'north' });
			room.neighbors.set('north', { ...NO_NEIGHBORS, south: 'home' });
			room.sides.set('home', { ...NO_NEIGHBORS, north: 'north', east: 'home', west: 'home' });
			room.links.set('home', [caveLink({ column: -100, row: 3 })]);
			await room.addPlayer('home', { column: 99, row: 3 });

			await room.stepEast();

			assert.strictEqual(room.players.getAreaId(PLAYER_ID), 'cave');
		});
	});

	for (const change of [{ kind: 'area', areaId: 'away' }, { kind: 'tiles', universeId: 'universe' }] as const)
	{
		it(`keeps an area as the change left it when '${change.kind}' changes arrive while it loads`, async () =>
		{
			const room = new FakeRoom();

			room.holdAreaReads = true;

			const loading = room.cache.load('away');

			room.disabledAreas.add('away');

			const applying = room.players.applyChange(change);

			await room.finishAreaReads();
			await applying;

			assert.strictEqual((await loading)?.loaded.area.enabled, false);
			assert.strictEqual(room.cache.get('away')?.loaded.area.enabled, false);
		});
	}
});
