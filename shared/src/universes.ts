/**
 * The settings a universe and its zones choose from
 *
 * The database stores these values as enums (server/src/db/schema.ts), so adding one needs a migration.
 * Each also has its name as players read it, in their language
 */
import { defineMessages, type MessageDescriptor } from './localization.js';

/**
 * How far along a universe is, from being built to being retired
 *
 * - in_the_beginning: still being created; only its creators and builders can play
 * - prologue: open for beta testers
 * - let_there_be_light: ready for everyone, and listed on Home
 * - end_of_time: retired; locked and view only
 */
export const UNIVERSE_STAGES = [
	'in_the_beginning',
	'prologue',
	'let_there_be_light',
	'end_of_time'
] as const;

export type UniverseStage = typeof UNIVERSE_STAGES[number];

/**
 * Each stage's name
 */
export const UNIVERSE_STAGE_NAMES: Record<UniverseStage, MessageDescriptor> = defineMessages({
	in_the_beginning: {
		id: 'universe.stage.in_the_beginning',
		defaultMessage: 'in the beginning',
		description: 'Stage of a universe that is still being created, so only its creators and builders can play. Named after the opening of Genesis'
	},
	prologue: {
		id: 'universe.stage.prologue',
		defaultMessage: 'prologue',
		description: 'Stage of a universe that is open for beta testers'
	},
	let_there_be_light: {
		id: 'universe.stage.let_there_be_light',
		defaultMessage: 'let there be light',
		description: 'Stage of a universe that is ready for everyone to play. Named after the line in Genesis'
	},
	end_of_time: {
		id: 'universe.stage.end_of_time',
		defaultMessage: 'end of time',
		description: 'Stage of a universe that is retired: locked, and only viewed'
	}
});

/**
 * What each stage means for who can play the universe and whether Home lists it
 */
export const UNIVERSE_STAGE_DESCRIPTIONS: Record<UniverseStage, MessageDescriptor> = defineMessages({
	in_the_beginning: {
		id: 'universe.stageDescription.in_the_beginning',
		defaultMessage: 'Still being built. Only its creators and builders can play, and it isn\'t listed on Home.',
		description: 'Shown under the stage "in the beginning" in the editor, explaining what it means'
	},
	prologue: {
		id: 'universe.stageDescription.prologue',
		defaultMessage: 'Open for testing. Its creators, builders and beta testers can play, and it isn\'t listed on Home.',
		description: 'Shown under the stage "prologue" in the editor, explaining what it means'
	},
	let_there_be_light: {
		id: 'universe.stageDescription.let_there_be_light',
		defaultMessage: 'Ready for everyone. Anyone can play, and it\'s listed on Home.',
		description: 'Shown under the stage "let there be light" in the editor, explaining what it means'
	},
	end_of_time: {
		id: 'universe.stageDescription.end_of_time',
		defaultMessage: 'Retired. It is locked and can only be viewed, and it isn\'t listed on Home.',
		description: 'Shown under the stage "end of time" in the editor, explaining what it means'
	}
});

/**
 * The game rules a universe is played with
 */
export const RULESETS = ['pf1e'] as const;

export type Ruleset = typeof RULESETS[number];

/**
 * Each ruleset's name
 */
export const RULESET_NAMES: Record<Ruleset, MessageDescriptor> = defineMessages({
	pf1e: {
		id: 'universe.ruleset.pf1e',
		defaultMessage: 'Pathfinder 1E',
		description: 'Name of the game rules of the tabletop role-playing game Pathfinder, first edition'
	}
});

/**
 * How the time of day changes in a universe or zone (see STRUCTURE-OVERVIEW.md)
 *
 * Zones also have inherit, which uses the parent zone's setting, or the universe's for a zone with no parent
 */
export const PASSAGES_OF_TIME = [
	'flows_normally',
	'always_dawn',
	'always_noon',
	'always_dusk',
	'always_midnight',
	'faerie'
] as const;

export type PassageOfTime = typeof PASSAGES_OF_TIME[number];

export const ZONE_PASSAGES_OF_TIME = ['inherit', ...PASSAGES_OF_TIME] as const;

export type ZonePassageOfTime = typeof ZONE_PASSAGES_OF_TIME[number];

/**
 * Each passage of time's name, including a zone's inherit
 */
export const PASSAGE_OF_TIME_NAMES: Record<ZonePassageOfTime, MessageDescriptor> = defineMessages({
	inherit: {
		id: 'universe.time.inherit',
		defaultMessage: 'inherit from the parent zone',
		description: 'Passage of time for a zone that uses its parent zone\'s setting, or the universe\'s'
	},
	flows_normally: {
		id: 'universe.time.flows_normally',
		defaultMessage: 'flows normally',
		description: 'Passage of time where time passes as characters act'
	},
	always_dawn: {
		id: 'universe.time.always_dawn',
		defaultMessage: 'always dawn',
		description: 'Passage of time where it is dawn forever'
	},
	always_noon: {
		id: 'universe.time.always_noon',
		defaultMessage: 'always noon',
		description: 'Passage of time where it is noon forever'
	},
	always_dusk: {
		id: 'universe.time.always_dusk',
		defaultMessage: 'always dusk',
		description: 'Passage of time where it is dusk forever'
	},
	always_midnight: {
		id: 'universe.time.always_midnight',
		defaultMessage: 'always midnight',
		description: 'Passage of time where it is midnight forever'
	},
	faerie: {
		id: 'universe.time.faerie',
		defaultMessage: 'faerie',
		description: 'Passage of time where the time of day depends on where you are on the map, as in the realm of Faerie'
	}
});

/**
 * Where morning is in faerie time: the time of day runs from sunrise on this side of the map to midnight
 * on the opposite side. horizon puts morning at every edge and night in the center
 */
export const FAERIE_MORNINGS = [
	'north',
	'northeast',
	'east',
	'southeast',
	'south',
	'southwest',
	'west',
	'northwest',
	'center',
	'horizon'
] as const;

export type FaerieMorning = typeof FAERIE_MORNINGS[number];

/**
 * Each place morning can be in faerie time
 */
export const FAERIE_MORNING_NAMES: Record<FaerieMorning, MessageDescriptor> = defineMessages({
	north: {
		id: 'universe.faerie.north',
		defaultMessage: 'north',
		description: 'Where morning is in faerie time: the north edge of the map'
	},
	northeast: {
		id: 'universe.faerie.northeast',
		defaultMessage: 'northeast',
		description: 'Where morning is in faerie time: the northeast corner of the map'
	},
	east: {
		id: 'universe.faerie.east',
		defaultMessage: 'east',
		description: 'Where morning is in faerie time: the east edge of the map'
	},
	southeast: {
		id: 'universe.faerie.southeast',
		defaultMessage: 'southeast',
		description: 'Where morning is in faerie time: the southeast corner of the map'
	},
	south: {
		id: 'universe.faerie.south',
		defaultMessage: 'south',
		description: 'Where morning is in faerie time: the south edge of the map'
	},
	southwest: {
		id: 'universe.faerie.southwest',
		defaultMessage: 'southwest',
		description: 'Where morning is in faerie time: the southwest corner of the map'
	},
	west: {
		id: 'universe.faerie.west',
		defaultMessage: 'west',
		description: 'Where morning is in faerie time: the west edge of the map'
	},
	northwest: {
		id: 'universe.faerie.northwest',
		defaultMessage: 'northwest',
		description: 'Where morning is in faerie time: the northwest corner of the map'
	},
	center: {
		id: 'universe.faerie.center',
		defaultMessage: 'center',
		description: 'Where morning is in faerie time: the center of the map, with midnight at the edges'
	},
	horizon: {
		id: 'universe.faerie.horizon',
		defaultMessage: 'horizon',
		description: 'Where morning is in faerie time: every edge of the map, with night in the center'
	}
});

/**
 * How a zone link is taken: automatic links move you as soon as you step onto the cell, manual links
 * offer to
 */
export const ZONE_LINK_MODES = ['automatic', 'manual'] as const;

export type ZoneLinkMode = typeof ZONE_LINK_MODES[number];

/**
 * What a user may do with a universe (see STRUCTURE-OVERVIEW.md, Tab: Editors)
 *
 * - creator: change everything
 * - builder: change the world: tiles, zones, maps and links
 * - beta_tester: play while the universe is in prologue
 */
export const UNIVERSE_ROLES = [
	'creator',
	'builder',
	'beta_tester'
] as const;

export type UniverseRole = typeof UNIVERSE_ROLES[number];

/**
 * Each role's name
 */
export const UNIVERSE_ROLE_NAMES: Record<UniverseRole, MessageDescriptor> = defineMessages({
	creator: {
		id: 'universe.role.creator',
		defaultMessage: 'creator',
		description: 'Role of someone who can change everything about a universe'
	},
	builder: {
		id: 'universe.role.builder',
		defaultMessage: 'builder',
		description: 'Role of someone who can change a universe\'s world: its tiles, zones, maps and links'
	},
	beta_tester: {
		id: 'universe.role.beta_tester',
		defaultMessage: 'beta tester',
		description: 'Role of someone who can play a universe before it opens to everyone'
	}
});

/**
 * Whether a role may change a universe's settings: its name, descriptions, stage and passage of time
 *
 * @param role The user's role in the universe
 * @return True when the role may
 */
export function canEditUniverseSettings(role: UniverseRole): boolean
{
	return(role === 'creator');
}

/**
 * Whether a role may change a universe's world: its tiles, zones, maps and links
 *
 * @param role The user's role in the universe
 * @return True when the role may
 */
export function canEditWorld(role: UniverseRole): boolean
{
	return((role === 'creator') || (role === 'builder'));
}
