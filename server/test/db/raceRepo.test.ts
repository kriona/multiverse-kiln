import assert from 'assert';

import { DEFAULT_RACE_NAMES, emptyMoney, NEW_PF1E_RACE_RULES, PF1E_RACES, pf1eRaceRules, type EditorRace, type RaceSettings } from '@multiverse-kiln/shared';

import { findDefaultItemIds } from '../../src/db/itemRepo.js';
import { countCustomRaces, createCustomRace, deleteCustomRace, findDefaultRaceIds, findRaceKind, isRaceStartingItem, loadEditorRaces, restoreDefaultRace, saveEditedDefaultRace, updateCustomRace, type CustomRaceSettings } from '../../src/db/raceRepo.js';
import { inTransaction } from '../../src/db/transactions.js';
import { addUniverse, addArea } from './fixtures.js';

const lizardfolk: CustomRaceSettings = {
	name: 'Lizardfolk',
	enabled: true,
	startingMoney: emptyMoney(),
	startingItems: [],
	startingAreaId: null,
	startingColumn: 0,
	startingRow: 0,
	rules: {
		...NEW_PF1E_RACE_RULES,
		abilityModifiers: {
			...NEW_PF1E_RACE_RULES.abilityModifiers,
			strength: 2
		}
	}
};

/**
 * The ID of one of the Pathfinder 1E default races
 *
 * @param key The race's key
 * @return Its ID
 */
async function defaultRaceId(key: string): Promise<number>
{
	const id = (await findDefaultRaceIds('pf1e')).get(key);

	if (id === undefined)
	{
		throw new Error(`The default race "${key}" is missing from the test database`);
	}

	return(id);
}

/**
 * One race as a universe sees it
 *
 * @param universeId The universe's ID
 * @param raceId The race's ID
 * @return The race, or undefined when the universe can't use it
 */
async function findRace(universeId: string, raceId: number): Promise<EditorRace | undefined>
{
	return((await loadEditorRaces(universeId, 'pf1e')).find((race) => (race.id === raceId)));
}

describe('raceRepo', () =>
{
	describe('default races', () =>
	{
		it('are the Pathfinder 1E races, each with its name message and rules', async () =>
		{
			const universeId = await addUniverse();
			const races = await loadEditorRaces(universeId, 'pf1e');

			assert.deepStrictEqual(races.map((race) => race.key), Object.keys(PF1E_RACES));

			for (const race of races)
			{
				const key = race.key as keyof typeof PF1E_RACES;

				assert.ok(DEFAULT_RACE_NAMES.pf1e[key], `${key} has no name message`);
				assert.deepStrictEqual(race, {
					id: race.id,
					key,
					name: null,
					enabled: true,
					startingMoney: emptyMoney(),
					startingItems: [],
					startingAreaId: null,
					startingColumn: 0,
					startingRow: 0,
					rules: pf1eRaceRules(PF1E_RACES[key]),
					custom: false,
					edited: false
				}, `${key} differs from PF1E_RACES`);
			}
		});
	});

	it('adds, changes and deletes a universe\'s own race', async () =>
	{
		const universeId = await addUniverse();
		const areaId = await addArea(universeId);
		const daggerId = (await findDefaultItemIds('pf1e')).get('dagger') as number;
		const raceId = await inTransaction((transaction) => createCustomRace(universeId, 'pf1e', lizardfolk, transaction));

		assert.strictEqual(await findRaceKind(universeId, 'pf1e', raceId), 'custom');
		assert.strictEqual(await findRaceKind(await addUniverse('Other'), 'pf1e', raceId), undefined);
		assert.strictEqual(await countCustomRaces(universeId), 1);
		assert.deepStrictEqual(await findRace(universeId, raceId), { id: raceId, key: null, ...lizardfolk, custom: true, edited: false });

		const changed: CustomRaceSettings = {
			...lizardfolk,
			name: 'Saurian',
			startingMoney: {
				...emptyMoney(),
				gp: 5
			},
			startingItems: [{ itemId: daggerId, quantity: 2 }],
			startingAreaId: areaId,
			startingColumn: 5,
			startingRow: -3,
			rules: {
				...lizardfolk.rules,
				darkvision: 'superior',
				lightSensitivity: true,
				size: 'large'
			}
		};

		await inTransaction((transaction) => updateCustomRace(universeId, 'pf1e', raceId, changed, transaction));
		assert.deepStrictEqual(await findRace(universeId, raceId), { id: raceId, key: null, ...changed, custom: true, edited: false });
		assert.strictEqual(await isRaceStartingItem(universeId, daggerId), true);

		await deleteCustomRace(universeId, raceId);
		assert.strictEqual(await findRace(universeId, raceId), undefined);
		assert.strictEqual(await isRaceStartingItem(universeId, daggerId), false);
	});

	it('edits a default race for one universe only, and restores it', async () =>
	{
		const universeId = await addUniverse();
		const otherId = await addUniverse('Other');
		const dwarfId = await defaultRaceId('dwarf');
		const daggerId = (await findDefaultItemIds('pf1e')).get('dagger') as number;
		const original = await findRace(universeId, dwarfId) as EditorRace;
		const edited: RaceSettings = {
			...original,
			enabled: false,
			startingItems: [{ itemId: daggerId, quantity: 1 }],
			rules: {
				...original.rules,
				size: 'small'
			}
		};

		assert.strictEqual(await findRaceKind(universeId, 'pf1e', dwarfId), 'default');

		await inTransaction((transaction) => saveEditedDefaultRace(universeId, 'pf1e', dwarfId, edited, transaction));
		assert.deepStrictEqual(await findRace(universeId, dwarfId), { ...original, ...edited, edited: true });
		assert.deepStrictEqual(await findRace(otherId, dwarfId), original);
		assert.strictEqual(await countCustomRaces(universeId), 0);
		assert.strictEqual(await isRaceStartingItem(universeId, daggerId), true);
		assert.strictEqual(await isRaceStartingItem(otherId, daggerId), false);

		// Saving again replaces the copy rather than adding another
		await inTransaction((transaction) => saveEditedDefaultRace(universeId, 'pf1e', dwarfId, { ...edited, name: 'Mountain Folk' }, transaction));
		assert.strictEqual((await findRace(universeId, dwarfId))?.name, 'Mountain Folk');
		assert.strictEqual((await loadEditorRaces(universeId, 'pf1e')).length, Object.keys(PF1E_RACES).length);

		await restoreDefaultRace(universeId, dwarfId);
		assert.deepStrictEqual(await findRace(universeId, dwarfId), original);
		assert.strictEqual(await isRaceStartingItem(universeId, daggerId), false);
	});
});
