/**
 * Characters: the only module that reads or writes the characters, pf1e_characters, character_items,
 * character_drafts and pf1e_ability_rolls tables
 */
import { and, asc, count, desc, eq, gt, isNotNull, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
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

	/**
	 * When the character is deleted, once given their last rites; null otherwise
	 */
	deleteAt: Date | null;
}

/**
 * A character with everything their character sheet shows
 */
export interface CharacterDetails extends CharacterRecord
{
	/**
	 * The ability scores, with the race's modifiers added
	 */
	abilityScores: Pf1eAbilityScores;

	money: Pf1eMoney;

	/**
	 * The items the character carries, each listed once by its own ID, by ID
	 */
	items: ItemQuantity[];
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
	 * Where the character starts, or null when nothing names an area
	 */
	areaId: string | null;
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
 * Matches the characters that still exist: those not given their last rites, and those whose time
 * hasn't come. Characters past their time are hidden until the sweep deletes them
 */
const notExpired = or(isNull(characters.deleteAt), gt(characters.deleteAt, sql`now()`));

/**
 * Matches one of a player's characters in a universe
 *
 * @param playerId The player's ID
 * @param universeId The universe's ID
 * @param characterId The character's ID
 * @return The condition
 */
function ownCharacter(playerId: string, universeId: string, characterId: string): SQL | undefined
{
	return(and(
		eq(characters.id, characterId),
		eq(characters.playerId, playerId),
		eq(characters.universeId, universeId)
	));
}

/**
 * A player's characters in a universe, including those given their last rites
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
			classId: characters.classId,
			deleteAt: characters.deleteAt
		})
		.from(characters)
		.where(and(
			eq(characters.playerId, playerId),
			eq(characters.universeId, universeId),
			notExpired
		))
		.orderBy(asc(characters.createdAt), asc(characters.id)));
}

/**
 * One of a player's characters in a universe, with their ability scores, money and items
 *
 * @param playerId The player's ID
 * @param universeId The universe's ID
 * @param characterId The character's ID
 * @param executor The database, or a transaction
 * @return The character, or undefined when the player has no such character in the universe
 */
export async function findCharacterDetails(playerId: string, universeId: string, characterId: string, executor: Executor = db): Promise<CharacterDetails | undefined>
{
	const [row] = await executor
		.select({
			id: characters.id,
			name: characters.name,
			raceId: characters.raceId,
			classId: characters.classId,
			deleteAt: characters.deleteAt,
			platinum: characters.platinum,
			gold: characters.gold,
			silver: characters.silver,
			copper: characters.copper,
			strength: pf1eCharacters.strength,
			dexterity: pf1eCharacters.dexterity,
			constitution: pf1eCharacters.constitution,
			intelligence: pf1eCharacters.intelligence,
			wisdom: pf1eCharacters.wisdom,
			charisma: pf1eCharacters.charisma
		})
		.from(characters)
		.innerJoin(pf1eCharacters, eq(pf1eCharacters.characterId, characters.id))
		.where(and(
			ownCharacter(playerId, universeId, characterId),
			notExpired
		))
		.limit(1);

	if (!row)
	{
		return(undefined);
	}

	const carried = await executor
		.select({
			itemId: characterItems.itemId,
			quantity: characterItems.quantity
		})
		.from(characterItems)
		.where(eq(characterItems.characterId, characterId))
		.orderBy(asc(characterItems.itemId));

	return({
		id: row.id,
		name: row.name,
		raceId: row.raceId,
		classId: row.classId,
		deleteAt: row.deleteAt,
		abilityScores: {
			strength: row.strength,
			dexterity: row.dexterity,
			constitution: row.constitution,
			intelligence: row.intelligence,
			wisdom: row.wisdom,
			charisma: row.charisma
		},
		money: {
			pp: row.platinum,
			gp: row.gold,
			sp: row.silver,
			cp: row.copper
		},
		items: carried
	});
}

/**
 * A player's characters in a universe as the lobby plays them, leaving out those given their last rites
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
			eq(characters.universeId, universeId),
			isNull(characters.deleteAt)
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
 * How many characters a player has in a universe, counting those given their last rites until their
 * time comes
 *
 * @param playerId The player's ID
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The number of characters
 */
export async function countCharacters(playerId: string, universeId: string, executor: Executor = db): Promise<number>
{
	const [row] = await executor
		.select({
			total: count()
		})
		.from(characters)
		.where(and(
			eq(characters.playerId, playerId),
			eq(characters.universeId, universeId),
			notExpired
		));

	return(row.total);
}

/**
 * Deletes one of a player's characters, with their ability scores and items, straight away
 *
 * @param playerId The player's ID
 * @param universeId The universe's ID
 * @param characterId The character's ID
 * @param executor The database, or a transaction
 * @return False when the player has no such character in the universe
 */
export async function deleteCharacter(playerId: string, universeId: string, characterId: string, executor: Executor = db): Promise<boolean>
{
	const deleted = await executor
		.delete(characters)
		.where(ownCharacter(playerId, universeId, characterId))
		.returning({ id: characters.id });

	return(deleted.length > 0);
}

/**
 * Gives one of a player's characters their last rites, so the sweep deletes them at a time to come. A
 * character already given them keeps the time they were given
 *
 * @param playerId The player's ID
 * @param universeId The universe's ID
 * @param characterId The character's ID
 * @param deleteAt When to delete them
 * @param executor The database, or a transaction
 * @return When the character is deleted, or undefined when the player has no such character in the universe
 */
export async function scheduleCharacterDeletion(playerId: string, universeId: string, characterId: string, deleteAt: Date, executor: Executor = db): Promise<Date | undefined>
{
	const [row] = await executor
		.update(characters)
		.set({
			deleteAt: sql`coalesce(${characters.deleteAt}, ${deleteAt})`
		})
		.where(and(
			ownCharacter(playerId, universeId, characterId),
			notExpired
		))
		.returning({ deleteAt: characters.deleteAt });

	return(row?.deleteAt ?? undefined);
}

/**
 * Takes back the last rites of one of a player's characters whose time hasn't come, so they can be played again
 *
 * @param playerId The player's ID
 * @param universeId The universe's ID
 * @param characterId The character's ID
 * @param executor The database, or a transaction
 * @return The character, or undefined when the player has no such character waiting to be deleted
 */
export async function restoreCharacter(playerId: string, universeId: string, characterId: string, executor: Executor = db): Promise<PlayableCharacter | undefined>
{
	const [row] = await executor
		.update(characters)
		.set({
			deleteAt: null
		})
		.where(and(
			ownCharacter(playerId, universeId, characterId),
			isNotNull(characters.deleteAt),
			gt(characters.deleteAt, sql`now()`)
		))
		.returning({
			id: characters.id,
			name: characters.name
		});

	return(row);
}

/**
 * Deletes every character whose last rites' time has come
 *
 * @param executor The database, or a transaction
 * @return How many were deleted
 */
export async function purgeExpiredCharacters(executor: Executor = db): Promise<number>
{
	const deleted = await executor
		.delete(characters)
		.where(lte(characters.deleteAt, sql`now()`))
		.returning({ id: characters.id });

	return(deleted.length);
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
			areaId: character.areaId
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
		.select({
			id: characters.id
		})
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
		.select({
			id: characters.id
		})
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
		.select({
			characterId: characterItems.characterId
		})
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
		.select({
			draft: characterDrafts.draft
		})
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
