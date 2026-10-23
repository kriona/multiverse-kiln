/**
 * Validators for the world editor's request bodies and query parameters (see shared/src/editor.ts)
 *
 * Each one must accept exactly the matching interface in /shared; `satisfies` makes the compiler check
 * that. Unknown keys are stripped rather than rejected. These check each value on its own; checks that
 * need the database (such as whether a tile belongs to the universe) are made by the routes
 */
import { z } from 'zod';
import { DEFAULT_RACE_NAMES, DISALLOWED_TEXT_CHARACTERS, TILE_USED_IN,DISPLAY_TIMES,FAERIE_MORNINGS, LOBBY_PASSAGES_OF_TIME, MAX_LOBBY_DAY_HOURS, MIN_LOBBY_DAY_HOURS, isRulesetMoney, MAX_CELL_CHANGES, MAX_CHUNKS_PER_REQUEST, MAX_CLASS_NAME_LENGTH, MAX_COINS, MAX_CUSTOM_RACES, MAX_GROUP_PLAYERS, MAX_ITEM_NAME_LENGTH, MAX_ITEM_QUANTITY, MAX_ITEMS_PER_PAGE, MAX_LONG_DESCRIPTION_LENGTH, MAX_MAP_SIDE, MAX_RACE_NAME_LENGTH, MAX_SHORT_DESCRIPTION_LENGTH, MAX_STARTING_ITEMS, MAX_THEME_NAME_LENGTH, MAX_TILE_NAME_LENGTH, MAX_TILES_PER_PAGE, MAX_WALK_SECONDS,MAX_UNIVERSE_NAME_LENGTH, MAX_AREA_NAME_LENGTH, MIN_GROUP_SIZE, PASSAGES_OF_TIME, PF1E_ABILITIES, PF1E_CASTING_STYLES, PF1E_MAGIC_TRADITIONS, PF1E_MAX_POINT_BUY_BUDGET, PF1E_MAX_RACE_ABILITY_MODIFIER, PF1E_MIN_POINT_BUY_BUDGET, PF1E_MIN_RACE_ABILITY_MODIFIER, PF1E_SIZES, PF1E_STAT_METHODS, RULESETS, SF1E_ABILITIES, SF1E_MAX_ABILITY_POINTS, SF1E_MAX_CLASS_POINTS, SF1E_MAX_RACE_ABILITY_MODIFIER, SF1E_MAX_RACE_HIT_POINTS, SF1E_MIN_ABILITY_POINTS, SF1E_MIN_CLASS_POINTS, SF1E_MIN_RACE_ABILITY_MODIFIER, SF1E_MIN_RACE_HIT_POINTS, SF1E_SIZES, UNIVERSE_STAGES, universeSlug, VOID_CELL, AREA_LIGHT_LEVELS, AREA_LINK_MODES, AREA_PASSAGES_OF_TIME, type CellEditRequest, type ChunkRange, type ClassSettings, type ItemListQuery, type ItemSettings, type MapBounds, type NewUniverseRequest, type NewAreaRequest, type RaceSettings, type ResizeAreaRequest, type Ruleset, type RulesetSettings, type ThemeSettings, type TileListQuery, type TileSettings, type UniverseSettingsUpdate, type AreaLinkTarget, type AreaSettingsUpdate } from '@multiverse-kiln/shared';

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
const coinCount = z.number().int().min(0).max(MAX_COINS);

/**
 * An amount of money in a ruleset, as pieces of each coin, with none of other rulesets' coins
 *
 * @param ruleset The universe's ruleset
 * @return The validator
 */
function money(ruleset: Ruleset)
{
	return(z.object({
		pp: coinCount,
		gp: coinCount,
		sp: coinCount,
		cp: coinCount,
		cr: coinCount
	})
		.refine((amount) => isRulesetMoney(amount, ruleset), 'Holds coins the universe\'s ruleset doesn\'t use'));
}

/**
 * A validator for each ruleset
 *
 * @param make Makes the validator for one ruleset
 * @return The validators, by ruleset
 */
function byRuleset<T>(make: (ruleset: Ruleset) => T): Record<Ruleset, T>
{
	return(Object.fromEntries(RULESETS.map((ruleset) => [ruleset, make(ruleset)])) as Record<Ruleset, T>);
}

/**
 * A list of items and how many of each, each listed once. Whether the universe can use each item is
 * checked by the route
 */
const startingItemList = z.array(z.object({
	itemId: z.number().int().min(1).max(2147483647),
	quantity: z.number().int().min(1).max(MAX_ITEM_QUANTITY)
}))
	.max(MAX_STARTING_ITEMS)
	.refine((items) => (new Set(items.map((item) => item.itemId)).size === items.length), 'Each item can be listed only once');

/**
 * A tile ID in a path
 */
export const tileIdParameter = z.coerce.number().int().min(1).max(2147483647);

/**
 * An item ID in a path
 */
export const itemIdParameter = z.coerce.number().int().min(1).max(2147483647);

/**
 * The key of an item type or category. Whether the universe's ruleset has it is checked by the route
 */
const itemKindKey = z.string().trim().min(1).max(40);

/**
 * A cell in a path: /:column/:row
 */
export const cellParameters = z.object({
	column: cellCoordinateText,
	row: cellCoordinateText
});

/**
 * A universe's name, which needs a letter or digit for its slug (the part of its page's address that names it)
 */
const universeName = displayText(MAX_UNIVERSE_NAME_LENGTH).refine((name) => (universeSlug(name) !== ''), 'Has no letters or digits');

/**
 * NewUniverseRequest
 */
export const newUniverseRequest = z.object({
	name: universeName,
	shortDescription,
	ruleset: z.enum(RULESETS)
}) satisfies z.ZodType<NewUniverseRequest>;

/**
 * UniverseSettingsUpdate, by the universe's ruleset
 */
export const universeSettingsUpdate = byRuleset((ruleset) => z.object({
	name: universeName.optional(),
	shortDescription: shortDescription.optional(),
	longDescription: longDescription.optional(),
	stage: z.enum(UNIVERSE_STAGES).optional(),
	passageOfTime: z.enum(PASSAGES_OF_TIME).optional(),
	faerieMorning: z.enum(FAERIE_MORNINGS).nullable().optional(),
	displayTime: z.enum(DISPLAY_TIMES).optional(),
	lobbyPassageOfTime: z.enum(LOBBY_PASSAGES_OF_TIME).optional(),
	lobbyDayHours: z.number().int().min(MIN_LOBBY_DAY_HOURS).max(MAX_LOBBY_DAY_HOURS).optional(),
	lobbyFaerieMorning: z.enum(FAERIE_MORNINGS).nullable().optional(),
	lobbyNoVisionCost: z.boolean().optional(),
	groupSize: z.number().int().min(MIN_GROUP_SIZE).max(MAX_GROUP_PLAYERS).optional(),
	startingMoney: money(ruleset).optional(),
	startingItems: startingItemList.optional(),
	startingAreaId: z.uuid().optional()
}) satisfies z.ZodType<UniverseSettingsUpdate>);

/**
 * RulesetSettings
 */
export const rulesetSettings = z.discriminatedUnion('ruleset', [
	z.object({
		ruleset: z.literal('pf1e'),
		settings: z.object({
			statMethod: z.enum(PF1E_STAT_METHODS),
			customPointBuyBudget: z.number().int().min(PF1E_MIN_POINT_BUY_BUDGET).max(PF1E_MAX_POINT_BUY_BUDGET),
			needsSleep: z.boolean(),
			coinsHaveWeight: z.boolean(),
			tracksAmmo: z.boolean()
		})
	}),
	z.object({
		ruleset: z.literal('sf1e'),
		settings: z.object({
			abilityPoints: z.number().int().min(SF1E_MIN_ABILITY_POINTS).max(SF1E_MAX_ABILITY_POINTS),
			needsSleep: z.boolean(),
			tracksAmmo: z.boolean()
		})
	})
]) satisfies z.ZodType<RulesetSettings>;

/**
 * TileSettings
 */
export const tileSettings = z.object({
	name: displayText(MAX_TILE_NAME_LENGTH).nullable(),
	indoors: z.boolean(),
	outdoors: z.boolean(),
	color: z.number().int().min(0).max(0xFFFFFF),
	visionCost: z.number().int().min(0).max(100),
	walkSeconds: z.number().int().min(0).max(MAX_WALK_SECONDS)
}) satisfies z.ZodType<TileSettings>;

/**
 * TileListQuery, from query parameters
 */
export const tileListQuery = z.object({
	name: z.string().trim().max(MAX_TILE_NAME_LENGTH).optional(),
	passable: booleanText.optional(),
	usedIn: z.enum(TILE_USED_IN).optional(),
	custom: booleanText.optional(),
	edited: booleanText.optional(),
	offset: z.coerce.number().int().min(0).default(0),
	limit: z.coerce.number().int().min(1).max(MAX_TILES_PER_PAGE).default(MAX_TILES_PER_PAGE)
}) satisfies z.ZodType<TileListQuery, unknown>;

/**
 * ItemSettings
 */
export const itemSettings = z.object({
	name: displayText(MAX_ITEM_NAME_LENGTH).nullable(),
	type: itemKindKey,
	enabled: z.boolean()
}) satisfies z.ZodType<ItemSettings>;

/**
 * ItemListQuery, from query parameters
 */
export const itemListQuery = z.object({
	name: z.string().trim().max(MAX_ITEM_NAME_LENGTH).optional(),
	enabled: booleanText.optional(),
	custom: booleanText.optional(),
	edited: booleanText.optional(),
	category: itemKindKey.optional(),
	type: itemKindKey.optional(),
	ids: z.string()
		.transform((text) => text.split(',').map(Number))
		.pipe(z.array(z.number().int().min(1).max(2147483647)).min(1).max(MAX_STARTING_ITEMS))
		.optional(),
	offset: z.coerce.number().int().min(0).default(0),
	limit: z.coerce.number().int().min(1).max(MAX_ITEMS_PER_PAGE).default(MAX_ITEMS_PER_PAGE)
}) satisfies z.ZodType<ItemListQuery, unknown>;

/**
 * A race ID in a path
 */
export const raceIdParameter = z.coerce.number().int().min(1).max(2147483647);

/**
 * A class ID in a path
 */
export const classIdParameter = z.coerce.number().int().min(1).max(2147483647);

/**
 * A theme ID in a path
 */
export const themeIdParameter = z.coerce.number().int().min(1).max(2147483647);

/**
 * A modifier for each ability, each a whole number in a range
 *
 * @param min The lowest modifier
 * @param max The highest modifier
 * @return The validator
 */
function abilityModifiers(min: number, max: number)
{
	const modifier = z.number().int().min(min).max(max);

	return(z.object({
		strength: modifier,
		dexterity: modifier,
		constitution: modifier,
		intelligence: modifier,
		wisdom: modifier,
		charisma: modifier
	}));
}

/**
 * Each ruleset's race rules
 */
const raceRules = {
	pf1e: z.object({
		abilityModifiers: abilityModifiers(PF1E_MIN_RACE_ABILITY_MODIFIER, PF1E_MAX_RACE_ABILITY_MODIFIER),
		floatingBonus: z.boolean(),
		darkvision: z.boolean(),
		size: z.enum(PF1E_SIZES)
	}),
	sf1e: z.object({
		abilityModifiers: abilityModifiers(SF1E_MIN_RACE_ABILITY_MODIFIER, SF1E_MAX_RACE_ABILITY_MODIFIER),
		floatingBonus: z.boolean(),
		darkvision: z.boolean(),
		size: z.enum(SF1E_SIZES),
		hitPoints: z.number().int().min(SF1E_MIN_RACE_HIT_POINTS).max(SF1E_MAX_RACE_HIT_POINTS)
	})
};

/**
 * Each ruleset's class rules
 */
const classRules = {
	pf1e: z.object({
		primaryAbility: z.enum(PF1E_ABILITIES),
		tradition: z.enum(PF1E_MAGIC_TRADITIONS),
		castingStyle: z.enum(PF1E_CASTING_STYLES)
	}),
	sf1e: z.object({
		keyAbility: z.enum(SF1E_ABILITIES),
		hitPoints: z.number().int().min(SF1E_MIN_CLASS_POINTS).max(SF1E_MAX_CLASS_POINTS),
		staminaPoints: z.number().int().min(SF1E_MIN_CLASS_POINTS).max(SF1E_MAX_CLASS_POINTS)
	})
};

/**
 * The settings races and classes share: what they add to every character's starting money and
 * equipment, and where they start. Whether the area and items belong to the universe is checked by the route
 *
 * @param ruleset The universe's ruleset
 * @return The fields' validators
 */
function startingExtrasFields(ruleset: Ruleset)
{
	return({
		enabled: z.boolean(),
		startingMoney: money(ruleset),
		startingItems: startingItemList,
		startingAreaId: z.uuid().nullable()
	});
}

/**
 * RaceSettings, by the universe's ruleset
 */
export const raceSettings = byRuleset((ruleset) => z.object({
	...startingExtrasFields(ruleset),
	name: displayText(MAX_RACE_NAME_LENGTH).nullable(),
	rules: raceRules[ruleset]
}) satisfies z.ZodType<RaceSettings>);

/**
 * ClassSettings, by the universe's ruleset. Whether each race is one the universe can use is checked by the route
 */
export const classSettings = byRuleset((ruleset) => z.object({
	...startingExtrasFields(ruleset),
	name: displayText(MAX_CLASS_NAME_LENGTH).nullable(),
	raceAreas: z.array(z.object({
		raceId: raceIdParameter,
		areaId: z.uuid()
	}))
		.max(MAX_CUSTOM_RACES + Object.keys(DEFAULT_RACE_NAMES[ruleset]).length)
		.refine((entries) => (new Set(entries.map((entry) => entry.raceId)).size === entries.length), 'Each race can be listed only once'),
	rules: classRules[ruleset]
})
	.refine((settings) => ((settings.startingAreaId === null) || (settings.raceAreas.length === 0)), 'A class with its own starting area can\'t have an area for each race') satisfies z.ZodType<ClassSettings>);

/**
 * ThemeSettings
 */
export const themeSettings = z.object({
	name: displayText(MAX_THEME_NAME_LENGTH).nullable(),
	enabled: z.boolean(),
	rules: z.object({
		ability: z.enum(SF1E_ABILITIES)
	})
}) satisfies z.ZodType<ThemeSettings>;

/**
 * The settings an area may be created with or changed to, each optional
 */
const areaSettingsFields = {
	name: displayText(MAX_AREA_NAME_LENGTH).optional(),
	parentAreaId: z.uuid().nullable().optional(),
	enabled: z.boolean().optional(),
	indoors: z.boolean().optional(),
	lightLevel: z.enum(AREA_LIGHT_LEVELS).optional(),
	defaultTileId: tileIdParameter.optional(),
	passageOfTime: z.enum(AREA_PASSAGES_OF_TIME).optional(),
	faerieMorning: z.enum(FAERIE_MORNINGS).nullable().optional(),
	loopsEastWest: z.boolean().optional(),
	loopsNorthSouth: z.boolean().optional()
};

/**
 * NewAreaRequest
 */
export const newAreaRequest = z.object({
	...areaSettingsFields,
	name: displayText(MAX_AREA_NAME_LENGTH)
}) satisfies z.ZodType<NewAreaRequest>;

/**
 * AreaSettingsUpdate
 */
export const areaSettingsUpdate = z.object(areaSettingsFields) satisfies z.ZodType<AreaSettingsUpdate>;

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
 * ResizeAreaRequest
 */
export const resizeAreaRequest = z.object({
	bounds: mapBounds,
	discard: z.boolean()
}) satisfies z.ZodType<ResizeAreaRequest>;

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
 * AreaLinkTarget
 */
export const areaLinkTarget = z.object({
	targetAreaId: z.uuid(),
	targetColumn: cellCoordinate,
	targetRow: cellCoordinate,
	mode: z.enum(AREA_LINK_MODES),
	requiresWholeGroup: z.boolean()
}) satisfies z.ZodType<AreaLinkTarget>;
