/**
 * Settings for the whole site: the only module that reads or writes the site_settings table
 */
import { sql } from 'drizzle-orm';
import { DEFAULT_SITE_SETTINGS, type SiteSettings } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { siteSettings } from './schema.js';

/**
 * The transaction-level advisory lock that makes saves of the site's settings take turns (see
 * lockSiteSettings()). Any number no other lock uses
 */
const SITE_SETTINGS_LOCK = 2_604_583;

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
		areasPerUniverse: row.areasPerUniverse,
		charactersPerUniverse: row.charactersPerUniverse,
		characterDeletionDays: row.characterDeletionDays,
		botCheckEveryRequest: row.botCheckEveryRequest,
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
 * Makes transactions that save the site's settings wait for each other until the transaction ends, then
 * reads the settings, so each save sees what the one before it saved. An advisory lock rather than a lock
 * on the row, which doesn't exist until the settings are first saved
 *
 * @param executor One of the admin role's transactions (inAdminTransaction())
 * @return Its settings, as findSiteSettings() reads them
 */
export async function lockSiteSettings(executor: Executor): Promise<SiteSettings>
{
	await executor.execute(sql`SELECT pg_advisory_xact_lock(${SITE_SETTINGS_LOCK})`);

	return(await findSiteSettings(executor));
}

/**
 * Stores the site's settings, replacing any it had
 *
 * @param settings The settings
 * @param executor The admin role's database or one of its transactions (adminDb, inAdminTransaction()):
 * the server's own role can't write site_settings
 */
export async function saveSiteSettings(settings: SiteSettings, executor: Executor): Promise<void>
{
	const values = {
		universeCreationEnabled: settings.universeCreationEnabled,
		universesPerCreator: settings.universesPerCreator,
		areasPerUniverse: settings.areasPerUniverse,
		charactersPerUniverse: settings.charactersPerUniverse,
		characterDeletionDays: settings.characterDeletionDays,
		botCheckEveryRequest: settings.botCheckEveryRequest,
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
