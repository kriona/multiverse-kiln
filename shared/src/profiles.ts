/**
 * Player profiles: what a player can say about themselves, and its limits (see Profile edit and
 * Profile view in STRUCTURE-OVERVIEW.md), and the routes that read and change it
 */
import type { LoginProvider } from './accounts.js';
import type { OptionName } from './characters.js';
import type { LocalizedMessage } from './localization.js';
import type { Ruleset } from './universes.js';

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

/**
 * A player's username on each social site, or null where they gave none
 */
export type SocialUsernames = Record<SocialSite, string | null>;

/**
 * GET: the logged-in player's own profile (OwnProfilePayload); PUT: change it (ProfileUpdateRequest)
 */
export const PROFILE_PATH = '/profile';

/**
 * PUT profileCharacterPath(characterId): whether the profile lists one of the player's characters
 * when it doesn't list them all (CharacterVisibilityRequest)
 *
 * @param characterId The character's ID
 * @return The path
 */
export function profileCharacterPath(characterId: string): string
{
	return(`${PROFILE_PATH}/characters/${encodeURIComponent(characterId)}`);
}

/**
 * Where players' profiles are, by username (playerProfilePath())
 */
export const PLAYERS_PATH = '/players';

/**
 * GET: a player's profile, as other logged-in players see it (PlayerProfilePayload)
 *
 * @param username The player's username, in any capitals
 * @return The path
 */
export function playerProfilePath(username: string): string
{
	return(`${PLAYERS_PATH}/${encodeURIComponent(username)}`);
}

/**
 * The universe a profile's character is in
 */
export interface ProfileUniverse
{
	id: string;
	slug: string;
	name: string;
	ruleset: Ruleset;
}

/**
 * One of a player's characters, as their profile lists them
 */
export interface ProfileCharacter
{
	id: string;
	name: string;
	race: OptionName;
	characterClass: OptionName;
	universe: ProfileUniverse;
}

/**
 * One of the player's own characters on their profile
 */
export interface OwnProfileCharacter extends ProfileCharacter
{
	/**
	 * Whether the profile lists the character when it doesn't list them all
	 */
	visibleOnProfile: boolean;
}

/**
 * What a profile says about a player, as other players see it
 */
export interface ProfileFields
{
	username: string;
	displayName: string;
	pronouns: string | null;
	location: string | null;

	/**
	 * An IANA time zone name, such as Europe/Paris
	 */
	timeZone: string | null;

	socials: SocialUsernames;
}

/**
 * Response of GET playerProfilePath(username)
 */
export interface PlayerProfilePayload extends ProfileFields
{
	/**
	 * The characters the player lets others see, in universes anyone can play, by universe name and
	 * then character name
	 */
	characters: ProfileCharacter[];
}

/**
 * Response of GET PROFILE_PATH
 */
export interface OwnProfilePayload extends ProfileFields
{
	/**
	 * The address the account logs in with and is emailed at, or null when it has none
	 */
	email: string | null;

	/**
	 * Whether the account has a password, which it can change
	 */
	hasPassword: boolean;

	/**
	 * The Google and Discord logins linked to the account
	 */
	providers: LoginProvider[];

	/**
	 * The language the player chose, or null when the pages follow the browser's settings
	 */
	locale: string | null;

	/**
	 * Whether the profile lists all of the player's characters
	 */
	showCharacters: boolean;

	/**
	 * Every character the player has, in any universe, by universe name and then character name
	 */
	characters: OwnProfileCharacter[];
}

/**
 * Body of PUT PROFILE_PATH: the whole profile, with null for each field left blank
 */
export interface ProfileUpdateRequest extends ProfileFields
{
	locale: string | null;
	showCharacters: boolean;
}

/**
 * The fields of PUT PROFILE_PATH's request that an error can be about
 */
export type ProfileField = 'username' | 'displayName' | 'pronouns' | 'location' | 'timeZone' | 'locale' | SocialSite;

/**
 * Why PUT PROFILE_PATH refused a profile, and which field it is about, if one
 */
export interface ProfileErrorPayload
{
	error: LocalizedMessage;
	field?: ProfileField;
}

/**
 * Body of PUT profileCharacterPath(characterId)
 */
export interface CharacterVisibilityRequest
{
	visibleOnProfile: boolean;
}
