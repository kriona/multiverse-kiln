import assert from 'assert';

import { DEFAULT_CLASS_NAMES, emptyPf1eMoney, NEW_PF1E_CLASS_RULES, PF1E_CLASSES, type ClassSettings, type EditorClass } from '@multiverse-kiln/shared';

import { countCustomClasses, createCustomClass, deleteCustomClass, findClassKind, findDefaultClassIds, isClassStartingItem, loadEditorClasses, restoreDefaultClass, saveEditedDefaultClass, updateCustomClass, type CustomClassSettings } from '../../src/db/classRepo.js';
import { findDefaultItemIds } from '../../src/db/itemRepo.js';
import { findDefaultRaceIds } from '../../src/db/raceRepo.js';
import { inTransaction } from '../../src/db/transactions.js';
import { deleteArea } from '../../src/db/areaRepo.js';
import { addUniverse, addArea } from './fixtures.js';

const gunslinger: CustomClassSettings = {
	name: 'Gunslinger',
	enabled: true,
	startingMoney: emptyPf1eMoney(),
	startingItems: [],
	startingAreaId: null,
	raceAreas: [],
	rules: {
		...NEW_PF1E_CLASS_RULES,
		primaryAbility: 'dexterity'
	}
};

/**
 * The ID of one of the Pathfinder 1E default classes
 *
 * @param key The class's key
 * @return Its ID
 */
async function defaultClassId(key: string): Promise<number>
{
	const id = (await findDefaultClassIds('pf1e')).get(key);

	if (id === undefined)
	{
		throw new Error(`The default class "${key}" is missing from the test database`);
	}

	return(id);
}

/**
 * One class as a universe sees it
 *
 * @param universeId The universe's ID
 * @param classId The class's ID
 * @return The class, or undefined when the universe can't use it
 */
async function findClass(universeId: string, classId: number): Promise<EditorClass | undefined>
{
	return((await loadEditorClasses(universeId, 'pf1e')).find((characterClass) => (characterClass.id === classId)));
}

describe('classRepo', () =>
{
	describe('default classes', () =>
	{
		it('are the Pathfinder 1E classes, each with its name message and rules', async () =>
		{
			const universeId = await addUniverse();
			const classes = await loadEditorClasses(universeId, 'pf1e');

			assert.deepStrictEqual(classes.map((characterClass) => characterClass.key), Object.keys(PF1E_CLASSES));

			for (const characterClass of classes)
			{
				const key = characterClass.key as keyof typeof PF1E_CLASSES;

				assert.ok(DEFAULT_CLASS_NAMES.pf1e[key], `${key} has no name message`);
				assert.deepStrictEqual(characterClass, {
					id: characterClass.id,
					key,
					name: null,
					enabled: true,
					startingMoney: emptyPf1eMoney(),
					startingItems: [],
					startingAreaId: null,
					raceAreas: [],
					rules: { ...PF1E_CLASSES[key] },
					custom: false,
					edited: false
				});
			}
		});
	});

	it('adds, changes and deletes a universe\'s own class', async () =>
	{
		const universeId = await addUniverse();
		const areaId = await addArea(universeId);
		const elfId = (await findDefaultRaceIds('pf1e')).get('elf') as number;
		const daggerId = (await findDefaultItemIds('pf1e')).get('dagger') as number;
		const classId = await inTransaction((transaction) => createCustomClass(universeId, 'pf1e', gunslinger, transaction));

		assert.strictEqual(await findClassKind(universeId, 'pf1e', classId), 'custom');
		assert.strictEqual(await findClassKind(await addUniverse('Other'), 'pf1e', classId), undefined);
		assert.strictEqual(await countCustomClasses(universeId), 1);
		assert.deepStrictEqual(await findClass(universeId, classId), { id: classId, key: null, ...gunslinger, custom: true, edited: false });

		const changed: CustomClassSettings = {
			...gunslinger,
			startingMoney: {
				...emptyPf1eMoney(),
				sp: 30
			},
			startingItems: [{ itemId: daggerId, quantity: 1 }],
			raceAreas: [{ raceId: elfId, areaId }],
			rules: {
				primaryAbility: 'wisdom',
				tradition: 'divine',
				castingStyle: 'spontaneous'
			}
		};

		await inTransaction((transaction) => updateCustomClass(universeId, classId, changed, transaction));
		assert.deepStrictEqual(await findClass(universeId, classId), { id: classId, key: null, ...changed, custom: true, edited: false });
		assert.strictEqual(await isClassStartingItem(universeId, daggerId), true);

		// Deleting an area drops the per-race entries that start there
		await deleteArea(areaId);
		assert.deepStrictEqual((await findClass(universeId, classId))?.raceAreas, []);

		await deleteCustomClass(universeId, classId);
		assert.strictEqual(await findClass(universeId, classId), undefined);
		assert.strictEqual(await isClassStartingItem(universeId, daggerId), false);
	});

	it('edits a default class for one universe only, and restores it', async () =>
	{
		const universeId = await addUniverse();
		const otherId = await addUniverse('Other');
		const areaId = await addArea(universeId);
		const wizardId = await defaultClassId('wizard');
		const original = await findClass(universeId, wizardId) as EditorClass;
		const edited: ClassSettings = {
			...original,
			startingAreaId: areaId,
			rules: {
				...original.rules,
				castingStyle: 'spontaneous'
			}
		};

		assert.strictEqual(await findClassKind(universeId, 'pf1e', wizardId), 'default');

		await inTransaction((transaction) => saveEditedDefaultClass(universeId, 'pf1e', wizardId, edited, transaction));
		assert.deepStrictEqual(await findClass(universeId, wizardId), { ...original, ...edited, edited: true });
		assert.deepStrictEqual(await findClass(otherId, wizardId), original);

		// Deleting a class's area leaves its members to start where their race or the universe says
		await deleteArea(areaId);
		assert.strictEqual((await findClass(universeId, wizardId))?.startingAreaId, null);

		await restoreDefaultClass(universeId, wizardId);
		assert.deepStrictEqual(await findClass(universeId, wizardId), original);
	});
});
