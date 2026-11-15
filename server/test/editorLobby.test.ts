import assert from 'assert';
import type { AreaListPayload, EditableUniverse, EditorChange, SaveImpactPayload } from '@multiverse-kiln/shared';

import { findEditorArea, listStartingAreaIds, loadArea } from '../src/db/areaRepo.js';
import { findGroup, listGroupMembers, listMembersInAreas, moveMembers } from '../src/db/groupRepo.js';
import { findEditableUniverse, findUniverse } from '../src/db/universeRepo.js';
import { setUniverseRole } from '../src/db/universeEditorRepo.js';
import { liveVersion } from '../src/db/universeVersions.js';
import { areaChanges, type AreaChange } from '../src/world/areaChanges.js';
import { addArea, addCharacter, addGroup, addPlayableUniverse, addUniverse, testLobbyRegionId, testRegionId, type PlayableUniverse } from './db/fixtures.js';
import { logIn, saveAll, saveChanges, send, type Editor } from './editorRequests.js';
import { addPlayer } from './players.js';
import { getTestServer } from './testServer.js';

describe('The lobby region', () =>
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

	/**
	 * Saving changes that must be refused for the lobby's edge
	 *
	 * @param changes The changes
	 * @return The problems the refusal names
	 */
	async function lobbyRefusal(changes: EditorChange[]): Promise<unknown[]>
	{
		const answer = await saveChanges(ada, universe.universeId, changes);

		assert.strictEqual(answer.status, 409, JSON.stringify(answer.body));
		assert.strictEqual(answer.body.error.id, 'error.lobbyProblems');

		return(answer.body.placeProblems ?? []);
	}

	it('moves the starting square to another lobby area, telling the lobby', async () =>
	{
		const { universeId, houseAreaId } = universe;
		const published = await publishedBy(() => saveAll(ada, universeId, [{ kind: 'universe', update: { lobbyAreaId: houseAreaId, lobbyColumn: 1, lobbyRow: 2 } }]));
		const saved = await findUniverse(universeId);

		assert.deepStrictEqual([saved?.lobbyAreaId, saved?.lobbyColumn, saved?.lobbyRow], [houseAreaId, 1, 2]);
		assert.ok(published.some((change) => (change.kind === 'lobby')));

		const editable = await send<EditableUniverse>(ada, 'GET', `/${universeId}`);

		assert.deepStrictEqual([editable.body.lobbyAreaId, editable.body.lobbyColumn, editable.body.lobbyRow], [houseAreaId, 1, 2]);
	});

	it('refuses a starting square past the edges of its area, from the Lobby tab or a resize', async () =>
	{
		const { universeId, squareAreaId, houseAreaId } = universe;
		const offArea = [{ kind: 'lobbySquareOffArea', areaId: squareAreaId }];
		const square = { minColumn: 0, minRow: 0, maxColumn: 31, maxRow: 17 };

		// The square reaches from column 0, row 0 to 31, 17
		assert.deepStrictEqual(await lobbyRefusal([{ kind: 'universe', update: { lobbyColumn: 32 } }]), offArea);
		assert.deepStrictEqual(await lobbyRefusal([{ kind: 'universe', update: { lobbyAreaId: houseAreaId, lobbyColumn: 10, lobbyRow: 0 } }]), [{ kind: 'lobbySquareOffArea', areaId: houseAreaId }]);

		await saveAll(ada, universeId, [{ kind: 'universe', update: { lobbyColumn: 20, lobbyRow: 10 } }]);

		assert.deepStrictEqual(await lobbyRefusal([{ kind: 'resizeArea', areaId: squareAreaId, bounds: { ...square, maxColumn: 19 }, discard: true }]), offArea);

		// A builder assigned the lobby region is refused the same way
		const bea = await logIn('Bea');

		await setUniverseRole(universeId, bea.playerId, 'builder');
		await saveAll(ada, universeId, [
			{ kind: 'universe', update: { requireBuilderDraft: false } },
			{ kind: 'assignBuilders', regionId: await testLobbyRegionId(universeId), builderIds: [bea.playerId] }
		]);

		const builder = await saveChanges(bea, universeId, [{ kind: 'resizeArea', areaId: squareAreaId, bounds: { ...square, maxRow: 9 }, discard: true }]);

		assert.strictEqual(builder.status, 409, JSON.stringify(builder.body));
		assert.deepStrictEqual(builder.body.placeProblems, offArea);
		assert.deepStrictEqual((await findEditorArea(squareAreaId))?.area.bounds, square);

		// Moving the square inside in the same save, or a resize that keeps it inside, is saved
		await saveAll(ada, universeId, [
			{ kind: 'resizeArea', areaId: squareAreaId, bounds: { ...square, maxColumn: 19 }, discard: true },
			{ kind: 'universe', update: { lobbyColumn: 19 } }
		]);
		await saveAll(bea, universeId, [{ kind: 'resizeArea', areaId: squareAreaId, bounds: { ...square, maxColumn: 19, maxRow: 10 }, discard: true }]);

		const saved = await findUniverse(universeId);

		assert.deepStrictEqual([saved?.lobbyAreaId, saved?.lobbyColumn, saved?.lobbyRow], [squareAreaId, 19, 10]);
		assert.deepStrictEqual((await findEditorArea(squareAreaId))?.area.bounds, { ...square, maxColumn: 19, maxRow: 10 });
	});

	it('leaves the universe without a lobby region or starting square', async () =>
	{
		const { universeId, squareAreaId } = universe;
		const leave: EditorChange = { kind: 'universe', update: { lobbyRegionId: null, lobbyAreaId: null, lobbyColumn: 0, lobbyRow: 0 } };

		// No longer lobby areas, the square and house need a passage of time from their region
		const refused = await saveChanges(ada, universeId, [leave]);

		assert.strictEqual(refused.body.error.id, 'error.placeProblems');

		const lobbyRegionId = await testLobbyRegionId(universeId);
		const published = await publishedBy(() => saveAll(ada, universeId, [
			{ kind: 'updateRegion', regionId: lobbyRegionId, update: { passageOfTime: 'always_dusk' } },
			leave
		]));

		assert.strictEqual((await findUniverse(universeId))?.lobbyAreaId, undefined);
		assert.strictEqual((await loadArea(squareAreaId))?.area.lobby, false);
		assert.ok(published.some((change) => (change.kind === 'lobby')));
		assert.ok(published.some((change) => ((change.kind === 'area') && (change.areaId === squareAreaId))));
	});

	it('refuses a starting square outside the lobby region, or in another universe', async () =>
	{
		const { universeId, fieldAreaId } = universe;

		assert.deepStrictEqual(await lobbyRefusal([{ kind: 'universe', update: { lobbyAreaId: fieldAreaId } }]), [{ kind: 'lobbySquareOutside', areaId: fieldAreaId }]);

		const elsewhere = await addArea(await addUniverse(), 'Elsewhere');
		const foreign = await saveChanges(ada, universeId, [{ kind: 'universe', update: { lobbyAreaId: elsewhere } }]);

		assert.strictEqual(foreign.status, 400);
		assert.strictEqual(foreign.body.error.id, 'error.noSuchLobbyArea');
		assert.strictEqual((await findUniverse(universeId))?.lobbyAreaId, universe.squareAreaId);
	});

	it('refuses a lobby area as a starting area, even in the change moving the starting square', async () =>
	{
		const { universeId, squareAreaId, fieldAreaId, houseAreaId } = universe;

		assert.deepStrictEqual(await lobbyRefusal([{ kind: 'universe', update: { lobbyAreaId: houseAreaId, startingAreaId: houseAreaId } }]), [{ kind: 'lobbyStartingArea', areaId: houseAreaId }]);

		const saved = await findUniverse(universeId);

		assert.deepStrictEqual([saved?.lobbyAreaId, saved?.startingAreaId], [squareAreaId, fieldAreaId]);
	});

	it('refuses a lobby region with a starting area below it', async () =>
	{
		const { universeId, fieldAreaId } = universe;
		const problems = await lobbyRefusal([
			{ kind: 'updateRegion', regionId: await testLobbyRegionId(universeId), update: { passageOfTime: 'always_noon' } },
			{ kind: 'universe', update: { lobbyRegionId: await testRegionId(universeId), lobbyAreaId: fieldAreaId } }
		]);

		assert.deepStrictEqual(problems.filter((problem) => ((problem as { kind: string }).kind === 'lobbyStartingArea')), [{ kind: 'lobbyStartingArea', areaId: fieldAreaId }]);
		assert.strictEqual((await findEditableUniverse(liveVersion(universeId)))?.lobbyRegionId, await testLobbyRegionId(universeId));
	});

	it('chooses another lobby region, working out again which areas are lobby areas', async () =>
	{
		const { universeId, squareAreaId, houseAreaId } = universe;
		const ids = await saveAll(ada, universeId, [
			{ kind: 'createRegion', ref: 'new:port', region: { name: 'Port', parents: [], enabled: null, indoors: null, lightLevel: null, defaultTileId: null, passageOfTime: null, faerieMorning: null, fogOfWar: null } },
			{ kind: 'createArea', ref: 'new:dock', area: { name: 'Dock', parents: [{ kind: 'region', id: 'new:port' }, { kind: 'region', id: await testRegionId(universeId) }] } }
		]);
		const portId = String(ids['new:port']);
		const dockId = String(ids['new:dock']);
		const move: EditorChange = { kind: 'universe', update: { lobbyRegionId: portId, lobbyAreaId: dockId, lobbyColumn: 0, lobbyRow: 0 } };

		// Leaving the lobby, the square and house need a passage of time from their region
		const refused = await saveChanges(ada, universeId, [move]);

		assert.strictEqual(refused.body.error.id, 'error.placeProblems');
		assert.deepStrictEqual(refused.body.placeProblems?.map((problem) => problem.kind), ['missing', 'missing']);

		await saveAll(ada, universeId, [
			{ kind: 'updateRegion', regionId: await testLobbyRegionId(universeId), update: { passageOfTime: 'always_noon' } },
			move
		]);

		assert.strictEqual((await loadArea(dockId))?.area.lobby, true);
		assert.strictEqual((await loadArea(squareAreaId))?.area.lobby, false);
		assert.strictEqual((await findEditorArea(houseAreaId))?.area.resolved.passageOfTime, 'always_noon');
	});

	it('refuses a link across the lobby region\'s edge either way', async () =>
	{
		const { squareAreaId, houseAreaId, fieldAreaId } = universe;
		const target = { targetColumn: 0, targetRow: 0, mode: 'automatic', requiresWholeGroup: false } as const;

		assert.deepStrictEqual(await lobbyRefusal([{ kind: 'saveLink', areaId: squareAreaId, column: 1, row: 1, target: { ...target, targetAreaId: fieldAreaId } }]), [{ kind: 'lobbyLink', areaId: squareAreaId, targetAreaId: fieldAreaId }]);
		assert.deepStrictEqual(await lobbyRefusal([{ kind: 'saveLink', areaId: fieldAreaId, column: 1, row: 1, target: { ...target, targetAreaId: houseAreaId } }]), [{ kind: 'lobbyLink', areaId: fieldAreaId, targetAreaId: houseAreaId }]);

		// Within the lobby, links are as they always were
		await saveAll(ada, universe.universeId, [{ kind: 'saveLink', areaId: squareAreaId, column: 1, row: 1, target: { ...target, targetAreaId: houseAreaId } }]);
	});

	it('refuses moving an area with a link out of the lobby under another parent', async () =>
	{
		const { universeId, squareAreaId, houseAreaId } = universe;
		const problems = await lobbyRefusal([{ kind: 'updateArea', areaId: houseAreaId, update: { parents: [{ kind: 'region', id: await testRegionId(universeId) }] } }]);

		// The square and house link to each other
		assert.deepStrictEqual(problems.map((problem) => JSON.stringify(problem)).sort(), [
			{ kind: 'lobbyLink', areaId: squareAreaId, targetAreaId: houseAreaId },
			{ kind: 'lobbyLink', areaId: houseAreaId, targetAreaId: squareAreaId }
		].map((problem) => JSON.stringify(problem)).sort());
	});

	it('moves a group\'s characters out of an area put below the lobby region, warning first', async () =>
	{
		const { universeId, fieldAreaId } = universe;
		const campId = await addArea(universeId, 'Camp');
		const playerId = (await addPlayer('Bob')).id;
		const brokkId = await addCharacter(playerId, universeId, 'Brokk');
		const groupId = await addGroup(universeId, brokkId, fieldAreaId);
		const enter: EditorChange = { kind: 'updateArea', areaId: campId, update: { parents: [{ kind: 'region', id: await testLobbyRegionId(universeId) }] } };

		await moveMembers([{ characterId: brokkId, areaId: campId, column: 1, row: 1 }]);

		const impacts = await send<SaveImpactPayload>(ada, 'POST', `/${universeId}/changes/impact`, { body: { changes: [enter] } });

		assert.deepStrictEqual(impacts.body.impacts, [{ changeIndex: 0, kind: 'lobbyArea', id: campId, name: 'Camp', characters: 1 }]);

		const published = await publishedBy(() => saveAll(ada, universeId, [enter]));
		const [member] = await listGroupMembers(groupId);

		assert.deepStrictEqual(member?.position, { areaId: fieldAreaId, column: 0, row: 0 });
		assert.deepStrictEqual(await listMembersInAreas([campId]), []);
		assert.ok(published.some((change) => ((change.kind === 'evacuated') && (change.areaId === campId) && (change.destination === null))));
		assert.strictEqual((await loadArea(campId))?.area.lobby, true);
	});

	it('starts a group whose own starting area is put below the lobby region in the universe\'s, moving its characters there', async () =>
	{
		const { universeId, fieldAreaId } = universe;
		const caveId = await addArea(universeId, 'Cave');
		const brokkId = await addCharacter((await addPlayer('Bob')).id, universeId, 'Brokk');
		const groupId = await addGroup(universeId, brokkId, caveId);
		const enter: EditorChange = { kind: 'updateArea', areaId: caveId, update: { parents: [{ kind: 'region', id: await testLobbyRegionId(universeId) }] } };

		await moveMembers([{ characterId: brokkId, areaId: caveId, column: 1, row: 1 }]);

		const published = await publishedBy(() => saveAll(ada, universeId, [enter]));
		const [member] = await listGroupMembers(groupId);

		assert.strictEqual((await loadArea(caveId))?.area.lobby, true);
		assert.strictEqual((await findGroup(groupId))?.startingAreaId, null);
		assert.deepStrictEqual(member?.position, { areaId: fieldAreaId, column: 0, row: 0 });
		assert.ok(published.some((change) => ((change.kind === 'evacuated') && (change.areaId === caveId) && (change.destination === null))));
	});

	it('deletes the lobby region, leaving the universe without a lobby', async () =>
	{
		const { universeId, squareAreaId, houseAreaId } = universe;
		const regionId = await testRegionId(universeId);

		await saveAll(ada, universeId, [
			{ kind: 'updateArea', areaId: squareAreaId, update: { parents: [{ kind: 'region', id: regionId }] } },
			{ kind: 'updateArea', areaId: houseAreaId, update: { parents: [{ kind: 'region', id: regionId }] } },
			{ kind: 'deleteRegion', regionId: await testLobbyRegionId(universeId) }
		]);

		const saved = await findEditableUniverse(liveVersion(universeId));

		assert.deepStrictEqual([saved?.lobbyRegionId, saved?.lobbyAreaId], [null, null]);
		assert.strictEqual((await loadArea(squareAreaId))?.area.lobby, false);
	});

	it('lists the starting areas and the links between areas, which the editor keeps apart from the lobby', async () =>
	{
		const { universeId, fieldAreaId, squareAreaId, houseAreaId } = universe;
		const list = await send<AreaListPayload>(ada, 'GET', `/${universeId}/areas`);

		assert.deepStrictEqual(list.body.startingAreaIds, [fieldAreaId]);
		assert.deepStrictEqual(await listStartingAreaIds(liveVersion(universeId)), [fieldAreaId]);
		assert.strictEqual(list.body.lobbyRegionId, await testLobbyRegionId(universeId));
		assert.deepStrictEqual(list.body.links.map(({ areaId, targetAreaId }) => [areaId, targetAreaId]).sort(), [[houseAreaId, squareAreaId], [squareAreaId, houseAreaId]].sort());
	});
});
