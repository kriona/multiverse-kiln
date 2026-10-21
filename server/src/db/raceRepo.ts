/**
 * Races: the only module that reads or writes the races, pf1e_races and race_starting_items tables
 */
import { and, asc, count, eq, isNull, or } from 'drizzle-orm';
import type { EditorRace, ItemQuantity, Pf1eRaceRules, RaceSettings, Ruleset } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { fromCoinColumns, toCoinColumns } from './coinColumns.js';
import { pf1eRaces, races, raceStartingItems } from './schema.js';

/**
 * The settings of a race a universe added, which always has a name of its own
 */
export type CustomRaceSettings = RaceSettings & { name: string };

/**
 * Whether a race ID names one of a ruleset's default races or one a universe added
 */
export type RaceKind = 'default' | 'custom';

/**
 * The IDs of a ruleset's default races
 *
 * @param ruleset The ruleset
 * @param executor The database, or a transaction
 * @return Each default race's ID, by its key (e.g. dwarf)
 */
export async function findDefaultRaceIds(ruleset: Ruleset, executor: Executor = db): Promise<Map<string, number>>
{
	const rows = await executor
		.select({
			id: races.id,
			key: races.key
		})
		.from(races)
		.where(and(
			eq(races.ruleset, ruleset),
			isNull(races.universeId)
		))
		.orderBy(asc(races.id));

	return(new Map(rows
		.filter((row) => (row.key !== null))
		.map((row) => [row.key as string, row.id])));
}

/**
 * Every race a universe can use, as the editor lists them: with whether each race is custom or edited,
 * and a default race's key in place of a name it kept
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param executor The database, or a transaction
 * @return The races, by ID
 */
export async function loadEditorRaces(universeId: string, ruleset: Ruleset, executor: Executor = db): Promise<EditorRace[]>
{
	const rows = await executor
		.select({
			id: races.id,
			universeId: races.universeId,
			overridesRaceId: races.overridesRaceId,
			key: races.key,
			name: races.name,
			enabled: races.enabled,
			startingPlatinum: races.startingPlatinum,
			startingGold: races.startingGold,
			startingSilver: races.startingSilver,
			startingCopper: races.startingCopper,
			startingAreaId: races.startingAreaId,
			strength: pf1eRaces.strengthModifier,
			dexterity: pf1eRaces.dexterityModifier,
			constitution: pf1eRaces.constitutionModifier,
			intelligence: pf1eRaces.intelligenceModifier,
			wisdom: pf1eRaces.wisdomModifier,
			charisma: pf1eRaces.charismaModifier,
			floatingBonus: pf1eRaces.floatingBonus,
			darkvision: pf1eRaces.darkvision,
			size: pf1eRaces.size
		})
		.from(races)
		.innerJoin(pf1eRaces, eq(pf1eRaces.raceId, races.id))
		.where(and(
			eq(races.ruleset, ruleset),
			or(
				isNull(races.universeId),
				eq(races.universeId, universeId)
			)
		))
		.orderBy(asc(races.id));
	const startingItems = await loadRaceStartingItems(universeId, executor);
	const copies = new Map(rows
		.filter((row) => (row.overridesRaceId !== null))
		.map((row) => [row.overridesRaceId, row]));

	return(rows
		.filter((row) => (row.overridesRaceId === null))
		.map((row) =>
		{
			const copy = ((row.universeId === null) ? copies.get(row.id) : undefined);
			const settings = (copy ?? row);
			const custom = (row.universeId !== null);

			return({
				id: row.id,
				key: (custom ? null : row.key),
				name: (custom ? row.name : (copy?.name ?? null)),
				enabled: settings.enabled,
				startingMoney: fromCoinColumns(settings),
				startingItems: (startingItems.get(settings.id) ?? []),
				startingAreaId: settings.startingAreaId,
				rules: {
					abilityModifiers: {
						strength: settings.strength,
						dexterity: settings.dexterity,
						constitution: settings.constitution,
						intelligence: settings.intelligence,
						wisdom: settings.wisdom,
						charisma: settings.charisma
					},
					floatingBonus: settings.floatingBonus,
					darkvision: settings.darkvision,
					size: settings.size
				},
				custom,
				edited: (copy !== undefined)
			});
		}));
}

/**
 * The extra starting equipment of each of a universe's rows of race settings
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The items and how many of each, by item ID, keyed by the ID of the row holding the race's settings
 */
async function loadRaceStartingItems(universeId: string, executor: Executor): Promise<Map<number, ItemQuantity[]>>
{
	const rows = await executor
		.select({
			raceId: raceStartingItems.raceId,
			itemId: raceStartingItems.itemId,
			quantity: raceStartingItems.quantity
		})
		.from(raceStartingItems)
		.innerJoin(races, eq(races.id, raceStartingItems.raceId))
		.where(eq(races.universeId, universeId))
		.orderBy(asc(raceStartingItems.itemId));
	const byRace = new Map<number, ItemQuantity[]>();

	for (const { raceId, itemId, quantity } of rows)
	{
		byRace.set(raceId, [...(byRace.get(raceId) ?? []), { itemId, quantity }]);
	}

	return(byRace);
}

/**
 * Whether a race ID is one of a ruleset's default races or one of a universe's own races
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param raceId The race's ID
 * @param executor The database, or a transaction
 * @return The kind of race, or undefined when the universe can't use a race with that ID (an edited
 * copy's own ID included)
 */
export async function findRaceKind(universeId: string, ruleset: Ruleset, raceId: number, executor: Executor = db): Promise<RaceKind | undefined>
{
	const [row] = await executor
		.select({
			universeId: races.universeId
		})
		.from(races)
		.where(and(
			eq(races.id, raceId),
			eq(races.ruleset, ruleset),
			isNull(races.overridesRaceId),
			or(
				isNull(races.universeId),
				eq(races.universeId, universeId)
			)
		))
		.limit(1);

	if (!row)
	{
		return(undefined);
	}

	return(((row.universeId === null) ? 'default' : 'custom'));
}

/**
 * How many races a universe has added, not counting its edited copies of default races
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The number of races
 */
export async function countCustomRaces(universeId: string, executor: Executor = db): Promise<number>
{
	const [row] = await executor
		.select({
			total: count()
		})
		.from(races)
		.where(and(
			eq(races.universeId, universeId),
			isNull(races.overridesRaceId)
		));

	return(row.total);
}

/**
 * Adds a race to a universe. Call it inside a transaction, so the race is never left without its rules
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param settings The race's settings
 * @param executor A transaction
 * @return The new race's ID
 */
export async function createCustomRace(universeId: string, ruleset: Ruleset, settings: CustomRaceSettings, executor: Executor): Promise<number>
{
	const [created] = await executor
		.insert(races)
		.values({
			ruleset,
			universeId,
			...raceColumns(settings)
		})
		.returning({ id: races.id });

	await saveRaceDetails(created.id, settings, executor);

	return(created.id);
}

/**
 * Changes one of a universe's own races. Call it inside a transaction
 *
 * @param universeId The universe's ID
 * @param raceId The race's ID, from findRaceKind() as custom
 * @param settings The race's new settings
 * @param executor A transaction
 */
export async function updateCustomRace(universeId: string, raceId: number, settings: CustomRaceSettings, executor: Executor): Promise<void>
{
	await executor
		.update(races)
		.set(raceColumns(settings))
		.where(and(
			eq(races.id, raceId),
			eq(races.universeId, universeId)
		));
	await saveRaceDetails(raceId, settings, executor);
}

/**
 * Stores a universe's edited copy of a default race, replacing any copy it had. Call it inside a transaction
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param defaultRaceId The default race's ID, from findRaceKind() as default
 * @param settings The copy's settings; a null name keeps the default race's
 * @param executor A transaction
 */
export async function saveEditedDefaultRace(universeId: string, ruleset: Ruleset, defaultRaceId: number, settings: RaceSettings, executor: Executor): Promise<void>
{
	const columns = raceColumns(settings);
	const [copy] = await executor
		.insert(races)
		.values({
			ruleset,
			universeId,
			overridesRaceId: defaultRaceId,
			...columns
		})
		.onConflictDoUpdate({
			target: [races.universeId, races.overridesRaceId],
			set: columns
		})
		.returning({ id: races.id });

	await saveRaceDetails(copy.id, settings, executor);
}

/**
 * Discards a universe's edited copy of a default race, so the universe sees the default again
 *
 * @param universeId The universe's ID
 * @param defaultRaceId The default race's ID
 * @param executor The database, or a transaction
 */
export async function restoreDefaultRace(universeId: string, defaultRaceId: number, executor: Executor = db): Promise<void>
{
	await executor
		.delete(races)
		.where(and(
			eq(races.universeId, universeId),
			eq(races.overridesRaceId, defaultRaceId)
		));
}

/**
 * Deletes one of a universe's own races
 *
 * @param universeId The universe's ID
 * @param raceId The race's ID, from findRaceKind() as custom
 * @param executor The database, or a transaction
 */
export async function deleteCustomRace(universeId: string, raceId: number, executor: Executor = db): Promise<void>
{
	await executor
		.delete(races)
		.where(and(
			eq(races.id, raceId),
			eq(races.universeId, universeId)
		));
}

/**
 * Whether the extra starting equipment of any of a universe's races holds an item
 *
 * @param universeId The universe's ID
 * @param itemId The item's ID
 * @param executor The database, or a transaction
 * @return True when it does
 */
export async function isRaceStartingItem(universeId: string, itemId: number, executor: Executor = db): Promise<boolean>
{
	const rows = await executor
		.select({
			raceId: raceStartingItems.raceId
		})
		.from(raceStartingItems)
		.innerJoin(races, eq(races.id, raceStartingItems.raceId))
		.where(and(
			eq(races.universeId, universeId),
			eq(raceStartingItems.itemId, itemId)
		))
		.limit(1);

	return(rows.length > 0);
}

/**
 * The races table's columns for a race's settings
 *
 * @param settings The settings
 * @return The columns' values
 */
function raceColumns(settings: RaceSettings): Pick<typeof races.$inferInsert, 'name' | 'enabled' | 'startingPlatinum' | 'startingGold' | 'startingSilver' | 'startingCopper' | 'startingAreaId'>
{
	return({
		name: settings.name,
		enabled: settings.enabled,
		...toCoinColumns(settings.startingMoney),
		startingAreaId: settings.startingAreaId
	});
}

/**
 * Stores the rules and extra starting equipment of a row of race settings, replacing what it had
 *
 * @param raceId The ID of the row holding the race's settings
 * @param settings The settings
 * @param executor A transaction
 */
async function saveRaceDetails(raceId: number, settings: RaceSettings, executor: Executor): Promise<void>
{
	const rules = pf1eRaceColumns(settings.rules);

	await executor
		.insert(pf1eRaces)
		.values({
			raceId,
			...rules
		})
		.onConflictDoUpdate({
			target: pf1eRaces.raceId,
			set: rules
		});
	await executor
		.delete(raceStartingItems)
		.where(eq(raceStartingItems.raceId, raceId));

	if (settings.startingItems.length > 0)
	{
		await executor
			.insert(raceStartingItems)
			.values(settings.startingItems.map(({ itemId, quantity }) => ({
				raceId,
				itemId,
				quantity
			})));
	}
}

/**
 * The pf1e_races table's columns for a race's rules
 *
 * @param rules The rules
 * @return The columns' values
 */
function pf1eRaceColumns(rules: Pf1eRaceRules): Omit<typeof pf1eRaces.$inferInsert, 'raceId'>
{
	const { abilityModifiers } = rules;

	return({
		strengthModifier: abilityModifiers.strength,
		dexterityModifier: abilityModifiers.dexterity,
		constitutionModifier: abilityModifiers.constitution,
		intelligenceModifier: abilityModifiers.intelligence,
		wisdomModifier: abilityModifiers.wisdom,
		charismaModifier: abilityModifiers.charisma,
		floatingBonus: rules.floatingBonus,
		darkvision: rules.darkvision,
		size: rules.size
	});
}
