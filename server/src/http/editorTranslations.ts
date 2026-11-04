/**
 * The editor's Translations tab (see Tab: Translations in STRUCTURE-OVERVIEW.md): every piece of the
 * universe's text with its translation into one language and its note for translators, and the changes
 * that save translations and notes
 *
 * The text comes from the universe and the things it holds, as the editor's lists load them, so one of
 * the ruleset's defaults the universe hasn't renamed is engine text and isn't listed
 */
import type express from 'express';
import type { Request, Response } from 'express';
import { canEditWorld, canTranslate, isTranslationOutOfDate, rulesetHasThemes, sortRows, sourceTextHash, UNIVERSE_TEXT_FIELDS, UNIVERSE_TEXT_KINDS, type EditableUniverseDetails, type EditorChange, type UniverseTextKind, type UniverseTextListPayload, type UniverseTextListQuery, type UniverseTextRef, type UniverseTextRow, type UniverseTextSortColumn } from '@multiverse-kiln/shared';

import { listAreas } from '../db/areaRepo.js';
import { loadEditorClasses } from '../db/classRepo.js';
import type { Executor } from '../db/client.js';
import { listDifficultyLevels } from '../db/difficultyRepo.js';
import { loadEditorItems } from '../db/itemRepo.js';
import { loadEditorRaces } from '../db/raceRepo.js';
import { loadEditorThemes } from '../db/themeRepo.js';
import { loadEditorTiles } from '../db/tileRepo.js';
import { deleteTranslationOf, deleteTranslatorNote, listTranslations, listTranslatorNotes, saveTranslation, saveTranslatorNote, setNoTranslation } from '../db/universeTextRepo.js';
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
 * Something with a name, or one of the ruleset's defaults without one of its own
 */
interface Named
{
	id: number | string;
	name: string | null;
}

/**
 * The names of things of one kind as universe text, leaving out defaults the universe hasn't renamed
 *
 * @param kind What they are
 * @param things The things
 * @return Their names
 */
function namesOf(kind: UniverseTextKind, things: readonly Named[]): UniverseTextSource[]
{
	return(things.flatMap(({ id, name }) => ((name === null)
		? []
		: [{
			kind,
			thingId: String(id),
			field: 'name' as const,
			thingName: name,
			source: name
		}])));
}

/**
 * Every piece of a universe's text in its source language, leaving out descriptions it hasn't written,
 * in the order of UNIVERSE_TEXT_KINDS
 *
 * @param universe The universe
 * @param executor The database, or a transaction
 * @return The text
 */
async function collectUniverseText(universe: EditableUniverseDetails, executor?: Executor): Promise<UniverseTextSource[]>
{
	const { id, ruleset } = universe;

	// One after another, since a transaction runs one query at a time
	const areas = await listAreas(id, executor);
	const tiles = await loadEditorTiles(id, ruleset, executor);
	const items = await loadEditorItems(id, ruleset, executor);
	const races = await loadEditorRaces(id, ruleset, executor);
	const classes = await loadEditorClasses(id, ruleset, executor);
	const themes = (rulesetHasThemes(ruleset) ? await loadEditorThemes(id, ruleset, executor) : []);
	const difficultyLevels = await listDifficultyLevels(id, executor);
	const universeText = UNIVERSE_TEXT_FIELDS
		.map((field): UniverseTextSource => ({
			kind: 'universe',
			thingId: id,
			field,
			thingName: universe.name,
			source: universe[field]
		}))
		.filter((text) => (text.source !== ''));

	return([
		...universeText,
		...namesOf('area', areas),
		...namesOf('tile', tiles),
		...namesOf('item', items),
		...namesOf('race', races),
		...namesOf('class', classes),
		...namesOf('theme', themes),
		...namesOf('difficultyLevel', difficultyLevels)
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
	const { universe, role, languages } = universeContextOf(request);
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
		collectUniverseText(universe),
		listTranslations(universe.id, [language]),
		listTranslatorNotes(universe.id)
	]);
	const translationsByKey = new Map(translations.map((translation) => [textKey(translation), translation]));
	const notesByKey = new Map(notes.map((note) => [textKey(note), note]));
	return(sources.map((text): UniverseTextRow =>
	{
		const translation = translationsByKey.get(textKey(text));
		const note = notesByKey.get(textKey(text));
		const noTranslation = (note?.noTranslation ?? false);

		return({
			...text,
			sourceHash: sourceTextHash(text.source),
			note: (note?.note ?? null),
			noTranslation,
			translation: (translation?.text ?? null),
			outOfDate: (!noTranslation && (translation !== undefined) && isTranslationOutOfDate(translation.sourceHash, text.source))
		});
	}));
}

/**
 * Where a piece of text comes in the table's default order: by kind, then the name of what it belongs
 * to, then by field
 */
const PLACE_ORDER = {
	kinds: new Map(UNIVERSE_TEXT_KINDS.map((kind, index) => [kind, index])),
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

	return(first.localeCompare(second));
}

/**
 * How the table compares rows by each column
 */
const ROW_COMPARERS: Record<UniverseTextSortColumn, (first: UniverseTextRow, second: UniverseTextRow) => number> = {
	place: (first, second) => (((PLACE_ORDER.kinds.get(first.kind) ?? 0) - (PLACE_ORDER.kinds.get(second.kind) ?? 0))
		|| first.thingName.localeCompare(second.thingName)
		|| ((PLACE_ORDER.fields.get(first.field) ?? 0) - (PLACE_ORDER.fields.get(second.field) ?? 0))),
	source: (first, second) => first.source.localeCompare(second.source),
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
	const byPlace = sortRows(matching, ROW_COMPARERS, { column: 'place', direction: 'ascending' });
	const sorted = sortRows(byPlace, ROW_COMPARERS, {
		column: (query.sort ?? 'place'),
		direction: (query.direction ?? 'ascending')
	});

	return({
		rows: sorted.slice(query.offset, (query.offset + query.limit)),
		total: sorted.length
	});
}

/**
 * The universe's text as a save sees it, loaded the first time one of its changes needs it. The
 * Translations tab saves after the other tabs, so the text is as their changes left it
 */
const savedText = new WeakMap<ChangeContext, Promise<Map<string, UniverseTextSource>>>();

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
	let loaded = savedText.get(context);

	if (!loaded)
	{
		loaded = collectUniverseText(context.universe, context.transaction).then((texts) => new Map(texts.map((text) => [textKey(text), text])));
		savedText.set(context, loaded);
	}

	const text = (await loaded).get(textKey(ref));

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
 * is translated into
 *
 * @param context The save
 * @param change The change
 */
export async function saveTranslationChange(context: ChangeContext, change: Extract<EditorChange, { kind: 'saveTranslation' }>): Promise<void>
{
	const language = context.universe.translationLanguages.find((each) => (each.toLowerCase() === change.language.toLowerCase()));

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

	if (change.translation === null)
	{
		await deleteTranslationOf(context.universe.id, ref, language, context.transaction);
		return;
	}

	await saveTranslation(context.universe.id, {
		...ref,
		language,
		text: change.translation,
		sourceHash: change.sourceHash
	}, context.transaction);
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

	if (change.note === null)
	{
		await deleteTranslatorNote(context.universe.id, ref, context.transaction);
		return;
	}

	await saveTranslatorNote(context.universe.id, { ...ref, note: change.note }, context.transaction);
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

	await setNoTranslation(context.universe.id, {
		kind: text.kind,
		thingId: text.thingId,
		field: text.field
	}, change.noTranslation, context.transaction);
}
