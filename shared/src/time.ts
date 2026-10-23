/**
 * Time of day in universes and their lobbies (see Time and distance in STRUCTURE-OVERVIEW.md)
 *
 * Times are seconds of game time. A group's clock counts the seconds that have passed since its world
 * began, and the time of day is where that falls in a day of DAY_SECONDS. Some passages of time ignore
 * the clock: a fixed time of day, real time from the Unix epoch (the lobby's) and faerie time, which
 * comes from where a cell is on the map
 */
import { positiveModulo, type MapBounds } from './maps.js';
import type { AreaLightLevel, AreaPassageOfTime, FaerieMorning, LobbyPassageOfTime, PassageOfTime } from './universes.js';

/**
 * Seconds in a day of game time
 */
export const DAY_SECONDS = 24 * 60 * 60;

/**
 * Seconds of game time a combat round takes
 */
export const COMBAT_ROUND_SECONDS = 6;

/**
 * The time of day a group's world begins at: 8 in the morning
 */
export const GROUP_START_SECONDS = 8 * 60 * 60;

/**
 * The second of the day each fixed time of day is at
 */
export const DAWN_SECONDS = 6 * 60 * 60;

export const NOON_SECONDS = 12 * 60 * 60;

export const DUSK_SECONDS = 18 * 60 * 60;

export const MIDNIGHT_SECONDS = 0;

/**
 * How long the light takes to come up around dawn and go down around dusk: from an hour before to an
 * hour after
 */
const TWILIGHT_SECONDS = 2 * 60 * 60;

/**
 * How an area's time of day is worked out, with inherit resolved (see resolveAreaTime)
 *
 * - flows_normally: from the group's clock
 * - always_dawn, always_noon, always_dusk and always_midnight: the same time forever
 * - faerie: from where a cell is on the map, with morning on one side
 * - real_time: from the Unix epoch, with a day of dayHours real hours (the lobby's only)
 */
export type AreaTime =
	| { passage: Exclude<PassageOfTime, 'faerie'> }
	| { passage: 'faerie'; morning: FaerieMorning }
	| { passage: 'real_time'; dayHours: number };

/**
 * A universe's or area's passage of time setting, as stored
 */
export interface PassageOfTimeSetting<T extends string>
{
	passageOfTime: T;

	/**
	 * Set when passageOfTime is faerie
	 */
	faerieMorning: FaerieMorning | null;
}

/**
 * A universe's lobby time settings, as stored
 */
export interface LobbyTimeSetting extends PassageOfTimeSetting<LobbyPassageOfTime>
{
	/**
	 * How many real hours a lobby day lasts, used when passageOfTime is real_time
	 */
	dayHours: number;
}

/**
 * The part of the day a time falls in, which the client tells screen reader users as it changes
 */
export type PartOfDay = 'dawn' | 'day' | 'dusk' | 'night';

/**
 * A word for a time of day, which faerie areas show in place of the time on the clock
 */
export type PeriodOfDay =
	| 'midnight'
	| 'night'
	| 'pre_dawn'
	| 'dawn'
	| 'early_morning'
	| 'morning'
	| 'late_morning'
	| 'noon'
	| 'early_afternoon'
	| 'afternoon'
	| 'late_afternoon'
	| 'evening'
	| 'late_evening';

/**
 * When each period of the day starts, in seconds since midnight, in order. A period lasts until the
 * next one starts, and the last runs past midnight into the first. Noon and midnight are the quarter
 * hour either side of them, and dawn and evening are when the light changes (see daylight)
 */
const PERIOD_STARTS: readonly (readonly [number, PeriodOfDay])[] = [
	[(0 * 60 * 60) + (15 * 60), 'night'],
	[4 * 60 * 60, 'pre_dawn'],
	[5 * 60 * 60, 'dawn'],
	[7 * 60 * 60, 'early_morning'],
	[9 * 60 * 60, 'morning'],
	[(10 * 60 * 60) + (30 * 60), 'late_morning'],
	[(11 * 60 * 60) + (45 * 60), 'noon'],
	[(12 * 60 * 60) + (15 * 60), 'early_afternoon'],
	[14 * 60 * 60, 'afternoon'],
	[16 * 60 * 60, 'late_afternoon'],
	[17 * 60 * 60, 'evening'],
	[19 * 60 * 60, 'late_evening'],
	[21 * 60 * 60, 'night'],
	[(23 * 60 * 60) + (45 * 60), 'midnight']
];

/**
 * An area's time of day setting, following inherit up through its parents to the universe's
 *
 * @param chain The area's setting, then its parent's, and so on up to its top-level area
 * @param universe The universe's setting, used when every area in the chain inherits
 * @return The setting the area uses
 */
export function resolveAreaTime(chain: readonly PassageOfTimeSetting<AreaPassageOfTime>[], universe: PassageOfTimeSetting<PassageOfTime>): AreaTime
{
	for (const setting of chain)
	{
		if (setting.passageOfTime !== 'inherit')
		{
			return(toAreaTime(setting.passageOfTime, setting.faerieMorning));
		}
	}

	return(toAreaTime(universe.passageOfTime, universe.faerieMorning));
}

/**
 * A universe's lobby time setting as an area's
 *
 * @param lobby The lobby's settings
 * @return The setting the lobby's area uses
 */
export function lobbyAreaTime(lobby: LobbyTimeSetting): AreaTime
{
	if (lobby.passageOfTime === 'real_time')
	{
		return({
			passage: 'real_time',
			dayHours: lobby.dayHours
		});
	}

	return(toAreaTime(lobby.passageOfTime, lobby.faerieMorning));
}

/**
 * A passage of time other than inherit and real_time as an area's time setting
 *
 * @param passageOfTime The passage of time
 * @param faerieMorning Where morning is, for faerie; a faerie setting without one has morning to the east
 * @return The setting
 */
function toAreaTime(passageOfTime: PassageOfTime, faerieMorning: FaerieMorning | null): AreaTime
{
	if (passageOfTime === 'faerie')
	{
		return({
			passage: 'faerie',
			morning: faerieMorning ?? 'east'
		});
	}

	return({ passage: passageOfTime });
}

/**
 * The second of the day it is in an area
 *
 * @param time The area's time setting
 * @param clockSeconds The group's clock, used when time flows normally; 0 in the lobby
 * @param nowMilliseconds The real time as milliseconds since the Unix epoch, used for real_time
 * @param cell Where on the map, used for faerie time
 * @param bounds The area's map, used for faerie time
 * @return Seconds since midnight, from 0 up to DAY_SECONDS
 */
export function secondOfDay(time: AreaTime, clockSeconds: number, nowMilliseconds: number, cell: { column: number; row: number }, bounds: MapBounds): number
{
	switch (time.passage)
	{
		case 'flows_normally':
			return(positiveModulo(clockSeconds, DAY_SECONDS));

		case 'always_dawn':
			return(DAWN_SECONDS);

		case 'always_noon':
			return(NOON_SECONDS);

		case 'always_dusk':
			return(DUSK_SECONDS);

		case 'always_midnight':
			return(MIDNIGHT_SECONDS);

		case 'real_time':
		{
			const dayMilliseconds = time.dayHours * 60 * 60 * 1000;

			return((positiveModulo(nowMilliseconds, dayMilliseconds) / dayMilliseconds) * DAY_SECONDS);
		}

		case 'faerie':
			// Sunrise where morning is, through the day and evening, to midnight furthest from it
			return(positiveModulo(DAWN_SECONDS + (faerieDistance(time.morning, cell, bounds) * (DAY_SECONDS - DAWN_SECONDS)), DAY_SECONDS));
	}
}

/**
 * How far a cell is from where morning is in faerie time, along the way to the furthest point from it
 *
 * @param morning Where morning is
 * @param cell The cell
 * @param bounds The map
 * @return 0 where morning is, up to 1 at the furthest point
 */
export function faerieDistance(morning: FaerieMorning, cell: { column: number; row: number }, bounds: MapBounds): number
{
	const west = fractionAcross(cell.column, bounds.minColumn, bounds.maxColumn);
	const north = fractionAcross(cell.row, bounds.minRow, bounds.maxRow);
	const east = 1 - west;
	const south = 1 - north;

	// Distance from the center as a fraction of the way to the edge, so every edge is equally far
	const fromCenter = Math.max(Math.abs(west - 0.5), Math.abs(north - 0.5)) * 2;

	switch (morning)
	{
		case 'west':
			return(west);

		case 'east':
			return(east);

		case 'north':
			return(north);

		case 'south':
			return(south);

		case 'northwest':
			return((north + west) / 2);

		case 'northeast':
			return((north + east) / 2);

		case 'southeast':
			return((south + east) / 2);

		case 'southwest':
			return((south + west) / 2);

		case 'center':
			return(fromCenter);

		case 'horizon':
			return(1 - fromCenter);
	}
}

/**
 * How far a coordinate is across a range of cells
 *
 * @param value The cell's column or row
 * @param min The first column or row
 * @param max The last column or row
 * @return 0 at min up to 1 at max; 0.5 when the range is one cell
 */
function fractionAcross(value: number, min: number, max: number): number
{
	if (max <= min)
	{
		return(0.5);
	}

	return(Math.min(Math.max((value - min) / (max - min), 0), 1));
}

/**
 * How light it is at a time of day
 *
 * @param seconds Seconds since midnight
 * @return 1 in full daylight, 0 at night, and between while the light comes up around dawn and goes
 * down around dusk
 */
export function daylight(seconds: number): number
{
	const time = positiveModulo(seconds, DAY_SECONDS);
	const half = TWILIGHT_SECONDS / 2;

	if ((time < (DAWN_SECONDS - half)) || (time >= (DUSK_SECONDS + half)))
	{
		return(0);
	}

	if (time < (DAWN_SECONDS + half))
	{
		return((time - (DAWN_SECONDS - half)) / TWILIGHT_SECONDS);
	}

	if (time < (DUSK_SECONDS - half))
	{
		return(1);
	}

	return(((DUSK_SECONDS + half) - time) / TWILIGHT_SECONDS);
}

/**
 * How light it is in an area at a time of day
 *
 * @param lightLevel The area's light level while it is indoors, or null outdoors (AreaPayload.lightLevel)
 * @param seconds Seconds since midnight
 * @return 1 in a lit area, 0 in a dark one, and outdoors the daylight at that time (see daylight)
 */
export function areaLight(lightLevel: AreaLightLevel | null, seconds: number): number
{
	switch (lightLevel)
	{
		case 'lit':
			return(1);

		case 'dark':
			return(0);

		case null:
			return(daylight(seconds));
	}
}

/**
 * The part of the day a time falls in: dawn and dusk while the light changes, day and night between
 *
 * @param seconds Seconds since midnight
 * @return The part of the day
 */
export function partOfDay(seconds: number): PartOfDay
{
	const time = positiveModulo(seconds, DAY_SECONDS);
	const half = TWILIGHT_SECONDS / 2;

	if (time < (DAWN_SECONDS - half))
	{
		return('night');
	}

	if (time < (DAWN_SECONDS + half))
	{
		return('dawn');
	}

	if (time < (DUSK_SECONDS - half))
	{
		return('day');
	}

	if (time < (DUSK_SECONDS + half))
	{
		return('dusk');
	}

	return('night');
}

/**
 * A word for a time of day (see PERIOD_STARTS), such as late morning
 *
 * @param seconds Seconds since midnight
 * @return The period of the day
 */
export function periodOfDay(seconds: number): PeriodOfDay
{
	const time = positiveModulo(seconds, DAY_SECONDS);

	// Before the first period starts, the last one is still running from the day before
	let period = PERIOD_STARTS[PERIOD_STARTS.length - 1][1];

	for (const [start, name] of PERIOD_STARTS)
	{
		if (time < start)
		{
			break;
		}

		period = name;
	}

	return(period);
}
