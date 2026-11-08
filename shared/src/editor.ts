/**
 * The world editor's REST API: routes, limits, and the requests and responses each route takes
 *
 * Every route needs a logged-in browser, and answers an ErrorPayload with 400 for a request that fails
 * validation, 401 when the browser isn't logged in, 403 when the player's role doesn't allow the
 * change, 404 for something that doesn't exist and 409 for a change that conflicts with what is
 * there. Writes from a browser must come from an origin in the server's ALLOWED_ORIGINS
 */
import type { OptionName } from './characters.js';
import type { LocalizedMessage } from './localization.js';
import type { MapBounds } from './maps.js';
import type { AreaChunk } from './messages.js';
import type { Money, UniverseCoinAbbreviations, UniverseCoinNames } from './money.js';
import type { Ability, ClassRules, RaceRules, Size } from './racesAndClasses.js';
import type { Pf1eCastingStyle, Pf1eMagicTradition } from './rulesets/pf1e/classes.js';
import type { Pf1eSettings } from './rulesets/pf1e/settings.js';
import type { Pf1eStatMethod } from './rulesets/pf1e/statMethods.js';
import type { Sf1eSettings } from './rulesets/sf1e/settings.js';
import type { Sf1eThemeRules } from './rulesets/sf1e/themes.js';
import type { SortDirection } from './sorting.js';
import type { TileGraphic, TileGraphicFormat } from './tileGraphics.js';
import type { Darkvision } from './vision.js';
import type { DisplayTime, EditorRole, FaerieMorning, LobbyPassageOfTime, PassageOfTime, Ruleset, UniverseRole, UniverseStage, AreaLightLevel, AreaLinkMode, AreaPassageOfTime } from './universes.js';

/**
 * Base of every editor route. Under it, with :universeId and :areaId standing for IDs:
 *
 * - GET    /                                       EditableUniverseListPayload: the universes the player has a role in
 * - POST   /                                       NewUniverseRequest -> CreatedPayload: a universe the player creates
 * - GET    /:universeId                            EditableUniverse
 * - POST   /:universeId/changes                    SaveChangesRequest -> SaveChangesPayload: saves the editor's changes, all or nothing (see editorChanges.ts)
 * - GET    /:universeId/editors                    UniverseEditorListPayload: everyone with a role in the universe
 * - GET    /:universeId/editors/search             PlayerSearchQuery as query parameters -> PlayerSearchPayload: players to add, by username or name (canManageEditors())
 * - GET    /:universeId/characters                 EditorCharacterListQuery as query parameters -> EditorCharacterListPayload: the characters made in the universe (canEditWorld())
 * - GET    /:universeId/audit                      UniverseEditListQuery as query parameters -> UniverseEditListPayload: the saves made in the editor, newest first (canManageEditors())
 * - GET    /:universeId/ruleset                    RulesetSettings
 * - GET    /:universeId/tiles                      TileListQuery as query parameters -> TileListPayload
 * - GET    /:universeId/tiles/:tileId/usage        TileUsagePayload: the areas whose maps use the tile
 * - GET    /:universeId/tile-graphics              TileGraphicListPayload: the tile graphics the universe's editors uploaded
 * - GET    /:universeId/items                      ItemListQuery as query parameters -> ItemListPayload
 * - GET    /:universeId/races                      RaceListPayload
 * - GET    /:universeId/classes                    ClassListPayload
 * - GET    /:universeId/themes                     ThemeListPayload (rulesets with themes only, rulesetHasThemes())
 * - GET    /:universeId/difficulty-levels          DifficultyLevelListPayload
 * - GET    /:universeId/areas                      AreaListPayload
 * - GET    /:universeId/areas/:areaId              EditorArea
 * - GET    /:universeId/areas/:areaId/chunks       ChunkRange as query parameters -> ChunkListPayload
 * - GET    /:universeId/areas/:areaId/links        AreaLinkListPayload
 *
 * Every route except the list and create needs a role in the universe. Every change to a universe is
 * saved through /:universeId/changes, which checks the player's role for each change
 */
export const EDITOR_UNIVERSES_PATH = '/editor/universes';

/**
 * Most characters in a universe's name
 */
export const MAX_UNIVERSE_NAME_LENGTH = 60;

/**
 * Most characters in a universe's 1-sentence description
 */
export const MAX_SHORT_DESCRIPTION_LENGTH = 200;

/**
 * Most characters in a universe's long description (Markdown)
 */
export const MAX_LONG_DESCRIPTION_LENGTH = 20000;

/**
 * Fewest characters a group can hold: 1 is single player game. The most is MAX_GROUP_PLAYERS
 */
export const MIN_GROUP_SIZE = 1;

/**
 * Most characters in a tile's name
 */
export const MAX_TILE_NAME_LENGTH = 40;

/**
 * Most tiles a universe may add to its ruleset's default tiles
 */
export const MAX_CUSTOM_TILES = 1000;

/**
 * Most tiles one page of the Tilesets tab lists
 */
export const MAX_TILES_PER_PAGE = 500;

/**
 * Where the server serves uploaded tile graphics, which anyone can load: /tile-graphics/<ID>.png. An
 * uploaded graphic never changes, so its address can be cached for good
 */
export const TILE_GRAPHICS_PATH = '/tile-graphics';

/**
 * Most bytes an uploaded tile graphic's PNG may have
 */
export const MAX_TILE_GRAPHIC_BYTES = 256 * 1024;

/**
 * Most tile graphics a universe's editors may upload
 */
export const MAX_UPLOADED_TILE_GRAPHICS = 200;

/**
 * Most characters in an uploaded tile graphic's name
 */
export const MAX_TILE_GRAPHIC_NAME_LENGTH = 40;

/**
 * The draw orders an uploaded tile graphic can have (see TILE_GRAPHICS): where tiles meet, the higher
 * one's edges are drawn over the lower one's
 */
export const MIN_TILE_GRAPHIC_DRAW_ORDER = 1;
export const MAX_TILE_GRAPHIC_DRAW_ORDER = 99;

/**
 * Most characters in an item's name
 */
export const MAX_ITEM_NAME_LENGTH = 60;

/**
 * Most items a universe may add to its ruleset's default items
 */
export const MAX_CUSTOM_ITEMS = 5000;

/**
 * Most items one page of the Items tab lists
 */
export const MAX_ITEMS_PER_PAGE = 500;

/**
 * Most of one item a quantity can be, e.g. 20 arrows
 */
export const MAX_ITEM_QUANTITY = 999;

/**
 * Most different items a universe's starting equipment can hold
 */
export const MAX_STARTING_ITEMS = 50;

/**
 * Most characters in a race's or class's name
 */
export const MAX_RACE_NAME_LENGTH = 40;
export const MAX_CLASS_NAME_LENGTH = 40;

/**
 * Most races, and most classes, a universe may add to its ruleset's defaults
 */
export const MAX_CUSTOM_RACES = 100;
export const MAX_CUSTOM_CLASSES = 100;

/**
 * Most characters in a theme's name
 */
export const MAX_THEME_NAME_LENGTH = 40;

/**
 * Most themes a universe may add to its ruleset's defaults
 */
export const MAX_CUSTOM_THEMES = 100;

/**
 * Most characters in an area's name
 */
export const MAX_AREA_NAME_LENGTH = 60;

/**
 * Most areas in one universe
 */
export const MAX_AREAS = 1000;

/**
 * The map a new area starts with: one screen's worth of cells around column 0, row 0
 */
export const NEW_AREA_BOUNDS: Readonly<MapBounds> = {
	minColumn: -15,
	minRow: -8,
	maxColumn: 15,
	maxRow: 8
};

/**
 * A cell of a starting area. Characters start on the free cell nearest it; one outside the area's map,
 * which may have been made smaller since the cell was chosen, counts as the nearest cell on it. Column
 * 0, row 0, the middle of a new area's map, until the editor chooses another
 */
export interface StartingCell
{
	column: number;
	row: number;
}

/**
 * The keys of the default tiles new areas use in each ruleset, outdoors and indoors
 */
export const DEFAULT_AREA_TILE_KEYS: Record<Ruleset, { outdoors: string; indoors: string }> = {
	pf1e: { outdoors: 'grass', indoors: 'wood_floor' },
	sf1e: { outdoors: 'grass', indoors: 'metal_floor' }
};

/**
 * Whether a tile is one new areas use (DEFAULT_AREA_TILE_KEYS), which can't be disabled
 *
 * @param key The tile's key, or null for a tile the universe added
 * @param ruleset The universe's ruleset
 * @return True when new areas use it
 */
export function isDefaultAreaTile(key: string | null, ruleset: Ruleset): boolean
{
	const keys = DEFAULT_AREA_TILE_KEYS[ruleset];

	return(((key === keys.outdoors) || (key === keys.indoors)));
}

/**
 * Most cells one editCells change may change; the editor splits a larger edit into several changes
 */
export const MAX_CELL_CHANGES = 20000;

/**
 * Most chunks one ChunkRange may cover
 */
export const MAX_CHUNKS_PER_REQUEST = 256;

/**
 * Largest brush the draw tool offers, in cells across
 */
export const MAX_BRUSH_SIZE = 100;

/**
 * Response of a request the server refused or couldn't answer: why, for the player to read
 */
export interface ErrorPayload
{
	error: LocalizedMessage;
}

/**
 * Response of a route that creates something: the new thing's ID
 */
export interface CreatedPayload<T extends string | number = string>
{
	id: T;
}

/**
 * A universe the player has a role in, as their list of universes shows it
 */
export interface EditableUniverseSummary
{
	id: string;
	name: string;

	/**
	 * The name in the form its page's address uses (universeSlug)
	 */
	slug: string;

	shortDescription: string;
	ruleset: Ruleset;

	/**
	 * The language its text is written in, and the languages it is translated into, by tag
	 */
	sourceLanguage: string;
	translationLanguages: string[];

	stage: UniverseStage;
	role: UniverseRole;

	/**
	 * Whether a server admin has disabled the universe
	 */
	disabled: boolean;
}

/**
 * Response of GET EDITOR_UNIVERSES_PATH, by name
 */
export interface EditableUniverseListPayload
{
	universes: EditableUniverseSummary[];

	/**
	 * Whether the site lets players create universes (SiteSettings)
	 */
	universeCreationEnabled: boolean;

	/**
	 * Most universes the player may create (SiteSettings)
	 */
	universesPerCreator: number;

	/**
	 * What the Create Universe dialog needs to offer to turn on 2FA, when the player's account can (it
	 * has a password or an email address, which setting it up checks it's them with, and 2FA is off);
	 * null when it can't
	 */
	twoFactorOffer: TwoFactorOffer | null;
}

/**
 * The Create Universe dialog's offer to turn on 2FA (EditableUniverseListPayload.twoFactorOffer)
 */
export interface TwoFactorOffer
{
	/**
	 * The account's username, which the recovery codes' file names
	 */
	username: string;

	/**
	 * The account's email address, which tells password managers which account the password asked for
	 * is for, and which an account without a password is sent a code at; null when it has none
	 */
	email: string | null;

	/**
	 * Whether the account has a password, which setting up 2FA asks for; one without is emailed a code
	 */
	hasPassword: boolean;
}

/**
 * Body of POST EDITOR_UNIVERSES_PATH: what the Create Universe dialog asks for
 *
 * The new universe is in_the_beginning, with a lobby area and a starting area, and the player is its creator
 */
export interface NewUniverseRequest
{
	name: string;
	shortDescription: string;
	ruleset: Ruleset;

	/**
	 * The language the pages are shown in, by tag. The universe's source language is the language the
	 * player chose on their profile, then this (universeLanguageOf())
	 */
	locale?: string;
}

/**
 * A universe's settings, as the Edit Universe page shows and changes them
 */
export interface UniverseSettings
{
	name: string;
	shortDescription: string;

	/**
	 * Markdown
	 */
	longDescription: string;

	/**
	 * The language the universe's editors write its text in, by tag (the Translations tab)
	 */
	sourceLanguage: string;

	/**
	 * The languages its text is translated into, by tag, in the order they were added: up to
	 * MAX_UNIVERSE_LANGUAGES, never the source language. Taking one off deletes its translations
	 */
	translationLanguages: string[];

	stage: UniverseStage;

	/**
	 * Whether the universe's editors need 2FA on to open it in the editor and save changes to it, other
	 * than leaving it (the Editors tab). Like the stage, the universe has it once for both versions
	 */
	requireTwoFactor: boolean;

	passageOfTime: PassageOfTime;

	/**
	 * Set exactly when passageOfTime is faerie
	 */
	faerieMorning: FaerieMorning | null;

	/**
	 * How players are shown the time of day, in the lobby and in the game
	 */
	displayTime: DisplayTime;

	/**
	 * How the time of day changes in the lobby (the Lobby tab)
	 */
	lobbyPassageOfTime: LobbyPassageOfTime;

	/**
	 * How many real hours a lobby day lasts when lobbyPassageOfTime is real_time, from MIN_LOBBY_DAY_HOURS
	 * to MAX_LOBBY_DAY_HOURS
	 */
	lobbyDayHours: number;

	/**
	 * Set exactly when lobbyPassageOfTime is faerie. The lobby's area can't loop while it is
	 */
	lobbyFaerieMorning: FaerieMorning | null;

	/**
	 * Whether every tile in the lobby is seen past as if it had no vision cost
	 */
	lobbyNoVisionCost: boolean;

	/**
	 * The area players walk around in the lobby: one of the universe's areas other than a starting area
	 * (the universe's, a race's or a class's). While it is null or disabled, the lobby has no map, and
	 * its players only chat and choose their characters
	 */
	lobbyAreaId: string | null;

	/**
	 * The cell of the lobby's area players start nearest (see StartingCell); 0 while lobbyAreaId is null
	 */
	lobbyColumn: number;

	lobbyRow: number;

	/**
	 * Most characters in one group, from MIN_GROUP_SIZE to MAX_GROUP_PLAYERS
	 */
	groupSize: number;

	/**
	 * The coins every character starts with: up to MAX_COINS of each of the ruleset's coins, and none of others
	 */
	startingMoney: Money;

	/**
	 * The names the universe gives its ruleset's coins in place of the engine's, in its source language:
	 * only the ruleset's coins, each 1 to MAX_COIN_NAME_LENGTH characters. Changing it replaces them all,
	 * and a coin taken out loses its name's translations
	 */
	coinNames: UniverseCoinNames;

	/**
	 * The abbreviations the universe gives its ruleset's coins in place of the engine's, in its source
	 * language: only the ruleset's coins, each isValidCoinAbbreviation(), and no two coins shown with the
	 * same abbreviation (with the engine's English one for each coin left out). Changing it replaces
	 * them all, and a coin taken out loses its abbreviation's translations
	 */
	coinAbbreviations: UniverseCoinAbbreviations;

	/**
	 * The items every character starts with, by item ID: up to MAX_STARTING_ITEMS items the universe
	 * can use, each listed once
	 */
	startingItems: ItemQuantity[];

	/**
	 * Where characters start unless their race or class says otherwise: one of the universe's areas
	 * other than the lobby's. Null only while the universe is being created
	 */
	startingAreaId: string | null;

	/**
	 * The cell of the starting area characters start nearest (see StartingCell)
	 */
	startingColumn: number;

	startingRow: number;
}

/**
 * The copies of a universe the editor works on: its live version, which players play, and its draft, which
 * reaches players once it is applied (see Universe versions in STRUCTURE-OVERVIEW.md)
 */
export const UNIVERSE_VERSIONS = ['live', 'draft'] as const;

export type UniverseVersionName = typeof UNIVERSE_VERSIONS[number];

/**
 * The query parameter every route under EDITOR_UNIVERSES_PATH/:universeId takes, naming the version it
 * reads or changes (UniverseVersionName); left out, the live version
 */
export const EDITOR_VERSION_PARAM = 'version';

/**
 * ID of the message every route under EDITOR_UNIVERSES_PATH/:universeId but saving refuses a player with
 * while the universe requires its editors to have 2FA on and they don't, so the editor can offer to
 * turn it on or leave the universe (the only save they may make)
 */
export const EDITOR_TWO_FACTOR_ERROR_ID = 'error.editorNeedsTwoFactor';

/**
 * Response of GET EDITOR_UNIVERSES_PATH/:universeId
 */
export interface EditableUniverse extends UniverseSettings
{
	id: string;

	/**
	 * The version the settings are of: the one the request asked for
	 */
	version: UniverseVersionName;

	/**
	 * Whether the universe has a draft
	 */
	hasDraft: boolean;

	/**
	 * The name in the form its page's address uses (universeSlug)
	 */
	slug: string;

	ruleset: Ruleset;

	/**
	 * Why a server admin disabled the universe, or null while it isn't disabled. A disabled universe
	 * can't be played, and the editor can't save
	 */
	disabledReason: string | null;

	/**
	 * The player's role in the editor, which decides what they may change: ADMIN_ROLE for a server admin
	 * without a stronger role in the universe
	 */
	role: EditorRole;

	/**
	 * The languages the player may translate the universe into, as a translator; empty for other roles
	 */
	languages: string[];

	/**
	 * The player's own ID, which the Editors tab finds them by
	 */
	playerId: string;

	/**
	 * Whether the player is a server admin with 2FA on, who may save while the universe is disabled
	 */
	serverAdmin: boolean;

	/**
	 * Whether the player has 2FA on. A universe that requires it (requireTwoFactor) opens in the editor
	 * only for players with it on, so this is false only while the universe doesn't require it
	 */
	twoFactor: boolean;

	/**
	 * How many translations the universe has in each language, by tag, leaving out languages with none
	 */
	translationCounts: Record<string, number>;
}

/**
 * A universe as the server reads it, before it is told whose editor it is for
 */
export type EditableUniverseDetails = Omit<EditableUniverse, 'role' | 'languages' | 'playerId' | 'serverAdmin' | 'twoFactor' | 'translationCounts'>;

/**
 * Someone with a role in a universe, as the Editors tab lists them
 */
export interface UniverseEditorSummary
{
	playerId: string;
	username: string;
	displayName: string;
	role: UniverseRole;

	/**
	 * The languages a translator may translate into, by tag; empty for other roles
	 */
	languages: string[];
}

/**
 * Response of GET EDITOR_UNIVERSES_PATH/:universeId/editors, by username
 */
export interface UniverseEditorListPayload
{
	editors: UniverseEditorSummary[];
}

/**
 * Most players one search for players returns
 */
export const MAX_PLAYER_SEARCH_RESULTS = 10;

/**
 * Fewest characters a search for players needs, not counting a leading @, so a search narrows the
 * players down rather than listing them
 */
export const MIN_PLAYER_SEARCH_LENGTH = 3;

/**
 * Query parameters of GET EDITOR_UNIVERSES_PATH/:universeId/editors/search: what was typed, matched
 * against usernames and names, ignoring capitals. Text starting with @ is matched against usernames
 * only, without the @ (see parsePlayerSearch())
 */
export interface PlayerSearchQuery
{
	query: string;
}

/**
 * A player a search found
 */
export interface PlayerMatch
{
	playerId: string;
	username: string;
	displayName: string;
}

/**
 * Response of GET EDITOR_UNIVERSES_PATH/:universeId/editors/search, which answers 400 for a query with
 * fewer than MIN_PLAYER_SEARCH_LENGTH characters besides a leading @: up to MAX_PLAYER_SEARCH_RESULTS
 * players whose username or name holds what was typed, other than the universe's editors. The player
 * with exactly that username comes first, then those whose username starts with it, then the rest, each
 * by username
 */
export interface PlayerSearchPayload
{
	players: PlayerMatch[];
}

/**
 * What a search for players looks for: text typed starting with @ is a username, and anything else
 * a username or a name
 *
 * @param query What was typed
 * @return The text to match, trimmed and without the @, and whether only usernames are matched
 */
export function parsePlayerSearch(query: string): { text: string; usernameOnly: boolean }
{
	const trimmed = query.trim();
	const usernameOnly = trimmed.startsWith('@');

	return({
		text: (usernameOnly ? trimmed.slice(1).trim() : trimmed),
		usernameOnly
	});
}

/**
 * Most characters one page of the Character List tab lists
 */
export const MAX_CHARACTERS_PER_PAGE = 500;

/**
 * Longest search the Character List tab sends
 */
export const MAX_CHARACTER_SEARCH_LENGTH = 100;

/**
 * The columns the Character List tab can sort characters by
 */
export const EDITOR_CHARACTER_SORT_COLUMNS = ['name', 'player', 'created'] as const;

export type EditorCharacterSortColumn = typeof EDITOR_CHARACTER_SORT_COLUMNS[number];

/**
 * Query parameters of GET EDITOR_UNIVERSES_PATH/:universeId/characters. Each filter left out matches
 * every character
 */
export interface EditorCharacterListQuery
{
	/**
	 * Part of a character's name, or of their player's username or name, ignoring capitals. Text
	 * starting with @ is matched against usernames only, without the @ (see parsePlayerSearch())
	 */
	search?: string;

	/**
	 * The race, by the ID characters have it by (an EditorRace's ID)
	 */
	raceId?: number;

	/**
	 * The class, by the ID characters have it by (an EditorClass's ID)
	 */
	classId?: number;

	/**
	 * Whether the character is in a group
	 */
	inGroup?: boolean;

	/**
	 * The column to sort the matches by before paging, with characters that tie sorted by name: the
	 * character's name, their player's username, or when they were made. Names sort ignoring capitals
	 */
	sort?: EditorCharacterSortColumn;

	/**
	 * Which way to sort, ascending when left out
	 */
	direction?: SortDirection;

	/**
	 * How many matching characters to skip
	 */
	offset?: number;

	/**
	 * Most characters to return, up to MAX_CHARACTERS_PER_PAGE (the default)
	 */
	limit?: number;
}

/**
 * A character in the universe, as the Character List tab lists them
 */
export interface EditorCharacter
{
	id: string;
	name: string;
	race: OptionName;
	characterClass: OptionName;

	/**
	 * The player who made the character
	 */
	player: {
		username: string;
		displayName: string;
	};

	/**
	 * When the character was made, as an ISO 8601 time
	 */
	createdAt: string;

	/**
	 * When the character is deleted (an ISO 8601 time), once given their last rites; null otherwise
	 */
	deleteAt: string | null;

	/**
	 * Whether the character is in a group
	 */
	inGroup: boolean;
}

/**
 * Response of GET EDITOR_UNIVERSES_PATH/:universeId/characters (canEditWorld()): a page of the
 * matching characters, leaving out those whose last rites are over
 */
export interface EditorCharacterListPayload
{
	characters: EditorCharacter[];

	/**
	 * How many characters match, on every page
	 */
	total: number;
}

/**
 * Most saves one page of the Audit tab lists
 */
export const MAX_UNIVERSE_EDITS_PER_PAGE = 100;

/**
 * Query parameters of GET EDITOR_UNIVERSES_PATH/:universeId/audit
 */
export interface UniverseEditListQuery
{
	/**
	 * How many saves to skip, newest first
	 */
	offset?: number;

	/**
	 * Most saves to return, up to MAX_UNIVERSE_EDITS_PER_PAGE (the default)
	 */
	limit?: number;
}

/**
 * The settings the Audit tab names when a save changes them. Settings the editor shows as one field are
 * one here: a starting area and its cell are startingArea (lobbyArea for the lobby's area), a passage of time and its faerie morning are
 * passageOfTime (lobbyPassageOfTime for the lobby's), and a tile's graphic or uploaded graphic is graphic
 */
export const AUDIT_FIELDS = [
	'name',
	'shortDescription',
	'longDescription',
	'sourceLanguage',
	'translationLanguages',
	'stage',
	'requireTwoFactor',
	'passageOfTime',
	'displayTime',
	'lobbyPassageOfTime',
	'lobbyDayHours',
	'lobbyNoVisionCost',
	'lobbyArea',
	'groupSize',
	'startingMoney',
	'coinNames',
	'coinAbbreviations',
	'startingItems',
	'startingArea',
	'statMethod',
	'customPointBuyBudget',
	'abilityPoints',
	'needsSleep',
	'coinsHaveWeight',
	'tracksAmmo',
	'role',
	'languages',
	'indoors',
	'outdoors',
	'color',
	'graphic',
	'visionCost',
	'walkSeconds',
	'enabled',
	'keepPlaying',
	'type',
	'abilityModifiers',
	'floatingBonus',
	'darkvision',
	'lightSensitivity',
	'size',
	'hitPoints',
	'raceAreas',
	'primaryAbility',
	'tradition',
	'castingStyle',
	'keyAbility',
	'hitPointsPerLevel',
	'staminaPointsPerLevel',
	'ability',
	'isDefault',
	'mobScale',
	'permadeath',
	'parentArea',
	'indoorsOrOutdoors',
	'lightLevel',
	'defaultTile',
	'loopsEastWest',
	'loopsNorthSouth'
] as const;

export type AuditField = typeof AUDIT_FIELDS[number];

/**
 * A place characters start: an area, by its name when saved, and a cell of its map
 */
export interface AuditPlace
{
	area: string;
	column: number;
	row: number;
}

/**
 * A passage of time, with where morning is when it is faerie (null otherwise)
 */
export interface AuditPassageOfTime
{
	time: AreaPassageOfTime | LobbyPassageOfTime;
	morning: FaerieMorning | null;
}

/**
 * The value each audit field holds once a save changed it. What a setting names (an area, a tile, an
 * item, a race, an uploaded tileset) is held by its name as it was when saved; a long description is
 * held by how many characters it has, rather than its text
 */
export interface AuditFieldValues
{
	/**
	 * Null for one of the ruleset's defaults given its default name back
	 */
	name: string | null;
	shortDescription: string;

	/**
	 * How many characters it has
	 */
	longDescription: number;

	/**
	 * Language tags
	 */
	sourceLanguage: string;
	translationLanguages: string[];
	stage: UniverseStage;
	requireTwoFactor: boolean;
	passageOfTime: AuditPassageOfTime;
	displayTime: DisplayTime;
	lobbyPassageOfTime: AuditPassageOfTime;
	lobbyDayHours: number;
	lobbyNoVisionCost: boolean;

	/**
	 * Null when the universe has no lobby area
	 */
	lobbyArea: AuditPlace | null;
	groupSize: number;
	startingMoney: Money;
	coinNames: UniverseCoinNames;
	coinAbbreviations: UniverseCoinAbbreviations;
	startingItems: {
		item: OptionName;
		quantity: number;
	}[];

	/**
	 * Null for a race or class with no starting area of its own
	 */
	startingArea: AuditPlace | null;
	statMethod: Pf1eStatMethod;
	customPointBuyBudget: number;
	abilityPoints: number;
	needsSleep: boolean;
	coinsHaveWeight: boolean;
	tracksAmmo: boolean;
	role: UniverseRole;

	/**
	 * Language tags
	 */
	languages: string[];
	indoors: boolean;
	outdoors: boolean;

	/**
	 * As 0xRRGGBB
	 */
	color: number;

	/**
	 * One of the graphics that ship with the engine, or an uploaded tileset by name; both null for none
	 */
	graphic: {
		graphic: TileGraphic | null;
		uploaded: string | null;
	};
	visionCost: number;
	walkSeconds: number;
	enabled: boolean;
	keepPlaying: boolean;

	/**
	 * An item type's key (ITEM_KINDS)
	 */
	type: string;
	abilityModifiers: Partial<Record<Ability, number>>;
	floatingBonus: boolean;
	darkvision: Darkvision;
	lightSensitivity: boolean;
	size: Size;
	hitPoints: number;
	raceAreas: {
		race: OptionName;
		place: AuditPlace;
	}[];
	primaryAbility: Ability;
	tradition: Pf1eMagicTradition;
	castingStyle: Pf1eCastingStyle;
	keyAbility: Ability;
	hitPointsPerLevel: number;
	staminaPointsPerLevel: number;
	ability: Ability;
	isDefault: boolean;
	mobScale: number;
	permadeath: boolean;

	/**
	 * Null for an area inside no other
	 */
	parentArea: string | null;

	/**
	 * True for indoors
	 */
	indoorsOrOutdoors: boolean;
	lightLevel: AreaLightLevel;
	defaultTile: OptionName;
	loopsEastWest: boolean;
	loopsNorthSouth: boolean;
}

/**
 * One setting a save changed, and the value it changed it to
 */
export type AuditFieldChange = { [Field in AuditField]: { field: Field; value: AuditFieldValues[Field] } }[AuditField];

/**
 * What one part of a save changed, as the Audit tab lists it
 *
 * - editor: a player's role in the universe (added, changed, deleted)
 * - settings, ruleset: the universe's settings, or how it plays under its ruleset (changed)
 * - tileset: an uploaded tileset (added, deleted)
 * - tile, item, race, class, theme, difficultyLevel: added, changed, deleted, or restored (one of the
 *   ruleset's defaults that had been edited, given its default settings again)
 * - area: added, changed, resized or deleted
 * - cells: cells painted on an area's map (changed)
 * - links: an area's links, added or replaced (changed) or deleted
 * - translations: translations into one language added, changed or deleted (changed), whose target
 *   holds the language's tag as its name
 * - translatorNotes: notes for translators written or deleted (changed)
 * - noTranslation: pieces of text marked as needing no translation (added) or as needing one again (deleted)
 * - draft: the universe's draft, started (added), applied to the live version (applied) or discarded
 *   (deleted); see Universe versions in STRUCTURE-OVERVIEW.md
 */
export const AUDIT_SUBJECTS = ['editor', 'settings', 'ruleset', 'tileset', 'tile', 'item', 'race', 'class', 'theme', 'difficultyLevel', 'area', 'cells', 'links', 'translations', 'translatorNotes', 'noTranslation', 'draft'] as const;

export type AuditSubject = typeof AUDIT_SUBJECTS[number];

export type AuditAction = 'added' | 'changed' | 'deleted' | 'restored' | 'resized' | 'applied';

/**
 * One thing a save changed
 */
export interface UniverseEditDetail
{
	subject: AuditSubject;
	action: AuditAction;

	/**
	 * What it changed, by name as it was when saved: an editor's username, an area's or tileset's name,
	 * or a tile's, item's, race's, class's, theme's or difficulty level's name, with the key of one of the
	 * ruleset's defaults, whose name players read in their language while its name is null. Null for
	 * settings and ruleset, which name nothing
	 */
	target: OptionName | null;

	/**
	 * The settings it changed, with their new values, for changed (empty for every other action, and for
	 * cells and links)
	 */
	fields: AuditFieldChange[];

	/**
	 * How many cells it painted, for cells, links it changed, for links, translations, for translations,
	 * notes, for translatorNotes, or pieces of text marked, for noTranslation; 1 for every other subject
	 */
	count: number;
}

/**
 * One save made in a universe's editor, as the Audit tab lists them
 */
export interface UniverseEdit
{
	id: string;

	/**
	 * The player who saved, or null once their account is deleted
	 */
	player: {
		username: string;
		displayName: string;
	} | null;

	/**
	 * The role they saved with, ADMIN_ROLE included
	 */
	role: EditorRole;

	/**
	 * Whether the save changed the universe's draft rather than its live version
	 */
	draft: boolean;

	/**
	 * What the save changed, thing by thing, in the order it changed them, or null for a save made
	 * before they were recorded
	 */
	details: UniverseEditDetail[] | null;

	/**
	 * When the save was made, as an ISO 8601 time
	 */
	savedAt: string;
}

/**
 * Response of GET EDITOR_UNIVERSES_PATH/:universeId/audit (canManageEditors()): a page of the saves
 * made in the universe's editor, newest first
 */
export interface UniverseEditListPayload
{
	edits: UniverseEdit[];

	/**
	 * How many saves there are, on every page
	 */
	total: number;
}

/**
 * A universe's settings to change. faerieMorning must be sent with passageOfTime whenever either
 * changes to or from faerie, and lobbyFaerieMorning with lobbyPassageOfTime
 */
export type UniverseSettingsUpdate = Partial<UniverseSettings>;

/**
 * How a universe plays under its ruleset, as the Ruleset tab shows and changes it: response of GET
 * EDITOR_UNIVERSES_PATH/:universeId/ruleset. A ruleset change's must be for the universe's ruleset
 */
export type RulesetSettings =
	| { ruleset: 'pf1e'; settings: Pf1eSettings }
	| { ruleset: 'sf1e'; settings: Sf1eSettings };

/**
 * A tile's settings, as the tile editor shows and changes them
 */
export interface TileSettings
{
	/**
	 * Null for a default tile that keeps its name, which players read in their language
	 * (DEFAULT_TILE_NAMES). A tile the universe added must have one
	 */
	name: string | null;

	/**
	 * Whether indoor areas can paint with the tile. A tile can be for indoors, outdoors, both or
	 * neither; one for neither can't be painted anywhere, but maps that already use it keep it
	 */
	indoors: boolean;

	/**
	 * Whether outdoor areas can paint with the tile
	 */
	outdoors: boolean;

	/**
	 * 0xRRGGBB
	 */
	color: number;

	/**
	 * The graphic the tile is drawn with (TILE_GRAPHICS), or null to draw it in its color or uploadedGraphicId
	 */
	graphic: string | null;

	/**
	 * The ID of a graphic the universe's editors uploaded (UploadedTileGraphic) that the tile is drawn
	 * with, or null. A tile has at most one of graphic and uploadedGraphicId
	 */
	uploadedGraphicId: string | null;

	/**
	 * 0-100 percent; 100 can't be seen through
	 */
	visionCost: number;

	/**
	 * Seconds of game time walking a square of the tile takes, up to MAX_WALK_SECONDS;
	 * IMPASSABLE_WALK_SECONDS can't be entered
	 */
	walkSeconds: number;

	/**
	 * Whether areas can paint with the tile; maps that already use a disabled tile keep it
	 */
	enabled: boolean;
}

/**
 * A tile as the Tilesets tab lists it
 */
export interface EditorTile extends TileSettings
{
	/**
	 * The ID maps use for the tile. An edited default tile keeps the default tile's ID
	 */
	id: number;

	/**
	 * A default tile's key, e.g. grass, which finds its name in DEFAULT_TILE_NAMES; null for a tile the
	 * universe added
	 */
	key: string | null;

	/**
	 * Whether the universe added the tile, rather than it being one of the ruleset's default tiles
	 */
	custom: boolean;

	/**
	 * Whether the tile is a default tile the universe has changed
	 */
	edited: boolean;

	/**
	 * The uploaded graphic uploadedGraphicId names, or null
	 */
	uploadedGraphic: UploadedTileGraphic | null;
}

/**
 * Whether an area can paint with a tile, as its draw tool and default tile choices offer them
 *
 * @param tile The tile
 * @param indoors Whether the area is indoors
 * @return True when the tile is enabled and for that kind of area
 */
export function canPaintTile(tile: Pick<TileSettings, 'indoors' | 'outdoors' | 'enabled'>, indoors: boolean): boolean
{
	return((tile.enabled && (indoors ? tile.indoors : tile.outdoors)));
}

/**
 * Which kinds of area can paint with a tile, as the Tilesets tab shows and filters them
 */
export const TILE_USED_IN = ['indoors', 'outdoors', 'both', 'neither'] as const;

export type TileUsedIn = typeof TILE_USED_IN[number];

/**
 * The columns the Tilesets tab can sort its tiles by. Where sorts in TILE_USED_IN's order
 */
export const TILE_SORT_COLUMNS = ['name', 'walkTime', 'visionCost', 'usedIn'] as const;

export type TileSortColumn = typeof TILE_SORT_COLUMNS[number];

/**
 * Which kinds of area can paint with a tile
 *
 * @param tile The tile
 * @return indoors or outdoors for a tile for only one, both, or neither
 */
export function tileUsedIn(tile: Pick<TileSettings, 'indoors' | 'outdoors'>): TileUsedIn
{
	if (tile.indoors && tile.outdoors)
	{
		return('both');
	}
	else if (tile.indoors)
	{
		return('indoors');
	}
	else if (tile.outdoors)
	{
		return('outdoors');
	}

	return('neither');
}

/**
 * Query parameters of GET EDITOR_UNIVERSES_PATH/:universeId/tiles. Each filter left out matches every tile
 */
export interface TileListQuery
{
	/**
	 * Part of the name, ignoring capitals
	 */
	name?: string;

	passable?: boolean;
	usedIn?: TileUsedIn;
	enabled?: boolean;
	custom?: boolean;
	edited?: boolean;

	/**
	 * The column to sort the matches by before paging, with tiles that tie sorted by name. Names sort in
	 * English, as the name filter matches them. Left out, the tiles come by ID
	 */
	sort?: TileSortColumn;

	/**
	 * Which way to sort, ascending when left out. Impassable tiles come last going up by walk time
	 */
	direction?: SortDirection;

	/**
	 * How many matching tiles to skip
	 */
	offset?: number;

	/**
	 * Most tiles to return, up to MAX_TILES_PER_PAGE (the default)
	 */
	limit?: number;
}

/**
 * Response of GET EDITOR_UNIVERSES_PATH/:universeId/tiles: a page of the matching tiles, by ID
 */
export interface TileListPayload
{
	tiles: EditorTile[];

	/**
	 * How many tiles match, on every page
	 */
	total: number;
}

/**
 * Response of GET EDITOR_UNIVERSES_PATH/:universeId/tiles/:tileId/usage: the areas whose maps use the
 * tile, in a cell or as their default tile, by name
 */
export interface TileUsagePayload
{
	areas: { id: string; name: string }[];
}

/**
 * A tile graphic a universe's editors uploaded, which its tiles can be drawn with: a sheet of its
 * format's size (TILE_GRAPHIC_SIZES), served at TILE_GRAPHICS_PATH/<id>.png
 */
export interface UploadedTileGraphic
{
	id: string;
	name: string;
	format: TileGraphicFormat;

	/**
	 * MIN_TILE_GRAPHIC_DRAW_ORDER to MAX_TILE_GRAPHIC_DRAW_ORDER for a Dual-Grid sheet (see
	 * TILE_GRAPHICS), or null for a blob sheet, which is drawn over the ground
	 */
	drawOrder: number | null;
}

/**
 * Response of GET EDITOR_UNIVERSES_PATH/:universeId/tile-graphics: by name
 */
export interface TileGraphicListPayload
{
	graphics: UploadedTileGraphic[];
}

/**
 * A tileset to upload
 */
export interface TileGraphicUploadRequest
{
	name: string;
	format: TileGraphicFormat;

	/**
	 * For a Dual-Grid sheet; null for a blob sheet (see UploadedTileGraphic)
	 */
	drawOrder: number | null;

	/**
	 * The PNG, base64-encoded: its format's size (TILE_GRAPHIC_SIZES) and at most MAX_TILE_GRAPHIC_BYTES,
	 * a Dual-Grid sheet's frames in the game's order (DUAL_GRID_FRAME_CORNERS). The server stores it
	 * re-encoded, without anything but the picture
	 */
	image: string;

	/**
	 * The uploader confirms they have the rights to use the image
	 */
	rightsConfirmed: true;
}

/**
 * An item's settings, as the item editor shows and changes them
 */
export interface ItemSettings
{
	/**
	 * Null for a default item that keeps its name, which players read in their language
	 * (DEFAULT_ITEM_NAMES). An item the universe added must have one
	 */
	name: string | null;

	/**
	 * One of the ruleset's item types (ITEM_KINDS), e.g. dagger
	 */
	type: string;

	/**
	 * Whether characters can be given the item
	 */
	enabled: boolean;
}

/**
 * An item as the Items tab lists it
 */
export interface EditorItem extends ItemSettings
{
	/**
	 * The ID everything else uses for the item. An edited default item keeps the default item's ID
	 */
	id: number;

	/**
	 * A default item's key, e.g. dagger, which finds its name in DEFAULT_ITEM_NAMES; null for an item the
	 * universe added
	 */
	key: string | null;

	/**
	 * Whether the universe added the item, rather than it being one of the ruleset's default items
	 */
	custom: boolean;

	/**
	 * Whether the item is a default item the universe has changed
	 */
	edited: boolean;
}

/**
 * The columns the Items tab can sort its items by
 */
export const ITEM_SORT_COLUMNS = ['name', 'notes'] as const;

export type ItemSortColumn = typeof ITEM_SORT_COLUMNS[number];

/**
 * Query parameters of GET EDITOR_UNIVERSES_PATH/:universeId/items. Each filter left out matches every item
 */
export interface ItemListQuery
{
	/**
	 * Part of the name, ignoring capitals
	 */
	name?: string;

	enabled?: boolean;
	custom?: boolean;
	edited?: boolean;

	/**
	 * One of the ruleset's item categories, e.g. weapon
	 */
	category?: string;

	/**
	 * One of the ruleset's item types, e.g. dagger
	 */
	type?: string;

	/**
	 * Only these items, by ID, up to MAX_STARTING_ITEMS of them (a comma-separated list in the query string)
	 */
	ids?: number[];

	/**
	 * The column to sort the matches by before paging, with items that tie sorted by name. Names sort in
	 * English, as the name filter matches them, and notes by the items' flags: those with none first, then
	 * disabled, edited and custom ones. Left out, the items come by ID
	 */
	sort?: ItemSortColumn;

	/**
	 * Which way to sort, ascending when left out
	 */
	direction?: SortDirection;

	/**
	 * How many matching items to skip
	 */
	offset?: number;

	/**
	 * Most items to return, up to MAX_ITEMS_PER_PAGE (the default)
	 */
	limit?: number;
}

/**
 * Response of GET EDITOR_UNIVERSES_PATH/:universeId/items: a page of the matching items, by ID
 */
export interface ItemListPayload
{
	items: EditorItem[];

	/**
	 * How many items match, on every page
	 */
	total: number;
}

/**
 * A number of one item, e.g. 20 arrows
 */
export interface ItemQuantity
{
	/**
	 * An item the universe can use (an EditorItem's ID)
	 */
	itemId: number;

	/**
	 * 1 to MAX_ITEM_QUANTITY
	 */
	quantity: number;
}

/**
 * What a race or class gives its characters on top of what every character of the universe starts with
 */
export interface StartingExtras
{
	/**
	 * Coins added to the universe's starting money: up to MAX_COINS of each of the ruleset's coins, and
	 * none of others
	 */
	startingMoney: Money;

	/**
	 * Items added to the universe's starting equipment, by item ID: up to MAX_STARTING_ITEMS items the
	 * universe can use, each listed once
	 */
	startingItems: ItemQuantity[];

	/**
	 * Where its characters start: one of the universe's areas other than the lobby's, or null to leave it
	 * to the next choice down (see chooseStartingArea() in server/src/logic/startingArea.ts)
	 */
	startingAreaId: string | null;

	/**
	 * The cell of the starting area its characters start nearest (see StartingCell); 0 while startingAreaId is null
	 */
	startingColumn: number;

	startingRow: number;
}

/**
 * A race's settings, as the race editor shows and changes them
 */
export interface RaceSettings extends StartingExtras
{
	/**
	 * Null for a default race that keeps its name, which players read in their language
	 * (DEFAULT_RACE_NAMES). A race the universe added must have one
	 */
	name: string | null;

	/**
	 * Whether new characters can be this race. A universe always has at least one enabled race
	 */
	enabled: boolean;

	/**
	 * While the race is disabled, whether characters already of the race may keep playing, so only new
	 * characters can't choose it; false turns them out of the lobby and their groups until it is enabled
	 * again. It has no effect while the race is enabled
	 */
	keepPlaying: boolean;

	/**
	 * The race's rules under the universe's ruleset
	 */
	rules: RaceRules;
}

/**
 * A race as the editor's list of races lists it
 */
export interface EditorRace extends RaceSettings
{
	/**
	 * The ID everything else uses for the race. An edited default race keeps the default race's ID
	 */
	id: number;

	/**
	 * A default race's key, e.g. dwarf, which finds its name in DEFAULT_RACE_NAMES; null for a race the
	 * universe added
	 */
	key: string | null;

	/**
	 * Whether the universe added the race, rather than it being one of the ruleset's default races
	 */
	custom: boolean;

	/**
	 * Whether the race is a default race the universe has changed
	 */
	edited: boolean;
}

/**
 * Response of GET EDITOR_UNIVERSES_PATH/:universeId/races: every race the universe can use, by ID
 */
export interface RaceListPayload
{
	races: EditorRace[];
}

/**
 * Where a class's characters of one race start
 */
export interface ClassRaceArea
{
	/**
	 * A race the universe can use (an EditorRace's ID)
	 */
	raceId: number;

	/**
	 * One of the universe's areas other than the lobby's
	 */
	areaId: string;

	/**
	 * The cell of the area they start nearest (see StartingCell)
	 */
	column: number;

	row: number;
}

/**
 * A class's settings, as the class editor shows and changes them
 */
export interface ClassSettings extends StartingExtras
{
	/**
	 * Null for a default class that keeps its name, which players read in their language
	 * (DEFAULT_CLASS_NAMES). A class the universe added must have one
	 */
	name: string | null;

	/**
	 * Whether new characters can be this class. A universe always has at least one enabled class
	 */
	enabled: boolean;

	/**
	 * While the class is disabled, whether characters already of the class may keep playing, as for
	 * races (RaceSettings.keepPlaying)
	 */
	keepPlaying: boolean;

	/**
	 * Where the class's characters of each race listed start, each race listed once. Must be empty while
	 * startingAreaId is set, since then every member of the class starts there
	 */
	raceAreas: ClassRaceArea[];

	/**
	 * The class's rules under the universe's ruleset
	 */
	rules: ClassRules;
}

/**
 * A class as the editor's list of classes lists it
 */
export interface EditorClass extends ClassSettings
{
	/**
	 * The ID everything else uses for the class. An edited default class keeps the default class's ID
	 */
	id: number;

	/**
	 * A default class's key, e.g. wizard, which finds its name in DEFAULT_CLASS_NAMES; null for a class
	 * the universe added
	 */
	key: string | null;

	/**
	 * Whether the universe added the class, rather than it being one of the ruleset's default classes
	 */
	custom: boolean;

	/**
	 * Whether the class is a default class the universe has changed
	 */
	edited: boolean;
}

/**
 * Response of GET EDITOR_UNIVERSES_PATH/:universeId/classes: every class the universe can use, by ID
 */
export interface ClassListPayload
{
	classes: EditorClass[];
}

/**
 * A theme's settings, as the theme editor shows and changes them
 */
export interface ThemeSettings
{
	/**
	 * Null for a default theme that keeps its name, which players read in their language
	 * (DEFAULT_THEME_NAMES). A theme the universe added must have one
	 */
	name: string | null;

	/**
	 * Whether new characters can have this theme. A universe with themes always has at least one enabled
	 */
	enabled: boolean;

	/**
	 * The theme's rules under the universe's ruleset
	 */
	rules: Sf1eThemeRules;
}

/**
 * A theme as the Characters tab lists it
 */
export interface EditorTheme extends ThemeSettings
{
	/**
	 * The ID everything else uses for the theme. An edited default theme keeps the default theme's ID
	 */
	id: number;

	/**
	 * A default theme's key, e.g. ace_pilot, which finds its name in DEFAULT_THEME_NAMES; null for a theme
	 * the universe added
	 */
	key: string | null;

	/**
	 * Whether the universe added the theme, rather than it being one of the ruleset's default themes
	 */
	custom: boolean;

	/**
	 * Whether the theme is a default theme the universe has changed
	 */
	edited: boolean;
}

/**
 * Response of GET EDITOR_UNIVERSES_PATH/:universeId/themes: every theme the universe can use, by ID
 */
export interface ThemeListPayload
{
	themes: EditorTheme[];
}

/**
 * An area's settings, as the area editor shows and changes them
 */
export interface AreaSettings
{
	name: string;

	/**
	 * Another area of the same universe, or null for a top-level area
	 */
	parentAreaId: string | null;

	enabled: boolean;
	indoors: boolean;

	/**
	 * How light the area is while it is indoors; kept while it is outdoors, where it has no effect
	 */
	lightLevel: AreaLightLevel;

	/**
	 * A tile the universe can use (an EditorTile's ID)
	 */
	defaultTileId: number;

	passageOfTime: AreaPassageOfTime;

	/**
	 * Set exactly when passageOfTime is faerie
	 */
	faerieMorning: FaerieMorning | null;

	/**
	 * An area whose passage of time is faerie can't loop
	 */
	loopsEastWest: boolean;

	loopsNorthSouth: boolean;
}

/**
 * An area as the Areas tab lists it
 */
export interface EditorAreaSummary
{
	id: string;
	name: string;
	parentAreaId: string | null;
	enabled: boolean;
	indoors: boolean;
}

/**
 * Response of GET EDITOR_UNIVERSES_PATH/:universeId/areas: every area of the universe, by name
 */
export interface AreaListPayload
{
	areas: EditorAreaSummary[];
	lobbyAreaId: string | null;
	startingAreaId: string | null;

	/**
	 * Every area that is a starting area: the universe's, its races' and classes', and its classes' for
	 * each race. None of them may be the lobby's area
	 */
	startingAreaIds: string[];
}

/**
 * Response of GET EDITOR_UNIVERSES_PATH/:universeId/areas/:areaId
 */
export interface EditorArea extends AreaSettings
{
	id: string;
	bounds: MapBounds;
}

/**
 * A new area's settings. Settings left out take their defaults: enabled while the universe is
 * in_the_beginning, outdoors, the default tile grass outdoors or wood floor indoors, inherit time, not
 * looping, and a map of NEW_AREA_BOUNDS
 */
export type NewAreaRequest = Pick<AreaSettings, 'name'> & Partial<AreaSettings>;

/**
 * Area settings to change. faerieMorning must be sent with passageOfTime whenever either changes to or
 * from faerie
 */
export type AreaSettingsUpdate = Partial<AreaSettings>;

/**
 * What giving an area's map smaller bounds would discard
 */
export interface ResizeConflict
{
	/**
	 * Cells outside the new bounds that aren't the default tile
	 */
	discardedCells: number;

	/**
	 * Links on cells outside the new bounds, and links from other areas into them
	 */
	discardedLinks: number;
}

/**
 * Query parameters of GET EDITOR_UNIVERSES_PATH/:universeId/areas/:areaId/chunks: a rectangle of
 * chunks, inclusive at both ends, covering at most MAX_CHUNKS_PER_REQUEST chunks
 */
export interface ChunkRange
{
	minChunkColumn: number;
	minChunkRow: number;
	maxChunkColumn: number;
	maxChunkRow: number;
}

/**
 * Response of GET EDITOR_UNIVERSES_PATH/:universeId/areas/:areaId/chunks: the stored chunks in the
 * range. A chunk that isn't listed is all the area's default tile
 */
export interface ChunkListPayload
{
	chunks: AreaChunk[];
}

/**
 * One cell to change: its column, its row, and its new value (a tile the universe can use,
 * DEFAULT_TILE_CELL or VOID_CELL)
 */
export type CellChange = [column: number, row: number, value: number];

/**
 * Where an area link goes and how it is taken
 */
export interface AreaLinkTarget
{
	/**
	 * Another area of the same universe
	 */
	targetAreaId: string;

	/**
	 * A cell inside the target area's bounds
	 */
	targetColumn: number;

	targetRow: number;
	mode: AreaLinkMode;

	/**
	 * The link can only be used while every member of the group is present
	 */
	requiresWholeGroup: boolean;
}

/**
 * An area link as the editor shows it
 */
export interface EditorAreaLink extends AreaLinkTarget
{
	column: number;
	row: number;
}

/**
 * Response of GET EDITOR_UNIVERSES_PATH/:universeId/areas/:areaId/links: the links on the area's
 * cells, by row then column
 */
export interface AreaLinkListPayload
{
	links: EditorAreaLink[];
}
