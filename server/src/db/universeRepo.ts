/**
 * Universes: the only module that reads or writes the universes table
 */
import { eq } from 'drizzle-orm';
import type { PassageOfTime, Ruleset, UniverseStage } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { universes } from './schema.js';

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
