/**
 * Classes: the only module that reads or writes the classes, pf1e_classes, class_starting_items and
 * class_race_zones tables
 */
import { and, asc, count, eq, isNull, or } from 'drizzle-orm';
import type { ClassRaceZone, ClassSettings, EditorClass, ItemQuantity, Ruleset } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { fromCoinColumns, toCoinColumns } from './coinColumns.js';
import { classes, classRaceZones, classStartingItems, pf1eClasses } from './schema.js';

/**
 * The settings of a class a universe added, which always has a name of its own
 */
export type CustomClassSettings = ClassSettings & { name: string };

/**
 * Whether a class ID names one of a ruleset's default classes or one a universe added
 */
export type ClassKind = 'default' | 'custom';

/**
 * The IDs of a ruleset's default classes
 *
 * @param ruleset The ruleset
 * @param executor The database, or a transaction
 * @return Each default class's ID, by its key (e.g. wizard)
 */
export async function findDefaultClassIds(ruleset: Ruleset, executor: Executor = db): Promise<Map<string, number>>
{
	const rows = await executor
		.select({
			id: classes.id,
			key: classes.key
		})
		.from(classes)
		.where(and(
			eq(classes.ruleset, ruleset),
			isNull(classes.universeId)
		))
		.orderBy(asc(classes.id));

	return(new Map(rows
		.filter((row) => (row.key !== null))
		.map((row) => [row.key as string, row.id])));
}

/**
 * Every class a universe can use, as the editor lists them: with whether each class is custom or
 * edited, and a default class's key in place of a name it kept
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param executor The database, or a transaction
 * @return The classes, by ID
 */
export async function loadEditorClasses(universeId: string, ruleset: Ruleset, executor: Executor = db): Promise<EditorClass[]>
{
	const rows = await executor
		.select({
			id: classes.id,
			universeId: classes.universeId,
			overridesClassId: classes.overridesClassId,
			key: classes.key,
			name: classes.name,
			enabled: classes.enabled,
			startingPlatinum: classes.startingPlatinum,
			startingGold: classes.startingGold,
			startingSilver: classes.startingSilver,
			startingCopper: classes.startingCopper,
			startingZoneId: classes.startingZoneId,
			primaryAbility: pf1eClasses.primaryAbility,
			tradition: pf1eClasses.tradition,
			castingStyle: pf1eClasses.castingStyle
		})
		.from(classes)
		.innerJoin(pf1eClasses, eq(pf1eClasses.classId, classes.id))
		.where(and(
			eq(classes.ruleset, ruleset),
			or(
				isNull(classes.universeId),
				eq(classes.universeId, universeId)
			)
		))
		.orderBy(asc(classes.id));
	const startingItems = await loadClassStartingItems(universeId, executor);
	const raceZones = await loadClassRaceZones(universeId, executor);
	const copies = new Map(rows
		.filter((row) => (row.overridesClassId !== null))
		.map((row) => [row.overridesClassId, row]));

	return(rows
		.filter((row) => (row.overridesClassId === null))
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
				startingZoneId: settings.startingZoneId,
				raceZones: (raceZones.get(settings.id) ?? []),
				rules: {
					primaryAbility: settings.primaryAbility,
					tradition: settings.tradition,
					castingStyle: settings.castingStyle
				},
				custom,
				edited: (copy !== undefined)
			});
		}));
}

/**
 * The extra starting equipment of each of a universe's rows of class settings
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The items and how many of each, by item ID, keyed by the ID of the row holding the class's settings
 */
async function loadClassStartingItems(universeId: string, executor: Executor): Promise<Map<number, ItemQuantity[]>>
{
	const rows = await executor
		.select({
			classId: classStartingItems.classId,
			itemId: classStartingItems.itemId,
			quantity: classStartingItems.quantity
		})
		.from(classStartingItems)
		.innerJoin(classes, eq(classes.id, classStartingItems.classId))
		.where(eq(classes.universeId, universeId))
		.orderBy(asc(classStartingItems.itemId));
	const byClass = new Map<number, ItemQuantity[]>();

	for (const { classId, itemId, quantity } of rows)
	{
		byClass.set(classId, [...(byClass.get(classId) ?? []), { itemId, quantity }]);
	}

	return(byClass);
}

/**
 * Where each of a universe's rows of class settings starts its characters of each race
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The zones, by race ID, keyed by the ID of the row holding the class's settings
 */
async function loadClassRaceZones(universeId: string, executor: Executor): Promise<Map<number, ClassRaceZone[]>>
{
	const rows = await executor
		.select({
			classId: classRaceZones.classId,
			raceId: classRaceZones.raceId,
			zoneId: classRaceZones.zoneId
		})
		.from(classRaceZones)
		.innerJoin(classes, eq(classes.id, classRaceZones.classId))
		.where(eq(classes.universeId, universeId))
		.orderBy(asc(classRaceZones.raceId));
	const byClass = new Map<number, ClassRaceZone[]>();

	for (const { classId, raceId, zoneId } of rows)
	{
		byClass.set(classId, [...(byClass.get(classId) ?? []), { raceId, zoneId }]);
	}

	return(byClass);
}

/**
 * Whether a class ID is one of a ruleset's default classes or one of a universe's own classes
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param classId The class's ID
 * @param executor The database, or a transaction
 * @return The kind of class, or undefined when the universe can't use a class with that ID (an edited
 * copy's own ID included)
 */
export async function findClassKind(universeId: string, ruleset: Ruleset, classId: number, executor: Executor = db): Promise<ClassKind | undefined>
{
	const [row] = await executor
		.select({ universeId: classes.universeId })
		.from(classes)
		.where(and(
			eq(classes.id, classId),
			eq(classes.ruleset, ruleset),
			isNull(classes.overridesClassId),
			or(
				isNull(classes.universeId),
				eq(classes.universeId, universeId)
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
 * How many classes a universe has added, not counting its edited copies of default classes
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The number of classes
 */
export async function countCustomClasses(universeId: string, executor: Executor = db): Promise<number>
{
	const [row] = await executor
		.select({ total: count() })
		.from(classes)
		.where(and(
			eq(classes.universeId, universeId),
			isNull(classes.overridesClassId)
		));

	return(row.total);
}

/**
 * Adds a class to a universe. Call it inside a transaction, so the class is never left without its rules
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param settings The class's settings
 * @param executor A transaction
 * @return The new class's ID
 */
export async function createCustomClass(universeId: string, ruleset: Ruleset, settings: CustomClassSettings, executor: Executor): Promise<number>
{
	const [created] = await executor
		.insert(classes)
		.values({
			ruleset,
			universeId,
			...classColumns(settings)
		})
		.returning({ id: classes.id });

	await saveClassDetails(created.id, settings, executor);

	return(created.id);
}

/**
 * Changes one of a universe's own classes. Call it inside a transaction
 *
 * @param universeId The universe's ID
 * @param classId The class's ID, from findClassKind() as custom
 * @param settings The class's new settings
 * @param executor A transaction
 */
export async function updateCustomClass(universeId: string, classId: number, settings: CustomClassSettings, executor: Executor): Promise<void>
{
	await executor
		.update(classes)
		.set(classColumns(settings))
		.where(and(
			eq(classes.id, classId),
			eq(classes.universeId, universeId)
		));
	await saveClassDetails(classId, settings, executor);
}

/**
 * Stores a universe's edited copy of a default class, replacing any copy it had. Call it inside a transaction
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param defaultClassId The default class's ID, from findClassKind() as default
 * @param settings The copy's settings; a null name keeps the default class's
 * @param executor A transaction
 */
export async function saveEditedDefaultClass(universeId: string, ruleset: Ruleset, defaultClassId: number, settings: ClassSettings, executor: Executor): Promise<void>
{
	const columns = classColumns(settings);
	const [copy] = await executor
		.insert(classes)
		.values({
			ruleset,
			universeId,
			overridesClassId: defaultClassId,
			...columns
		})
		.onConflictDoUpdate({
			target: [classes.universeId, classes.overridesClassId],
			set: columns
		})
		.returning({ id: classes.id });

	await saveClassDetails(copy.id, settings, executor);
}

/**
 * Discards a universe's edited copy of a default class, so the universe sees the default again
 *
 * @param universeId The universe's ID
 * @param defaultClassId The default class's ID
 * @param executor The database, or a transaction
 */
export async function restoreDefaultClass(universeId: string, defaultClassId: number, executor: Executor = db): Promise<void>
{
	await executor
		.delete(classes)
		.where(and(
			eq(classes.universeId, universeId),
			eq(classes.overridesClassId, defaultClassId)
		));
}

/**
 * Deletes one of a universe's own classes
 *
 * @param universeId The universe's ID
 * @param classId The class's ID, from findClassKind() as custom
 * @param executor The database, or a transaction
 */
export async function deleteCustomClass(universeId: string, classId: number, executor: Executor = db): Promise<void>
{
	await executor
		.delete(classes)
		.where(and(
			eq(classes.id, classId),
			eq(classes.universeId, universeId)
		));
}

/**
 * Whether the extra starting equipment of any of a universe's classes holds an item
 *
 * @param universeId The universe's ID
 * @param itemId The item's ID
 * @param executor The database, or a transaction
 * @return True when it does
 */
export async function isClassStartingItem(universeId: string, itemId: number, executor: Executor = db): Promise<boolean>
{
	const rows = await executor
		.select({ classId: classStartingItems.classId })
		.from(classStartingItems)
		.innerJoin(classes, eq(classes.id, classStartingItems.classId))
		.where(and(
			eq(classes.universeId, universeId),
			eq(classStartingItems.itemId, itemId)
		))
		.limit(1);

	return(rows.length > 0);
}

/**
 * The classes table's columns for a class's settings
 *
 * @param settings The settings
 * @return The columns' values
 */
function classColumns(settings: ClassSettings): Pick<typeof classes.$inferInsert, 'name' | 'enabled' | 'startingPlatinum' | 'startingGold' | 'startingSilver' | 'startingCopper' | 'startingZoneId'>
{
	return({
		name: settings.name,
		enabled: settings.enabled,
		...toCoinColumns(settings.startingMoney),
		startingZoneId: settings.startingZoneId
	});
}

/**
 * Stores the rules, extra starting equipment and per-race zones of a row of class settings, replacing
 * what it had
 *
 * @param classId The ID of the row holding the class's settings
 * @param settings The settings
 * @param executor A transaction
 */
async function saveClassDetails(classId: number, settings: ClassSettings, executor: Executor): Promise<void>
{
	await executor
		.insert(pf1eClasses)
		.values({
			classId,
			...settings.rules
		})
		.onConflictDoUpdate({
			target: pf1eClasses.classId,
			set: settings.rules
		});
	await executor
		.delete(classStartingItems)
		.where(eq(classStartingItems.classId, classId));
	await executor
		.delete(classRaceZones)
		.where(eq(classRaceZones.classId, classId));

	if (settings.startingItems.length > 0)
	{
		await executor
			.insert(classStartingItems)
			.values(settings.startingItems.map(({ itemId, quantity }) => ({
				classId,
				itemId,
				quantity
			})));
	}

	if (settings.raceZones.length > 0)
	{
		await executor
			.insert(classRaceZones)
			.values(settings.raceZones.map(({ raceId, zoneId }) => ({
				classId,
				raceId,
				zoneId
			})));
	}
}
