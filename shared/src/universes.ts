/**
 * The settings a universe and its areas choose from
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
export const RULESETS = ['pf1e', 'sf1e'] as const;

export type Ruleset = typeof RULESETS[number];

/**
 * Each ruleset's name
 */
export const RULESET_NAMES: Record<Ruleset, MessageDescriptor> = defineMessages({
	pf1e: {
		id: 'universe.ruleset.pf1e',
		defaultMessage: 'Pathfinder 1E',
		description: 'Name of the game rules of the tabletop role-playing game Pathfinder, first edition'
	},
	sf1e: {
		id: 'universe.ruleset.sf1e',
		defaultMessage: 'Starfinder 1E',
		description: 'Name of the game rules of the science fantasy tabletop role-playing game Starfinder, first edition'
	}
});

/**
 * How the time of day changes in a universe or area (see STRUCTURE-OVERVIEW.md)
 *
 * Areas also have inherit, which uses the parent area's setting, or the universe's for an area with no parent
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

export const AREA_PASSAGES_OF_TIME = ['inherit', ...PASSAGES_OF_TIME] as const;

export type AreaPassageOfTime = typeof AREA_PASSAGES_OF_TIME[number];

/**
 * Each passage of time's name, including an area's inherit
 */
export const PASSAGE_OF_TIME_NAMES: Record<AreaPassageOfTime, MessageDescriptor> = defineMessages({
	inherit: {
		id: 'universe.time.inherit',
		defaultMessage: 'inherit from the parent area',
		description: 'Passage of time for an area that uses its parent area\'s setting, or the universe\'s'
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
 * How the time of day changes in a universe's lobby (see Tab: Lobby in STRUCTURE-OVERVIEW.md)
 *
 * Actions take no time in the lobby, so time can't flow with them. real_time runs from the Unix epoch
 * instead, with a day of the universe's lobby day hours
 */
export const LOBBY_PASSAGES_OF_TIME = [
	'always_dawn',
	'always_noon',
	'always_dusk',
	'always_midnight',
	'real_time',
	'faerie'
] as const;

export type LobbyPassageOfTime = typeof LOBBY_PASSAGES_OF_TIME[number];

/**
 * The name of the lobby's real_time; its other passages of time are named in PASSAGE_OF_TIME_NAMES
 */
export const REAL_TIME_NAME: MessageDescriptor = defineMessages({
	realTime: {
		id: 'universe.time.real_time',
		defaultMessage: 'real time',
		description: 'Passage of time for a universe\'s lobby, where the time of day follows the real clock, with a day as long as the universe chooses'
	}
}).realTime;

/**
 * How many real hours a day in the lobby lasts when its passage of time is real_time
 */
export const MIN_LOBBY_DAY_HOURS = 1;

export const MAX_LOBBY_DAY_HOURS = 240;

export const DEFAULT_LOBBY_DAY_HOURS = 24;

/**
 * How players are shown the time of day in a universe
 *
 * - precise: the time on the clock, to the second
 * - rough: a word for the time of day, such as afternoon
 * - none: not at all
 */
export const DISPLAY_TIMES = [
	'precise',
	'rough',
	'none'
] as const;

export type DisplayTime = typeof DISPLAY_TIMES[number];

/**
 * Each way of showing the time's name
 */
export const DISPLAY_TIME_NAMES: Record<DisplayTime, MessageDescriptor> = defineMessages({
	precise: {
		id: 'universe.displayTime.precise',
		defaultMessage: 'precise (to the second)',
		description: 'Choice for how a universe shows the time of day: the time on the clock, e.g. 8:00:00 AM'
	},
	rough: {
		id: 'universe.displayTime.rough',
		defaultMessage: 'rough (such as afternoon)',
		description: 'Choice for how a universe shows the time of day: a word for the time of day, e.g. late morning or afternoon'
	},
	none: {
		id: 'universe.displayTime.none',
		defaultMessage: 'nothing',
		description: 'Choice for how a universe shows the time of day: players aren\'t shown the time at all'
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
 * How light an indoor area is, whatever the time of day: lit is as light as full daylight, dark as dark
 * as night. Outdoor areas follow the time of day instead
 */
export const AREA_LIGHT_LEVELS = ['lit', 'dark'] as const;

export type AreaLightLevel = typeof AREA_LIGHT_LEVELS[number];

/**
 * Each light level's name
 */
export const AREA_LIGHT_LEVEL_NAMES: Record<AreaLightLevel, MessageDescriptor> = defineMessages({
	lit: {
		id: 'universe.lightLevel.lit',
		defaultMessage: 'lit',
		description: 'Light level of an indoor area that is as light as full daylight at any time of day'
	},
	dark: {
		id: 'universe.lightLevel.dark',
		defaultMessage: 'dark',
		description: 'Light level of an indoor area that is as dark as night at any time of day'
	}
});

/**
 * How an area link is taken: automatic links move you as soon as you step onto the cell, manual links
 * offer to
 */
export const AREA_LINK_MODES = ['automatic', 'manual'] as const;

export type AreaLinkMode = typeof AREA_LINK_MODES[number];

/**
 * What a user may do with a universe (see STRUCTURE-OVERVIEW.md, Tab: Editors)
 *
 * - creator: change everything
 * - builder: change the world: tiles, areas, maps and links
 * - beta_tester: play while the universe is in prologue
 * - translator: translate the universe's text into the languages they are given
 */
export const UNIVERSE_ROLES = [
	'creator',
	'builder',
	'beta_tester',
	'translator'
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
		description: 'Role of someone who can change a universe\'s world: its tiles, areas, maps and links'
	},
	beta_tester: {
		id: 'universe.role.beta_tester',
		defaultMessage: 'beta tester',
		description: 'Role of someone who can play a universe before it opens to everyone'
	},
	translator: {
		id: 'universe.role.translator',
		defaultMessage: 'translator',
		description: 'Role of someone who can translate a universe\'s text, such as the names of its areas and items, into the languages they are given, and change nothing else'
	}
});

/**
 * Most languages one translator may be given
 */
export const MAX_TRANSLATOR_LANGUAGES = 20;

/**
 * Someone's place in a universe: their role, and the languages a translator may translate into
 */
export interface UniverseAccess
{
	role: UniverseRole;

	/**
	 * Language tags, such as de or pt-BR; empty for every role but translator
	 */
	languages: readonly string[];
}

/**
 * Whether a role may add, change and remove a universe's editors
 *
 * @param role The user's role in the universe
 * @return True when the role may
 */
export function canManageEditors(role: UniverseRole): boolean
{
	return(role === 'creator');
}

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
 * Whether a role may change a universe's world: its tiles, areas, maps and links
 *
 * @param role The user's role in the universe
 * @return True when the role may
 */
export function canEditWorld(role: UniverseRole): boolean
{
	return((role === 'creator') || (role === 'builder'));
}

/**
 * Whether someone may translate a universe's text into a language: creators into any, translators into
 * the languages they are given
 *
 * @param access The user's role in the universe, and their languages
 * @param language The language's tag
 * @return True when they may
 */
export function canTranslate(access: UniverseAccess, language: string): boolean
{
	if (access.role === 'creator')
	{
		return(true);
	}

	return((access.role === 'translator') && access.languages.some((each) => (each.toLowerCase() === language.toLowerCase())));
}

/**
 * Whether a user may play a universe, and make characters in it, in the stage it is in
 *
 * @param stage The universe's stage
 * @param role The user's role in the universe, or undefined for none
 * @return True when the user may
 */
export function canPlayUniverse(stage: UniverseStage, role: UniverseRole | undefined): boolean
{
	switch (stage)
	{
		case 'in_the_beginning':
			return((role !== undefined) && canEditWorld(role));

		case 'prologue':
			return(role !== undefined);

		case 'let_there_be_light':
			return(true);

		case 'end_of_time':
			return(false);
	}
}

/**
 * The part of a universe's address that names it, made from its name: lowercase, with every run of
 * characters other than letters and digits turned into one hyphen, e.g. "The Shattered Isles!" is
 * the-shattered-isles. Letters of every alphabet are kept, so a name in any language reads in its
 * address. No two universes have the same slug, which makes names that differ only in capitals or
 * punctuation the same name
 *
 * @param name The universe's name
 * @return The slug, empty for a name without letters or digits
 */
export function universeSlug(name: string): string
{
	return(name
		.normalize('NFC')
		.toLowerCase()
		.replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
		.replace(/^-+|-+$/g, ''));
}
