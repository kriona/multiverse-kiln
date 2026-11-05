/**
 * A universe's draft (see Universe versions in STRUCTURE-OVERVIEW.md): starting it as a copy of the live
 * version, applying it back into the live version, and discarding it
 *
 * The draft's rows sit in the content tables beside the live version's, marked draft, each remembering
 * the live row it was copied from in origin_id. Copying and applying go through every content table at
 * once, so this module writes each of them; the other repositories read and write one version's rows.
 * The SQL names each table's columns from the Drizzle schema, so a column added to a table is copied with
 * the rest
 *
 * The ruleset's default rows (those with no universe) are never copied: the IDs everything else uses for
 * them are the same in the live version and the draft. A universe's own rows have IDs of their own in the
 * draft, and applying maps them back to the live IDs, so characters, their items and groups keep pointing
 * at the same rows
 */
import { and, eq, getTableColumns, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { UniverseTextKind } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { areaLinks, areas, classes, classRaceAreas, classStartingItems, difficultyLevels, items, mapChunks, pf1eClasses, pf1eRaces, pf1eSettings, races, raceStartingItems, sf1eClasses, sf1eRaces, sf1eSettings, sf1eThemes, themes, tileGraphics, tiles, universeDrafts, universes, universeStartingItems, universeTranslations, universeTranslatorNotes } from './schema.js';
import { findUnusedStorageKeys } from './tileGraphicRepo.js';

/**
 * The content tables whose rows have IDs of their own in the draft, in the order they are copied: each
 * after the tables its rows refer to
 */
const COPIED_TABLES = [tileGraphics, tiles, areas, items, races, classes, themes, difficultyLevels] as const;

/**
 * A content table whose rows have IDs of their own in the draft
 */
type CopiedTable = typeof COPIED_TABLES[number];

/**
 * The tables holding each kind of universe text, for the thing_id of its translations and notes
 */
const TEXT_TABLES: Partial<Record<UniverseTextKind, CopiedTable>> = {
	area: areas,
	tile: tiles,
	item: items,
	race: races,
	class: classes,
	theme: themes,
	difficultyLevel: difficultyLevels
};

/**
 * The tables whose rows belong to one row of a copied table, by the column naming it, copied and applied
 * with it
 */
const CHILD_TABLES: readonly { child: PgTable; column: string; parent: CopiedTable }[] = [
	{ child: pf1eRaces, column: 'race_id', parent: races },
	{ child: sf1eRaces, column: 'race_id', parent: races },
	{ child: raceStartingItems, column: 'race_id', parent: races },
	{ child: pf1eClasses, column: 'class_id', parent: classes },
	{ child: sf1eClasses, column: 'class_id', parent: classes },
	{ child: classStartingItems, column: 'class_id', parent: classes },
	{ child: classRaceAreas, column: 'class_id', parent: classes },
	{ child: sf1eThemes, column: 'theme_id', parent: themes },
	{ child: mapChunks, column: 'area_id', parent: areas },
	{ child: areaLinks, column: 'area_id', parent: areas }
];

/**
 * The columns that name a row of a copied table, other than a child table's own parent: each points at
 * the draft's copy in the draft, and at the live row in the live version
 */
const REFERENCES: readonly { table: PgTable; column: string; target: CopiedTable }[] = [
	{ table: tiles, column: 'uploaded_graphic_id', target: tileGraphics },
	{ table: areas, column: 'default_tile_id', target: tiles },
	{ table: areas, column: 'parent_area_id', target: areas },
	{ table: races, column: 'starting_area_id', target: areas },
	{ table: classes, column: 'starting_area_id', target: areas },
	{ table: raceStartingItems, column: 'item_id', target: items },
	{ table: classStartingItems, column: 'item_id', target: items },
	{ table: classRaceAreas, column: 'race_id', target: races },
	{ table: classRaceAreas, column: 'area_id', target: areas },
	{ table: areaLinks, column: 'target_area_id', target: areas },
	{ table: universeStartingItems, column: 'item_id', target: items }
];

/**
 * The tables of a version's own lists, one set of rows per version without IDs of their own
 */
const VERSION_TABLES = [universeStartingItems, pf1eSettings, sf1eSettings, universeTranslations, universeTranslatorNotes] as const;

/**
 * The columns a draft row never takes from its live row, or a live row from its draft row
 */
const OWN_COLUMNS = ['id', 'universe_id', 'draft', 'origin_id', 'created_at'];

/**
 * The live rows a draft doesn't have, which applying it removes from the live version: deleted, or kept
 * disabled while characters use them
 */
export interface RemovedRows
{
	tileGraphicIds: string[];
	tileIds: number[];
	areaIds: string[];
	itemIds: number[];
	raceIds: number[];
	classIds: number[];
	themeIds: number[];
	difficultyLevelIds: number[];
}

/**
 * A column of the row being copied or changed
 *
 * @param alias The row's alias in the query
 * @param column The column's name
 * @return The column
 */
function columnOf(alias: string, column: string): SQL
{
	return(sql`${sql.raw(alias)}.${sql.identifier(column)}`);
}

/**
 * The names of a table's columns
 *
 * @param table The table
 * @param leaveOut Columns to leave out
 * @return The names, in the schema's order
 */
function columnNames(table: PgTable, leaveOut: readonly string[] = []): string[]
{
	return(Object.values(getTableColumns(table))
		.map((column) => column.name)
		.filter((name) => !leaveOut.includes(name)));
}

/**
 * Copies rows into a table, each column taken from the source row unless values gives it another value
 *
 * @param executor A transaction
 * @param table The table
 * @param from Where the rows come from, the source row aliased src
 * @param values The value of each column not taken from the source row, by name
 * @param leaveOut Columns left to their defaults, such as a new ID
 */
async function copyRows(executor: Executor, table: PgTable, from: SQL, values: Record<string, SQL>, leaveOut: readonly string[] = []): Promise<void>
{
	const names = columnNames(table, leaveOut);

	await executor.execute(sql`INSERT INTO ${table} (${sql.join(names.map((name) => sql.identifier(name)), sql`, `)}) SELECT ${sql.join(names.map((name) => (values[name] ?? columnOf('src', name))), sql`, `)} FROM ${from}`);
}

/**
 * The draft's copy of a live row, or the value itself when it names no row the draft has a copy of (one
 * of the ruleset's defaults)
 *
 * @param target The table the value names a row of
 * @param universeId The universe's ID
 * @param value The live row's ID
 * @return The draft row's ID
 */
function draftIdOf(target: CopiedTable, universeId: string, value: SQL): SQL
{
	return(sql`coalesce((SELECT m.id FROM ${target} AS m WHERE m.draft AND m.universe_id = ${universeId} AND m.origin_id = ${value}), ${value})`);
}

/**
 * A map chunk's cells with each tile the draft has a copy of replaced by its copy, or by its live row
 *
 * @param universeId The universe's ID
 * @param cells The cells
 * @param toDraft Whether to replace live tiles with their copies; otherwise draft tiles with their live rows
 * @return The new cells
 */
function remappedCells(universeId: string, cells: SQL, toDraft: boolean): SQL
{
	const join = (toDraft
		? sql`m.draft AND m.universe_id = ${universeId} AND m.origin_id = c.cell`
		: sql`m.draft AND m.universe_id = ${universeId} AND m.id = c.cell AND m.origin_id IS NOT NULL`);
	const replacement = (toDraft ? sql`m.id` : sql`m.origin_id`);

	return(sql`ARRAY(SELECT coalesce(${replacement}, c.cell) FROM unnest(${cells}) WITH ORDINALITY AS c(cell, n) LEFT JOIN ${tiles} AS m ON ${join} ORDER BY c.n)`);
}

/**
 * A translation's or note's thing_id with the thing the draft has a copy of replaced by its copy, or by
 * its live row
 *
 * @param universeId The universe's ID
 * @param alias The translation's or note's alias
 * @param toDraft Whether to replace live things with their copies; otherwise draft things with their live rows
 * @return The new thing_id
 */
function remappedThingId(universeId: string, alias: string, toDraft: boolean): SQL
{
	const thingId = columnOf(alias, 'thing_id');
	const cases = Object.entries(TEXT_TABLES).map(([kind, target]) => (toDraft
		? sql`WHEN ${kind} THEN coalesce((SELECT m.id::text FROM ${target} AS m WHERE m.draft AND m.universe_id = ${universeId} AND m.origin_id::text = ${thingId}), ${thingId})`
		: sql`WHEN ${kind} THEN coalesce((SELECT m.origin_id::text FROM ${target} AS m WHERE m.draft AND m.universe_id = ${universeId} AND m.origin_id IS NOT NULL AND m.id::text = ${thingId}), ${thingId})`));

	return(sql`CASE ${columnOf(alias, 'kind')}::text ${sql.join(cases, sql` `)} ELSE ${thingId} END`);
}

/**
 * Starts a universe's draft as a copy of its live version: its own settings, and every content row with
 * the references between them pointing at the copies. Call it inside a transaction holding the
 * universe's lock, on a universe without a draft
 *
 * @param universeId The universe's ID
 * @param executor A transaction
 */
export async function startDraft(universeId: string, executor: Executor): Promise<void>
{
	const live = sql`src.universe_id = ${universeId} AND NOT src.draft`;

	await copyRows(executor, universeDrafts, sql`${universes} AS src WHERE src.id = ${universeId}`, {
		universe_id: sql`src.id`,
		lobby_area_id: sql`NULL`,
		starting_area_id: sql`NULL`
	}, ['created_at']);

	for (const table of COPIED_TABLES)
	{
		const values: Record<string, SQL> = {
			draft: sql`true`,
			origin_id: sql`src.id`
		};

		// A copied row's references to rows copied before it point at their copies; areas, copied all at
		// once, are pointed at each other's copies after
		for (const reference of REFERENCES.filter((each) => ((each.table === table) && (each.target !== table))))
		{
			values[reference.column] = draftIdOf(reference.target, universeId, columnOf('src', reference.column));
		}

		await copyRows(executor, table, sql`${table} AS src WHERE ${live}`, values, ['id']);
	}

	await executor.execute(sql`UPDATE ${areas} AS a SET parent_area_id = ${draftIdOf(areas, universeId, sql`a.parent_area_id`)} WHERE a.universe_id = ${universeId} AND a.draft AND a.parent_area_id IS NOT NULL`);

	for (const { child, column, parent } of CHILD_TABLES)
	{
		const values: Record<string, SQL> = {
			[column]: sql`p.id`
		};

		for (const reference of REFERENCES.filter((each) => (each.table === child)))
		{
			values[reference.column] = draftIdOf(reference.target, universeId, columnOf('src', reference.column));
		}

		if (child === mapChunks)
		{
			values.cells = remappedCells(universeId, sql`src.cells`, true);
		}

		await copyRows(executor, child, sql`${child} AS src JOIN ${parent} AS p ON p.origin_id = ${columnOf('src', column)} AND p.draft AND p.universe_id = ${universeId}`, values, ((child === areaLinks) ? ['id'] : []));
	}

	for (const table of VERSION_TABLES)
	{
		const values: Record<string, SQL> = {
			draft: sql`true`
		};

		if (table === universeStartingItems)
		{
			values.item_id = draftIdOf(items, universeId, sql`src.item_id`);
		}
		else if ((table === universeTranslations) || (table === universeTranslatorNotes))
		{
			values.thing_id = remappedThingId(universeId, 'src', true);
		}

		await copyRows(executor, table, sql`${table} AS src WHERE ${live}`, values);
	}

	await executor.execute(sql`UPDATE ${universeDrafts} AS d SET lobby_area_id = ${draftIdOf(areas, universeId, sql`u.lobby_area_id`)}, starting_area_id = ${draftIdOf(areas, universeId, sql`u.starting_area_id`)} FROM ${universes} AS u WHERE d.universe_id = ${universeId} AND u.id = ${universeId}`);
}

/**
 * The IDs of a table's live rows the draft has no copy of: those it deleted, or that the live version
 * added after the draft started
 *
 * @param table The table
 * @param universeId The universe's ID
 * @param executor A transaction
 * @return The rows' IDs
 */
async function findRemoved<Id extends number | string>(table: CopiedTable, universeId: string, executor: Executor): Promise<Id[]>
{
	const result = await executor.execute<{ id: Id }>(sql`SELECT l.id FROM ${table} AS l WHERE l.universe_id = ${universeId} AND NOT l.draft AND NOT EXISTS (SELECT 1 FROM ${table} AS d WHERE d.draft AND d.origin_id = l.id)`);

	return(result.rows.map((row) => row.id));
}

/**
 * Applies a universe's draft to its live version, all but removing the live rows the draft doesn't have:
 * each draft row is written into the live row it was copied from, under the live row's ID, and what the
 * draft added becomes live with its own ID. The draft is gone after. Call it inside a transaction holding
 * the universe's lock, on a universe with a draft, then deal with the removed rows (removeRows())
 *
 * @param universeId The universe's ID
 * @param executor A transaction
 * @return The live rows the draft doesn't have, still in place
 */
export async function applyDraft(universeId: string, executor: Executor): Promise<RemovedRows>
{
	// An edited copy of a default the draft made, while the live version made its own, is written into the
	// live one, since a universe has one copy of each default; the same for the default difficulty levels
	const overrideColumns: [CopiedTable, string][] = [
		[tiles, 'overrides_tile_id'],
		[items, 'overrides_item_id'],
		[races, 'overrides_race_id'],
		[classes, 'overrides_class_id'],
		[themes, 'overrides_theme_id']
	];

	for (const [table, overrides] of overrideColumns)
	{
		await executor.execute(sql`UPDATE ${table} AS d SET origin_id = l.id FROM ${table} AS l WHERE d.universe_id = ${universeId} AND d.draft AND d.origin_id IS NULL AND ${columnOf('d', overrides)} IS NOT NULL AND l.universe_id = ${universeId} AND NOT l.draft AND ${columnOf('l', overrides)} = ${columnOf('d', overrides)}`);
	}

	await executor.execute(sql`UPDATE ${difficultyLevels} AS d SET origin_id = l.id FROM ${difficultyLevels} AS l WHERE d.universe_id = ${universeId} AND d.draft AND d.origin_id IS NULL AND d.key IS NOT NULL AND l.universe_id = ${universeId} AND NOT l.draft AND l.key = d.key`);

	const removed: RemovedRows = {
		tileGraphicIds: await findRemoved(tileGraphics, universeId, executor),
		tileIds: await findRemoved(tiles, universeId, executor),
		areaIds: await findRemoved(areas, universeId, executor),
		itemIds: await findRemoved(items, universeId, executor),
		raceIds: await findRemoved(races, universeId, executor),
		classIds: await findRemoved(classes, universeId, executor),
		themeIds: await findRemoved(themes, universeId, executor),
		difficultyLevelIds: await findRemoved(difficultyLevels, universeId, executor)
	};

	// The draft's default level takes over, and a universe has one default at a time
	await executor
		.update(difficultyLevels)
		.set({
			isDefault: false
		})
		.where(and(
			eq(difficultyLevels.universeId, universeId),
			eq(difficultyLevels.draft, false)
		));

	for (const table of COPIED_TABLES)
	{
		const names = columnNames(table, OWN_COLUMNS);

		await executor.execute(sql`UPDATE ${table} AS l SET ${sql.join(names.map((name) => sql`${sql.identifier(name)} = ${columnOf('d', name)}`), sql`, `)} FROM ${table} AS d WHERE d.universe_id = ${universeId} AND d.draft AND d.origin_id = l.id`);
		await executor.execute(sql`UPDATE ${table} SET draft = false WHERE universe_id = ${universeId} AND draft AND origin_id IS NULL`);
	}

	for (const { child, column, parent } of CHILD_TABLES)
	{
		const merged = sql`SELECT p.origin_id FROM ${parent} AS p WHERE p.universe_id = ${universeId} AND p.draft AND p.origin_id IS NOT NULL`;

		await executor.execute(sql`DELETE FROM ${child} WHERE ${sql.identifier(column)} IN (${merged})`);
		await executor.execute(sql`UPDATE ${child} SET ${sql.identifier(column)} = p.origin_id FROM ${parent} AS p WHERE ${child}.${sql.identifier(column)} = p.id AND p.universe_id = ${universeId} AND p.draft AND p.origin_id IS NOT NULL`);
	}

	for (const table of VERSION_TABLES)
	{
		const kept = ((table === universeTranslations) || (table === universeTranslatorNotes)) ? removedTextCondition(removed) : undefined;

		await executor.execute(sql`DELETE FROM ${table} WHERE universe_id = ${universeId} AND NOT draft${((kept === undefined) ? sql`` : sql` AND NOT (${kept})`)}`);

		const thingId = (((table === universeTranslations) || (table === universeTranslatorNotes)) ? sql`, thing_id = ${remappedThingId(universeId, 't', false)}` : sql``);

		await executor.execute(sql`UPDATE ${table} AS t SET draft = false${thingId} WHERE t.universe_id = ${universeId} AND t.draft`);
	}

	const settingNames = columnNames(universeDrafts, ['universe_id', 'created_at']);

	await executor.execute(sql`UPDATE ${universes} AS u SET ${sql.join(settingNames.map((name) => sql`${sql.identifier(name)} = ${columnOf('d', name)}`), sql`, `)} FROM ${universeDrafts} AS d WHERE u.id = ${universeId} AND d.universe_id = ${universeId}`);

	// Every reference to a draft row now points at the live row it was copied from
	for (const { table, column, target } of [...REFERENCES, { table: universes, column: 'lobby_area_id', target: areas }, { table: universes, column: 'starting_area_id', target: areas }])
	{
		await executor.execute(sql`UPDATE ${table} SET ${sql.identifier(column)} = m.origin_id FROM ${target} AS m WHERE ${table}.${sql.identifier(column)} = m.id AND m.universe_id = ${universeId} AND m.draft AND m.origin_id IS NOT NULL`);
	}

	await executor.execute(sql`UPDATE ${mapChunks} SET cells = ${remappedCells(universeId, sql`${mapChunks}.cells`, false)} WHERE area_id IN (SELECT id FROM ${areas} WHERE universe_id = ${universeId} AND NOT draft) AND cells && ARRAY(SELECT id FROM ${tiles} WHERE universe_id = ${universeId} AND draft AND origin_id IS NOT NULL)`);

	// Areas first, since they name tiles that can't be deleted while named
	for (const table of [...COPIED_TABLES].reverse())
	{
		await executor.execute(sql`DELETE FROM ${table} WHERE universe_id = ${universeId} AND draft`);
	}

	await executor
		.delete(universeDrafts)
		.where(eq(universeDrafts.universeId, universeId));

	return(removed);
}

/**
 * Matches the translations and notes of the things a draft removes, which stay with them while they are
 * kept disabled
 *
 * @param removed The rows the draft removes
 * @return The condition, on a translation's or note's kind and thing_id; undefined when it removes nothing
 */
function removedTextCondition(removed: RemovedRows): SQL | undefined
{
	const things: [UniverseTextKind, readonly (number | string)[]][] = [
		['item', removed.itemIds],
		['race', removed.raceIds],
		['class', removed.classIds],
		['theme', removed.themeIds]
	];
	const conditions = things
		.filter(([, ids]) => (ids.length > 0))
		.map(([kind, ids]) => sql`(kind = ${kind} AND thing_id IN (${sql.join(ids.map((id) => sql`${String(id)}`), sql`, `)}))`);

	return(((conditions.length === 0) ? undefined : sql.join(conditions, sql` OR `)));
}

/**
 * Deletes live rows a draft applied didn't have. Call it once whoever was using them has moved: the
 * characters in its areas and the groups at its difficulty levels. Their translations and notes go with them
 *
 * @param universeId The universe's ID
 * @param removed The rows to delete, none of them used by a character
 * @param executor A transaction
 * @return The images of the deleted tile graphics that no tile graphic uses any more, to delete from storage
 */
export async function deleteRemovedRows(universeId: string, removed: RemovedRows, executor: Executor): Promise<string[]>
{
	const universeRows = <T extends CopiedTable>(table: T, ids: readonly (number | string)[]): SQL | undefined => and(
		eq(table.universeId, universeId),
		eq(table.draft, false),
		inArray(table.id, ids as never[])
	);
	const storageKeys = ((removed.tileGraphicIds.length === 0) ? [] : (await executor
		.select({
			storageKey: tileGraphics.storageKey
		})
		.from(tileGraphics)
		.where(universeRows(tileGraphics, removed.tileGraphicIds)))
		.map((row) => row.storageKey));
	const deletions: [CopiedTable, readonly (number | string)[]][] = [
		[areas, removed.areaIds],
		[races, removed.raceIds],
		[classes, removed.classIds],
		[themes, removed.themeIds],
		[items, removed.itemIds],
		[difficultyLevels, removed.difficultyLevelIds],
		[tiles, removed.tileIds],
		[tileGraphics, removed.tileGraphicIds]
	];

	for (const [table, ids] of deletions)
	{
		if (ids.length > 0)
		{
			await executor
				.delete(table)
				.where(universeRows(table, ids));
		}
	}

	const textDeletions = removedTextCondition(removed);

	if (textDeletions !== undefined)
	{
		for (const table of [universeTranslations, universeTranslatorNotes])
		{
			await executor.execute(sql`DELETE FROM ${table} WHERE universe_id = ${universeId} AND NOT draft AND (${textDeletions})`);
		}
	}

	for (const table of [universeTranslations, universeTranslatorNotes])
	{
		if (removed.areaIds.length > 0)
		{
			await executor.execute(sql`DELETE FROM ${table} WHERE universe_id = ${universeId} AND NOT draft AND kind = 'area' AND thing_id IN (${sql.join(removed.areaIds.map((id) => sql`${id}`), sql`, `)})`);
		}
	}

	return(findUnusedStorageKeys(storageKeys, executor));
}

/**
 * Disables live areas, races, classes, themes or items, such as those a draft applied doesn't have, so
 * they are treated as disabled until they are deleted, or for good while characters use them
 *
 * @param universeId The universe's ID
 * @param table The table
 * @param ids The rows' IDs
 * @param executor A transaction
 */
export async function disableLiveRows(universeId: string, table: typeof areas | typeof races | typeof classes | typeof themes | typeof items, ids: readonly (number | string)[], executor: Executor): Promise<void>
{
	if (ids.length === 0)
	{
		return;
	}

	await executor.execute(sql`UPDATE ${table} SET enabled = false WHERE universe_id = ${universeId} AND NOT draft AND id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
}

/**
 * Sets whether the characters of disabled races or classes keep playing, as applying a draft chose
 *
 * @param universeId The universe's ID
 * @param table The table
 * @param keepPlaying Whether each one's characters keep playing, by the ID characters hold (a default's
 * own ID for the universe's edited copy of it)
 * @param executor A transaction
 */
export async function setLiveKeepPlaying(universeId: string, table: typeof races | typeof classes, keepPlaying: ReadonlyMap<number, boolean>, executor: Executor): Promise<void>
{
	const overrides = ((table === races) ? sql.identifier('overrides_race_id') : sql.identifier('overrides_class_id'));

	for (const [id, keep] of keepPlaying)
	{
		await executor.execute(sql`UPDATE ${table} SET keep_playing = ${keep} WHERE universe_id = ${universeId} AND NOT draft AND (id = ${id} OR ${overrides} = ${id})`);
	}
}

/**
 * Discards a universe's draft: its settings and every draft row. Call it inside a transaction holding the
 * universe's lock
 *
 * @param universeId The universe's ID
 * @param executor A transaction
 * @return The images of the draft's tile graphics that no tile graphic uses any more, to delete from storage
 */
export async function discardDraft(universeId: string, executor: Executor): Promise<string[]>
{
	const graphics = await executor
		.select({
			storageKey: tileGraphics.storageKey
		})
		.from(tileGraphics)
		.where(and(
			eq(tileGraphics.universeId, universeId),
			eq(tileGraphics.draft, true)
		));

	await executor
		.delete(universeDrafts)
		.where(eq(universeDrafts.universeId, universeId));

	// Areas first, since they name tiles that can't be deleted while named
	for (const table of [...COPIED_TABLES].reverse())
	{
		await executor.execute(sql`DELETE FROM ${table} WHERE universe_id = ${universeId} AND draft`);
	}

	for (const table of VERSION_TABLES)
	{
		await executor.execute(sql`DELETE FROM ${table} WHERE universe_id = ${universeId} AND draft`);
	}

	return(findUnusedStorageKeys(graphics.map((graphic) => graphic.storageKey), executor));
}

/**
 * The live row each of a universe's draft rows was copied from, for comparing the draft with the live
 * version
 *
 * @param table The table
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return Each draft row's live row, by the draft row's ID; a row the draft added has none
 */
export async function findDraftOrigins<Id extends number | string>(table: CopiedTable, universeId: string, executor: Executor = db): Promise<Map<Id, Id>>
{
	const rows = await executor
		.select({
			id: table.id,
			originId: table.originId
		})
		.from(table)
		.where(and(
			eq(table.universeId, universeId),
			eq(table.draft, true),
			isNotNull(table.originId)
		));

	return(new Map(rows.map((row) => [row.id as Id, row.originId as Id])));
}
