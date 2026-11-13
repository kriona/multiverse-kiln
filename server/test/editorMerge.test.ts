import assert from 'assert';
import { NO_BUILDER_PERMISSIONS, settleConflict, settleTextConflict, sourceTextHash, type ClassListPayload, type EditorChange, type EditorClass, type EditorRace, type RaceListPayload, type SaveChangesPayload, type SaveRefusedPayload, type UniverseTextRef } from '@multiverse-kiln/shared';

import { findUniverseAccess, setUniverseAccess, setUniverseRole } from '../src/db/universeEditorRepo.js';
import { findTranslation } from '../src/db/universeTextRepo.js';
import { liveVersion } from '../src/db/universeVersions.js';
import { createArea, createUniverse, logIn, saveChanges, send, type Editor } from './editorRequests.js';
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

	describe('settings that can\'t be set together', () =>
	{
		let areaId: string;
		let elfId: number;

		/**
		 * The fighter class as the universe has it saved
		 *
		 * @return The class
		 */
		async function findFighter(): Promise<EditorClass>
		{
			const characterClass = (await send<ClassListPayload>(ada, 'GET', `/${universeId}/classes`)).body.classes.find((candidate) => (candidate.key === 'fighter'));

			assert.ok(characterClass, 'no fighter');

			return(characterClass);
		}

		/**
		 * A change to a class made from the class as the editor loaded it
		 *
		 * @param loaded The class as loaded
		 * @param settings The settings the editor changed it to
		 * @return The change
		 */
		function saveClass(loaded: EditorClass, settings: Partial<EditorClass>): EditorChange & { kind: 'saveClass' }
		{
			return({
				kind: 'saveClass',
				id: loaded.id,
				settings: { ...loaded, ...settings },
				loaded: { ...loaded }
			});
		}

		beforeEach(async () =>
		{
			areaId = await createArea(ada, universeId, { name: 'Meadow' });
			elfId = (await findRace('elf')).id;
		});

		it('conflicts on a class\'s own starting area and its areas by race, rather than saving both', async () =>
		{
			const fighter = await findFighter();

			assert.strictEqual((await saveChanges(ada, universeId, [saveClass(fighter, { startingAreaId: areaId, startingColumn: 2, startingRow: 3 })])).status, 200);

			const change = saveClass(fighter, { raceAreas: [{ raceId: elfId, areaId, column: 1, row: 1 }] });
			const refused = await saveChanges(grace, universeId, [change]);

			assert.strictEqual(refused.status, 409);
			assert.deepStrictEqual(refused.body.conflicts?.map((conflict) => [conflict.field, conflict.mine, conflict.theirs, conflict.savedBy?.name]), [
				[
					'startingArea',
					{ field: 'raceAreas', value: [{ race: { key: 'elf', name: null }, place: { area: 'Meadow', column: 1, row: 1 } }] },
					{ field: 'startingArea', value: { area: 'Meadow', column: 2, row: 3 } },
					'Ada'
				]
			]);
			assert.deepStrictEqual([(await findFighter()).startingAreaId, (await findFighter()).raceAreas], [areaId, []]);

			const [conflict] = (refused.body.conflicts ?? []);

			assert.ok(conflict);
			assert.strictEqual((await saveChanges(grace, universeId, [settleConflict(change, conflict.saved, true)])).status, 200);

			const kept = await findFighter();

			assert.deepStrictEqual([kept.startingAreaId, kept.raceAreas], [null, [{ raceId: elfId, areaId, column: 1, row: 1 }]]);
		});

		it('takes the class\'s saved areas by race, without the starting area of its own, when the editor chooses theirs', async () =>
		{
			const fighter = await findFighter();

			assert.strictEqual((await saveChanges(ada, universeId, [saveClass(fighter, { raceAreas: [{ raceId: elfId, areaId, column: 1, row: 1 }] })])).status, 200);

			const change = saveClass(fighter, { startingAreaId: areaId, startingColumn: 2, startingRow: 3 });
			const refused = await saveChanges(grace, universeId, [change]);

			assert.strictEqual(refused.status, 409);
			assert.strictEqual((await saveChanges(grace, universeId, [settleConflict(change, refused.body.conflicts![0].saved, false)])).status, 200);

			const taken = await findFighter();

			assert.deepStrictEqual([taken.startingAreaId, taken.raceAreas], [null, [{ raceId: elfId, areaId, column: 1, row: 1 }]]);
		});

		it('conflicts on an editor\'s role and languages, so taking theirs saves a role with the languages it allows', async () =>
		{
			const hopper = await logIn('Hopper');
			const loaded = {
				role: 'translator',
				languages: ['fr']
			} as const;

			await setUniverseAccess(universeId, hopper.playerId, { ...loaded, languages: [...loaded.languages] });
			assert.strictEqual((await saveChanges(ada, universeId, [{
				kind: 'saveEditor',
				playerId: hopper.playerId,
				settings: {
					role: 'translator',
					languages: ['de']
				},
				loaded
			}])).status, 200);

			const change: EditorChange & { kind: 'saveEditor' } = {
				kind: 'saveEditor',
				playerId: hopper.playerId,
				settings: {
					role: 'builder',
					languages: []
				},
				loaded: { ...loaded }
			};
			const refused = await saveChanges(grace, universeId, [change]);

			assert.strictEqual(refused.status, 409);
			assert.deepStrictEqual(refused.body.conflicts?.map((conflict) => [conflict.field, conflict.mine, conflict.theirs]), [
				['role', { field: 'role', value: 'builder' }, { field: 'languages', value: ['de'] }]
			]);
			assert.strictEqual((await saveChanges(grace, universeId, [settleConflict(change, refused.body.conflicts[0].saved, false)])).status, 200);
			assert.deepStrictEqual(await findUniverseAccess(universeId, hopper.playerId), {
				role: 'translator',
				languages: ['de'],
				permissions: NO_BUILDER_PERMISSIONS
			});
		});
	});

	describe('translations and notes', () =>
	{
		let meadow: UniverseTextRef;

		/**
		 * A translation of the meadow's name into French, made from the translation as loaded
		 *
		 * @param translation The translation, or null to delete it
		 * @param loaded The translation as loaded, or null for none
		 * @return The change
		 */
		function translate(translation: string | null, loaded: string | null): EditorChange & { kind: 'saveTranslation' }
		{
			return({
				kind: 'saveTranslation',
				text: meadow,
				language: 'fr',
				translation,
				sourceHash: sourceTextHash('Meadow'),
				loaded
			});
		}

		beforeEach(async () =>
		{
			meadow = {
				kind: 'area',
				thingId: await createArea(ada, universeId, { name: 'Meadow' }),
				field: 'name'
			};
			assert.strictEqual((await saveChanges(ada, universeId, [{ kind: 'universe', update: { translationLanguages: ['fr'] } }])).status, 200);
		});

		it('refuses a translation another translator saved since, naming the text and who saved it', async () =>
		{
			assert.strictEqual((await saveChanges(ada, universeId, [translate('Prairie', null)])).status, 200);

			const change = translate('Pré', null);
			const refused = await saveChanges(grace, universeId, [change]);

			assert.strictEqual(refused.status, 409);
			assert.deepStrictEqual(refused.body.conflicts?.map((conflict) => [conflict.subject, conflict.target, conflict.text, conflict.savedBy]), [
				['translations', { key: null, name: 'fr' }, { place: { ...meadow, thingName: 'Meadow' }, mine: 'Pré', theirs: 'Prairie' }, { name: 'Ada', username: usernameFor('Ada') }]
			]);

			const [conflict] = (refused.body.conflicts ?? []);

			assert.ok(conflict);
			assert.strictEqual((await saveChanges(grace, universeId, [settleTextConflict(change, conflict.saved, true)])).status, 200);

			const saved = await findTranslation(liveVersion(universeId), meadow, 'fr');

			assert.deepStrictEqual([saved?.text, saved?.savedBy?.name], ['Pré', 'Grace']);
		});

		it('saves nothing when the translator takes the one saved', async () =>
		{
			assert.strictEqual((await saveChanges(ada, universeId, [translate('Prairie', null)])).status, 200);

			const change = translate(null, null);
			const refused = await saveChanges(grace, universeId, [change]);

			assert.strictEqual(refused.status, 409);
			assert.strictEqual((await saveChanges(grace, universeId, [settleTextConflict(change, refused.body.conflicts![0].saved, false)])).status, 200);

			const saved = await findTranslation(liveVersion(universeId), meadow, 'fr');

			assert.deepStrictEqual([saved?.text, saved?.savedBy?.name], ['Prairie', 'Ada']);
		});

		it('saves a translation over one saved since that is the same', async () =>
		{
			assert.strictEqual((await saveChanges(ada, universeId, [translate('Prairie', null)])).status, 200);
			assert.strictEqual((await saveChanges(grace, universeId, [translate('Prairie', null)])).status, 200);
			assert.strictEqual((await findTranslation(liveVersion(universeId), meadow, 'fr'))?.savedBy?.name, 'Ada');
		});

		it('refuses a note for translators another editor wrote since', async () =>
		{
			assert.strictEqual((await saveChanges(ada, universeId, [{ kind: 'saveTranslatorNote', text: meadow, note: 'A field', loaded: null }])).status, 200);

			const refused = await saveChanges(grace, universeId, [{ kind: 'saveTranslatorNote', text: meadow, note: 'Grassland', loaded: null }]);

			assert.strictEqual(refused.status, 409);
			assert.deepStrictEqual(refused.body.conflicts?.map((conflict) => [conflict.subject, conflict.saved, conflict.text?.theirs, conflict.savedBy?.name]), [
				['translatorNotes', { note: 'A field' }, 'A field', 'Ada']
			]);
		});
	});
});
