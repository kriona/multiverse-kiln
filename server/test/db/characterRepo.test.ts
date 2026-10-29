import assert from 'assert';
import type { CharacterDraft } from '@multiverse-kiln/shared';

import { countCharacters, createCharacter, deleteCharacter, deleteCharacterDraft, deletePf1eAbilityRoll, findCharacterDetails, findCharacterDraft, findPf1eAbilityRoll, hasCharactersOfClass, hasCharactersOfRace, isCarriedItem, keepPf1eAbilityRoll, listCharacters, listPlayableCharacters, listProfileCharacters, markCharacterPlayed, purgeExpiredCharacters, restoreCharacter, saveCharacterDraft, scheduleCharacterDeletion, setCharacterVisibility } from '../../src/db/characterRepo.js';
import { addPlayer } from '../players.js';
import { findDefaultRaceIds } from '../../src/db/raceRepo.js';
import { inTransaction } from '../../src/db/transactions.js';
import { createUniverse } from '../../src/db/universeRepo.js';
import { addUniverse, dwarfFighter } from './fixtures.js';

describe('characterRepo', () =>
{
	let playerId: string;
	let universeId: string;

	beforeEach(async () =>
	{
		playerId = (await addPlayer('Ada')).id;
		universeId = await addUniverse();
	});

	it('lists a player\'s characters in a universe, oldest first', async () =>
	{
		const otherUniverseId = await addUniverse('Elsewhere');
		const otherPlayerId = (await addPlayer('Grace')).id;
		const brokk = await dwarfFighter(playerId, universeId);
		const firstId = await inTransaction((transaction) => createCharacter(brokk, transaction));
		const secondId = await inTransaction((transaction) => createCharacter({ ...brokk, name: 'Dain' }, transaction));

		await inTransaction((transaction) => createCharacter({ ...brokk, universeId: otherUniverseId }, transaction));
		await inTransaction((transaction) => createCharacter({ ...brokk, playerId: otherPlayerId }, transaction));

		assert.deepStrictEqual(await listCharacters(playerId, universeId), [
			{ id: firstId, name: 'Brokk', raceId: brokk.raceId, classId: brokk.classId, deleteAt: null, groupId: null },
			{ id: secondId, name: 'Dain', raceId: brokk.raceId, classId: brokk.classId, deleteAt: null, groupId: null }
		]);
		assert.strictEqual(await countCharacters(playerId, universeId), 2);
	});

	it('lists a player\'s characters for the lobby, the one played or made most recently first', async () =>
	{
		const brokk = await dwarfFighter(playerId, universeId);
		const firstId = await inTransaction((transaction) => createCharacter(brokk, transaction));
		const secondId = await inTransaction((transaction) => createCharacter({ ...brokk, name: 'Dain' }, transaction));
		const otherUniverseId = await addUniverse('Elsewhere');

		await inTransaction((transaction) => createCharacter({ ...brokk, universeId: otherUniverseId }, transaction));

		assert.deepStrictEqual(await listPlayableCharacters(playerId, universeId), [
			{ id: secondId, name: 'Dain', raceId: brokk.raceId },
			{ id: firstId, name: 'Brokk', raceId: brokk.raceId }
		]);

		await markCharacterPlayed(firstId, new Date(Date.now() + 1000));

		assert.deepStrictEqual((await listPlayableCharacters(playerId, universeId)).map(({ id }) => id), [firstId, secondId]);
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

	it('finds one of a player\'s characters with their scores, money and items', async () =>
	{
		const otherPlayerId = (await addPlayer('Grace')).id;
		const otherUniverseId = await addUniverse('Elsewhere');
		const brokk = await dwarfFighter(playerId, universeId);
		const characterId = await inTransaction((transaction) => createCharacter(brokk, transaction));

		assert.deepStrictEqual(await findCharacterDetails(playerId, universeId, 'pf1e', characterId), {
			id: characterId,
			name: 'Brokk',
			raceId: brokk.raceId,
			classId: brokk.classId,
			deleteAt: null,
			themeId: null,
			abilityScores: brokk.abilityScores,
			money: brokk.money,
			items: brokk.items
		});
		assert.strictEqual(await findCharacterDetails(otherPlayerId, universeId, 'pf1e', characterId), undefined);
		assert.strictEqual(await findCharacterDetails(playerId, otherUniverseId, 'pf1e', characterId), undefined);
	});

	describe('deleting', () =>
	{
		/**
		 * A time some days from now
		 *
		 * @param days How many days; negative for the past
		 * @return The time
		 */
		function daysFromNow(days: number): Date
		{
			return(new Date(Date.now() + (days * 24 * 60 * 60 * 1000)));
		}

		it('deletes only the player\'s own character, with their items', async () =>
		{
			const otherPlayerId = (await addPlayer('Grace')).id;
			const brokk = await dwarfFighter(playerId, universeId);
			const characterId = await inTransaction((transaction) => createCharacter(brokk, transaction));

			assert.strictEqual(await deleteCharacter(otherPlayerId, universeId, characterId), false);
			assert.strictEqual(await deleteCharacter(playerId, universeId, characterId), true);
			assert.strictEqual(await countCharacters(playerId, universeId), 0);
			assert.strictEqual(await isCarriedItem(brokk.items[0].itemId), false);
			assert.strictEqual(await deleteCharacter(playerId, universeId, characterId), false);
		});

		it('keeps a character given their last rites listed and counted, but not playable, and keeps their first time', async () =>
		{
			const brokk = await dwarfFighter(playerId, universeId);
			const characterId = await inTransaction((transaction) => createCharacter(brokk, transaction));
			const deleteAt = daysFromNow(7);

			assert.deepStrictEqual(await scheduleCharacterDeletion(playerId, universeId, characterId, deleteAt), deleteAt);
			assert.deepStrictEqual(await scheduleCharacterDeletion(playerId, universeId, characterId, daysFromNow(9)), deleteAt);
			assert.deepStrictEqual((await listCharacters(playerId, universeId)).map((character) => character.deleteAt), [deleteAt]);
			assert.deepStrictEqual((await findCharacterDetails(playerId, universeId, 'pf1e', characterId))?.deleteAt, deleteAt);
			assert.strictEqual(await countCharacters(playerId, universeId), 1);
			assert.deepStrictEqual(await listPlayableCharacters(playerId, universeId), []);

			assert.deepStrictEqual(await restoreCharacter(playerId, universeId, characterId), { id: characterId, name: 'Brokk', raceId: brokk.raceId });
			assert.deepStrictEqual((await listPlayableCharacters(playerId, universeId)).map(({ id }) => id), [characterId]);
			assert.strictEqual(await restoreCharacter(playerId, universeId, characterId), undefined);
		});

		it('hides a character whose time has come, and sweeps them away', async () =>
		{
			const brokk = await dwarfFighter(playerId, universeId);
			const goneId = await inTransaction((transaction) => createCharacter(brokk, transaction));
			const waitingId = await inTransaction((transaction) => createCharacter({ ...brokk, name: 'Dain' }, transaction));

			await scheduleCharacterDeletion(playerId, universeId, goneId, daysFromNow(-1));
			await scheduleCharacterDeletion(playerId, universeId, waitingId, daysFromNow(1));

			assert.deepStrictEqual((await listCharacters(playerId, universeId)).map(({ id }) => id), [waitingId]);
			assert.strictEqual(await findCharacterDetails(playerId, universeId, 'pf1e', goneId), undefined);
			assert.strictEqual(await countCharacters(playerId, universeId), 1);
			assert.strictEqual(await restoreCharacter(playerId, universeId, goneId), undefined);
			assert.strictEqual(await scheduleCharacterDeletion(playerId, universeId, goneId, daysFromNow(7)), undefined);

			assert.strictEqual(await purgeExpiredCharacters(), 1);
			assert.strictEqual(await purgeExpiredCharacters(), 0);
			assert.strictEqual(await deleteCharacter(playerId, universeId, goneId), false);
			assert.deepStrictEqual((await listCharacters(playerId, universeId)).map(({ id }) => id), [waitingId]);
		});
	});

	it('keeps one draft per player and universe', async () =>
	{
		const draft: CharacterDraft = {
			step: 'name',
			name: 'Brokk',
			raceId: null,
			classId: null,
			baseScores: null,
			themeId: null,
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

	describe('profiles', () =>
	{
		it('lists a player\'s characters in every universe, by universe and then name, leaving out those given their last rites', async () =>
		{
			const otherUniverseId = await createUniverse({ name: 'Brightwater', ruleset: 'pf1e', stage: 'let_there_be_light' });
			const zedId = await inTransaction(async (transaction) => createCharacter(await dwarfFighter(playerId, otherUniverseId, 'Zed'), transaction));

			await inTransaction(async (transaction) => createCharacter(await dwarfFighter(playerId, otherUniverseId, 'Brokk'), transaction));
			await inTransaction(async (transaction) => createCharacter(await dwarfFighter(playerId, universeId, 'Dain'), transaction));

			const goneId = await inTransaction(async (transaction) => createCharacter(await dwarfFighter(playerId, universeId, 'Gimli'), transaction));

			await scheduleCharacterDeletion(playerId, universeId, goneId, new Date(Date.now() + 60000));

			const all = await listProfileCharacters(playerId, {});

			assert.deepStrictEqual(all.map((character) => [character.universeName, character.name]), [['Brightwater', 'Brokk'], ['Brightwater', 'Zed'], [all[2].universeName, 'Dain']]);
			assert.deepStrictEqual((await listProfileCharacters(playerId, { stages: ['let_there_be_light'] })).map((character) => character.name), ['Brokk', 'Zed']);

			assert.strictEqual(await setCharacterVisibility(playerId, zedId, false), true);
			assert.deepStrictEqual((await listProfileCharacters(playerId, { onlyVisible: true })).map((character) => character.name), ['Brokk', 'Dain']);
		});

		it('changes the visibility of the player\'s own characters only', async () =>
		{
			const graceId = (await addPlayer('Grace')).id;
			const characterId = await inTransaction(async (transaction) => createCharacter(await dwarfFighter(graceId, universeId), transaction));

			assert.strictEqual(await setCharacterVisibility(playerId, characterId, false), false);
			assert.strictEqual((await listProfileCharacters(graceId, { onlyVisible: true })).length, 1);
		});
	});
});
