/**
 * The world editor's REST API: routes, limits, and the requests and responses each route takes
 *
 * Every route needs a logged-in browser, and answers an ErrorPayload with 400 for a request that fails
 * validation, 401 when the browser isn't logged in, 403 when the player's role doesn't allow the
 * change, 404 for something that doesn't exist and 409 for a change that conflicts with what is
 * there. Writes from a browser must come from an origin in the server's ALLOWED_ORIGINS
 */
import type { LocalizedMessage } from './localization.js';
import type { MapBounds } from './maps.js';
import type { AreaChunk } from './messages.js';
import type { Money } from './money.js';
import type { ClassRules, RaceRules } from './racesAndClasses.js';
import type { Pf1eSettings } from './rulesets/pf1e/settings.js';
import type { Sf1eSettings } from './rulesets/sf1e/settings.js';
import type { Sf1eThemeRules } from './rulesets/sf1e/themes.js';
import type { SortDirection } from './sorting.js';
import type { TileGraphicFormat } from './tileGraphics.js';
import type { DisplayTime, FaerieMorning, LobbyPassageOfTime, PassageOfTime, Ruleset, UniverseRole, UniverseStage, AreaLightLevel, AreaLinkMode, AreaPassageOfTime } from './universes.js';

/**
 * Base of every editor route. Under it, with :universeId and :areaId standing for IDs:
 *
 * - GET    /                                       EditableUniverseListPayload: the universes the player has a role in
 * - POST   /                                       NewUniverseRequest -> CreatedPayload: a universe the player creates
 * - GET    /:universeId                            EditableUniverse
 * - POST   /:universeId/changes                    SaveChangesRequest -> SaveChangesPayload: saves the editor's changes, all or nothing (see editorChanges.ts)
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
	stage: UniverseStage;
	role: UniverseRole;
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

	stage: UniverseStage;
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
	 * Most characters in one group, from MIN_GROUP_SIZE to MAX_GROUP_PLAYERS
	 */
	groupSize: number;

	/**
	 * The coins every character starts with: up to MAX_COINS of each of the ruleset's coins, and none of others
	 */
	startingMoney: Money;

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
 * Response of GET EDITOR_UNIVERSES_PATH/:universeId
 */
export interface EditableUniverse extends UniverseSettings
{
	id: string;

	/**
	 * The name in the form its page's address uses (universeSlug)
	 */
	slug: string;

	ruleset: Ruleset;
	lobbyAreaId: string | null;

	/**
	 * The player's role, which decides what they may change
	 */
	role: UniverseRole;
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
	 * The PNG, base64-encoded: its format's size (TILE_GRAPHIC_SIZES) and at most MAX_TILE_GRAPHIC_BYTES.
	 * The server stores it re-encoded, without anything but the picture
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
