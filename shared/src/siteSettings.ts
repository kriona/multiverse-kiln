/**
 * Settings for the whole site, changed on the admin page (client/admin.html)
 *
 * - GET SITE_SETTINGS_PATH answers SiteSettings
 * - PUT SITE_SETTINGS_PATH takes SiteSettings, and answers 204, or 400 with an ErrorPayload for
 *   settings that fail validation
 *
 * Anyone can read and change them until there are server admin accounts. Writes from a browser must
 * come from an origin in the server's ALLOWED_ORIGINS
 */
export const SITE_SETTINGS_PATH = '/admin/settings';

/**
 * Fewest universes the site can let each player create
 */
export const MIN_UNIVERSES_PER_CREATOR = 1;

/**
 * Most universes the site can let each player create
 */
export const MAX_UNIVERSES_PER_CREATOR = 1000;

/**
 * Most days the site can wait after a character's last rites before deleting them
 */
export const MAX_CHARACTER_DELETION_DAYS = 365;

/**
 * Settings for the whole site
 */
export interface SiteSettings
{
	/**
	 * Whether players can create universes. Universes that already exist are unaffected
	 */
	universeCreationEnabled: boolean;

	/**
	 * Most universes one player may create, from MIN_UNIVERSES_PER_CREATOR to MAX_UNIVERSES_PER_CREATOR
	 */
	universesPerCreator: number;

	/**
	 * How many days after their last rites a character is deleted, from 0 to MAX_CHARACTER_DELETION_DAYS.
	 * 0 turns last rites off, so characters can only be deleted. Characters already given
	 * their last rites keep the day they were given
	 */
	characterDeletionDays: number;
}

/**
 * The settings of a site that has never saved any
 */
export const DEFAULT_SITE_SETTINGS: Readonly<SiteSettings> = {
	universeCreationEnabled: true,
	universesPerCreator: 5,
	characterDeletionDays: 7
};
