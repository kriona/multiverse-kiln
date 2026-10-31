/**
 * Who may work on each universe: the only module that reads or writes the universe_editors table
 */
import { and, count, eq, ne, notExists } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { EditableUniverseSummary, UniverseRole } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { players, universeEditors, universes } from './schema.js';

/**
 * A universe a player is the only creator of
 */
export interface SoleCreatedUniverse
{
	id: string;
	name: string;
}

/**
 * Someone with a role in a universe
 */
export interface UniverseEditor
{
	playerId: string;
	username: string;
	displayName: string;
	role: UniverseRole;
}

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

/**
 * The universes a player is a creator of that have no other creator, which deleting the player's
 * account has to hand on or delete
 *
 * @param playerId The player's ID
 * @param executor The database, or a transaction
 * @return The universes, by name
 */
export async function listSoleCreatedUniverses(playerId: string, executor: Executor = db): Promise<SoleCreatedUniverse[]>
{
	const otherCreators = alias(universeEditors, 'other_creators');

	return(executor
		.select({
			id: universes.id,
			name: universes.name
		})
		.from(universeEditors)
		.innerJoin(universes, eq(universes.id, universeEditors.universeId))
		.where(and(
			eq(universeEditors.playerId, playerId),
			eq(universeEditors.role, 'creator'),
			notExists(executor
				.select({
					playerId: otherCreators.playerId
				})
				.from(otherCreators)
				.where(and(
					eq(otherCreators.universeId, universeEditors.universeId),
					eq(otherCreators.role, 'creator'),
					ne(otherCreators.playerId, playerId)
				)))
		))
		.orderBy(universes.name, universes.id));
}

/**
 * Everyone with a role in a universe, but one player
 *
 * @param universeId The universe's ID
 * @param exceptPlayerId The player left out
 * @param executor The database, or a transaction
 * @return The editors, by username
 */
export async function listOtherUniverseEditors(universeId: string, exceptPlayerId: string, executor: Executor = db): Promise<UniverseEditor[]>
{
	return(executor
		.select({
			playerId: universeEditors.playerId,
			username: players.username,
			displayName: players.displayName,
			role: universeEditors.role
		})
		.from(universeEditors)
		.innerJoin(players, eq(players.id, universeEditors.playerId))
		.where(and(
			eq(universeEditors.universeId, universeId),
			ne(universeEditors.playerId, exceptPlayerId)
		))
		.orderBy(players.username));
}
