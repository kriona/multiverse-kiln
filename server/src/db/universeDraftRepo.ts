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
import { areaChunks, areaLinks, areaRegions, areas, regionParents, regions, classes, classRaceAreas, classStartingItems, difficultyLevels, items, pf1eClasses, pf1eRaces, pf1eSettings, races, raceStartingItems, sf1eClasses, sf1eRaces, sf1eSettings, sf1eThemes, themes, tileGraphics, tiles, universeDrafts, universes, universeStartingItems, universeTranslations, universeTranslatorNotes } from './schema.js';
import { findUnusedStorageKeys } from './tileGraphicRepo.js';

/**
 * The content tables whose rows have IDs of their own in the draft, in the order they are copied: each
 * after the tables its rows refer to
 */
const COPIED_TABLES = [tileGraphics, tiles, regions, areas, items, races, classes, themes, difficultyLevels] as const;

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
 * with it. The key is the columns that tell one parent's rows apart, besides the parent's
 */
const CHILD_TABLES: readonly { child: PgTable; column: string; parent: CopiedTable; key: readonly string[] }[] = [
	{ child: pf1eRaces, column: 'race_id', parent: races, key: [] },
	{ child: sf1eRaces, column: 'race_id', parent: races, key: [] },
	{ child: raceStartingItems, column: 'race_id', parent: races, key: ['item_id'] },
	{ child: pf1eClasses, column: 'class_id', parent: classes, key: [] },
	{ child: sf1eClasses, column: 'class_id', parent: classes, key: [] },
	{ child: classStartingItems, column: 'class_id', parent: classes, key: ['item_id'] },
	{ child: classRaceAreas, column: 'class_id', parent: classes, key: ['race_id'] },
	{ child: sf1eThemes, column: 'theme_id', parent: themes, key: [] },
	{ child: areaChunks, column: 'area_id', parent: areas, key: ['layer', 'chunk_column', 'chunk_row'] },
	{ child: areaLinks, column: 'area_id', parent: areas, key: ['column', 'row'] },
	{ child: regionParents, column: 'region_id', parent: regions, key: ['parent_region_id'] },
	{ child: areaRegions, column: 'area_id', parent: areas, key: ['region_id'] }
];

/**
 * The columns that name a row of a copied table, other than a child table's own parent: each points at
 * the draft's copy in the draft, and at the live row in the live version
 */
const REFERENCES: readonly { table: PgTable; column: string; target: CopiedTable }[] = [
	{ table: tiles, column: 'uploaded_graphic_id', target: tileGraphics },
	{ table: regions, column: 'default_tile_id', target: tiles },
	{ table: regionParents, column: 'parent_region_id', target: regions },
	{ table: areaRegions, column: 'region_id', target: regions },
	{ table: areas, column: 'default_tile_id', target: tiles },
	{ table: areas, column: 'resolved_default_tile_id', target: tiles },
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
 * The tables of a version's own lists, one set of rows per version without IDs of their own. The key is
 * the columns that tell one version's rows apart
 */
const VERSION_TABLES: readonly { table: PgTable; key: readonly string[] }[] = [
	{ table: universeStartingItems, key: ['item_id'] },
	{ table: pf1eSettings, key: [] },
	{ table: sf1eSettings, key: [] },
	{ table: universeTranslations, key: ['kind', 'thing_id', 'field', 'language'] },
	{ table: universeTranslatorNotes, key: ['kind', 'thing_id', 'field'] }
];

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
	regionIds: string[];
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
 * The live row a draft row was copied from, or the value itself when it names no such row (a row the
 * draft added, or one of the ruleset's defaults)
 *
 * @param target The table the value names a row of
 * @param universeId The universe's ID
 * @param value The draft row's ID
 * @return The live row's ID
 */
function liveIdOf(target: CopiedTable, universeId: string, value: SQL): SQL
{
	return(sql`coalesce((SELECT m.origin_id FROM ${target} AS m WHERE m.draft AND m.universe_id = ${universeId} AND m.id = ${value} AND m.origin_id IS NOT NULL), ${value})`);
}

/**
 * The tiles an area chunk's cells name that remapping replaces: the live tiles the draft has copies of, or
 * those copies
 *
 * @param universeId The universe's ID
 * @param toDraft Whether to list the live tiles; otherwise their copies
 * @return The tiles' IDs, as an array
 */
function remappedTileIds(universeId: string, toDraft: boolean): SQL
{
	return(sql`ARRAY(SELECT ${(toDraft ? sql`m.origin_id` : sql`m.id`)} FROM ${tiles} AS m WHERE m.draft AND m.universe_id = ${universeId} AND m.origin_id IS NOT NULL)`);
}

/**
 * An area chunk's cells with each tile the draft has a copy of replaced by its copy, or by its live row.
 * Chunks that name none of those tiles, such as those painted only with the ruleset's defaults, are
 * returned as they are without going through their cells
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

	return(sql`CASE WHEN ${cells} && ${remappedTileIds(universeId, toDraft)} THEN ARRAY(SELECT coalesce(${replacement}, c.cell) FROM unnest(${cells}) WITH ORDINALITY AS c(cell, n) LEFT JOIN ${tiles} AS m ON ${join} ORDER BY c.n) ELSE ${cells} END`);
}

/**
 * A translation's or note's thing_id with the thing the draft has a copy of replaced by its copy, or by
 * its live row. The thing_id is cast to the table's ID type, rather than the IDs to text, so the lookup
 * uses the table's primary key or origin_id index. Saving text checks that the universe holds the thing,
 * so every thing_id of a kind with a table is one of its IDs written as text
 *
 * @param universeId The universe's ID
 * @param alias The translation's or note's alias
 * @param toDraft Whether to replace live things with their copies; otherwise draft things with their live rows
 * @return The new thing_id
 */
function remappedThingId(universeId: string, alias: string, toDraft: boolean): SQL
{
	const thingId = columnOf(alias, 'thing_id');
	const cases = Object.entries(TEXT_TABLES).map(([kind, target]) =>
	{
		const typedThingId = sql`${thingId}::${sql.raw(getTableColumns(target).id.getSQLType())}`;

		return((toDraft
			? sql`WHEN ${kind} THEN coalesce((SELECT m.id::text FROM ${target} AS m WHERE m.draft AND m.universe_id = ${universeId} AND m.origin_id = ${typedThingId}), ${thingId})`
			: sql`WHEN ${kind} THEN coalesce((SELECT m.origin_id::text FROM ${target} AS m WHERE m.draft AND m.universe_id = ${universeId} AND m.origin_id IS NOT NULL AND m.id = ${typedThingId}), ${thingId})`));
	});

	return(sql`CASE ${columnOf(alias, 'kind')}::text ${sql.join(cases, sql` `)} ELSE ${thingId} END`);
}

/**
 * A column of a row as the other version holds it: what names a row the draft has a copy of replaced by
 * the copy, or by the live row
 *
 * @param table The row's table
 * @param name The column's name
 * @param alias The row's alias
 * @param universeId The universe's ID
 * @param toDraft Whether the row is live, its column replaced with the draft's copies; otherwise a draft row
 * @return The value; undefined when the column names no copied row, and is the same in both versions
 */
function remappedColumn(table: PgTable, name: string, alias: string, universeId: string, toDraft: boolean): SQL | undefined
{
	const reference = REFERENCES.find((each) => ((each.table === table) && (each.column === name)));
	const value = columnOf(alias, name);

	if (reference !== undefined)
	{
		return((toDraft ? draftIdOf(reference.target, universeId, value) : liveIdOf(reference.target, universeId, value)));
	}
	else if ((table === areaChunks) && (name === 'cells'))
	{
		return(remappedCells(universeId, value, toDraft));
	}
	else if (((table === universeTranslations) || (table === universeTranslatorNotes)) && (name === 'thing_id'))
	{
		return(remappedThingId(universeId, alias, toDraft));
	}

	return(undefined);
}

/**
 * Whether a live row, aliased l, and a draft row, aliased d, hold the same in some columns once the
 * references between the draft's rows are remapped
 *
 * @param table The rows' table
 * @param names The columns' names
 * @param universeId The universe's ID
 * @param remapLive Whether to remap the live row into the draft's IDs, so the condition can use the draft
 * row's indexes; otherwise the draft row into the live IDs, for the live row's
 * @return The condition
 */
function sameValues(table: PgTable, names: readonly string[], universeId: string, remapLive: boolean): SQL
{
	const columns = Object.values(getTableColumns(table));
	const [own, other] = (remapLive ? ['d', 'l'] : ['l', 'd']);
	const conditions = names.map((name) =>
	{
		const value = (remappedColumn(table, name, other, universeId, remapLive) ?? columnOf(other, name));
		const notNull = columns.some((column) => ((column.name === name) && column.notNull));

		// Cells equal as they are stay equal once the draft's are remapped, since a live chunk names none of
		// the draft's tiles. Most chunks name only the ruleset's tiles, and this skips remapping them
		if ((table === areaChunks) && (name === 'cells'))
		{
			return(sql`(${columnOf(own, name)} = ${columnOf(other, name)} OR ${columnOf(own, name)} = ${value})`);
		}

		return((notNull ? sql`${columnOf(own, name)} = ${value}` : sql`${columnOf(own, name)} IS NOT DISTINCT FROM ${value}`));
	});

	return(((conditions.length === 0) ? sql`true` : sql.join(conditions, sql` AND `)));
}

/**
 * How the live and draft rows of a table applyDraft() merges go together: the child rows of a copied
 * row, or a version's own list
 */
interface RowPairing
{
	/**
	 * The table the statements join, aliased p, such as the child rows' parents; undefined for none
	 */
	join: SQL | undefined;

	/**
	 * The condition on the joined table, or true
	 */
	where: SQL;

	/**
	 * Places a row, by its alias, among the live rows that pair with the draft's
	 */
	live: (alias: string) => SQL;

	/**
	 * Places a row, by its alias, among the draft's rows
	 */
	draft: (alias: string) => SQL;

	/**
	 * The columns that make two rows the same, besides those that place them
	 */
	compared: readonly string[];

	/**
	 * The compared columns that tell the rows of one place apart
	 */
	key: readonly string[];

	/**
	 * The columns a draft row changes to become live, besides those remapped to the live IDs
	 */
	moved: Record<string, SQL>;

	/**
	 * Live rows kept whatever the draft holds; undefined for none
	 */
	kept: SQL | undefined;
}

/**
 * Writes the draft's rows of a table into the live version, leaving alone the live rows the draft holds
 * unchanged: the live rows the draft changed or doesn't have are deleted, the draft rows the live version
 * already holds are deleted, and the rest become live, pointing at the live IDs. A draft row whose key is
 * left in the live version is the same as the live row, since the key tells the rows of one place apart
 *
 * @param executor A transaction
 * @param universeId The universe's ID
 * @param table The table
 * @param pairing How its live and draft rows go together
 */
async function mergeRows(executor: Executor, universeId: string, table: PgTable, pairing: RowPairing): Promise<void>
{
	const { join, where, live, draft, compared, key, moved, kept } = pairing;
	const using = ((join === undefined) ? sql`` : sql` USING ${join}`);
	const from = ((join === undefined) ? sql`` : sql` FROM ${join}`);
	const keptCondition = ((kept === undefined) ? sql`` : sql` AND NOT (${kept})`);
	const values = { ...moved };

	for (const name of columnNames(table))
	{
		const value = remappedColumn(table, name, 'd', universeId, false);

		if (value !== undefined)
		{
			values[name] = value;
		}
	}

	await executor.execute(sql`DELETE FROM ${table} AS l${using} WHERE ${where} AND ${live('l')}${keptCondition} AND NOT EXISTS (SELECT 1 FROM ${table} AS d WHERE ${draft('d')} AND ${sameValues(table, compared, universeId, true)})`);
	await executor.execute(sql`DELETE FROM ${table} AS d${using} WHERE ${where} AND ${draft('d')} AND EXISTS (SELECT 1 FROM ${table} AS l WHERE ${live('l')} AND ${sameValues(table, key, universeId, false)})`);
	await executor.execute(sql`UPDATE ${table} AS d SET ${sql.join(Object.entries(values).map(([name, value]) => sql`${sql.identifier(name)} = ${value}`), sql`, `)}${from} WHERE ${where} AND ${draft('d')}`);
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
		lobby_region_id: sql`NULL`,
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

		if (child === areaChunks)
		{
			values.cells = remappedCells(universeId, sql`src.cells`, true);
		}

		await copyRows(executor, child, sql`${child} AS src JOIN ${parent} AS p ON p.origin_id = ${columnOf('src', column)} AND p.draft AND p.universe_id = ${universeId}`, values, ((child === areaLinks) ? ['id'] : []));
	}

	for (const { table } of VERSION_TABLES)
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

	await executor.execute(sql`UPDATE ${universeDrafts} AS d SET lobby_region_id = ${draftIdOf(regions, universeId, sql`u.lobby_region_id`)}, lobby_area_id = ${draftIdOf(areas, universeId, sql`u.lobby_area_id`)}, starting_area_id = ${draftIdOf(areas, universeId, sql`u.starting_area_id`)} FROM ${universes} AS u WHERE d.universe_id = ${universeId} AND u.id = ${universeId}`);
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
 * draft added becomes live with its own ID. Live rows the draft holds unchanged, such as the chunks of
 * areas it didn't paint, are left as they are. The draft is gone after. Call it inside a transaction holding
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
		regionIds: await findRemoved(regions, universeId, executor),
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
			eq(difficultyLevels.draft, false),
			eq(difficultyLevels.isDefault, true)
		));

	// The chunks of the areas the draft added become live as they are, so they are pointed at the live
	// tiles while those areas are still marked draft and can be found. The other areas' chunks are
	// remapped as they are merged
	await executor.execute(sql`UPDATE ${areaChunks} AS d SET cells = ${remappedCells(universeId, sql`d.cells`, false)} WHERE d.area_id IN (SELECT id FROM ${areas} WHERE universe_id = ${universeId} AND draft AND origin_id IS NULL) AND d.cells && ${remappedTileIds(universeId, false)}`);

	// Region names are unique within a version, and nothing uses a region the draft deleted, so those go
	// now, before a region the draft added can take one's name. The live regions the draft renames are
	// given names no region has first, so two regions can swap names
	if (removed.regionIds.length > 0)
	{
		await executor
			.delete(regions)
			.where(and(
				eq(regions.universeId, universeId),
				eq(regions.draft, false),
				inArray(regions.id, removed.regionIds)
			));
	}

	await executor.execute(sql`UPDATE ${regions} AS l SET name = l.id::text FROM ${regions} AS d WHERE d.universe_id = ${universeId} AND d.draft AND d.origin_id = l.id AND d.name <> l.name`);

	for (const table of COPIED_TABLES)
	{
		const names = columnNames(table, OWN_COLUMNS);
		const values = names.map((name) => sql`${sql.identifier(name)} = ${(remappedColumn(table, name, 'd', universeId, false) ?? columnOf('d', name))}`);

		await executor.execute(sql`UPDATE ${table} AS l SET ${sql.join(values, sql`, `)} FROM ${table} AS d WHERE d.universe_id = ${universeId} AND d.draft AND d.origin_id = l.id AND NOT (${sameValues(table, names, universeId, false)})`);
		await executor.execute(sql`UPDATE ${table} SET draft = false WHERE universe_id = ${universeId} AND draft AND origin_id IS NULL`);
	}

	for (const { child, column, parent, key } of CHILD_TABLES)
	{
		await mergeRows(executor, universeId, child, {
			join: sql`${parent} AS p`,
			where: sql`p.universe_id = ${universeId} AND p.draft AND p.origin_id IS NOT NULL`,
			live: (alias) => sql`${columnOf(alias, column)} = p.origin_id`,
			draft: (alias) => sql`${columnOf(alias, column)} = p.id`,
			compared: columnNames(child, [column, 'id']),
			key,
			moved: {
				[column]: sql`p.origin_id`
			},
			kept: undefined
		});
	}

	for (const { table, key } of VERSION_TABLES)
	{
		await mergeRows(executor, universeId, table, {
			join: undefined,
			where: sql`true`,
			live: (alias) => sql`${columnOf(alias, 'universe_id')} = ${universeId} AND NOT ${columnOf(alias, 'draft')}`,
			draft: (alias) => sql`${columnOf(alias, 'universe_id')} = ${universeId} AND ${columnOf(alias, 'draft')}`,
			compared: columnNames(table, ['universe_id', 'draft']),
			key,
			moved: {
				draft: sql`false`
			},
			kept: (((table === universeTranslations) || (table === universeTranslatorNotes)) ? removedTextCondition(removed) : undefined)
		});
	}

	const settingNames = columnNames(universeDrafts, ['universe_id', 'created_at']);

	await executor.execute(sql`UPDATE ${universes} AS u SET ${sql.join(settingNames.map((name) => sql`${sql.identifier(name)} = ${columnOf('d', name)}`), sql`, `)} FROM ${universeDrafts} AS d WHERE u.id = ${universeId} AND d.universe_id = ${universeId}`);

	// Every reference to a draft row now points at the live row it was copied from
	for (const { table, column, target } of [...REFERENCES, { table: universes, column: 'lobby_region_id', target: regions }, { table: universes, column: 'lobby_area_id', target: areas }, { table: universes, column: 'starting_area_id', target: areas }])
	{
		await executor.execute(sql`UPDATE ${table} SET ${sql.identifier(column)} = m.origin_id FROM ${target} AS m WHERE ${table}.${sql.identifier(column)} = m.id AND m.universe_id = ${universeId} AND m.draft AND m.origin_id IS NOT NULL`);
	}

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
 * they are treated as disabled until they are deleted, or for good while characters use them. An area's
 * worked-out setting is disabled with its own, without the areas below it, which the draft holds its
 * own settings for
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

	// An area is disabled by its worked-out setting, which the rooms read
	const set = ((table === areas) ? sql`enabled = false, resolved_enabled = false` : sql`enabled = false`);

	await executor.execute(sql`UPDATE ${table} SET ${set} WHERE universe_id = ${universeId} AND NOT draft AND id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
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

	for (const { table } of VERSION_TABLES)
	{
		await executor.execute(sql`DELETE FROM ${table} WHERE universe_id = ${universeId} AND draft`);
	}

	return(findUnusedStorageKeys(graphics.map((graphic) => graphic.storageKey), executor));
}

/**
 * The live row each of a universe's draft rows was copied from, for every kind of thing the draft has a
 * copy of, by the draft row's ID; a row the draft added has none
 */
export interface DraftOrigins
{
	tileGraphics: Map<string, string>;
	tiles: Map<number, number>;
	items: Map<number, number>;
	regions: Map<string, string>;
	areas: Map<string, string>;
	races: Map<number, number>;
	classes: Map<number, number>;
	themes: Map<number, number>;
	difficultyLevels: Map<number, number>;
}

/**
 * The live row each of a universe's draft rows was copied from, of every kind, such as for an export
 * of the draft, which names its things by the draft's IDs
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The live rows, by kind
 */
export async function findAllDraftOrigins(universeId: string, executor: Executor = db): Promise<DraftOrigins>
{
	return({
		tileGraphics: await findDraftOrigins<string>(tileGraphics, universeId, executor),
		tiles: await findDraftOrigins<number>(tiles, universeId, executor),
		items: await findDraftOrigins<number>(items, universeId, executor),
		regions: await findDraftOrigins<string>(regions, universeId, executor),
		areas: await findDraftOrigins<string>(areas, universeId, executor),
		races: await findDraftOrigins<number>(races, universeId, executor),
		classes: await findDraftOrigins<number>(classes, universeId, executor),
		themes: await findDraftOrigins<number>(themes, universeId, executor),
		difficultyLevels: await findDraftOrigins<number>(difficultyLevels, universeId, executor)
	});
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
