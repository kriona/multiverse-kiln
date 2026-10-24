/**
 * Difficulty levels: the only module that reads or writes the difficulty_levels table
 */
import { and, asc, count, eq, ne } from 'drizzle-orm';
import { DEFAULT_DIFFICULTY_LEVELS, type DifficultyLevel, type DifficultyLevelSettings } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { difficultyLevels } from './schema.js';

/**
 * The columns of a level's row that DifficultyLevel holds
 */
const levelColumns = {
	id: difficultyLevels.id,
	key: difficultyLevels.key,
	name: difficultyLevels.name,
	isDefault: difficultyLevels.isDefault,
	mobScale: difficultyLevels.mobScale,
	permadeath: difficultyLevels.permadeath
};

/**
 * Gives a new universe the default difficulty levels. Call it inside the transaction that makes the universe
 *
 * @param universeId The universe's ID
 * @param executor A transaction
 */
export async function addDefaultDifficultyLevels(universeId: string, executor: Executor): Promise<void>
{
	await executor
		.insert(difficultyLevels)
		.values(DEFAULT_DIFFICULTY_LEVELS.map((level) => ({
			universeId,
			...level
		})));
}

/**
 * Every difficulty level of a universe
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The levels, easiest first
 */
export async function listDifficultyLevels(universeId: string, executor: Executor = db): Promise<DifficultyLevel[]>
{
	return(executor
		.select(levelColumns)
		.from(difficultyLevels)
		.where(eq(difficultyLevels.universeId, universeId))
		.orderBy(asc(difficultyLevels.mobScale), asc(difficultyLevels.id)));
}

/**
 * One of a universe's difficulty levels
 *
 * @param universeId The universe's ID
 * @param levelId The level's ID
 * @param executor The database, or a transaction
 * @return The level, or undefined when the universe has none with that ID
 */
export async function findDifficultyLevel(universeId: string, levelId: number, executor: Executor = db): Promise<DifficultyLevel | undefined>
{
	const [row] = await executor
		.select(levelColumns)
		.from(difficultyLevels)
		.where(and(
			eq(difficultyLevels.id, levelId),
			eq(difficultyLevels.universeId, universeId)
		))
		.limit(1);

	return(row);
}

/**
 * A universe's default difficulty level
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The level, or undefined when the universe doesn't exist
 */
export async function findDefaultDifficultyLevel(universeId: string, executor: Executor = db): Promise<DifficultyLevel | undefined>
{
	const [row] = await executor
		.select(levelColumns)
		.from(difficultyLevels)
		.where(and(
			eq(difficultyLevels.universeId, universeId),
			eq(difficultyLevels.isDefault, true)
		))
		.limit(1);

	return(row);
}

/**
 * How many difficulty levels a universe has
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The number of levels
 */
export async function countDifficultyLevels(universeId: string, executor: Executor = db): Promise<number>
{
	const [row] = await executor
		.select({
			total: count()
		})
		.from(difficultyLevels)
		.where(eq(difficultyLevels.universeId, universeId));

	return(row.total);
}

/**
 * Adds a difficulty level to a universe. A new default level takes over from the old one. Call it inside
 * a transaction
 *
 * @param universeId The universe's ID
 * @param settings The level's settings, with a name
 * @param executor A transaction
 * @return The new level's ID
 */
export async function createDifficultyLevel(universeId: string, settings: DifficultyLevelSettings & { name: string }, executor: Executor): Promise<number>
{
	if (settings.isDefault)
	{
		await clearDefault(universeId, undefined, executor);
	}

	const [created] = await executor
		.insert(difficultyLevels)
		.values({
			universeId,
			...settingColumns(settings)
		})
		.returning({ id: difficultyLevels.id });

	return(created.id);
}

/**
 * Changes one of a universe's difficulty levels. A level made the default takes over from the old one.
 * Call it inside a transaction
 *
 * @param universeId The universe's ID
 * @param levelId The level's ID
 * @param settings The level's new settings; a null name keeps a default level's name
 * @param executor A transaction
 */
export async function updateDifficultyLevel(universeId: string, levelId: number, settings: DifficultyLevelSettings, executor: Executor): Promise<void>
{
	if (settings.isDefault)
	{
		await clearDefault(universeId, levelId, executor);
	}

	await executor
		.update(difficultyLevels)
		.set(settingColumns(settings))
		.where(and(
			eq(difficultyLevels.id, levelId),
			eq(difficultyLevels.universeId, universeId)
		));
}

/**
 * Deletes one of a universe's difficulty levels. Move its groups to another level first
 *
 * @param universeId The universe's ID
 * @param levelId The level's ID
 * @param executor The database, or a transaction
 */
export async function deleteDifficultyLevel(universeId: string, levelId: number, executor: Executor = db): Promise<void>
{
	await executor
		.delete(difficultyLevels)
		.where(and(
			eq(difficultyLevels.id, levelId),
			eq(difficultyLevels.universeId, universeId)
		));
}

/**
 * The columns that hold a level's settings
 *
 * @param settings The settings
 * @return The column values
 */
function settingColumns(settings: DifficultyLevelSettings): Pick<typeof difficultyLevels.$inferInsert, 'name' | 'isDefault' | 'mobScale' | 'permadeath'>
{
	return({
		name: settings.name,
		isDefault: settings.isDefault,
		mobScale: settings.mobScale,
		permadeath: settings.permadeath
	});
}

/**
 * Makes a universe's default level an ordinary one, so another can become the default
 *
 * @param universeId The universe's ID
 * @param keepId A level to leave as it is, or undefined for none
 * @param executor A transaction
 */
async function clearDefault(universeId: string, keepId: number | undefined, executor: Executor): Promise<void>
{
	await executor
		.update(difficultyLevels)
		.set({
			isDefault: false
		})
		.where(and(
			eq(difficultyLevels.universeId, universeId),
			eq(difficultyLevels.isDefault, true),
			((keepId === undefined) ? undefined : ne(difficultyLevels.id, keepId))
		));
}
