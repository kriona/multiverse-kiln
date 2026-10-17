/**
 * Universes: the only module that reads or writes the universes table
 */
import { and, eq } from 'drizzle-orm';
import type { EditableUniverse, PassageOfTime, Ruleset, UniverseDetails, UniverseSettingsUpdate, UniverseStage, UniverseSummary } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { universes } from './schema.js';
import { loadStartingItems, replaceStartingItems } from './startingItemRepo.js';

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
	 * Undefined until the universe's zones exist
	 */
	lobbyZoneId: string | undefined;

	/**
	 * Undefined until the universe's zones exist
	 */
	startingZoneId: string | undefined;
}

/**
 * What a new universe needs. Its lobby and starting zones are set once they exist (setUniverseZones)
 */
export type NewUniverse = Pick<typeof universes.$inferInsert, 'id' | 'name' | 'shortDescription' | 'longDescription' | 'stage' | 'ruleset' | 'passageOfTime'>;

/**
 * Adds a universe
 *
 * @param universe The universe
 * @param executor The database, or a transaction
 * @return The new universe's ID
 */
export async function createUniverse(universe: NewUniverse, executor: Executor = db): Promise<string>
{
	const [created] = await executor
		.insert(universes)
		.values(universe)
		.returning({ id: universes.id });

	return(created.id);
}

/**
 * Sets the zone a universe's lobby is in and the zone its groups start in
 *
 * @param universeId The universe's ID
 * @param lobbyZoneId The lobby's zone
 * @param startingZoneId The zone groups start in
 * @param executor The database, or a transaction
 */
export async function setUniverseZones(universeId: string, lobbyZoneId: string, startingZoneId: string, executor: Executor = db): Promise<void>
{
	await executor
		.update(universes)
		.set({ lobbyZoneId, startingZoneId })
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
		lobbyZoneId: row.lobbyZoneId ?? undefined,
		startingZoneId: row.startingZoneId ?? undefined
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
 * @param universeId The universe's ID
 * @param stage The stage it must be in
 * @param executor The database, or a transaction
 * @return The universe, or undefined when there is none with that ID in that stage
 */
export async function findUniverseDetails(universeId: string, stage: UniverseStage, executor: Executor = db): Promise<UniverseDetails | undefined>
{
	const [row] = await executor
		.select({
			id: universes.id,
			name: universes.name,
			shortDescription: universes.shortDescription,
			longDescription: universes.longDescription,
			ruleset: universes.ruleset
		})
		.from(universes)
		.where(and(
			eq(universes.id, universeId),
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
			shortDescription: universes.shortDescription,
			longDescription: universes.longDescription,
			stage: universes.stage,
			ruleset: universes.ruleset,
			passageOfTime: universes.passageOfTime,
			faerieMorning: universes.faerieMorning,
			lobbyZoneId: universes.lobbyZoneId,
			startingZoneId: universes.startingZoneId,
			groupSize: universes.groupSize,
			startingPlatinum: universes.startingPlatinum,
			startingGold: universes.startingGold,
			startingSilver: universes.startingSilver,
			startingCopper: universes.startingCopper
		})
		.from(universes)
		.where(eq(universes.id, universeId))
		.limit(1);

	if (!row)
	{
		return(undefined);
	}

	const { startingPlatinum, startingGold, startingSilver, startingCopper, ...settings } = row;

	return({
		...settings,
		startingMoney: {
			pp: startingPlatinum,
			gp: startingGold,
			sp: startingSilver,
			cp: startingCopper
		},
		startingItems: await loadStartingItems(universeId, executor)
	});
}

/**
 * Changes some of a universe's settings
 *
 * The database refuses a faerie passage of time without a faerie morning, a faerie morning without
 * faerie time, and a group size or starting money out of range. The caller checks that a starting zone
 * is one of the universe's, and that the starting items are items it can use
 *
 * @param universeId The universe's ID
 * @param update The settings to change
 * @param executor A transaction when the update holds starting items, otherwise the database or a transaction
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

	await executor
		.update(universes)
		.set({
			...settings,
			...((startingMoney === undefined)
				? {}
				: {
					startingPlatinum: startingMoney.pp,
					startingGold: startingMoney.gp,
					startingSilver: startingMoney.sp,
					startingCopper: startingMoney.cp
				})
		})
		.where(eq(universes.id, universeId));
}

/**
 * Locks a universe's row until the transaction ends, so limits on what it holds (such as its number
 * of zones) are checked by one transaction at a time
 *
 * @param universeId The universe's ID
 * @param executor A transaction
 * @return Whether the universe exists
 */
export async function lockUniverse(universeId: string, executor: Executor): Promise<boolean>
{
	const rows = await executor
		.select({ id: universes.id })
		.from(universes)
		.where(eq(universes.id, universeId))
		.for('update');

	return(rows.length > 0);
}

/**
 * Deletes a universe and everything in it: its zones, maps, links and tiles
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
