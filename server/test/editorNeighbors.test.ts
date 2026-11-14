import assert from 'assert';
import { NO_NEIGHBORS, type AreaBounds, type AreaListPayload, type AreaNeighbors, type EditorChange, type PlaceProblem } from '@multiverse-kiln/shared';

import { findEditorArea, listAreas } from '../src/db/areaRepo.js';
import { findDefaultTileIds } from '../src/db/tileRepo.js';
import { setUniverseRole } from '../src/db/universeEditorRepo.js';
import { draftVersion } from '../src/db/universeVersions.js';
import { areaChanges, type AreaChange } from '../src/world/areaChanges.js';
import { assignToWorld, createArea, createUniverse, logIn, saveAll, saveChanges, send, worldRegionId, type Editor } from './editorRequests.js';
import { getTestServer } from './testServer.js';

/**
 * 32 x 32 cells, the smallest area that can have neighbors
 */
const SQUARE: AreaBounds = { minColumn: -16, minRow: -16, maxColumn: 15, maxRow: 15 };

describe('Neighboring areas in the world editor', () =>
{
	let ada: Editor;
	let universeId: string;

	before(async () =>
	{
		await getTestServer();
	});

	beforeEach(async () =>
	{
		ada = await logIn('Ada');
		universeId = await createUniverse(ada);
	});

	/**
	 * Adds an area 32 x 32 cells, the smallest that can have neighbors
	 *
	 * @param name Its name
	 * @param settings Its settings, in the World region unless its parents are given
	 * @return Its ID
	 */
	async function addSquare(name: string, settings: Record<string, unknown> = {}): Promise<string>
	{
		const areaId = await createArea(ada, universeId, { name, ...settings });

		await saveAll(ada, universeId, [{ kind: 'resizeArea', areaId, bounds: SQUARE, discard: false }]);

		return(areaId);
	}

	/**
	 * An area's neighbors as saved
	 *
	 * @param areaId The area's ID
	 * @return Its neighbors
	 */
	async function neighborsOf(areaId: string): Promise<AreaNeighbors | undefined>
	{
		return((await findEditorArea(areaId))?.area.neighbors);
	}

	/**
	 * Saving changes that must be refused for the grid of neighbors
	 *
	 * @param changes The changes
	 * @param errorId The refusal's message, the grid's own unless given
	 * @return The problems the refusal names
	 */
	async function refusal(changes: EditorChange[], errorId: string = 'error.neighborProblems'): Promise<PlaceProblem[]>
	{
		const answer = await saveChanges(ada, universeId, changes);

		assert.strictEqual(answer.status, 409, JSON.stringify(answer.body));
		assert.strictEqual(answer.body.error.id, errorId);

		return(answer.body.placeProblems ?? []);
	}

	it('sets a neighbor both ways, takes the place of one before it, and removes it', async () =>
	{
		const town = await addSquare('Town');
		const forest = await addSquare('Forest');
		const plains = await addSquare('Plains');

		await saveAll(ada, universeId, [{ kind: 'setNeighbor', areaId: town, side: 'east', neighborId: forest }]);

		assert.deepStrictEqual(await neighborsOf(town), { ...NO_NEIGHBORS, east: forest });
		assert.deepStrictEqual(await neighborsOf(forest), { ...NO_NEIGHBORS, west: town });

		// Plains takes Forest's place east of Town, and Forest is left with none
		await saveAll(ada, universeId, [{ kind: 'setNeighbor', areaId: plains, side: 'west', neighborId: town }]);

		assert.deepStrictEqual(await neighborsOf(town), { ...NO_NEIGHBORS, east: plains });
		assert.deepStrictEqual(await neighborsOf(forest), NO_NEIGHBORS);

		await saveAll(ada, universeId, [{ kind: 'setNeighbor', areaId: town, side: 'east', neighborId: null }]);

		assert.deepStrictEqual(await neighborsOf(town), NO_NEIGHBORS);
		assert.deepStrictEqual(await neighborsOf(plains), NO_NEIGHBORS);
	});

	it('lists neighbors with the areas, and on the Audit tab', async () =>
	{
		const town = await addSquare('Town');
		const forest = await addSquare('Forest');

		await saveAll(ada, universeId, [{ kind: 'setNeighbor', areaId: town, side: 'south', neighborId: forest }]);

		const list = (await send<AreaListPayload>(ada, 'GET', `/${universeId}/areas`)).body;
		const edits = (await send<{ edits: { details: { fields: { field: string; value: unknown }[] }[] }[] }>(ada, 'GET', `/${universeId}/audit`)).body;

		assert.deepStrictEqual(list.areas.find((area) => (area.id === town))?.neighbors, { ...NO_NEIGHBORS, south: forest });
		assert.deepStrictEqual(edits.edits[0].details[0].fields, [{ field: 'neighbor', value: { side: 'south', area: 'Forest' } }]);
	});

	it('accepts a ring, and a 2 x 2 grid set in one save', async () =>
	{
		const [town, forest, plains] = [await addSquare('Town'), await addSquare('Forest'), await addSquare('Plains')];

		await saveAll(ada, universeId, [
			{ kind: 'setNeighbor', areaId: town, side: 'east', neighborId: forest },
			{ kind: 'setNeighbor', areaId: forest, side: 'east', neighborId: plains },
			{ kind: 'setNeighbor', areaId: plains, side: 'east', neighborId: town }
		]);

		assert.deepStrictEqual(await neighborsOf(town), { ...NO_NEIGHBORS, east: forest, west: plains });

		const [north, northEast, south, southEast] = [await addSquare('North'), await addSquare('North East'), await addSquare('South'), await addSquare('South East')];

		await saveAll(ada, universeId, [
			{ kind: 'setNeighbor', areaId: north, side: 'east', neighborId: northEast },
			{ kind: 'setNeighbor', areaId: north, side: 'south', neighborId: south },
			{ kind: 'setNeighbor', areaId: south, side: 'east', neighborId: southEast },
			{ kind: 'setNeighbor', areaId: northEast, side: 'south', neighborId: southEast }
		]);

		assert.deepStrictEqual(await neighborsOf(southEast), { ...NO_NEIGHBORS, north: northEast, west: south });
	});

	it('refuses touching sides of different lengths, unless a resize carries the row along', async () =>
	{
		const town = await addSquare('Town');
		const forest = await addSquare('Forest');
		const taller: AreaBounds = { ...SQUARE, minRow: SQUARE.minRow - 8 };

		await saveAll(ada, universeId, [{ kind: 'setNeighbor', areaId: town, side: 'east', neighborId: forest }]);

		assert.deepStrictEqual(await refusal([{ kind: 'resizeArea', areaId: town, bounds: taller, discard: false }]), [
			{ kind: 'neighborSides', areaId: town, side: 'east', neighborAreaId: forest }
		]);

		await saveAll(ada, universeId, [
			{ kind: 'resizeArea', areaId: town, bounds: taller, discard: false },
			{ kind: 'resizeArea', areaId: forest, bounds: taller, discard: true }
		]);

		assert.deepStrictEqual((await findEditorArea(forest))?.area.bounds, taller);
	});

	it('refuses an inconsistent grid', async () =>
	{
		const [town, hills, fields, peaks, woods] = [await addSquare('Town'), await addSquare('Hills'), await addSquare('Fields'), await addSquare('Peaks'), await addSquare('Woods')];

		assert.deepStrictEqual(await refusal([
			{ kind: 'setNeighbor', areaId: town, side: 'north', neighborId: hills },
			{ kind: 'setNeighbor', areaId: town, side: 'west', neighborId: fields },
			{ kind: 'setNeighbor', areaId: hills, side: 'west', neighborId: peaks },
			{ kind: 'setNeighbor', areaId: fields, side: 'north', neighborId: woods }
		]), [
			{ kind: 'neighborGrid', areaId: town, first: 'north', second: 'west', firstReached: peaks, secondReached: woods }
		]);
	});

	it('refuses an area under 32 x 32 a neighbor, and making one with neighbors smaller', async () =>
	{
		const town = await addSquare('Town');
		const meadow = await createArea(ada, universeId, { name: 'Meadow' });

		// The areas are checked in the order the database lists them
		const tooSmall = await refusal([{ kind: 'setNeighbor', areaId: town, side: 'east', neighborId: meadow }]);

		assert.deepStrictEqual(tooSmall.toSorted((first, second) => first.kind.localeCompare(second.kind)), [
			{ kind: 'neighborSides', areaId: town, side: 'east', neighborAreaId: meadow },
			{ kind: 'neighborTooSmall', areaId: meadow }
		]);

		const forest = await addSquare('Forest');

		await saveAll(ada, universeId, [{ kind: 'setNeighbor', areaId: town, side: 'east', neighborId: forest }]);

		const smaller: AreaBounds = { ...SQUARE, maxColumn: 10 };
		const problems = await refusal([{ kind: 'resizeArea', areaId: forest, bounds: smaller, discard: false }]);

		assert.deepStrictEqual(problems, [{ kind: 'neighborTooSmall', areaId: forest }]);
	});

	it('refuses an area as its own neighbor', async () =>
	{
		const town = await addSquare('Town');
		const answer = await saveChanges(ada, universeId, [{ kind: 'setNeighbor', areaId: town, side: 'east', neighborId: town }]);

		assert.strictEqual(answer.status, 400, JSON.stringify(answer.body));
		assert.strictEqual(answer.body.error.id, 'error.ownNeighbor');
	});

	it('refuses a neighbor across the lobby region\'s edge, either way', async () =>
	{
		const list = (await send<AreaListPayload>(ada, 'GET', `/${universeId}/areas`)).body;
		const lobbyRegion = list.lobbyRegionId;

		assert.ok(lobbyRegion);

		const square = await addSquare('Square', { parents: [{ kind: 'region', id: lobbyRegion }] });
		const town = await addSquare('Town');

		assert.deepStrictEqual(await refusal([{ kind: 'setNeighbor', areaId: square, side: 'east', neighborId: town }], 'error.lobbyProblems'), [
			{ kind: 'lobbyNeighbor', areaId: square, targetAreaId: town }
		]);
		assert.deepStrictEqual(await refusal([{ kind: 'setNeighbor', areaId: square, side: 'north', neighborId: town }], 'error.lobbyProblems'), [
			{ kind: 'lobbyNeighbor', areaId: town, targetAreaId: square }
		]);
	});

	it('refuses a builder a neighbor outside their assignments', async () =>
	{
		const bea = await logIn('Bea');
		const town = await addSquare('Town');
		const forest = await addSquare('Forest');

		// Assigned before the other top-level region is added, which assignToWorld() could take for World
		await setUniverseRole(universeId, bea.playerId, 'builder');
		await assignToWorld(ada, universeId, [bea.playerId]);

		const grass = (await findDefaultTileIds('pf1e')).get('grass') ?? null;
		const ids = await saveAll(ada, universeId, [{ kind: 'createRegion', ref: 'new:other', region: { name: 'Elsewhere', parents: [], enabled: null, indoors: false, lightLevel: null, defaultTileId: grass, passageOfTime: 'flows_normally', faerieMorning: null, fogOfWar: true } }]);
		const elsewhere = await addSquare('Far Away', { parents: [{ kind: 'region', id: ids['new:other'] }] });

		const outside = await saveChanges(bea, universeId, [{ kind: 'setNeighbor', areaId: town, side: 'east', neighborId: elsewhere }]);

		assert.strictEqual(outside.status, 403, JSON.stringify(outside.body));
		assert.strictEqual(outside.body.error.id, 'error.outsideAssignments');

		const within = await saveChanges(bea, universeId, [{ kind: 'setNeighbor', areaId: town, side: 'east', neighborId: forest }]);

		assert.strictEqual(within.status, 200, JSON.stringify(within.body));
	});

	it('leaves an area\'s neighbors with an edge when it is deleted, telling the rooms', async () =>
	{
		const town = await addSquare('Town');
		const forest = await addSquare('Forest');
		const published: AreaChange[] = [];

		await saveAll(ada, universeId, [{ kind: 'setNeighbor', areaId: town, side: 'east', neighborId: forest }]);

		const stop = areaChanges.onChange((change) =>
		{
			published.push(change);
		});

		try
		{
			await saveAll(ada, universeId, [{ kind: 'deleteArea', areaId: forest }]);
		}
		finally
		{
			stop();
		}

		assert.deepStrictEqual(await neighborsOf(town), NO_NEIGHBORS);
		assert.ok(published.some((change) => ((change.kind === 'area') && (change.areaId === town))), JSON.stringify(published));
	});

	it('copies neighbors into the draft', async () =>
	{
		const town = await addSquare('Town');
		const forest = await addSquare('Forest');

		await saveAll(ada, universeId, [
			{ kind: 'setNeighbor', areaId: town, side: 'east', neighborId: forest },
			{ kind: 'startDraft' }
		]);

		const draft = await listAreas(draftVersion(universeId));
		const draftTown = draft.find((area) => (area.name === 'Town'));
		const draftForest = draft.find((area) => (area.name === 'Forest'));

		assert.ok(draftTown && draftForest);
		assert.deepStrictEqual(draftTown.neighbors, { ...NO_NEIGHBORS, east: draftForest.id });
		assert.deepStrictEqual(draftForest.neighbors, { ...NO_NEIGHBORS, west: draftTown.id });
		assert.ok(await worldRegionId(ada, universeId, 'draft'));
	});
});
