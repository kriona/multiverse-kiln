/**
 * Drizzle schema: the source of truth for the database tables
 *
 * After changing it, run `npm run db:generate -w server` to create a migration, then
 * `npm run db:migrate -w server` to apply it. Never change the database by hand
 */
import { sql, type SQL } from 'drizzle-orm';
import { boolean, check, customType, doublePrecision, index, integer, jsonb, pgEnum, pgTable, primaryKey, smallint, text, timestamp, unique, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { CHUNK_SIZE, DARKVISIONS, DEFAULT_LOBBY_DAY_HOURS, DISPLAY_TIMES,GROUP_START_SECONDS, LOBBY_PASSAGES_OF_TIME, MAX_LOBBY_DAY_HOURS, MIN_LOBBY_DAY_HOURS, DEFAULT_PF1E_SETTINGS, DEFAULT_SF1E_SETTINGS, DEFAULT_SITE_SETTINGS, DEFAULT_INDOOR_WALK_SECONDS,FAERIE_MORNINGS, MAX_COINS, MAX_GROUP_PLAYERS, MAX_CHARACTER_DELETION_DAYS, MAX_ITEM_QUANTITY, MAX_MAP_SIDE, MAX_MOB_SCALE, MAX_TILE_GRAPHIC_DRAW_ORDER, MIN_MOB_SCALE, MIN_TILE_GRAPHIC_DRAW_ORDER, MAX_UNIVERSES_PER_CREATOR, MAX_WALK_SECONDS, MIN_GROUP_SIZE, MIN_UNIVERSES_PER_CREATOR, PASSAGES_OF_TIME, PF1E_ABILITIES, PF1E_CASTING_STYLES, PF1E_MAGIC_TRADITIONS, PF1E_MAX_POINT_BUY_BUDGET, PF1E_MAX_RACE_ABILITY_MODIFIER, PF1E_MIN_POINT_BUY_BUDGET, PF1E_MIN_RACE_ABILITY_MODIFIER, PF1E_SIZES, PF1E_STAT_METHODS, RULESETS, SF1E_ABILITIES, SF1E_MAX_ABILITY_POINTS, SF1E_MAX_CLASS_POINTS, SF1E_MAX_RACE_ABILITY_MODIFIER, SF1E_MAX_RACE_HIT_POINTS, SF1E_MIN_ABILITY_POINTS, SF1E_MIN_CLASS_POINTS, SF1E_MIN_RACE_ABILITY_MODIFIER, SF1E_MIN_RACE_HIT_POINTS, SF1E_SIZES, TILE_GRAPHIC_FORMATS, UNIVERSE_ROLES, UNIVERSE_STAGES, AREA_LIGHT_LEVELS, AREA_LINK_MODES, AREA_PASSAGES_OF_TIME } from '@multiverse-kiln/shared';

import { SEEN_CHUNK_BYTES } from '../logic/seenCells.js';

export const universeStage = pgEnum('universe_stage', UNIVERSE_STAGES);
export const universeRole = pgEnum('universe_role', UNIVERSE_ROLES);
export const ruleset = pgEnum('ruleset', RULESETS);
export const passageOfTime = pgEnum('passage_of_time', PASSAGES_OF_TIME);
export const areaPassageOfTime = pgEnum('area_passage_of_time', AREA_PASSAGES_OF_TIME);
export const faerieMorning = pgEnum('faerie_morning', FAERIE_MORNINGS);
export const lobbyPassageOfTime = pgEnum('lobby_passage_of_time', LOBBY_PASSAGES_OF_TIME);
export const displayTime = pgEnum('display_time', DISPLAY_TIMES);
export const areaLinkMode = pgEnum('area_link_mode', AREA_LINK_MODES);
export const areaLightLevel = pgEnum('area_light_level', AREA_LIGHT_LEVELS);
export const pf1eStatMethod = pgEnum('pf1e_stat_method', PF1E_STAT_METHODS);
export const pf1eAbility = pgEnum('pf1e_ability', PF1E_ABILITIES);
export const pf1eSize = pgEnum('pf1e_size', PF1E_SIZES);
export const pf1eMagicTradition = pgEnum('pf1e_magic_tradition', PF1E_MAGIC_TRADITIONS);
export const pf1eCastingStyle = pgEnum('pf1e_casting_style', PF1E_CASTING_STYLES);
export const sf1eAbility = pgEnum('sf1e_ability', SF1E_ABILITIES);
export const sf1eSize = pgEnum('sf1e_size', SF1E_SIZES);
export const darkvision = pgEnum('darkvision', DARKVISIONS);
export const tileGraphicFormat = pgEnum('tile_graphic_format', TILE_GRAPHIC_FORMATS);

/**
 * SQL that checks every one of some columns holds a number in a range
 *
 * @param columns The columns
 * @param min The lowest number allowed
 * @param max The highest number allowed
 * @return The condition
 */
function allInRange(columns: AnyPgColumn[], min: number, max: number): SQL
{
	return(sql.join(columns.map((column) => sql`${column} BETWEEN ${sql.raw(String(min))} AND ${sql.raw(String(max))}`), sql` AND `));
}

/**
 * One row per player account
 *
 * Until there are real logins, a player is found by name, so no two players may have the same name
 * in any mix of capitals
 */
export const players = pgTable('players', {
	id: uuid('id').primaryKey().defaultRandom(),
	displayName: text('display_name').notNull(),

	/**
	 * The address a local account logs in with and is emailed at, as the player typed it. Unique
	 * ignoring capitals. Null for an account without one
	 */
	email: text('email'),

	/**
	 * A local account's password hash, as a self-describing string naming its algorithm and settings
	 * ($argon2id$v=19$m=...), so hashes made with older settings can be found and replaced. Null for an
	 * account that only logs in with a provider
	 */
	passwordHash: text('password_hash'),

	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	uniqueIndex('players_display_name_lower_unique').on(sql`lower(${table.displayName})`),
	uniqueIndex('players_email_lower_unique').on(sql`lower(${table.email})`)
]);

/**
 * One row per universe
 *
 * The lobby and starting areas are set once the universe's areas exist, so both may be null for a
 * moment while a universe is created
 */
export const universes = pgTable('universes', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull(),

	/**
	 * The name in the form its page's address uses (universeSlug), kept with the name. Unique, which
	 * makes universe names unique
	 */
	slug: text('slug').notNull(),

	shortDescription: text('short_description').notNull().default(''),

	/**
	 * Markdown
	 */
	longDescription: text('long_description').notNull().default(''),

	stage: universeStage('stage').notNull().default('in_the_beginning'),
	ruleset: ruleset('ruleset').notNull(),
	passageOfTime: passageOfTime('passage_of_time').notNull().default('flows_normally'),

	/**
	 * Set when passageOfTime is faerie
	 */
	faerieMorning: faerieMorning('faerie_morning'),

	/**
	 * How players are shown the time of day
	 */
	displayTime: displayTime('display_time').notNull().default('precise'),

	lobbyAreaId: uuid('lobby_area_id').references((): AnyPgColumn => areas.id, { onDelete: 'set null' }),

	/**
	 * How the time of day changes in the lobby, which ignores its area's own passage of time
	 */
	lobbyPassageOfTime: lobbyPassageOfTime('lobby_passage_of_time').notNull().default('real_time'),

	/**
	 * How many real hours a lobby day lasts when lobbyPassageOfTime is real_time
	 */
	lobbyDayHours: smallint('lobby_day_hours').notNull().default(DEFAULT_LOBBY_DAY_HOURS),

	/**
	 * Set when lobbyPassageOfTime is faerie
	 */
	lobbyFaerieMorning: faerieMorning('lobby_faerie_morning'),

	/**
	 * Whether the lobby's tiles are seen past as if none had a vision cost
	 */
	lobbyNoVisionCost: boolean('lobby_no_vision_cost').notNull().default(true),

	/**
	 * Where characters start unless their race or class says otherwise
	 */
	startingAreaId: uuid('starting_area_id').references((): AnyPgColumn => areas.id, { onDelete: 'set null' }),

	/**
	 * The cell of the starting area characters start nearest; column 0, row 0 is the middle of a new area's map
	 */
	startingColumn: integer('starting_column').notNull().default(0),
	startingRow: integer('starting_row').notNull().default(0),

	/**
	 * Most characters in one group
	 */
	groupSize: smallint('group_size').notNull().default(MAX_GROUP_PLAYERS),

	/**
	 * The coins every character starts with, by coin: money is kept as pieces, never converted
	 */
	startingPlatinum: integer('starting_platinum').notNull().default(0),
	startingGold: integer('starting_gold').notNull().default(0),
	startingSilver: integer('starting_silver').notNull().default(0),
	startingCopper: integer('starting_copper').notNull().default(0),
	startingCredits: integer('starting_credits').notNull().default(0),

	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	uniqueIndex('universes_slug_unique').on(table.slug),
	check('universes_faerie_morning_set', sql`(${table.passageOfTime} = 'faerie') = (${table.faerieMorning} IS NOT NULL)`),
	check('universes_lobby_faerie_morning_set', sql`(${table.lobbyPassageOfTime} = 'faerie') = (${table.lobbyFaerieMorning} IS NOT NULL)`),
	check('universes_lobby_day_hours_range', sql`${table.lobbyDayHours} BETWEEN ${sql.raw(String(MIN_LOBBY_DAY_HOURS))} AND ${sql.raw(String(MAX_LOBBY_DAY_HOURS))}`),
	check('universes_group_size_range', sql`${table.groupSize} BETWEEN ${sql.raw(String(MIN_GROUP_SIZE))} AND ${sql.raw(String(MAX_GROUP_PLAYERS))}`),
	check('universes_starting_coins_range', sql`${table.startingPlatinum} BETWEEN 0 AND ${sql.raw(String(MAX_COINS))} AND ${table.startingGold} BETWEEN 0 AND ${sql.raw(String(MAX_COINS))} AND ${table.startingSilver} BETWEEN 0 AND ${sql.raw(String(MAX_COINS))} AND ${table.startingCopper} BETWEEN 0 AND ${sql.raw(String(MAX_COINS))}`),
	check('universes_starting_credits_range', sql`${table.startingCredits} BETWEEN 0 AND ${sql.raw(String(MAX_COINS))}`)
]);

/**
 * How each Pathfinder 1E universe plays (its Ruleset tab). A universe without a row has DEFAULT_PF1E_SETTINGS
 */
export const pf1eSettings = pgTable('pf1e_settings', {
	universeId: uuid('universe_id').primaryKey().references(() => universes.id, { onDelete: 'cascade' }),
	statMethod: pf1eStatMethod('stat_method').notNull().default(DEFAULT_PF1E_SETTINGS.statMethod),

	/**
	 * The points players spend when statMethod is point_buy_custom
	 */
	customPointBuyBudget: smallint('custom_point_buy_budget').notNull().default(DEFAULT_PF1E_SETTINGS.customPointBuyBudget),

	needsSleep: boolean('needs_sleep').notNull().default(DEFAULT_PF1E_SETTINGS.needsSleep),
	coinsHaveWeight: boolean('coins_have_weight').notNull().default(DEFAULT_PF1E_SETTINGS.coinsHaveWeight),
	tracksAmmo: boolean('tracks_ammo').notNull().default(DEFAULT_PF1E_SETTINGS.tracksAmmo)
}, (table) => [
	check('pf1e_settings_custom_point_buy_budget_range', sql`${table.customPointBuyBudget} BETWEEN ${sql.raw(String(PF1E_MIN_POINT_BUY_BUDGET))} AND ${sql.raw(String(PF1E_MAX_POINT_BUY_BUDGET))}`)
]);

/**
 * How each Starfinder 1E universe plays (its Ruleset tab). A universe without a row has DEFAULT_SF1E_SETTINGS
 */
export const sf1eSettings = pgTable('sf1e_settings', {
	universeId: uuid('universe_id').primaryKey().references(() => universes.id, { onDelete: 'cascade' }),

	/**
	 * The ability points players spend on their characters' ability scores
	 */
	abilityPoints: smallint('ability_points').notNull().default(DEFAULT_SF1E_SETTINGS.abilityPoints),

	needsSleep: boolean('needs_sleep').notNull().default(DEFAULT_SF1E_SETTINGS.needsSleep),
	tracksAmmo: boolean('tracks_ammo').notNull().default(DEFAULT_SF1E_SETTINGS.tracksAmmo)
}, (table) => [
	check('sf1e_settings_ability_points_range', sql`${table.abilityPoints} BETWEEN ${sql.raw(String(SF1E_MIN_ABILITY_POINTS))} AND ${sql.raw(String(SF1E_MAX_ABILITY_POINTS))}`)
]);

/**
 * The players who may work on or test each universe, and their role in it
 */
export const universeEditors = pgTable('universe_editors', {
	universeId: uuid('universe_id').notNull().references(() => universes.id, { onDelete: 'cascade' }),
	playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
	role: universeRole('role').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	primaryKey({ columns: [table.universeId, table.playerId] }),
	index('universe_editors_player_id_index').on(table.playerId)
]);

/**
 * One row per tile graphic a universe's editors uploaded: a Dual-Grid or blob sheet its tiles can be
 * drawn with
 *
 * The image itself is in object storage under storageKey (see src/storage/), and never changes; a new
 * upload is a new row
 */
export const tileGraphics = pgTable('tile_graphics', {
	id: uuid('id').primaryKey().defaultRandom(),
	universeId: uuid('universe_id').notNull().references(() => universes.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	format: tileGraphicFormat('format').notNull().default('dualGrid'),

	/**
	 * Where tiles meet, the higher draw order's edges are drawn over the lower's (see TILE_GRAPHICS in
	 * /shared). Null for a blob sheet, which is drawn over the ground
	 */
	drawOrder: smallint('draw_order'),

	storageKey: text('storage_key').notNull().unique(),

	/**
	 * Who uploaded it, and confirmed they have the rights to use it, until their account is deleted
	 */
	uploadedBy: uuid('uploaded_by').references(() => players.id, { onDelete: 'set null' }),

	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	index('tile_graphics_universe_id_index').on(table.universeId),
	check('tile_graphics_draw_order_range', sql`${table.drawOrder} BETWEEN ${sql.raw(String(MIN_TILE_GRAPHIC_DRAW_ORDER))} AND ${sql.raw(String(MAX_TILE_GRAPHIC_DRAW_ORDER))}`),
	check('tile_graphics_draw_order_format', sql`(${table.format} = 'blob') = (${table.drawOrder} IS NULL)`)
]);

/**
 * One row per tile a map can be painted with
 *
 * A tile with no universe is one of a ruleset's default tiles, available to every universe with that
 * ruleset; a tile with a universe belongs to that universe only. Default tiles have a key, so code and
 * seed data can find them in any database
 *
 * A universe's tile that overrides a default tile is that universe's edited copy of it. Maps keep using
 * the default tile's ID, and the universe sees the copy's settings under that ID
 */
export const tiles = pgTable('tiles', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	ruleset: ruleset('ruleset').notNull(),
	universeId: uuid('universe_id').references(() => universes.id, { onDelete: 'cascade' }),
	key: text('key'),

	/**
	 * The default tile this one is the universe's edited copy of
	 */
	overridesTileId: integer('overrides_tile_id').references((): AnyPgColumn => tiles.id, { onDelete: 'cascade' }),

	/**
	 * A default tile's name is the English text of its message (DEFAULT_TILE_NAMES in /shared), which
	 * players read in their language. Null on an edited copy that keeps the default tile's name
	 */
	name: text('name'),

	/**
	 * Whether indoor and outdoor areas can paint with the tile; a tile can be for both or neither
	 */
	indoors: boolean('indoors').notNull(),
	outdoors: boolean('outdoors').notNull(),

	/**
	 * Drawn when the tile has no graphic, as 0xRRGGBB
	 */
	color: integer('color').notNull(),

	/**
	 * The graphic the tile is drawn with (TILE_GRAPHICS in /shared), or null to draw it in its color or
	 * uploadedGraphicId
	 */
	graphic: text('graphic'),

	/**
	 * A graphic the universe's editors uploaded that the tile is drawn with; a tile has at most one of
	 * graphic and uploadedGraphicId
	 */
	uploadedGraphicId: uuid('uploaded_graphic_id').references(() => tileGraphics.id, { onDelete: 'set null' }),

	/**
	 * How much of a character's vision crossing the tile uses, in percent; 100 can't be seen through
	 */
	visionCost: smallint('vision_cost').notNull().default(0),

	/**
	 * Seconds of game time walking a square of the tile takes; 0 can't be entered
	 */
	walkSeconds: smallint('walk_seconds').notNull().default(DEFAULT_INDOOR_WALK_SECONDS),

	/**
	 * Whether areas can paint with the tile; maps that already use a disabled tile keep it
	 */
	enabled: boolean('enabled').notNull().default(true),

	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	unique('tiles_ruleset_key_unique').on(table.ruleset, table.key),
	unique('tiles_universe_overrides_unique').on(table.universeId, table.overridesTileId),
	index('tiles_universe_id_index').on(table.universeId),
	check('tiles_overrides_belong_to_universe', sql`${table.overridesTileId} IS NULL OR ${table.universeId} IS NOT NULL`),
	check('tiles_name_required', sql`${table.name} IS NOT NULL OR ${table.overridesTileId} IS NOT NULL`),
	check('tiles_color_range', sql`${table.color} BETWEEN 0 AND 16777215`),
	check('tiles_one_graphic', sql`${table.graphic} IS NULL OR ${table.uploadedGraphicId} IS NULL`),
	check('tiles_vision_cost_range', sql`${table.visionCost} BETWEEN 0 AND 100`),
	check('tiles_walk_seconds_range', sql`${table.walkSeconds} BETWEEN 0 AND ${sql.raw(String(MAX_WALK_SECONDS))}`)
]);

/**
 * One row per item characters can be given
 *
 * An item with no universe is one of a ruleset's default items, available to every universe with that
 * ruleset; an item with a universe belongs to that universe only. Default items have a key, so code
 * and seed data can find them in any database
 *
 * A universe's item that overrides a default item is that universe's edited copy of it. Everything
 * else keeps using the default item's ID, and the universe sees the copy's settings under that ID
 */
export const items = pgTable('items', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	ruleset: ruleset('ruleset').notNull(),
	universeId: uuid('universe_id').references(() => universes.id, { onDelete: 'cascade' }),
	key: text('key'),

	/**
	 * The default item this one is the universe's edited copy of
	 */
	overridesItemId: integer('overrides_item_id').references((): AnyPgColumn => items.id, { onDelete: 'cascade' }),

	/**
	 * A default item's name is the English text of its message (DEFAULT_ITEM_NAMES in /shared), which
	 * players read in their language. Null on an edited copy that keeps the default item's name
	 */
	name: text('name'),

	/**
	 * One of the ruleset's item types (ITEM_KINDS in /shared), e.g. dagger
	 */
	type: text('type').notNull(),

	enabled: boolean('enabled').notNull().default(true),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	unique('items_ruleset_key_unique').on(table.ruleset, table.key),
	unique('items_universe_overrides_unique').on(table.universeId, table.overridesItemId),
	index('items_universe_id_index').on(table.universeId),
	check('items_overrides_belong_to_universe', sql`${table.overridesItemId} IS NULL OR ${table.universeId} IS NOT NULL`),
	check('items_name_required', sql`${table.name} IS NOT NULL OR ${table.overridesItemId} IS NOT NULL`)
]);

/**
 * The items every character of a universe starts with, and how many of each
 *
 * A default item is listed by its own ID, never by the ID of the universe's edited copy of it
 */
export const universeStartingItems = pgTable('universe_starting_items', {
	universeId: uuid('universe_id').notNull().references(() => universes.id, { onDelete: 'cascade' }),
	itemId: integer('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
	quantity: smallint('quantity').notNull()
}, (table) => [
	primaryKey({ columns: [table.universeId, table.itemId] }),
	index('universe_starting_items_item_id_index').on(table.itemId),
	check('universe_starting_items_quantity_range', sql`${table.quantity} BETWEEN 1 AND ${sql.raw(String(MAX_ITEM_QUANTITY))}`)
]);

/**
 * One row per race characters can be
 *
 * Works like items: a race with no universe is one of a ruleset's default races, and a universe's race
 * that overrides a default race is that universe's edited copy of it. Everything else keeps using the
 * default race's ID. A default race has no starting money, equipment or area; those belong to a
 * universe, so a universe's copy holds them
 *
 * The race's rules live in its ruleset's table (pf1e_races)
 */
export const races = pgTable('races', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	ruleset: ruleset('ruleset').notNull(),
	universeId: uuid('universe_id').references(() => universes.id, { onDelete: 'cascade' }),
	key: text('key'),

	/**
	 * The default race this one is the universe's edited copy of
	 */
	overridesRaceId: integer('overrides_race_id').references((): AnyPgColumn => races.id, { onDelete: 'cascade' }),

	/**
	 * A default race's name is the English text of its message (DEFAULT_RACE_NAMES in /shared), which
	 * players read in their language. Null on an edited copy that keeps the default race's name
	 */
	name: text('name'),

	enabled: boolean('enabled').notNull().default(true),

	/**
	 * Coins the race's characters get on top of the universe's starting money
	 */
	startingPlatinum: integer('starting_platinum').notNull().default(0),
	startingGold: integer('starting_gold').notNull().default(0),
	startingSilver: integer('starting_silver').notNull().default(0),
	startingCopper: integer('starting_copper').notNull().default(0),
	startingCredits: integer('starting_credits').notNull().default(0),

	/**
	 * Where the race's characters start, unless their class says otherwise; null for the universe's starting area
	 */
	startingAreaId: uuid('starting_area_id').references((): AnyPgColumn => areas.id, { onDelete: 'set null' }),

	/**
	 * The cell of the starting area the race's characters start nearest
	 */
	startingColumn: integer('starting_column').notNull().default(0),
	startingRow: integer('starting_row').notNull().default(0),

	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	unique('races_ruleset_key_unique').on(table.ruleset, table.key),
	unique('races_universe_overrides_unique').on(table.universeId, table.overridesRaceId),
	index('races_universe_id_index').on(table.universeId),
	index('races_starting_area_id_index').on(table.startingAreaId),
	check('races_overrides_belong_to_universe', sql`${table.overridesRaceId} IS NULL OR ${table.universeId} IS NOT NULL`),
	check('races_name_required', sql`${table.name} IS NOT NULL OR ${table.overridesRaceId} IS NOT NULL`),
	check('races_starting_coins_range', allInRange([table.startingPlatinum, table.startingGold, table.startingSilver, table.startingCopper], 0, MAX_COINS)),
	check('races_starting_credits_range', allInRange([table.startingCredits], 0, MAX_COINS))
]);

/**
 * Each Pathfinder 1E race's rules, for default races and universes' races alike
 */
export const pf1eRaces = pgTable('pf1e_races', {
	raceId: integer('race_id').primaryKey().references(() => races.id, { onDelete: 'cascade' }),

	/**
	 * Added to each ability score
	 */
	strengthModifier: smallint('strength_modifier').notNull().default(0),
	dexterityModifier: smallint('dexterity_modifier').notNull().default(0),
	constitutionModifier: smallint('constitution_modifier').notNull().default(0),
	intelligenceModifier: smallint('intelligence_modifier').notNull().default(0),
	wisdomModifier: smallint('wisdom_modifier').notNull().default(0),
	charismaModifier: smallint('charisma_modifier').notNull().default(0),

	/**
	 * Whether the player chooses one ability to get PF1E_FLOATING_ABILITY_BONUS
	 */
	floatingBonus: boolean('floating_bonus').notNull().default(false),

	darkvision: darkvision('darkvision').notNull().default('none'),

	/**
	 * Whether bright light dazzles the race's characters, shortening their vision
	 */
	lightSensitivity: boolean('light_sensitivity').notNull().default(false),

	size: pf1eSize('size').notNull().default('medium')
}, (table) => [
	check('pf1e_races_modifiers_range', allInRange([table.strengthModifier, table.dexterityModifier, table.constitutionModifier, table.intelligenceModifier, table.wisdomModifier, table.charismaModifier], PF1E_MIN_RACE_ABILITY_MODIFIER, PF1E_MAX_RACE_ABILITY_MODIFIER))
]);

/**
 * Each Starfinder 1E race's rules, for default races and universes' races alike
 */
export const sf1eRaces = pgTable('sf1e_races', {
	raceId: integer('race_id').primaryKey().references(() => races.id, { onDelete: 'cascade' }),

	/**
	 * Added to each ability score
	 */
	strengthModifier: smallint('strength_modifier').notNull().default(0),
	dexterityModifier: smallint('dexterity_modifier').notNull().default(0),
	constitutionModifier: smallint('constitution_modifier').notNull().default(0),
	intelligenceModifier: smallint('intelligence_modifier').notNull().default(0),
	wisdomModifier: smallint('wisdom_modifier').notNull().default(0),
	charismaModifier: smallint('charisma_modifier').notNull().default(0),

	/**
	 * Whether the player chooses one ability to get SF1E_FLOATING_ABILITY_BONUS
	 */
	floatingBonus: boolean('floating_bonus').notNull().default(false),

	darkvision: darkvision('darkvision').notNull().default('none'),

	/**
	 * Whether bright light dazzles the race's characters, shortening their vision
	 */
	lightSensitivity: boolean('light_sensitivity').notNull().default(false),

	size: sf1eSize('size').notNull().default('medium'),

	/**
	 * The hit points the race gives a character, on top of their class's
	 */
	hitPoints: smallint('hit_points').notNull()
}, (table) => [
	check('sf1e_races_modifiers_range', allInRange([table.strengthModifier, table.dexterityModifier, table.constitutionModifier, table.intelligenceModifier, table.wisdomModifier, table.charismaModifier], SF1E_MIN_RACE_ABILITY_MODIFIER, SF1E_MAX_RACE_ABILITY_MODIFIER)),
	check('sf1e_races_hit_points_range', allInRange([table.hitPoints], SF1E_MIN_RACE_HIT_POINTS, SF1E_MAX_RACE_HIT_POINTS))
]);

/**
 * The items a race's characters get on top of the universe's starting equipment
 *
 * Listed against the row holding the race's settings: a universe's own race, or its edited copy of a
 * default race. An item is listed by its own ID, never by the ID of an edited copy of it
 */
export const raceStartingItems = pgTable('race_starting_items', {
	raceId: integer('race_id').notNull().references(() => races.id, { onDelete: 'cascade' }),
	itemId: integer('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
	quantity: smallint('quantity').notNull()
}, (table) => [
	primaryKey({ columns: [table.raceId, table.itemId] }),
	index('race_starting_items_item_id_index').on(table.itemId),
	check('race_starting_items_quantity_range', sql`${table.quantity} BETWEEN 1 AND ${sql.raw(String(MAX_ITEM_QUANTITY))}`)
]);

/**
 * One row per class characters can be
 *
 * Works like races: a class with no universe is one of a ruleset's default classes, and a universe's
 * class that overrides a default class is that universe's edited copy of it. Everything else keeps
 * using the default class's ID
 *
 * The class's rules live in its ruleset's table (pf1e_classes)
 */
export const classes = pgTable('classes', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	ruleset: ruleset('ruleset').notNull(),
	universeId: uuid('universe_id').references(() => universes.id, { onDelete: 'cascade' }),
	key: text('key'),

	/**
	 * The default class this one is the universe's edited copy of
	 */
	overridesClassId: integer('overrides_class_id').references((): AnyPgColumn => classes.id, { onDelete: 'cascade' }),

	/**
	 * A default class's name is the English text of its message (DEFAULT_CLASS_NAMES in /shared), which
	 * players read in their language. Null on an edited copy that keeps the default class's name
	 */
	name: text('name'),

	enabled: boolean('enabled').notNull().default(true),

	/**
	 * Coins the class's characters get on top of the universe's and their race's starting money
	 */
	startingPlatinum: integer('starting_platinum').notNull().default(0),
	startingGold: integer('starting_gold').notNull().default(0),
	startingSilver: integer('starting_silver').notNull().default(0),
	startingCopper: integer('starting_copper').notNull().default(0),
	startingCredits: integer('starting_credits').notNull().default(0),

	/**
	 * Where every member of the class starts, whatever their race; null to leave it to class_race_areas,
	 * then the race, then the universe
	 */
	startingAreaId: uuid('starting_area_id').references((): AnyPgColumn => areas.id, { onDelete: 'set null' }),

	/**
	 * The cell of the starting area the class's characters start nearest
	 */
	startingColumn: integer('starting_column').notNull().default(0),
	startingRow: integer('starting_row').notNull().default(0),

	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	unique('classes_ruleset_key_unique').on(table.ruleset, table.key),
	unique('classes_universe_overrides_unique').on(table.universeId, table.overridesClassId),
	index('classes_universe_id_index').on(table.universeId),
	index('classes_starting_area_id_index').on(table.startingAreaId),
	check('classes_overrides_belong_to_universe', sql`${table.overridesClassId} IS NULL OR ${table.universeId} IS NOT NULL`),
	check('classes_name_required', sql`${table.name} IS NOT NULL OR ${table.overridesClassId} IS NOT NULL`),
	check('classes_starting_coins_range', allInRange([table.startingPlatinum, table.startingGold, table.startingSilver, table.startingCopper], 0, MAX_COINS)),
	check('classes_starting_credits_range', allInRange([table.startingCredits], 0, MAX_COINS))
]);

/**
 * Each Pathfinder 1E class's rules, for default classes and universes' classes alike
 */
export const pf1eClasses = pgTable('pf1e_classes', {
	classId: integer('class_id').primaryKey().references(() => classes.id, { onDelete: 'cascade' }),

	/**
	 * A hint when the player arranges their ability scores
	 */
	primaryAbility: pf1eAbility('primary_ability').notNull(),

	tradition: pf1eMagicTradition('tradition').notNull().default('none'),
	castingStyle: pf1eCastingStyle('casting_style').notNull().default('none')
});

/**
 * Each Starfinder 1E class's rules, for default classes and universes' classes alike
 */
export const sf1eClasses = pgTable('sf1e_classes', {
	classId: integer('class_id').primaryKey().references(() => classes.id, { onDelete: 'cascade' }),

	/**
	 * A hint when the player spends their ability points
	 */
	keyAbility: sf1eAbility('key_ability').notNull(),

	/**
	 * Hit points and stamina points the class gives at each level
	 */
	hitPoints: smallint('hit_points').notNull(),
	staminaPoints: smallint('stamina_points').notNull()
}, (table) => [
	check('sf1e_classes_points_range', allInRange([table.hitPoints, table.staminaPoints], SF1E_MIN_CLASS_POINTS, SF1E_MAX_CLASS_POINTS))
]);

/**
 * One row per theme characters can have, in a ruleset with themes (Starfinder 1E)
 *
 * Works like races: a theme with no universe is one of a ruleset's default themes, and a universe's
 * theme that overrides a default theme is that universe's edited copy of it. Everything else keeps using
 * the default theme's ID
 *
 * The theme's rules live in its ruleset's table (sf1e_themes)
 */
export const themes = pgTable('themes', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	ruleset: ruleset('ruleset').notNull(),
	universeId: uuid('universe_id').references(() => universes.id, { onDelete: 'cascade' }),
	key: text('key'),

	/**
	 * The default theme this one is the universe's edited copy of
	 */
	overridesThemeId: integer('overrides_theme_id').references((): AnyPgColumn => themes.id, { onDelete: 'cascade' }),

	/**
	 * A default theme's name is the English text of its message (DEFAULT_THEME_NAMES in /shared), which
	 * players read in their language. Null on an edited copy that keeps the default theme's name
	 */
	name: text('name'),

	enabled: boolean('enabled').notNull().default(true),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	unique('themes_ruleset_key_unique').on(table.ruleset, table.key),
	unique('themes_universe_overrides_unique').on(table.universeId, table.overridesThemeId),
	index('themes_universe_id_index').on(table.universeId),
	check('themes_overrides_belong_to_universe', sql`${table.overridesThemeId} IS NULL OR ${table.universeId} IS NOT NULL`),
	check('themes_name_required', sql`${table.name} IS NOT NULL OR ${table.overridesThemeId} IS NOT NULL`)
]);

/**
 * Each Starfinder 1E theme's rules, for default themes and universes' themes alike
 */
export const sf1eThemes = pgTable('sf1e_themes', {
	themeId: integer('theme_id').primaryKey().references(() => themes.id, { onDelete: 'cascade' }),

	/**
	 * The ability that gets SF1E_THEME_ABILITY_BONUS
	 */
	ability: sf1eAbility('ability').notNull()
});

/**
 * The items a class's characters get on top of the universe's and their race's starting equipment
 *
 * Listed against the row holding the class's settings, as race_starting_items is
 */
export const classStartingItems = pgTable('class_starting_items', {
	classId: integer('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
	itemId: integer('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
	quantity: smallint('quantity').notNull()
}, (table) => [
	primaryKey({ columns: [table.classId, table.itemId] }),
	index('class_starting_items_item_id_index').on(table.itemId),
	check('class_starting_items_quantity_range', sql`${table.quantity} BETWEEN 1 AND ${sql.raw(String(MAX_ITEM_QUANTITY))}`)
]);

/**
 * Where a class's characters of one race start, for a class with no starting area of its own
 *
 * Listed against the row holding the class's settings. The race is listed by the ID everything else
 * uses for it: a default race's own ID, never its edited copy's
 */
export const classRaceAreas = pgTable('class_race_areas', {
	classId: integer('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
	raceId: integer('race_id').notNull().references(() => races.id, { onDelete: 'cascade' }),
	areaId: uuid('area_id').notNull().references(() => areas.id, { onDelete: 'cascade' }),

	/**
	 * The cell of the area they start nearest
	 */
	startingColumn: integer('starting_column').notNull().default(0),
	startingRow: integer('starting_row').notNull().default(0)
}, (table) => [
	primaryKey({ columns: [table.classId, table.raceId] }),
	index('class_race_areas_race_id_index').on(table.raceId),
	index('class_race_areas_area_id_index').on(table.areaId)
]);

/**
 * One row per area: a map, and where it sits among the universe's areas
 *
 * The map covers minColumn..maxColumn and minRow..maxRow, both inclusive, around column 0, row 0
 */
export const areas = pgTable('areas', {
	id: uuid('id').primaryKey().defaultRandom(),
	universeId: uuid('universe_id').notNull().references(() => universes.id, { onDelete: 'cascade' }),
	parentAreaId: uuid('parent_area_id').references((): AnyPgColumn => areas.id, { onDelete: 'set null' }),
	name: text('name').notNull(),
	enabled: boolean('enabled').notNull().default(true),
	indoors: boolean('indoors').notNull(),

	/**
	 * How light the area is at any time of day while it is indoors
	 */
	lightLevel: areaLightLevel('light_level').notNull().default('lit'),

	defaultTileId: integer('default_tile_id').notNull().references(() => tiles.id),
	minColumn: integer('min_column').notNull(),
	minRow: integer('min_row').notNull(),
	maxColumn: integer('max_column').notNull(),
	maxRow: integer('max_row').notNull(),
	loopsEastWest: boolean('loops_east_west').notNull().default(false),
	loopsNorthSouth: boolean('loops_north_south').notNull().default(false),
	passageOfTime: areaPassageOfTime('passage_of_time').notNull().default('inherit'),

	/**
	 * Set when passageOfTime is faerie
	 */
	faerieMorning: faerieMorning('faerie_morning'),

	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	index('areas_universe_id_index').on(table.universeId),
	index('areas_parent_area_id_index').on(table.parentAreaId),
	check('areas_width', sql`${table.maxColumn} - ${table.minColumn} BETWEEN 0 AND ${sql.raw(String(MAX_MAP_SIDE - 1))}`),
	check('areas_height', sql`${table.maxRow} - ${table.minRow} BETWEEN 0 AND ${sql.raw(String(MAX_MAP_SIDE - 1))}`),
	check('areas_faerie_morning_set', sql`(${table.passageOfTime} = 'faerie') = (${table.faerieMorning} IS NOT NULL)`),
	check('areas_faerie_does_not_loop', sql`${table.passageOfTime} <> 'faerie' OR NOT (${table.loopsEastWest} OR ${table.loopsNorthSouth})`)
]);

/**
 * The stored chunks of each area's map. A chunk that isn't stored is all the area's default tile
 *
 * Layer 0 is the ground; later layers go on top of it
 */
export const mapChunks = pgTable('map_chunks', {
	areaId: uuid('area_id').notNull().references(() => areas.id, { onDelete: 'cascade' }),
	layer: smallint('layer').notNull().default(0),
	chunkColumn: integer('chunk_column').notNull(),
	chunkRow: integer('chunk_row').notNull(),

	/**
	 * CHUNK_SIZE * CHUNK_SIZE cell values, row by row: a tile ID, DEFAULT_TILE_CELL or VOID_CELL (see shared/src/maps.ts)
	 */
	cells: integer('cells').array().notNull()
}, (table) => [
	primaryKey({ columns: [table.areaId, table.layer, table.chunkColumn, table.chunkRow] }),
	check('map_chunks_cell_count', sql`cardinality(${table.cells}) = ${sql.raw(String(CHUNK_SIZE * CHUNK_SIZE))}`)
]);

/**
 * Cells that take a player to a cell in another area
 */
export const areaLinks = pgTable('area_links', {
	id: uuid('id').primaryKey().defaultRandom(),
	areaId: uuid('area_id').notNull().references(() => areas.id, { onDelete: 'cascade' }),
	column: integer('column').notNull(),
	row: integer('row').notNull(),
	targetAreaId: uuid('target_area_id').notNull().references(() => areas.id, { onDelete: 'cascade' }),
	targetColumn: integer('target_column').notNull(),
	targetRow: integer('target_row').notNull(),
	mode: areaLinkMode('mode').notNull(),

	/**
	 * The link can only be used while every member of the group is present
	 */
	requiresWholeGroup: boolean('requires_whole_group').notNull().default(false)
}, (table) => [
	unique('area_links_cell_unique').on(table.areaId, table.column, table.row),
	index('area_links_target_area_id_index').on(table.targetAreaId)
]);

/**
 * One row per character a player has made in a universe
 *
 * The race and class are listed by the IDs everything else uses for them: a default's own ID, never its
 * edited copy's. A race, class or item that characters have can't be deleted while they have it
 */
export const characters = pgTable('characters', {
	id: uuid('id').primaryKey().defaultRandom(),
	playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
	universeId: uuid('universe_id').notNull().references(() => universes.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	raceId: integer('race_id').notNull().references(() => races.id),
	classId: integer('class_id').notNull().references(() => classes.id),

	/**
	 * The coins the character carries, by coin: money is kept as pieces, never converted
	 */
	platinum: integer('platinum').notNull().default(0),
	gold: integer('gold').notNull().default(0),
	silver: integer('silver').notNull().default(0),
	copper: integer('copper').notNull().default(0),
	credits: integer('credits').notNull().default(0),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

	/**
	 * When the player last stopped playing the character in the lobby; null until they have. The lobby
	 * starts a player as whichever of their characters was played or made most recently
	 */
	lastPlayedAt: timestamp('last_played_at', { withTimezone: true }),

	/**
	 * When the character is deleted, once their player has given them their last rites; null otherwise.
	 * Until then the player can restore them, but not play them. The server sweeps away characters
	 * past it, and hides them until it does
	 */
	deleteAt: timestamp('delete_at', { withTimezone: true })
}, (table) => [
	index('characters_player_universe_index').on(table.playerId, table.universeId),
	index('characters_universe_id_index').on(table.universeId),
	index('characters_race_id_index').on(table.raceId),
	index('characters_class_id_index').on(table.classId),
	index('characters_delete_at_index').on(table.deleteAt).where(sql`${table.deleteAt} is not null`),
	check('characters_coins_range', allInRange([table.platinum, table.gold, table.silver, table.copper], 0, MAX_COINS)),
	check('characters_credits_range', allInRange([table.credits], 0, MAX_COINS))
]);

/**
 * Each Pathfinder 1E character's ability scores, with their race's modifiers added
 */
export const pf1eCharacters = pgTable('pf1e_characters', {
	characterId: uuid('character_id').primaryKey().references(() => characters.id, { onDelete: 'cascade' }),
	strength: smallint('strength').notNull(),
	dexterity: smallint('dexterity').notNull(),
	constitution: smallint('constitution').notNull(),
	intelligence: smallint('intelligence').notNull(),
	wisdom: smallint('wisdom').notNull(),
	charisma: smallint('charisma').notNull()
});

/**
 * Each Starfinder 1E character's ability scores, with their race's modifiers and theme's bonus added,
 * and their theme
 *
 * The theme is listed by the ID everything else uses for it: a default's own ID, never its edited copy's.
 * A theme characters have can't be deleted while they have it
 */
export const sf1eCharacters = pgTable('sf1e_characters', {
	characterId: uuid('character_id').primaryKey().references(() => characters.id, { onDelete: 'cascade' }),
	themeId: integer('theme_id').notNull().references(() => themes.id),
	strength: smallint('strength').notNull(),
	dexterity: smallint('dexterity').notNull(),
	constitution: smallint('constitution').notNull(),
	intelligence: smallint('intelligence').notNull(),
	wisdom: smallint('wisdom').notNull(),
	charisma: smallint('charisma').notNull()
}, (table) => [
	index('sf1e_characters_theme_id_index').on(table.themeId)
]);

/**
 * The items each character carries, and how many of each
 *
 * An item is listed by its own ID, never by the ID of an edited copy of it
 */
export const characterItems = pgTable('character_items', {
	characterId: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
	itemId: integer('item_id').notNull().references(() => items.id),
	quantity: integer('quantity').notNull()
}, (table) => [
	primaryKey({ columns: [table.characterId, table.itemId] }),
	index('character_items_item_id_index').on(table.itemId),
	check('character_items_quantity_positive', sql`${table.quantity} >= 1`)
]);

/**
 * Each player's progress in Create Character in a universe, until they make the character or start over
 *
 * The progress is a CharacterDraft (shared/src/characters.ts) as JSON, so steps can be added to Create
 * Character without changing the table. The server checks it against the universe only when the
 * character is made
 */
export const characterDrafts = pgTable('character_drafts', {
	playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
	universeId: uuid('universe_id').notNull().references(() => universes.id, { onDelete: 'cascade' }),
	draft: jsonb('draft').notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	primaryKey({ columns: [table.playerId, table.universeId] }),
	index('character_drafts_universe_id_index').on(table.universeId)
]);

/**
 * The ability scores the server rolled for a player's next character in a Pathfinder 1E universe that
 * rolls them. They are kept until a character is made with them, so opening Create Character again
 * doesn't roll again, unless the universe has since changed how it rolls
 */
export const pf1eAbilityRolls = pgTable('pf1e_ability_rolls', {
	playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
	universeId: uuid('universe_id').notNull().references(() => universes.id, { onDelete: 'cascade' }),

	/**
	 * How the scores were rolled
	 */
	statMethod: pf1eStatMethod('stat_method').notNull(),

	/**
	 * One score per ability, in the order they were rolled
	 */
	scores: smallint('scores').array().notNull(),

	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	primaryKey({ columns: [table.playerId, table.universeId] }),
	index('pf1e_ability_rolls_universe_id_index').on(table.universeId),
	check('pf1e_ability_rolls_score_count', sql`cardinality(${table.scores}) = ${sql.raw(String(PF1E_ABILITIES.length))}`)
]);

/**
 * Each universe's difficulty levels, which its groups choose from. A universe starts with
 * DEFAULT_DIFFICULTY_LEVELS, and always has exactly one default level
 */
export const difficultyLevels = pgTable('difficulty_levels', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	universeId: uuid('universe_id').notNull().references(() => universes.id, { onDelete: 'cascade' }),

	/**
	 * A default level's key, e.g. normal, which finds its name in DIFFICULTY_LEVEL_NAMES; null for a
	 * level the universe added
	 */
	key: text('key'),

	/**
	 * The universe's name for the level. Null on a default level that keeps its name, which players read
	 * in their language
	 */
	name: text('name'),

	/**
	 * Whether Create Group starts on this level
	 */
	isDefault: boolean('is_default').notNull().default(false),

	/**
	 * How much harder mobs are, as a percentage: 50 is 50% harder, -50 is 50% easier
	 */
	mobScale: smallint('mob_scale').notNull().default(0),

	/**
	 * Whether a character who dies is gone for good
	 */
	permadeath: boolean('permadeath').notNull().default(false),

	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	index('difficulty_levels_universe_id_index').on(table.universeId),
	unique('difficulty_levels_universe_key_unique').on(table.universeId, table.key),
	uniqueIndex('difficulty_levels_one_default').on(table.universeId).where(sql`${table.isDefault}`),
	check('difficulty_levels_name_required', sql`${table.name} IS NOT NULL OR ${table.key} IS NOT NULL`),
	check('difficulty_levels_mob_scale_range', sql`${table.mobScale} BETWEEN ${sql.raw(String(MIN_MOB_SCALE))} AND ${sql.raw(String(MAX_MOB_SCALE))}`)
]);

/**
 * One row per group: characters playing a universe together, around their anchor being
 *
 * Deleting the anchor being's character disbands the group, deleting its members and invites with it
 */
export const groups = pgTable('groups', {
	id: uuid('id').primaryKey().defaultRandom(),
	universeId: uuid('universe_id').notNull().references(() => universes.id, { onDelete: 'cascade' }),

	/**
	 * The character the group is centered on; they are also one of its members
	 */
	anchorCharacterId: uuid('anchor_character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),

	/**
	 * The name its anchor being's player gave it; empty when they gave none
	 */
	name: text('name').notNull().default(''),

	/**
	 * Where the group started: the anchor being's starting area. Members with nowhere else to be go
	 * there; null when it was deleted, and the universe's starting area is used instead
	 */
	startingAreaId: uuid('starting_area_id').references((): AnyPgColumn => areas.id, { onDelete: 'set null' }),

	/**
	 * The cell of the starting area members with nowhere else to be start nearest
	 */
	startingColumn: integer('starting_column').notNull().default(0),
	startingRow: integer('starting_row').notNull().default(0),

	/**
	 * The group's game clock: seconds of game time since its world began, which starts in the morning
	 * (see GroupClock)
	 */
	clockSeconds: doublePrecision('clock_seconds').notNull().default(GROUP_START_SECONDS),

	/**
	 * The difficulty level the group plays at, one of its universe's. Deleting a level moves its groups to
	 * the universe's default level first
	 */
	difficultyLevelId: integer('difficulty_level_id').notNull().references(() => difficultyLevels.id),

	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	unique('groups_anchor_character_id_unique').on(table.anchorCharacterId),
	index('groups_universe_id_index').on(table.universeId),
	index('groups_starting_area_id_index').on(table.startingAreaId),
	index('groups_difficulty_level_id_index').on(table.difficultyLevelId)
]);

/**
 * A column of raw bytes, read as a Uint8Array
 */
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
	dataType: () => 'bytea',
	toDriver: (value) => Buffer.from(value),
	fromDriver: (value) => new Uint8Array(value)
});

/**
 * The cells each group has seen, part of its world state: one row per chunk of an area's map that the
 * group has seen any cell of. Deleted with the group, so disbanding it forgets what it explored
 */
export const groupSeenChunks = pgTable('group_seen_chunks', {
	groupId: uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
	areaId: uuid('area_id').notNull().references(() => areas.id, { onDelete: 'cascade' }),
	chunkColumn: integer('chunk_column').notNull(),
	chunkRow: integer('chunk_row').notNull(),

	/**
	 * One bit per cell of the chunk, set once the group has seen it (see server/src/logic/seenCells.ts)
	 */
	cells: bytea('cells').notNull()
}, (table) => [
	primaryKey({ columns: [table.groupId, table.areaId, table.chunkColumn, table.chunkRow] }),
	index('group_seen_chunks_area_id_index').on(table.areaId),
	check('group_seen_chunks_cell_count', sql`octet_length(${table.cells}) = ${sql.raw(String(SEEN_CHUNK_BYTES))}`)
]);

/**
 * The characters in each group, and where each one was when their player last left the group's room.
 * A character is in at most one group
 */
export const groupMembers = pgTable('group_members', {
	characterId: uuid('character_id').primaryKey().references(() => characters.id, { onDelete: 'cascade' }),
	groupId: uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),

	/**
	 * The area the character was last in, with the cell; all three are null until they have been
	 * played in the group, and the area is null when it was deleted
	 */
	areaId: uuid('area_id').references((): AnyPgColumn => areas.id, { onDelete: 'set null' }),
	column: integer('column'),
	row: integer('row'),

	joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	index('group_members_group_id_index').on(table.groupId),
	index('group_members_area_id_index').on(table.areaId)
]);

/**
 * Invite links to groups. Only a hash of each link's token is kept, so the links can't be read back
 * out of the database
 */
export const groupInvites = pgTable('group_invites', {
	id: uuid('id').primaryKey().defaultRandom(),
	groupId: uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),

	/**
	 * SHA-256 of the token in the link, as hex
	 */
	tokenHash: text('token_hash').notNull(),

	/**
	 * Whether the link can be used again; a single-use link is deleted when a character joins with it
	 */
	multiUse: boolean('multi_use').notNull(),

	/**
	 * When the link stops working; null when it never does
	 */
	expiresAt: timestamp('expires_at', { withTimezone: true }),

	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	unique('group_invites_token_hash_unique').on(table.tokenHash),
	index('group_invites_group_id_index').on(table.groupId)
]);

/**
 * Settings for the whole site, in at most one row. A site without the row has DEFAULT_SITE_SETTINGS
 */
export const siteSettings = pgTable('site_settings', {
	/**
	 * Always true: the primary key and its check keep the table to one row
	 */
	id: boolean('id').primaryKey().default(true),

	universeCreationEnabled: boolean('universe_creation_enabled').notNull().default(DEFAULT_SITE_SETTINGS.universeCreationEnabled),
	universesPerCreator: integer('universes_per_creator').notNull().default(DEFAULT_SITE_SETTINGS.universesPerCreator),
	characterDeletionDays: integer('character_deletion_days').notNull().default(DEFAULT_SITE_SETTINGS.characterDeletionDays)
}, (table) => [
	check('site_settings_one_row', sql`${table.id}`),
	check('site_settings_universes_per_creator_range', sql`${table.universesPerCreator} BETWEEN ${sql.raw(String(MIN_UNIVERSES_PER_CREATOR))} AND ${sql.raw(String(MAX_UNIVERSES_PER_CREATOR))}`),
	check('site_settings_character_deletion_days_range', sql`${table.characterDeletionDays} BETWEEN 0 AND ${sql.raw(String(MAX_CHARACTER_DELETION_DAYS))}`)
]);

/**
 * How many bytes a hash stored for logins has: SHA-256 for session tokens, HMAC-SHA256 for keyed hashes
 */
const AUTH_HASH_BYTES = 32;

/**
 * SQL that checks a hash column holds AUTH_HASH_BYTES bytes
 *
 * @param column The column
 * @return The condition, true for null
 */
function authHashLength(column: AnyPgColumn): SQL
{
	return(sql`octet_length(${column}) = ${sql.raw(String(AUTH_HASH_BYTES))}`);
}

/**
 * Login sessions: one row per browser logged in to an account (see Login in STRUCTURE-OVERVIEW.md).
 * Deleted when the player logs out, when the password changes (every session of the account), and
 * with the account
 */
export const sessions = pgTable('sessions', {
	id: uuid('id').primaryKey().defaultRandom(),

	/**
	 * SHA-256 of the token in the browser's session cookie. The token itself is never stored, so the
	 * table can't be used to log in
	 */
	tokenHash: bytea('token_hash').notNull(),

	playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),

	/**
	 * Whether the player checked "Remember me", which makes the session last longer
	 * (server/src/logic/sessionLifetimes.ts)
	 */
	rememberMe: boolean('remember_me').notNull(),

	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

	/**
	 * When the session was last used, recorded at most every few minutes
	 */
	lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
	index('sessions_player_id_index').on(table.playerId),
	check('sessions_token_hash_length', authHashLength(table.tokenHash))
]);

/**
 * What an email code is for
 */
export const EMAIL_CODE_PURPOSES = ['register', 'resetPassword', 'changeEmail'] as const;
export const emailCodePurpose = pgEnum('email_code_purpose', EMAIL_CODE_PURPOSES);

/**
 * The email codes waiting to be entered (see Email codes in STRUCTURE-OVERVIEW.md): at most one per
 * purpose and address, since a new code replaces the old one. The address and the code are stored only
 * as keyed hashes. Deleted once they can no longer be used
 */
export const emailCodes = pgTable('email_codes', {
	id: uuid('id').primaryKey().defaultRandom(),
	purpose: emailCodePurpose('purpose').notNull(),

	/**
	 * Keyed hash of the address the code was sent to, in lowercase. The address itself isn't stored, so
	 * registering asks for it again with the password and checks it against this
	 */
	addressHash: bytea('address_hash').notNull(),

	/**
	 * The account a password reset or email change is for; null when registering
	 */
	playerId: uuid('player_id').references(() => players.id, { onDelete: 'cascade' }),

	/**
	 * Keyed hash of the code
	 */
	codeHash: bytea('code_hash').notNull(),

	sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
	wrongGuesses: smallint('wrong_guesses').notNull().default(0),

	/**
	 * When the code was entered correctly; null until then
	 */
	usedAt: timestamp('used_at', { withTimezone: true }),

	/**
	 * SHA-256 of the token in the cookie given to the browser that entered the code, which lets only that
	 * browser take the next step (such as setting the password). Set with the code's use
	 */
	continuationHash: bytea('continuation_hash'),

	/**
	 * When the next step must be taken by
	 */
	continuationExpiresAt: timestamp('continuation_expires_at', { withTimezone: true })
}, (table) => [
	uniqueIndex('email_codes_purpose_address_unique').on(table.purpose, table.addressHash),
	uniqueIndex('email_codes_continuation_hash_unique').on(table.continuationHash),
	index('email_codes_player_id_index').on(table.playerId),
	check('email_codes_address_hash_length', authHashLength(table.addressHash)),
	check('email_codes_code_hash_length', authHashLength(table.codeHash)),
	check('email_codes_continuation_hash_length', authHashLength(table.continuationHash)),
	check('email_codes_wrong_guesses_range', sql`${table.wrongGuesses} >= 0`),
	check('email_codes_player_purpose', sql`(${table.purpose} = 'register') = (${table.playerId} IS NULL)`),
	check('email_codes_continuation', sql`(${table.continuationHash} IS NULL) = (${table.continuationExpiresAt} IS NULL) AND (${table.continuationHash} IS NULL OR ${table.usedAt} IS NOT NULL)`)
]);

/**
 * What a rate limit counts: codes sent to an address and wrong guesses for it, and the codes asked for
 * and guesses made from a network
 */
export const RATE_LIMIT_KINDS = ['addressCodeSent', 'addressWrongGuess', 'networkCodeRequest', 'networkGuess'] as const;
export const rateLimitKind = pgEnum('rate_limit_kind', RATE_LIMIT_KINDS);

/**
 * One row per attempt a rate limit counts. The rows for a subject are counted and added in one
 * transaction, so requests sent at once can't each slip under a limit. Deleted once no limit counts
 * them (the longest window is a day)
 */
export const rateLimitEvents = pgTable('rate_limit_events', {
	id: uuid('id').primaryKey().defaultRandom(),
	kind: rateLimitKind('kind').notNull(),

	/**
	 * Keyed hash of what is limited: an address or a network (server/src/logic/networks.ts)
	 */
	subjectHash: bytea('subject_hash').notNull(),

	occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	index('rate_limit_events_subject_index').on(table.kind, table.subjectHash, table.occurredAt),
	index('rate_limit_events_occurred_at_index').on(table.occurredAt),
	check('rate_limit_events_subject_hash_length', authHashLength(table.subjectHash))
]);

/**
 * What happened in an auth event
 */
export const AUTH_EVENT_KINDS = ['registered', 'loggedIn', 'loginFailed', 'loggedOut', 'passwordReset', 'passwordChanged', 'passwordRehashed', 'emailChanged'] as const;
export const authEventKind = pgEnum('auth_event_kind', AUTH_EVENT_KINDS);

/**
 * A record of logins, failures, logouts and changes to how an account logs in. Never holds passwords,
 * codes or session tokens. Kept 90 days, and deleted with the account
 */
export const authEvents = pgTable('auth_events', {
	id: uuid('id').primaryKey().defaultRandom(),

	/**
	 * The account, or null when it isn't known (such as a failed login for an address with no account)
	 */
	playerId: uuid('player_id').references(() => players.id, { onDelete: 'cascade' }),

	kind: authEventKind('kind').notNull(),

	/**
	 * Keyed hash of the network the request came from, or null when it isn't known
	 */
	networkHash: bytea('network_hash'),

	occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	index('auth_events_player_id_index').on(table.playerId),
	index('auth_events_occurred_at_index').on(table.occurredAt),
	check('auth_events_network_hash_length', authHashLength(table.networkHash))
]);
