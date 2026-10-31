/**
 * Translators for emails, in each recipient's language, from the translation files in shared/locales
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { matchLocale, SOURCE_LOCALE, translationCatalog, Translator, type TranslationFile } from '@multiverse-kiln/shared';

/**
 * The shared package's locales folder: next to its built code (dist/index.js)
 */
const LOCALES_FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@multiverse-kiln/shared'))), '../locales');

/**
 * The English catalog, which translators work from rather than a translation
 */
const CATALOG_FILE = `${SOURCE_LOCALE}.json`;

let translators: Map<string, Translator> | undefined;

/**
 * Loads every language's translations the first time they are needed. The pseudo-language's file is
 * only there while developing
 *
 * @return A translator for each language, by its tag, including English
 */
function loadTranslators(): Map<string, Translator>
{
	if (!translators)
	{
		translators = new Map([[SOURCE_LOCALE, new Translator(SOURCE_LOCALE)]]);

		for (const fileName of fs.readdirSync(LOCALES_FOLDER))
		{
			if (fileName.endsWith('.json') && (fileName !== CATALOG_FILE))
			{
				const locale = path.basename(fileName, '.json');
				const file = JSON.parse(fs.readFileSync(path.join(LOCALES_FOLDER, fileName), 'utf8')) as TranslationFile;

				translators.set(locale, new Translator(locale, translationCatalog(file)));
			}
		}
	}

	return(translators);
}

/**
 * The translator for the language an email's recipient reads
 *
 * @param locale The language they asked for, such as the page's language when they made the request
 * @return The translator for the closest language there is, or English
 */
export function emailTranslator(locale: string): Translator
{
	const available = loadTranslators();
	const matched = matchLocale([locale], [...available.keys()]);

	return((available.get(matched) ?? new Translator(SOURCE_LOCALE)));
}
