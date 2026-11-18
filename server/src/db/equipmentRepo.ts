/**
 * Equipment: the only module that reads or writes the character_equipment table, what each character has
 * in their stats and social slots. It reads characters only to find a universe's characters and their
 * players. The rules for what equipping does are pure functions in /shared (shared/src/equipment.ts);
 * this stores their outcome
 *
 * Equipping means the stats layer: listEquipment(), equipItems() and unequipSlots() only see it. The
 * social layer's items are worn only for how they look (listSocialEquipment(), wearSocially())
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { EquipmentLayer, EquippedItem } from '@multiverse-kiln/shared';

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
 * An item in one of a character's slots, with the slot's layer
 */
export interface LayeredItem extends EquippedItem
{
	layer: EquipmentLayer;
}

/**
 * What a character has in one layer of their slots
 *
 * @param characterId The character's ID
 * @param layer The layer
 * @param executor The database, or a transaction
 * @return The items, by slot key
 */
async function listLayer(characterId: string, layer: EquipmentLayer, executor: Executor): Promise<EquippedItem[]>
{
	return(executor
		.select({
			slot: characterEquipment.slot,
			itemId: characterEquipment.itemId,
			bothHands: characterEquipment.bothHands
		})
		.from(characterEquipment)
		.where(and(
			eq(characterEquipment.characterId, characterId),
			eq(characterEquipment.layer, layer)
		))
		.orderBy(asc(characterEquipment.slot)));
}

/**
 * What a character has equipped: their stats slots
 *
 * @param characterId The character's ID
 * @param executor The database, or a transaction
 * @return The equipped items, by slot key
 */
export async function listEquipment(characterId: string, executor: Executor = db): Promise<EquippedItem[]>
{
	return(listLayer(characterId, 'stats', executor));
}

/**
 * What a character wears in their social slots
 *
 * @param characterId The character's ID
 * @param executor The database, or a transaction
 * @return The items, by slot key
 */
export async function listSocialEquipment(characterId: string, executor: Executor = db): Promise<EquippedItem[]>
{
	return(listLayer(characterId, 'social', executor));
}

/**
 * What each of some characters has in both layers of their slots, in one query
 *
 * @param characterIds The characters' IDs
 * @param executor The database, or a transaction
 * @return Each character's items, by character ID; a character with none is left out
 */
export async function listLayeredEquipmentOf(characterIds: readonly string[], executor: Executor = db): Promise<Map<string, LayeredItem[]>>
{
	if (characterIds.length === 0)
	{
		return(new Map());
	}

	const rows = await executor
		.select({
			characterId: characterEquipment.characterId,
			layer: characterEquipment.layer,
			slot: characterEquipment.slot,
			itemId: characterEquipment.itemId,
			bothHands: characterEquipment.bothHands
		})
		.from(characterEquipment)
		.where(sql`${characterEquipment.characterId} = ANY(${sql.param([...new Set(characterIds)])}::uuid[])`)
		.orderBy(asc(characterEquipment.characterId), asc(characterEquipment.layer), asc(characterEquipment.slot));
	const grouped = Map.groupBy(rows, (row) => row.characterId);

	return(new Map([...grouped].map(([characterId, items]) => [characterId, items.map(({ layer, slot, itemId, bothHands }) => ({
		layer: ((layer === 'social') ? 'social' : 'stats'),
		slot,
		itemId,
		bothHands
	}))])));
}

/**
 * What each of some characters has equipped in their stats slots, in one query
 *
 * @param characterIds The characters' IDs
 * @param executor The database, or a transaction
 * @return Each character's equipped items, by character ID; a character with none is left out
 */
export async function listEquipmentOf(characterIds: readonly string[], executor: Executor = db): Promise<Map<string, EquippedItem[]>>
{
	const layered = await listLayeredEquipmentOf(characterIds, executor);

	return(new Map([...layered]
		.map(([characterId, items]): [string, EquippedItem[]] => [characterId, items
			.filter((item) => (item.layer === 'stats'))
			.map(({ slot, itemId, bothHands }) => ({
				slot,
				itemId,
				bothHands
			}))])
		.filter(([, items]) => (items.length > 0))));
}

/**
 * Equips items in stats slots, replacing what was in them. Each item must be one the character carries
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
			layer: 'stats',
			slot,
			itemId,
			bothHands
		})))
		.onConflictDoUpdate({
			target: [characterEquipment.characterId, characterEquipment.layer, characterEquipment.slot],
			set: {
				itemId: sql`excluded.item_id`,
				bothHands: sql`excluded.both_hands`
			}
		});
}

/**
 * Unequips what is in some of a character's stats slots
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
			eq(characterEquipment.layer, 'stats'),
			inArray(characterEquipment.slot, [...new Set(slots)])
		));
}

/**
 * Wears an item in a social slot, replacing what was there, or empties the slot. The item must be one the
 * character carries
 *
 * @param characterId The character's ID
 * @param slot The social slot
 * @param itemId The item, or null to empty the slot
 * @param executor The database, or a transaction
 * @return Whether the slot changed
 */
export async function wearSocially(characterId: string, slot: string, itemId: number | null, executor: Executor = db): Promise<boolean>
{
	if (itemId === null)
	{
		const removed = await executor
			.delete(characterEquipment)
			.where(and(
				eq(characterEquipment.characterId, characterId),
				eq(characterEquipment.layer, 'social'),
				eq(characterEquipment.slot, slot)
			))
			.returning({
				slot: characterEquipment.slot
			});

		return(removed.length > 0);
	}

	const written = await executor
		.insert(characterEquipment)
		.values({
			characterId,
			layer: 'social',
			slot,
			itemId,
			bothHands: false
		})
		.onConflictDoUpdate({
			target: [characterEquipment.characterId, characterEquipment.layer, characterEquipment.slot],
			set: {
				itemId: sql`excluded.item_id`
			},
			setWhere: sql`${characterEquipment.itemId} <> excluded.item_id`
		})
		.returning({
			slot: characterEquipment.slot
		});

	return(written.length > 0);
}

/**
 * Takes some items out of both layers of every slot of every character of a universe who has them there,
 * in one statement, as a save changing where they equip, or whether they are shields or weapons, does,
 * and taking them while disabled. The IDs go in one array parameter, since a save can change thousands
 * of items
 *
 * @param universeId The universe's ID
 * @param itemIds The items, by the IDs characters hold
 * @param executor The database, or a transaction
 * @return The characters who had one in a slot
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
