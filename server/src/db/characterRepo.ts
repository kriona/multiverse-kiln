/**
 * Characters: the only module that reads or writes the characters, pf1e_characters, character_items,
 * character_drafts and pf1e_ability_rolls tables
 */
import { and, asc, count, desc, eq, ne, sql } from 'drizzle-orm';
import { isPf1eRollMethod, type CharacterDraft, type ItemQuantity, type Pf1eAbilityScores, type Pf1eMoney, type Pf1eRollMethod } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { characterDrafts, characterItems, characters, pf1eAbilityRolls, pf1eCharacters } from './schema.js';

/**
 * A character as the lobby lists it
 */
export interface CharacterRecord
{
	id: string;
	name: string;
	raceId: number;
	classId: number;
}

/**
 * A character as the lobby plays them
 */
export interface PlayableCharacter
{
	id: string;
	name: string;
}

/**
 * What a new character needs
 */
export interface NewCharacter
{
	playerId: string;
	universeId: string;
	name: string;

	/**
	 * The ID everything else uses for the race: a default race's own, never its edited copy's
	 */
	raceId: number;

	/**
	 * The ID everything else uses for the class
	 */
	classId: number;

	/**
	 * The ability scores, with the race's modifiers added
	 */
	abilityScores: Pf1eAbilityScores;

	money: Pf1eMoney;

	/**
	 * The items the character carries, each listed once by its own ID
	 */
	items: readonly ItemQuantity[];

	/**
	 * Where the character starts, or null when nothing names a zone
	 */
	zoneId: string | null;
}

/**
 * Ability scores the server rolled for a player's next character
 */
export interface Pf1eAbilityRoll
{
	statMethod: Pf1eRollMethod;

	/**
	 * One score per ability, in the order they were rolled
	 */
	scores: number[];
}

/**
 * A player's characters in a universe
 *
 * @param playerId The player's ID
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The characters, oldest first
 */
export async function listCharacters(playerId: string, universeId: string, executor: Executor = db): Promise<CharacterRecord[]>
{
	return(executor
		.select({
			id: characters.id,
			name: characters.name,
			raceId: characters.raceId,
			classId: characters.classId
		})
		.from(characters)
		.where(and(
			eq(characters.playerId, playerId),
			eq(characters.universeId, universeId)
		))
		.orderBy(asc(characters.createdAt), asc(characters.id)));
}

/**
 * A player's characters in a universe as the lobby plays them
 *
 * @param playerId The player's ID
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The characters, the one played or made most recently first
 */
export async function listPlayableCharacters(playerId: string, universeId: string, executor: Executor = db): Promise<PlayableCharacter[]>
{
	return(executor
		.select({
			id: characters.id,
			name: characters.name
		})
		.from(characters)
		.where(and(
			eq(characters.playerId, playerId),
			eq(characters.universeId, universeId)
		))
		.orderBy(desc(sql`coalesce(${characters.lastPlayedAt}, ${characters.createdAt})`), asc(characters.id)));
}

/**
 * Records that a player has stopped playing a character, so the lobby starts them as it next time
 *
 * @param characterId The character's ID
 * @param playedAt When they stopped
 * @param executor The database, or a transaction
 */
export async function markCharacterPlayed(characterId: string, playedAt: Date, executor: Executor = db): Promise<void>
{
	await executor
		.update(characters)
		.set({
			lastPlayedAt: playedAt
		})
		.where(eq(characters.id, characterId));
}

/**
 * How many characters a player has in a universe
 *
 * @param playerId The player's ID
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The number of characters
 */
export async function countCharacters(playerId: string, universeId: string, executor: Executor = db): Promise<number>
{
	const [row] = await executor
		.select({ total: count() })
		.from(characters)
		.where(and(
			eq(characters.playerId, playerId),
			eq(characters.universeId, universeId)
		));

	return(row.total);
}

/**
 * Adds a character with their ability scores and items. Call it inside a transaction, so a character
 * is never left without them
 *
 * @param character The character
 * @param executor A transaction
 * @return The new character's ID
 */
export async function createCharacter(character: NewCharacter, executor: Executor): Promise<string>
{
	const { money } = character;
	const [created] = await executor
		.insert(characters)
		.values({
			playerId: character.playerId,
			universeId: character.universeId,
			name: character.name,
			raceId: character.raceId,
			classId: character.classId,
			platinum: money.pp,
			gold: money.gp,
			silver: money.sp,
			copper: money.cp,
			zoneId: character.zoneId
		})
		.returning({ id: characters.id });

	await executor
		.insert(pf1eCharacters)
		.values({
			characterId: created.id,
			...character.abilityScores
		});

	if (character.items.length > 0)
	{
		await executor
			.insert(characterItems)
			.values(character.items.map(({ itemId, quantity }) => ({
				characterId: created.id,
				itemId,
				quantity
			})));
	}

	return(created.id);
}

/**
 * Whether any character is a race
 *
 * @param raceId The race's ID
 * @param executor The database, or a transaction
 * @return True when one is
 */
export async function hasCharactersOfRace(raceId: number, executor: Executor = db): Promise<boolean>
{
	const rows = await executor
		.select({ id: characters.id })
		.from(characters)
		.where(eq(characters.raceId, raceId))
		.limit(1);

	return(rows.length > 0);
}

/**
 * Whether any character is a class
 *
 * @param classId The class's ID
 * @param executor The database, or a transaction
 * @return True when one is
 */
export async function hasCharactersOfClass(classId: number, executor: Executor = db): Promise<boolean>
{
	const rows = await executor
		.select({ id: characters.id })
		.from(characters)
		.where(eq(characters.classId, classId))
		.limit(1);

	return(rows.length > 0);
}

/**
 * Whether any character carries an item
 *
 * @param itemId The item's ID
 * @param executor The database, or a transaction
 * @return True when one does
 */
export async function isCarriedItem(itemId: number, executor: Executor = db): Promise<boolean>
{
	const rows = await executor
		.select({ characterId: characterItems.characterId })
		.from(characterItems)
		.where(eq(characterItems.itemId, itemId))
		.limit(1);

	return(rows.length > 0);
}

/**
 * A player's saved progress in Create Character in a universe
 *
 * @param playerId The player's ID
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The progress as it was stored (a CharacterDraft, unless it was saved by an older version of
 * Create Character), or undefined when there is none
 */
export async function findCharacterDraft(playerId: string, universeId: string, executor: Executor = db): Promise<unknown>
{
	const [row] = await executor
		.select({ draft: characterDrafts.draft })
		.from(characterDrafts)
		.where(and(
			eq(characterDrafts.playerId, playerId),
			eq(characterDrafts.universeId, universeId)
		))
		.limit(1);

	return(row?.draft);
}

/**
 * Stores a player's progress in Create Character in a universe, replacing what was saved
 *
 * @param playerId The player's ID
 * @param universeId The universe's ID
 * @param draft The progress
 * @param executor The database, or a transaction
 */
export async function saveCharacterDraft(playerId: string, universeId: string, draft: CharacterDraft, executor: Executor = db): Promise<void>
{
	await executor
		.insert(characterDrafts)
		.values({
			playerId,
			universeId,
			draft
		})
		.onConflictDoUpdate({
			target: [characterDrafts.playerId, characterDrafts.universeId],
			set: {
				draft,
				updatedAt: new Date()
			}
		});
}

/**
 * Throws away a player's progress in Create Character in a universe
 *
 * @param playerId The player's ID
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 */
export async function deleteCharacterDraft(playerId: string, universeId: string, executor: Executor = db): Promise<void>
{
	await executor
		.delete(characterDrafts)
		.where(and(
			eq(characterDrafts.playerId, playerId),
			eq(characterDrafts.universeId, universeId)
		));
}

/**
 * The ability scores rolled for a player's next character in a universe, rolled the way the universe
 * rolls them now. Scores rolled another way are replaced with the scores given; scores already rolled
 * this way are kept, even when two requests arrive at once
 *
 * @param playerId The player's ID
 * @param universeId The universe's ID
 * @param roll The scores to keep when there are none rolled this way, and how they were rolled
 * @param executor The database, or a transaction
 * @return The scores kept
 */
export async function keepPf1eAbilityRoll(playerId: string, universeId: string, roll: Pf1eAbilityRoll, executor: Executor = db): Promise<Pf1eAbilityRoll>
{
	await executor
		.insert(pf1eAbilityRolls)
		.values({
			playerId,
			universeId,
			...roll
		})
		.onConflictDoUpdate({
			target: [pf1eAbilityRolls.playerId, pf1eAbilityRolls.universeId],
			set: {
				...roll,
				createdAt: new Date()
			},
			setWhere: ne(pf1eAbilityRolls.statMethod, roll.statMethod)
		});

	const kept = await findPf1eAbilityRoll(playerId, universeId, executor);

	if (!kept)
	{
		throw new Error(`The ability scores rolled for player ${playerId} in universe ${universeId} are missing`);
	}

	return(kept);
}

/**
 * The ability scores rolled for a player's next character in a universe
 *
 * @param playerId The player's ID
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The scores, or undefined when none have been rolled
 */
export async function findPf1eAbilityRoll(playerId: string, universeId: string, executor: Executor = db): Promise<Pf1eAbilityRoll | undefined>
{
	const [row] = await executor
		.select({
			statMethod: pf1eAbilityRolls.statMethod,
			scores: pf1eAbilityRolls.scores
		})
		.from(pf1eAbilityRolls)
		.where(and(
			eq(pf1eAbilityRolls.playerId, playerId),
			eq(pf1eAbilityRolls.universeId, universeId)
		))
		.limit(1);

	if (!row)
	{
		return(undefined);
	}

	const { statMethod, scores } = row;

	if (!isPf1eRollMethod(statMethod))
	{
		throw new Error(`The ability scores kept for player ${playerId} in universe ${universeId} weren't rolled (${statMethod})`);
	}

	return({ statMethod, scores });
}

/**
 * Forgets the ability scores rolled for a player's next character in a universe, once a character has
 * been made with them
 *
 * @param playerId The player's ID
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 */
export async function deletePf1eAbilityRoll(playerId: string, universeId: string, executor: Executor = db): Promise<void>
{
	await executor
		.delete(pf1eAbilityRolls)
		.where(and(
			eq(pf1eAbilityRolls.playerId, playerId),
			eq(pf1eAbilityRolls.universeId, universeId)
		));
}
