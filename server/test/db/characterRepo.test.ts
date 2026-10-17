import assert from 'assert';
import type { CharacterDraft } from '@multiverse-kiln/shared';

import { countCharacters, createCharacter, deleteCharacterDraft, deletePf1eAbilityRoll, findCharacterDraft, findPf1eAbilityRoll, hasCharactersOfClass, hasCharactersOfRace, isCarriedItem, keepPf1eAbilityRoll, listCharacters, saveCharacterDraft, type NewCharacter } from '../../src/db/characterRepo.js';
import { findDefaultClassIds } from '../../src/db/classRepo.js';
import { findDefaultItemIds } from '../../src/db/itemRepo.js';
import { loadOrCreatePlayerByName } from '../../src/db/playerRepo.js';
import { findDefaultRaceIds } from '../../src/db/raceRepo.js';
import { inTransaction } from '../../src/db/transactions.js';
import { addUniverse } from './fixtures.js';

/**
 * A dwarf fighter with a dagger, for a player in a universe
 *
 * @param playerId The player's ID
 * @param universeId The universe's ID
 * @param name The character's name
 * @return The character
 */
async function dwarfFighter(playerId: string, universeId: string, name: string = 'Brokk'): Promise<NewCharacter>
{
	const raceId = (await findDefaultRaceIds('pf1e')).get('dwarf');
	const classId = (await findDefaultClassIds('pf1e')).get('fighter');
	const daggerId = (await findDefaultItemIds('pf1e')).get('dagger');

	if ((raceId === undefined) || (classId === undefined) || (daggerId === undefined))
	{
		throw new Error('The default dwarf, fighter or dagger is missing from the test database');
	}

	return({
		playerId,
		universeId,
		name,
		raceId,
		classId,
		abilityScores: {
			strength: 16,
			dexterity: 12,
			constitution: 16,
			intelligence: 10,
			wisdom: 12,
			charisma: 6
		},
		money: { pp: 0, gp: 15, sp: 5, cp: 0 },
		items: [{ itemId: daggerId, quantity: 2 }],
		zoneId: null
	});
}

describe('characterRepo', () =>
{
	let playerId: string;
	let universeId: string;

	beforeEach(async () =>
	{
		playerId = (await loadOrCreatePlayerByName('Ada')).id;
		universeId = await addUniverse();
	});

	it('lists a player\'s characters in a universe, oldest first', async () =>
	{
		const otherUniverseId = await addUniverse('Elsewhere');
		const otherPlayerId = (await loadOrCreatePlayerByName('Grace')).id;
		const brokk = await dwarfFighter(playerId, universeId);
		const firstId = await inTransaction((transaction) => createCharacter(brokk, transaction));
		const secondId = await inTransaction((transaction) => createCharacter({ ...brokk, name: 'Dain' }, transaction));

		await inTransaction((transaction) => createCharacter({ ...brokk, universeId: otherUniverseId }, transaction));
		await inTransaction((transaction) => createCharacter({ ...brokk, playerId: otherPlayerId }, transaction));

		assert.deepStrictEqual(await listCharacters(playerId, universeId), [
			{ id: firstId, name: 'Brokk', raceId: brokk.raceId, classId: brokk.classId },
			{ id: secondId, name: 'Dain', raceId: brokk.raceId, classId: brokk.classId }
		]);
		assert.strictEqual(await countCharacters(playerId, universeId), 2);
	});

	it('knows which races, classes and items characters have', async () =>
	{
		const brokk = await dwarfFighter(playerId, universeId);
		const elfId = (await findDefaultRaceIds('pf1e')).get('elf') ?? 0;

		assert.strictEqual(await hasCharactersOfRace(brokk.raceId), false);
		await inTransaction((transaction) => createCharacter(brokk, transaction));

		assert.strictEqual(await hasCharactersOfRace(brokk.raceId), true);
		assert.strictEqual(await hasCharactersOfRace(elfId), false);
		assert.strictEqual(await hasCharactersOfClass(brokk.classId), true);
		assert.strictEqual(await isCarriedItem(brokk.items[0].itemId), true);
	});

	it('makes a character without items', async () =>
	{
		const brokk = await dwarfFighter(playerId, universeId);

		await inTransaction((transaction) => createCharacter({ ...brokk, items: [] }, transaction));
		assert.strictEqual(await isCarriedItem(brokk.items[0].itemId), false);
	});

	it('keeps one draft per player and universe', async () =>
	{
		const draft: CharacterDraft = {
			step: 'name',
			name: 'Brokk',
			raceId: null,
			classId: null,
			baseScores: null,
			floatingAbility: null
		};

		assert.strictEqual(await findCharacterDraft(playerId, universeId), undefined);
		await saveCharacterDraft(playerId, universeId, draft);
		await saveCharacterDraft(playerId, universeId, { ...draft, step: 'race' });
		assert.deepStrictEqual(await findCharacterDraft(playerId, universeId), { ...draft, step: 'race' });

		await deleteCharacterDraft(playerId, universeId);
		assert.strictEqual(await findCharacterDraft(playerId, universeId), undefined);
	});

	describe('ability rolls', () =>
	{
		it('keeps the first scores rolled a way, and replaces them when the way changes', async () =>
		{
			const first = { statMethod: 'roll_3d6' as const, scores: [10, 11, 12, 13, 14, 15] };
			const second = { statMethod: 'roll_3d6' as const, scores: [3, 3, 3, 3, 3, 3] };
			const changed = { statMethod: 'roll_4d6_drop_lowest' as const, scores: [18, 17, 16, 15, 14, 13] };

			assert.strictEqual(await findPf1eAbilityRoll(playerId, universeId), undefined);
			assert.deepStrictEqual(await keepPf1eAbilityRoll(playerId, universeId, first), first);
			assert.deepStrictEqual(await keepPf1eAbilityRoll(playerId, universeId, second), first);
			assert.deepStrictEqual(await keepPf1eAbilityRoll(playerId, universeId, changed), changed);
		});

		it('keeps two requests at once to one roll', async () =>
		{
			const rolls = await Promise.all([
				keepPf1eAbilityRoll(playerId, universeId, { statMethod: 'roll_3d6', scores: [10, 10, 10, 10, 10, 10] }),
				keepPf1eAbilityRoll(playerId, universeId, { statMethod: 'roll_3d6', scores: [12, 12, 12, 12, 12, 12] })
			]);

			assert.deepStrictEqual(rolls[0], rolls[1]);
		});

		it('forgets the scores', async () =>
		{
			await keepPf1eAbilityRoll(playerId, universeId, { statMethod: 'roll_3d6', scores: [10, 11, 12, 13, 14, 15] });
			await deletePf1eAbilityRoll(playerId, universeId);

			assert.strictEqual(await findPf1eAbilityRoll(playerId, universeId), undefined);
		});
	});
});
