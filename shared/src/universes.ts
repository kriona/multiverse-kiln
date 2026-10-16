/**
 * The settings a universe and its zones choose from
 *
 * The database stores these values as enums (server/src/db/schema.ts), so adding one needs a migration
 */

/**
 * How far along a universe is, from being built to being retired
 *
 * - in_the_beginning: still being created; only its creators and builders can play
 * - prologue: open for beta testers
 * - let_there_be_light: ready for everyone, and listed on Home
 * - end_of_time: retired; locked and view only
 */
export const UNIVERSE_STAGES = ['in_the_beginning', 'prologue', 'let_there_be_light', 'end_of_time'] as const;

export type UniverseStage = typeof UNIVERSE_STAGES[number];

/**
 * The game rules a universe is played with
 */
export const RULESETS = ['pf1e'] as const;

export type Ruleset = typeof RULESETS[number];

/**
 * How the time of day changes in a universe or zone (see STRUCTURE-OVERVIEW.md)
 *
 * Zones also have inherit, which uses the parent zone's setting, or the universe's for a zone with no parent
 */
export const PASSAGES_OF_TIME = ['flows_normally', 'always_dawn', 'always_noon', 'always_dusk', 'always_midnight', 'faerie'] as const;

export type PassageOfTime = typeof PASSAGES_OF_TIME[number];

export const ZONE_PASSAGES_OF_TIME = ['inherit', ...PASSAGES_OF_TIME] as const;

export type ZonePassageOfTime = typeof ZONE_PASSAGES_OF_TIME[number];

/**
 * Where morning is in faerie time: the time of day runs from sunrise on this side of the map to midnight
 * on the opposite side. horizon puts morning at every edge and night in the center
 */
export const FAERIE_MORNINGS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'center', 'horizon'] as const;

export type FaerieMorning = typeof FAERIE_MORNINGS[number];

/**
 * How a zone link is taken: automatic links move you as soon as you step onto the cell, manual links
 * offer to
 */
export const ZONE_LINK_MODES = ['automatic', 'manual'] as const;

export type ZoneLinkMode = typeof ZONE_LINK_MODES[number];
