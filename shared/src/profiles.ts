/**
 * Player profiles: what a player can say about themselves, and its limits (see Profile edit and
 * Profile view in STRUCTURE-OVERVIEW.md)
 */

/**
 * Most characters in a profile's pronouns, such as "she/her" or "they/them"
 */
export const MAX_PRONOUNS_LENGTH = 40;

/**
 * Most characters in a profile's location, written however the player likes
 */
export const MAX_LOCATION_LENGTH = 100;

/**
 * The sites a profile can link to the player's account on
 */
export const SOCIAL_SITES = ['discord', 'facebook', 'instagram', 'tiktok'] as const;

export type SocialSite = (typeof SOCIAL_SITES)[number];

/**
 * What a username on each social site looks like. Profiles store the username rather than an address,
 * so a link always goes to the site it says
 */
export const SOCIAL_USERNAME_PATTERNS: Readonly<Record<SocialSite, RegExp>> = {
	discord: /^[a-z0-9_.]{2,32}$/,
	facebook: /^[A-Za-z0-9.]{5,50}$/,
	instagram: /^[A-Za-z0-9._]{1,30}$/,
	tiktok: /^[A-Za-z0-9._]{2,24}$/
};

/**
 * Most characters in a username on any of the social sites
 */
export const MAX_SOCIAL_USERNAME_LENGTH = 50;
