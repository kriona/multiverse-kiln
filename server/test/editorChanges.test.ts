import assert from 'assert';
import { randomUUID } from 'crypto';
import { NEW_PF1E_RACE_RULES, TILE_GRAPHICS_PATH, emptyMoney, type AreaLinkListPayload, type EditableUniverse, type EditorChange, type ItemListPayload, type TileGraphicListPayload, type TileListPayload, type TileSettings, type TileUsagePayload } from '@multiverse-kiln/shared';

import { setUniverseRole } from '../src/db/universeEditorRepo.js';
import { areaChanges, type AreaChange } from '../src/world/areaChanges.js';
import { createArea, createUniverse, logIn, saveAll, saveChanges, send, solidPng, type Editor } from './editorRequests.js';
import { allowedTestOrigin } from './setup.js';
import { getTestServer, testServerUrl } from './testServer.js';

const lava: TileSettings = {
	name: 'Lava',
	indoors: false,
	outdoors: true,
	color: 0xff4400,
	graphic: null,
	uploadedGraphicId: null,
	visionCost: 0,
	walkSeconds: 0,
	enabled: true
};

/**
 * A change the server always refuses: saving a race that doesn't exist
 */
const missingRace: EditorChange = {
	kind: 'saveRace',
	id: 2147483647,
	settings: {
		name: 'Nobody',
		enabled: true,
		startingMoney: emptyMoney(),
		startingItems: [],
		startingAreaId: null,
		startingColumn: 0,
		startingRow: 0,
		rules: NEW_PF1E_RACE_RULES
	}
};

/**
 * The universe's own tiles
 *
 * @param editor The browser asking
 * @param universeId The universe's ID
 * @return The tiles' names
 */
async function customTileNames(editor: Editor, universeId: string): Promise<(string | null)[]>
{
	return((await send<TileListPayload>(editor, 'GET', `/${universeId}/tiles?custom=true`)).body.tiles.map((tile) => tile.name));
}

describe('Saving editor changes', () =>
{
	let ada: Editor;

	before(async () =>
	{
		await getTestServer();
	});

	beforeEach(async () =>
	{
		ada = await logIn('Ada');
	});

	it('saves changes in order, letting later ones name what earlier ones made', async () =>
	{
		const universeId = await createUniverse(ada);
		const { lobbyAreaId } = (await send<EditableUniverse>(ada, 'GET', `/${universeId}`)).body;

		assert.ok(lobbyAreaId);

		const ids = await saveAll(ada, universeId, [
			{ kind: 'createTile', ref: 'new:lava', settings: lava },
			{ kind: 'createArea', ref: 'new:cave', area: { name: 'Cave', defaultTileId: 'new:lava' } },
			{ kind: 'createArea', ref: 'new:grotto', area: { name: 'Grotto', parentAreaId: 'new:cave' } },
			{ kind: 'editCells', areaId: lobbyAreaId, changes: [[0, 0, 'new:lava']] },
			{ kind: 'saveLink', areaId: lobbyAreaId, column: 1, row: 0, target: { targetAreaId: 'new:cave', targetColumn: 0, targetRow: 0, mode: 'automatic', requiresWholeGroup: false } }
		]);
		const tileId = ids['new:lava'];
		const caveId = ids['new:cave'];

		assert.strictEqual(typeof tileId, 'number');
		assert.strictEqual(typeof caveId, 'string');

		const cave = (await send<{ defaultTileId: number }>(ada, 'GET', `/${universeId}/areas/${caveId}`)).body;
		const grotto = (await send<{ parentAreaId: string }>(ada, 'GET', `/${universeId}/areas/${ids['new:grotto']}`)).body;
		const usage = (await send<TileUsagePayload>(ada, 'GET', `/${universeId}/tiles/${tileId}/usage`)).body;
		const links = (await send<AreaLinkListPayload>(ada, 'GET', `/${universeId}/areas/${lobbyAreaId}/links`)).body;

		assert.strictEqual(cave.defaultTileId, tileId);
		assert.strictEqual(grotto.parentAreaId, caveId);
		assert.deepStrictEqual(usage.areas.map((area) => area.name).sort(), ['Cave', 'Lobby']);
		assert.deepStrictEqual(links.links.map((link) => link.targetAreaId), [caveId]);
	});

	it('saves nothing when a change is refused, and says which one', async () =>
	{
		const universeId = await createUniverse(ada);
		const response = await saveChanges(ada, universeId, [
			{ kind: 'createTile', ref: 'new:lava', settings: lava },
			{ kind: 'createItem', ref: 'new:torch', settings: { name: 'Torch', type: 'torch', enabled: true } },
			missingRace
		]);
		const items = (await send<ItemListPayload>(ada, 'GET', `/${universeId}/items?custom=true`)).body;

		assert.strictEqual(response.status, 404);
		assert.strictEqual(response.body.changeIndex, 2);
		assert.strictEqual(response.body.error.id, 'error.noSuchRace');
		assert.deepStrictEqual(await customTileNames(ada, universeId), []);
		assert.deepStrictEqual(items.items, []);
	});

	it('uploads a tileset a tile in the same save is drawn with, and removes the image when the save is refused', async () =>
	{
		const universeId = await createUniverse(ada);
		const upload = { name: 'Moss', format: 'dualGrid', drawOrder: 35, image: await solidPng(), rightsConfirmed: true } as const;
		const ids = await saveAll(ada, universeId, [
			{ kind: 'uploadTileGraphic', ref: 'new:moss', upload },
			{ kind: 'createTile', ref: 'new:mossy', settings: { ...lava, name: 'Mossy', uploadedGraphicId: 'new:moss' } }
		]);
		const tiles = (await send<TileListPayload>(ada, 'GET', `/${universeId}/tiles?custom=true`)).body.tiles;

		assert.deepStrictEqual(tiles.map((tile) => [tile.id, tile.uploadedGraphic?.id]), [[ids['new:mossy'], ids['new:moss']]]);

		const refused = await saveChanges(ada, universeId, [
			{ kind: 'uploadTileGraphic', ref: 'new:fern', upload: { ...upload, name: 'Fern' } },
			missingRace
		]);
		const graphics = (await send<TileGraphicListPayload>(ada, 'GET', `/${universeId}/tile-graphics`)).body.graphics;

		assert.strictEqual(refused.status, 404);
		assert.deepStrictEqual(graphics.map((graphic) => graphic.name), ['Moss']);
		assert.strictEqual(refused.body.ids, undefined);
	});

	it('deletes a tileset\'s image only once the save is saved', async () =>
	{
		const universeId = await createUniverse(ada);
		const ids = await saveAll(ada, universeId, [
			{ kind: 'uploadTileGraphic', ref: 'new:moss', upload: { name: 'Moss', format: 'dualGrid', drawOrder: 35, image: await solidPng(), rightsConfirmed: true } }
		]);
		const graphicId = String(ids['new:moss']);
		const imageUrl = `${testServerUrl}${TILE_GRAPHICS_PATH}/${graphicId}.png`;

		assert.strictEqual((await saveChanges(ada, universeId, [{ kind: 'deleteTileGraphic', graphicId }, missingRace])).status, 404);
		assert.strictEqual((await fetch(imageUrl)).status, 200);

		await saveAll(ada, universeId, [{ kind: 'deleteTileGraphic', graphicId }]);
		assert.strictEqual((await fetch(imageUrl)).status, 404);
	});

	it('checks the player\'s role for each change', async () =>
	{
		const universeId = await createUniverse(ada);
		const builder = await logIn('Bob');

		await setUniverseRole(universeId, builder.playerId, 'builder');

		const refused = await saveChanges(builder, universeId, [
			{ kind: 'createTile', ref: 'new:lava', settings: lava },
			{ kind: 'universe', update: { name: 'Mine Now' } }
		]);

		assert.strictEqual(refused.status, 403);
		assert.strictEqual(refused.body.changeIndex, 1);
		assert.deepStrictEqual(await customTileNames(ada, universeId), []);

		await saveAll(builder, universeId, [{ kind: 'createTile', ref: 'new:lava', settings: lava }]);
		assert.deepStrictEqual(await customTileNames(ada, universeId), ['Lava']);
	});

	it('names the change that isn\'t valid', async () =>
	{
		const universeId = await createUniverse(ada);
		const response = await saveChanges(ada, universeId, [
			{ kind: 'createTile', ref: 'new:lava', settings: lava },
			{ kind: 'createTile', ref: 'new:bad', settings: { ...lava, color: -1 } }
		]);

		assert.strictEqual(response.status, 400);
		assert.strictEqual(response.body.changeIndex, 1);
		assert.strictEqual(response.body.error.id, 'error.invalidRequest');
		assert.strictEqual((await saveChanges(ada, universeId, [{ kind: 'teleport' }])).body.changeIndex, 0);
	});

	it('refuses a ref no earlier change made, and one made twice', async () =>
	{
		const universeId = await createUniverse(ada);
		const unknown = await saveChanges(ada, universeId, [{ kind: 'saveTile', id: 'new:lava', settings: lava }]);
		const twice = await saveChanges(ada, universeId, [
			{ kind: 'createTile', ref: 'new:lava', settings: lava },
			{ kind: 'createTile', ref: 'new:lava', settings: lava }
		]);

		assert.deepStrictEqual([unknown.status, unknown.body.changeIndex], [400, 0]);
		assert.deepStrictEqual([twice.status, twice.body.changeIndex], [400, 1]);
		assert.deepStrictEqual(await customTileNames(ada, universeId), []);
	});

	it('says what shrinking a map would discard, and shrinks it when told to', async () =>
	{
		const universeId = await createUniverse(ada);
		const areaId = await createArea(ada, universeId);
		const bounds = { minColumn: 0, minRow: 0, maxColumn: 0, maxRow: 0 };

		await saveAll(ada, universeId, [{ kind: 'editCells', areaId, changes: [[2, 2, -1]] }]);

		const refused = await saveChanges(ada, universeId, [{ kind: 'resizeArea', areaId, bounds, discard: false }]);

		assert.strictEqual(refused.status, 409);
		assert.deepStrictEqual(refused.body.resizeConflict, { discardedCells: 1, discardedLinks: 0 });

		await saveAll(ada, universeId, [{ kind: 'resizeArea', areaId, bounds, discard: true }]);
		assert.deepStrictEqual((await send<{ bounds: unknown }>(ada, 'GET', `/${universeId}/areas/${areaId}`)).body.bounds, bounds);
	});

	it('refuses a name another universe has, saving nothing', async () =>
	{
		await createUniverse(ada, 'Taken');

		const universeId = await createUniverse(ada, 'Mine');
		const response = await saveChanges(ada, universeId, [
			{ kind: 'createTile', ref: 'new:lava', settings: lava },
			{ kind: 'universe', update: { name: 'Taken' } }
		]);

		assert.deepStrictEqual([response.status, response.body.changeIndex, response.body.error.id], [409, 1, 'error.universeNameTaken']);
		assert.deepStrictEqual(await customTileNames(ada, universeId), []);
	});

	it('tells the rooms what changed once the save is saved, and nothing when it is refused', async () =>
	{
		const universeId = await createUniverse(ada);
		const areaId = await createArea(ada, universeId);
		const heard: AreaChange[] = [];
		const stop = areaChanges.onChange((change) =>
		{
			heard.push(change);
		});

		try
		{
			await saveChanges(ada, universeId, [{ kind: 'editCells', areaId, changes: [[0, 0, -1]] }, missingRace]);
			assert.strictEqual(heard.length, 0);

			await saveAll(ada, universeId, [
				{ kind: 'createTile', ref: 'new:lava', settings: lava },
				{ kind: 'createTile', ref: 'new:basalt', settings: { ...lava, name: 'Basalt' } },
				{ kind: 'editCells', areaId, changes: [[0, 0, 'new:lava']] }
			]);
			assert.deepStrictEqual(heard.map((change) => change.kind), ['tiles', 'cells']);
		}
		finally
		{
			stop();
		}
	});

	it('refuses a save from another origin, and answers uncached with nosniff', async () =>
	{
		const universeId = await createUniverse(ada);
		const body = { changes: [{ kind: 'createTile', ref: 'new:lava', settings: lava }] };
		const refused = await send(ada, 'POST', `/${universeId}/changes`, { body, origin: 'https://evil.example' });
		const saved = await send(ada, 'POST', `/${universeId}/changes`, { body, origin: allowedTestOrigin });

		assert.strictEqual(refused.status, 403);
		assert.strictEqual(saved.status, 200);
		assert.strictEqual(saved.headers.get('cache-control'), 'no-store');
		assert.strictEqual(saved.headers.get('x-content-type-options'), 'nosniff');
		assert.deepStrictEqual(await customTileNames(ada, universeId), ['Lava']);
	});

	it('answers 404 for an area of another universe', async () =>
	{
		const universeId = await createUniverse(ada);
		const otherAreaId = await createArea(ada, await createUniverse(ada, 'Elsewhere'));

		for (const areaId of [otherAreaId, randomUUID()])
		{
			const response = await saveChanges(ada, universeId, [{ kind: 'deleteArea', areaId }]);

			assert.deepStrictEqual([response.status, response.body.error.id], [404, 'error.noSuchArea']);
		}
	});
});
