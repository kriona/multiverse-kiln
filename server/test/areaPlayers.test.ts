import assert from 'assert';
import { LobbyState, PLAIN_SIGHT, type AreaChunk } from '@multiverse-kiln/shared';

import type { LoadedArea } from '../src/db/areaRepo.js';
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
			passageOfTime: 'flows_normally'
		},
		ruleset: 'pf1e',
		time: { passage: 'flows_normally' },
		displayTime: 'precise',
		lightLevel: null,
		fullVision: false,
		bounds: { minColumn: -100, minRow: -100, maxColumn: 99, maxRow: 99 },
		defaultTileId: 1,
		loopsEastWest: false,
		loopsNorthSouth: false,
		links: [],
		disabledTargetIds: new Set(),
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
	 * The cache's clock, in milliseconds
	 */
	time = 0;

	private readonly heldReads: (() => void)[] = [];

	private readonly heldAreaReads: (() => void)[] = [];

	readonly cache = new AreaCache(
		(areaId) =>
		{
			const loaded = loadedArea(areaId);

			loaded.area.enabled = !this.disabledAreas.has(areaId);
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

	readonly players = new AreaPlayers(new LobbyState().players, this.cache, () => undefined, {
		shared: false,
		clockSeconds: () => 0
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
	 * Puts the player in an area at its center
	 *
	 * @param areaId The area's ID
	 */
	async addPlayer(areaId: string): Promise<void>
	{
		const loaded = await this.cache.load(areaId);

		assert.ok(loaded);

		const area = await this.players.prepareStart(loaded);

		assert.ok(area);
		this.players.add(PLAYER_ID, APPEARANCE, area, { column: 0, row: 0 });
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
