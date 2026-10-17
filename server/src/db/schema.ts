/**
 * Drizzle schema: the source of truth for the database tables
 *
 * After changing it, run `npm run db:generate -w server` to create a migration, then
 * `npm run db:migrate -w server` to apply it. Never change the database by hand
 */
import { sql, type SQL } from 'drizzle-orm';
import { boolean, check, index, integer, pgEnum, pgTable, primaryKey, smallint, text, timestamp, unique, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { CHUNK_SIZE, DEFAULT_PF1E_SETTINGS, FAERIE_MORNINGS, IMPASSABLE_COST, MAX_GROUP_PLAYERS, MAX_ITEM_QUANTITY, MAX_MAP_SIDE, MIN_GROUP_SIZE, PASSAGES_OF_TIME, PF1E_ABILITIES, PF1E_CASTING_STYLES, PF1E_MAGIC_TRADITIONS, PF1E_MAX_COINS, PF1E_MAX_POINT_BUY_BUDGET, PF1E_MAX_RACE_ABILITY_MODIFIER, PF1E_MIN_POINT_BUY_BUDGET, PF1E_MIN_RACE_ABILITY_MODIFIER, PF1E_SIZES, PF1E_STAT_METHODS, RULESETS, UNIVERSE_ROLES, UNIVERSE_STAGES, ZONE_LINK_MODES, ZONE_PASSAGES_OF_TIME } from '@multiverse-kiln/shared';

export const universeStage = pgEnum('universe_stage', UNIVERSE_STAGES);
export const universeRole = pgEnum('universe_role', UNIVERSE_ROLES);
export const ruleset = pgEnum('ruleset', RULESETS);
export const passageOfTime = pgEnum('passage_of_time', PASSAGES_OF_TIME);
export const zonePassageOfTime = pgEnum('zone_passage_of_time', ZONE_PASSAGES_OF_TIME);
export const faerieMorning = pgEnum('faerie_morning', FAERIE_MORNINGS);
export const zoneLinkMode = pgEnum('zone_link_mode', ZONE_LINK_MODES);
export const pf1eStatMethod = pgEnum('pf1e_stat_method', PF1E_STAT_METHODS);
export const pf1eAbility = pgEnum('pf1e_ability', PF1E_ABILITIES);
export const pf1eSize = pgEnum('pf1e_size', PF1E_SIZES);
export const pf1eMagicTradition = pgEnum('pf1e_magic_tradition', PF1E_MAGIC_TRADITIONS);
export const pf1eCastingStyle = pgEnum('pf1e_casting_style', PF1E_CASTING_STYLES);

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
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	uniqueIndex('players_display_name_lower_unique').on(sql`lower(${table.displayName})`)
]);

/**
 * One row per universe
 *
 * The lobby and starting zones are set once the universe's zones exist, so both may be null for a
 * moment while a universe is created
 */
export const universes = pgTable('universes', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull(),
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

	lobbyZoneId: uuid('lobby_zone_id').references((): AnyPgColumn => zones.id, { onDelete: 'set null' }),

	/**
	 * Where characters start unless their race or class says otherwise
	 */
	startingZoneId: uuid('starting_zone_id').references((): AnyPgColumn => zones.id, { onDelete: 'set null' }),

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

	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	check('universes_faerie_morning_set', sql`(${table.passageOfTime} = 'faerie') = (${table.faerieMorning} IS NOT NULL)`),
	check('universes_group_size_range', sql`${table.groupSize} BETWEEN ${sql.raw(String(MIN_GROUP_SIZE))} AND ${sql.raw(String(MAX_GROUP_PLAYERS))}`),
	check('universes_starting_coins_range', sql`${table.startingPlatinum} BETWEEN 0 AND ${sql.raw(String(PF1E_MAX_COINS))} AND ${table.startingGold} BETWEEN 0 AND ${sql.raw(String(PF1E_MAX_COINS))} AND ${table.startingSilver} BETWEEN 0 AND ${sql.raw(String(PF1E_MAX_COINS))} AND ${table.startingCopper} BETWEEN 0 AND ${sql.raw(String(PF1E_MAX_COINS))}`)
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
	indoors: boolean('indoors').notNull(),

	/**
	 * Drawn when the tile has no graphic, as 0xRRGGBB
	 */
	color: integer('color').notNull(),

	/**
	 * How much of a character's vision crossing the tile uses, in percent; 100 can't be seen through
	 */
	visionCost: smallint('vision_cost').notNull().default(0),

	/**
	 * How much harder the tile is to move into, in percent: 50 takes twice as long, 100 can't be entered
	 */
	movementCost: smallint('movement_cost').notNull().default(0),

	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	unique('tiles_ruleset_key_unique').on(table.ruleset, table.key),
	unique('tiles_universe_overrides_unique').on(table.universeId, table.overridesTileId),
	index('tiles_universe_id_index').on(table.universeId),
	check('tiles_overrides_belong_to_universe', sql`${table.overridesTileId} IS NULL OR ${table.universeId} IS NOT NULL`),
	check('tiles_name_required', sql`${table.name} IS NOT NULL OR ${table.overridesTileId} IS NOT NULL`),
	check('tiles_color_range', sql`${table.color} BETWEEN 0 AND 16777215`),
	check('tiles_vision_cost_range', sql`${table.visionCost} BETWEEN 0 AND 100`),
	check('tiles_movement_cost_range', sql`${table.movementCost} BETWEEN 0 AND ${sql.raw(String(IMPASSABLE_COST))}`)
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
 * default race's ID. A default race has no starting money, equipment or zone; those belong to a
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

	/**
	 * Where the race's characters start, unless their class says otherwise; null for the universe's starting zone
	 */
	startingZoneId: uuid('starting_zone_id').references((): AnyPgColumn => zones.id, { onDelete: 'set null' }),

	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	unique('races_ruleset_key_unique').on(table.ruleset, table.key),
	unique('races_universe_overrides_unique').on(table.universeId, table.overridesRaceId),
	index('races_universe_id_index').on(table.universeId),
	index('races_starting_zone_id_index').on(table.startingZoneId),
	check('races_overrides_belong_to_universe', sql`${table.overridesRaceId} IS NULL OR ${table.universeId} IS NOT NULL`),
	check('races_name_required', sql`${table.name} IS NOT NULL OR ${table.overridesRaceId} IS NOT NULL`),
	check('races_starting_coins_range', allInRange([table.startingPlatinum, table.startingGold, table.startingSilver, table.startingCopper], 0, PF1E_MAX_COINS))
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

	darkvision: boolean('darkvision').notNull().default(false),
	size: pf1eSize('size').notNull().default('medium')
}, (table) => [
	check('pf1e_races_modifiers_range', allInRange([table.strengthModifier, table.dexterityModifier, table.constitutionModifier, table.intelligenceModifier, table.wisdomModifier, table.charismaModifier], PF1E_MIN_RACE_ABILITY_MODIFIER, PF1E_MAX_RACE_ABILITY_MODIFIER))
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

	/**
	 * Where every member of the class starts, whatever their race; null to leave it to class_race_zones,
	 * then the race, then the universe
	 */
	startingZoneId: uuid('starting_zone_id').references((): AnyPgColumn => zones.id, { onDelete: 'set null' }),

	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	unique('classes_ruleset_key_unique').on(table.ruleset, table.key),
	unique('classes_universe_overrides_unique').on(table.universeId, table.overridesClassId),
	index('classes_universe_id_index').on(table.universeId),
	index('classes_starting_zone_id_index').on(table.startingZoneId),
	check('classes_overrides_belong_to_universe', sql`${table.overridesClassId} IS NULL OR ${table.universeId} IS NOT NULL`),
	check('classes_name_required', sql`${table.name} IS NOT NULL OR ${table.overridesClassId} IS NOT NULL`),
	check('classes_starting_coins_range', allInRange([table.startingPlatinum, table.startingGold, table.startingSilver, table.startingCopper], 0, PF1E_MAX_COINS))
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
 * Where a class's characters of one race start, for a class with no starting zone of its own
 *
 * Listed against the row holding the class's settings. The race is listed by the ID everything else
 * uses for it: a default race's own ID, never its edited copy's
 */
export const classRaceZones = pgTable('class_race_zones', {
	classId: integer('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
	raceId: integer('race_id').notNull().references(() => races.id, { onDelete: 'cascade' }),
	zoneId: uuid('zone_id').notNull().references(() => zones.id, { onDelete: 'cascade' })
}, (table) => [
	primaryKey({ columns: [table.classId, table.raceId] }),
	index('class_race_zones_race_id_index').on(table.raceId),
	index('class_race_zones_zone_id_index').on(table.zoneId)
]);

/**
 * One row per zone: a map, and where it sits among the universe's zones
 *
 * The map covers minColumn..maxColumn and minRow..maxRow, both inclusive, around column 0, row 0
 */
export const zones = pgTable('zones', {
	id: uuid('id').primaryKey().defaultRandom(),
	universeId: uuid('universe_id').notNull().references(() => universes.id, { onDelete: 'cascade' }),
	parentZoneId: uuid('parent_zone_id').references((): AnyPgColumn => zones.id, { onDelete: 'set null' }),
	name: text('name').notNull(),
	enabled: boolean('enabled').notNull().default(true),
	indoors: boolean('indoors').notNull(),
	defaultTileId: integer('default_tile_id').notNull().references(() => tiles.id),
	minColumn: integer('min_column').notNull(),
	minRow: integer('min_row').notNull(),
	maxColumn: integer('max_column').notNull(),
	maxRow: integer('max_row').notNull(),
	loopsEastWest: boolean('loops_east_west').notNull().default(false),
	loopsNorthSouth: boolean('loops_north_south').notNull().default(false),
	passageOfTime: zonePassageOfTime('passage_of_time').notNull().default('inherit'),

	/**
	 * Set when passageOfTime is faerie
	 */
	faerieMorning: faerieMorning('faerie_morning'),

	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	index('zones_universe_id_index').on(table.universeId),
	index('zones_parent_zone_id_index').on(table.parentZoneId),
	check('zones_width', sql`${table.maxColumn} - ${table.minColumn} BETWEEN 0 AND ${sql.raw(String(MAX_MAP_SIDE - 1))}`),
	check('zones_height', sql`${table.maxRow} - ${table.minRow} BETWEEN 0 AND ${sql.raw(String(MAX_MAP_SIDE - 1))}`),
	check('zones_faerie_morning_set', sql`(${table.passageOfTime} = 'faerie') = (${table.faerieMorning} IS NOT NULL)`),
	check('zones_faerie_does_not_loop', sql`${table.passageOfTime} <> 'faerie' OR NOT (${table.loopsEastWest} OR ${table.loopsNorthSouth})`)
]);

/**
 * The stored chunks of each zone's map. A chunk that isn't stored is all the zone's default tile
 *
 * Layer 0 is the ground; later layers go on top of it
 */
export const mapChunks = pgTable('map_chunks', {
	zoneId: uuid('zone_id').notNull().references(() => zones.id, { onDelete: 'cascade' }),
	layer: smallint('layer').notNull().default(0),
	chunkColumn: integer('chunk_column').notNull(),
	chunkRow: integer('chunk_row').notNull(),

	/**
	 * CHUNK_SIZE * CHUNK_SIZE cell values, row by row: a tile ID, DEFAULT_TILE_CELL or VOID_CELL (see shared/src/maps.ts)
	 */
	cells: integer('cells').array().notNull()
}, (table) => [
	primaryKey({ columns: [table.zoneId, table.layer, table.chunkColumn, table.chunkRow] }),
	check('map_chunks_cell_count', sql`cardinality(${table.cells}) = ${sql.raw(String(CHUNK_SIZE * CHUNK_SIZE))}`)
]);

/**
 * Cells that take a player to a cell in another zone
 */
export const zoneLinks = pgTable('zone_links', {
	id: uuid('id').primaryKey().defaultRandom(),
	zoneId: uuid('zone_id').notNull().references(() => zones.id, { onDelete: 'cascade' }),
	column: integer('column').notNull(),
	row: integer('row').notNull(),
	targetZoneId: uuid('target_zone_id').notNull().references(() => zones.id, { onDelete: 'cascade' }),
	targetColumn: integer('target_column').notNull(),
	targetRow: integer('target_row').notNull(),
	mode: zoneLinkMode('mode').notNull(),

	/**
	 * The link can only be used while every member of the group is present
	 */
	requiresWholeGroup: boolean('requires_whole_group').notNull().default(false)
}, (table) => [
	unique('zone_links_cell_unique').on(table.zoneId, table.column, table.row),
	index('zone_links_target_zone_id_index').on(table.targetZoneId)
]);
