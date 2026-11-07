import assert from 'assert';
import { settleConflict, type EditorChange, type EditorRace, type RaceListPayload, type SaveChangesPayload, type SaveRefusedPayload } from '@multiverse-kiln/shared';

import { setUniverseRole } from '../src/db/universeEditorRepo.js';
import { createUniverse, logIn, saveChanges, send, type Editor } from './editorRequests.js';
import { usernameFor } from './players.js';
import { getTestServer } from './testServer.js';

describe('Saving only what changed', () =>
{
	let ada: Editor;
	let grace: Editor;
	let universeId: string;

	/**
	 * A race as one version of the universe has it saved
	 *
	 * @param key The race's key among the ruleset's defaults
	 * @param version The version, live when left out
	 * @return The race
	 */
	async function findRace(key: string, version?: 'draft'): Promise<EditorRace>
	{
		const query = ((version === undefined) ? '' : `?version=${version}`);
		const races = (await send<RaceListPayload>(ada, 'GET', `/${universeId}/races${query}`)).body.races;
		const race = races.find((candidate) => (candidate.key === key));

		assert.ok(race, `no race ${key}`);

		return(race);
	}

	/**
	 * A change to a race made from the race as the editor loaded it
	 *
	 * @param loaded The race as loaded
	 * @param settings The settings the editor changed it to
	 * @return The change
	 */
	function saveRace(loaded: EditorRace, settings: Partial<EditorRace>): EditorChange & { kind: 'saveRace' }
	{
		return({
			kind: 'saveRace',
			id: loaded.id,
			settings: { ...loaded, ...settings },
			loaded: { ...loaded }
		});
	}

	before(async () =>
	{
		await getTestServer();
	});

	beforeEach(async () =>
	{
		ada = await logIn('Ada');
		grace = await logIn('Grace');
		universeId = await createUniverse(ada);
		await setUniverseRole(universeId, grace.playerId, 'creator');
	});

	it('saves both editors\' changes to different settings of one race', async () =>
	{
		const dwarf = await findRace('dwarf');

		assert.strictEqual((await saveChanges(ada, universeId, [saveRace(dwarf, { name: 'Stout' })])).status, 200);
		assert.strictEqual((await saveChanges(grace, universeId, [saveRace(dwarf, { rules: { ...dwarf.rules, size: 'large' } })])).status, 200);

		const saved = await findRace('dwarf');

		assert.deepStrictEqual([saved.name, saved.rules.size], ['Stout', 'large']);
	});

	it('refuses a setting another editor changed since, naming it, its value and who saved it, and saves nothing', async () =>
	{
		const dwarf = await findRace('dwarf');

		assert.strictEqual((await saveChanges(ada, universeId, [saveRace(dwarf, { name: 'Stout' })])).status, 200);

		const change = saveRace(dwarf, { name: 'Hardy', rules: { ...dwarf.rules, size: 'large' } });
		const refused = await saveChanges(grace, universeId, [change]);

		assert.strictEqual(refused.status, 409);
		assert.strictEqual(refused.body.changeIndex, 0);
		assert.deepStrictEqual(refused.body.conflicts?.map((conflict) => [conflict.subject, conflict.field, conflict.saved, conflict.mine, conflict.theirs, conflict.savedBy]), [
			['race', 'name', { name: 'Stout' }, { field: 'name', value: 'Hardy' }, { field: 'name', value: 'Stout' }, { name: 'Ada', username: usernameFor('Ada') }]
		]);
		assert.strictEqual((await findRace('dwarf')).rules.size, dwarf.rules.size);

		const [conflict] = (refused.body.conflicts ?? []);

		assert.ok(conflict);

		const kept = await saveChanges(grace, universeId, [settleConflict(change, conflict.saved, true)]);

		assert.strictEqual(kept.status, 200);
		assert.deepStrictEqual([(await findRace('dwarf')).name, (await findRace('dwarf')).rules.size], ['Hardy', 'large']);
	});

	it('takes the saved value when the editor chooses theirs', async () =>
	{
		const dwarf = await findRace('dwarf');

		assert.strictEqual((await saveChanges(ada, universeId, [saveRace(dwarf, { name: 'Stout' })])).status, 200);

		const change = saveRace(dwarf, { name: 'Hardy', rules: { ...dwarf.rules, size: 'large' } });
		const refused = await saveChanges(grace, universeId, [change]);
		const taken = await saveChanges(grace, universeId, [settleConflict(change, refused.body.conflicts![0].saved, false)]);

		assert.strictEqual(taken.status, 200);
		assert.deepStrictEqual([(await findRace('dwarf')).name, (await findRace('dwarf')).rules.size], ['Stout', 'large']);
	});

	it('doesn\'t count two changes to one race in the same save as a conflict', async () =>
	{
		const dwarf = await findRace('dwarf');
		const named = { ...dwarf, name: 'Stout' };

		assert.strictEqual((await saveChanges(ada, universeId, [
			saveRace(dwarf, { name: 'Stout' }),
			saveRace(named, { rules: { ...dwarf.rules, size: 'large' } })
		])).status, 200);
		assert.deepStrictEqual([(await findRace('dwarf')).name, (await findRace('dwarf')).rules.size], ['Stout', 'large']);
	});

	it('keeps the settings of a form another editor saved, when the change leaves them as loaded', async () =>
	{
		const universe = (await send<{ groupSize: number; shortDescription: string }>(ada, 'GET', `/${universeId}`)).body;

		assert.strictEqual((await saveChanges(ada, universeId, [{ kind: 'universe', update: { groupSize: 3 }, loaded: { groupSize: universe.groupSize } }])).status, 200);
		assert.strictEqual((await saveChanges(grace, universeId, [{
			kind: 'universe',
			update: { groupSize: universe.groupSize, shortDescription: 'Changed' },
			loaded: { groupSize: universe.groupSize, shortDescription: universe.shortDescription }
		}])).status, 200);

		const saved = (await send<{ groupSize: number; shortDescription: string }>(ada, 'GET', `/${universeId}`)).body;

		assert.deepStrictEqual([saved.groupSize, saved.shortDescription], [3, 'Changed']);
	});

	it('doesn\'t let a change to a race in the draft conflict with one to it in the live version', async () =>
	{
		const dwarf = await findRace('dwarf');

		assert.strictEqual((await saveChanges(ada, universeId, [{ kind: 'startDraft' }])).status, 200);

		const draftDwarf = await findRace('dwarf', 'draft');
		const draftSave = await send<SaveChangesPayload & SaveRefusedPayload>(grace, 'POST', `/${universeId}/changes?version=draft`, { body: { changes: [saveRace(draftDwarf, { name: 'Draft Dwarf' })] } });

		assert.strictEqual(draftSave.status, 200);
		assert.strictEqual((await saveChanges(ada, universeId, [saveRace(dwarf, { name: 'Live Dwarf' })])).status, 200);
		assert.deepStrictEqual([(await findRace('dwarf')).name, (await findRace('dwarf', 'draft')).name], ['Live Dwarf', 'Draft Dwarf']);
	});
});
