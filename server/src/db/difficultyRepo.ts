/**
 * Difficulty levels: the only module that reads or writes the difficulty_levels table
 */
import { and, asc, count, eq, ne } from 'drizzle-orm';
import { DEFAULT_DIFFICULTY_LEVELS, type DifficultyLevel, type DifficultyLevelSettings } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { difficultyLevels } from './schema.js';
import { inVersion, type UniverseVersion } from './universeVersions.js';

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
 * Gives a new universe's live version the default difficulty levels. Call it inside the transaction that
 * makes the universe
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
 * @param version The universe's live version or draft
 * @param executor The database, or a transaction
 * @return The levels, easiest first
 */
export async function listDifficultyLevels(version: UniverseVersion, executor: Executor = db): Promise<DifficultyLevel[]>
{
	return(executor
		.select(levelColumns)
		.from(difficultyLevels)
		.where(inVersion(difficultyLevels, version))
		.orderBy(asc(difficultyLevels.mobScale), asc(difficultyLevels.id)));
}

/**
 * One of a universe's difficulty levels
 *
 * @param version The universe's live version or draft
 * @param levelId The level's ID
 * @param executor The database, or a transaction
 * @return The level, or undefined when the universe has none with that ID
 */
export async function findDifficultyLevel(version: UniverseVersion, levelId: number, executor: Executor = db): Promise<DifficultyLevel | undefined>
{
	const [row] = await executor
		.select(levelColumns)
		.from(difficultyLevels)
		.where(and(
			eq(difficultyLevels.id, levelId),
			inVersion(difficultyLevels, version)
		))
		.limit(1);

	return(row);
}

/**
 * A universe's default difficulty level
 *
 * @param version The universe's live version or draft
 * @param executor The database, or a transaction
 * @return The level, or undefined when the universe doesn't exist
 */
export async function findDefaultDifficultyLevel(version: UniverseVersion, executor: Executor = db): Promise<DifficultyLevel | undefined>
{
	const [row] = await executor
		.select(levelColumns)
		.from(difficultyLevels)
		.where(and(
			inVersion(difficultyLevels, version),
			eq(difficultyLevels.isDefault, true)
		))
		.limit(1);

	return(row);
}

/**
 * How many difficulty levels a universe has
 *
 * @param version The universe's live version or draft
 * @param executor The database, or a transaction
 * @return The number of levels
 */
export async function countDifficultyLevels(version: UniverseVersion, executor: Executor = db): Promise<number>
{
	const [row] = await executor
		.select({
			total: count()
		})
		.from(difficultyLevels)
		.where(inVersion(difficultyLevels, version));

	return(row.total);
}

/**
 * Adds a difficulty level to a universe. A new default level takes over from the old one. Call it inside
 * a transaction
 *
 * @param version The universe's live version or draft
 * @param settings The level's settings, with a name
 * @param executor A transaction
 * @return The new level's ID
 */
export async function createDifficultyLevel(version: UniverseVersion, settings: DifficultyLevelSettings & { name: string }, executor: Executor): Promise<number>
{
	if (settings.isDefault)
	{
		await clearDefault(version, undefined, executor);
	}

	const [created] = await executor
		.insert(difficultyLevels)
		.values({
			universeId: version.universeId,
			draft: version.draft,
			...settingColumns(settings)
		})
		.returning({ id: difficultyLevels.id });

	return(created.id);
}

/**
 * Changes one of a universe's difficulty levels. A level made the default takes over from the old one.
 * Call it inside a transaction
 *
 * @param version The universe's live version or draft
 * @param levelId The level's ID
 * @param settings The level's new settings; a null name keeps a default level's name
 * @param executor A transaction
 */
export async function updateDifficultyLevel(version: UniverseVersion, levelId: number, settings: DifficultyLevelSettings, executor: Executor): Promise<void>
{
	if (settings.isDefault)
	{
		await clearDefault(version, levelId, executor);
	}

	await executor
		.update(difficultyLevels)
		.set(settingColumns(settings))
		.where(and(
			eq(difficultyLevels.id, levelId),
			inVersion(difficultyLevels, version)
		));
}

/**
 * Deletes one of a universe's difficulty levels. Move its groups to another level first
 *
 * @param version The universe's live version or draft
 * @param levelId The level's ID
 * @param executor The database, or a transaction
 */
export async function deleteDifficultyLevel(version: UniverseVersion, levelId: number, executor: Executor = db): Promise<void>
{
	await executor
		.delete(difficultyLevels)
		.where(and(
			eq(difficultyLevels.id, levelId),
			inVersion(difficultyLevels, version)
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
 * @param version The universe's live version or draft
 * @param keepId A level to leave as it is, or undefined for none
 * @param executor A transaction
 */
async function clearDefault(version: UniverseVersion, keepId: number | undefined, executor: Executor): Promise<void>
{
	await executor
		.update(difficultyLevels)
		.set({
			isDefault: false
		})
		.where(and(
			inVersion(difficultyLevels, version),
			eq(difficultyLevels.isDefault, true),
			((keepId === undefined) ? undefined : ne(difficultyLevels.id, keepId))
		));
}
