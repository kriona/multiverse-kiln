/**
 * Who may work on each universe: the only module that reads or writes the universe_editors table
 */
import { and, count, eq, ne, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { NO_BUILDER_PERMISSIONS, type BuilderPermissions, type EditableUniverseSummary, type PlayerMatch, type UniverseAccess, type UniverseEditorSummary, type UniverseRole } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { searchPlayers, type PlayerSearch } from './playerRepo.js';
import { players, universeEditors, universes } from './schema.js';

/**
 * A universe a player is the only creator of
 */
export interface SoleCreatedUniverse
{
	id: string;
	name: string;

	/**
	 * Whether a server admin who disabled it kept its creators from deleting it
	 */
	deletionPrevented: boolean;

	/**
	 * Whether it requires its editors to have 2FA on
	 */
	requireTwoFactor: boolean;
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
 * Gives a player a role in a universe, replacing any role and languages they had
 *
 * @param universeId The universe's ID
 * @param playerId The player's ID
 * @param role The role
 * @param executor The database, or a transaction
 */
export async function setUniverseRole(universeId: string, playerId: string, role: UniverseRole, executor: Executor = db): Promise<void>
{
	await setUniverseAccess(universeId, playerId, { role, languages: [] }, executor);
}

/**
 * Gives a player a role in a universe, a translator their languages and a builder their permissions,
 * replacing what they had
 *
 * @param universeId The universe's ID
 * @param playerId The player's ID
 * @param access The role, the languages for a translator and the permissions for a builder (left out
 * for any other role)
 * @param executor The database, or a transaction
 */
export async function setUniverseAccess(universeId: string, playerId: string, access: UniverseAccess, executor: Executor = db): Promise<void>
{
	const role = access.role;
	const languages = ((role === 'translator') ? [...access.languages] : []);
	const permissions = (((role === 'builder') ? access.permissions : undefined) ?? NO_BUILDER_PERMISSIONS);
	const values = {
		role,
		languages,
		canEditTiles: permissions.canEditTiles,
		canEditItems: permissions.canEditItems,
		canEditMobs: permissions.canEditMobs
	};

	await executor
		.insert(universeEditors)
		.values({
			universeId,
			playerId,
			...values
		})
		.onConflictDoUpdate({
			target: [universeEditors.universeId, universeEditors.playerId],
			set: values
		});
}

/**
 * Takes a player's role in a universe away
 *
 * @param universeId The universe's ID
 * @param playerId The player's ID
 * @param executor The database, or a transaction
 * @return False when the player had no role in it
 */
export async function removeUniverseEditor(universeId: string, playerId: string, executor: Executor = db): Promise<boolean>
{
	const removed = await executor
		.delete(universeEditors)
		.where(and(
			eq(universeEditors.universeId, universeId),
			eq(universeEditors.playerId, playerId)
		))
		.returning({
			playerId: universeEditors.playerId
		});

	return(removed.length > 0);
}

/**
 * A player's role in a universe, and their languages as a translator
 *
 * @param universeId The universe's ID
 * @param playerId The player's ID
 * @param executor The database, or a transaction
 * @return The role, languages and a builder's permissions, or undefined when the player has no role
 */
export async function findUniverseAccess(universeId: string, playerId: string, executor: Executor = db): Promise<UniverseAccess | undefined>
{
	const [row] = await executor
		.select({
			role: universeEditors.role,
			languages: universeEditors.languages,
			canEditTiles: universeEditors.canEditTiles,
			canEditItems: universeEditors.canEditItems,
			canEditMobs: universeEditors.canEditMobs
		})
		.from(universeEditors)
		.where(and(
			eq(universeEditors.universeId, universeId),
			eq(universeEditors.playerId, playerId)
		))
		.limit(1);

	if (!row)
	{
		return(undefined);
	}

	return({
		role: row.role,
		languages: row.languages,
		permissions: permissionsOf(row)
	});
}

/**
 * A builder's permissions from their row
 *
 * @param row The row's permission columns
 * @return The permissions
 */
function permissionsOf(row: BuilderPermissions): BuilderPermissions
{
	return({
		canEditTiles: row.canEditTiles,
		canEditItems: row.canEditItems,
		canEditMobs: row.canEditMobs
	});
}

/**
 * Players who could be added to a universe's editors: those whose username, or name unless only
 * usernames are searched, holds some text, ignoring capitals, other than its editors
 *
 * @param universeId The universe's ID
 * @param search The text, and whether only usernames are searched (parsePlayerSearch())
 * @param limit The most players to return
 * @param executor The database, or a transaction
 * @return The players: the one with exactly that username first, then those whose username starts
 * with it, then the rest, each by username
 */
export async function searchPlayersToAdd(universeId: string, search: PlayerSearch, limit: number, executor: Executor = db): Promise<PlayerMatch[]>
{
	return(searchPlayers(search, limit, notExists(executor
		.select({
			playerId: universeEditors.playerId
		})
		.from(universeEditors)
		.where(and(
			eq(universeEditors.universeId, universeId),
			eq(universeEditors.playerId, players.id)
		))), executor));
}

/**
 * How many creators a universe has
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The number of creators
 */
export async function countUniverseCreators(universeId: string, executor: Executor = db): Promise<number>
{
	const [row] = await executor
		.select({
			total: count()
		})
		.from(universeEditors)
		.where(and(
			eq(universeEditors.universeId, universeId),
			eq(universeEditors.role, 'creator')
		));

	return(row.total);
}

/**
 * Everyone with a role in a universe
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @param executor The database, or a transaction
 * @param assignments The live regions each builder is assigned to, by player ID
 * (listAssignmentsByBuilder()), for those who show them; none when left out
 * @return The editors, by username
 */
export async function listUniverseEditors(universeId: string, executor: Executor = db, assignments: ReadonlyMap<string, string[]> = new Map()): Promise<UniverseEditorSummary[]>
{
	const rows = await executor
		.select({
			playerId: universeEditors.playerId,
			username: players.username,
			displayName: players.displayName,
			role: universeEditors.role,
			languages: universeEditors.languages,
			canEditTiles: universeEditors.canEditTiles,
			canEditItems: universeEditors.canEditItems,
			canEditMobs: universeEditors.canEditMobs
		})
		.from(universeEditors)
		.innerJoin(players, eq(players.id, universeEditors.playerId))
		.where(eq(universeEditors.universeId, universeId))
		.orderBy(sql`lower(${players.username})`);

	return(rows.map((row) => ({
		playerId: row.playerId,
		username: row.username,
		displayName: row.displayName,
		role: row.role,
		languages: row.languages,
		permissions: permissionsOf(row),
		regionIds: (assignments.get(row.playerId) ?? [])
	})));
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
 * Every editor's role in a universe
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The roles, by player ID
 */
export async function listUniverseRoles(universeId: string, executor: Executor = db): Promise<Map<string, UniverseRole>>
{
	const rows = await executor
		.select({
			playerId: universeEditors.playerId,
			role: universeEditors.role
		})
		.from(universeEditors)
		.where(eq(universeEditors.universeId, universeId));

	return(new Map(rows.map((row) => [row.playerId, row.role])));
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
			sourceLanguage: universes.sourceLanguage,
			translationLanguages: universes.translationLanguages,
			stage: universes.stage,
			role: universeEditors.role,
			disabled: sql<boolean>`(${universes.disabledAt} IS NOT NULL)`
		})
		.from(universeEditors)
		.innerJoin(universes, eq(universes.id, universeEditors.universeId))
		.where(eq(universeEditors.playerId, playerId))
		.orderBy(universes.name, universes.id));
}

/**
 * The universes a player is a creator of that have no other creator, which deleting the player's
 * account has to hand on or delete (only hand on, when a server admin prevented deleting it)
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
			name: universes.name,
			deletionPrevented: universes.deletionPrevented,
			requireTwoFactor: universes.requireTwoFactor
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
 * The names of the universes that require their editors to have 2FA on in which a player has a role:
 * those turning 2FA off keeps them from opening in the editor
 *
 * @param playerId The player's ID
 * @param executor The database, or a transaction
 * @return The names, by name
 */
export async function listTwoFactorUniverseNames(playerId: string, executor: Executor = db): Promise<string[]>
{
	const rows = await executor
		.select({
			name: universes.name
		})
		.from(universeEditors)
		.innerJoin(universes, eq(universes.id, universeEditors.universeId))
		.where(and(
			eq(universeEditors.playerId, playerId),
			eq(universes.requireTwoFactor, true)
		))
		.orderBy(universes.name, universes.id);

	return(rows.map((row) => row.name));
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
