/**
 * Universe text's translations and notes for translators (see Localization in STRUCTURE-OVERVIEW.md):
 * the only module that reads or writes the universe_translations and universe_translator_notes tables.
 * It also lists the names the universe gives the things it holds, the text the Translations tab lists
 * most of
 */
import { and, count, eq, inArray, isNotNull, isNull, notExists, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { unionAll, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { UniverseTextKind, UniverseTextRef } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { areas, classes, difficultyLevels, items, players, races, themes, tiles, universeTranslations, universeTranslatorNotes } from './schema.js';
import { inVersion, liveVersion, type UniverseVersion } from './universeVersions.js';

/**
 * A translation of a piece of universe text
 */
export interface UniverseTranslationRecord extends UniverseTextRef
{
	/**
	 * The language it is in, by tag
	 */
	language: string;

	text: string;

	/**
	 * The hash of the source text it was made from, or last confirmed against (sourceTextHash())
	 */
	sourceHash: string;
}

/**
 * A kind of universe text to load the translations of: all of it, or only that of some things, such as
 * the items one character carries
 */
export type WantedText = UniverseTextKind | { kind: UniverseTextKind; thingIds: readonly (number | string)[] };

/**
 * What the universe's editors say to translators about a piece of universe text
 */
export interface TranslatorNoteRecord extends UniverseTextRef
{
	/**
	 * The note, or null for none
	 */
	note: string | null;

	/**
	 * Whether the text needs no translation, such as a proper name
	 */
	noTranslation: boolean;
}

/**
 * Who saved a translation or a note for translators last
 */
export interface TextSaver
{
	name: string;
	username: string;
}

/**
 * Most translations saveTranslations() writes in one statement, which keeps it well under the number
 * of parameters a statement can take
 */
const TRANSLATIONS_PER_STATEMENT = 1000;

/**
 * Adds a translation of a piece of universe text, or replaces the one it has in that language
 *
 * @param version The universe's live version or draft
 * @param translation The translation, with the player saving it (null or left out for none)
 * @param executor The database, or a transaction
 */
export async function saveTranslation(version: UniverseVersion, translation: UniverseTranslationRecord & { savedBy?: string | null }, executor: Executor = db): Promise<void>
{
	await saveTranslations(version, [translation], executor);
}

/**
 * Adds translations of pieces of universe text, or replaces the ones they have in those languages, a
 * statement for many at a time. A piece of text may come only once in each language
 *
 * @param version The universe's live version or draft
 * @param translations The translations, each with the player saving it (null or left out for none)
 * @param executor The database, or a transaction
 */
export async function saveTranslations(version: UniverseVersion, translations: readonly (UniverseTranslationRecord & { savedBy?: string | null })[], executor: Executor = db): Promise<void>
{
	for (let start = 0; start < translations.length; start += TRANSLATIONS_PER_STATEMENT)
	{
		await executor
			.insert(universeTranslations)
			.values(translations
				.slice(start, (start + TRANSLATIONS_PER_STATEMENT))
				.map((translation) => ({
					universeId: version.universeId,
					draft: version.draft,
					kind: translation.kind,
					thingId: translation.thingId,
					field: translation.field,
					language: translation.language,
					text: translation.text,
					sourceHash: translation.sourceHash,
					savedBy: (translation.savedBy ?? null)
				})))
			.onConflictDoUpdate({
				target: [universeTranslations.universeId, universeTranslations.draft, universeTranslations.kind, universeTranslations.thingId, universeTranslations.field, universeTranslations.language],
				set: {
					text: sql`excluded.text`,
					sourceHash: sql`excluded.source_hash`,
					savedBy: sql`excluded.saved_by`,
					updatedAt: sql`now()`
				}
			});
	}
}

/**
 * The translation of a piece of universe text into one language, with who saved it
 *
 * @param version The universe's live version or draft
 * @param ref The piece of text
 * @param language The translation's language, by tag
 * @param executor The database, or a transaction
 * @return The translation and its source text's hash, with who saved it (null once their account is
 * deleted, or when that isn't known); undefined when it has none
 */
export async function findTranslation(version: UniverseVersion, ref: UniverseTextRef, language: string, executor: Executor = db): Promise<{ text: string; sourceHash: string; savedBy: TextSaver | null } | undefined>
{
	const [row] = await executor
		.select({
			text: universeTranslations.text,
			sourceHash: universeTranslations.sourceHash,
			name: players.displayName,
			username: players.username
		})
		.from(universeTranslations)
		.leftJoin(players, eq(players.id, universeTranslations.savedBy))
		.where(and(
			inVersion(universeTranslations, version),
			eq(universeTranslations.kind, ref.kind),
			eq(universeTranslations.thingId, ref.thingId),
			eq(universeTranslations.field, ref.field),
			eq(universeTranslations.language, language)
		))
		.limit(1);

	return(row && {
		text: row.text,
		sourceHash: row.sourceHash,
		savedBy: saverOf(row)
	});
}

/**
 * A universe's translations into one language, with who saved each, as a save merges its changes with
 * them
 *
 * @param version The universe's live version or draft
 * @param language The language, by tag
 * @param executor The database, or a transaction
 * @return The translations, each with who saved it (null once their account is deleted, or when that
 * isn't known), in no particular order
 */
export async function listTranslationsWithSavers(version: UniverseVersion, language: string, executor: Executor = db): Promise<(UniverseTranslationRecord & { savedBy: TextSaver | null })[]>
{
	const rows = await executor
		.select({
			kind: universeTranslations.kind,
			thingId: universeTranslations.thingId,
			field: universeTranslations.field,
			language: universeTranslations.language,
			text: universeTranslations.text,
			sourceHash: universeTranslations.sourceHash,
			name: players.displayName,
			username: players.username
		})
		.from(universeTranslations)
		.leftJoin(players, eq(players.id, universeTranslations.savedBy))
		.where(and(
			inVersion(universeTranslations, version),
			eq(universeTranslations.language, language)
		));

	return(rows.map(({ name, username, ...translation }) => ({
		...translation,
		savedBy: saverOf({ name, username })
	})));
}

/**
 * Who saved a row, from its joined player
 *
 * @param row The row, with the player's display name and username (null without one)
 * @return Who saved it, or null
 */
function saverOf(row: { name: string | null; username: string | null }): TextSaver | null
{
	return((((row.name === null) || (row.username === null)) ? null : { name: row.name, username: row.username }));
}

/**
 * Deletes the translation of a piece of universe text into one language, if it has one
 *
 * @param version The universe's live version or draft
 * @param ref The piece of text
 * @param language The translation's language, by tag
 * @param executor The database, or a transaction
 */
export async function deleteTranslationOf(version: UniverseVersion, ref: UniverseTextRef, language: string, executor: Executor = db): Promise<void>
{
	await executor
		.delete(universeTranslations)
		.where(and(
			inVersion(universeTranslations, version),
			eq(universeTranslations.kind, ref.kind),
			eq(universeTranslations.thingId, ref.thingId),
			eq(universeTranslations.field, ref.field),
			eq(universeTranslations.language, language)
		));
}

/**
 * The name a universe gives one of the things it holds, as universe text
 */
export interface ThingName
{
	kind: UniverseTextKind;

	/**
	 * The thing's ID, or for a name given to one of the ruleset's defaults, the default's
	 */
	thingId: string;

	/**
	 * The ID the thing has in the live version, found the way applying the draft finds it: in the draft,
	 * the live row it was copied from, or its own ID for a row the draft added, which keeps it when the
	 * draft is applied; the same as thingId in the live version and for the ruleset's defaults
	 */
	liveThingId: string;

	name: string;
}

/**
 * The names a universe gives the things it holds, in one query: its areas' and difficulty levels'
 * names, the names of the tiles, items, races, classes and themes it adds, and the names it gives the
 * ruleset's defaults. A default it hasn't renamed keeps the engine's name, which isn't universe text
 * and isn't listed
 *
 * @param version The universe's live version or draft
 * @param executor The database, or a transaction
 * @return The names, in no particular order
 */
export async function listThingNames(version: UniverseVersion, executor: Executor = db): Promise<ThingName[]>
{
	/**
	 * The columns each part of the query selects
	 *
	 * @param kind What the things are
	 * @param thingId The ID the text is found by
	 * @param liveThingId The ID the thing has in the live version
	 * @return The columns
	 */
	const columns = (kind: UniverseTextKind, thingId: SQL<string>, liveThingId: SQL<string>): { kind: SQL<UniverseTextKind>; thingId: SQL<string>; liveThingId: SQL<string> } => ({
		kind: sql<UniverseTextKind>`${kind}::text`,
		thingId,
		liveThingId
	});

	/**
	 * The names in one of the tables whose rows may be the ruleset's defaults: a universe's own rows,
	 * which are the things it adds and its copies of the defaults it changed, each copy named for its
	 * default
	 *
	 * @param kind What the things are
	 * @param table The table
	 * @param overrides Its column naming the default a copy is of
	 * @return The query
	 */
	const overridable = (kind: UniverseTextKind, table: typeof tiles | typeof items | typeof races | typeof classes | typeof themes, overrides: AnyPgColumn) => executor
		.select({
			...columns(kind, sql<string>`coalesce(${overrides}, ${table.id})::text`, sql<string>`coalesce(${overrides}, ${table.originId}, ${table.id})::text`),
			name: sql<string>`${table.name}`
		})
		.from(table)
		.where(and(
			inVersion(table, version),
			isNotNull(table.name)
		));

	return(unionAll(
		executor
			.select({
				...columns('area', sql<string>`${areas.id}::text`, sql<string>`coalesce(${areas.originId}, ${areas.id})::text`),
				name: sql<string>`${areas.name}`
			})
			.from(areas)
			.where(inVersion(areas, version)),
		executor
			.select({
				// A default level the draft has with no live row it was copied from is written into the
				// live version's level with the same key, if there is one. Drizzle writes a select's
				// columns without their table, which inside the subquery would name l's own, so the
				// outer row's are named by the table
				...columns('difficultyLevel', sql<string>`${difficultyLevels.id}::text`, sql<string>`coalesce(${difficultyLevels.originId}, (SELECT l.id FROM ${difficultyLevels} AS l WHERE l.universe_id = ${difficultyLevels}.universe_id AND NOT l.draft AND l.key = ${difficultyLevels}.key), ${difficultyLevels.id})::text`),
				name: sql<string>`${difficultyLevels.name}`
			})
			.from(difficultyLevels)
			.where(and(
				inVersion(difficultyLevels, version),
				isNotNull(difficultyLevels.name)
			)),
		overridable('tile', tiles, tiles.overridesTileId),
		overridable('item', items, items.overridesItemId),
		overridable('race', races, races.overridesRaceId),
		overridable('class', classes, classes.overridesClassId),
		overridable('theme', themes, themes.overridesThemeId)
	));
}

/**
 * A universe's translations into some languages
 *
 * @param version The universe's live version or draft
 * @param languages The languages, by tag
 * @param executor The database, or a transaction
 * @return The translations, in no particular order
 */
export async function listTranslations(version: UniverseVersion, languages: readonly string[], executor: Executor = db): Promise<UniverseTranslationRecord[]>
{
	if (languages.length === 0)
	{
		return([]);
	}

	return(executor
		.select({
			kind: universeTranslations.kind,
			thingId: universeTranslations.thingId,
			field: universeTranslations.field,
			language: universeTranslations.language,
			text: universeTranslations.text,
			sourceHash: universeTranslations.sourceHash
		})
		.from(universeTranslations)
		.where(and(
			inVersion(universeTranslations, version),
			inArray(universeTranslations.language, [...languages])
		)));
}

/**
 * Matches the translations of some kinds of universe text, each whole or only some things'
 *
 * @param kinds The kinds of text, none empty
 * @return The condition
 */
function wantedTextCondition(kinds: readonly WantedText[]): SQL | undefined
{
	const whole = kinds.filter((wanted): wanted is UniverseTextKind => (typeof wanted === 'string'));
	const some = kinds.filter((wanted): wanted is Exclude<WantedText, UniverseTextKind> => (typeof wanted !== 'string'));

	// The IDs go in one array parameter rather than one parameter each (inArray()), since a character
	// can carry many items
	return(or(
		((whole.length === 0) ? undefined : inArray(universeTranslations.kind, whole)),
		...some.map(({ kind, thingIds }) => and(
			eq(universeTranslations.kind, kind),
			sql`${universeTranslations.thingId} = ANY(${sql.param([...new Set(thingIds.map(String))])}::text[])`
		))
	));
}

/**
 * Translations of several universes' live text, each into its own languages, such as for a list of
 * universes or of characters in several universes
 *
 * @param wanted Each universe's ID and the languages wanted for it, by tag
 * @param kinds The kinds of text wanted, or undefined for every kind
 * @param executor The database, or a transaction
 * @return The translations with their universes, in no particular order
 */
export async function listTranslationsIn(wanted: readonly { universeId: string; languages: readonly string[] }[], kinds: readonly WantedText[] | undefined, executor: Executor = db): Promise<(UniverseTranslationRecord & { universeId: string })[]>
{
	const universes = wanted.filter(({ languages }) => (languages.length > 0));

	if ((universes.length === 0) || (kinds?.length === 0))
	{
		return([]);
	}

	return(executor
		.select({
			universeId: universeTranslations.universeId,
			kind: universeTranslations.kind,
			thingId: universeTranslations.thingId,
			field: universeTranslations.field,
			language: universeTranslations.language,
			text: universeTranslations.text,
			sourceHash: universeTranslations.sourceHash
		})
		.from(universeTranslations)
		.where(and(
			or(...universes.map(({ universeId, languages }) => and(
				inVersion(universeTranslations, liveVersion(universeId)),
				inArray(universeTranslations.language, [...languages])
			))),
			((kinds === undefined) ? undefined : wantedTextCondition(kinds)),
			// Text marked as needing no translation is shown as written
			notExists(executor
				.select({
					kind: universeTranslatorNotes.kind
				})
				.from(universeTranslatorNotes)
				.where(and(
					eq(universeTranslatorNotes.universeId, universeTranslations.universeId),
					eq(universeTranslatorNotes.draft, universeTranslations.draft),
					eq(universeTranslatorNotes.kind, universeTranslations.kind),
					eq(universeTranslatorNotes.thingId, universeTranslations.thingId),
					eq(universeTranslatorNotes.field, universeTranslations.field),
					eq(universeTranslatorNotes.noTranslation, true)
				)))
		)));
}

/**
 * How many translations a universe has in each language
 *
 * @param version The universe's live version or draft
 * @param executor The database, or a transaction
 * @return The count by language tag, leaving out languages with none
 */
export async function countTranslations(version: UniverseVersion, executor: Executor = db): Promise<Map<string, number>>
{
	const rows = await executor
		.select({
			language: universeTranslations.language,
			translations: count()
		})
		.from(universeTranslations)
		.where(inVersion(universeTranslations, version))
		.groupBy(universeTranslations.language);

	return(new Map(rows.map((row) => [row.language, row.translations])));
}

/**
 * Deletes a version's translations into every language but some, as when languages are taken off the
 * languages it is translated into
 *
 * @param version The universe's live version or draft
 * @param languages The languages to keep, by tag
 * @param executor The database, or a transaction
 * @return How many translations were deleted
 */
export async function deleteTranslationsOutside(version: UniverseVersion, languages: readonly string[], executor: Executor = db): Promise<number>
{
	const result = await executor
		.delete(universeTranslations)
		.where(and(
			inVersion(universeTranslations, version),
			((languages.length === 0) ? undefined : notInArray(universeTranslations.language, [...languages]))
		));

	return(result.rowCount ?? 0);
}

/**
 * The condition that finds a piece of universe text's row of notes
 *
 * @param version The universe's live version or draft
 * @param ref The piece of text
 * @return The condition
 */
function noteRow(version: UniverseVersion, ref: UniverseTextRef): SQL | undefined
{
	return(and(
		inVersion(universeTranslatorNotes, version),
		eq(universeTranslatorNotes.kind, ref.kind),
		eq(universeTranslatorNotes.thingId, ref.thingId),
		eq(universeTranslatorNotes.field, ref.field)
	));
}

/**
 * Adds a note for translators to a piece of universe text, or replaces the one it has
 *
 * @param version The universe's live version or draft
 * @param note The note, with the text it is on and the player saving it (null or left out for none)
 * @param executor The database, or a transaction
 */
export async function saveTranslatorNote(version: UniverseVersion, note: UniverseTextRef & { note: string; savedBy?: string | null }, executor: Executor = db): Promise<void>
{
	const { savedBy, ...values } = note;
	const noteSavedBy = (savedBy ?? null);

	await executor
		.insert(universeTranslatorNotes)
		.values({
			universeId: version.universeId,
			draft: version.draft,
			...values,
			noteSavedBy
		})
		.onConflictDoUpdate({
			target: [universeTranslatorNotes.universeId, universeTranslatorNotes.draft, universeTranslatorNotes.kind, universeTranslatorNotes.thingId, universeTranslatorNotes.field],
			set: {
				note: note.note,
				noteSavedBy,
				updatedAt: sql`now()`
			}
		});
}

/**
 * The note for translators on a piece of universe text, with who wrote or deleted it last
 *
 * @param version The universe's live version or draft
 * @param ref The piece of text
 * @param executor The database, or a transaction
 * @return The note (null for none), with who saved it (null once their account is deleted, or when that
 * isn't known); undefined when the text has no row of notes
 */
export async function findTranslatorNote(version: UniverseVersion, ref: UniverseTextRef, executor: Executor = db): Promise<{ note: string | null; savedBy: TextSaver | null } | undefined>
{
	const [row] = await executor
		.select({
			note: universeTranslatorNotes.note,
			name: players.displayName,
			username: players.username
		})
		.from(universeTranslatorNotes)
		.leftJoin(players, eq(players.id, universeTranslatorNotes.noteSavedBy))
		.where(noteRow(version, ref))
		.limit(1);

	return(row && {
		note: row.note,
		savedBy: saverOf(row)
	});
}

/**
 * Every note for translators in a universe, with who wrote or deleted each last, as a save merges its
 * changes with them
 *
 * @param version The universe's live version or draft
 * @param executor The database, or a transaction
 * @return Each text's row of notes: its note (null for none), with who saved it (null once their account
 * is deleted, or when that isn't known), in no particular order
 */
export async function listTranslatorNotesWithSavers(version: UniverseVersion, executor: Executor = db): Promise<(UniverseTextRef & { note: string | null; savedBy: TextSaver | null })[]>
{
	const rows = await executor
		.select({
			kind: universeTranslatorNotes.kind,
			thingId: universeTranslatorNotes.thingId,
			field: universeTranslatorNotes.field,
			note: universeTranslatorNotes.note,
			name: players.displayName,
			username: players.username
		})
		.from(universeTranslatorNotes)
		.leftJoin(players, eq(players.id, universeTranslatorNotes.noteSavedBy))
		.where(inVersion(universeTranslatorNotes, version));

	return(rows.map(({ name, username, ...note }) => ({
		...note,
		savedBy: saverOf({ name, username })
	})));
}

/**
 * Deletes the note for translators on a piece of universe text, if it has one, keeping whether it
 * needs no translation
 *
 * @param version The universe's live version or draft
 * @param ref The piece of text, with the player deleting the note (null or left out for none)
 * @param executor The database, or a transaction
 */
export async function deleteTranslatorNote(version: UniverseVersion, ref: UniverseTextRef & { savedBy?: string | null }, executor: Executor = db): Promise<void>
{
	// A row that would hold nothing is deleted, and one marking the text keeps its mark
	await executor
		.delete(universeTranslatorNotes)
		.where(and(
			noteRow(version, ref),
			eq(universeTranslatorNotes.noTranslation, false)
		));
	await executor
		.update(universeTranslatorNotes)
		.set({
			note: null,
			noteSavedBy: (ref.savedBy ?? null),
			updatedAt: sql`now()`
		})
		.where(noteRow(version, ref));
}

/**
 * Marks a piece of universe text as needing no translation, such as a proper name, or as needing one
 * again. Its translations are kept either way; players see the text as written while it is marked
 *
 * @param version The universe's live version or draft
 * @param ref The piece of text
 * @param noTranslation Whether it needs no translation
 * @param executor The database, or a transaction
 */
export async function setNoTranslation(version: UniverseVersion, ref: UniverseTextRef, noTranslation: boolean, executor: Executor = db): Promise<void>
{
	if (noTranslation)
	{
		await executor
			.insert(universeTranslatorNotes)
			.values({
				universeId: version.universeId,
				draft: version.draft,
				...ref,
				noTranslation
			})
			.onConflictDoUpdate({
				target: [universeTranslatorNotes.universeId, universeTranslatorNotes.draft, universeTranslatorNotes.kind, universeTranslatorNotes.thingId, universeTranslatorNotes.field],
				set: {
					noTranslation,
					updatedAt: sql`now()`
				}
			});
		return;
	}

	// A row that would hold nothing is deleted, and one with a note keeps it
	await executor
		.delete(universeTranslatorNotes)
		.where(and(
			noteRow(version, ref),
			isNull(universeTranslatorNotes.note)
		));
	await executor
		.update(universeTranslatorNotes)
		.set({
			noTranslation,
			updatedAt: sql`now()`
		})
		.where(noteRow(version, ref));
}

/**
 * Every note for translators in a universe, and the text marked as needing no translation
 *
 * @param version The universe's live version or draft
 * @param executor The database, or a transaction
 * @return The notes, in no particular order
 */
export async function listTranslatorNotes(version: UniverseVersion, executor: Executor = db): Promise<TranslatorNoteRecord[]>
{
	return(executor
		.select({
			kind: universeTranslatorNotes.kind,
			thingId: universeTranslatorNotes.thingId,
			field: universeTranslatorNotes.field,
			note: universeTranslatorNotes.note,
			noTranslation: universeTranslatorNotes.noTranslation
		})
		.from(universeTranslatorNotes)
		.where(inVersion(universeTranslatorNotes, version)));
}

/**
 * Deletes the translations of a piece of universe text and the note on it, as it is given back the
 * engine's text, such as a coin's name or abbreviation
 *
 * @param version The universe's live version or draft
 * @param ref The piece of text
 * @param executor The transaction saving the change
 */
export async function deleteUniverseText(version: UniverseVersion, ref: UniverseTextRef, executor: Executor = db): Promise<void>
{
	await executor
		.delete(universeTranslations)
		.where(and(
			inVersion(universeTranslations, version),
			eq(universeTranslations.kind, ref.kind),
			eq(universeTranslations.thingId, ref.thingId),
			eq(universeTranslations.field, ref.field)
		));
	await executor
		.delete(universeTranslatorNotes)
		.where(noteRow(version, ref));
}

/**
 * Deletes the translations of everything something has to translate, and the notes on it, as it is
 * deleted, or given back the engine's text as one of the ruleset's defaults
 *
 * @param version The universe's live version or draft
 * @param kind What it is
 * @param thingId Its ID
 * @param executor The transaction deleting it
 */
export async function deleteUniverseTextOf(version: UniverseVersion, kind: UniverseTextKind, thingId: number | string, executor: Executor = db): Promise<void>
{
	const id = String(thingId);

	await executor
		.delete(universeTranslations)
		.where(and(
			inVersion(universeTranslations, version),
			eq(universeTranslations.kind, kind),
			eq(universeTranslations.thingId, id)
		));
	await executor
		.delete(universeTranslatorNotes)
		.where(and(
			inVersion(universeTranslatorNotes, version),
			eq(universeTranslatorNotes.kind, kind),
			eq(universeTranslatorNotes.thingId, id)
		));
}
