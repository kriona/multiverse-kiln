import assert from 'assert';
import type { AreaListPayload, EditableUniverse } from '@multiverse-kiln/shared';

import { listStartingAreaIds } from '../src/db/areaRepo.js';
import { findUniverse } from '../src/db/universeRepo.js';
import { setUniverseRole } from '../src/db/universeEditorRepo.js';
import { liveVersion } from '../src/db/universeVersions.js';
import { areaChanges, type AreaChange } from '../src/world/areaChanges.js';
import { addArea, addPlayableUniverse, addUniverse, type PlayableUniverse } from './db/fixtures.js';
import { logIn, saveAll, saveChanges, send, type Editor } from './editorRequests.js';
import { getTestServer } from './testServer.js';

describe('Choosing the lobby\'s area', () =>
{
	let ada: Editor;
	let universe: PlayableUniverse;

	before(async () =>
	{
		await getTestServer();
	});

	beforeEach(async () =>
	{
		ada = await logIn('Ada');
		universe = await addPlayableUniverse();
		await setUniverseRole(universe.universeId, ada.playerId, 'creator');
	});

	/**
	 * Saves changes, collecting what the save tells the rooms
	 *
	 * @param save Saves the changes
	 * @return What was published
	 */
	async function publishedBy(save: () => Promise<unknown>): Promise<AreaChange[]>
	{
		const published: AreaChange[] = [];
		const stop = areaChanges.onChange((change) =>
		{
			published.push(change);
		});

		try
		{
			await save();
		}
		finally
		{
			stop();
		}

		return(published);
	}

	it('moves the lobby to another area and starting square, telling the lobby and both areas', async () =>
	{
		const { universeId, squareAreaId, houseAreaId } = universe;
		const published = await publishedBy(() => saveAll(ada, universeId, [{ kind: 'universe', update: { lobbyAreaId: houseAreaId, lobbyColumn: 1, lobbyRow: -2 } }]));
		const saved = await findUniverse(universeId);

		assert.deepStrictEqual([saved?.lobbyAreaId, saved?.lobbyColumn, saved?.lobbyRow], [houseAreaId, 1, -2]);
		assert.deepStrictEqual(published.filter((change) => ((change.kind === 'area') || (change.kind === 'lobby'))), [
			{ kind: 'area', areaId: squareAreaId },
			{ kind: 'area', areaId: houseAreaId },
			{ kind: 'lobby', universeId }
		]);

		const editable = await send<EditableUniverse>(ada, 'GET', `/${universeId}`);

		assert.deepStrictEqual([editable.body.lobbyAreaId, editable.body.lobbyColumn, editable.body.lobbyRow], [houseAreaId, 1, -2]);
	});

	it('leaves the universe with no lobby area', async () =>
	{
		const { universeId } = universe;
		const published = await publishedBy(() => saveAll(ada, universeId, [{ kind: 'universe', update: { lobbyAreaId: null, lobbyColumn: 0, lobbyRow: 0 } }]));

		assert.strictEqual((await findUniverse(universeId))?.lobbyAreaId, undefined);
		assert.ok(published.some((change) => (change.kind === 'lobby')));
	});

	it('refuses a starting area, and an area of another universe, as the lobby', async () =>
	{
		const { universeId, fieldAreaId } = universe;
		const starting = await saveChanges(ada, universeId, [{ kind: 'universe', update: { lobbyAreaId: fieldAreaId } }]);

		assert.strictEqual(starting.status, 409);
		assert.strictEqual(starting.body.error.id, 'error.lobbyIsStartingArea');

		const elsewhere = await addArea(await addUniverse(), 'Elsewhere');
		const foreign = await saveChanges(ada, universeId, [{ kind: 'universe', update: { lobbyAreaId: elsewhere } }]);

		assert.strictEqual(foreign.status, 400);
		assert.strictEqual(foreign.body.error.id, 'error.noSuchLobbyArea');
		assert.strictEqual((await findUniverse(universeId))?.lobbyAreaId, universe.squareAreaId);
	});

	it('lists the starting areas, which the Lobby tab doesn\'t offer', async () =>
	{
		const { universeId, fieldAreaId } = universe;
		const list = await send<AreaListPayload>(ada, 'GET', `/${universeId}/areas`);

		assert.deepStrictEqual(list.body.startingAreaIds, [fieldAreaId]);
		assert.deepStrictEqual(await listStartingAreaIds(liveVersion(universeId)), [fieldAreaId]);
	});
});
