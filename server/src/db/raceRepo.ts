/**
 * Races: the only module that reads or writes the races, pf1e_races, sf1e_races and race_starting_items tables
 */
import { and, asc, count, eq, isNull, or, type SQL } from 'drizzle-orm';
import { isSf1eRaceRules, type EditorRace, type ItemQuantity, type Pf1eRaceRules, type RaceRules, type RaceSettings, type Ruleset, type Sf1eRaceRules } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { fromCoinColumns, toCoinColumns } from './coinColumns.js';
import { pf1eRaces, races, raceStartingItems, sf1eRaces } from './schema.js';

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
			startingCredits: races.startingCredits,
			startingAreaId: races.startingAreaId
		})
		.from(races)
		.where(usableRaces(universeId, ruleset))
		.orderBy(asc(races.id));
	const rules = await loadRaceRules(universeId, ruleset, executor);
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
			const raceRules = rules.get(settings.id);

			if (!raceRules)
			{
				throw new Error(`Race ${settings.id} has no ${ruleset} rules`);
			}

			return({
				id: row.id,
				key: (custom ? null : row.key),
				name: (custom ? row.name : (copy?.name ?? null)),
				enabled: settings.enabled,
				startingMoney: fromCoinColumns(settings),
				startingItems: (startingItems.get(settings.id) ?? []),
				startingAreaId: settings.startingAreaId,
				rules: raceRules,
				custom,
				edited: (copy !== undefined)
			});
		}));
}

/**
 * Matches the rows of races a universe can see: its ruleset's default races, and its own races and
 * edited copies
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @return The condition
 */
function usableRaces(universeId: string, ruleset: Ruleset): SQL | undefined
{
	return(and(
		eq(races.ruleset, ruleset),
		or(
			isNull(races.universeId),
			eq(races.universeId, universeId)
		)
	));
}

/**
 * The rules of each row of races a universe can see, from its ruleset's table
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param executor The database, or a transaction
 * @return The rules, keyed by the ID of the row holding the race's settings
 */
async function loadRaceRules(universeId: string, ruleset: Ruleset, executor: Executor): Promise<Map<number, RaceRules>>
{
	switch (ruleset)
	{
		case 'pf1e':
		{
			const rows = await executor
				.select({
					raceId: pf1eRaces.raceId,
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
				.from(pf1eRaces)
				.innerJoin(races, eq(races.id, pf1eRaces.raceId))
				.where(usableRaces(universeId, ruleset));

			return(new Map(rows.map((row): [number, Pf1eRaceRules] => [row.raceId, {
				abilityModifiers: {
					strength: row.strength,
					dexterity: row.dexterity,
					constitution: row.constitution,
					intelligence: row.intelligence,
					wisdom: row.wisdom,
					charisma: row.charisma
				},
				floatingBonus: row.floatingBonus,
				darkvision: row.darkvision,
				size: row.size
			}])));
		}

		case 'sf1e':
		{
			const rows = await executor
				.select({
					raceId: sf1eRaces.raceId,
					strength: sf1eRaces.strengthModifier,
					dexterity: sf1eRaces.dexterityModifier,
					constitution: sf1eRaces.constitutionModifier,
					intelligence: sf1eRaces.intelligenceModifier,
					wisdom: sf1eRaces.wisdomModifier,
					charisma: sf1eRaces.charismaModifier,
					floatingBonus: sf1eRaces.floatingBonus,
					darkvision: sf1eRaces.darkvision,
					size: sf1eRaces.size,
					hitPoints: sf1eRaces.hitPoints
				})
				.from(sf1eRaces)
				.innerJoin(races, eq(races.id, sf1eRaces.raceId))
				.where(usableRaces(universeId, ruleset));

			return(new Map(rows.map((row): [number, Sf1eRaceRules] => [row.raceId, {
				abilityModifiers: {
					strength: row.strength,
					dexterity: row.dexterity,
					constitution: row.constitution,
					intelligence: row.intelligence,
					wisdom: row.wisdom,
					charisma: row.charisma
				},
				floatingBonus: row.floatingBonus,
				darkvision: row.darkvision,
				size: row.size,
				hitPoints: row.hitPoints
			}])));
		}
	}
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

	await saveRaceDetails(created.id, ruleset, settings, executor);

	return(created.id);
}

/**
 * Changes one of a universe's own races. Call it inside a transaction
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param raceId The race's ID, from findRaceKind() as custom
 * @param settings The race's new settings
 * @param executor A transaction
 */
export async function updateCustomRace(universeId: string, ruleset: Ruleset, raceId: number, settings: CustomRaceSettings, executor: Executor): Promise<void>
{
	await executor
		.update(races)
		.set(raceColumns(settings))
		.where(and(
			eq(races.id, raceId),
			eq(races.universeId, universeId)
		));
	await saveRaceDetails(raceId, ruleset, settings, executor);
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

	await saveRaceDetails(copy.id, ruleset, settings, executor);
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
function raceColumns(settings: RaceSettings): Pick<typeof races.$inferInsert, 'name' | 'enabled' | 'startingPlatinum' | 'startingGold' | 'startingSilver' | 'startingCopper' | 'startingCredits' | 'startingAreaId'>
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
 * @param ruleset The universe's ruleset, which the rules must be for
 * @param settings The settings
 * @param executor A transaction
 */
async function saveRaceDetails(raceId: number, ruleset: Ruleset, settings: RaceSettings, executor: Executor): Promise<void>
{
	const { rules } = settings;

	if ((ruleset === 'sf1e') && isSf1eRaceRules(rules))
	{
		const columns = sf1eRaceColumns(rules);

		await executor
			.insert(sf1eRaces)
			.values({
				raceId,
				...columns
			})
			.onConflictDoUpdate({
				target: sf1eRaces.raceId,
				set: columns
			});
	}
	else if ((ruleset === 'pf1e') && !isSf1eRaceRules(rules))
	{
		const columns = pf1eRaceColumns(rules);

		await executor
			.insert(pf1eRaces)
			.values({
				raceId,
				...columns
			})
			.onConflictDoUpdate({
				target: pf1eRaces.raceId,
				set: columns
			});
	}
	else
	{
		throw new Error(`Race ${raceId}'s rules aren't ${ruleset} rules`);
	}

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

/**
 * The sf1e_races table's columns for a race's rules
 *
 * @param rules The rules
 * @return The columns' values
 */
function sf1eRaceColumns(rules: Sf1eRaceRules): Omit<typeof sf1eRaces.$inferInsert, 'raceId'>
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
		size: rules.size,
		hitPoints: rules.hitPoints
	});
}
