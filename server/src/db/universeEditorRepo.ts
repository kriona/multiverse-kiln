/**
 * Who may work on each universe: the only module that reads or writes the universe_editors table
 */
import { and, count, eq } from 'drizzle-orm';
import type { EditableUniverseSummary, UniverseRole } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { universeEditors, universes } from './schema.js';

/**
 * Gives a player a role in a universe, replacing any role they had
 *
 * @param universeId The universe's ID
 * @param playerId The player's ID
 * @param role The role
 * @param executor The database, or a transaction
 */
export async function setUniverseRole(universeId: string, playerId: string, role: UniverseRole, executor: Executor = db): Promise<void>
{
	await executor
		.insert(universeEditors)
		.values({
			universeId,
			playerId,
			role
		})
		.onConflictDoUpdate({
			target: [universeEditors.universeId, universeEditors.playerId],
			set: { role }
		});
}

/**
 * A player's role in a universe
 *
 * @param universeId The universe's ID
 * @param playerId The player's ID
 * @param executor The database, or a transaction
 * @return The role, or undefined when the player has none
 */
export async function findUniverseRole(universeId: string, playerId: string, executor: Executor = db): Promise<UniverseRole | undefined>
{
	const [row] = await executor
		.select({
			role: universeEditors.role
		})
		.from(universeEditors)
		.where(and(
			eq(universeEditors.universeId, universeId),
			eq(universeEditors.playerId, playerId)
		))
		.limit(1);

	return(row?.role);
}

/**
 * How many universes a player has a role in
 *
 * @param playerId The player's ID
 * @param role The role
 * @param executor The database, or a transaction
 * @return The number of universes
 */
export async function countUniversesWithRole(playerId: string, role: UniverseRole, executor: Executor = db): Promise<number>
{
	const [row] = await executor
		.select({
			total: count()
		})
		.from(universeEditors)
		.where(and(
			eq(universeEditors.playerId, playerId),
			eq(universeEditors.role, role)
		));

	return(row.total);
}

/**
 * Every universe a player has a role in, by name
 *
 * @param playerId The player's ID
 * @param executor The database, or a transaction
 * @return The universes, with the player's role in each
 */
export async function listEditableUniverses(playerId: string, executor: Executor = db): Promise<EditableUniverseSummary[]>
{
	return(executor
		.select({
			id: universes.id,
			name: universes.name,
			slug: universes.slug,
			shortDescription: universes.shortDescription,
			ruleset: universes.ruleset,
			stage: universes.stage,
			role: universeEditors.role
		})
		.from(universeEditors)
		.innerJoin(universes, eq(universes.id, universeEditors.universeId))
		.where(eq(universeEditors.playerId, playerId))
		.orderBy(universes.name, universes.id));
}
