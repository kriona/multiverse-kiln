/**
 * Universe text's translations and notes for translators (see Localization in STRUCTURE-OVERVIEW.md):
 * the only module that reads or writes the universe_translations and universe_translator_notes tables
 */
import { and, count, eq, inArray, isNull, notExists, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type { UniverseTextKind, UniverseTextRef } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { universeTranslations, universeTranslatorNotes } from './schema.js';
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
 * Adds a translation of a piece of universe text, or replaces the one it has in that language
 *
 * @param version The universe's live version or draft
 * @param translation The translation
 * @param executor The database, or a transaction
 */
export async function saveTranslation(version: UniverseVersion, translation: UniverseTranslationRecord, executor: Executor = db): Promise<void>
{
	await executor
		.insert(universeTranslations)
		.values({
			universeId: version.universeId,
			draft: version.draft,
			...translation
		})
		.onConflictDoUpdate({
			target: [universeTranslations.universeId, universeTranslations.draft, universeTranslations.kind, universeTranslations.thingId, universeTranslations.field, universeTranslations.language],
			set: {
				text: translation.text,
				sourceHash: translation.sourceHash,
				updatedAt: sql`now()`
			}
		});
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
 * Translations of several universes' live text, each into its own languages, such as for a list of
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
				inVersion(universeTranslations, liveVersion(universeId)),
				inArray(universeTranslations.language, [...languages])
			))),
			((kinds === undefined) ? undefined : inArray(universeTranslations.kind, [...kinds])),
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
 * @param note The note, with the text it is on
 * @param executor The database, or a transaction
 */
export async function saveTranslatorNote(version: UniverseVersion, note: UniverseTextRef & { note: string }, executor: Executor = db): Promise<void>
{
	await executor
		.insert(universeTranslatorNotes)
		.values({
			universeId: version.universeId,
			draft: version.draft,
			...note
		})
		.onConflictDoUpdate({
			target: [universeTranslatorNotes.universeId, universeTranslatorNotes.draft, universeTranslatorNotes.kind, universeTranslatorNotes.thingId, universeTranslatorNotes.field],
			set: {
				note: note.note,
				updatedAt: sql`now()`
			}
		});
}

/**
 * Deletes the note for translators on a piece of universe text, if it has one, keeping whether it
 * needs no translation
 *
 * @param version The universe's live version or draft
 * @param ref The piece of text
 * @param executor The database, or a transaction
 */
export async function deleteTranslatorNote(version: UniverseVersion, ref: UniverseTextRef, executor: Executor = db): Promise<void>
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
