import assert from 'assert';
import type { AreaListPayload, ChangeImpact, EditableUniverse, EditorArea, EditorChange, PlaceRef, PlaceSettings, ResolvedAreaSettings, SaveImpactPayload, SaveRefusedPayload, TileSettings } from '@multiverse-kiln/shared';

import { loadArea } from '../src/db/areaRepo.js';
import { listMembersInAreas, moveMembers } from '../src/db/groupRepo.js';
import { setUniverseAccess, setUniverseRole } from '../src/db/universeEditorRepo.js';
import { addCharacter, addGroup, addPlayableUniverse, assignToTestRegion, defaultTileId, TEST_LOBBY_REGION_NAME, TEST_REGION_NAME, testRegionId, withoutLobby } from './db/fixtures.js';
import { createUniverse, logIn, saveAll, saveChanges, send, worldRegionId, type Editor } from './editorRequests.js';
import { addPlayer } from './players.js';
import { getTestServer } from './testServer.js';

/**
 * Settings that all inherit
 */
const BLANK: PlaceSettings = {
	enabled: null,
	indoors: null,
	lightLevel: null,
	defaultTileId: null,
	passageOfTime: null,
	faerieMorning: null,
	fogOfWar: null
};

/**
 * A tile only for outdoors
 */
const moss: TileSettings = {
	name: 'Moss',
	indoors: false,
	outdoors: true,
	color: 0x4a7a30,
	graphic: null,
	uploadedGraphicId: null,
	visionCost: 0,
	walkSeconds: 600,
	enabled: true
};

/**
 * A region's or area's own settings in a change, whose default tile may be made earlier in the save
 */
type SettingsInChange = Partial<Omit<PlaceSettings, 'defaultTileId'> & { defaultTileId: number | `new:${string}` | null }>;

/**
 * A change adding a region
 *
 * @param ref The region's ref
 * @param name Its name
 * @param parents The regions it is inside, by ID or ref
 * @param settings Its own settings, over BLANK
 * @return The change
 */
function newRegion(ref: string, name: string, parents: string[], settings: SettingsInChange = {}): EditorChange
{
	return({
		kind: 'createRegion',
		ref: `new:${ref}`,
		region: {
			...BLANK,
			...settings,
			name,
			parents: parents.map((id): PlaceRef => ({ kind: 'region', id }))
		}
	});
}

/**
 * A change adding an area
 *
 * @param ref The area's ref
 * @param name Its name
 * @param parents Its parents
 * @param settings Its own settings
 * @return The change
 */
function newArea(ref: string, name: string, parents: PlaceRef[], settings: SettingsInChange = {}): EditorChange
{
	return({ kind: 'createArea', ref: `new:${ref}`, area: { ...settings, name, parents } });
}

/**
 * A region, by ID or ref, as a parent
 *
 * @param id The region's ID or ref
 * @return The parent
 */
function inRegion(id: string): PlaceRef
{
	return({ kind: 'region', id });
}

/**
 * An area, by ID or ref, as a parent
 *
 * @param id The area's ID or ref
 * @return The parent
 */
function inArea(id: string): PlaceRef
{
	return({ kind: 'area', id });
}

describe('Regions', () =>
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

	/**
	 * An area's settings as worked out and stored
	 *
	 * @param universeId The universe's ID
	 * @param areaId The area's ID
	 * @param version Which version it is in
	 * @return The settings
	 */
	async function resolvedOf(universeId: string, areaId: string, version: 'live' | 'draft' = 'live'): Promise<ResolvedAreaSettings>
	{
		const answer = await send<EditorArea>(ada, 'GET', `/${universeId}/areas/${areaId}?version=${version}`);

		assert.strictEqual(answer.status, 200, JSON.stringify(answer.body));

		return(answer.body.resolved);
	}

	it('refuses a conflict and a missing value, naming them, but not a blank region', async () =>
	{
		const universeId = await createUniverse(ada);
		const worldId = await worldRegionId(ada, universeId);
		const conflict = await saveChanges(ada, universeId, [
			newRegion('noon', 'Noon', [], { passageOfTime: 'always_noon' }),
			newRegion('dusk', 'Dusk', [], { passageOfTime: 'always_dusk' }),
			newArea('market', 'Market', [inRegion(worldId), inRegion('new:noon'), inRegion('new:dusk')])
		]);
		const body = conflict.body as SaveRefusedPayload;
		const problem = body.placeProblems?.find((each) => (each.kind === 'conflict'));

		assert.strictEqual(conflict.status, 409);
		assert.strictEqual(body.changeIndex, 2);
		assert.ok((problem?.kind === 'conflict') && (problem.setting === 'passageOfTime'));
		assert.deepStrictEqual(Object.values(body.placeNames ?? {}).sort(), ['Dusk', 'Market', 'Noon', 'World']);

		const missing = await saveChanges(ada, universeId, [
			newRegion('blank', 'Blank', []),
			newArea('lost', 'Lost', [inRegion('new:blank')])
		]);

		assert.strictEqual(missing.status, 409);
		assert.deepStrictEqual((missing.body as SaveRefusedPayload).placeProblems?.map((each) => ((each.kind === 'missing') ? each.setting : each.kind)), ['indoors', 'defaultTileId', 'passageOfTime', 'fogOfWar']);

		const ids = await saveAll(ada, universeId, [
			newRegion('blank', 'Blank', []),
			newArea('field', 'Field', [inRegion(worldId), inRegion('new:blank')])
		]);

		assert.strictEqual((await resolvedOf(universeId, String(ids['new:field']))).passageOfTime, 'flows_normally');
	});

	it('stores the settings worked out for the areas below a region as the region changes', async () =>
	{
		const universeId = await createUniverse(ada);
		const worldId = await worldRegionId(ada, universeId);
		const ids = await saveAll(ada, universeId, [
			newRegion('capitol', 'Capitol City', [worldId]),
			newArea('market', 'Market District', [inRegion('new:capitol')]),
			newArea('shop', 'Shop', [inArea('new:market')], { indoors: true, defaultTileId: await defaultTileId('wood_floor') }),
			newArea('cellar', 'Cellar', [inArea('new:shop')], { lightLevel: 'dark' })
		]);
		const marketId = String(ids['new:market']);
		const cellarId = String(ids['new:cellar']);

		assert.deepStrictEqual(await resolvedOf(universeId, cellarId), {
			enabled: true,
			indoors: true,
			lightLevel: 'dark',
			defaultTileId: await defaultTileId('wood_floor'),
			passageOfTime: 'flows_normally',
			faerieMorning: null,
			fogOfWar: true,
			lobby: false
		});

		await saveAll(ada, universeId, [{ kind: 'updateRegion', regionId: worldId, update: { passageOfTime: 'always_noon' } }]);

		assert.strictEqual((await resolvedOf(universeId, marketId)).passageOfTime, 'always_noon');
		assert.strictEqual((await resolvedOf(universeId, cellarId)).passageOfTime, 'always_noon');
		assert.deepStrictEqual((await loadArea(cellarId))?.time, { passage: 'always_noon' });

		await saveAll(ada, universeId, [{ kind: 'updateRegion', regionId: String(ids['new:capitol']), update: { enabled: false } }]);

		assert.strictEqual((await resolvedOf(universeId, cellarId)).enabled, false);
		assert.strictEqual((await loadArea(cellarId))?.area.enabled, false);
	});

	it('refuses a region name another region has, not counting case', async () =>
	{
		const universeId = await createUniverse(ada);
		const worldId = await worldRegionId(ada, universeId);
		const ids = await saveAll(ada, universeId, [newRegion('east', 'East', [worldId])]);

		assert.strictEqual((await saveChanges(ada, universeId, [newRegion('other', 'world', [])])).status, 409);
		assert.strictEqual((await saveChanges(ada, universeId, [{ kind: 'updateRegion', regionId: String(ids['new:east']), update: { name: 'WORLD' } }])).status, 409);
		assert.strictEqual((await saveChanges(ada, universeId, [{ kind: 'updateRegion', regionId: String(ids['new:east']), update: { name: 'east' } }])).status, 200);
	});

	it('refuses a region inside itself, directly or further down, or nested more than ten levels deep', async () =>
	{
		const universeId = await createUniverse(ada);
		const worldId = await worldRegionId(ada, universeId);

		// World is the first level, so the ninth region below it is the tenth
		const chain = [newRegion('r1', 'R1', [worldId])];

		for (let level = 2; level <= 9; level++)
		{
			chain.push(newRegion(`r${level}`, `R${level}`, [`new:r${level - 1}`]));
		}

		const ids = await saveAll(ada, universeId, chain);
		const loop = await saveChanges(ada, universeId, [{ kind: 'updateRegion', regionId: worldId, update: { parents: [inRegion(String(ids['new:r3']))] } }]);

		assert.strictEqual(loop.status, 409);
		assert.ok((loop.body as SaveRefusedPayload).placeProblems?.some((problem) => (problem.kind === 'insideItself')));
		assert.strictEqual((await saveChanges(ada, universeId, [{ kind: 'updateRegion', regionId: worldId, update: { parents: [inRegion(worldId)] } }])).status, 400);

		const deep = await saveChanges(ada, universeId, [newArea('deep', 'Deep', [inRegion(String(ids['new:r9']))])]);

		assert.strictEqual(deep.status, 409);
		assert.deepStrictEqual((deep.body as SaveRefusedPayload).placeProblems?.map((problem) => problem.kind), ['tooDeep']);
		assert.strictEqual((await saveChanges(ada, universeId, [newArea('deep', 'Deep', [inRegion(String(ids['new:r8']))])])).status, 200);
	});

	it('deletes a region once what is only in it is moved or deleted, leaving what has other parents', async () =>
	{
		const universeId = await createUniverse(ada);
		const worldId = await worldRegionId(ada, universeId);
		const ids = await saveAll(ada, universeId, [
			newRegion('old', 'Old', [worldId]),
			newRegion('kept', 'Kept', [worldId]),
			newRegion('inner', 'Inner', ['new:old']),
			newArea('moved', 'Moved', [inRegion('new:old')]),
			newArea('shared', 'Shared', [inRegion('new:old'), inRegion('new:kept')]),
			newArea('doomed', 'Doomed', [inRegion('new:inner')])
		]);
		const oldId = String(ids['new:old']);

		// The inner region becomes top-level, leaving its area with no settings
		assert.strictEqual((await saveChanges(ada, universeId, [{ kind: 'deleteRegion', regionId: oldId }])).status, 409);
		assert.strictEqual((await saveChanges(ada, universeId, [
			{ kind: 'updateArea', areaId: String(ids['new:moved']), update: { parents: [inRegion(String(ids['new:kept']))] } },
			{ kind: 'deleteArea', areaId: String(ids['new:doomed']) },
			{ kind: 'deleteRegion', regionId: String(ids['new:inner']) },
			{ kind: 'deleteRegion', regionId: oldId }
		])).status, 200);

		const listed = (await send<AreaListPayload>(ada, 'GET', `/${universeId}/areas`)).body;

		assert.deepStrictEqual(listed.regions.map((region) => region.name), ['Kept', 'Lobby', 'World']);
		assert.deepStrictEqual(listed.areas.find((area) => (area.name === 'Shared'))?.parents, [inRegion(String(ids['new:kept']))]);
		assert.deepStrictEqual(listed.areas.find((area) => (area.name === 'Moved'))?.parents, [inRegion(String(ids['new:kept']))]);
	});

	it('gives the areas inside a deleted area its parents, refusing a deletion that leaves one with a conflict', async () =>
	{
		const universeId = await createUniverse(ada);
		const worldId = await worldRegionId(ada, universeId);
		const ids = await saveAll(ada, universeId, [
			newRegion('noon', 'Noon', [worldId], { passageOfTime: 'always_noon' }),
			newRegion('dusk', 'Dusk', [worldId], { passageOfTime: 'always_dusk' }),
			newArea('shop', 'Shop', [inRegion('new:noon')], { passageOfTime: 'always_dusk' }),
			newArea('cellar', 'Cellar', [inArea('new:shop'), inRegion('new:dusk')]),
			newArea('hall', 'Hall', [inRegion(worldId)]),
			newArea('closet', 'Closet', [inArea('new:hall')])
		]);
		const refused = await saveChanges(ada, universeId, [{ kind: 'deleteArea', areaId: String(ids['new:shop']) }]);

		assert.strictEqual(refused.status, 409);
		assert.deepStrictEqual((refused.body as SaveRefusedPayload).placeProblems, [{
			kind: 'conflict',
			areaId: String(ids['new:cellar']),
			setting: 'passageOfTime',
			values: [
				{ place: inRegion(String(ids['new:dusk'])), value: { passageOfTime: 'always_dusk', faerieMorning: null } },
				{ place: inRegion(String(ids['new:noon'])), value: { passageOfTime: 'always_noon', faerieMorning: null } }
			]
		}]);

		await saveAll(ada, universeId, [{ kind: 'deleteArea', areaId: String(ids['new:hall']) }]);

		const closet = (await send<EditorArea>(ada, 'GET', `/${universeId}/areas/${String(ids['new:closet'])}`)).body;

		assert.deepStrictEqual(closet.parents, [inRegion(worldId)]);
	});

	it('refuses unchecking a kind of a tile an area needs as its default tile, until its places are given another', async () =>
	{
		const universeId = await createUniverse(ada);
		const worldId = await worldRegionId(ada, universeId);
		const grassId = await defaultTileId('grass');
		const woodId = await defaultTileId('wood_floor');
		const ids = await saveAll(ada, universeId, [
			{ kind: 'createTile', ref: 'new:moss', settings: { ...moss, indoors: true } },
			newRegion('meadows', 'Meadows', [], { indoors: false, lightLevel: 'lit', defaultTileId: 'new:moss', passageOfTime: 'flows_normally', fogOfWar: true }),
			newArea('field', 'Field', [inRegion('new:meadows')]),
			newRegion('both', 'Both', [worldId], { defaultTileId: 'new:moss' }),
			newArea('lawn', 'Lawn', [inRegion('new:both')]),
			newArea('hall', 'Hall', [inRegion('new:both')], { indoors: true }),
			newRegion('glade', 'Glade', [worldId], { defaultTileId: 'new:moss' }),
			newArea('clearing', 'Clearing', [inRegion('new:glade')])
		]);
		const mossId = Number(ids['new:moss']);
		const indoorsOnly: EditorChange = { kind: 'saveTile', id: mossId, settings: { ...moss, indoors: true, outdoors: false } };

		assert.strictEqual((await resolvedOf(universeId, String(ids['new:lawn']))).defaultTileId, mossId);

		// Field has nothing else to inherit, and Lawn's region keeps moss for the hall
		const refused = await saveChanges(ada, universeId, [indoorsOnly]);

		assert.strictEqual(refused.status, 409);
		assert.deepStrictEqual((refused.body as SaveRefusedPayload).placeProblems?.map((problem) => ((problem.kind === 'missing') ? [problem.areaId, problem.setting] : problem.kind)), [[String(ids['new:field']), 'defaultTileId']]);

		// Replaced on the region setting it, on the outdoor area below a region that also serves an indoor
		// one, and cleared to inherit on a region whose areas inherit from above it
		assert.strictEqual((await saveChanges(ada, universeId, [
			{ kind: 'updateRegion', regionId: String(ids['new:meadows']), update: { defaultTileId: grassId } },
			{ kind: 'updateArea', areaId: String(ids['new:lawn']), update: { defaultTileId: grassId } },
			{ kind: 'updateRegion', regionId: String(ids['new:glade']), update: { defaultTileId: null } },
			indoorsOnly
		])).status, 200);
		assert.strictEqual((await resolvedOf(universeId, String(ids['new:field']))).defaultTileId, grassId);
		assert.strictEqual((await resolvedOf(universeId, String(ids['new:lawn']))).defaultTileId, grassId);
		assert.strictEqual((await resolvedOf(universeId, String(ids['new:hall']))).defaultTileId, mossId);
		assert.strictEqual((await resolvedOf(universeId, String(ids['new:clearing']))).defaultTileId, grassId);

		// Deleting it gives every place setting it another, and a tile of the wrong kind leaves the hall without one
		const refusedWrongKind = await saveChanges(ada, universeId, [
			{ kind: 'updateRegion', regionId: String(ids['new:both']), update: { defaultTileId: grassId } },
			{ kind: 'removeTile', id: mossId, replaceWith: woodId }
		]);

		assert.strictEqual(refusedWrongKind.status, 409);
		assert.strictEqual((await saveChanges(ada, universeId, [
			{ kind: 'updateRegion', regionId: String(ids['new:both']), update: { defaultTileId: woodId } },
			{ kind: 'removeTile', id: mossId, replaceWith: woodId }
		])).status, 200);
		assert.strictEqual((await resolvedOf(universeId, String(ids['new:hall']))).defaultTileId, woodId);
		assert.strictEqual((await resolvedOf(universeId, String(ids['new:lawn']))).defaultTileId, grassId);
	});

	it('lets a builder edit only what is below the regions assigned to them', async () =>
	{
		const universe = await addPlayableUniverse();
		const { universeId, squareAreaId, houseAreaId } = universe;
		const bea = await logIn('Bea');
		const carl = await logIn('Carl');
		const testRegion = await testRegionId(universeId);

		// Bea's areas link to the square and house, which can't be lobby areas then
		await withoutLobby(universe);
		await setUniverseRole(universeId, ada.playerId, 'creator');
		await setUniverseRole(universeId, bea.playerId, 'builder');
		await setUniverseRole(universeId, carl.playerId, 'builder');

		const ids = await saveAll(ada, universeId, [
			{ kind: 'universe', update: { requireBuilderDraft: false } },
			newRegion('beas', 'Bea\'s Regions', [testRegion]),
			newRegion('sub', 'Sub', ['new:beas']),
			newArea('mine', 'Mine', [inRegion('new:beas')]),
			newArea('deep', 'Deep', [inRegion('new:sub')]),
			{ kind: 'assignBuilders', regionId: 'new:beas', builderIds: [bea.playerId] },
			{ kind: 'saveLink', areaId: 'new:mine', column: 0, row: 0, target: { targetAreaId: squareAreaId, targetColumn: 0, targetRow: 0, mode: 'manual', requiresWholeGroup: false } },
			{ kind: 'saveLink', areaId: houseAreaId, column: 1, row: 1, target: { targetAreaId: 'new:deep', targetColumn: 0, targetRow: 0, mode: 'manual', requiresWholeGroup: false } }
		]);
		const beas = String(ids['new:beas']);
		const mine = String(ids['new:mine']);
		const deep = String(ids['new:deep']);
		const statusOf = async (editor: Editor, change: EditorChange): Promise<number> => (await saveChanges(editor, universeId, [change])).status;

		assert.deepStrictEqual((await send<EditableUniverse>(bea, 'GET', `/${universeId}`)).body.assignedRegionIds, [beas]);
		assert.strictEqual(await statusOf(bea, { kind: 'updateArea', areaId: mine, update: { name: 'Mine Now' } }), 200);
		assert.strictEqual(await statusOf(bea, { kind: 'updateArea', areaId: deep, update: { name: 'Deeper' } }), 200);
		assert.strictEqual(await statusOf(bea, { kind: 'updateArea', areaId: squareAreaId, update: { name: 'Mine Too' } }), 403);

		// Both ends of a move, a parent or a link are within their assignments
		assert.strictEqual(await statusOf(bea, { kind: 'updateArea', areaId: mine, update: { parents: [inRegion(testRegion)] } }), 403);
		assert.strictEqual(await statusOf(bea, { kind: 'updateArea', areaId: mine, update: { parents: [inRegion(String(ids['new:sub']))] } }), 200);
		assert.strictEqual(await statusOf(bea, { kind: 'updateArea', areaId: mine, update: { parents: [inRegion(beas), inArea(deep)] } }), 200);
		assert.strictEqual(await statusOf(bea, { kind: 'saveLink', areaId: deep, column: 1, row: 0, target: { targetAreaId: squareAreaId, targetColumn: 0, targetRow: 0, mode: 'manual', requiresWholeGroup: false } }), 403);
		assert.strictEqual(await statusOf(bea, { kind: 'saveLink', areaId: deep, column: 1, row: 0, target: { targetAreaId: mine, targetColumn: 0, targetRow: 0, mode: 'manual', requiresWholeGroup: false } }), 200);
		assert.strictEqual(await statusOf(bea, newArea('outside', 'Outside', [inRegion(testRegion)])), 403);
		assert.strictEqual(await statusOf(bea, newRegion('top', 'Top', [])), 403);

		// A link out of their assignments, and an area linked into from outside them, are left to creators
		assert.strictEqual(await statusOf(bea, { kind: 'deleteLink', areaId: mine, column: 0, row: 0 }), 403);
		assert.strictEqual(await statusOf(bea, { kind: 'deleteArea', areaId: deep }), 403);

		// The region they are assigned to can be renamed and changed, but not moved or deleted
		assert.strictEqual(await statusOf(bea, { kind: 'updateRegion', regionId: beas, update: { name: 'Bea\'s', passageOfTime: 'always_dusk' } }), 200);
		assert.strictEqual(await statusOf(bea, { kind: 'updateRegion', regionId: beas, update: { parents: [] } }), 403);
		assert.strictEqual(await statusOf(bea, { kind: 'deleteRegion', regionId: beas }), 403);
		assert.strictEqual(await statusOf(bea, { kind: 'assignBuilders', regionId: beas, builderIds: [] }), 403);
		assert.strictEqual(await statusOf(bea, { kind: 'deleteRegion', regionId: String(ids['new:sub']) }), 409);

		// Tiles take a permission instead, and a builder with no assignments edits no area
		assert.strictEqual(await statusOf(bea, { kind: 'createTile', ref: 'new:moss', settings: moss }), 403);
		await setUniverseAccess(universeId, bea.playerId, { role: 'builder', languages: [], permissions: { canEditTiles: true, canEditItems: false, canEditMobs: false } });
		assert.strictEqual(await statusOf(bea, { kind: 'createTile', ref: 'new:moss', settings: moss }), 200);
		assert.strictEqual(await statusOf(carl, { kind: 'updateArea', areaId: mine, update: { name: 'Carl\'s' } }), 403);
	});

	it('moves the characters out of the areas a disabled region disables, as each change chose', async () =>
	{
		const universe = await addPlayableUniverse();
		const { universeId, houseAreaId, squareAreaId } = universe;
		const brokkId = await addCharacter((await addPlayer('Bob')).id, universeId, 'Brokk');

		await withoutLobby(universe);
		await setUniverseRole(universeId, ada.playerId, 'creator');

		const ids = await saveAll(ada, universeId, [newRegion('inn', 'Inn', [await testRegionId(universeId)])]);
		const innId = String(ids['new:inn']);

		await saveAll(ada, universeId, [{ kind: 'updateArea', areaId: houseAreaId, update: { parents: [inRegion(innId), inArea(squareAreaId)] } }]);
		await addGroup(universeId, brokkId, null);
		await moveMembers([{ characterId: brokkId, areaId: houseAreaId, column: 3, row: 3 }]);

		const disable: EditorChange = { kind: 'updateRegion', regionId: innId, update: { enabled: false }, moveTo: { [houseAreaId]: 'parent' } };
		const impacts = (await send<SaveImpactPayload>(ada, 'POST', `/${universeId}/changes/impact`, { body: { changes: [disable] } })).body.impacts;

		assert.deepStrictEqual(impacts, [{ changeIndex: 0, kind: 'area', id: houseAreaId, name: 'House', characters: 1, hasParent: true }] satisfies ChangeImpact[]);

		await saveAll(ada, universeId, [disable]);

		const [member] = await listMembersInAreas([squareAreaId]);

		assert.strictEqual(member?.characterId, brokkId);
		assert.strictEqual((await loadArea(houseAreaId))?.area.enabled, false);
	});

	it('moves nobody when a region is disabled in the draft, until the draft is applied', async () =>
	{
		const universe = await addPlayableUniverse();
		const { universeId, houseAreaId } = universe;
		const brokkId = await addCharacter((await addPlayer('Bob')).id, universeId, 'Brokk');
		const bea = await logIn('Bea');

		await withoutLobby(universe);
		await setUniverseRole(universeId, ada.playerId, 'creator');
		await setUniverseRole(universeId, bea.playerId, 'builder');
		await assignToTestRegion(universeId, [bea.playerId]);
		await addGroup(universeId, brokkId, universe.fieldAreaId);
		await moveMembers([{ characterId: brokkId, areaId: houseAreaId, column: 3, row: 3 }]);
		await saveAll(ada, universeId, [{ kind: 'startDraft' }]);

		const draft = (await send<AreaListPayload>(ada, 'GET', `/${universeId}/areas?version=draft`)).body;
		const draftRegion = draft.regions.find((region) => (region.name === TEST_REGION_NAME));

		// The draft copies the regions, with the live region's builders
		assert.ok(draftRegion);
		assert.deepStrictEqual(draft.regions.map((region) => [region.name, region.builderIds]), [[TEST_LOBBY_REGION_NAME, []], [TEST_REGION_NAME, [bea.playerId]]]);
		assert.notStrictEqual(draftRegion.id, await testRegionId(universeId));

		const saved = await send(bea, 'POST', `/${universeId}/changes?version=draft`, { body: { changes: [{ kind: 'updateRegion', regionId: draftRegion.id, update: { enabled: false } }] } });

		assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
		assert.deepStrictEqual((await listMembersInAreas([houseAreaId])).map((member) => member.characterId), [brokkId]);
		assert.strictEqual((await loadArea(houseAreaId))?.area.enabled, true);

		await saveAll(ada, universeId, [{ kind: 'applyDraft', choices: { races: {}, classes: {}, items: {}, areas: { [houseAreaId]: 'start' } } }]);

		assert.deepStrictEqual(await listMembersInAreas([houseAreaId]), []);
		assert.strictEqual((await loadArea(houseAreaId))?.area.enabled, false);

		// The live region keeps its ID, and its builders
		const live = (await send<AreaListPayload>(ada, 'GET', `/${universeId}/areas`)).body;

		assert.deepStrictEqual(live.regions
			.filter((region) => (region.name === TEST_REGION_NAME))
			.map((region) => [region.id, region.enabled, region.builderIds]), [[await testRegionId(universeId), false, [bea.playerId]]]);
	});
});
