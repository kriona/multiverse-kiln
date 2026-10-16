/**
 * Writes shared/locales/en.json from the messages in the code and pages (see extractMessages.ts), and
 * reports which messages each translation is missing or has out of date
 *
 * Usage:
 * - npm run messages: writes the catalog and reports each translation's missing and out-of-date messages
 * - npm run messages:check -w shared: fails when the catalog isn't current or a message has a problem,
 *   and warns about translations that are missing messages or out of date
 * - npm run --silent messages -w shared -- --missing <locale>: prints the messages a translation is
 *   missing or has out of date as JSON, for the translate skill (.agents/skills/translate/SKILL.md).
 *   --silent keeps npm's own lines out of the JSON
 *
 * The client's dev server keeps the catalog current by itself while it runs. A translation that is
 * missing messages or out of date never fails: players see those messages in English, or as they
 * were, until it is updated
 */
import fs from 'fs';
import path from 'path';
import { translationStatus, type TranslationFile } from '@multiverse-kiln/shared';

import { CATALOG_FILE, catalogText, extractMessages, readTranslations, writeCatalog, type CatalogEntry } from './extractMessages.js';

/**
 * The repository's root folder
 */
const ROOT = path.resolve(import.meta.dirname, '..', '..');

/**
 * A message a translation is missing or has out of date, as --missing prints it
 */
interface MissingMessage
{
	message: string;
	description: string;
	translation?: string;
	translatedFrom?: string;
}

/**
 * Extracts the messages, and writes or checks the catalog, or prints what a translation needs
 */
function main(): void
{
	const check = process.argv.includes('--check');
	const missingIndex = process.argv.indexOf('--missing');
	const { catalog, problems } = extractMessages(ROOT);

	if (problems.length > 0)
	{
		console.error(`Problems with the messages:\n${problems.map((problem) => `  ${problem}`).join('\n')}`);
		process.exitCode = 1;
		return;
	}

	if (missingIndex !== -1)
	{
		printMissing(catalog, process.argv[missingIndex + 1]);
		return;
	}

	const text = catalogText(catalog);

	if (check)
	{
		const catalogPath = path.join(ROOT, CATALOG_FILE);

		if (!fs.existsSync(catalogPath) || (fs.readFileSync(catalogPath, 'utf8') !== text))
		{
			console.error(`${CATALOG_FILE} isn't current. Run npm run messages to update it`);
			process.exitCode = 1;
		}

		reportTranslations(catalog, true);
		return;
	}

	if (writeCatalog(ROOT, CATALOG_FILE, text))
	{
		console.log(`Wrote ${Object.keys(catalog).length} messages to ${CATALOG_FILE}`);
	}

	reportTranslations(catalog, false);
}

/**
 * Lists each translation's missing and out-of-date messages
 *
 * @param catalog The English catalog
 * @param warn Whether to report only the translations that need updating, as warnings
 */
function reportTranslations(catalog: Record<string, CatalogEntry>, warn: boolean): void
{
	const report = (warn ? console.warn : console.log);

	for (const [locale, file] of readTranslations(ROOT))
	{
		const { missing, outdated } = translationStatus(catalog, file);

		if ((missing.length === 0) && (outdated.length === 0))
		{
			if (!warn)
			{
				console.log(`${locale}: every message translated and current`);
			}

			continue;
		}

		report(`${(warn ? 'Warning: ' : '')}${locale}: ${missing.length} missing, ${outdated.length} out of date`);

		if (missing.length > 0)
		{
			report(`  missing: ${missing.join(', ')}`);
		}

		if (outdated.length > 0)
		{
			report(`  out of date: ${outdated.join(', ')}`);
		}

		report(`  Players see these in English, or as they were, until the translation is updated (see .agents/skills/translate/SKILL.md)`);
	}
}

/**
 * Prints the messages a translation is missing or has out of date as JSON, by ID: each with its English
 * and description, and for one out of date, its translation and the English it was made from
 *
 * @param catalog The English catalog
 * @param locale The translation's language tag, e.g. en-x-pirate
 */
function printMissing(catalog: Record<string, CatalogEntry>, locale: string | undefined): void
{
	const translations = readTranslations(ROOT);
	const file: TranslationFile | undefined = ((locale === undefined) ? undefined : translations.get(locale));

	if (file === undefined)
	{
		console.error(`Usage: npm run --silent messages -w shared -- --missing <locale>, where <locale> is one of: ${[...translations.keys()].join(', ')}`);
		process.exitCode = 1;
		return;
	}

	const { missing, outdated } = translationStatus(catalog, file);
	const needed: Record<string, MissingMessage> = {};

	for (const id of [...missing, ...outdated].sort())
	{
		const entry: MissingMessage = {
			message: catalog[id].defaultMessage,
			description: catalog[id].description
		};
		const translated = file[id];

		if (translated !== undefined)
		{
			entry.translation = translated.message;
			entry.translatedFrom = translated.source;
		}

		needed[id] = entry;
	}

	console.log(JSON.stringify(needed, null, '\t'));
}

main();
