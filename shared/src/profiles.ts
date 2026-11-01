/**
 * Player profiles: what a player can say about themselves, and its limits (see Profile edit and
 * Profile view in STRUCTURE-OVERVIEW.md), and the routes that read and change it
 */
import type { LoginProvider } from './accounts.js';
import type { OptionName } from './characters.js';
import { SITE_NAME } from './constants.js';
import type { LocalizedMessage } from './localization.js';
import type { Money } from './money.js';
import type { AbilityScores } from './racesAndClasses.js';
import type { Ruleset, UniverseRole } from './universes.js';

/**
 * Most characters in a profile's pronouns, such as "she/her" or "they/them"
 */
export const MAX_PRONOUNS_LENGTH = 40;

/**
 * Most characters in a profile's location, written however the player likes
 */
export const MAX_LOCATION_LENGTH = 100;

/**
 * The languages a profile can say the player knows: every ISO 639-1 code, which the pages name in
 * each language's own words
 */
export const PROFILE_LANGUAGES = [
	'aa', 'ab', 'ae', 'af', 'ak', 'am', 'an', 'ar', 'as', 'av', 'ay', 'az', 'ba', 'be', 'bg', 'bi', 'bm', 'bn', 'bo', 'br',
	'bs', 'ca', 'ce', 'ch', 'co', 'cr', 'cs', 'cu', 'cv', 'cy', 'da', 'de', 'dv', 'dz', 'ee', 'el', 'en', 'eo', 'es', 'et',
	'eu', 'fa', 'ff', 'fi', 'fj', 'fo', 'fr', 'fy', 'ga', 'gd', 'gl', 'gn', 'gu', 'gv', 'ha', 'he', 'hi', 'ho', 'hr', 'ht',
	'hu', 'hy', 'hz', 'ia', 'id', 'ie', 'ig', 'ii', 'ik', 'io', 'is', 'it', 'iu', 'ja', 'jv', 'ka', 'kg', 'ki', 'kj', 'kk',
	'kl', 'km', 'kn', 'ko', 'kr', 'ks', 'ku', 'kv', 'kw', 'ky', 'la', 'lb', 'lg', 'li', 'ln', 'lo', 'lt', 'lu', 'lv', 'mg',
	'mh', 'mi', 'mk', 'ml', 'mn', 'mr', 'ms', 'mt', 'my', 'na', 'nb', 'nd', 'ne', 'ng', 'nl', 'nn', 'no', 'nr', 'nv', 'ny',
	'oc', 'oj', 'om', 'or', 'os', 'pa', 'pi', 'pl', 'ps', 'pt', 'qu', 'rm', 'rn', 'ro', 'ru', 'rw', 'sa', 'sc', 'sd', 'se',
	'sg', 'si', 'sk', 'sl', 'sm', 'sn', 'so', 'sq', 'sr', 'ss', 'st', 'su', 'sv', 'sw', 'ta', 'te', 'tg', 'th', 'ti', 'tk',
	'tl', 'tn', 'to', 'tr', 'ts', 'tt', 'tw', 'ty', 'ug', 'uk', 'ur', 'uz', 've', 'vi', 'vo', 'wa', 'wo', 'xh', 'yi', 'yo',
	'za', 'zh', 'zu'
] as const;

export type ProfileLanguage = (typeof PROFILE_LANGUAGES)[number];

/**
 * Most languages a profile can say the player knows
 */
export const MAX_PROFILE_LANGUAGES = 20;

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
 * GET: everything the site keeps about the logged-in player, to download as one JSON file
 * (AccountExport), with ?locale= naming the language of the default races', classes' and items' names
 */
export const PROFILE_EXPORT_PATH = `${PROFILE_PATH}/export`;

/**
 * GET: what deleting the logged-in player's account has to decide first (AccountDeletionPayload). The
 * account is deleted with AUTH_ACCOUNT_DELETE_PATH
 */
export const PROFILE_DELETION_PATH = `${PROFILE_PATH}/deletion`;

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

	/**
	 * The languages the player knows, which match them with players who speak the same, in the order
	 * they added them; empty when they haven't said
	 */
	languages: ProfileLanguage[];

	socials: SocialUsernames;
}

/**
 * Response of GET playerProfilePath(username)
 */
export interface PlayerProfilePayload extends ProfileFields
{
	/**
	 * The language the player chose, which their pronouns are marked as being written in, or null when
	 * they chose none or have no pronouns
	 */
	pronounsLanguage: string | null;

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
	 * The account's 2FA, or null when it is off
	 */
	twoFactor: TwoFactorState | null;

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
 * An account's 2FA, as its own profile shows it
 */
export interface TwoFactorState
{
	/**
	 * How many of the account's recovery codes haven't been used
	 */
	recoveryCodesLeft: number;

	/**
	 * How many browsers skip the authenticator code at login
	 */
	trustedBrowsers: number;
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

/**
 * Someone with a role in a universe, who can be made its creator
 */
export interface UniverseEditorChoice
{
	playerId: string;
	username: string;
	displayName: string;
	role: UniverseRole;
}

/**
 * A universe the player is the only creator of, which deleting their account hands to another of its
 * editors or deletes
 */
export interface SoleCreatedUniversePayload
{
	id: string;
	name: string;

	/**
	 * Everyone else with a role in it, by username; empty when there is no one to hand it to
	 */
	editors: UniverseEditorChoice[];
}

/**
 * Response of GET PROFILE_DELETION_PATH
 */
export interface AccountDeletionPayload
{
	/**
	 * The universes the player is the only creator of, by name
	 */
	universes: SoleCreatedUniversePayload[];

	/**
	 * Whether the account has a password, which deleting it asks for; an account without one confirms
	 * with its username instead
	 */
	hasPassword: boolean;

	/**
	 * Whether deleting the account asks for its authenticator or recovery code too
	 */
	twoFactor: boolean;
}

/**
 * A character in the data export
 */
export interface ExportedCharacter
{
	id: string;
	name: string;
	universe: {
		id: string;
		name: string;
	};

	/**
	 * The names of the character's race, class and theme (null in a ruleset without themes), as the
	 * universe calls them
	 */
	race: string;
	characterClass: string;
	theme: string | null;

	abilityScores: AbilityScores;
	money: Money;
	items: {
		name: string;
		quantity: number;
	}[];

	/**
	 * The group the character is in, or null when they are in none
	 */
	group: {
		id: string;
		anchorBeing: boolean;
	} | null;

	visibleOnProfile: boolean;

	/**
	 * When the character is deleted (ISO 8601), once given their last rites; null otherwise
	 */
	deleteAt: string | null;
}

/**
 * The name of the file the data export downloads as: the game engine's name, then the player's
 * username, such as MultiverseKiln.ada.json. Only letters, digits, underscores and hyphens of the
 * engine's name are kept, so a fork's name can't put characters in it that file names don't allow
 *
 * @param username The player's username
 * @return The file name
 */
export function accountExportFileName(username: string): string
{
	const site = SITE_NAME.replace(/[^\p{L}\p{N}_-]+/gu, '');

	return(((site === '') ? `${username}.json` : `${site}.${username}.json`));
}

/**
 * Response of GET PROFILE_EXPORT_PATH: everything the site keeps about the player. Times are ISO 8601
 */
export interface AccountExport
{
	exportedAt: string;
	account: ProfileFields & {
		id: string;
		email: string | null;
		hasPassword: boolean;
		locale: string | null;
		showCharacters: boolean;
		createdAt: string;

		/**
		 * When the player last logged in, or null when they never have
		 */
		lastLoginAt: string | null;
	};

	/**
	 * The Google and Discord logins linked to the account
	 */
	providers: LoginProvider[];

	/**
	 * The account's 2FA, or null when it is off. The authenticator's secret and the recovery codes
	 * themselves are never given out
	 */
	twoFactor: TwoFactorState | null;

	/**
	 * The browsers logged in to the account
	 */
	sessions: {
		createdAt: string;
		lastUsedAt: string;
		rememberMe: boolean;
	}[];

	/**
	 * Logins and changes to how the account logs in, from the last 90 days, oldest first
	 */
	authEvents: {
		kind: string;
		occurredAt: string;
	}[];

	/**
	 * The universes the player has a role in, by name
	 */
	universes: {
		id: string;
		name: string;
		role: UniverseRole;
	}[];

	characters: ExportedCharacter[];

	/**
	 * Create Character's progress in each universe where the player hasn't finished a character
	 */
	characterDrafts: {
		universeId: string;
		draft: unknown;
	}[];
}
