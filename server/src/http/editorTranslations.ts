/**
 * The editor's Translations tab (see Tab: Translations in STRUCTURE-OVERVIEW.md): every piece of the
 * universe's text with its translation into one language and its note for translators, and the changes
 * that save translations and notes
 *
 * The text comes from the universe and the things it holds, as the editor's lists load them, so one of
 * the ruleset's defaults the universe hasn't renamed is engine text and isn't listed
 */
import { createHash } from 'node:crypto';
import type express from 'express';
import type { Request, Response } from 'express';
import { canEditWorld, canTranslate, COINS, RULESET_COINS, sortRows, UNIVERSE_TEXT_FIELDS, UNIVERSE_TEXT_KINDS, type EditableUniverseDetails, type EditorChange, type MergedTextChange, type UniverseTextListPayload, type UniverseTextListQuery, type UniverseTextRef, type UniverseTextRow, type UniverseTextSortColumn } from '@multiverse-kiln/shared';

import type { Executor } from '../db/client.js';
import { deleteTranslationOf, deleteTranslatorNote, findTranslation, findTranslatorNote, listThingNames, listTranslations, listTranslationsWithSavers, listTranslatorNotes, listTranslatorNotesWithSavers, saveTranslations, saveTranslatorNote, setNoTranslation, type TextSaver, type UniverseTranslationRecord } from '../db/universeTextRepo.js';
import type { UniverseVersion } from '../db/universeVersions.js';
import { refuse, type ChangeContext } from './editorChangeContext.js';
import { universeContextOf } from './editorAccess.js';
import { universeTextLanguageQuery, universeTextListQuery } from './editorPayloads.js';
import { sendError, sendInvalidRequest } from './errors.js';

/**
 * A piece of universe text in the source language, with the name of what it belongs to
 */
type UniverseTextSource = UniverseTextRef & { thingName: string; source: string };

/**
 * The key a piece of text is found by
 *
 * @param ref The piece of text
 * @return The key
 */
function textKey(ref: UniverseTextRef): string
{
	return(`${ref.kind}:${ref.thingId}:${ref.field}`);
}

/**
 * Every piece of a version's text in the universe's source language, leaving out descriptions it hasn't
 * written, defaults it hasn't renamed and coins' names and abbreviations it hasn't given: the universe's
 * own text, then the names of the things it holds in no particular order, then its coins' text
 *
 * @param universe The universe, with the version's settings
 * @param version The universe's live version or draft
 * @param executor The database, or a transaction
 * @return The text
 */
async function collectUniverseText(universe: EditableUniverseDetails, version: UniverseVersion, executor?: Executor): Promise<UniverseTextSource[]>
{
	const { id, ruleset } = universe;
	const names = await listThingNames(version, executor);
	const universeText = (['name', 'shortDescription', 'longDescription'] as const)
		.map((field): UniverseTextSource => ({
			kind: 'universe',
			thingId: id,
			field,
			thingName: universe.name,
			source: universe[field]
		}))
		.filter((text) => (text.source !== ''));
	const coinText = RULESET_COINS[ruleset].flatMap((coin) =>
	{
		const name = universe.coinNames[coin];
		const abbreviation = universe.coinAbbreviations[coin];
		const thingName = (name ?? abbreviation ?? coin);

		return(([['name', name], ['abbreviation', abbreviation]] as const).flatMap(([field, source]): UniverseTextSource[] => ((source === undefined)
			? []
			: [{
				kind: 'coin',
				thingId: coin,
				field,
				thingName,
				source
			}])));
	});

	return([
		...universeText,
		...names.map(({ kind, thingId, name }): UniverseTextSource => ({
			kind,
			thingId,
			field: 'name',
			thingName: name,
			source: name
		})),
		...coinText
	]);
}

/**
 * Adds the Translations tab's route to a universe's router
 *
 * @param router The router for routes under /:universeId
 */
export function addTranslationRoutes(router: express.Router): void
{
	router.get('/translations', listTranslationsRoute);
	router.get('/translations/all', listAllTranslationsRoute);
}

/**
 * GET /:universeId/translations: a page of the universe's text with its translations into a language
 * (UniverseTextListQuery)
 *
 * @param request The request
 * @param response The response
 */
async function listTranslationsRoute(request: Request, response: Response): Promise<void>
{
	const query = universeTextListQuery.safeParse(request.query);

	if (!query.success)
	{
		sendInvalidRequest(response, query.error);
		return;
	}

	const rows = await loadTextRows(request, response, query.data.language);

	if (rows)
	{
		response.json(pageUniverseText(rows, query.data));
	}
}

/**
 * GET /:universeId/translations/all?language=: every piece of the universe's text with its
 * translation into a language, by where it comes from, for exporting and importing translation files
 *
 * @param request The request
 * @param response The response
 */
async function listAllTranslationsRoute(request: Request, response: Response): Promise<void>
{
	const query = universeTextLanguageQuery.safeParse(request.query);

	if (!query.success)
	{
		sendInvalidRequest(response, query.error);
		return;
	}

	const rows = await loadTextRows(request, response, query.data.language);

	if (rows)
	{
		const payload: UniverseTextListPayload = {
			rows: sortRows(rows, ROW_COMPARERS, { column: 'place', direction: 'ascending' }),
			total: rows.length
		};

		response.json(payload);
	}
}

/**
 * Every piece of the universe's text with its translation into a language and its note, answering 403
 * to a role that may neither translate into the language nor write notes, and 404 for a language the
 * universe isn't translated into
 *
 * @param request The request
 * @param response The response, which is answered when the text can't be listed
 * @param requested The language, as asked for
 * @return The text, in the order of collectUniverseText(), or undefined once the response has been sent
 */
async function loadTextRows(request: Request, response: Response, requested: string): Promise<UniverseTextRow[] | undefined>
{
	const { universe, version, role, languages } = universeContextOf(request);
	const language = universe.translationLanguages.find((each) => (each.toLowerCase() === requested.toLowerCase()));

	if (!canTranslate({ role, languages }, requested) && !canEditWorld(role))
	{
		sendError(response, 403, {
			id: 'error.translationsNotAllowed',
			defaultMessage: 'Your role doesn\'t let you see the translations into that language.',
			description: 'Why the editor\'s Translations tab couldn\'t list the universe\'s text: the player is a translator of other languages, or a beta tester'
		});
		return(undefined);
	}

	if (language === undefined)
	{
		sendError(response, 404, {
			id: 'error.noSuchTranslationLanguage',
			defaultMessage: 'The universe isn\'t translated into that language.',
			description: 'Why the editor\'s Translations tab couldn\'t list the universe\'s text in a language: it isn\'t one of the languages the universe is translated into, perhaps because a creator just took it off'
		});
		return(undefined);
	}

	const [sources, translations, notes] = await Promise.all([
		collectUniverseText(universe, version),
		listTranslations(version, [language]),
		listTranslatorNotes(version)
	]);
	const translationsByKey = new Map(translations.map((translation) => [textKey(translation), translation]));
	const notesByKey = new Map(notes.map((note) => [textKey(note), note]));
	return(sources.map((text): UniverseTextRow =>
	{
		const key = textKey(text);
		const translation = translationsByKey.get(key);
		const note = notesByKey.get(key);
		const noTranslation = (note?.noTranslation ?? false);
		const sourceHash = hashSourceText(text.source);

		return({
			...text,
			sourceHash,
			note: (note?.note ?? null),
			noTranslation,
			translation: (translation?.text ?? null),
			outOfDate: (!noTranslation && (translation !== undefined) && (translation.sourceHash !== sourceHash))
		});
	}));
}

/**
 * The hash a translation keeps of the source text it was made from, the same as sourceTextHash() but
 * worked out by Node's crypto, which is many times faster than the shared code
 *
 * @param text The source text
 * @return The hash, 64 hex digits
 */
export function hashSourceText(text: string): string
{
	return(createHash('sha256').update(text, 'utf8').digest('hex'));
}

/**
 * Compares text in the server's language, as localeCompare() does without arguments, but faster
 */
const textCollator = new Intl.Collator();

/**
 * Compares IDs, which may be numbers, so that 9 comes before 10
 */
const idCollator = new Intl.Collator('en', { numeric: true });

/**
 * Where a piece of text comes in the table's default order: by kind, then the name of what it belongs
 * to (coins most valuable first instead), then by field, then by the ID of what it belongs to, for
 * things with the same name
 */
const PLACE_ORDER = {
	kinds: new Map(UNIVERSE_TEXT_KINDS.map((kind, index) => [kind, index])),
	coins: new Map<string, number>(COINS.map((coin, index) => [coin, index])),
	fields: new Map(UNIVERSE_TEXT_FIELDS.map((field, index) => [field, index]))
};

/**
 * Compares text that may be missing, missing text last going up
 *
 * @param first The first text, or null
 * @param second The second text, or null
 * @return Negative, 0 or positive, for sort()
 */
function compareOptional(first: string | null, second: string | null): number
{
	if ((first === null) || (second === null))
	{
		return((Number(first === null) - Number(second === null)));
	}

	return(textCollator.compare(first, second));
}

/**
 * How the table compares rows by each column
 */
const ROW_COMPARERS: Record<UniverseTextSortColumn, (first: UniverseTextRow, second: UniverseTextRow) => number> = {
	place: (first, second) => (((PLACE_ORDER.kinds.get(first.kind) ?? 0) - (PLACE_ORDER.kinds.get(second.kind) ?? 0))
		|| (((first.kind === 'coin') && (second.kind === 'coin')) ? ((PLACE_ORDER.coins.get(first.thingId) ?? 0) - (PLACE_ORDER.coins.get(second.thingId) ?? 0)) : 0)
		|| textCollator.compare(first.thingName, second.thingName)
		|| ((PLACE_ORDER.fields.get(first.field) ?? 0) - (PLACE_ORDER.fields.get(second.field) ?? 0))
		|| idCollator.compare(first.thingId, second.thingId)),
	source: (first, second) => textCollator.compare(first.source, second.source),
	note: (first, second) => compareOptional(first.note, second.note),
	translation: (first, second) => compareOptional(first.translation, second.translation)
};

/**
 * The page of the table a query asks for: the rows that match its search and filters, sorted, then paged
 *
 * @param rows Every piece of the universe's text with its translation and note
 * @param query The search, filters, order and page (parsed, so offset and limit are set)
 * @return The page, and how many rows match
 */
export function pageUniverseText(rows: readonly UniverseTextRow[], query: UniverseTextListQuery & { offset: number; limit: number }): UniverseTextListPayload
{
	const search = query.search?.toLowerCase();
	const filtering = ((query.missing === true) || (query.outOfDate === true));
	const matching = rows.filter((row) =>
	{
		if (filtering && !(((query.missing === true) && (row.translation === null) && !row.noTranslation) || ((query.outOfDate === true) && row.outOfDate)))
		{
			return(false);
		}

		return((search === undefined) || (search === '') || [row.thingName, row.source, row.note, row.translation].some((text) => ((text !== null) && text.toLowerCase().includes(search))));
	});
	const compare = ROW_COMPARERS[query.sort ?? 'place'];
	const sign = ((query.direction === 'descending') ? -1 : 1);

	// Rows the column ties keep their place order, going up whichever way the column goes
	matching.sort((first, second) => ((sign * compare(first, second)) || ROW_COMPARERS.place(first, second)));

	return({
		rows: matching.slice(query.offset, (query.offset + query.limit)),
		total: matching.length
	});
}

/**
 * A translation as saved, with who saved it
 */
interface SavedTranslation
{
	text: string;
	sourceHash: string;
	savedBy: TextSaver | null;
}

/**
 * A note for translators as saved, with who saved it
 */
interface SavedNote
{
	note: string | null;
	savedBy: TextSaver | null;
}

/**
 * What a save's text changes share: the universe's text, its translations and its notes as saved,
 * each loaded the first time one of its changes needs it, rather than a query for each change, and
 * the translations it saves, written together. The changes of another kind can change any of it, so
 * the save forgets it before each of those (settleUniverseText())
 */
interface SaveTextState
{
	/**
	 * The universe's text in the source language, by textKey()
	 */
	text?: Promise<Map<string, UniverseTextSource>>;

	/**
	 * Its translations into each language, by the language as the universe writes its tag, then by textKey()
	 */
	translations: Map<string, Promise<Map<string, SavedTranslation>>>;

	/**
	 * Its notes, by textKey()
	 */
	notes?: Promise<Map<string, SavedNote>>;

	/**
	 * The translations (by translationKey()) and notes (by textKey()) the save has changed, which are
	 * looked up in the database again, since those loaded were loaded before it changed them
	 */
	changedTranslations: Set<string>;
	changedNotes: Set<string>;

	/**
	 * The translations the save adds or replaces and hasn't written yet, by translationKey()
	 */
	unwritten: Map<string, UniverseTranslationRecord & { savedBy: string }>;
}

/**
 * Each save's text changes' state
 */
const saveTextStates = new WeakMap<ChangeContext, SaveTextState>();

/**
 * A save's text changes' state, made the first time a change needs it
 *
 * @param context The save
 * @return The state
 */
function saveTextState(context: ChangeContext): SaveTextState
{
	let state = saveTextStates.get(context);

	if (!state)
	{
		state = {
			translations: new Map(),
			changedTranslations: new Set(),
			changedNotes: new Set(),
			unwritten: new Map()
		};
		saveTextStates.set(context, state);
	}

	return(state);
}

/**
 * The key a translation is found by
 *
 * @param ref The piece of text
 * @param language The translation's language, as the universe writes its tag
 * @return The key
 */
function translationKey(ref: UniverseTextRef, language: string): string
{
	return(`${textKey(ref)}\n${language}`);
}

/**
 * Whether a change saves a translation, a note for translators or a mark that text needs no
 * translation: the changes whose state a save keeps (SaveTextState)
 *
 * @param change The change
 * @return True when it does
 */
export function isUniverseTextChange(change: EditorChange): boolean
{
	return((change.kind === 'saveTranslation') || (change.kind === 'saveTranslatorNote') || (change.kind === 'saveNoTranslation'));
}

/**
 * Writes the translations a save adds or replaces that it hasn't written yet, a statement for many at
 * a time. Call it once the save's other changes are saved, and before any change of another kind,
 * which may change the same translations
 *
 * @param context The save
 */
export async function writeSavedTranslations(context: ChangeContext): Promise<void>
{
	const state = saveTextStates.get(context);

	if (!state || (state.unwritten.size === 0))
	{
		return;
	}

	const translations = [...state.unwritten.values()];

	state.unwritten.clear();
	await saveTranslations(context.version, translations, context.transaction);
}

/**
 * Writes the translations a save hasn't written yet, and forgets the text, translations and notes it
 * loaded, before a change of another kind, which may change them: renaming or deleting what text
 * belongs to, or changing the universe's languages
 *
 * @param context The save
 */
export async function settleUniverseText(context: ChangeContext): Promise<void>
{
	if (saveTextStates.has(context))
	{
		await writeSavedTranslations(context);
		saveTextStates.delete(context);
	}
}

/**
 * A piece of the universe's text, as a save sees it
 *
 * @param context The save
 * @param ref The piece of text
 * @return The text in the source language, or undefined when the universe doesn't have it
 */
async function findText(context: ChangeContext, ref: UniverseTextRef): Promise<UniverseTextSource | undefined>
{
	const state = saveTextState(context);

	state.text ??= collectUniverseText(context.universe, context.version, context.transaction).then((texts) => new Map(texts.map((text) => [textKey(text), text])));

	return((await state.text).get(textKey(ref)));
}

/**
 * A translation as a save sees it
 *
 * @param context The save
 * @param ref The piece of text, by the universe's own ref
 * @param language The translation's language, as the universe writes its tag
 * @return The translation, or undefined when there is none
 */
async function findSavedTranslation(context: ChangeContext, ref: UniverseTextRef, language: string): Promise<SavedTranslation | undefined>
{
	const state = saveTextState(context);
	const key = translationKey(ref, language);

	if (state.unwritten.has(key))
	{
		await writeSavedTranslations(context);
	}

	if (state.changedTranslations.has(key))
	{
		return(findTranslation(context.version, ref, language, context.transaction));
	}

	let loaded = state.translations.get(language);

	if (!loaded)
	{
		loaded = listTranslationsWithSavers(context.version, language, context.transaction).then((rows) => new Map(rows.map((row) => [textKey(row), row])));
		state.translations.set(language, loaded);
	}

	return((await loaded).get(textKey(ref)));
}

/**
 * A note for translators as a save sees it
 *
 * @param context The save
 * @param ref The piece of text, by the universe's own ref
 * @return The note, or undefined when the text has no row of notes
 */
async function findSavedNote(context: ChangeContext, ref: UniverseTextRef): Promise<SavedNote | undefined>
{
	const state = saveTextState(context);

	if (state.changedNotes.has(textKey(ref)))
	{
		return(findTranslatorNote(context.version, ref, context.transaction));
	}

	state.notes ??= listTranslatorNotesWithSavers(context.version, context.transaction).then((rows) => new Map(rows.map((row) => [textKey(row), row])));

	return((await state.notes).get(textKey(ref)));
}

/**
 * One of the languages the universe is translated into, as the universe writes its tag
 *
 * @param context The save
 * @param language The language's tag, in any case
 * @return The tag, or undefined when the universe isn't translated into it
 */
function translationLanguageOf(context: ChangeContext, language: string): string | undefined
{
	return(context.universe.translationLanguages.find((each) => (each.toLowerCase() === language.toLowerCase())));
}

/**
 * A translation or note for translators as saved now, for merging a change to it with what is saved
 */
export interface SavedUniverseText
{
	/**
	 * The piece of text it is on, by the universe's own ref, with the name of what it belongs to
	 */
	place: UniverseTextRef & { thingName: string };

	/**
	 * A translation's language, as the universe writes its tag; null for a note
	 */
	language: string | null;

	/**
	 * The translation or note, or null for none
	 */
	text: string | null;

	/**
	 * The hash of the source text the translation keeps; null for a note, and for no translation
	 */
	sourceHash: string | null;

	savedBy: TextSaver | null;
}

/**
 * The translation or note for translators a change saves, as saved now
 *
 * @param context The save
 * @param change The change
 * @return What is saved; undefined when the universe doesn't have the text or the language, which
 * saving the change then refuses
 */
export async function findSavedText(context: ChangeContext, change: MergedTextChange): Promise<SavedUniverseText | undefined>
{
	const text = await findText(context, change.text);

	if (!text)
	{
		return(undefined);
	}

	const ref: UniverseTextRef = {
		kind: text.kind,
		thingId: text.thingId,
		field: text.field
	};
	const place = { ...ref, thingName: text.thingName };

	if (change.kind === 'saveTranslatorNote')
	{
		const saved = await findSavedNote(context, ref);

		return({
			place,
			language: null,
			text: (saved?.note ?? null),
			sourceHash: null,
			savedBy: (saved?.savedBy ?? null)
		});
	}

	const language = translationLanguageOf(context, change.language);

	if (language === undefined)
	{
		return(undefined);
	}

	const saved = await findSavedTranslation(context, ref, language);

	return({
		place,
		language,
		text: (saved?.text ?? null),
		sourceHash: (saved?.sourceHash ?? null),
		savedBy: (saved?.savedBy ?? null)
	});
}

/**
 * A piece of the universe's text, refusing a change to text the universe doesn't have (such as the name
 * of something deleted, or one of the ruleset's defaults it hasn't renamed)
 *
 * @param context The save
 * @param ref The piece of text
 * @return The text in the source language
 */
async function textOf(context: ChangeContext, ref: UniverseTextRef): Promise<UniverseTextSource>
{
	const text = await findText(context, ref);

	if (!text)
	{
		refuse(404, {
			id: 'error.noSuchUniverseText',
			defaultMessage: 'That text isn\'t the universe\'s any more. Someone may have deleted or renamed what it belongs to.',
			description: 'Why a translation or a note for translators wasn\'t saved: the universe no longer has the text it was for, such as the name of an area someone deleted, or a default item whose name went back to the ruleset\'s'
		});
	}

	return(text);
}

/**
 * Saves a translation of a piece of universe text, or deletes it. The language must be one the universe
 * is translated into. A translation added or replaced is written with the save's others, by
 * writeSavedTranslations()
 *
 * @param context The save
 * @param change The change
 */
export async function saveTranslationChange(context: ChangeContext, change: Extract<EditorChange, { kind: 'saveTranslation' }>): Promise<void>
{
	const language = translationLanguageOf(context, change.language);

	if (language === undefined)
	{
		refuse(409, {
			id: 'error.translationLanguageGone',
			defaultMessage: 'The universe isn\'t translated into that language any more.',
			description: 'Why a translation wasn\'t saved: its language was taken off the languages the universe is translated into, perhaps by another editor'
		});
	}

	const text = await textOf(context, change.text);
	const ref: UniverseTextRef = {
		kind: text.kind,
		thingId: text.thingId,
		field: text.field
	};

	const state = saveTextState(context);
	const key = translationKey(ref, language);

	state.changedTranslations.add(key);

	if (change.translation === null)
	{
		state.unwritten.delete(key);
		await deleteTranslationOf(context.version, ref, language, context.transaction);
		return;
	}

	state.unwritten.set(key, {
		...ref,
		language,
		text: change.translation,
		sourceHash: change.sourceHash,
		savedBy: context.playerId
	});
}

/**
 * Writes the note for translators on a piece of universe text, or deletes it
 *
 * @param context The save
 * @param change The change
 */
export async function saveTranslatorNoteChange(context: ChangeContext, change: Extract<EditorChange, { kind: 'saveTranslatorNote' }>): Promise<void>
{
	const text = await textOf(context, change.text);
	const ref: UniverseTextRef = {
		kind: text.kind,
		thingId: text.thingId,
		field: text.field
	};

	saveTextState(context).changedNotes.add(textKey(ref));

	if (change.note === null)
	{
		await deleteTranslatorNote(context.version, { ...ref, savedBy: context.playerId }, context.transaction);
		return;
	}

	await saveTranslatorNote(context.version, { ...ref, note: change.note, savedBy: context.playerId }, context.transaction);
}

/**
 * Marks a piece of universe text as needing no translation, or as needing one again
 *
 * @param context The save
 * @param change The change
 */
export async function saveNoTranslationChange(context: ChangeContext, change: Extract<EditorChange, { kind: 'saveNoTranslation' }>): Promise<void>
{
	const text = await textOf(context, change.text);
	const ref: UniverseTextRef = {
		kind: text.kind,
		thingId: text.thingId,
		field: text.field
	};

	// Marking text can add or delete its row of notes
	saveTextState(context).changedNotes.add(textKey(ref));
	await setNoTranslation(context.version, ref, change.noTranslation, context.transaction);
}
