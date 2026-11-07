/**
 * What the editor's Translations tab and the admin page's Translations tool share about translation
 * files (shared/src/translationFiles.ts): the formats' names, why a file can't be imported, and saving
 * one to the browser's downloads
 */
import { defineMessages, MAX_TRANSLATION_FILE_BYTES, TranslationFileError, type MessageDescriptor, type TranslationFileFormat } from '@multiverse-kiln/shared';

import { t } from '../localization';

/**
 * Each translation file format's name, in the format choices of the editor's Translations tab and the
 * admin page's Translations tool, and in messages about files
 */
export const FILE_FORMAT_NAMES: Record<TranslationFileFormat, MessageDescriptor> = defineMessages({
	po: {
		id: 'editor.translations.format.po',
		defaultMessage: 'Gettext PO (.po)',
		description: 'A translation file format, in the format choice on the editor\'s Translations tab and on the admin page\'s Translations tool: Gettext PO, which translation tools such as Poedit and Weblate open. Gettext PO is a name'
	},
	xliff: {
		id: 'editor.translations.format.xliff',
		defaultMessage: 'XLIFF 2.0 (.xlf)',
		description: 'A translation file format, in the format choice on the editor\'s Translations tab and on the admin page\'s Translations tool: XLIFF 2.0, the standard professional translation tools exchange. XLIFF is a name'
	},
	csv: {
		id: 'editor.translations.format.csv',
		defaultMessage: 'CSV, for spreadsheets (.csv)',
		description: 'A translation file format, in the format choice on the editor\'s Translations tab and on the admin page\'s Translations tool: comma-separated values, which spreadsheets open'
	},
	json: {
		id: 'editor.translations.format.json',
		defaultMessage: 'JSON (.json)',
		description: 'A translation file format, in the format choice on the editor\'s Translations tab and on the admin page\'s Translations tool: JSON, for scripts. JSON is a name'
	}
});

/**
 * Says a file chosen to import is larger than any translation file could be (MAX_TRANSLATION_FILE_BYTES)
 *
 * @return The message
 */
export function describeTooLarge(): string
{
	return(t({
		id: 'editor.translations.importTooLarge',
		defaultMessage: 'This file is too large for a translation file: translation files are at most {megabytes, number} MB.',
		description: 'Shown on the editor\'s Translations tab and on the admin page\'s Translations tool when the file chosen to import is larger than any translation file could be, so it is probably the wrong file; {megabytes} is the largest size allowed'
	}, {
		megabytes: MAX_TRANSLATION_FILE_BYTES / (1024 * 1024)
	}));
}

/**
 * Why a translation file couldn't be read
 *
 * @param error What reading it threw
 * @param format The format it was read as
 * @return The message
 */
export function describeUnreadable(error: unknown, format: TranslationFileFormat): string
{
	const formatName = t(FILE_FORMAT_NAMES[format]);

	if (!(error instanceof TranslationFileError))
	{
		console.error('Could not read the translation file:', error);
	}

	if ((error instanceof TranslationFileError) && (error.line !== null))
	{
		return(t({
			id: 'editor.translations.unreadableLine',
			defaultMessage: 'This file can\'t be read as {format}: see line {line, number}.',
			description: 'Shown on the editor\'s Translations tab and on the admin page\'s Translations tool when an imported translation file isn\'t in the format its name says (or the format chosen); {format} is the format\'s name, such as Gettext PO, and {line} the line with the problem'
		}, {
			format: formatName,
			line: error.line
		}));
	}

	return(t({
		id: 'editor.translations.unreadable',
		defaultMessage: 'This file can\'t be read as {format}.',
		description: 'Shown on the editor\'s Translations tab and on the admin page\'s Translations tool when an imported translation file isn\'t in the format its name says (or the format chosen); {format} is the format\'s name, such as Gettext PO'
	}, {
		format: formatName
	}));
}

/**
 * Says an imported translation file names another language than the one chosen
 *
 * @param fileLanguage The language's name the file names
 * @param language The chosen language's name
 * @return The message
 */
export function describeWrongLanguage(fileLanguage: string, language: string): string
{
	return(t({
		id: 'editor.translations.importWrongLanguage',
		defaultMessage: 'This file holds translations into {fileLanguage}, not {language}. Choose {fileLanguage} to import it.',
		description: 'Shown on the editor\'s Translations tab and on the admin page\'s Translations tool when the translation file imported names a language other than the one chosen; {fileLanguage} and {language} are languages\' names'
	}, {
		fileLanguage,
		language
	}));
}

/**
 * Saves text as a file in the browser's downloads
 *
 * @param text The file's text
 * @param type Its media type
 * @param fileName Its name
 */
export function downloadText(text: string, type: string, fileName: string): void
{
	const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
	const link = document.createElement('a');

	link.href = url;
	link.download = fileName;
	link.click();
	URL.revokeObjectURL(url);
}
