import { MAX_EMAIL_LENGTH } from './accounts.js';
import { ADMIN_PATH } from './admin.js';

/**
 * Settings for the whole site, changed on the admin settings page (client/admin/settings.html)
 *
 * - GET SITE_SETTINGS_PATH answers SiteSettings
 * - PUT SITE_SETTINGS_PATH takes SiteSettings, and answers 204, or 400 with an ErrorPayload for
 *   settings that fail validation
 * - GET PUBLIC_SITE_SETTINGS_PATH answers PublicSiteSettings, to anyone
 *
 * Only server admins with 2FA on can use SITE_SETTINGS_PATH (see shared/src/admin.ts). Writes from a
 * browser must come from an origin in the server's ALLOWED_ORIGINS
 */
export const SITE_SETTINGS_PATH = `${ADMIN_PATH}/settings`;

/**
 * The settings every page may read, such as the footer's social links and the privacy policy's contact
 */
export const PUBLIC_SITE_SETTINGS_PATH = '/site-settings';

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
 * The social sites the footer can link to the site's own pages on
 */
export const SITE_SOCIAL_SITES = ['discord', 'facebook', 'instagram', 'tiktok', 'x', 'youtube'] as const;

export type SiteSocialSite = (typeof SITE_SOCIAL_SITES)[number];

/**
 * The hosts a link to each social site may name, so a link always goes to the site it says
 */
export const SITE_SOCIAL_HOSTS: Readonly<Record<SiteSocialSite, readonly string[]>> = {
	discord: ['discord.gg', 'discord.com', 'www.discord.com'],
	facebook: ['facebook.com', 'www.facebook.com'],
	instagram: ['instagram.com', 'www.instagram.com'],
	tiktok: ['tiktok.com', 'www.tiktok.com'],
	x: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'],
	youtube: ['youtube.com', 'www.youtube.com', 'youtu.be']
};

/**
 * Most characters in a link to one of the site's social pages
 */
export const MAX_SITE_SOCIAL_URL_LENGTH = 500;

/**
 * A link to the site's page on each social site, or null where it has none
 */
export type SiteSocialLinks = Record<SiteSocialSite, string | null>;

/**
 * Whether a link can be the site's link to a social site: an https address on one of the site's hosts
 * (SITE_SOCIAL_HOSTS), without a port or login, of at most MAX_SITE_SOCIAL_URL_LENGTH characters
 *
 * @param site The social site
 * @param url The link
 * @return Whether it can be
 */
export function isSiteSocialUrl(site: SiteSocialSite, url: string): boolean
{
	if ((url.length > MAX_SITE_SOCIAL_URL_LENGTH) || !URL.canParse(url))
	{
		return(false);
	}

	const parsed = new URL(url);

	return((parsed.protocol === 'https:') && (parsed.port === '') && (parsed.username === '') && (parsed.password === '') && SITE_SOCIAL_HOSTS[site].includes(parsed.hostname));
}

/**
 * Whether an address can be the privacy policy's contact: at most MAX_EMAIL_LENGTH characters, with
 * one @ that has text on both sides, and no spaces. Whether it receives email is only known by sending one
 *
 * @param address The address
 * @return Whether it can be
 */
export function isPrivacyContact(address: string): boolean
{
	return((address.length <= MAX_EMAIL_LENGTH) && /^[^\s@]+@[^\s@]+$/.test(address));
}

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

	/**
	 * The site's own pages on social sites, which every page's footer links to
	 */
	socials: SiteSocialLinks;

	/**
	 * The email address the privacy policy tells players to write to about their information
	 * (isPrivacyContact), or null to leave that line out of the policy
	 */
	privacyContact: string | null;
}

/**
 * The settings any page may read (GET PUBLIC_SITE_SETTINGS_PATH): what the footer and the privacy policy show
 */
export type PublicSiteSettings = Pick<SiteSettings, 'characterDeletionDays' | 'socials' | 'privacyContact'>;

/**
 * The settings of a site that has never saved any
 */
export const DEFAULT_SITE_SETTINGS: Readonly<SiteSettings> = {
	universeCreationEnabled: true,
	universesPerCreator: 5,
	characterDeletionDays: 7,
	socials: {
		discord: null,
		facebook: null,
		instagram: null,
		tiktok: null,
		x: null,
		youtube: null
	},
	privacyContact: null
};
