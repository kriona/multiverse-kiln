/**
 * The engine's text in translation files (see Translations under Admin in STRUCTURE-OVERVIEW.md): the
 * English messages (shared/locales/en.json) written as a translation file for translators, with what a
 * language has translated so far, and a file they translated read back into that language's file in
 * shared/locales, the form the repository commits it in
 */
import { SITE_NAME } from './constants.js';
import { messageArguments, PSEUDO_LOCALE, SOURCE_LOCALE, translationStatus, type Translation, type TranslationFile, type TranslationStatus } from './localization.js';
import type { ReadTranslationFile, TranslationFileContents } from './translationFiles.js';

/**
 * One English message as shared/locales/en.json holds it
 */
export interface EngineMessage
{
	defaultMessage: string;

	/**
	 * What the message is and where it appears, for translators
	 */
	description: string;
}

/**
 * The English messages by ID, as in shared/locales/en.json
 */
export type EngineCatalog = Readonly<Record<string, EngineMessage>>;

/**
 * Why a translation read from a file was left out of the language's file
 *
 * - unknown: the English has no message with its ID
 * - needsReview: the file marks it as still needing review (a PO file's fuzzy flag)
 * - unreadable: it isn't ICU MessageFormat
 * - arguments: its arguments or tags differ from the English's
 */
export type SkippedTranslationReason = 'unknown' | 'needsReview' | 'unreadable' | 'arguments';

/**
 * A translation read from a file and left out of the language's file
 */
export interface SkippedTranslation
{
	/**
	 * The message's ID, as the file has it
	 */
	id: string;

	reason: SkippedTranslationReason;
}

/**
 * A language's file made from a translation file
 */
export interface LanguageFileImport
{
	file: TranslationFile;

	/**
	 * How many translations the file added or changed
	 */
	imported: number;

	skipped: SkippedTranslation[];

	/**
	 * How many of the language's translations were left out because the English no longer has their message
	 */
	removed: number;

	/**
	 * Which messages the language's file is missing, and which of its translations are out of date
	 */
	status: TranslationStatus;
}

/**
 * Whether the engine's text can be translated into a language: any but English, which it is written in,
 * and the pseudo-language, which is made from the English
 *
 * @param language The language tag
 * @return True when it can
 */
export function isEngineTranslationLanguage(language: string): boolean
{
	const lower = language.toLowerCase();

	return((lower !== SOURCE_LOCALE.toLowerCase()) && (lower !== PSEUDO_LOCALE.toLowerCase()));
}

/**
 * The name of a language's file in shared/locales
 *
 * @param language The language tag, in its canonical form
 * @return The file's name, e.g. de.json
 */
export function languageFileName(language: string): string
{
	return(`${language}.json`);
}

/**
 * A language's translation of a message, when it has one
 *
 * @param file The language's file
 * @param id The message's ID
 * @return The translation, or undefined for none
 */
function translationOf(file: TranslationFile | undefined, id: string): Translation | undefined
{
	return((((file !== undefined) && Object.hasOwn(file, id)) ? file[id] : undefined));
}

/**
 * Every English message as a translation file into a language: each named by its ID, with its
 * description as the note for translators and the language's translation of it, when there is one
 *
 * @param catalog The English messages
 * @param language The language tag
 * @param existing The language's file, or undefined when it has none yet
 * @return What the file holds, by message ID
 */
export function engineTranslationContents(catalog: EngineCatalog, language: string, existing: TranslationFile | undefined): TranslationFileContents
{
	return({
		title: SITE_NAME,
		sourceLanguage: SOURCE_LOCALE,
		language,
		entries: Object.keys(catalog)
			.sort()
			.map((id) =>
			{
				const english = catalog[id];
				const translation = translationOf(existing, id);

				return({
					id,
					place: null,
					note: english.description,
					source: english.defaultMessage,
					translation: (translation?.message ?? null),
					outOfDate: ((translation !== undefined) && (translation.source !== english.defaultMessage))
				});
			})
	});
}

/**
 * Why a translation of a message can't be used, the way the tests check committed translations
 * (catalogProblems())
 *
 * @param english The English message
 * @param translation The translation
 * @return The reason, or undefined when it can be used
 */
function translationProblem(english: string, translation: string): SkippedTranslationReason | undefined
{
	let names: string[];

	try
	{
		names = messageArguments(translation);
	}
	catch
	{
		return('unreadable');
	}

	return(((names.join(',') === messageArguments(english).join(',')) ? undefined : 'arguments'));
}

/**
 * A language's file with the translations read from a translation file. It starts from the language's
 * file as it is, less translations of messages the English no longer has. Each translation read keeps
 * the source text the file holds, or the English as it is when the file doesn't hold it, so one made
 * from English that has changed since is out of date; one that comes back as the language has it is
 * left as it is, so one out of date stays out of date. Translations the file marks as needing review,
 * of messages the English doesn't have, that aren't ICU MessageFormat or whose arguments differ from
 * the English's are skipped
 *
 * @param catalog The English messages
 * @param read What was read from the translation file
 * @param existing The language's file, or undefined when it has none yet
 * @return The language's file, its entries sorted by ID, and what changed
 */
export function importLanguageFile(catalog: EngineCatalog, read: ReadTranslationFile, existing: TranslationFile | undefined): LanguageFileImport
{
	const translations = new Map<string, Translation>();
	const skipped: SkippedTranslation[] = [];
	let removed = 0;
	let imported = 0;

	for (const [id, translation] of Object.entries(existing ?? {}))
	{
		if (Object.hasOwn(catalog, id))
		{
			translations.set(id, translation);
		}
		else
		{
			removed++;
		}
	}

	for (const entry of read.translations)
	{
		if (entry.translation === null)
		{
			continue;
		}

		if (!Object.hasOwn(catalog, entry.id))
		{
			skipped.push({
				id: entry.id,
				reason: 'unknown'
			});
			continue;
		}

		const english = catalog[entry.id];
		const reason = (entry.needsReview ? 'needsReview' : translationProblem(english.defaultMessage, entry.translation));

		if (reason !== undefined)
		{
			skipped.push({
				id: entry.id,
				reason
			});
			continue;
		}

		if (translations.get(entry.id)?.message === entry.translation)
		{
			continue;
		}

		translations.set(entry.id, {
			message: entry.translation,
			source: (entry.source ?? english.defaultMessage)
		});
		imported++;
	}

	// Sorted by UTF-16 code units, as the English catalog is
	const file: TranslationFile = Object.fromEntries([...translations].sort(([first], [second]) => ((first < second) ? -1 : 1)));

	return({
		file,
		imported,
		skipped,
		removed,
		status: translationStatus(catalog, file)
	});
}

/**
 * A language's file as shared/locales holds it: JSON indented with tabs, with Windows line endings like
 * the rest of the repository (as catalogText() in shared/scripts/extractMessages.ts writes the catalogs)
 *
 * @param file The language's file
 * @return The file's text
 */
export function languageFileText(file: TranslationFile): string
{
	return(`${JSON.stringify(file, null, '\t').replaceAll('\n', '\r\n')}\r\n`);
}
