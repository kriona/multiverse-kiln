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
			passageOfTime: 'inherit'
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
	 * The cache's clock, in milliseconds
	 */
	time = 0;

	private readonly heldReads: (() => void)[] = [];

	readonly cache = new AreaCache(
		(areaId) =>
		{
			this.areaReads.push(areaId);
			return(Promise.resolve(loadedArea(areaId)));
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
});
