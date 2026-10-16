/**
 * The world editor's REST API: routes, limits, and the requests and responses each route takes
 *
 * Every route needs a logged-in browser, and answers { error } with 400 for a request that fails
 * validation, 401 when the browser isn't logged in, 403 when the player's role doesn't allow the
 * change, 404 for something that doesn't exist and 409 for a change that conflicts with what is
 * there. Writes from a browser must come from an origin in the server's ALLOWED_ORIGINS
 */
import type { MapBounds } from './maps.js';
import type { ZoneChunk } from './messages.js';
import type { FaerieMorning, PassageOfTime, Ruleset, UniverseRole, UniverseStage, ZoneLinkMode, ZonePassageOfTime } from './universes.js';

/**
 * Base of every editor route. Under it, with :universeId and :zoneId standing for IDs:
 *
 * - GET    /                                       EditableUniverseListPayload: the universes the player has a role in
 * - POST   /                                       NewUniverseRequest -> CreatedPayload: a universe the player creates
 * - GET    /:universeId                            EditableUniverse
 * - PATCH  /:universeId                            UniverseSettingsUpdate (creators only)
 * - GET    /:universeId/tiles                      TileListQuery as query parameters -> TileListPayload
 * - POST   /:universeId/tiles                      TileSettings -> CreatedPayload: a custom tile
 * - PUT    /:universeId/tiles/:tileId              TileSettings: edits a custom tile, or stores an edited copy of a default tile
 * - DELETE /:universeId/tiles/:tileId              deletes a custom tile nothing uses, or restores a default tile
 * - GET    /:universeId/zones                      ZoneListPayload
 * - POST   /:universeId/zones                      NewZoneRequest -> CreatedPayload
 * - GET    /:universeId/zones/:zoneId              EditorZone
 * - PATCH  /:universeId/zones/:zoneId              ZoneSettingsUpdate
 * - DELETE /:universeId/zones/:zoneId              deletes a zone that isn't the lobby or starting zone
 * - PUT    /:universeId/zones/:zoneId/bounds       ResizeZoneRequest; 409 with ResizeConflictPayload when it would discard anything
 * - GET    /:universeId/zones/:zoneId/chunks       ChunkRange as query parameters -> ChunkListPayload
 * - PATCH  /:universeId/zones/:zoneId/cells        CellEditRequest
 * - GET    /:universeId/zones/:zoneId/links        ZoneLinkListPayload
 * - PUT    /:universeId/zones/:zoneId/links/:column/:row  ZoneLinkTarget: adds or replaces the cell's link
 * - DELETE /:universeId/zones/:zoneId/links/:column/:row
 *
 * Every route except the list and create needs a role in the universe. Changing the universe's
 * settings needs canEditUniverseSettings(), and everything else that changes it needs canEditWorld()
 */
export const EDITOR_UNIVERSES_PATH = '/editor/universes';

/**
 * Most universes one player may create
 */
export const MAX_CREATED_UNIVERSES = 5;

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
 * Most characters in a zone's name
 */
export const MAX_ZONE_NAME_LENGTH = 60;

/**
 * Most zones in one universe
 */
export const MAX_ZONES = 1000;

/**
 * The map a new zone starts with: one screen's worth of cells around column 0, row 0
 */
export const NEW_ZONE_BOUNDS: Readonly<MapBounds> = {
	minColumn: -15,
	minRow: -8,
	maxColumn: 15,
	maxRow: 8
};

/**
 * Most cells one CellEditRequest may change; the editor splits a larger edit into several requests
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
}

/**
 * Body of POST EDITOR_UNIVERSES_PATH: what the Create Universe dialog asks for
 *
 * The new universe is in_the_beginning, with a lobby zone and a starting zone, and the player is its creator
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
}

/**
 * Response of GET EDITOR_UNIVERSES_PATH/:universeId
 */
export interface EditableUniverse extends UniverseSettings
{
	id: string;
	ruleset: Ruleset;
	lobbyZoneId: string | null;
	startingZoneId: string | null;

	/**
	 * The player's role, which decides what they may change
	 */
	role: UniverseRole;
}

/**
 * Body of PATCH EDITOR_UNIVERSES_PATH/:universeId: the settings to change. faerieMorning must be
 * sent with passageOfTime whenever either changes to or from faerie
 */
export type UniverseSettingsUpdate = Partial<UniverseSettings>;

/**
 * A tile's settings, as the tile editor shows and changes them
 */
export interface TileSettings
{
	name: string;
	indoors: boolean;

	/**
	 * 0xRRGGBB
	 */
	color: number;

	/**
	 * 0-100 percent; 100 can't be seen through
	 */
	visionCost: number;

	/**
	 * 0-IMPASSABLE_COST percent; 50 takes twice as long, IMPASSABLE_COST can't be entered
	 */
	movementCost: number;
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
	 * Whether the universe added the tile, rather than it being one of the ruleset's default tiles
	 */
	custom: boolean;

	/**
	 * Whether the tile is a default tile the universe has changed
	 */
	edited: boolean;
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
	custom?: boolean;
	edited?: boolean;

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
 * A zone's settings, as the zone editor shows and changes them
 */
export interface ZoneSettings
{
	name: string;

	/**
	 * Another zone of the same universe, or null for a top-level zone
	 */
	parentZoneId: string | null;

	enabled: boolean;
	indoors: boolean;

	/**
	 * A tile the universe can use (an EditorTile's ID)
	 */
	defaultTileId: number;

	passageOfTime: ZonePassageOfTime;

	/**
	 * Set exactly when passageOfTime is faerie
	 */
	faerieMorning: FaerieMorning | null;

	/**
	 * A zone whose passage of time is faerie can't loop
	 */
	loopsEastWest: boolean;

	loopsNorthSouth: boolean;
}

/**
 * A zone as the Zones tab lists it
 */
export interface EditorZoneSummary
{
	id: string;
	name: string;
	parentZoneId: string | null;
	enabled: boolean;
	indoors: boolean;
}

/**
 * Response of GET EDITOR_UNIVERSES_PATH/:universeId/zones: every zone of the universe, by name
 */
export interface ZoneListPayload
{
	zones: EditorZoneSummary[];
	lobbyZoneId: string | null;
	startingZoneId: string | null;
}

/**
 * Response of GET EDITOR_UNIVERSES_PATH/:universeId/zones/:zoneId
 */
export interface EditorZone extends ZoneSettings
{
	id: string;
	bounds: MapBounds;
}

/**
 * Body of POST EDITOR_UNIVERSES_PATH/:universeId/zones. Settings left out take their defaults: enabled
 * while the universe is in_the_beginning, outdoors, the default tile grass outdoors or wood floor indoors,
 * inherit time, not looping, and a map of NEW_ZONE_BOUNDS
 */
export type NewZoneRequest = Pick<ZoneSettings, 'name'> & Partial<ZoneSettings>;

/**
 * Body of PATCH EDITOR_UNIVERSES_PATH/:universeId/zones/:zoneId: the settings to change. faerieMorning
 * must be sent with passageOfTime whenever either changes to or from faerie
 */
export type ZoneSettingsUpdate = Partial<ZoneSettings>;

/**
 * Body of PUT EDITOR_UNIVERSES_PATH/:universeId/zones/:zoneId/bounds
 *
 * Each side may be at most MAX_MAP_SIDE cells long, and the map must still hold column 0, row 0
 */
export interface ResizeZoneRequest
{
	bounds: MapBounds;

	/**
	 * Whether to go ahead when shrinking the map would discard cells that aren't the default tile, or
	 * links on or into the cells it loses. When false, such a resize answers 409 and changes nothing
	 */
	discard: boolean;
}

/**
 * Body of the 409 answer to a ResizeZoneRequest that would discard something
 */
export interface ResizeConflictPayload
{
	error: string;

	/**
	 * Cells outside the new bounds that aren't the default tile
	 */
	discardedCells: number;

	/**
	 * Links on cells outside the new bounds, and links from other zones into them
	 */
	discardedLinks: number;
}

/**
 * Query parameters of GET EDITOR_UNIVERSES_PATH/:universeId/zones/:zoneId/chunks: a rectangle of
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
 * Response of GET EDITOR_UNIVERSES_PATH/:universeId/zones/:zoneId/chunks: the stored chunks in the
 * range. A chunk that isn't listed is all the zone's default tile
 */
export interface ChunkListPayload
{
	chunks: ZoneChunk[];
}

/**
 * One cell to change: its column, its row, and its new value (a tile the universe can use,
 * DEFAULT_TILE_CELL or VOID_CELL)
 */
export type CellChange = [column: number, row: number, value: number];

/**
 * Body of PATCH EDITOR_UNIVERSES_PATH/:universeId/zones/:zoneId/cells: up to MAX_CELL_CHANGES cells
 * inside the zone's bounds. A cell listed twice takes the later value
 */
export interface CellEditRequest
{
	changes: CellChange[];
}

/**
 * Where a zone link goes and how it is taken
 */
export interface ZoneLinkTarget
{
	/**
	 * Another zone of the same universe
	 */
	targetZoneId: string;

	/**
	 * A cell inside the target zone's bounds
	 */
	targetColumn: number;

	targetRow: number;
	mode: ZoneLinkMode;

	/**
	 * The link can only be used while every member of the group is present
	 */
	requiresWholeGroup: boolean;
}

/**
 * A zone link as the editor shows it
 */
export interface EditorZoneLink extends ZoneLinkTarget
{
	column: number;
	row: number;
}

/**
 * Response of GET EDITOR_UNIVERSES_PATH/:universeId/zones/:zoneId/links: the links on the zone's
 * cells, by row then column
 */
export interface ZoneLinkListPayload
{
	links: EditorZoneLink[];
}
