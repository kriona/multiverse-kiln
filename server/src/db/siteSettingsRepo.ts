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
		.select()
		.from(siteSettings)
		.limit(1);

	if (row === undefined)
	{
		return({
			...DEFAULT_SITE_SETTINGS,
			socials: { ...DEFAULT_SITE_SETTINGS.socials }
		});
	}

	return({
		universeCreationEnabled: row.universeCreationEnabled,
		universesPerCreator: row.universesPerCreator,
		characterDeletionDays: row.characterDeletionDays,
		socials: {
			discord: row.discordUrl,
			facebook: row.facebookUrl,
			instagram: row.instagramUrl,
			tiktok: row.tiktokUrl,
			x: row.xUrl,
			youtube: row.youtubeUrl
		},
		privacyContact: row.privacyContact
	});
}

/**
 * Stores the site's settings, replacing any it had
 *
 * @param settings The settings
 * @param executor The database, or a transaction
 */
export async function saveSiteSettings(settings: SiteSettings, executor: Executor = db): Promise<void>
{
	const values = {
		universeCreationEnabled: settings.universeCreationEnabled,
		universesPerCreator: settings.universesPerCreator,
		characterDeletionDays: settings.characterDeletionDays,
		discordUrl: settings.socials.discord,
		facebookUrl: settings.socials.facebook,
		instagramUrl: settings.socials.instagram,
		tiktokUrl: settings.socials.tiktok,
		xUrl: settings.socials.x,
		youtubeUrl: settings.socials.youtube,
		privacyContact: settings.privacyContact
	};

	await executor
		.insert(siteSettings)
		.values(values)
		.onConflictDoUpdate({
			target: siteSettings.id,
			set: values
		});
}
