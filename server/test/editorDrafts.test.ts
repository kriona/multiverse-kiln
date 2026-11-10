import assert from 'assert';
import { universeSlug, type AreaListPayload, type ChangeImpact, type EditableUniverse, type EditorChange, type ItemListPayload, type RaceListPayload, type SaveChangesPayload, type SaveImpactPayload, type SaveRefusedPayload } from '@multiverse-kiln/shared';

import { loadBarredOptions } from '../src/db/barredOptions.js';
import { createCharacter, findCharacterDetails } from '../src/db/characterRepo.js';
import { inTransaction } from '../src/db/transactions.js';
import { setUniverseRole } from '../src/db/universeEditorRepo.js';
import { deleteUniverse, hasDraft } from '../src/db/universeRepo.js';
import { areaChanges, type AreaChange } from '../src/world/areaChanges.js';
import { addCharacter, addPlayableUniverse, addUniverse, defaultRaceId, dwarfFighter, type PlayableUniverse } from './db/fixtures.js';
import { logIn, saveAll, send, type Editor, type EditorResponse } from './editorRequests.js';
import { addPlayer } from './players.js';
import { getTestServer } from './testServer.js';

describe('Universe drafts', () =>
{
	let ada: Editor;
	let universe: PlayableUniverse;
	let playerId: string;
	let brokkId: string;

	before(async () =>
	{
		await getTestServer();
	});

	beforeEach(async () =>
	{
		ada = await logIn('Ada');
		universe = await addPlayableUniverse();
		await setUniverseRole(universe.universeId, ada.playerId, 'creator');
		playerId = (await addPlayer('Bob')).id;
		brokkId = await addCharacter(playerId, universe.universeId, 'Brokk');
	});

	/**
	 * Saves changes to the universe's draft
	 *
	 * @param changes The changes
	 * @param editor The browser saving them
	 * @return The answer
	 */
	function saveToDraft(changes: EditorChange[], editor: Editor = ada): Promise<EditorResponse<SaveChangesPayload & SaveRefusedPayload>>
	{
		return(send<SaveChangesPayload & SaveRefusedPayload>(editor, 'POST', `/${universe.universeId}/changes?version=draft`, { body: { changes } }));
	}

	/**
	 * The universe's areas in one of its versions
	 *
	 * @param version The version
	 * @return The areas, as the Areas tab lists them
	 */
	async function areasOf(version: 'live' | 'draft'): Promise<AreaListPayload>
	{
		const answer = await send<AreaListPayload>(ada, 'GET', `/${universe.universeId}/areas?version=${version}`);

		assert.strictEqual(answer.status, 200, JSON.stringify(answer.body));

		return(answer.body);
	}

	/**
	 * The draft's copy of one of the live areas, found by name
	 *
	 * @param name The area's name
	 * @return The copy's ID
	 */
	async function draftAreaNamed(name: string): Promise<string>
	{
		const area = (await areasOf('draft')).areas.find((each) => (each.name === name));

		assert.ok(area);

		return(area.id);
	}

	it('starts a draft for creators and builders only, and answers for the draft when asked', async () =>
	{
		const bea = await logIn('Bea');

		await setUniverseRole(universe.universeId, bea.playerId, 'beta_tester');
		assert.strictEqual((await send(bea, 'POST', `/${universe.universeId}/changes`, { body: { changes: [{ kind: 'startDraft' }] } })).status, 403);
		assert.strictEqual((await send(ada, 'GET', `/${universe.universeId}?version=draft`)).status, 404);

		await saveAll(ada, universe.universeId, [{ kind: 'startDraft' }]);

		const draft = await send<EditableUniverse>(ada, 'GET', `/${universe.universeId}?version=draft`);
		const live = await send<EditableUniverse>(ada, 'GET', `/${universe.universeId}`);

		assert.strictEqual(draft.body.version, 'draft');
		assert.strictEqual(live.body.version, 'live');
		assert.strictEqual(live.body.hasDraft, true);
		assert.notStrictEqual(draft.body.lobbyAreaId, live.body.lobbyAreaId);

		// A second draft can't be started while there is one
		assert.strictEqual((await send(ada, 'POST', `/${universe.universeId}/changes`, { body: { changes: [{ kind: 'startDraft' }] } })).status, 409);
	});

	it('lets a builder start the draft but not apply or discard it', async () =>
	{
		const bea = await logIn('Bea');

		await setUniverseRole(universe.universeId, bea.playerId, 'builder');
		await saveAll(bea, universe.universeId, [{ kind: 'startDraft' }]);
		assert.strictEqual(await hasDraft(universe.universeId), true);
		assert.strictEqual((await saveToDraft([{ kind: 'discardDraft' }], bea)).status, 403);
		assert.strictEqual((await saveToDraft([{ kind: 'applyDraft', choices: { races: {}, classes: {}, items: {}, areas: {} } }], bea)).status, 403);
		assert.strictEqual(await hasDraft(universe.universeId), true);
	});

	it('keeps builders out of the live version while the universe is let there be light and requires a draft', async () =>
	{
		const bea = await logIn('Bea');
		const rename: EditorChange = { kind: 'updateArea', areaId: universe.houseAreaId, update: { name: 'Inn' } };
		const saveLive = (changes: EditorChange[], editor: Editor) => send<SaveRefusedPayload>(editor, 'POST', `/${universe.universeId}/changes`, { body: { changes } });

		await setUniverseRole(universe.universeId, bea.playerId, 'builder');

		const refused = await saveLive([rename], bea);

		assert.strictEqual(refused.status, 403);
		assert.strictEqual(refused.body.changeIndex, null);
		assert.strictEqual(refused.body.error.id, 'error.builderDraftRequiredSave');

		// Starting a draft is let through, but not after changes to the live version, and changes then go into the draft
		assert.strictEqual((await saveLive([rename, { kind: 'startDraft' }], bea)).status, 403);
		await saveAll(bea, universe.universeId, [{ kind: 'startDraft' }]);
		assert.strictEqual((await saveToDraft([{ kind: 'updateArea', areaId: await draftAreaNamed('House'), update: { name: 'Inn' } }], bea)).status, 200);
		assert.strictEqual((await saveLive([rename], bea)).status, 403);

		// Creators aren't held to it, and turning it off, or another stage, lets builders save to the live version
		assert.strictEqual((await saveLive([rename], ada)).status, 200);
		await saveAll(ada, universe.universeId, [{ kind: 'universe', update: { requireBuilderDraft: false } }]);
		assert.strictEqual((await send<EditableUniverse>(bea, 'GET', `/${universe.universeId}`)).body.requireBuilderDraft, false);
		assert.strictEqual((await saveLive([{ kind: 'updateArea', areaId: universe.houseAreaId, update: { name: 'Tavern' } }], bea)).status, 200);
		await saveAll(ada, universe.universeId, [{ kind: 'universe', update: { requireBuilderDraft: true, stage: 'prologue' } }]);
		assert.strictEqual((await saveLive([{ kind: 'updateArea', areaId: universe.houseAreaId, update: { name: 'Hall' } }], bea)).status, 200);

		// Leaving the universe is always let through
		await saveAll(ada, universe.universeId, [{ kind: 'universe', update: { stage: 'let_there_be_light' } }]);
		assert.strictEqual((await saveLive([{ kind: 'removeEditor', playerId: bea.playerId }], bea)).status, 200);
	});

	it('saves changes to the draft without changing what players see or telling the rooms', async () =>
	{
		await saveAll(ada, universe.universeId, [{ kind: 'startDraft' }]);

		const published: AreaChange[] = [];
		const stop = areaChanges.onChange((change) =>
		{
			published.push(change);
		});

		try
		{
			const answer = await saveToDraft([{ kind: 'updateArea', areaId: await draftAreaNamed('House'), update: { name: 'Inn' } }]);

			assert.strictEqual(answer.status, 200, JSON.stringify(answer.body));
		}
		finally
		{
			stop();
		}

		assert.deepStrictEqual(published, []);
		assert.ok((await areasOf('draft')).areas.some((area) => (area.name === 'Inn')));
		assert.ok((await areasOf('live')).areas.some((area) => ((area.id === universe.houseAreaId) && (area.name === 'House'))));

		// A draft save can't reach the live version's rows
		const refused = await saveToDraft([{ kind: 'updateArea', areaId: universe.houseAreaId, update: { name: 'Tavern' } }]);

		assert.strictEqual(refused.status, 404);
	});

	it('warns before applying about races the draft disables, then applies it under the live IDs', async () =>
	{
		const dwarfId = await defaultRaceId('dwarf');

		await saveAll(ada, universe.universeId, [{ kind: 'startDraft' }]);

		const races = (await send<RaceListPayload>(ada, 'GET', `/${universe.universeId}/races?version=draft`)).body.races;
		const dwarf = races.find((race) => (race.id === dwarfId));

		assert.ok(dwarf);

		const { name, enabled, keepPlaying, startingMoney, startingItems, startingAreaId, startingColumn, startingRow, rules } = dwarf;
		const draftSave = await saveToDraft([
			{ kind: 'saveRace', id: dwarfId, settings: { name, enabled: false, keepPlaying, startingMoney, startingItems, startingAreaId, startingColumn, startingRow, rules } },
			{ kind: 'updateArea', areaId: await draftAreaNamed('House'), update: { name: 'Inn' } }
		]);

		assert.strictEqual(draftSave.status, 200, JSON.stringify(draftSave.body));
		assert.ok(enabled);

		const apply: EditorChange = { kind: 'applyDraft', choices: { races: {}, classes: {}, items: {}, areas: {} } };
		const impacts = await send<SaveImpactPayload>(ada, 'POST', `/${universe.universeId}/changes/impact`, { body: { changes: [apply] } });
		const expected: ChangeImpact[] = [{ changeIndex: 0, kind: 'race', id: dwarfId, name: { key: 'dwarf', name: null }, characters: 1 }];

		assert.deepStrictEqual(impacts.body.impacts, expected);

		const published: AreaChange[] = [];
		const stop = areaChanges.onChange((change) =>
		{
			published.push(change);
		});

		try
		{
			await saveAll(ada, universe.universeId, [{ ...apply, choices: { ...apply.choices, races: { [dwarfId]: false } } }]);
		}
		finally
		{
			stop();
		}

		assert.strictEqual(await hasDraft(universe.universeId), false);
		assert.ok((await areasOf('live')).areas.some((area) => ((area.id === universe.houseAreaId) && (area.name === 'Inn'))));
		assert.ok((await loadBarredOptions(universe.universeId)).raceIds.has(dwarfId));
		assert.ok(published.some((change) => ((change.kind === 'area') && (change.areaId === universe.houseAreaId))));
		assert.strictEqual((await findCharacterDetails(playerId, universe.universeId, 'pf1e', brokkId))?.raceId, dwarfId);
	});

	it('keeps the items the draft deleted that characters carry, disabled, and deletes the rest', async () =>
	{
		const created = await saveAll(ada, universe.universeId, [
			{ kind: 'createItem', ref: 'new:torch', settings: { name: 'Torch', type: 'torch', enabled: true } },
			{ kind: 'createItem', ref: 'new:rope', settings: { name: 'Rope', type: 'rope', enabled: true } }
		]);
		const torchId = Number(created['new:torch']);
		const ropeId = Number(created['new:rope']);
		const thora = await dwarfFighter(playerId, universe.universeId, 'Thora');

		thora.items = [{ itemId: torchId, quantity: 1 }];
		await inTransaction((transaction) => createCharacter(thora, transaction));
		await saveAll(ada, universe.universeId, [{ kind: 'startDraft' }]);

		const draftItems = (await send<ItemListPayload>(ada, 'GET', `/${universe.universeId}/items?custom=true&version=draft`)).body.items;
		const removed = await saveToDraft(draftItems.map((item): EditorChange => ({ kind: 'removeItem', id: item.id })));

		assert.strictEqual(removed.status, 200, JSON.stringify(removed.body));
		assert.strictEqual(draftItems.length, 2);

		await saveAll(ada, universe.universeId, [{ kind: 'applyDraft', choices: { races: {}, classes: {}, items: {}, areas: {} } }]);

		const liveItems = (await send<ItemListPayload>(ada, 'GET', `/${universe.universeId}/items?custom=true`)).body.items;

		assert.deepStrictEqual(liveItems.map((item) => [item.id, item.enabled]), [[torchId, false]]);
		assert.ok(!liveItems.some((item) => (item.id === ropeId)));
	});

	it('refuses a save that applies or discards the draft with other changes, or starts it before them, changing nothing', async () =>
	{
		const rename: EditorChange = { kind: 'updateArea', areaId: universe.houseAreaId, update: { name: 'Tavern' } };
		const apply: EditorChange = { kind: 'applyDraft', choices: { races: {}, classes: {}, items: {}, areas: {} } };
		const discard: EditorChange = { kind: 'discardDraft' };

		/**
		 * Sends a save of the live version that should be refused as a whole
		 *
		 * @param changes The changes
		 * @return The status and the index of the change refused
		 */
		const refusedSave = async (changes: EditorChange[]): Promise<[number, number | null]> =>
		{
			const answer = await send<SaveRefusedPayload>(ada, 'POST', `/${universe.universeId}/changes`, { body: { changes } });

			return([answer.status, answer.body.changeIndex]);
		};

		assert.deepStrictEqual(await refusedSave([{ kind: 'startDraft' }, rename]), [400, 0]);
		assert.strictEqual(await hasDraft(universe.universeId), false);

		await saveAll(ada, universe.universeId, [{ kind: 'startDraft' }]);
		await saveToDraft([{ kind: 'updateArea', areaId: await draftAreaNamed('House'), update: { name: 'Inn' } }]);

		for (const draftChange of [apply, discard])
		{
			assert.deepStrictEqual(await refusedSave([draftChange, rename]), [400, 0], draftChange.kind);
			assert.deepStrictEqual(await refusedSave([rename, draftChange]), [400, 1], draftChange.kind);
		}

		assert.strictEqual(await hasDraft(universe.universeId), true);
		assert.ok((await areasOf('live')).areas.some((area) => ((area.id === universe.houseAreaId) && (area.name === 'House'))));
	});

	it('keeps the draft\'s name and languages apart until it is applied, checking the name again then', async () =>
	{
		const before = (await send<EditableUniverse>(ada, 'GET', `/${universe.universeId}`)).body;
		const newName = `Westmarch ${before.id.slice(0, 8)}`;
		const apply: EditorChange = { kind: 'applyDraft', choices: { races: {}, classes: {}, items: {}, areas: {} } };

		await saveAll(ada, universe.universeId, [{ kind: 'startDraft' }]);

		const renamed = await saveToDraft([{ kind: 'universe', update: { name: newName, translationLanguages: ['fr'] } }]);

		assert.strictEqual(renamed.status, 200, JSON.stringify(renamed.body));

		const live = (await send<EditableUniverse>(ada, 'GET', `/${universe.universeId}`)).body;
		const draft = (await send<EditableUniverse>(ada, 'GET', `/${universe.universeId}?version=draft`)).body;

		assert.deepStrictEqual([live.name, live.translationLanguages], [before.name, before.translationLanguages]);
		assert.deepStrictEqual([draft.name, draft.translationLanguages], [newName, ['fr']]);

		// Another universe takes the name before the draft is applied, so applying is refused and changes nothing
		const other = await addUniverse(newName);
		const refused = await send(ada, 'POST', `/${universe.universeId}/changes`, { body: { changes: [apply] } });

		assert.strictEqual(refused.status, 409);
		assert.strictEqual(await hasDraft(universe.universeId), true);
		assert.strictEqual((await send<EditableUniverse>(ada, 'GET', `/${universe.universeId}`)).body.name, before.name);

		await deleteUniverse(other);
		await saveAll(ada, universe.universeId, [apply]);

		const applied = (await send<EditableUniverse>(ada, 'GET', `/${universe.universeId}`)).body;

		assert.deepStrictEqual([applied.name, applied.slug, applied.translationLanguages], [newName, universeSlug(newName), ['fr']]);
	});

	it('discards the draft, leaving the live version as it was', async () =>
	{
		await saveAll(ada, universe.universeId, [{ kind: 'startDraft' }]);
		await saveToDraft([{ kind: 'updateArea', areaId: await draftAreaNamed('House'), update: { name: 'Inn' } }]);

		const before = await areasOf('live');

		await saveAll(ada, universe.universeId, [{ kind: 'discardDraft' }]);

		assert.strictEqual(await hasDraft(universe.universeId), false);
		assert.deepStrictEqual(await areasOf('live'), before);

		const gone = await send<{ error: { id: string } }>(ada, 'GET', `/${universe.universeId}/areas?version=draft`);

		assert.strictEqual(gone.status, 404);
		assert.strictEqual(gone.body.error.id, 'error.noSuchDraft');
	});
});
