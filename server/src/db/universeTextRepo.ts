/**
 * Universe text's translations and notes for translators (see Localization in STRUCTURE-OVERVIEW.md):
 * the only module that reads or writes the universe_translations and universe_translator_notes tables
 */
import { and, count, eq, inArray, notInArray, or, sql } from 'drizzle-orm';
import type { UniverseTextField, UniverseTextKind } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { universeTranslations, universeTranslatorNotes } from './schema.js';

/**
 * A piece of universe text: one field of something the universe holds
 */
export interface UniverseTextRef
{
	kind: UniverseTextKind;

	/**
	 * The ID of what the text belongs to, as text; the universe's own ID for its own text
	 */
	thingId: string;

	field: UniverseTextField;
}

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
 * A note for translators on a piece of universe text
 */
export interface TranslatorNoteRecord extends UniverseTextRef
{
	note: string;
}

/**
 * Adds a translation of a piece of universe text, or replaces the one it has in that language
 *
 * @param universeId The universe's ID
 * @param translation The translation
 * @param executor The database, or a transaction
 */
export async function saveTranslation(universeId: string, translation: UniverseTranslationRecord, executor: Executor = db): Promise<void>
{
	await executor
		.insert(universeTranslations)
		.values({
			universeId,
			...translation
		})
		.onConflictDoUpdate({
			target: [universeTranslations.universeId, universeTranslations.kind, universeTranslations.thingId, universeTranslations.field, universeTranslations.language],
			set: {
				text: translation.text,
				sourceHash: translation.sourceHash,
				updatedAt: sql`now()`
			}
		});
}

/**
 * A universe's translations into some languages
 *
 * @param universeId The universe's ID
 * @param languages The languages, by tag
 * @param executor The database, or a transaction
 * @return The translations, in no particular order
 */
export async function listTranslations(universeId: string, languages: readonly string[], executor: Executor = db): Promise<UniverseTranslationRecord[]>
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
			eq(universeTranslations.universeId, universeId),
			inArray(universeTranslations.language, [...languages])
		)));
}

/**
 * Translations of several universes' text, each into its own languages, such as for a list of
 * universes or of characters in several universes
 *
 * @param wanted Each universe's ID and the languages wanted for it, by tag
 * @param kinds The kinds of text wanted, or undefined for every kind
 * @param executor The database, or a transaction
 * @return The translations with their universes, in no particular order
 */
export async function listTranslationsIn(wanted: readonly { universeId: string; languages: readonly string[] }[], kinds: readonly UniverseTextKind[] | undefined, executor: Executor = db): Promise<(UniverseTranslationRecord & { universeId: string })[]>
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
				eq(universeTranslations.universeId, universeId),
				inArray(universeTranslations.language, [...languages])
			))),
			((kinds === undefined) ? undefined : inArray(universeTranslations.kind, [...kinds]))
		)));
}

/**
 * How many translations a universe has in each language
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The count by language tag, leaving out languages with none
 */
export async function countTranslations(universeId: string, executor: Executor = db): Promise<Map<string, number>>
{
	const rows = await executor
		.select({
			language: universeTranslations.language,
			translations: count()
		})
		.from(universeTranslations)
		.where(eq(universeTranslations.universeId, universeId))
		.groupBy(universeTranslations.language);

	return(new Map(rows.map((row) => [row.language, row.translations])));
}

/**
 * Deletes a universe's translations into every language but some, as when languages are taken off the
 * languages it is translated into
 *
 * @param universeId The universe's ID
 * @param languages The languages to keep, by tag
 * @param executor The database, or a transaction
 * @return How many translations were deleted
 */
export async function deleteTranslationsOutside(universeId: string, languages: readonly string[], executor: Executor = db): Promise<number>
{
	const result = await executor
		.delete(universeTranslations)
		.where(and(
			eq(universeTranslations.universeId, universeId),
			((languages.length === 0) ? undefined : notInArray(universeTranslations.language, [...languages]))
		));

	return(result.rowCount ?? 0);
}

/**
 * Adds a note for translators to a piece of universe text, or replaces the one it has
 *
 * @param universeId The universe's ID
 * @param note The note, with the text it is on
 * @param executor The database, or a transaction
 */
export async function saveTranslatorNote(universeId: string, note: TranslatorNoteRecord, executor: Executor = db): Promise<void>
{
	await executor
		.insert(universeTranslatorNotes)
		.values({
			universeId,
			...note
		})
		.onConflictDoUpdate({
			target: [universeTranslatorNotes.universeId, universeTranslatorNotes.kind, universeTranslatorNotes.thingId, universeTranslatorNotes.field],
			set: {
				note: note.note,
				updatedAt: sql`now()`
			}
		});
}

/**
 * Deletes the note for translators on a piece of universe text, if it has one
 *
 * @param universeId The universe's ID
 * @param ref The piece of text
 * @param executor The database, or a transaction
 */
export async function deleteTranslatorNote(universeId: string, ref: UniverseTextRef, executor: Executor = db): Promise<void>
{
	await executor
		.delete(universeTranslatorNotes)
		.where(and(
			eq(universeTranslatorNotes.universeId, universeId),
			eq(universeTranslatorNotes.kind, ref.kind),
			eq(universeTranslatorNotes.thingId, ref.thingId),
			eq(universeTranslatorNotes.field, ref.field)
		));
}

/**
 * Every note for translators in a universe
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The notes, in no particular order
 */
export async function listTranslatorNotes(universeId: string, executor: Executor = db): Promise<TranslatorNoteRecord[]>
{
	return(executor
		.select({
			kind: universeTranslatorNotes.kind,
			thingId: universeTranslatorNotes.thingId,
			field: universeTranslatorNotes.field,
			note: universeTranslatorNotes.note
		})
		.from(universeTranslatorNotes)
		.where(eq(universeTranslatorNotes.universeId, universeId)));
}

/**
 * Deletes the translations of everything something has to translate, and the notes on it, as it is
 * deleted, or given back the engine's text as one of the ruleset's defaults
 *
 * @param universeId The universe's ID
 * @param kind What it is
 * @param thingId Its ID
 * @param executor The transaction deleting it
 */
export async function deleteUniverseTextOf(universeId: string, kind: UniverseTextKind, thingId: number | string, executor: Executor = db): Promise<void>
{
	const id = String(thingId);

	await executor
		.delete(universeTranslations)
		.where(and(
			eq(universeTranslations.universeId, universeId),
			eq(universeTranslations.kind, kind),
			eq(universeTranslations.thingId, id)
		));
	await executor
		.delete(universeTranslatorNotes)
		.where(and(
			eq(universeTranslatorNotes.universeId, universeId),
			eq(universeTranslatorNotes.kind, kind),
			eq(universeTranslatorNotes.thingId, id)
		));
}
