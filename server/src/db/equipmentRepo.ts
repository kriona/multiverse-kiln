/**
 * Equipment: the only module that reads or writes the character_equipment table, what each character has
 * equipped. It reads characters only to find a universe's characters and their players. The rules for
 * what equipping does are pure functions in /shared (shared/src/equipment.ts); this stores their outcome
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { EquippedItem } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { characterEquipment, characters } from './schema.js';

/**
 * A character whose equipment changed, for telling their player's windows
 */
export interface EquipmentOwner
{
	characterId: string;
	playerId: string;
}

/**
 * What a character has equipped
 *
 * @param characterId The character's ID
 * @param executor The database, or a transaction
 * @return The equipped items, in no particular order
 */
export async function listEquipment(characterId: string, executor: Executor = db): Promise<EquippedItem[]>
{
	return(executor
		.select({
			slot: characterEquipment.slot,
			itemId: characterEquipment.itemId,
			bothHands: characterEquipment.bothHands
		})
		.from(characterEquipment)
		.where(eq(characterEquipment.characterId, characterId))
		.orderBy(asc(characterEquipment.slot)));
}

/**
 * What each of some characters has equipped, in one query
 *
 * @param characterIds The characters' IDs
 * @param executor The database, or a transaction
 * @return Each character's equipped items, by character ID; a character with none is left out
 */
export async function listEquipmentOf(characterIds: readonly string[], executor: Executor = db): Promise<Map<string, EquippedItem[]>>
{
	if (characterIds.length === 0)
	{
		return(new Map());
	}

	const rows = await executor
		.select({
			characterId: characterEquipment.characterId,
			slot: characterEquipment.slot,
			itemId: characterEquipment.itemId,
			bothHands: characterEquipment.bothHands
		})
		.from(characterEquipment)
		.where(sql`${characterEquipment.characterId} = ANY(${sql.param([...new Set(characterIds)])}::uuid[])`)
		.orderBy(asc(characterEquipment.characterId), asc(characterEquipment.slot));
	const grouped = Map.groupBy(rows, (row) => row.characterId);

	return(new Map([...grouped].map(([characterId, equipped]) => [characterId, equipped.map(({ slot, itemId, bothHands }) => ({
		slot,
		itemId,
		bothHands
	}))])));
}

/**
 * Equips items in slots, replacing what was in them. Each item must be one the character carries
 *
 * @param characterId The character's ID
 * @param equipment The items and their slots
 * @param executor The database, or a transaction
 */
export async function equipItems(characterId: string, equipment: readonly EquippedItem[], executor: Executor = db): Promise<void>
{
	if (equipment.length === 0)
	{
		return;
	}

	await executor
		.insert(characterEquipment)
		.values(equipment.map(({ slot, itemId, bothHands }) => ({
			characterId,
			slot,
			itemId,
			bothHands
		})))
		.onConflictDoUpdate({
			target: [characterEquipment.characterId, characterEquipment.slot],
			set: {
				itemId: sql`excluded.item_id`,
				bothHands: sql`excluded.both_hands`
			}
		});
}

/**
 * Unequips what is in some of a character's slots
 *
 * @param characterId The character's ID
 * @param slots The slots
 * @param executor The database, or a transaction
 */
export async function unequipSlots(characterId: string, slots: readonly string[], executor: Executor = db): Promise<void>
{
	if (slots.length === 0)
	{
		return;
	}

	await executor
		.delete(characterEquipment)
		.where(and(
			eq(characterEquipment.characterId, characterId),
			inArray(characterEquipment.slot, [...new Set(slots)])
		));
}

/**
 * Unequips some items from every character of a universe who has them equipped, in one statement, as a
 * save changing where they equip or whether they are shields does, and taking them while disabled. The
 * IDs go in one array parameter, since a save can change thousands of items
 *
 * @param universeId The universe's ID
 * @param itemIds The items, by the IDs characters hold
 * @param executor The database, or a transaction
 * @return The characters who had one equipped
 */
export async function unequipItemsInUniverse(universeId: string, itemIds: readonly number[], executor: Executor = db): Promise<EquipmentOwner[]>
{
	if (itemIds.length === 0)
	{
		return([]);
	}

	const rows = await executor
		.delete(characterEquipment)
		.where(and(
			sql`${characterEquipment.itemId} = ANY(${sql.param([...new Set(itemIds)])}::integer[])`,
			inArray(characterEquipment.characterId, executor
				.select({
					id: characters.id
				})
				.from(characters)
				.where(eq(characters.universeId, universeId)))
		))
		.returning({
			characterId: characterEquipment.characterId
		});

	return(ownersOf(rows.map((row) => row.characterId), executor));
}

/**
 * Unequips some slots of every character of a universe of some races, in one statement, as a save turning
 * off a race's tail does to its characters' tail slot
 *
 * @param universeId The universe's ID
 * @param raceIds The races, by the IDs characters hold
 * @param slots The slots
 * @param executor The database, or a transaction
 * @return The characters who had something there
 */
export async function unequipSlotsOfRaces(universeId: string, raceIds: readonly number[], slots: readonly string[], executor: Executor = db): Promise<EquipmentOwner[]>
{
	if ((raceIds.length === 0) || (slots.length === 0))
	{
		return([]);
	}

	const rows = await executor
		.delete(characterEquipment)
		.where(and(
			inArray(characterEquipment.slot, [...new Set(slots)]),
			inArray(characterEquipment.characterId, executor
				.select({
					id: characters.id
				})
				.from(characters)
				.where(and(
					eq(characters.universeId, universeId),
					sql`${characters.raceId} = ANY(${sql.param([...new Set(raceIds)])}::integer[])`
				)))
		))
		.returning({
			characterId: characterEquipment.characterId
		});

	return(ownersOf(rows.map((row) => row.characterId), executor));
}

/**
 * The players of some characters
 *
 * @param characterIds The characters' IDs, each any number of times
 * @param executor The database, or a transaction
 * @return Each character once, with their player
 */
async function ownersOf(characterIds: readonly string[], executor: Executor): Promise<EquipmentOwner[]>
{
	if (characterIds.length === 0)
	{
		return([]);
	}

	return(executor
		.select({
			characterId: characters.id,
			playerId: characters.playerId
		})
		.from(characters)
		.where(sql`${characters.id} = ANY(${sql.param([...new Set(characterIds)])}::uuid[])`));
}
