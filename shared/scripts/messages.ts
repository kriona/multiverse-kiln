/**
 * Writes shared/locales/en.json from the messages in the code and pages (see extractMessages.ts), and
 * reports which messages each translation is missing or has out of date
 *
 * Usage: npm run messages (writes the catalog and reports), or npm run messages:check -w shared (fails
 * when the catalog isn't current or a message has a problem). The client's dev server keeps the
 * catalog current by itself while it runs. A translation that is missing messages or out of date
 * doesn't fail either: players see those messages in English, or as they were, until it is updated
 */
import fs from 'fs';
import path from 'path';
import { translationStatus } from '@multiverse-kiln/shared';

import { CATALOG_FILE, catalogText, extractMessages, readTranslations, writeCatalog, type CatalogEntry } from './extractMessages.js';

/**
 * The repository's root folder
 */
const ROOT = path.resolve(import.meta.dirname, '..', '..');

/**
 * Extracts the messages, and writes or checks the catalog
 */
function main(): void
{
	const check = process.argv.includes('--check');
	const { catalog, problems } = extractMessages(ROOT);

	if (problems.length > 0)
	{
		console.error(`Problems with the messages:\n${problems.map((problem) => `  ${problem}`).join('\n')}`);
		process.exitCode = 1;
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

		return;
	}

	if (writeCatalog(ROOT, CATALOG_FILE, text))
	{
		console.log(`Wrote ${Object.keys(catalog).length} messages to ${CATALOG_FILE}`);
	}

	reportTranslations(catalog);
}

/**
 * Lists each translation's missing and out-of-date messages
 *
 * @param catalog The English catalog
 */
function reportTranslations(catalog: Record<string, CatalogEntry>): void
{
	for (const [locale, file] of readTranslations(ROOT))
	{
		const { missing, outdated } = translationStatus(catalog, file);

		if ((missing.length === 0) && (outdated.length === 0))
		{
			console.log(`${locale}: every message translated and current`);
			continue;
		}

		console.log(`${locale}: ${missing.length} missing, ${outdated.length} out of date`);

		if (missing.length > 0)
		{
			console.log(`  missing: ${missing.join(', ')}`);
		}

		if (outdated.length > 0)
		{
			console.log(`  out of date: ${outdated.join(', ')}`);
		}
	}
}

main();
