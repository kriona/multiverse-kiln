/**
 * Writes shared/locales/en.json from the messages in the code and pages (see extractMessages.ts)
 *
 * Usage: npm run messages (writes the catalog), or npm run messages:check -w shared (fails when the
 * catalog isn't current or a message has a problem). The client's dev server keeps the catalog
 * current by itself while it runs
 */
import fs from 'fs';
import path from 'path';

import { CATALOG_FILE, catalogText, extractMessages, writeCatalog } from './extractMessages.js';

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
}

main();
