import assert from 'assert';

import { DEFAULT_CLASS_NAMES, emptyMoney, NEW_PF1E_CLASS_RULES, PF1E_CLASSES, type ClassSettings, type EditorClass } from '@multiverse-kiln/shared';

import { countCustomClasses, createCustomClass, deleteCustomClass, findClassKind, findDefaultClassIds, isClassStartingItem, loadClassNames, loadEditorClasses, loadLiveClassNames, restoreDefaultClass, saveEditedDefaultClass, updateCustomClass, type CustomClassSettings } from '../../src/db/classRepo.js';
import { findDefaultItemIds } from '../../src/db/itemRepo.js';
import { findDefaultRaceIds } from '../../src/db/raceRepo.js';
import { inTransaction } from '../../src/db/transactions.js';
import { deleteArea } from '../../src/db/areaRepo.js';
import { startDraft } from '../../src/db/universeDraftRepo.js';
import { createUniverse } from '../../src/db/universeRepo.js';
import { draftVersion, liveVersion } from '../../src/db/universeVersions.js';
import { addUniverse, addArea } from './fixtures.js';

const gunslinger: CustomClassSettings = {
	name: 'Gunslinger',
	enabled: true,
	keepPlaying: true,
	startingMoney: emptyMoney(),
	startingItems: [],
	startingAreaId: null,
	startingColumn: 0,
	startingRow: 0,
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
	return((await loadEditorClasses(liveVersion(universeId), 'pf1e')).find((characterClass) => (characterClass.id === classId)));
}

describe('classRepo', () =>
{
	describe('default classes', () =>
	{
		it('are the Pathfinder 1E classes, each with its name message and rules', async () =>
		{
			const universeId = await addUniverse();
			const classes = await loadEditorClasses(liveVersion(universeId), 'pf1e');

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
					keepPlaying: true,
					startingMoney: emptyMoney(),
					startingItems: [],
					startingAreaId: null,
					startingColumn: 0,
					startingRow: 0,
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
		const classId = await inTransaction((transaction) => createCustomClass(liveVersion(universeId), 'pf1e', gunslinger, transaction));

		assert.strictEqual(await findClassKind(liveVersion(universeId), 'pf1e', classId), 'custom');
		assert.strictEqual(await findClassKind(liveVersion(await addUniverse('Other')), 'pf1e', classId), undefined);
		assert.strictEqual(await countCustomClasses(liveVersion(universeId)), 1);
		assert.deepStrictEqual(await findClass(universeId, classId), { id: classId, key: null, ...gunslinger, custom: true, edited: false });

		const changed: CustomClassSettings = {
			...gunslinger,
			startingMoney: {
				...emptyMoney(),
				sp: 30
			},
			startingItems: [{ itemId: daggerId, quantity: 1 }],
			raceAreas: [{ raceId: elfId, areaId, column: -4, row: 7 }],
			rules: {
				primaryAbility: 'wisdom',
				tradition: 'divine',
				castingStyle: 'spontaneous'
			}
		};

		await inTransaction((transaction) => updateCustomClass(liveVersion(universeId), 'pf1e', classId, changed, transaction));
		assert.deepStrictEqual(await findClass(universeId, classId), { id: classId, key: null, ...changed, custom: true, edited: false });
		assert.strictEqual(await isClassStartingItem(liveVersion(universeId), daggerId), true);

		// Deleting an area drops the per-race entries that start there
		await deleteArea(areaId);
		assert.deepStrictEqual((await findClass(universeId, classId))?.raceAreas, []);

		await deleteCustomClass(liveVersion(universeId), classId);
		assert.strictEqual(await findClass(universeId, classId), undefined);
		assert.strictEqual(await isClassStartingItem(liveVersion(universeId), daggerId), false);
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

		assert.strictEqual(await findClassKind(liveVersion(universeId), 'pf1e', wizardId), 'default');

		await inTransaction((transaction) => saveEditedDefaultClass(liveVersion(universeId), 'pf1e', wizardId, edited, transaction));
		assert.deepStrictEqual(await findClass(universeId, wizardId), { ...original, ...edited, edited: true });
		assert.deepStrictEqual(await findClass(otherId, wizardId), original);

		// Deleting a class's area leaves its members to start where their race or the universe says
		await deleteArea(areaId);
		assert.strictEqual((await findClass(universeId, wizardId))?.startingAreaId, null);

		await restoreDefaultClass(liveVersion(universeId), wizardId);
		assert.deepStrictEqual(await findClass(universeId, wizardId), original);
	});

	it('names the classes of several universes\' live versions at once, as it names one', async () =>
	{
		const editedId = await addUniverse('Edited');
		const plainId = await addUniverse('Plain');
		const starfinderId = await createUniverse({
			name: 'Starfinder',
			ruleset: 'sf1e'
		});
		const wizardId = await defaultClassId('wizard');
		const wizard = await findClass(editedId, wizardId) as EditorClass;
		const gunslingerId = await inTransaction((transaction) => createCustomClass(liveVersion(editedId), 'pf1e', gunslinger, transaction));

		await inTransaction((transaction) => saveEditedDefaultClass(liveVersion(editedId), 'pf1e', wizardId, { ...wizard, name: 'Mage' }, transaction));
		await inTransaction((transaction) => startDraft(editedId, transaction));
		await inTransaction((transaction) => saveEditedDefaultClass(draftVersion(editedId), 'pf1e', wizardId, { ...wizard, name: 'Draft Mage' }, transaction));

		const universes = [
			{ id: editedId, ruleset: 'pf1e' as const },
			{ id: plainId, ruleset: 'pf1e' as const },
			{ id: starfinderId, ruleset: 'sf1e' as const }
		];
		const names = await loadLiveClassNames(universes);

		for (const { id, ruleset } of universes)
		{
			assert.deepStrictEqual(names.get(id), await loadClassNames(liveVersion(id), ruleset));
		}

		assert.deepStrictEqual(names.get(editedId)?.get(wizardId), { key: 'wizard', name: 'Mage' });
		assert.deepStrictEqual(names.get(editedId)?.get(gunslingerId), { key: null, name: 'Gunslinger' });
		assert.deepStrictEqual(names.get(plainId)?.get(wizardId), { key: 'wizard', name: null });
		assert.strictEqual(names.get(plainId)?.has(gunslingerId), false);
		assert.strictEqual(names.get(starfinderId)?.has(wizardId), false);
		assert.deepStrictEqual(await loadLiveClassNames([]), new Map());
	});
});
