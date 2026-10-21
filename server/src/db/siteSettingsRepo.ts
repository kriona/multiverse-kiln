/**
 * Settings for the whole site: the only module that reads or writes the site_settings table
 */
import { DEFAULT_SITE_SETTINGS, type SiteSettings } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { siteSettings } from './schema.js';

/**
 * The site's settings
 *
 * @param executor The database, or a transaction
 * @return Its settings, or DEFAULT_SITE_SETTINGS when it has never saved any
 */
export async function findSiteSettings(executor: Executor = db): Promise<SiteSettings>
{
	const [row] = await executor
		.select({
			universeCreationEnabled: siteSettings.universeCreationEnabled,
			universesPerCreator: siteSettings.universesPerCreator,
			characterDeletionDays: siteSettings.characterDeletionDays
		})
		.from(siteSettings)
		.limit(1);

	return((row ?? { ...DEFAULT_SITE_SETTINGS }));
}

/**
 * Stores the site's settings, replacing any it had
 *
 * @param settings The settings
 * @param executor The database, or a transaction
 */
export async function saveSiteSettings(settings: SiteSettings, executor: Executor = db): Promise<void>
{
	await executor
		.insert(siteSettings)
		.values(settings)
		.onConflictDoUpdate({
			target: siteSettings.id,
			set: settings
		});
}
