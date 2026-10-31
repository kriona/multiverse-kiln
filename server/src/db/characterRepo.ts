/**
 * Characters: the only module that reads or writes the characters, pf1e_characters, sf1e_characters,
 * character_items, character_drafts and pf1e_ability_rolls tables. It reads group_members only to
 * tell which characters are in a group, and universes only to name a profile's characters' universes
 */
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { isPf1eRollMethod, type AbilityScores, type CharacterDraft, type ItemQuantity, type Money, type Pf1eRollMethod, type Ruleset, type UniverseStage } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { characterDrafts, characterItems, characters, groupMembers, pf1eAbilityRolls, pf1eCharacters, sf1eCharacters, universes } from './schema.js';

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

	/**
	 * The group the character is in, or null when they are in none
	 */
	groupId: string | null;
}

/**
 * A character as a profile lists them, with their universe
 */
export interface ProfileCharacterRecord
{
	id: string;
	name: string;
	raceId: number;
	classId: number;
	visibleOnProfile: boolean;
	universeId: string;
	universeSlug: string;
	universeName: string;
	ruleset: Ruleset;
}

/**
 * One of a player's characters, as the group routes check them
 */
export interface OwnCharacter
{
	id: string;
	name: string;
	raceId: number;
	classId: number;

	/**
	 * Whether the character can be played: they haven't been given their last rites
	 */
	playable: boolean;
}

/**
 * A character with everything their character sheet shows
 */
export interface CharacterDetails extends Omit<CharacterRecord, 'groupId'>
{
	/**
	 * The theme, by the ID everything else uses for it, in a ruleset with themes; null otherwise
	 */
	themeId: number | null;

	/**
	 * The ability scores, with the race's modifiers and theme's bonus added
	 */
	abilityScores: AbilityScores;

	money: Money;

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
	raceId: number;
}

/**
 * What a new character needs
 */
export interface NewCharacter
{
	playerId: string;
	universeId: string;

	/**
	 * The universe's ruleset, whose table holds the ability scores
	 */
	ruleset: Ruleset;

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
	 * The ID everything else uses for the theme, in a ruleset with themes; null otherwise
	 */
	themeId: number | null;

	/**
	 * The ability scores, with the race's modifiers and theme's bonus added
	 */
	abilityScores: AbilityScores;

	money: Money;

	/**
	 * The items the character carries, each listed once by its own ID
	 */
	items: readonly ItemQuantity[];
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
 * When a character was last played, or made when they haven't been: the lobby and Enter Universe play
 * the most recent
 */
const playedAt = sql`coalesce(${characters.lastPlayedAt}, ${characters.createdAt})`;

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
			deleteAt: characters.deleteAt,
			groupId: groupMembers.groupId
		})
		.from(characters)
		.leftJoin(groupMembers, eq(groupMembers.characterId, characters.id))
		.where(and(
			eq(characters.playerId, playerId),
			eq(characters.universeId, universeId),
			notExpired
		))
		.orderBy(asc(characters.createdAt), asc(characters.id)));
}

/**
 * A player's characters in every universe, as their profile lists them: those not given their last
 * rites, by universe name and then character name
 *
 * @param playerId The player's ID
 * @param filter Which to list: only those in universes at some stages (for others to see), and only those marked visible
 * @param executor The database, or a transaction
 * @return The characters
 */
export async function listProfileCharacters(playerId: string, filter: { stages?: UniverseStage[]; onlyVisible?: boolean }, executor: Executor = db): Promise<ProfileCharacterRecord[]>
{
	return(executor
		.select({
			id: characters.id,
			name: characters.name,
			raceId: characters.raceId,
			classId: characters.classId,
			visibleOnProfile: characters.visibleOnProfile,
			universeId: universes.id,
			universeSlug: universes.slug,
			universeName: universes.name,
			ruleset: universes.ruleset
		})
		.from(characters)
		.innerJoin(universes, eq(universes.id, characters.universeId))
		.where(and(
			eq(characters.playerId, playerId),
			isNull(characters.deleteAt),
			((filter.stages === undefined) ? undefined : inArray(universes.stage, filter.stages)),
			(filter.onlyVisible ? eq(characters.visibleOnProfile, true) : undefined)
		))
		.orderBy(asc(universes.name), asc(universes.id), asc(characters.name), asc(characters.id)));
}

/**
 * Sets whether a player's profile lists one of their characters when it doesn't list them all
 *
 * @param playerId The player's ID
 * @param characterId The character's ID
 * @param visibleOnProfile Whether the profile lists them
 * @param executor The database, or a transaction
 * @return Whether the player has such a character
 */
export async function setCharacterVisibility(playerId: string, characterId: string, visibleOnProfile: boolean, executor: Executor = db): Promise<boolean>
{
	const rows = await executor
		.update(characters)
		.set({
			visibleOnProfile
		})
		.where(and(
			eq(characters.id, characterId),
			eq(characters.playerId, playerId),
			isNull(characters.deleteAt)
		))
		.returning({
			id: characters.id
		});

	return(rows.length > 0);
}

/**
 * One of a player's characters in a universe, with their ability scores, money and items
 *
 * @param playerId The player's ID
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset, whose table holds the ability scores
 * @param characterId The character's ID
 * @param executor The database, or a transaction
 * @return The character, or undefined when the player has no such character in the universe
 */
export async function findCharacterDetails(playerId: string, universeId: string, ruleset: Ruleset, characterId: string, executor: Executor = db): Promise<CharacterDetails | undefined>
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
			credits: characters.credits
		})
		.from(characters)
		.where(and(
			ownCharacter(playerId, universeId, characterId),
			notExpired
		))
		.limit(1);
	const abilities = (row ? await findCharacterAbilities(ruleset, characterId, executor) : undefined);

	if (!row || !abilities)
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
		themeId: abilities.themeId,
		abilityScores: abilities.abilityScores,
		money: {
			pp: row.platinum,
			gp: row.gold,
			sp: row.silver,
			cp: row.copper,
			cr: row.credits
		},
		items: carried
	});
}

/**
 * A character's ability scores and theme, from their ruleset's table
 *
 * @param ruleset The universe's ruleset
 * @param characterId The character's ID
 * @param executor The database, or a transaction
 * @return The scores, and the theme or null in a ruleset without themes; undefined when the
 * ruleset's table has no row for the character
 */
async function findCharacterAbilities(ruleset: Ruleset, characterId: string, executor: Executor): Promise<{ abilityScores: AbilityScores; themeId: number | null } | undefined>
{
	switch (ruleset)
	{
		case 'pf1e':
		{
			const [row] = await executor
				.select({
					strength: pf1eCharacters.strength,
					dexterity: pf1eCharacters.dexterity,
					constitution: pf1eCharacters.constitution,
					intelligence: pf1eCharacters.intelligence,
					wisdom: pf1eCharacters.wisdom,
					charisma: pf1eCharacters.charisma
				})
				.from(pf1eCharacters)
				.where(eq(pf1eCharacters.characterId, characterId))
				.limit(1);

			return((row ? {
				abilityScores: row,
				themeId: null
			} : undefined));
		}

		case 'sf1e':
		{
			const [row] = await executor
				.select({
					themeId: sf1eCharacters.themeId,
					strength: sf1eCharacters.strength,
					dexterity: sf1eCharacters.dexterity,
					constitution: sf1eCharacters.constitution,
					intelligence: sf1eCharacters.intelligence,
					wisdom: sf1eCharacters.wisdom,
					charisma: sf1eCharacters.charisma
				})
				.from(sf1eCharacters)
				.where(eq(sf1eCharacters.characterId, characterId))
				.limit(1);

			if (!row)
			{
				return(undefined);
			}

			const { themeId, ...abilityScores } = row;

			return({
				abilityScores,
				themeId
			});
		}
	}
}

/**
 * A player's characters in a universe as the lobby plays them, leaving out those given their last rites
 * and those in a group, who play there
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
			name: characters.name,
			raceId: characters.raceId
		})
		.from(characters)
		.leftJoin(groupMembers, eq(groupMembers.characterId, characters.id))
		.where(and(
			eq(characters.playerId, playerId),
			eq(characters.universeId, universeId),
			isNull(characters.deleteAt),
			isNull(groupMembers.characterId)
		))
		.orderBy(desc(playedAt), asc(characters.id)));
}

/**
 * The character a player played or made most recently in a universe, in a group or not, leaving out
 * those given their last rites
 *
 * @param playerId The player's ID
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The character's ID, or undefined when the player has none to play
 */
export async function findLastPlayedCharacterId(playerId: string, universeId: string, executor: Executor = db): Promise<string | undefined>
{
	const [row] = await executor
		.select({
			id: characters.id
		})
		.from(characters)
		.where(and(
			eq(characters.playerId, playerId),
			eq(characters.universeId, universeId),
			isNull(characters.deleteAt)
		))
		.orderBy(desc(playedAt), asc(characters.id))
		.limit(1);

	return(row?.id);
}

/**
 * One of a player's characters in a universe, as the group routes check them
 *
 * @param playerId The player's ID
 * @param universeId The universe's ID
 * @param characterId The character's ID
 * @param executor The database, or a transaction
 * @return The character, or undefined when the player has no such character in the universe
 */
export async function findOwnCharacter(playerId: string, universeId: string, characterId: string, executor: Executor = db): Promise<OwnCharacter | undefined>
{
	const [row] = await executor
		.select({
			id: characters.id,
			name: characters.name,
			raceId: characters.raceId,
			classId: characters.classId,
			deleteAt: characters.deleteAt
		})
		.from(characters)
		.where(and(
			ownCharacter(playerId, universeId, characterId),
			notExpired
		))
		.limit(1);

	if (!row)
	{
		return(undefined);
	}

	return({
		id: row.id,
		name: row.name,
		raceId: row.raceId,
		classId: row.classId,
		playable: (row.deleteAt === null)
	});
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
 * Deletes one of a player's characters, with their ability scores and items, immediately
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
			name: characters.name,
			raceId: characters.raceId
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
			credits: money.cr
		})
		.returning({ id: characters.id });

	switch (character.ruleset)
	{
		case 'pf1e':
			await executor
				.insert(pf1eCharacters)
				.values({
					characterId: created.id,
					...character.abilityScores
				});
			break;

		case 'sf1e':
			if (character.themeId === null)
			{
				throw new Error('A Starfinder 1E character needs a theme');
			}
			await executor
				.insert(sf1eCharacters)
				.values({
					characterId: created.id,
					themeId: character.themeId,
					...character.abilityScores
				});
			break;
	}

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
 * Whether any character has a theme
 *
 * @param themeId The theme's ID
 * @param executor The database, or a transaction
 * @return True when one does
 */
export async function hasCharactersOfTheme(themeId: number, executor: Executor = db): Promise<boolean>
{
	const rows = await executor
		.select({
			characterId: sf1eCharacters.characterId
		})
		.from(sf1eCharacters)
		.where(eq(sf1eCharacters.themeId, themeId))
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
 * A player's saved progress in Create Character in every universe, for their data export
 *
 * @param playerId The player's ID
 * @param executor The database, or a transaction
 * @return The progress in each universe, as it was stored
 */
export async function listCharacterDrafts(playerId: string, executor: Executor = db): Promise<{ universeId: string; draft: unknown }[]>
{
	return(executor
		.select({
			universeId: characterDrafts.universeId,
			draft: characterDrafts.draft
		})
		.from(characterDrafts)
		.where(eq(characterDrafts.playerId, playerId))
		.orderBy(characterDrafts.updatedAt));
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
