/**
 * Validators for the world editor's request bodies and query parameters (see shared/src/editor.ts)
 *
 * Each one must accept exactly the matching interface in /shared; `satisfies` makes the compiler check
 * that. Unknown keys are stripped rather than rejected. These check each value on its own; checks that
 * need the database (such as whether a tile belongs to the universe) are made as each change is saved
 */
import { z } from 'zod';
import { AREA_EVACUATIONS, GROUP_SIZE_LOWERINGS, ITEM_DISABLINGS, DARKVISIONS, DEFAULT_RACE_NAMES, DISALLOWED_TEXT_CHARACTERS, EDITOR_CHARACTER_SORT_COLUMNS, hasIdShapedSlug, MAX_CHARACTER_SEARCH_LENGTH, MAX_CHARACTERS_PER_PAGE, type EditorCharacterListQuery, MAX_UNIVERSE_EDITS_PER_PAGE, type UniverseEditListQuery, TILE_USED_IN,DISPLAY_TIMES,FAERIE_MORNINGS, LOBBY_PASSAGES_OF_TIME, MAX_LOBBY_DAY_HOURS, MIN_LOBBY_DAY_HOURS, isRulesetMoney, COIN_ABBREVIATIONS, duplicateCoinAbbreviation, isValidCoinAbbreviation, RULESET_COINS, shownCoinAbbreviations, ITEM_SORT_COLUMNS, MAX_CELL_CHANGES, MAX_CHUNKS_PER_REQUEST, MAX_CLASS_NAME_LENGTH, MAX_COINS, MAX_COIN_NAME_LENGTH, MAX_CUSTOM_RACES, MAX_DIFFICULTY_NAME_LENGTH, MAX_GROUP_PLAYERS, MAX_ITEM_NAME_LENGTH, MAX_ITEM_QUANTITY, MAX_ITEMS_PER_PAGE, MAX_LONG_DESCRIPTION_LENGTH, MAX_MAP_SIDE, MAX_MOB_SCALE, MIN_MOB_SCALE, MAX_RACE_NAME_LENGTH, MAX_SHORT_DESCRIPTION_LENGTH, MAX_STARTING_ITEMS, MAX_THEME_NAME_LENGTH, MAX_TILE_GRAPHIC_BYTES, MAX_TILE_GRAPHIC_DRAW_ORDER, MAX_TILE_GRAPHIC_NAME_LENGTH, MAX_TILE_NAME_LENGTH, MAX_TILES_PER_PAGE, MAX_WALK_SECONDS, MIN_TILE_GRAPHIC_DRAW_ORDER,MAX_UNIVERSE_NAME_LENGTH, MAX_AREA_NAME_LENGTH, MIN_GROUP_SIZE, PASSAGES_OF_TIME, PF1E_ABILITIES, PF1E_CASTING_STYLES, PF1E_MAGIC_TRADITIONS, PF1E_MAX_POINT_BUY_BUDGET, PF1E_MAX_RACE_ABILITY_MODIFIER, PF1E_MIN_POINT_BUY_BUDGET, PF1E_MIN_RACE_ABILITY_MODIFIER, PF1E_SIZES, PF1E_STAT_METHODS, RULESETS, SF1E_ABILITIES, SF1E_MAX_ABILITY_POINTS, SF1E_MAX_CLASS_POINTS, SF1E_MAX_RACE_ABILITY_MODIFIER, SF1E_MAX_RACE_HIT_POINTS, SF1E_MIN_ABILITY_POINTS, SF1E_MIN_CLASS_POINTS, SF1E_MIN_RACE_ABILITY_MODIFIER, SF1E_MIN_RACE_HIT_POINTS, SF1E_SIZES, SORT_DIRECTIONS, TILE_GRAPHIC_FORMATS, TILE_GRAPHIC_KEYS, TILE_SORT_COLUMNS, UNIVERSE_STAGES, universeSlug, VOID_CELL, AREA_LIGHT_LEVELS, AREA_LINK_MODES, AREA_PASSAGES_OF_TIME, MAX_CHANGES_PER_SAVE, MAX_LOCALE_LENGTH, MAX_TRANSLATOR_LANGUAGES, MAX_UNIVERSE_LANGUAGES, MAX_TRANSLATOR_NOTE_LENGTH, MAX_UNIVERSE_TEXT_PER_PAGE, maxUniverseTextLength, UNIVERSE_TEXT_FIELDS, UNIVERSE_TEXT_KIND_FIELDS, UNIVERSE_TEXT_KINDS, UNIVERSE_TEXT_SORT_COLUMNS, type UniverseTextListQuery, type UniverseTextRef, MAX_PLAYER_NAME_LENGTH, MAX_USERNAME_LENGTH, MIN_PLAYER_SEARCH_LENGTH, parsePlayerSearch, UNIVERSE_ROLES, type PlayerSearchQuery, type EditorRoleSettings, type NewRef, type SaveChangesRequest, type TileChangeSettings, type ChunkRange, type ClassSettings, type DifficultyLevelSettings, type ItemListQuery, type ItemSettings, type MapBounds, type NewUniverseRequest, type RaceSettings, type Ruleset, type RulesetSettings, type ThemeSettings, type TileGraphicUploadRequest, type TileListQuery, type UniverseSettingsUpdate, type AreaLinkTarget } from '@multiverse-kiln/shared';

import { displayText } from '../rooms/payloads.js';

/**
 * The longest window ID a save may name: an editor room session ID, which Colyseus keeps far shorter
 */
const MAX_WINDOW_ID_LENGTH = 64;

/**
 * The settings a change was made from, as the editor loaded them (LoadedSettings). They are only compared
 * with what is saved, never saved themselves, so any object will do
 */
const loadedSettings = z.record(z.string(), z.unknown()).optional();

/**
 * A translation or note for translators as the editor loaded it, null for none, only compared with what
 * is saved as loadedSettings are
 */
const loadedText = z.string().max(MAX_LONG_DESCRIPTION_LENGTH).nullable().optional();

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
 * The query parameters that sort a list by one of its columns (SortOrder): sort, and direction
 *
 * @param columns The columns the list can be sorted by
 * @return The parameters, to spread into a query's validator
 */
function sortParameters<const Column extends string>(columns: readonly [Column, ...Column[]])
{
	return({
		sort: z.enum(columns).optional(),
		direction: z.enum(SORT_DIRECTIONS).optional()
	});
}

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
 * The names a universe gives its ruleset's coins (UniverseCoinNames): only the ruleset's coins, each
 * trimmed and up to MAX_COIN_NAME_LENGTH characters
 *
 * @param ruleset The universe's ruleset
 * @return The validator
 */
function coinNames(ruleset: Ruleset)
{
	return(z.partialRecord(z.enum(RULESET_COINS[ruleset]), z.string()
		.trim()
		.min(1)
		.max(MAX_COIN_NAME_LENGTH)
		.refine((name) => !DISALLOWED_TEXT_CHARACTERS.test(name), 'Contains disallowed characters')));
}

/**
 * The abbreviations a universe gives its ruleset's coins (UniverseCoinAbbreviations): only the ruleset's
 * coins, each one a money field can read, and no two coins shown alike, counting the engine's English
 * abbreviation for each coin left out
 *
 * @param ruleset The universe's ruleset
 * @return The validator
 */
function coinAbbreviations(ruleset: Ruleset)
{
	return(z.partialRecord(z.enum(RULESET_COINS[ruleset]), z.string()
		.trim()
		.refine(isValidCoinAbbreviation, 'Not an abbreviation a money field can read'))
		.refine((abbreviations) => (duplicateCoinAbbreviation(ruleset, shownCoinAbbreviations(ruleset, abbreviations, (coin) => COIN_ABBREVIATIONS[coin].defaultMessage)) === undefined), 'Two coins have the same abbreviation'));
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
 * The key of an item type or category. Whether the universe's ruleset has it is checked as it is saved
 */
const itemKindKey = z.string().trim().min(1).max(40);

/**
 * A universe's name, which needs a letter or digit for its slug (the part of its page's address that
 * names it), and can't make a slug in the form of a universe's ID
 */
const universeName = displayText(MAX_UNIVERSE_NAME_LENGTH)
	.refine((name) => (universeSlug(name) !== ''), 'Has no letters or digits')
	.refine((name) => !hasIdShapedSlug(name), 'Has the form of a universe\'s ID');

/**
 * A language tag, such as de or pt-BR, in its canonical form
 */
const languageTag = z.string()
	.max(MAX_LOCALE_LENGTH)
	.transform((tag, context) =>
	{
		try
		{
			const [canonical] = Intl.getCanonicalLocales(tag);

			return(canonical);
		}
		catch
		{
			context.addIssue({
				code: 'custom',
				message: 'Not a language tag'
			});

			return(z.NEVER);
		}
	});

/**
 * The languages a universe is translated into, each listed once. Whether its source language is among
 * them is checked as they are saved, since a change may send either without the other
 */
const translationLanguages = z.array(languageTag)
	.max(MAX_UNIVERSE_LANGUAGES)
	.refine((languages) => (new Set(languages.map((language) => language.toLowerCase())).size === languages.length), 'Each language can be listed only once');

/**
 * A piece of universe text (UniverseTextRef): a field the kind of thing has. Whether the universe holds
 * the thing is checked as the change is saved
 */
const universeTextRef = z.object({
	kind: z.enum(UNIVERSE_TEXT_KINDS),
	thingId: z.string().min(1).max(64),
	field: z.enum(UNIVERSE_TEXT_FIELDS)
})
	.refine((ref) => UNIVERSE_TEXT_KIND_FIELDS[ref.kind].includes(ref.field), 'Not a field that kind of thing has') satisfies z.ZodType<UniverseTextRef>;

/**
 * A translation of a piece of universe text as it is saved: a name or short description trimmed, a long
 * description (markdown) as it is, with line breaks and tabs; empty is no translation
 *
 * @param ref The piece of text
 * @param translation The translation as sent, or null for none
 * @return The translation, null for none, or undefined when it is too long or holds disallowed characters,
 * or for a coin's abbreviation, one a money field can't read
 */
function universeTextTranslation(ref: UniverseTextRef, translation: string | null): string | null | undefined
{
	if (translation === null)
	{
		return(null);
	}

	const markdown = (ref.field === 'longDescription');
	const text = (markdown ? translation : translation.trim());
	const checked = (markdown ? text.replace(/[\t\n\r]/g, '') : text);

	if ((text.length > maxUniverseTextLength(ref.kind, ref.field)) || DISALLOWED_TEXT_CHARACTERS.test(checked))
	{
		return(undefined);
	}

	if ((ref.field === 'abbreviation') && (text !== '') && !isValidCoinAbbreviation(text))
	{
		return(undefined);
	}

	return(((text.trim() === '') ? null : text));
}

/**
 * Query parameters of GET EDITOR_UNIVERSES_PATH/:universeId/translations/all: the language
 */
export const universeTextLanguageQuery = z.object({
	language: languageTag
});

/**
 * UniverseTextListQuery
 */
export const universeTextListQuery = z.object({
	language: languageTag,
	search: z.string().trim().max(MAX_LONG_DESCRIPTION_LENGTH).optional(),
	missing: booleanText.optional(),
	outOfDate: booleanText.optional(),
	...sortParameters(UNIVERSE_TEXT_SORT_COLUMNS),
	offset: z.coerce.number().int().min(0).default(0),
	limit: z.coerce.number().int().min(1).max(MAX_UNIVERSE_TEXT_PER_PAGE).default(MAX_UNIVERSE_TEXT_PER_PAGE)
}) satisfies z.ZodType<UniverseTextListQuery, unknown>;

/**
 * NewUniverseRequest
 */
export const newUniverseRequest = z.object({
	name: universeName,
	shortDescription,
	ruleset: z.enum(RULESETS),
	locale: z.string().max(MAX_LOCALE_LENGTH).optional()
}) satisfies z.ZodType<NewUniverseRequest>;

/**
 * UniverseSettingsUpdate, by the universe's ruleset
 */
const universeSettingsUpdate = byRuleset((ruleset) => z.object({
	name: universeName.optional(),
	shortDescription: shortDescription.optional(),
	longDescription: longDescription.optional(),
	sourceLanguage: languageTag.optional(),
	translationLanguages: translationLanguages.optional(),
	stage: z.enum(UNIVERSE_STAGES).optional(),
	passageOfTime: z.enum(PASSAGES_OF_TIME).optional(),
	faerieMorning: z.enum(FAERIE_MORNINGS).nullable().optional(),
	displayTime: z.enum(DISPLAY_TIMES).optional(),
	lobbyPassageOfTime: z.enum(LOBBY_PASSAGES_OF_TIME).optional(),
	lobbyDayHours: z.number().int().min(MIN_LOBBY_DAY_HOURS).max(MAX_LOBBY_DAY_HOURS).optional(),
	lobbyFaerieMorning: z.enum(FAERIE_MORNINGS).nullable().optional(),
	lobbyNoVisionCost: z.boolean().optional(),
	lobbyAreaId: z.uuid().nullable().optional(),
	lobbyColumn: cellCoordinate.optional(),
	lobbyRow: cellCoordinate.optional(),
	groupSize: z.number().int().min(MIN_GROUP_SIZE).max(MAX_GROUP_PLAYERS).optional(),
	startingMoney: money(ruleset).optional(),
	coinNames: coinNames(ruleset).optional(),
	coinAbbreviations: coinAbbreviations(ruleset).optional(),
	startingItems: startingItemList.optional(),
	startingAreaId: z.uuid().optional(),
	startingColumn: cellCoordinate.optional(),
	startingRow: cellCoordinate.optional()
}) satisfies z.ZodType<UniverseSettingsUpdate>);

/**
 * RulesetSettings
 */
const rulesetSettings = z.discriminatedUnion('ruleset', [
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
 * A database ID that is a whole number, in a request body
 */
const numericId = z.number().int().min(1).max(2147483647);

/**
 * A NewRef: how a change refers to something an earlier change in the same save makes
 */
const newRef = z.custom<NewRef>((value) => ((typeof value === 'string') && /^new:[\w-]{1,40}$/.test(value)), 'Not a ref');

/**
 * A NumberRef: a saved thing's ID, or a NewRef
 */
const numberRef = z.union([numericId, newRef]);

/**
 * A StringRef: a saved area's or tile graphic's ID, or a NewRef
 */
const stringRef = z.union([z.uuid(), newRef]);

/**
 * TileChangeSettings
 */
const tileChangeSettings = z.object({
	name: displayText(MAX_TILE_NAME_LENGTH).nullable(),
	indoors: z.boolean(),
	outdoors: z.boolean(),
	color: z.number().int().min(0).max(0xFFFFFF),
	graphic: z.enum(TILE_GRAPHIC_KEYS).nullable(),
	uploadedGraphicId: stringRef.nullable(),
	visionCost: z.number().int().min(0).max(100),
	walkSeconds: z.number().int().min(0).max(MAX_WALK_SECONDS),
	enabled: z.boolean()
}).refine((tile) => ((tile.graphic === null) || (tile.uploadedGraphicId === null)), 'A tile has at most one graphic') satisfies z.ZodType<TileChangeSettings>;

/**
 * TileGraphicUploadRequest. The image's base64 is at most what MAX_TILE_GRAPHIC_BYTES encodes to; the
 * decoded image is checked as it is saved
 */
const tileGraphicUploadRequest = z.object({
	name: displayText(MAX_TILE_GRAPHIC_NAME_LENGTH),
	format: z.enum(TILE_GRAPHIC_FORMATS),
	drawOrder: z.number().int().min(MIN_TILE_GRAPHIC_DRAW_ORDER).max(MAX_TILE_GRAPHIC_DRAW_ORDER).nullable(),
	image: z.base64().max(Math.ceil(MAX_TILE_GRAPHIC_BYTES / 3) * 4),
	rightsConfirmed: z.literal(true)
}).refine((upload) => ((upload.format === 'blob') === (upload.drawOrder === null)), 'A Dual-Grid sheet has a draw order, and a blob sheet has none') satisfies z.ZodType<TileGraphicUploadRequest>;

/**
 * TileListQuery, from query parameters
 */
export const tileListQuery = z.object({
	name: z.string().trim().max(MAX_TILE_NAME_LENGTH).optional(),
	passable: booleanText.optional(),
	usedIn: z.enum(TILE_USED_IN).optional(),
	enabled: booleanText.optional(),
	custom: booleanText.optional(),
	edited: booleanText.optional(),
	...sortParameters(TILE_SORT_COLUMNS),
	offset: z.coerce.number().int().min(0).default(0),
	limit: z.coerce.number().int().min(1).max(MAX_TILES_PER_PAGE).default(MAX_TILES_PER_PAGE)
}) satisfies z.ZodType<TileListQuery, unknown>;

/**
 * ItemSettings
 */
const itemSettings = z.object({
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
	...sortParameters(ITEM_SORT_COLUMNS),
	offset: z.coerce.number().int().min(0).default(0),
	limit: z.coerce.number().int().min(1).max(MAX_ITEMS_PER_PAGE).default(MAX_ITEMS_PER_PAGE)
}) satisfies z.ZodType<ItemListQuery, unknown>;

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
		darkvision: z.enum(DARKVISIONS),
		lightSensitivity: z.boolean(),
		size: z.enum(PF1E_SIZES)
	}),
	sf1e: z.object({
		abilityModifiers: abilityModifiers(SF1E_MIN_RACE_ABILITY_MODIFIER, SF1E_MAX_RACE_ABILITY_MODIFIER),
		floatingBonus: z.boolean(),
		darkvision: z.enum(DARKVISIONS),
		lightSensitivity: z.boolean(),
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
		keepPlaying: z.boolean(),
		startingMoney: money(ruleset),
		startingItems: startingItemList,
		startingAreaId: z.uuid().nullable(),
		startingColumn: cellCoordinate,
		startingRow: cellCoordinate
	});
}

/**
 * RaceSettings, by the universe's ruleset
 */
const raceSettings = byRuleset((ruleset) => z.object({
	...startingExtrasFields(ruleset),
	name: displayText(MAX_RACE_NAME_LENGTH).nullable(),
	rules: raceRules[ruleset]
}) satisfies z.ZodType<RaceSettings>);

/**
 * ClassSettings, by the universe's ruleset. Whether each race is one the universe can use is checked as it is saved
 */
const classSettings = byRuleset((ruleset) => z.object({
	...startingExtrasFields(ruleset),
	name: displayText(MAX_CLASS_NAME_LENGTH).nullable(),
	raceAreas: z.array(z.object({
		raceId: numericId,
		areaId: z.uuid(),
		column: cellCoordinate,
		row: cellCoordinate
	}))
		.max(MAX_CUSTOM_RACES + Object.keys(DEFAULT_RACE_NAMES[ruleset]).length)
		.refine((entries) => (new Set(entries.map((entry) => entry.raceId)).size === entries.length), 'Each race can be listed only once'),
	rules: classRules[ruleset]
})
	.refine((settings) => ((settings.startingAreaId === null) || (settings.raceAreas.length === 0)), 'A class with its own starting area can\'t have an area for each race') satisfies z.ZodType<ClassSettings>);

/**
 * DifficultyLevelSettings
 */
const difficultyLevelSettings = z.object({
	name: displayText(MAX_DIFFICULTY_NAME_LENGTH).nullable(),
	isDefault: z.boolean(),
	mobScale: z.number().int().min(MIN_MOB_SCALE).max(MAX_MOB_SCALE),
	permadeath: z.boolean()
}) satisfies z.ZodType<DifficultyLevelSettings>;

/**
 * ThemeSettings
 */
const themeSettings = z.object({
	name: displayText(MAX_THEME_NAME_LENGTH).nullable(),
	enabled: z.boolean(),
	rules: z.object({
		ability: z.enum(SF1E_ABILITIES)
	})
}) satisfies z.ZodType<ThemeSettings>;

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
 * AreaLinkTarget
 */
const areaLinkTarget = z.object({
	targetAreaId: z.uuid(),
	targetColumn: cellCoordinate,
	targetRow: cellCoordinate,
	mode: z.enum(AREA_LINK_MODES),
	requiresWholeGroup: z.boolean()
}) satisfies z.ZodType<AreaLinkTarget>;

/**
 * The area settings a save may create an area with or change, whose default tile and parent may be
 * made earlier in the same save
 */
const areaChangeFields = {
	name: displayText(MAX_AREA_NAME_LENGTH).optional(),
	parentAreaId: stringRef.nullable().optional(),
	enabled: z.boolean().optional(),
	indoors: z.boolean().optional(),
	lightLevel: z.enum(AREA_LIGHT_LEVELS).optional(),
	defaultTileId: numberRef.optional(),
	passageOfTime: z.enum(AREA_PASSAGES_OF_TIME).optional(),
	faerieMorning: z.enum(FAERIE_MORNINGS).nullable().optional(),
	loopsEastWest: z.boolean().optional(),
	loopsNorthSouth: z.boolean().optional()
};

/**
 * The changes to one list of things a save can make: create, save and remove
 *
 * @param name The list's name in the changes' kinds, e.g. Item for createItem
 * @param settings The validator of a thing's settings
 * @param saveFields Validators of the fields a save change has on top of its ID and settings
 * @return The changes' validators
 */
function listChanges<const Name extends string, Settings extends z.ZodType, const SaveFields extends z.ZodRawShape = Record<never, never>>(name: Name, settings: Settings, saveFields?: SaveFields)
{
	return([
		z.object({
			kind: z.literal(`create${name}`),
			ref: newRef,
			settings
		}),
		z.object({
			kind: z.literal(`save${name}`),
			id: numberRef,
			settings,
			loaded: loadedSettings,
			...(saveFields ?? ({} as SaveFields))
		}),
		z.object({
			kind: z.literal(`remove${name}`),
			id: numberRef
		})
	] as const);
}

/**
 * An editor's role and languages: a translator needs at least one language, and other roles have none
 */
const editorRoleSettings = z.object({
	role: z.enum(UNIVERSE_ROLES),
	languages: z.array(languageTag)
		.max(MAX_TRANSLATOR_LANGUAGES)
		.transform((languages) => [...new Set(languages)])
})
	.refine((settings) => ((settings.role === 'translator') === (settings.languages.length > 0)), 'A translator needs languages, and other roles have none') satisfies z.ZodType<EditorRoleSettings>;

/**
 * Query parameters of GET /:universeId/editors/search: at least MIN_PLAYER_SEARCH_LENGTH characters
 * besides a leading @, and no longer than the longest name with an @
 */
export const playerSearchQuery = z.object({
	query: z.string()
		.trim()
		.max(MAX_PLAYER_NAME_LENGTH + 1)
		.refine((query) => ([...parsePlayerSearch(query).text].length >= MIN_PLAYER_SEARCH_LENGTH), `Needs at least ${MIN_PLAYER_SEARCH_LENGTH} characters besides a leading @`)
}) satisfies z.ZodType<PlayerSearchQuery>;

/**
 * A race's or class's ID in a query string
 */
const optionIdText = z.coerce.number().int().min(1).max(2147483647);

/**
 * Query parameters of GET /:universeId/characters
 */
export const editorCharacterListQuery = z.object({
	search: z.string().trim().max(MAX_CHARACTER_SEARCH_LENGTH).optional(),
	raceId: optionIdText.optional(),
	classId: optionIdText.optional(),
	inGroup: booleanText.optional(),
	...sortParameters(EDITOR_CHARACTER_SORT_COLUMNS),
	offset: z.coerce.number().int().min(0).default(0),
	limit: z.coerce.number().int().min(1).max(MAX_CHARACTERS_PER_PAGE).default(MAX_CHARACTERS_PER_PAGE)
}) satisfies z.ZodType<EditorCharacterListQuery, unknown>;

/**
 * Query parameters of GET /:universeId/audit
 */
export const universeEditListQuery = z.object({
	offset: z.coerce.number().int().min(0).default(0),
	limit: z.coerce.number().int().min(1).max(MAX_UNIVERSE_EDITS_PER_PAGE).default(MAX_UNIVERSE_EDITS_PER_PAGE)
}) satisfies z.ZodType<UniverseEditListQuery, unknown>;

/**
 * A numeric ID written as text, as a JSON object's keys are
 */
const numericIdKey = z.string().regex(/^[1-9][0-9]{0,9}$/);

/**
 * SaveChangesRequest, by the universe's ruleset. Whether what each change names exists in the universe
 * is checked as the change is saved
 */
export const saveChangesRequest = byRuleset((ruleset) => z.object({
	changes: z.array(z.discriminatedUnion('kind', [
		z.object({
			kind: z.literal('addEditor'),
			username: z.string().trim().min(1).max(MAX_USERNAME_LENGTH),
			settings: editorRoleSettings
		}),
		z.object({
			kind: z.literal('saveEditor'),
			playerId: z.uuid(),
			settings: editorRoleSettings,
			loaded: loadedSettings
		}),
		z.object({
			kind: z.literal('removeEditor'),
			playerId: z.uuid()
		}),
		z.object({
			kind: z.literal('universe'),
			update: universeSettingsUpdate[ruleset],
			loaded: loadedSettings,
			largerGroups: z.enum(GROUP_SIZE_LOWERINGS).optional()
		}),
		z.object({
			kind: z.literal('ruleset'),
			settings: rulesetSettings,
			loaded: loadedSettings
		}),
		z.object({
			kind: z.literal('uploadTileGraphic'),
			ref: newRef,
			upload: tileGraphicUploadRequest
		}),
		z.object({
			kind: z.literal('deleteTileGraphic'),
			graphicId: z.uuid()
		}),
		z.object({
			kind: z.literal('createTile'),
			ref: newRef,
			settings: tileChangeSettings
		}),
		z.object({
			kind: z.literal('saveTile'),
			id: numberRef,
			settings: tileChangeSettings,
			loaded: loadedSettings
		}),
		z.object({
			kind: z.literal('removeTile'),
			id: numberRef,
			replaceWith: numberRef.nullable()
		}),
		...listChanges('Item', itemSettings, {
			whenDisabled: z.enum(ITEM_DISABLINGS).optional()
		}),
		...listChanges('Race', raceSettings[ruleset]),
		...listChanges('Class', classSettings[ruleset]),
		...listChanges('Theme', themeSettings),
		...listChanges('DifficultyLevel', difficultyLevelSettings),
		z.object({
			kind: z.literal('createArea'),
			ref: newRef,
			area: z.object({
				...areaChangeFields,
				name: displayText(MAX_AREA_NAME_LENGTH)
			})
		}),
		z.object({
			kind: z.literal('updateArea'),
			areaId: stringRef,
			update: z.object(areaChangeFields),
			loaded: loadedSettings,
			moveTo: z.enum(AREA_EVACUATIONS).optional()
		}),
		z.object({
			kind: z.literal('deleteArea'),
			areaId: stringRef
		}),
		z.object({
			kind: z.literal('resizeArea'),
			areaId: stringRef,
			bounds: mapBounds,
			discard: z.boolean()
		}),
		z.object({
			kind: z.literal('editCells'),
			areaId: stringRef,
			changes: z.array(z.tuple([cellCoordinate, cellCoordinate, z.union([z.number().int().min(VOID_CELL).max(2147483647), newRef])])).min(1).max(MAX_CELL_CHANGES)
		}),
		z.object({
			kind: z.literal('saveLink'),
			areaId: stringRef,
			column: cellCoordinate,
			row: cellCoordinate,
			target: areaLinkTarget.extend({ targetAreaId: stringRef })
		}),
		z.object({
			kind: z.literal('deleteLink'),
			areaId: stringRef,
			column: cellCoordinate,
			row: cellCoordinate
		}),
		z.object({
			kind: z.literal('saveTranslation'),
			text: universeTextRef,
			language: languageTag,
			translation: z.string().nullable(),
			sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
			loaded: loadedText
		})
			.transform((change, context) =>
			{
				const translation = universeTextTranslation(change.text, change.translation);

				if (translation === undefined)
				{
					context.addIssue({
						code: 'custom',
						path: ['translation'],
						message: `Too long for ${change.text.field}, contains disallowed characters, or isn't a coin abbreviation a money field can read`
					});

					return(z.NEVER);
				}

				return({ ...change, translation });
			}),
		z.object({
			kind: z.literal('saveTranslatorNote'),
			text: universeTextRef,
			note: z.string()
				.trim()
				.max(MAX_TRANSLATOR_NOTE_LENGTH)
				.refine((text) => !DISALLOWED_TEXT_CHARACTERS.test(text.replace(/[\t\n\r]/g, '')), 'Contains disallowed characters')
				.transform((note) => ((note === '') ? null : note))
				.nullable(),
			loaded: loadedText
		}),
		z.object({
			kind: z.literal('saveNoTranslation'),
			text: universeTextRef,
			noTranslation: z.boolean()
		}),
		z.object({
			kind: z.literal('startDraft')
		}),
		z.object({
			kind: z.literal('applyDraft'),
			choices: z.object({
				races: z.record(numericIdKey, z.boolean()),
				classes: z.record(numericIdKey, z.boolean()),
				items: z.record(numericIdKey, z.enum(ITEM_DISABLINGS)),
				areas: z.record(z.uuid(), z.enum(AREA_EVACUATIONS)),
				largerGroups: z.enum(GROUP_SIZE_LOWERINGS).optional()
			})
		}),
		z.object({
			kind: z.literal('discardDraft')
		})
	])).max(MAX_CHANGES_PER_SAVE),
	windowId: z.string().min(1).max(MAX_WINDOW_ID_LENGTH).optional()
}) satisfies z.ZodType<SaveChangesRequest>);
