/**
 * Where a new character starts (see STRUCTURE-OVERVIEW.md, Tab: Characters)
 *
 * The most specific choice wins: the class's entry for the character's race, then the class, then the
 * race, then the universe. A class with a starting zone of its own has no per-race entries, so every
 * member of it starts there whatever their race
 */
import type { ClassRaceZone } from '@multiverse-kiln/shared';

/**
 * What a character's race says about where they start
 */
export interface StartingZoneRace
{
	/**
	 * The race's ID, which the class's per-race entries list it by
	 */
	id: number;

	/**
	 * The race's zone, or null to leave it to the universe
	 */
	startingZoneId: string | null;
}

/**
 * What a character's class says about where they start
 */
export interface StartingZoneClass
{
	/**
	 * The class's zone for every race, or null to leave it to raceZones, then the race
	 */
	startingZoneId: string | null;

	/**
	 * The class's zone for some races
	 */
	raceZones: readonly ClassRaceZone[];
}

/**
 * The zone a new character starts in
 *
 * @param universeZoneId The universe's starting zone, or null while it has none
 * @param race The character's race
 * @param characterClass The character's class
 * @return The zone's ID, or null when nothing names one
 */
export function chooseStartingZone(universeZoneId: string | null, race: StartingZoneRace, characterClass: StartingZoneClass): string | null
{
	const classForRace = characterClass.raceZones.find((entry) => (entry.raceId === race.id))?.zoneId;

	return((classForRace ?? characterClass.startingZoneId ?? race.startingZoneId ?? universeZoneId));
}
