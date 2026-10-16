/**
 * Validators for the world editor's request bodies and query parameters (see shared/src/editor.ts)
 *
 * Each one must accept exactly the matching interface in /shared; `satisfies` makes the compiler check
 * that. Unknown keys are stripped rather than rejected. These check each value on its own; checks that
 * need the database (such as whether a tile belongs to the universe) are made by the routes
 */
import { z } from 'zod';
import { DISALLOWED_TEXT_CHARACTERS, FAERIE_MORNINGS, IMPASSABLE_COST, MAX_CELL_CHANGES, MAX_CHUNKS_PER_REQUEST, MAX_GROUP_PLAYERS, MAX_LONG_DESCRIPTION_LENGTH, MAX_MAP_SIDE, MAX_SHORT_DESCRIPTION_LENGTH, MAX_TILE_NAME_LENGTH, MAX_TILES_PER_PAGE, MAX_UNIVERSE_NAME_LENGTH, MAX_ZONE_NAME_LENGTH, MIN_GROUP_SIZE, PASSAGES_OF_TIME, PF1E_MAX_COINS, PF1E_MAX_POINT_BUY_BUDGET, PF1E_MIN_POINT_BUY_BUDGET, PF1E_STAT_METHODS, RULESETS, UNIVERSE_STAGES, VOID_CELL, ZONE_LINK_MODES, ZONE_PASSAGES_OF_TIME, type CellEditRequest, type ChunkRange, type MapBounds, type NewUniverseRequest, type NewZoneRequest, type ResizeZoneRequest, type RulesetSettings, type TileListQuery, type TileSettings, type UniverseSettingsUpdate, type ZoneLinkTarget, type ZoneSettingsUpdate } from '@multiverse-kiln/shared';

import { displayText } from '../rooms/payloads.js';

/**
 * A cell's column or row: generous enough for any map, and small enough for the database
 */
const cellCoordinate = z.number().int().min(-MAX_MAP_SIDE).max(MAX_MAP_SIDE);

/**
 * A cell's column or row in a path or query string
 */
const cellCoordinateText = z.coerce.number().int().min(-MAX_MAP_SIDE).max(MAX_MAP_SIDE);

/**
 * A true or false query parameter
 */
const booleanText = z.enum(['true', 'false']).transform((value) => (value === 'true'));

/**
 * Text that may be empty, trimmed and free of disallowed characters
 */
const shortDescription = z.string().trim().max(MAX_SHORT_DESCRIPTION_LENGTH).refine((text) => !DISALLOWED_TEXT_CHARACTERS.test(text), 'Contains disallowed characters');

/**
 * Markdown: line breaks and tabs are allowed, other disallowed characters aren't
 */
const longDescription = z.string().max(MAX_LONG_DESCRIPTION_LENGTH).refine((text) => !DISALLOWED_TEXT_CHARACTERS.test(text.replace(/[\t\n\r]/g, '')), 'Contains disallowed characters');

/**
 * How many pieces of one coin an amount of money holds
 */
const coinCount = z.number().int().min(0).max(PF1E_MAX_COINS);

/**
 * A tile ID in a path
 */
export const tileIdParameter = z.coerce.number().int().min(1).max(2147483647);

/**
 * A cell in a path: /:column/:row
 */
export const cellParameters = z.object({
	column: cellCoordinateText,
	row: cellCoordinateText
});

/**
 * NewUniverseRequest
 */
export const newUniverseRequest = z.object({
	name: displayText(MAX_UNIVERSE_NAME_LENGTH),
	shortDescription,
	ruleset: z.enum(RULESETS)
}) satisfies z.ZodType<NewUniverseRequest>;

/**
 * UniverseSettingsUpdate
 */
export const universeSettingsUpdate = z.object({
	name: displayText(MAX_UNIVERSE_NAME_LENGTH).optional(),
	shortDescription: shortDescription.optional(),
	longDescription: longDescription.optional(),
	stage: z.enum(UNIVERSE_STAGES).optional(),
	passageOfTime: z.enum(PASSAGES_OF_TIME).optional(),
	faerieMorning: z.enum(FAERIE_MORNINGS).nullable().optional(),
	groupSize: z.number().int().min(MIN_GROUP_SIZE).max(MAX_GROUP_PLAYERS).optional(),
	startingMoney: z.object({
		pp: coinCount,
		gp: coinCount,
		sp: coinCount,
		cp: coinCount
	}).optional(),
	startingZoneId: z.uuid().optional()
}) satisfies z.ZodType<UniverseSettingsUpdate>;

/**
 * RulesetSettings
 */
export const rulesetSettings = z.object({
	ruleset: z.literal('pf1e'),
	settings: z.object({
		statMethod: z.enum(PF1E_STAT_METHODS),
		customPointBuyBudget: z.number().int().min(PF1E_MIN_POINT_BUY_BUDGET).max(PF1E_MAX_POINT_BUY_BUDGET),
		needsSleep: z.boolean(),
		coinsHaveWeight: z.boolean(),
		tracksAmmo: z.boolean()
	})
}) satisfies z.ZodType<RulesetSettings>;

/**
 * TileSettings
 */
export const tileSettings = z.object({
	name: displayText(MAX_TILE_NAME_LENGTH).nullable(),
	indoors: z.boolean(),
	color: z.number().int().min(0).max(0xFFFFFF),
	visionCost: z.number().int().min(0).max(100),
	movementCost: z.number().int().min(0).max(IMPASSABLE_COST)
}) satisfies z.ZodType<TileSettings>;

/**
 * TileListQuery, from query parameters
 */
export const tileListQuery = z.object({
	name: z.string().trim().max(MAX_TILE_NAME_LENGTH).optional(),
	passable: booleanText.optional(),
	custom: booleanText.optional(),
	edited: booleanText.optional(),
	offset: z.coerce.number().int().min(0).default(0),
	limit: z.coerce.number().int().min(1).max(MAX_TILES_PER_PAGE).default(MAX_TILES_PER_PAGE)
}) satisfies z.ZodType<TileListQuery, unknown>;

/**
 * The settings a zone may be created with or changed to, each optional
 */
const zoneSettingsFields = {
	name: displayText(MAX_ZONE_NAME_LENGTH).optional(),
	parentZoneId: z.uuid().nullable().optional(),
	enabled: z.boolean().optional(),
	indoors: z.boolean().optional(),
	defaultTileId: tileIdParameter.optional(),
	passageOfTime: z.enum(ZONE_PASSAGES_OF_TIME).optional(),
	faerieMorning: z.enum(FAERIE_MORNINGS).nullable().optional(),
	loopsEastWest: z.boolean().optional(),
	loopsNorthSouth: z.boolean().optional()
};

/**
 * NewZoneRequest
 */
export const newZoneRequest = z.object({
	...zoneSettingsFields,
	name: displayText(MAX_ZONE_NAME_LENGTH)
}) satisfies z.ZodType<NewZoneRequest>;

/**
 * ZoneSettingsUpdate
 */
export const zoneSettingsUpdate = z.object(zoneSettingsFields) satisfies z.ZodType<ZoneSettingsUpdate>;

/**
 * MapBounds a map may have: each side at most MAX_MAP_SIDE cells, holding column 0, row 0
 */
const mapBounds = z.object({
	minColumn: cellCoordinate.max(0),
	minRow: cellCoordinate.max(0),
	maxColumn: cellCoordinate.min(0),
	maxRow: cellCoordinate.min(0)
})
	.refine((bounds) => ((bounds.maxColumn - bounds.minColumn) < MAX_MAP_SIDE), `The map can be at most ${MAX_MAP_SIDE} cells wide`)
	.refine((bounds) => ((bounds.maxRow - bounds.minRow) < MAX_MAP_SIDE), `The map can be at most ${MAX_MAP_SIDE} cells tall`) satisfies z.ZodType<MapBounds>;

/**
 * ResizeZoneRequest
 */
export const resizeZoneRequest = z.object({
	bounds: mapBounds,
	discard: z.boolean()
}) satisfies z.ZodType<ResizeZoneRequest>;

/**
 * ChunkRange, from query parameters
 */
export const chunkRange = z.object({
	minChunkColumn: cellCoordinateText,
	minChunkRow: cellCoordinateText,
	maxChunkColumn: cellCoordinateText,
	maxChunkRow: cellCoordinateText
})
	.refine((range) => ((range.maxChunkColumn >= range.minChunkColumn) && (range.maxChunkRow >= range.minChunkRow)), 'Each maximum must be at least its minimum')
	.refine((range) => (((range.maxChunkColumn - range.minChunkColumn + 1) * (range.maxChunkRow - range.minChunkRow + 1)) <= MAX_CHUNKS_PER_REQUEST), `The range can cover at most ${MAX_CHUNKS_PER_REQUEST} chunks`) satisfies z.ZodType<ChunkRange, unknown>;

/**
 * CellEditRequest. Whether each value is a tile the universe can use is checked by the route
 */
export const cellEditRequest = z.object({
	changes: z.array(z.tuple([cellCoordinate, cellCoordinate, z.number().int().min(VOID_CELL).max(2147483647)])).min(1).max(MAX_CELL_CHANGES)
}) satisfies z.ZodType<CellEditRequest>;

/**
 * ZoneLinkTarget
 */
export const zoneLinkTarget = z.object({
	targetZoneId: z.uuid(),
	targetColumn: cellCoordinate,
	targetRow: cellCoordinate,
	mode: z.enum(ZONE_LINK_MODES),
	requiresWholeGroup: z.boolean()
}) satisfies z.ZodType<ZoneLinkTarget>;
