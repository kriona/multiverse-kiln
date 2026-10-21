/**
 * Where a new character starts (see STRUCTURE-OVERVIEW.md, Tab: Characters)
 *
 * The most specific choice wins: the class's entry for the character's race, then the class, then the
 * race, then the universe. A class with a starting area of its own has no per-race entries, so every
 * member of it starts there whatever their race
 */
import type { ClassRaceArea } from '@multiverse-kiln/shared';

/**
 * What a character's race says about where they start
 */
export interface StartingAreaRace
{
	/**
	 * The race's ID, which the class's per-race entries list it by
	 */
	id: number;

	/**
	 * The race's area, or null to leave it to the universe
	 */
	startingAreaId: string | null;
}

/**
 * What a character's class says about where they start
 */
export interface StartingAreaClass
{
	/**
	 * The class's area for every race, or null to leave it to raceAreas, then the race
	 */
	startingAreaId: string | null;

	/**
	 * The class's area for some races
	 */
	raceAreas: readonly ClassRaceArea[];
}

/**
 * The area a new character starts in
 *
 * @param universeAreaId The universe's starting area, or null while it has none
 * @param race The character's race
 * @param characterClass The character's class
 * @return The area's ID, or null when nothing names one
 */
export function chooseStartingArea(universeAreaId: string | null, race: StartingAreaRace, characterClass: StartingAreaClass): string | null
{
	const classForRace = characterClass.raceAreas.find((entry) => (entry.raceId === race.id))?.areaId;

	return((classForRace ?? characterClass.startingAreaId ?? race.startingAreaId ?? universeAreaId));
}
