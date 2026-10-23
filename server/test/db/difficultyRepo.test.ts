import assert from 'assert';
import { DEFAULT_DIFFICULTY_LEVELS, type DifficultyLevelSettings } from '@multiverse-kiln/shared';

import { countDifficultyLevels, createDifficultyLevel, deleteDifficultyLevel, findDefaultDifficultyLevel, findDifficultyLevel, listDifficultyLevels, updateDifficultyLevel } from '../../src/db/difficultyRepo.js';
import { findGroup, moveGroupsToDifficultyLevel } from '../../src/db/groupRepo.js';
import { loadOrCreatePlayerByName } from '../../src/db/playerRepo.js';
import { inTransaction } from '../../src/db/transactions.js';
import { createUniverse } from '../../src/db/universeRepo.js';
import { addCharacter, addGroup } from './fixtures.js';

describe('difficultyRepo', () =>
{
	const nightmare: DifficultyLevelSettings & { name: string } = {
		name: 'Nightmare',
		isDefault: false,
		mobScale: 300,
		permadeath: true
	};

	let universeId: string;

	beforeEach(async () =>
	{
		universeId = await createUniverse({ name: 'Kilnhaven', ruleset: 'pf1e' });
	});

	it('gives a new universe the default levels, easiest first', async () =>
	{
		const levels = await listDifficultyLevels(universeId);

		assert.deepStrictEqual(levels.map(({ id: _id, ...level }) => level), DEFAULT_DIFFICULTY_LEVELS.map((level) => ({ ...level, name: null })));
		assert.deepStrictEqual(await findDefaultDifficultyLevel(universeId), levels.find((level) => (level.key === 'normal')));
		assert.strictEqual(await countDifficultyLevels(universeId), DEFAULT_DIFFICULTY_LEVELS.length);
	});

	it('finds only the universe\'s own levels', async () =>
	{
		const otherId = await createUniverse({ name: 'Brightwater', ruleset: 'pf1e' });
		const [theirs] = await listDifficultyLevels(otherId);

		assert.strictEqual(await findDifficultyLevel(universeId, theirs.id), undefined);
		assert.deepStrictEqual(await findDifficultyLevel(otherId, theirs.id), theirs);
	});

	it('adds and changes levels, keeping one default', async () =>
	{
		const levelId = await inTransaction((transaction) => createDifficultyLevel(universeId, { ...nightmare, isDefault: true }, transaction));

		assert.deepStrictEqual(await findDefaultDifficultyLevel(universeId), { id: levelId, key: null, ...nightmare, isDefault: true });

		const [story] = await listDifficultyLevels(universeId);

		await inTransaction((transaction) => updateDifficultyLevel(universeId, story.id, { ...story, name: 'Tale', isDefault: true }, transaction));

		assert.deepStrictEqual(await findDefaultDifficultyLevel(universeId), { ...story, name: 'Tale', isDefault: true });
		assert.strictEqual((await listDifficultyLevels(universeId)).filter((level) => level.isDefault).length, 1);
	});

	it('deletes a level once its groups are moved to another', async () =>
	{
		const { id: playerId } = await loadOrCreatePlayerByName('Ada');
		const characterId = await addCharacter(playerId, universeId, 'Ada');
		const groupId = await addGroup(universeId, characterId, null);
		const normal = await findDefaultDifficultyLevel(universeId);
		const levelId = await inTransaction((transaction) => createDifficultyLevel(universeId, nightmare, transaction));

		await moveGroupsToDifficultyLevel(normal?.id ?? 0, levelId);
		assert.strictEqual((await findGroup(groupId))?.difficultyLevelId, levelId);

		await moveGroupsToDifficultyLevel(levelId, normal?.id ?? 0);
		await deleteDifficultyLevel(universeId, levelId);

		assert.strictEqual(await findDifficultyLevel(universeId, levelId), undefined);
		assert.strictEqual((await findGroup(groupId))?.difficultyLevelId, normal?.id);
	});
});
