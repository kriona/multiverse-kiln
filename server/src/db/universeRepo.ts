/**
 * Universes: the only module that reads or writes the universes table
 */
import { and, eq, or, sql } from 'drizzle-orm';
import { nameKey, universeSlug, type EditableUniverse, type PassageOfTime, type Ruleset, type UniverseDetails, type UniverseSettingsUpdate, type UniverseStage, type UniverseSummary } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { fromCoinColumns, toCoinColumns } from './coinColumns.js';
import { universes } from './schema.js';
import { loadStartingItems, replaceStartingItems } from './startingItemRepo.js';

/**
 * The unique index that keeps two universes from having the same slug, and so the same name
 */
const SLUG_INDEX = 'universes_slug_unique';

/**
 * Postgres's code for a row that breaks a unique index
 */
const UNIQUE_VIOLATION = '23505';

/**
 * The transaction-level advisory lock that makes universes take names one at a time, so two lookalike
 * names can't both be checked as free and then both be taken. Any number no other lock uses
 */
const NAMING_LOCK = 7_318_211;

/**
 * Thrown when a universe would take a name another universe has, or one that could be mistaken for it:
 * the same slug, or the same key (nameKey), which looks past capitals, accents, look-alike letters,
 * stand-ins such as "1" for "i", repeated letters and the spaces and punctuation between words
 */
export class UniverseNameTakenError extends Error
{
	/**
	 * @param name The name asked for
	 */
	constructor(name: string)
	{
		super(`Another universe already has the name "${name}", or one too much like it`);
		this.name = 'UniverseNameTakenError';
	}
}

/**
 * Whether a query failed because the universe's slug is another universe's. Drizzle wraps the driver's
 * error, which holds the code and the index
 *
 * @param error What the query threw
 * @return True when it broke the slug's unique index
 */
function isSlugTaken(error: unknown): boolean
{
	const cause = ((error instanceof Error) ? (error.cause ?? error) : error);

	return((typeof cause === 'object') && (cause !== null) && ('code' in cause) && (cause.code === UNIQUE_VIOLATION) && ('constraint' in cause) && (cause.constraint === SLUG_INDEX));
}

/**
 * Runs a query that sets a universe's name, if no other universe has a name with the same key
 *
 * The keys are compared here rather than kept in the database, so a change to how names are reduced
 * (shared/src/names.ts) applies to every name at once. Names change rarely, so reading them all is
 * cheap. The slug's unique index still catches two universes with the same address
 *
 * @param name The name being set
 * @param universeId The universe being renamed, or undefined for a new one
 * @param executor The database, or a transaction
 * @param query The query, run on a transaction holding the naming lock
 * @return What the query returns
 * @throws UniverseNameTakenError when another universe's name has the same key or slug
 */
async function settingName<T>(name: string, universeId: string | undefined, executor: Executor, query: (transaction: Executor) => Promise<T>): Promise<T>
{
	try
	{
		return(await executor.transaction(async (transaction) =>
		{
			await transaction.execute(sql`SELECT pg_advisory_xact_lock(${NAMING_LOCK})`);

			const key = nameKey(name);
			const others = await transaction
				.select({
					id: universes.id,
					name: universes.name
				})
				.from(universes);

			if (others.some((other) => ((other.id !== universeId) && (nameKey(other.name) === key))))
			{
				throw new UniverseNameTakenError(name);
			}

			return(query(transaction));
		}));
	}
	catch (error)
	{
		if (isSlugTaken(error))
		{
			throw new UniverseNameTakenError(name);
		}

		throw error;
	}
}

/**
 * The form of a universe's ID. Only text in this form is compared with the ID column, which refuses
 * anything else, so a slug is only compared with the slug column
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A universe as the rest of the server sees it
 */
export interface UniverseRecord
{
	id: string;
	name: string;
	shortDescription: string;
	stage: UniverseStage;
	ruleset: Ruleset;
	passageOfTime: PassageOfTime;

	/**
	 * Undefined until the universe's areas exist
	 */
	lobbyAreaId: string | undefined;

	/**
	 * Undefined until the universe's areas exist
	 */
	startingAreaId: string | undefined;
}

/**
 * What a new universe needs. Its slug comes from its name, and its lobby and starting areas are set
 * once they exist (setUniverseAreas)
 */
export type NewUniverse = Pick<typeof universes.$inferInsert, 'id' | 'name' | 'shortDescription' | 'longDescription' | 'stage' | 'ruleset' | 'passageOfTime'>;

/**
 * Adds a universe
 *
 * @param universe The universe, whose name must have a letter or digit
 * @param executor The database, or a transaction
 * @return The new universe's ID
 * @throws UniverseNameTakenError when another universe has the name, or one too much like it
 */
export async function createUniverse(universe: NewUniverse, executor: Executor = db): Promise<string>
{
	const [created] = await settingName(universe.name, undefined, executor, (transaction) => transaction
		.insert(universes)
		.values({
			...universe,
			slug: universeSlug(universe.name)
		})
		.returning({ id: universes.id }));

	return(created.id);
}

/**
 * Sets the area a universe's lobby is in and the area its groups start in
 *
 * @param universeId The universe's ID
 * @param lobbyAreaId The lobby's area
 * @param startingAreaId The area groups start in
 * @param executor The database, or a transaction
 */
export async function setUniverseAreas(universeId: string, lobbyAreaId: string, startingAreaId: string, executor: Executor = db): Promise<void>
{
	await executor
		.update(universes)
		.set({
			lobbyAreaId,
			startingAreaId
		})
		.where(eq(universes.id, universeId));
}

/**
 * Finds a universe
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The universe, or undefined when there is none with that ID
 */
export async function findUniverse(universeId: string, executor: Executor = db): Promise<UniverseRecord | undefined>
{
	const [row] = await executor
		.select()
		.from(universes)
		.where(eq(universes.id, universeId))
		.limit(1);

	if (!row)
	{
		return(undefined);
	}

	return({
		id: row.id,
		name: row.name,
		shortDescription: row.shortDescription,
		stage: row.stage,
		ruleset: row.ruleset,
		passageOfTime: row.passageOfTime,
		lobbyAreaId: row.lobbyAreaId ?? undefined,
		startingAreaId: row.startingAreaId ?? undefined
	});
}

/**
 * A page of the universes in a stage, by name
 *
 * @param stage The stage
 * @param offset How many universes to skip
 * @param limit Most universes to return
 * @param executor The database, or a transaction
 * @return The universes
 */
export async function listUniverses(stage: UniverseStage, offset: number, limit: number, executor: Executor = db): Promise<UniverseSummary[]>
{
	return(executor
		.select({
			id: universes.id,
			name: universes.name,
			slug: universes.slug,
			shortDescription: universes.shortDescription,
			ruleset: universes.ruleset
		})
		.from(universes)
		.where(eq(universes.stage, stage))
		.orderBy(universes.name, universes.id)
		.offset(offset)
		.limit(limit));
}

/**
 * A universe's details, if it is in a stage
 *
 * @param key The universe's ID or slug
 * @param stage The stage it must be in
 * @param executor The database, or a transaction
 * @return The universe, or undefined when there is none with that ID or slug in that stage
 */
export async function findUniverseDetails(key: string, stage: UniverseStage, executor: Executor = db): Promise<UniverseDetails | undefined>
{
	const bySlug = eq(universes.slug, key);
	const [row] = await executor
		.select({
			id: universes.id,
			name: universes.name,
			slug: universes.slug,
			shortDescription: universes.shortDescription,
			longDescription: universes.longDescription,
			ruleset: universes.ruleset
		})
		.from(universes)
		.where(and(
			(UUID_PATTERN.test(key) ? or(eq(universes.id, key), bySlug) : bySlug),
			eq(universes.stage, stage)
		))
		.limit(1);

	return(row);
}

/**
 * A universe with every setting the editor shows
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The universe without the player's role, or undefined when there is none with that ID
 */
export async function findEditableUniverse(universeId: string, executor: Executor = db): Promise<Omit<EditableUniverse, 'role'> | undefined>
{
	const [row] = await executor
		.select({
			id: universes.id,
			name: universes.name,
			slug: universes.slug,
			shortDescription: universes.shortDescription,
			longDescription: universes.longDescription,
			stage: universes.stage,
			ruleset: universes.ruleset,
			passageOfTime: universes.passageOfTime,
			faerieMorning: universes.faerieMorning,
			lobbyPassageOfTime: universes.lobbyPassageOfTime,
			lobbyDayHours: universes.lobbyDayHours,
			lobbyFaerieMorning: universes.lobbyFaerieMorning,
			lobbyAreaId: universes.lobbyAreaId,
			startingAreaId: universes.startingAreaId,
			groupSize: universes.groupSize,
			startingPlatinum: universes.startingPlatinum,
			startingGold: universes.startingGold,
			startingSilver: universes.startingSilver,
			startingCopper: universes.startingCopper,
			startingCredits: universes.startingCredits
		})
		.from(universes)
		.where(eq(universes.id, universeId))
		.limit(1);

	if (!row)
	{
		return(undefined);
	}

	const { startingPlatinum, startingGold, startingSilver, startingCopper, startingCredits, ...settings } = row;

	return({
		...settings,
		startingMoney: fromCoinColumns({ startingPlatinum, startingGold, startingSilver, startingCopper, startingCredits }),
		startingItems: await loadStartingItems(universeId, executor)
	});
}

/**
 * Changes some of a universe's settings
 *
 * The database refuses a faerie passage of time without a faerie morning, a faerie morning without
 * faerie time (for the universe and for its lobby), and a lobby day length, group size or starting
 * money out of range. The caller checks that a starting area
 * is one of the universe's, and that the starting items are items it can use. A new name changes the
 * universe's slug with it
 *
 * @param universeId The universe's ID
 * @param update The settings to change; a name must have a letter or digit
 * @param executor A transaction when the update holds starting items, otherwise the database or a transaction
 * @throws UniverseNameTakenError when another universe has the new name, or one too much like it
 */
export async function updateUniverseSettings(universeId: string, update: UniverseSettingsUpdate, executor: Executor = db): Promise<void>
{
	const { startingMoney, startingItems, ...settings } = update;

	if (startingItems !== undefined)
	{
		await replaceStartingItems(universeId, startingItems, executor);
	}

	if ((Object.keys(settings).length === 0) && (startingMoney === undefined))
	{
		return;
	}

	const { name } = settings;

	/**
	 * Changes the settings
	 *
	 * @param transaction The database, or a transaction
	 */
	const save = async (transaction: Executor): Promise<void> =>
	{
		await transaction
			.update(universes)
			.set({
				...settings,
				...((name === undefined) ? {} : { slug: universeSlug(name) }),
				...((startingMoney === undefined) ? {} : toCoinColumns(startingMoney))
			})
			.where(eq(universes.id, universeId));
	};

	await ((name === undefined) ? save(executor) : settingName(name, universeId, executor, save));
}

/**
 * Locks a universe's row until the transaction ends, so limits on what it holds (such as its number
 * of areas) are checked by one transaction at a time
 *
 * @param universeId The universe's ID
 * @param executor A transaction
 * @return Whether the universe exists
 */
export async function lockUniverse(universeId: string, executor: Executor): Promise<boolean>
{
	const rows = await executor
		.select({
			id: universes.id
		})
		.from(universes)
		.where(eq(universes.id, universeId))
		.for('update');

	return(rows.length > 0);
}

/**
 * Deletes a universe and everything in it: its areas, maps, links and tiles
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return Whether there was a universe to delete
 */
export async function deleteUniverse(universeId: string, executor: Executor = db): Promise<boolean>
{
	const deleted = await executor
		.delete(universes)
		.where(eq(universes.id, universeId))
		.returning({ id: universes.id });

	return(deleted.length > 0);
}
