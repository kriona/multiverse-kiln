/**
 * Avatars: the only module that reads or writes the character_hidden_slots table, and the columns of
 * characters that say how their avatar is drawn (body_type, art_type, background and avatar_hash). What an
 * avatar draws is a pure function in /shared (avatarPicture()); this stores a character's choices and the
 * hash of their stored picture. It reads universes only for their characters' rulesets
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Ruleset } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { characterHiddenSlots, characters, universes } from './schema.js';

/**
 * How a character's avatar is drawn, as stored
 */
export interface CharacterAppearance
{
	bodyType: string;
	artType: string;
	background: string;
}

/**
 * A character's stored look: their appearance, race and hidden slots, and the hash of their stored avatar
 */
export interface StoredLook extends CharacterAppearance
{
	characterId: string;
	universeId: string;
	ruleset: Ruleset;
	raceId: number;

	/**
	 * The hash of the layers their stored avatar was made from, or null when none is stored
	 */
	avatarHash: string | null;

	hiddenSlots: string[];
}

/**
 * The stored looks of some characters, in two queries however many there are, including those given
 * their last rites
 *
 * @param characterIds The characters' IDs
 * @param executor The database, or a transaction
 * @return Each character's look, by ID; one that doesn't exist is left out
 */
export async function findStoredLooks(characterIds: readonly string[], executor: Executor = db): Promise<Map<string, StoredLook>>
{
	if (characterIds.length === 0)
	{
		return(new Map());
	}

	const ids = sql.param([...new Set(characterIds)]);
	const [rows, hidden] = await Promise.all([
		executor
			.select({
				characterId: characters.id,
				universeId: characters.universeId,
				ruleset: universes.ruleset,
				raceId: characters.raceId,
				bodyType: characters.bodyType,
				artType: characters.artType,
				background: characters.background,
				avatarHash: characters.avatarHash
			})
			.from(characters)
			.innerJoin(universes, eq(universes.id, characters.universeId))
			.where(sql`${characters.id} = ANY(${ids}::uuid[])`),
		executor
			.select({
				characterId: characterHiddenSlots.characterId,
				slot: characterHiddenSlots.slot
			})
			.from(characterHiddenSlots)
			.where(sql`${characterHiddenSlots.characterId} = ANY(${ids}::uuid[])`)
			.orderBy(asc(characterHiddenSlots.slot))
	]);
	const hiddenOf = Map.groupBy(hidden, (row) => row.characterId);

	return(new Map(rows.map((row) => [row.characterId, {
		...row,
		hiddenSlots: (hiddenOf.get(row.characterId) ?? []).map(({ slot }) => slot)
	}])));
}

/**
 * The slots a character's avatar draws empty
 *
 * @param characterId The character's ID
 * @param executor The database, or a transaction
 * @return The slots' keys, in order
 */
export async function listHiddenSlots(characterId: string, executor: Executor = db): Promise<string[]>
{
	const rows = await executor
		.select({
			slot: characterHiddenSlots.slot
		})
		.from(characterHiddenSlots)
		.where(eq(characterHiddenSlots.characterId, characterId))
		.orderBy(asc(characterHiddenSlots.slot));

	return(rows.map((row) => row.slot));
}

/**
 * Hides a slot from a character's avatar, or shows it again
 *
 * @param characterId The character's ID
 * @param slot The slot
 * @param hidden Whether to hide it
 * @param executor The database, or a transaction
 * @return Whether it changed
 */
export async function setSlotHidden(characterId: string, slot: string, hidden: boolean, executor: Executor = db): Promise<boolean>
{
	if (hidden)
	{
		const added = await executor
			.insert(characterHiddenSlots)
			.values({
				characterId,
				slot
			})
			.onConflictDoNothing()
			.returning({
				slot: characterHiddenSlots.slot
			});

		return(added.length > 0);
	}

	const removed = await executor
		.delete(characterHiddenSlots)
		.where(and(
			eq(characterHiddenSlots.characterId, characterId),
			eq(characterHiddenSlots.slot, slot)
		))
		.returning({
			slot: characterHiddenSlots.slot
		});

	return(removed.length > 0);
}

/**
 * Changes how a character's avatar is drawn
 *
 * @param characterId The character's ID
 * @param appearance What to change: any of the body type, art type and background
 * @param executor The database, or a transaction
 * @return Whether the character exists
 */
export async function setCharacterAppearance(characterId: string, appearance: Partial<CharacterAppearance>, executor: Executor = db): Promise<boolean>
{
	if (Object.keys(appearance).length === 0)
	{
		return(true);
	}

	const rows = await executor
		.update(characters)
		.set(appearance)
		.where(eq(characters.id, characterId))
		.returning({
			id: characters.id
		});

	return(rows.length > 0);
}

/**
 * The characters of a universe or a player, whose avatars go when it does
 *
 * @param owner The universe's or the player's ID
 * @param executor The database, or a transaction
 * @return The characters' IDs, those given their last rites included
 */
export async function listCharacterIdsOf(owner: { universeId: string } | { playerId: string }, executor: Executor = db): Promise<string[]>
{
	const rows = await executor
		.select({
			id: characters.id
		})
		.from(characters)
		.where((('universeId' in owner) ? eq(characters.universeId, owner.universeId) : eq(characters.playerId, owner.playerId)));

	return(rows.map((row) => row.id));
}

/**
 * Records the hash of the layers a character's stored avatar was made from
 *
 * @param characterId The character's ID
 * @param avatarHash The hash
 * @param executor The database, or a transaction
 * @return Whether the character exists
 */
export async function saveAvatarHash(characterId: string, avatarHash: string, executor: Executor = db): Promise<boolean>
{
	const saved = await executor
		.update(characters)
		.set({
			avatarHash
		})
		.where(eq(characters.id, characterId))
		.returning({
			id: characters.id
		});

	return(saved.length > 0);
}
